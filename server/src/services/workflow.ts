import { rawPool } from '../db/client.js';
import type { CaseStatus, ServiceStatus } from '../types/domain.js';
import { writeAudit } from './audit.js';
import { badRequest, conflict, notFound } from '../helpers/http.js';
import { advisoryLock } from '../helpers/lock.js';
import { roleForDepartment } from '../auth/policy.js';

/* -------------------------------------------------------------------------- */
/* Workflow definitions                                                       */
/* -------------------------------------------------------------------------- */

export async function workflowFor(code: string) {
  const res = await rawPool.query(`SELECT * FROM workflow_definitions WHERE workflow_code = $1`, [code]);
  return res.rows[0] ?? null;
}

export async function allowedCaseTransitions(from: CaseStatus): Promise<CaseStatus[]> {
  const wf = await workflowFor('VERIFICATION_CASE');
  return transitionTargets(from, (wf?.transitions ?? {}) as Record<string, string[]>);
}

/**
 * Pure transition predicate. The workflow definition is loaded once per update
 * and passed in, so the guard and the API's advertised transitions can never
 * disagree about what is permitted.
 */
export function transitionTargets(from: string, transitions: Record<string, string[]>): CaseStatus[] {
  return (transitions[from] ?? []) as CaseStatus[];
}

export function isTransitionAllowed(
  from: string,
  to: string,
  transitions: Record<string, string[]>,
): boolean {
  return transitionTargets(from, transitions).includes(to as CaseStatus);
}

