import { rawPool } from '../db/client.js';
import { loadRecordSets } from './parcel-repository.js';
import { computeScore, deriveLinkage, evaluateParcel } from '../domain/integrity-engine.js';
import { probeAll } from '../adapters/index.js';
import { reconcileAllFindings } from './intelligence.js';
import type { QualityScore } from '../types/domain.js';
import { DEMO_NOTICE } from '../data/parcel-fixtures.js';

/**
 * Analytics are computed from the database on every request. Nothing is
 * fabricated: when the dataset is small the response says so explicitly.
 */
export interface AnalyticsPayload {
  datasetLabel: string;
  datasetNotice: string;
  datasetSize: number;
  kpis: {
    totalParcels: number;
    linkedParcels: number;
    partiallyLinkedParcels: number;
    unlinkedParcels: number;
    conflictingParcels: number;
    openCases: number;
    highRiskParcels: number;
    parcelsWithFindings: number;
    integrityFindings: number;
    verificationCompletionPct: number;
    sourceHealthPct: number;
    dataFreshnessDays: number | null;
    averageQualityScore: number;
  };
  distributions: {
    findingsByRule: { ruleCode: string; count: number }[];
    riskByBand: { band: string; count: number }[];
    casesByStatus: { status: string; count: number }[];
    casesByDepartment: { department: string; count: number }[];
    coverageByDistrict: { district: string; parcels: number; villages: number }[];
    findingsBySeverity: { severity: string; count: number }[];
  };
  trend: { month: string; parcels: number; registrations: number; cases: number }[];
  sources: {
    sourceId: string;
    name: string;
    organization: string;
    status: string;
    category: string;
    isAuthoritative: boolean;
    isDemonstration: boolean;
    lastSuccessAt: string | null;
    latencyMs: number | null;
  }[];
  quality: QualityScore & { sampleSize: number };
  computedAt: string;
}

