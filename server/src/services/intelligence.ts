import { rawPool } from '../db/client.js';
import { loadRecordSets } from './parcel-repository.js';
import {
  computeScore,
  deriveLinkage,
  evaluateParcel,
  toNumber,
  type ParcelRecordSet,
} from '../domain/integrity-engine.js';
import type {
  DueDiligenceScore,
  FindingEvidence,
  IntegrityFinding,
  Linkage,
  Provenance,
  QualityScore,
  TimelineEvent,
} from '../types/domain.js';
import { SOURCE_CATALOGUE } from '../data/source-catalogue.js';

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

const SOURCE_INDEX = new Map(SOURCE_CATALOGUE.map((s) => [s.sourceId, s]));

export function provenanceFor(
  sourceId: string | null,
  dataStatus: Provenance['dataStatus'],
  recordedAt: string | null,
  opts: { confidence?: number | null; note?: string } = {},
): Provenance {
  const def = sourceId ? SOURCE_INDEX.get(sourceId) : undefined;
  return {
    sourceId,
    source: def?.name ?? sourceId ?? 'Unattributed record',
    sourceAuthority: def?.authority ?? 'Demo fixture',
    dataStatus,
    recordedAt,
    retrievedAt: null,
    isAuthoritative: def?.isAuthoritative ?? false,
    isDerived: def?.isDerived ?? dataStatus !== 'REAL',
    confidence: opts.confidence ?? null,
    note: opts.note ?? def?.licenceNote,
  };
}

/* -------------------------------------------------------------------------- */
/* Finding persistence (lifecycle only)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Persists lifecycle state for computed findings and returns the merged view.
 * The engine remains the source of truth: a persisted row without a
 * corresponding live computation is stale and is marked as such rather than
 * being surfaced as an active finding.
 */