export async function allowedServiceTransitions(from: ServiceStatus): Promise<ServiceStatus[]> {
  const wf = await workflowFor('SERVICE_REQUEST');
  const transitions = (wf?.transitions ?? {}) as Record<string, string[]>;
  return (transitions[from] ?? []) as ServiceStatus[];
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_EVENT: Record<CaseStatus, string> = {
  SUBMITTED: 'CASE_CREATED',
  UNDER_REVIEW: 'STATUS_CHANGED',
  FIELD_VERIFICATION: 'FIELD_VERIFICATION_REQUESTED',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
};

const PRIORITY_ORDER = `CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END`;

export async function nextCaseNumber(client: Pick<typeof rawPool, 'query'> = rawPool): Promise<string> {
  // Monotonic sequence: a deleted case can never free its number for reuse.
  const res = await client.query(`SELECT nextval('verification_case_number_seq')::int AS n`);
  const n = Number(res.rows[0]?.n ?? 0);
  return `BHM-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

export interface CreateCaseInput {
  parcelId: string;
  title: string;
  description: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  findingRefs?: string[];
  assignedRole?: string | null;
  assignedDepartment?: string | null;
  dueDate?: string | null;
  actor: { userId: string | null; name: string; role: string; isOfficer: boolean };
  ip?: string | null;
  requestId?: string | null;
}

export async function createCase(input: CreateCaseInput) {
  const parcel = await rawPool.query(`SELECT parcel_id FROM parcels WHERE parcel_id = $1`, [input.parcelId]);
  if (parcel.rowCount === 0) throw notFound(`Parcel ${input.parcelId} not found`);

  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    // One global lock: the case number is global, so keying the lock on the
    // parcel allowed two concurrent creates on different parcels to read the
    // same sequence position.
    await advisoryLock(client, 'verification-case-number');

    const caseNumber = await nextCaseNumber(client);

    // Routing precedence: an explicit assignment, then the department implied by
    // the referenced integrity findings, then the creator's own officer role.
    let derivedRole = input.assignedRole ?? (input.assignedDepartment ? roleForDepartment(input.assignedDepartment) : null);
    let derivedDepartment = input.assignedDepartment ?? null;
    if (!derivedRole && input.findingRefs?.length) {
      // A reference may be a persisted finding id or a rule code. Resolve each
      // against the rule catalogue so routing is predictable for both forms.
      const { RULES } = await import('../domain/rules.js');
      const codes = new Set<string>();
      for (const ref of input.findingRefs) {
        const exact = RULES.find((r) => r.ruleCode === ref);
        if (exact) {
          codes.add(exact.ruleCode);
          continue;
        }
        const contained = RULES.find((r) => ref.includes(r.ruleCode));
        if (contained) codes.add(contained.ruleCode);
      }
      if (codes.size > 0) {
        const mapped = await client.query(
          `SELECT am.department, am.role_code FROM authority_mappings am
           WHERE am.rule_code = ANY($1::text[]) AND am.is_enabled = true
           ORDER BY am.sla_days ASC LIMIT 1`,
          [[...codes]],
        );
        if (mapped.rowCount && mapped.rows[0].role_code) {
          derivedRole = String(mapped.rows[0].role_code);
          derivedDepartment = String(mapped.rows[0].department);
        }
      }
    }
    if (!derivedRole && input.actor.isOfficer) derivedRole = input.actor.role;

    // A citizen-raised case carries no department of its own. Route it by the
    // parcel's active findings, so it reaches the responsible authority instead
    // of sitting unrouted; fall back to Revenue, which owns the parcel record.
    if (!derivedRole) {
      const active = await client.query<{ rule_code: string }>(
        `SELECT DISTINCT rule_code FROM integrity_findings
         WHERE parcel_id = $1 AND status <> 'DISMISSED'`,
        [input.parcelId],
      );
      const codes = active.rows.map((r) => r.rule_code);
      if (codes.length > 0) {
        const mapped = await client.query(
          `SELECT am.department, am.role_code FROM authority_mappings am
           WHERE am.rule_code = ANY($1::text[]) AND am.is_enabled = true
           ORDER BY am.sla_days ASC LIMIT 1`,
          [codes],
        );
        if (mapped.rowCount && mapped.rows[0].role_code) {
          derivedRole = String(mapped.rows[0].role_code);
          derivedDepartment = String(mapped.rows[0].department);
        }
      }
      if (!derivedRole) {
        derivedRole = 'REVENUE_OFFICER';
        derivedDepartment = derivedDepartment ?? 'Revenue';
      }
    }

    const res = await client.query(
      `INSERT INTO verification_cases (case_number, parcel_id, title, description, priority, status,
          origin, finding_refs, assigned_role, assigned_department, created_by, due_date)
       VALUES ($1,$2,$3,$4,$5,'SUBMITTED',$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        caseNumber,
        input.parcelId,
        input.title,
        input.description,
        input.priority ?? 'NORMAL',
        input.actor.isOfficer ? 'OFFICER' : 'CITIZEN',
        input.findingRefs ?? [],
        derivedRole,
        derivedDepartment,
        input.actor.userId,
        input.dueDate ?? null,
      ],
    );
    const row = res.rows[0];

    await client.query(
      `INSERT INTO case_events (case_id, event_type, to_status, description, actor, actor_role,
          actor_user_id, visibility)
       VALUES ($1,'CASE_CREATED','SUBMITTED',$2,$3,$4,$5,'PUBLIC')`,
      [row.case_id, `Case raised: ${input.title}`, input.actor.name, input.actor.role, input.actor.userId],
    );

    if (derivedRole) {
      await client.query(
        `INSERT INTO case_assignments (case_id, assigned_role, department, assigned_by, note)
         VALUES ($1,$2,$3,$4,'Initial routing')`,
        [row.case_id, derivedRole, derivedDepartment, input.actor.userId],
      );
      await client.query(
        `INSERT INTO case_events (case_id, event_type, description, actor, actor_role, actor_user_id, visibility)
         VALUES ($1,'OFFICER_ASSIGNED',$2,$3,$4,$5,'PUBLIC')`,
        [row.case_id, `Routed to department ${derivedDepartment ?? derivedRole}`, input.actor.name, input.actor.role, input.actor.userId],
      );
    }

    await client.query(
      `INSERT INTO temporal_versions (entity_type, entity_id, parcel_id, change_type, actor, after_value, reason)
       VALUES ('case',$1,$2,'CASE_CREATED',$3,$4,$5)`,
      [row.case_id, input.parcelId, input.actor.name, JSON.stringify({ caseNumber, status: 'SUBMITTED', title: input.title }), input.title],
    );

    await writeAudit(
      {
        actor: input.actor.name,
        actorUserId: input.actor.userId,
        role: input.actor.role,
        action: 'CASE_CREATED',
        entityType: 'verification_case',
        entityId: String(row.case_id),
        after: { caseNumber, parcelId: input.parcelId, title: input.title, status: 'SUBMITTED', priority: input.priority ?? 'NORMAL' },
        reason: input.title,
        requestId: input.requestId ?? null,
        ip: input.ip ?? null,
        parcelId: input.parcelId,
      },
      client,
    );

    await client.query(
      `INSERT INTO notifications (audience_role, type, title, body, entity_type, entity_id)
       VALUES ($1,'CASE_CREATED',$2,$3,'verification_case',$4)`,
      [derivedRole ?? 'REVENUE_OFFICER', `New verification case ${caseNumber}`, `${input.title} (parcel ${input.parcelId})`, row.case_id],
    );

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface UpdateCaseInput {
  status?: CaseStatus;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  assignedOfficer?: string | null;
  assignedRole?: string | null;
  assignedDepartment?: string | null;
  dueDate?: string | null;
  resolutionNote?: string | null;
  comment?: string | null;
  commentVisibility?: 'INTERNAL' | 'PUBLIC';
  reason: string;
  actor: { userId: string | null; name: string; role: string; isOfficer: boolean };
  ip?: string | null;
  requestId?: string | null;
}

export async function updateCase(caseId: string, input: UpdateCaseInput) {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await advisoryLock(client, `case-${caseId}`);

    const beforeRes = await client.query(`SELECT * FROM verification_cases WHERE case_id = $1 FOR UPDATE`, [caseId]);
    const before = beforeRes.rows[0];
    if (!before) throw notFound(`Case ${caseId} not found`);

    const parcelId = String(before.parcel_id);

    if (input.status && input.status !== before.status) {
      const wfRow = await workflowFor('VERIFICATION_CASE');
      const allowed = transitionTargets(
        String(before.status),
        (wfRow?.transitions ?? {}) as Record<string, string[]>,
      );
      if (!isTransitionAllowed(String(before.status), input.status, (wfRow?.transitions ?? {}) as Record<string, string[]>)) {
        throw conflict(
          `Transition ${before.status} → ${input.status} is not permitted by the case workflow. Allowed: ${allowed.join(', ') || 'none'}`,
        );
      }
    }

    if (input.assignedOfficer) {
      const officer = await client.query(
        `SELECT u.user_id, r.is_officer FROM users u JOIN roles r ON r.code = u.role_code WHERE u.user_id = $1`,
        [input.assignedOfficer],
      );
      if (officer.rowCount === 0) throw badRequest('Assigned officer does not exist');
      if (!officer.rows[0].is_officer) throw badRequest('Assigned user does not hold an officer role');
    }

    const after = await client.query(
      `UPDATE verification_cases SET
         status = coalesce($2, status),
         priority = coalesce($3, priority),
         assigned_officer = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_officer END,
         assigned_role = CASE WHEN $6::boolean THEN $7::text ELSE assigned_role END,
         assigned_department = CASE WHEN $8::boolean THEN $9::text ELSE assigned_department END,
         due_date = CASE WHEN $10::boolean THEN $11::date ELSE due_date END,
         resolution_note = coalesce($12, resolution_note),
         closed_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE closed_at END,
         updated_at = now()
       WHERE case_id = $1
       RETURNING *`,
      [
        caseId,
        input.status ?? null,
        input.priority ?? null,
        input.assignedOfficer !== undefined,
        input.assignedOfficer ?? null,
        input.assignedRole !== undefined,
        input.assignedRole ?? null,
        input.assignedDepartment !== undefined,
        input.assignedDepartment ?? null,
        input.dueDate !== undefined,
        input.dueDate ?? null,
        input.resolutionNote ?? null,
      ],
    );
    const row = after.rows[0];

    if (input.status && input.status !== before.status) {
      await client.query(
        `INSERT INTO case_events (case_id, event_type, from_status, to_status, description, actor, actor_role,
            actor_user_id, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PUBLIC')`,
        [
          caseId,
          STATUS_EVENT[input.status],
          before.status,
          input.status,
          input.reason || `Status changed from ${before.status} to ${input.status}`,
          input.actor.name,
          input.actor.role,
          input.actor.userId,
        ],
      );
      await client.query(
        `INSERT INTO temporal_versions (entity_type, entity_id, parcel_id, change_type, actor, before_value, after_value, reason)
         VALUES ('case',$1,$2,$3,$4,$5,$6,$7)`,
        [
          caseId,
          parcelId,
          'CASE_STATUS_CHANGED',
          input.actor.name,
          JSON.stringify({ status: before.status }),
          JSON.stringify({ status: input.status }),
          input.reason,
        ],
      );
    }

    if (input.assignedOfficer !== undefined && input.assignedOfficer !== before.assigned_officer) {
      await client.query(`UPDATE case_assignments SET is_current = false WHERE case_id = $1 AND is_current = true`, [caseId]);
      await client.query(
        `INSERT INTO case_assignments (case_id, assigned_to, assigned_role, department, assigned_by, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [caseId, input.assignedOfficer, input.assignedRole ?? row.assigned_role, input.assignedDepartment ?? row.assigned_department, input.actor.userId, input.reason],
      );
      await client.query(
        `INSERT INTO case_events (case_id, event_type, description, actor, actor_role, actor_user_id, visibility)
         VALUES ($1,'OFFICER_ASSIGNED',$2,$3,$4,$5,'INTERNAL')`,
        [caseId, input.reason || 'Case reassigned', input.actor.name, input.actor.role, input.actor.userId],
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
         VALUES ($1,'OFFICER_ASSIGNED',$2,$3,'verification_case',$4)`,
        [input.assignedOfficer, `Case ${row.case_number} assigned to you`, row.title, caseId],
      );
    }

    if (input.comment) {
      await client.query(
        `INSERT INTO case_comments (case_id, body, visibility, author_user_id, author_name, author_role)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [caseId, input.comment, input.commentVisibility ?? 'INTERNAL', input.actor.userId, input.actor.name, input.actor.role],
      );
      await client.query(
        `INSERT INTO case_events (case_id, event_type, description, actor, actor_role, actor_user_id, visibility)
         VALUES ($1,'COMMENT_ADDED',$2,$3,$4,$5,$6)`,
        [caseId, input.comment, input.actor.name, input.actor.role, input.actor.userId, input.commentVisibility ?? 'INTERNAL'],
      );
    }

    if (input.status === 'ESCALATED') {
      await client.query(
        `INSERT INTO notifications (audience_role, type, title, body, entity_type, entity_id)
         VALUES ('SYSTEM_ADMIN','STATUS_CHANGED',$1,$2,'verification_case',$3)`,
        [`Case ${row.case_number} escalated`, input.reason || row.title, caseId],
      );
    }

    await writeAudit(
      {
        actor: input.actor.name,
        actorUserId: input.actor.userId,
        role: input.actor.role,
        action: 'CASE_UPDATED',
        entityType: 'verification_case',
        entityId: caseId,
        before: {
          status: before.status,
          priority: before.priority,
          assignedOfficer: before.assigned_officer,
          dueDate: before.due_date,
        },
        after: {
          status: row.status,
          priority: row.priority,
          assignedOfficer: row.assigned_officer,
          dueDate: row.due_date,
        },
        reason: input.reason,
        requestId: input.requestId ?? null,
        ip: input.ip ?? null,
        parcelId,
      },
      client,
    );

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface CaseListFilters {
  status?: CaseStatus[];
  priority?: string[];
  assignedRole?: string;
  assignedOfficer?: string;
  district?: string;
  village?: string;
  parcelId?: string;
  q?: string;
  createdBy?: string;
  dueBefore?: string;
  limit: number;
  offset: number;
}

export async function listCases(filters: CaseListFilters) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const add = (sqlText: string, value: unknown) => {
    params.push(value);
    where.push(sqlText.replace('$?', `$${params.length}`));
  };

  if (filters.status?.length) add('c.status = ANY($?::case_status_t[])', filters.status);
  if (filters.priority?.length) add('c.priority = ANY($?::text[])', filters.priority);
  if (filters.assignedRole) add('c.assigned_role = $?', filters.assignedRole);
  if (filters.assignedOfficer) add('c.assigned_officer = $?::uuid', filters.assignedOfficer);
  if (filters.parcelId) add('c.parcel_id = $?', filters.parcelId);
  if (filters.createdBy) add('c.created_by = $?::uuid', filters.createdBy);
  if (filters.dueBefore) add('c.due_date <= $?::date', filters.dueBefore);
  if (filters.district) add('p.district = $?', filters.district);
  if (filters.village) add('p.village = $?', filters.village);
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    const i = params.length;
    where.push(`(lower(c.case_number) LIKE $${i} OR lower(c.title) LIKE $${i} OR lower(c.parcel_id) LIKE $${i})`);
  }

  const whereSql = where.join(' AND ');
  const countRes = await rawPool.query(
    `SELECT count(*)::text AS total FROM verification_cases c JOIN parcels p ON p.parcel_id = c.parcel_id WHERE ${whereSql}`,
    params,
  );
  params.push(filters.limit, filters.offset);
  const res = await rawPool.query(
    `SELECT c.*, p.display_id, p.district, p.village,
            u.full_name AS officer_name,
            (SELECT count(*) FROM integrity_findings f
              WHERE f.parcel_id = c.parcel_id AND f.status <> 'DISMISSED') AS finding_count,
            (SELECT max(CASE f.severity WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)
               FROM integrity_findings f
              WHERE f.parcel_id = c.parcel_id AND f.status <> 'DISMISSED') AS severity_rank
     FROM verification_cases c
     JOIN parcels p ON p.parcel_id = c.parcel_id
     LEFT JOIN users u ON u.user_id = c.assigned_officer
     WHERE ${whereSql}
     ORDER BY ${PRIORITY_ORDER}, c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function getCase(caseId: string) {
  const res = await rawPool.query(
    `SELECT c.*, p.display_id, p.district, p.village, p.taluk, p.area_sqft, p.latitude, p.longitude,
            p.data_status AS parcel_data_status, u.full_name AS officer_name
     FROM verification_cases c
     JOIN parcels p ON p.parcel_id = c.parcel_id
     LEFT JOIN users u ON u.user_id = c.assigned_officer
     WHERE c.case_id = $1`,
    [caseId],
  );
  const row = res.rows[0];
  if (!row) return null;

  const [events, comments, assignments, findings] = await Promise.all([
    rawPool.query(
      `SELECT * FROM case_events WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    ),
    rawPool.query(
      `SELECT * FROM case_comments WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId],
    ),
    rawPool.query(
      `SELECT ca.*, u.full_name AS assignee_name FROM case_assignments ca
       LEFT JOIN users u ON u.user_id = ca.assigned_to WHERE ca.case_id = $1 ORDER BY ca.created_at DESC`,
      [caseId],
    ),
    rawPool.query(
      `SELECT * FROM integrity_findings WHERE parcel_id = $1 ORDER BY severity`,
      [row.parcel_id],
    ),
  ]);

  return {
    ...row,
    events: events.rows,
    comments: comments.rows,
    assignments: assignments.rows,
    findings: findings.rows,
  };
}

/* -------------------------------------------------------------------------- */
/* Service requests                                                           */
/* -------------------------------------------------------------------------- */

const SERVICE_TYPES = [
  'OWNERSHIP_VERIFICATION',
  'PARCEL_CORRECTION',
  'AREA_CORRECTION',
  'DOCUMENT_UPDATE',
  'REGISTRATION_INQUIRY',
  'TAX_INQUIRY',
  'BUILDING_VERIFICATION',
  'OTHER',
] as const;
export type ServiceRequestType = (typeof SERVICE_TYPES)[number];
export { SERVICE_TYPES };

export const DEPARTMENT_FOR_SERVICE: Record<ServiceRequestType, string> = {
  OWNERSHIP_VERIFICATION: 'Revenue',
  PARCEL_CORRECTION: 'Survey/GIS',
  AREA_CORRECTION: 'Survey/GIS',
  DOCUMENT_UPDATE: 'Registration',
  REGISTRATION_INQUIRY: 'Registration',
  TAX_INQUIRY: 'Municipal Tax',
  BUILDING_VERIFICATION: 'Planning',
  OTHER: 'Revenue',
};

export async function createServiceRequest(input: {
  parcelId?: string | null;
  requestType: ServiceRequestType;
  subject: string;
  description: string;
  requesterNameMasked: string;
  contactMasked?: string | null;
  actor: { userId: string | null; name: string; role: string };
  ip?: string | null;
  requestId?: string | null;
}) {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await advisoryLock(client, 'service-request-number');
    const n = Number((await client.query(`SELECT nextval('service_request_number_seq')::int AS n`)).rows[0]?.n ?? 0);
    const reference = `SR-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
    const department = DEPARTMENT_FOR_SERVICE[input.requestType];

    const res = await client.query(
      `INSERT INTO service_requests (reference_number, parcel_id, request_type, subject, description,
          status, requester_user_id, requester_name_masked, contact_masked, assigned_department)
       VALUES ($1,$2,$3,$4,$5,'SUBMITTED',$6,$7,$8,$9)
       RETURNING *`,
      [
        reference, input.parcelId ?? null, input.requestType, input.subject, input.description,
        input.actor.userId, input.requesterNameMasked, input.contactMasked ?? null, department,
      ],
    );
    const row = res.rows[0];
    await client.query(
      `INSERT INTO service_request_events (request_id, to_status, description, actor, visibility)
       VALUES ($1,'SUBMITTED','Service request received and routed to the department.','citizen','PUBLIC')`,
      [row.request_id],
    );
    await writeAudit(
      {
        actor: input.actor.name,
        actorUserId: input.actor.userId,
        role: input.actor.role,
        action: 'SERVICE_REQUEST_CREATED',
        entityType: 'service_request',
        entityId: String(row.request_id),
        after: { reference, requestType: input.requestType, department, status: 'SUBMITTED' },
        reason: input.subject,
        requestId: input.requestId ?? null,
        ip: input.ip ?? null,
        parcelId: input.parcelId ?? null,
      },
      client,
    );
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listServiceRequests(opts: {
  status?: ServiceStatus[];
  department?: string;
  requesterUserId?: string;
  parcelId?: string;
  limit: number;
  offset: number;
}) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const add = (sqlText: string, value: unknown) => {
    params.push(value);
    where.push(sqlText.replace('$?', `$${params.length}`));
  };
  if (opts.status?.length) add('status = ANY($?::service_status_t[])', opts.status);
  if (opts.department) add('assigned_department = $?', opts.department);
  if (opts.requesterUserId) add('requester_user_id = $?::uuid', opts.requesterUserId);
  if (opts.parcelId) add('parcel_id = $?', opts.parcelId);

  const whereSql = where.join(' AND ');
  const countRes = await rawPool.query(`SELECT count(*)::text AS total FROM service_requests WHERE ${whereSql}`, params);
  params.push(opts.limit, opts.offset);
  const res = await rawPool.query(
    `SELECT * FROM service_requests WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function updateServiceRequest(input: {
  requestId: string;
  status: ServiceStatus;
  note: string;
  linkCaseId?: string | null;
  actor: { userId: string | null; name: string; role: string };
  ip?: string | null;
  requestIdHeader?: string | null;
}) {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    const beforeRes = await client.query(`SELECT * FROM service_requests WHERE request_id = $1 FOR UPDATE`, [input.requestId]);
    const before = beforeRes.rows[0];
    if (!before) throw notFound('Service request not found');
    if (input.status !== before.status) {
      const allowed = await allowedServiceTransitions(before.status as ServiceStatus);
      if (!allowed.includes(input.status)) {
        throw conflict(`Transition ${before.status} → ${input.status} is not permitted. Allowed: ${allowed.join(', ') || 'none'}`);
      }
    }
    const res = await client.query(
      `UPDATE service_requests SET status = $2, linked_case_id = coalesce($3, linked_case_id), updated_at = now()
       WHERE request_id = $1 RETURNING *`,
      [input.requestId, input.status, input.linkCaseId ?? null],
    );
    await client.query(
      `INSERT INTO service_request_events (request_id, from_status, to_status, description, actor, visibility)
       VALUES ($1,$2,$3,$4,$5,'PUBLIC')`,
      [input.requestId, before.status, input.status, input.note, input.actor.name],
    );
    await writeAudit(
      {
        actor: input.actor.name,
        actorUserId: input.actor.userId,
        role: input.actor.role,
        action: 'SERVICE_REQUEST_UPDATED',
        entityType: 'service_request',
        entityId: input.requestId,
        before: { status: before.status },
        after: { status: input.status },
        reason: input.note,
        requestId: input.requestIdHeader ?? null,
        ip: input.ip ?? null,
        parcelId: before.parcel_id ? String(before.parcel_id) : null,
      },
      client,
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export async function notificationsFor(user: { userId: string; role: string }, limit = 25) {
  const res = await rawPool.query(
    `SELECT * FROM notifications
     WHERE (user_id = $1::uuid) OR (user_id IS NULL AND audience_role = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [user.userId, user.role, limit],
  );
  return res.rows;
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const res = await rawPool.query(
    `UPDATE notifications SET read_at = now()
     WHERE notification_id = $1::uuid AND (user_id = $2::uuid OR user_id IS NULL) RETURNING *`,
    [notificationId, userId],
  );
  return res.rows[0] ?? null;
}
