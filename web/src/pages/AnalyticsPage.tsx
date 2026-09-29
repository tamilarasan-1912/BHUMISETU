import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import {
  BarChart,
  CardHead,
  ColumnChart,
  EmptyState,
  ErrorState,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  SourceBadge,
  formatDateTime,
  formatNumber,
} from '../components/ui';

export function AnalyticsPage() {
  const navigate = useNavigate();
  const state = useAsync((s) => api.analytics(s), []);

  if (state.loading) {
    return (
      <div className="page">
        <LoadingState lines={6} label="Computing analytics" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="page stack">
        <ErrorState title="Analytics unavailable" error={state.error} onRetry={state.reload}>
          Analytics are computed from the live database on every request. If the database is unavailable the figures
          cannot be produced, and BHUMISETU will not substitute estimates.
        </ErrorState>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          Return to map
        </button>
      </div>
    );
  }
  const a = state.data;
  if (!a) return null;

  const linkedTotal = a.kpis.linkedParcels + a.kpis.partiallyLinkedParcels;

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Platform analytics</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '90ch' }}>
            Every figure below is computed from the live database at request time. Nothing is estimated or fabricated.
          </p>
        </div>
        <span className="badge badge-demo">{a.datasetLabel}</span>
      </div>

      <ProvenanceNotice tone="demo">{a.datasetNotice}</ProvenanceNotice>

      <div className="grid grid-4">
        <MetricCard label="Total parcels" value={formatNumber(a.kpis.totalParcels)} hint={a.datasetLabel} />
        <MetricCard label="Linked parcels" value={formatNumber(linkedTotal)} tone="ok" hint={`${a.kpis.linkedParcels} fully linked`} />
        <MetricCard label="Unlinked parcels" value={formatNumber(a.kpis.unlinkedParcels)} tone="info" hint="Coverage gap" />
        <MetricCard label="Conflicting linkage" value={formatNumber(a.kpis.conflictingParcels)} tone="danger" hint="Records disagree" />
        <MetricCard label="Open cases" value={formatNumber(a.kpis.openCases)} tone="warn" />
        <MetricCard label="High-risk parcels" value={formatNumber(a.kpis.highRiskParcels)} tone="danger" hint="Internal band" />
        <MetricCard label="Integrity findings" value={formatNumber(a.kpis.integrityFindings)} tone="warn" hint="Active findings" />
        <MetricCard label="Parcels with findings" value={formatNumber(a.kpis.parcelsWithFindings)} tone="warn" />
        <MetricCard label="Verification completion" value={`${a.kpis.verificationCompletionPct}%`} tone={a.kpis.verificationCompletionPct > 50 ? 'ok' : 'warn'} hint="Resolved / all cases" />
        <MetricCard label="Source health" value={`${a.kpis.sourceHealthPct}%`} tone={a.kpis.sourceHealthPct > 60 ? 'ok' : 'warn'} hint="Adapters reporting healthy" />
        <MetricCard
          label="Data freshness"
          value={a.kpis.dataFreshnessDays === null ? '—' : `${a.kpis.dataFreshnessDays}d`}
          hint="Youngest parcel record"
        />
        <MetricCard label="Average quality score" value={`${a.kpis.averageQualityScore}/100`} tone="info" hint={`Across ${a.quality.sampleSize} parcel(s)`} />
      </div>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Finding distribution" subtitle="Active findings by rule code" />
          {a.distributions.findingsByRule.length === 0 ? (
            <EmptyState title="No findings recorded" icon="✓" body="No integrity rule has fired against the current record set." />
          ) : (
            <BarChart
              ariaLabel="Findings by rule code"
              data={a.distributions.findingsByRule.map((f) => ({ label: f.ruleCode, value: f.count, tone: 'warn' as const }))}
            />
          )}
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Risk distribution" subtitle="Parcels by verification-support band" />
          <BarChart
            ariaLabel="Parcels by risk band"
            data={a.distributions.riskByBand.map((r) => ({
              label: r.band,
              value: r.count,
              tone: r.band === 'VERIFIED' ? ('ok' as const) : r.band === 'REVIEW' ? ('warn' as const) : ('danger' as const),
            }))}
          />
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Case status" subtitle="Verification workflow distribution" />
          {a.distributions.casesByStatus.length === 0 ? (
            <EmptyState title="No cases" icon="⚑" body="No verification case exists yet, so there is no workflow distribution to show." />
          ) : (
            <BarChart ariaLabel="Cases by status" data={a.distributions.casesByStatus.map((c) => ({ label: c.status, value: c.count }))} />
          )}
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Department workload" subtitle="Cases by assigned department" />
          {a.distributions.casesByDepartment.length === 0 ? (
            <EmptyState title="No assigned cases" icon="⚑" body="No case has been assigned to a department yet." />
          ) : (
            <BarChart
              ariaLabel="Cases by department"
              data={a.distributions.casesByDepartment.map((c) => ({ label: c.department, value: c.count }))}
            />
          )}
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Coverage by district" subtitle="Parcels and villages per district" />
          <BarChart
            ariaLabel="Parcels by district"
            data={a.distributions.coverageByDistrict.map((c) => ({ label: c.district, value: c.parcels }))}
          />
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Findings by severity" subtitle="Severity mix across active findings" />
          {a.distributions.findingsBySeverity.length === 0 ? (
            <EmptyState title="No findings" body="No finding has fired, so there is no severity mix." />
          ) : (
            <BarChart
              ariaLabel="Findings by severity"
              data={a.distributions.findingsBySeverity.map((f) => ({
                label: f.severity,
                value: f.count,
                tone: f.severity === 'HIGH' ? ('danger' as const) : f.severity === 'MEDIUM' ? ('warn' as const) : ('default' as const),
              }))}
            />
          )}
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Coverage by source" subtitle="Distinct sources feeding the platform" />
          <BarChart
            ariaLabel="Sources by category"
            data={Object.entries(
              a.sources.reduce<Record<string, number>>((acc, s) => {
                acc[s.category] = (acc[s.category] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([label, value]) => ({ label, value }))}
          />
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Trend over time" subtitle="Records created per month (last six months)" />
          <ColumnChart
            ariaLabel="Parcels created per month"
            data={a.trend.map((t) => ({ label: t.month.slice(5), value: t.parcels }))}
          />
          <div className="divider" />
          <div className="label">Registrations per month</div>
          <ColumnChart
            ariaLabel="Registrations per month"
            data={a.trend.map((t) => ({ label: t.month.slice(5), value: t.registrations }))}
          />
        </GlassPanel>
      </div>

      <GlassCard>
        <CardHead title="Source health" subtitle="Recorded adapter status, latency and last successful sync" />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Latency</th>
                <th scope="col">Last success</th>
                <th scope="col">Nature</th>
              </tr>
            </thead>
            <tbody>
              {a.sources.map((s) => (
                <tr key={s.sourceId}>
                  <td>
                    <div className="small">{s.name}</div>
                    <div className="tiny muted">{s.organization}</div>
                  </td>
                  <td className="small muted">{s.category}</td>
                  <td>
                    <SourceBadge status={s.status as never} />
                  </td>
                  <td className="num tiny">{s.latencyMs === null ? '—' : `${s.latencyMs} ms`}</td>
                  <td className="tiny muted">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : 'never'}</td>
                  <td>
                    <div className="chip-row">
                      {s.isAuthoritative ? <span className="badge badge-ok">authoritative</span> : null}
                      {s.isDemonstration ? <span className="badge badge-demo">demonstration</span> : null}
                      {!s.isAuthoritative && !s.isDemonstration ? <span className="badge badge-neutral">contextual</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divider" />
        <div className="tiny muted">
          Computed {formatDateTime(a.computedAt)} · verification completion counts resolved cases against all cases ·
          source health counts adapters reporting CONNECTED, AVAILABLE or ADAPTER_READY among non-demonstration sources.
        </div>
      </GlassCard>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Quality score composition" subtitle="Platform-wide average of per-parcel inputs" />
          <div className="chart">
            {[
              ['Completeness', a.quality.completeness],
              ['Consistency', a.quality.consistency],
              ['Freshness', a.quality.freshness],
              ['Linkage', a.quality.linkage],
              ['Geometry validity', a.quality.geometryValidity],
              ['Source availability', a.quality.sourceAvailability],
            ].map(([label, value]) => (
              <div className="bar-row" key={String(label)}>
                <span className="muted">{String(label)}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Number(value)}%` }} />
                </span>
                <span className="mono">{String(value)}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="small muted">{String(a.quality.breakdown.note ?? '')}</div>
          <div className="tiny muted">Sample size: {a.quality.sampleSize} parcel(s).</div>
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Interpretation" subtitle="How to read these figures" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li>Risk bands are an internal verification-support indicator, not a legal score.</li>
            <li>A finding records that records require reconciliation; it is not proof of fraud or illegality.</li>
            <li>Unlinked parcels indicate a data coverage gap, not an absence of rights.</li>
            <li>Source health reflects adapter reachability, which is independent of record authority.</li>
            <li>
              Where the dataset is small, the page says so explicitly rather than presenting demonstration counts as
              national statistics.
            </li>
          </ul>
          <div className="divider" />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => navigate('/gateway')}>
              Department gateway
            </button>
            <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
              Data fabric
            </button>
            <button type="button" className="btn btn-sm" onClick={() => state.reload()}>
              Recompute
            </button>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
