import { rawPool } from '../db/client.js';

export interface AuditInput {
  actor: string;
  actorUserId?: string | null;
  role: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  source?: string;
  reason?: string;
  requestId?: string | null;
  ip?: string | null;
  parcelId?: string | null;
}

/**
 * Appends to the audit log. Records are never updated or deleted by application
 * code; the table is treated as append-only. Callers pass this the same
 * transaction client when the audit entry must be atomic with the change.
 */
export async function writeAudit(input: AuditInput, client: Pick<typeof rawPool, 'query'> = rawPool): Promise<string> {
  const res = await client.query(
    `INSERT INTO audit_logs (actor, actor_user_id, role, action, entity_type, entity_id,
        before_value, after_value, source, reason, request_id, ip, parcel_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING audit_id`,
    [
      input.actor,
      input.actorUserId ?? null,
      input.role,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.source ?? 'bhumisetu-api',
      input.reason ?? '',
      input.requestId ?? null,
      input.ip ?? null,
      input.parcelId ?? null,
    ],
  );
  return String(res.rows[0].audit_id);
}

export async function listAudit(opts: {
  limit: number;
  offset: number;
  entityType?: string;
  entityId?: string;
  parcelId?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const add = (sqlText: string, value: unknown) => {
    params.push(value);
    where.push(sqlText.replace('$?', `$${params.length}`));
  };
  if (opts.entityType) add('entity_type = $?', opts.entityType);
  if (opts.entityId) add('entity_id = $?', opts.entityId);
  if (opts.parcelId) add('parcel_id = $?', opts.parcelId);
  if (opts.action) add('action = $?', opts.action);
  if (opts.actor) add('actor = $?', opts.actor);
  if (opts.from) add('"timestamp" >= $?', opts.from);
  if (opts.to) add('"timestamp" <= $?', opts.to);

  const whereSql = where.join(' AND ');
  const countRes = await rawPool.query(`SELECT count(*)::text AS total FROM audit_logs WHERE ${whereSql}`, params);
  params.push(opts.limit, opts.offset);
  const res = await rawPool.query(
    `SELECT * FROM audit_logs WHERE ${whereSql}
     ORDER BY "timestamp" DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: res.rows, total: Number(countRes.rows[0]?.total ?? 0) };
}