export async function buildAnalytics(opts: { withSourceProbe?: boolean } = {}): Promise<AnalyticsPayload> {
  // Findings are recomputed from current records before any figure is derived,
  // so dashboard counts and parcel-level findings cannot disagree.
  await reconcileAllFindings();
  const [parcelsRes, casesRes, findingRes, sourceRes, qualityRes] = await Promise.all([
    rawPool.query(`SELECT parcel_id, district, village, created_at FROM parcels ORDER BY parcel_id`),
    rawPool.query(`SELECT status, assigned_department, created_at FROM verification_cases`),
    rawPool.query(`SELECT parcel_id, rule_code, severity, status FROM integrity_findings`),
    rawPool.query(`SELECT * FROM data_sources ORDER BY category, source_id`),
    rawPool.query(`SELECT count(*)::int AS n FROM parcels`),
  ]);

  const parcels = parcelsRes.rows;
  const caseRows = casesRes.rows;
  const findingRows = findingRes.rows.filter((r) => r.status !== 'DISMISSED');

  const recordSets = await loadRecordSets(parcels.map((p) => String(p.parcel_id)));

  const linkageCounts = { LINKED: 0, PARTIALLY_LINKED: 0, UNLINKED: 0, CONFLICTING: 0 };
  const riskBands: Record<string, number> = { VERIFIED: 0, REVIEW: 0, 'HIGH RISK': 0 };
  let qualityTotal = 0;
  const qualitySamples: QualityScore[] = [];

  const sources = sourceRes.rows;
  const operationalSources = sources.filter((s) => !s.is_demonstration);
  const healthySources = operationalSources.filter(
    (s) => s.status === 'CONNECTED' || s.status === 'AVAILABLE' || s.status === 'ADAPTER_READY',
  );
  const availabilityRatio = operationalSources.length === 0 ? 0 : healthySources.length / operationalSources.length;

  for (const rs of recordSets) {
    const { linkage } = deriveLinkage(rs);
    linkageCounts[linkage] += 1;
    const findings = evaluateParcel(rs);
    const score = computeScore(rs.parcel.parcel_id, findings, rs);
    riskBands[score.band] = (riskBands[score.band] ?? 0) + 1;
    // Quality is computed lazily in the passport; here we reuse the ratio form
    // with the same inputs so analytics and parcel view cannot disagree.
    const { qualityScore } = await import('./intelligence.js');
    const q = qualityScore(rs, availabilityRatio);
    qualitySamples.push(q);
    qualityTotal += q.score;
  }

  const findingsByRule = new Map<string, number>();
  const findingsBySeverity = new Map<string, number>();
  for (const f of findingRows) {
    findingsByRule.set(String(f.rule_code), (findingsByRule.get(String(f.rule_code)) ?? 0) + 1);
    findingsBySeverity.set(String(f.severity), (findingsBySeverity.get(String(f.severity)) ?? 0) + 1);
  }

  const casesByStatus = new Map<string, number>();
  const casesByDepartment = new Map<string, number>();
  for (const c of caseRows) {
    casesByStatus.set(String(c.status), (casesByStatus.get(String(c.status)) ?? 0) + 1);
    const d = String(c.assigned_department ?? 'UNASSIGNED');
    casesByDepartment.set(d, (casesByDepartment.get(d) ?? 0) + 1);
  }

  const districtMap = new Map<string, { parcels: number; villages: Set<string> }>();
  for (const p of parcels) {
    const d = String(p.district);
    const entry = districtMap.get(d) ?? { parcels: 0, villages: new Set<string>() };
    entry.parcels += 1;
    entry.villages.add(String(p.village));
    districtMap.set(d, entry);
  }

  // Trend over the last 6 calendar months, from real row timestamps.
  const trend: AnalyticsPayload['trend'] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    const parcelCount = parcels.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    const regRes = await rawPool.query(
      `SELECT count(*)::int AS n FROM registrations WHERE recorded_at >= $1 AND recorded_at < $2`,
      [start.toISOString(), end.toISOString()],
    );
    const caseCount = caseRows.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    trend.push({ month: label, parcels: parcelCount, registrations: Number(regRes.rows[0]?.n ?? 0), cases: caseCount });
  }

  const resolvedCases = caseRows.filter((c) => c.status === 'RESOLVED').length;
  const completion = caseRows.length === 0 ? 0 : Math.round((resolvedCases / caseRows.length) * 100);

  const furthest = parcels
    .map((p) => new Date(p.created_at).getTime())
    .sort((a, b) => b - a)[0];
  const freshnessDays = furthest ? Math.round((Date.now() - furthest) / 86_400_000) : null;

  const avgQuality = qualitySamples.length ? Math.round(qualityTotal / qualitySamples.length) : 0;
  const agg: QualityScore = qualitySamples.length
    ? {
        parcelId: null,
        score: avgQuality,
        completeness: Math.round(avg(qualitySamples.map((q) => q.completeness))),
        consistency: Math.round(avg(qualitySamples.map((q) => q.consistency))),
        freshness: Math.round(avg(qualitySamples.map((q) => q.freshness))),
        linkage: Math.round(avg(qualitySamples.map((q) => q.linkage))),
        geometryValidity: Math.round(avg(qualitySamples.map((q) => q.geometryValidity))),
        sourceAvailability: Math.round(avg(qualitySamples.map((q) => q.sourceAvailability))),
        breakdown: {
          note: 'Platform-wide average of the per-parcel data quality score.',
        },
      }
    : {
        parcelId: null,
        score: 0,
        completeness: 0,
        consistency: 0,
        freshness: 0,
        linkage: 0,
        geometryValidity: 0,
        sourceAvailability: 0,
        breakdown: { note: 'No parcels in the dataset.' },
      };

  const datasetSize = Number(qualityRes.rows[0]?.n ?? 0);

  return {
    datasetLabel: datasetSize <= 50 ? 'Demo dataset' : 'Production dataset',
    datasetNotice:
      datasetSize <= 50
        ? `${DEMO_NOTICE}. Figures below are computed from ${datasetSize} seeded demonstration parcels and are not national statistics.`
        : 'Figures computed from the live platform database.',
    datasetSize,
    kpis: {
      totalParcels: datasetSize,
      linkedParcels: linkageCounts.LINKED,
      partiallyLinkedParcels: linkageCounts.PARTIALLY_LINKED,
      unlinkedParcels: linkageCounts.UNLINKED,
      conflictingParcels: linkageCounts.CONFLICTING,
      openCases: caseRows.filter((c) => c.status !== 'RESOLVED').length,
      highRiskParcels: riskBands['HIGH RISK'] ?? 0,
      parcelsWithFindings: new Set(findingRows.map((f) => String(f.parcel_id))).size,
      integrityFindings: findingRows.length,
      verificationCompletionPct: completion,
      sourceHealthPct: Math.round(availabilityRatio * 100),
      dataFreshnessDays: freshnessDays,
      averageQualityScore: avgQuality,
    },
    distributions: {
      findingsByRule: [...findingsByRule.entries()]
        .map(([ruleCode, count]) => ({ ruleCode, count }))
        .sort((a, b) => b.count - a.count),
      riskByBand: Object.entries(riskBands).map(([band, count]) => ({ band, count })),
      casesByStatus: [...casesByStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      casesByDepartment: [...casesByDepartment.entries()].map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count),
      coverageByDistrict: [...districtMap.entries()].map(([district, v]) => ({
        district,
        parcels: v.parcels,
        villages: v.villages.size,
      })),
      findingsBySeverity: [...findingsBySeverity.entries()].map(([severity, count]) => ({ severity, count })),
    },
    trend,
    sources: sources.map((s) => ({
      sourceId: String(s.source_id),
      name: String(s.name),
      organization: String(s.organization),
      status: String(s.status),
      category: String(s.category),
      isAuthoritative: Boolean(s.is_authoritative),
      isDemonstration: Boolean(s.is_demonstration),
      lastSuccessAt: s.last_success_at ? new Date(s.last_success_at).toISOString() : null,
      latencyMs: s.latency_ms === null ? null : Number(s.latency_ms),
    })),
    quality: { ...agg, sampleSize: qualitySamples.length },
    computedAt: new Date().toISOString(),
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function snapshotAnalytics(): Promise<void> {
  const payload = await buildAnalytics();
  await rawPool.query(
    `INSERT INTO analytics_snapshots (scope, scope_key, payload, dataset_label) VALUES ('PLATFORM', NULL, $1, $2)`,
    [JSON.stringify(payload), payload.datasetLabel],
  );
}

export async function sourceHealth(opts: { force?: boolean } = {}): Promise<{
  health: Awaited<ReturnType<typeof probeAll>>;
  catalogue: Record<string, unknown>[];
}> {
  const health = await probeAll({ force: opts.force });
  const res = await rawPool.query(`SELECT * FROM data_sources ORDER BY category, source_id`);
  return {
    health,
    catalogue: res.rows.map((r) => ({
      sourceId: String(r.source_id),
      name: String(r.name),
      organization: String(r.organization),
      category: String(r.category),
      url: String(r.url),
      authority: String(r.authority),
      status: String(r.status),
      capability: r.capability,
      coverage: String(r.coverage),
      licenceNote: String(r.licence_note),
      isAuthoritative: Boolean(r.is_authoritative),
      isContextual: Boolean(r.is_contextual),
      isDerived: Boolean(r.is_derived),
      isDemonstration: Boolean(r.is_demonstration),
      isEnabled: Boolean(r.is_enabled),
      dataStatus: String(r.data_status),
      freshnessNote: String(r.freshness_note),
      lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
      lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
      lastErrorAt: r.last_error_at ? new Date(r.last_error_at).toISOString() : null,
      lastError: r.last_error ? String(r.last_error) : null,
      latencyMs: r.latency_ms === null ? null : Number(r.latency_ms),
      endpoint: r.endpoint ? String(r.endpoint) : null,
    })),
  };
}

export async function departmentGateway(opts: { force?: boolean } = {}) {
  const departments = ['Revenue', 'Registration', 'Municipal Tax', 'Planning', 'Judiciary', 'Survey/GIS'];
  const sourceForDept: Record<string, string> = {
    Revenue: 'REVENUE_DEMO',
    Registration: 'REGISTRATION_DEMO',
    'Municipal Tax': 'TAX_DEMO',
    Planning: 'PLANNING_DEMO',
    Judiciary: 'ECOURTS_DEMO',
    'Survey/GIS': 'CADASTRE_DEMO',
  };
  const adapters = await probeAll({ force: opts.force });
  const out = [];
  for (const dept of departments) {
    const sourceId = sourceForDept[dept];
    const health = adapters.find((a) => a.sourceId === sourceId);
    const runs = await rawPool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              max(finished_at) AS last_run
       FROM source_runs WHERE source_id = $1`,
      [sourceId],
    );
    const cases = await rawPool.query(
      `SELECT count(*)::int AS open FROM verification_cases WHERE assigned_department = $1 AND status <> 'RESOLVED'`,
      [dept],
    );
    const requests = await rawPool.query(
      `SELECT count(*)::int AS total FROM service_requests WHERE assigned_department = $1`,
      [dept],
    );
    const records = await rawPool.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM ror_records) t`,
    );
    out.push({
      department: dept,
      adapter: {
        sourceId,
        status: health?.status ?? 'NOT_CONFIGURED',
        detail: health?.detail ?? 'Adapter not registered',
        latencyMs: health?.latencyMs ?? null,
        configured: health?.configured ?? false,
        requiresAuth: health?.requiresAuth ?? false,
      },
      lastSync: runs.rows[0]?.last_run ? new Date(runs.rows[0].last_run).toISOString() : null,
      syncOperations: Number(runs.rows[0]?.total ?? 0),
      syncFailures: Number(runs.rows[0]?.failed ?? 0),
      recordsAvailable: Number(records.rows[0]?.n ?? 0),
      openCases: Number(cases.rows[0]?.open ?? 0),
      serviceRequests: Number(requests.rows[0]?.total ?? 0),
      covereageNote:
        'Demonstration fixture covers the six seeded parcels. The adapter contract is the integration point for the department’s authorised system.',
    });
  }
  return out;
}