export async function persistAndMergeFindings(
  rs: ParcelRecordSet,
  computed: IntegrityFinding[],
): Promise<{ findings: IntegrityFinding[]; stale: string[] }> {
  // Ensure a lifecycle row exists for every computed finding, then refresh the
  // evidence chain for all of them. Evidence is recomputed from the current
  // records on every pass, so it can never drift from the engine output.
  for (const f of computed) {
    await rawPool.query(
      `INSERT INTO integrity_findings (parcel_id, rule_code, severity, confidence, title, description,
          expected_value, observed_value, recommended_action, routed_authority, status, computed_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'OPEN', now()
       WHERE NOT EXISTS (SELECT 1 FROM integrity_findings WHERE parcel_id = $1 AND rule_code = $2)`,
      [
        f.parcelId, f.ruleCode, f.severity, f.confidence, f.title, f.description,
        f.expectedValue, f.observedValue, f.recommendedAction, f.routedAuthority,
      ],
    );
    await rawPool.query(
      `UPDATE integrity_findings SET
         severity = $3, confidence = $4, title = $5, description = $6,
         expected_value = $7, observed_value = $8, recommended_action = $9,
         routed_authority = $10, computed_at = now(), updated_at = now()
       WHERE parcel_id = $1 AND rule_code = $2`,
      [
        f.parcelId, f.ruleCode, f.severity, f.confidence, f.title, f.description,
        f.expectedValue, f.observedValue, f.recommendedAction, f.routedAuthority,
      ],
    );
  }

  const persistedIds = await rawPool.query<{ finding_id: string; rule_code: string }>(
    `SELECT finding_id, rule_code FROM integrity_findings WHERE parcel_id = $1`,
    [rs.parcel.parcel_id],
  );
  const idByRule = new Map(persistedIds.rows.map((r) => [String(r.rule_code), String(r.finding_id)]));

  for (const f of computed) {
    const findingId = idByRule.get(f.ruleCode);
    if (!findingId) continue;
    await rawPool.query(`DELETE FROM integrity_evidence WHERE finding_id = $1`, [findingId]);
    for (const e of f.evidence) {
      await rawPool.query(
        `INSERT INTO integrity_evidence (finding_id, parcel_id, source_id, source_authority,
            record_table, record_id, field, observed_value, expected_value, observed_at,
            confidence, data_status, provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          findingId, e.parcelId, e.sourceId, e.sourceAuthority, e.recordTable, e.recordId,
          e.field, e.observedValue, e.expectedValue, e.observedAt, e.confidence, e.dataStatus,
          JSON.stringify(e.provenance),
        ],
      );
    }
  }

  const live = await rawPool.query<{ finding_id: string; rule_code: string; status: string }>(
    `SELECT finding_id, rule_code, status FROM integrity_findings WHERE parcel_id = $1`,
    [rs.parcel.parcel_id],
  );
  const lifeByRule = new Map(live.rows.map((r) => [r.rule_code, r]));
  const computedCodes = new Set<string>(computed.map((f) => f.ruleCode));

  const merged = computed.map((f) => {
    const persisted = lifeByRule.get(f.ruleCode);
    return {
      ...f,
      findingId: persisted?.finding_id ?? f.findingId,
      status: (persisted?.status as IntegrityFinding['status']) ?? f.status,
    };
  });
  const stale = live.rows
    .filter((r) => !computedCodes.has(r.rule_code) && r.status !== 'DISMISSED')
    .map((r) => r.finding_id);
  if (stale.length > 0) {
    // The condition no longer holds in the current records, so the finding is
    // retired rather than shown as active.
    await rawPool.query(`UPDATE integrity_findings SET status = 'DISMISSED', updated_at = now() WHERE finding_id = ANY($1::uuid[])`, [stale]);
  }

  return { findings: merged, stale };
}

/* -------------------------------------------------------------------------- */
/* Evidence lookup                                                            */
/* -------------------------------------------------------------------------- */

export async function evidenceForFindings(findingIds: string[]): Promise<FindingEvidence[]> {
  if (findingIds.length === 0) return [];
  const res = await rawPool.query(
    `SELECT * FROM integrity_evidence WHERE finding_id = ANY($1::uuid[]) ORDER BY created_at`,
    [findingIds],
  );
  return res.rows.map((r) => {
    const def = r.source_id ? SOURCE_INDEX.get(String(r.source_id)) : undefined;
    return {
      evidenceId: String(r.evidence_id),
      findingId: String(r.finding_id),
      parcelId: String(r.parcel_id),
      sourceId: r.source_id ? String(r.source_id) : null,
      source: def?.name ?? (r.source_id ? String(r.source_id) : 'Unattributed record'),
      sourceAuthority: String(r.source_authority ?? ''),
      recordTable: String(r.record_table ?? ''),
      recordId: String(r.record_id ?? ''),
      field: String(r.field ?? ''),
      observedValue: r.observed_value === null ? null : String(r.observed_value),
      expectedValue: r.expected_value === null ? null : String(r.expected_value),
      observedAt: r.observed_at ? new Date(r.observed_at).toISOString() : null,
      confidence: r.confidence === null ? null : Number(r.confidence),
      dataStatus: r.data_status,
      provenance: (r.provenance ?? {}) as Provenance,
    };
  });
}

/**
 * Recompute-and-persist every parcel's findings. This is the sweep used by
 * analytics, the officer dashboard and the findings list so those surfaces read
 * freshly computed state rather than whatever happened to be visited last.
 * Bounded by the parcel count; intended for the platform-sized datasets this
 * build supports.
 */
export async function reconcileAllFindings(): Promise<{
  parcels: number;
  findings: number;
  byRule: Record<string, number>;
}> {
  const rows = await rawPool.query(`SELECT parcel_id FROM parcels ORDER BY parcel_id`);
  const ids = rows.rows.map((r) => String(r.parcel_id));
  const sets = await loadRecordSets(ids);
  const byRule: Record<string, number> = {};
  let total = 0;
  for (const rs of sets) {
    const computed = evaluateParcel(rs);
    total += computed.length;
    for (const f of computed) byRule[f.ruleCode] = (byRule[f.ruleCode] ?? 0) + 1;
    await persistAndMergeFindings(rs, computed);
  }
  return { parcels: sets.length, findings: total, byRule };
}

/* -------------------------------------------------------------------------- */
/* Quality score                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Data-quality score. Every input is a countable property of the stored record
 * set, and the breakdown names the inputs so the number is explainable and
 * configurable rather than a black box.
 */
export function qualityScore(rs: ParcelRecordSet, sourceAvailabilityRatio: number): QualityScore {
  const checks = {
    identity: !!rs.parcel.display_id,
    survey: !!rs.parcel.survey_number,
    geometry: !!rs.geometry,
    ror: rs.rorRecords.length > 0,
    registration: rs.registrations.length > 0,
    tax: rs.taxRecords.length > 0,
    landUse: false,
  };

  const completenessChecks = 6;
  const completeness = (Object.values(checks).slice(0, 6).filter(Boolean).length / completenessChecks) * 100;

  const rorOwner = rs.rorRecords[0]?.owner_name ?? null;
  const taxOwner = rs.taxRecords[0]?.owner_name ?? null;
  const deedOwner = rs.deeds[0]?.transferee_name ?? null;
  const ownershipAgrees =
    !!rorOwner && !!taxOwner && rorOwner.trim().toLowerCase() === taxOwner.trim().toLowerCase();
  const deedAgrees = !!rorOwner && !!deedOwner && rorOwner.trim().toLowerCase() === deedOwner.trim().toLowerCase();
  const areaAgrees = Math.abs(
    (toNumber(rs.revenueRecords.find((r) => r.record_type === 'CADASTRAL')?.recorded_area_sqft) ?? 0) -
      (toNumber(rs.rorRecords[0]?.asserted_area_sqft) ?? 0),
  ) <= 10;
  const consistencyChecks = [ownershipAgrees, deedAgrees, areaAgrees];
  const consistency = (consistencyChecks.filter(Boolean).length / consistencyChecks.length) * 100;

  const newest = [
    rs.rorRecords[0]?.recorded_at,
    rs.registrations[0]?.recorded_at,
    rs.taxRecords[0]?.recorded_at,
  ]
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime());
  const newestMs = newest.length ? Math.max(...newest) : null;
  const ageDays = newestMs ? (Date.now() - newestMs) / 86_400_000 : 999;
  const freshness = Math.max(0, Math.min(100, 100 - ageDays / 3.65)); // 0d => 100, 365d => 0

  const { linkage } = deriveLinkage(rs);
  const linkageScore = linkage === 'LINKED' ? 100 : linkage === 'PARTIALLY_LINKED' ? 60 : linkage === 'CONFLICTING' ? 40 : 0;

  const geoValid = rs.geometry?.is_valid ?? false;
  const geometryValidity = geoValid ? 100 : 0;

  const sourceAvailability = Math.round(sourceAvailabilityRatio * 100);

  const weights = {
    completeness: 0.25,
    consistency: 0.25,
    freshness: 0.15,
    linkage: 0.2,
    geometryValidity: 0.1,
    sourceAvailability: 0.05,
  };
  const score = Math.round(
    completeness * weights.completeness +
      consistency * weights.consistency +
      freshness * weights.freshness +
      linkageScore * weights.linkage +
      geometryValidity * weights.geometryValidity +
      sourceAvailability * weights.sourceAvailability,
  );

  return {
    parcelId: rs.parcel.parcel_id,
    score,
    completeness: Math.round(completeness),
    consistency: Math.round(consistency),
    freshness: Math.round(freshness),
    linkage: linkageScore,
    geometryValidity,
    sourceAvailability,
    breakdown: {
      completeness: `${Object.values(checks).slice(0, 6).filter(Boolean).length}/${completenessChecks} expected record groups present (25%)`,
      consistency: `${consistencyChecks.filter(Boolean).length}/3 cross-record checks agree — RoR vs tax owner, RoR vs deed transferee, cadastral vs RoR area (25%)`,
      freshness: `Newest linked record is ${Math.round(ageDays)} day(s) old (15%)`,
      linkage: `${linkage} — ${deriveLinkage(rs).reason} (20%)`,
      geometryValidity: geoValid ? 'Geometry present and flagged valid (10%)' : 'No valid geometry (10%)',
      sourceAvailability: `${sourceAvailability}% of catalogue sources currently reachable (5%)`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

export async function buildTimeline(
  parcelId: string,
  opts: { includeInternal: boolean },
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  const push = (e: TimelineEvent) => {
    if (e.visibility === 'INTERNAL' && !opts.includeInternal) return;
    events.push(e);
  };

  const parcelRes = await rawPool.query(`SELECT * FROM parcels WHERE parcel_id = $1`, [parcelId]);
  const parcel = parcelRes.rows[0];
  if (!parcel) return [];

  push({
    at: new Date(parcel.created_at).toISOString(),
    kind: 'RECORD_CREATED',
    title: 'Parcel record created',
    description: `Parcel ${parcel.parcel_id} (${parcel.display_id}) registered in the platform.`,
    source: 'CADASTRE_DEMO',
    authority: 'Demo fixture',
    actor: 'system',
    recordTable: 'parcels',
    recordId: parcelId,
    dataStatus: parcel.data_status,
    visibility: 'PUBLIC',
  });

  const feed: { sqlText: string; params: unknown[] }[] = [
    {
      sqlText: `SELECT ror_id AS id, recorded_at AS at, 'ROR_RECORDED' AS kind,
                  'Record of Rights recorded' AS title,
                  coalesce('Holder: '||owner_name||'; asserted area '||coalesce(asserted_area_sqft::text,'n/a')||' sq.ft','Record of Rights recorded') AS description,
                  source_id, source_authority, data_status
                FROM ror_records WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT revenue_record_id AS id, recorded_at AS at, 'CADASTRAL_RECORD' AS kind,
                  'Cadastral record' AS title,
                  'Recorded area '||coalesce(recorded_area_sqft::text,'n/a')||' sq.ft ('||record_type||')' AS description,
                  source_id, source_authority, data_status
                FROM revenue_records WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT registration_id AS id, coalesce(registration_date, recorded_at::date)::timestamptz AS at,
                  'REGISTRATION' AS kind, 'Registration: '||document_type AS title,
                  'Document '||document_number||coalesce(' at '||registration_office,'') AS description,
                  source_id, source_authority, data_status
                FROM registrations WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT d.deed_id AS id, coalesce(d.execution_date, d.created_at::date)::timestamptz AS at,
                  'OWNERSHIP_UPDATE' AS kind, 'Deed: '||d.deed_type AS title,
                  'Transferor '||coalesce(d.transferor_name,'n/a')||' → transferee '||coalesce(d.transferee_name,'n/a') AS description,
                  d.source_id, 'Demo fixture' AS source_authority, d.data_status
                FROM deeds d WHERE d.parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT tax_record_id AS id, recorded_at AS at, 'TAX_UPDATE' AS kind,
                  'Property tax '||tax_period AS title,
                  'Demand '||demand_amount||', paid '||paid_amount||', due '||due_amount AS description,
                  source_id, source_authority, data_status
                FROM tax_records WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT observation_id AS id, capture_date::timestamptz AS at, 'BUILDING_OBSERVATION' AS kind,
                  'Observation: '||sensor AS title,
                  'change score '||coalesce(change_score::text,'n/a')||', possible change '||possible_change||', confidence '||coalesce(confidence::text,'n/a') AS description,
                  source_id, source_authority, data_status
                FROM satellite_observations WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT judiciary_case_id AS id, coalesce(filing_date, created_at::date)::timestamptz AS at,
                  'JUDICIARY' AS kind, 'Judiciary: '||case_number AS title,
                  case_type||' — '||status||coalesce('; next hearing '||next_hearing::text,'') AS description,
                  source_id, source_authority, data_status
                FROM judiciary_cases WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT finding_id AS id, computed_at AS at,
                  'INTEGRITY_FINDING' AS kind, 'Integrity finding: '||rule_code AS title,
                  title||' — '||recommended_action AS description,
                  'INTEGRITY_ENGINE' AS source_id, 'BHUMISETU rules engine' AS source_authority, 'DERIVED' AS data_status
                FROM integrity_findings WHERE parcel_id = $1`,
      params: [parcelId],
    },
    {
      sqlText: `SELECT tv.version_id AS id, tv.recorded_at AS at, 'TEMPORAL_CHANGE' AS kind,
                  'Record change: '||tv.change_type AS title,
                  coalesce(tv.reason,'Recorded version change') AS description,
                  tv.source_id, 'Demo fixture' AS source_authority, 'DEMONSTRATION' AS data_status
                FROM temporal_versions tv
                WHERE tv.parcel_id = $1 AND tv.entity_type <> 'case'`,
      params: [parcelId],
    },
  ];

  for (const f of feed) {
    const res = await rawPool.query(f.sqlText, f.params);
    for (const r of res.rows) {
      const def = r.source_id ? SOURCE_INDEX.get(String(r.source_id)) : undefined;
      push({
        at: r.at ? new Date(r.at).toISOString() : new Date().toISOString(),
        kind: String(r.kind),
        title: String(r.title),
        description: String(r.description ?? ''),
        source: def?.name ?? String(r.source_id ?? 'unattributed'),
        authority: def?.authority ?? String(r.source_authority ?? ''),
        actor: 'demonstration-data',
        recordTable: '',
        recordId: String(r.id),
        dataStatus: r.data_status,
        visibility: 'PUBLIC',
      });
    }
  }

  const caseEvents = await rawPool.query(
    `SELECT ce.created_at AS at, ce.event_type, ce.description, ce.actor, ce.actor_role,
            ce.from_status, ce.to_status, ce.visibility, c.case_number, c.case_id
     FROM case_events ce JOIN verification_cases c ON c.case_id = ce.case_id
     WHERE c.parcel_id = $1 ORDER BY ce.created_at`,
    [parcelId],
  );
  for (const r of caseEvents.rows) {
    push({
      at: new Date(r.at).toISOString(),
      kind: `CASE_${r.event_type}`,
      title: `${String(r.event_type).replace(/_/g, ' ')} — ${r.case_number}`,
      description: String(r.description ?? ''),
      source: 'BHUMISETU case workflow',
      authority: 'BHUMISETU',
      actor: String(r.actor ?? 'system'),
      recordTable: 'case_events',
      recordId: String(r.case_id),
      dataStatus: 'DERIVED',
      visibility: r.visibility === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL',
    });
  }

  const caseComments = await rawPool.query(
    `SELECT cc.created_at AS at, cc.body, cc.author_name, cc.author_role, cc.visibility, c.case_number
     FROM case_comments cc JOIN verification_cases c ON c.case_id = cc.case_id
     WHERE c.parcel_id = $1`,
    [parcelId],
  );
  for (const r of caseComments.rows) {
    push({
      at: new Date(r.at).toISOString(),
      kind: 'OFFICER_COMMENT',
      title: `Note on ${r.case_number}`,
      description: String(r.body),
      source: 'BHUMISETU case workflow',
      authority: 'BHUMISETU',
      actor: String(r.author_name ?? 'officer'),
      recordTable: 'case_comments',
      recordId: String(r.case_number),
      dataStatus: 'DERIVED',
      visibility: r.visibility === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL',
    });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/* -------------------------------------------------------------------------- */
/* Composite intelligence view                                                */
/* -------------------------------------------------------------------------- */

export interface ParcelIntelligence {
  parcel: ParcelRecordSet['parcel'] & { identifiers: unknown };
  recordSet: ParcelRecordSet;
  findings: IntegrityFinding[];
  evidence: FindingEvidence[];
  score: DueDiligenceScore;
  linkage: Linkage;
  linkageReason: string;
  quality: QualityScore;
  staleFindings: string[];
}

export async function buildIntelligence(
  parcelId: string,
  opts: { sourceAvailabilityRatio: number; withEvidence?: boolean },
): Promise<ParcelIntelligence | null> {
  const [rs] = await loadRecordSets([parcelId]);
  if (!rs) return null;
  const computed = evaluateParcel(rs);
  const { findings, stale } = await persistAndMergeFindings(rs, computed);
  const evidence = opts.withEvidence === false ? [] : await evidenceForFindings(findings.map((f) => f.findingId));
  const { linkage, reason } = deriveLinkage(rs);
  const score = computeScore(parcelId, findings, rs);
  return {
    parcel: rs.parcel as ParcelIntelligence['parcel'],
    recordSet: rs,
    findings,
    evidence,
    score,
    linkage,
    linkageReason: reason,
    quality: qualityScore(rs, opts.sourceAvailabilityRatio),
    staleFindings: stale,
  };
}
