import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  DataStatusChip,
  EmptyState,
  ErrorState,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  RiskBadge,
  SearchBar,
  SourceBadge,
  StatusBadge,
  formatArea,
  formatNumber,
} from '../components/ui';
import type { SearchHit } from '../types/api';

/**
 * Advanced parcel intelligence workspace. Parcel-centric: the navigation is a
 * ranked set of parcels, and every tile is derived from the same engine the
 * passport uses.
 */
export function IntelligencePage() {
  const navigate = useNavigate();
  const { reportError } = useApp();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState('');
  const debouncedRule = useDebounced(ruleFilter, 250);

  const stats = useAsync((s) => api.stats(s), []);
  const parcels = useAsync((s) => api.parcels({ limit: 100 }, s), []);
  const findings = useAsync((s) => api.findings({ limit: 40 }, s), []);
  const sources = useAsync((s) => api.dataSources({}, s), []);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.search(q.trim(), 30);
      setHits(res.hits);
      setNote(res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      reportError(err, 'Search');
    } finally {
      setSearching(false);
    }
  };

  const ranked = (hits ?? parcels.data?.items ?? [])
    .slice()
    .sort((a, b) => b.findingCount - a.findingCount || a.score - b.score);

  const ruleOptions = Array.from(
    new Set((findings.data?.items ?? []).map((f) => String(f.rule_code))),
  ).sort();

  const activeFindings = (findings.data?.items ?? []).filter(
    (f) => !debouncedRule || String(f.rule_code) === debouncedRule,
  );

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Parcel intelligence</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '88ch' }}>
            Risk summary, data completeness, source health, change detection, spatial context and workflow status,
            all resolved per parcel. Select a parcel to open its full intelligence workspace.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => navigate('/analytics')}>
            Platform analytics
          </button>
        </div>
      </div>

      <GlassCard>
        <SearchBar
          id="intel-search"
          value={query}
          onChange={setQuery}
          onSubmit={() => void runSearch(query)}
          busy={searching}
          placeholder='e.g. "high risk parcels", "area mismatch", "owner: Meenakshi", "PARC-D"'
        />
        <div className="chip-row" style={{ marginTop: 8 }}>
          {[
            'high risk parcels',
            'owner: Meenakshi',
            'area mismatch',
            'unlinked parcels',
            'building change',
            'tax dues',
          ].map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setQuery(s);
                void runSearch(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {error ? <div style={{ marginTop: 10 }}><ErrorState title="Search failed" error={error} /></div> : null}
        {note && hits ? <div className="tiny muted" style={{ marginTop: 8 }}>{note}</div> : null}
      </GlassCard>

      <div className="grid grid-4">
        <MetricCard label="Parcels scanned" value={formatNumber(stats.data?.parcels)} hint={stats.data?.datasetLabel} />
        <MetricCard label="Parcels with findings" value={formatNumber(ranked.filter((r) => r.findingCount > 0).length)} tone="warn" />
        <MetricCard label="High-risk parcels" value={formatNumber(stats.data?.highRisk)} tone="danger" hint="Internal band" />
        <MetricCard label="Unlinked" value={formatNumber(stats.data?.unlinked)} tone="info" hint="Coverage gap" />
        <MetricCard
          label="Average data quality"
          value={
            ranked.length === 0
              ? '—'
              : `${Math.round(
                  ranked.reduce((acc, r) => acc + (100 - (100 - r.score)), 0) / ranked.length,
                )}`
          }
          tone="info"
          hint="Aggregated from verification-support scores"
        />
        <MetricCard label="Sources registered" value={formatNumber(sources.data?.items.length)} />
        <MetricCard
          label="Sources degraded"
          value={formatNumber(
            (sources.data?.items ?? []).filter((s) => ['UPSTREAM_UNAVAILABLE', 'NOT_CONFIGURED'].includes(s.status)).length,
          )}
          tone="warn"
        />
        <MetricCard label="Active findings" value={formatNumber(findings.data?.total)} tone="warn" />
      </div>

      <div className="map-layout-intel">
        <GlassCard>
          <CardHead
            title="Ranked parcel queue"
            subtitle={hits ? 'Search results, ranked by finding count then verification score' : 'All parcels, ranked the same way'}
            actions={
              hits ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHits(null)}>
                  Show all parcels
                </button>
              ) : null
            }
          />
          {parcels.loading && !hits ? (
            <LoadingState lines={5} />
          ) : parcels.error && !hits ? (
            <ErrorState error={parcels.error} onRetry={parcels.reload} />
          ) : ranked.length === 0 ? (
            <EmptyState
              title="No parcels in the current view"
              icon="⌕"
              body="No parcel matched the query, or the parcel register is empty. Clear the query to list every parcel in the dataset."
            />
          ) : (
            <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
              {ranked.map((p) => (
                <li key={p.parcelId}>
                  <button
                    type="button"
                    className="glass-inset card-tight btn-ghost"
                    style={{ width: '100%', textAlign: 'left', display: 'block' }}
                    onClick={() => navigate(`/intelligence/${p.parcelId}`)}
                  >
                    <div className="row-between">
                      <span>
                        <span className="mono small">{p.displayId}</span>{' '}
                        <span className="tiny muted">{p.parcelId}</span>
                      </span>
                      <RiskBadge band={p.riskBand} score={p.score} />
                    </div>
                    <div className="row-between" style={{ marginTop: 5 }}>
                      <span className="tiny muted">
                        {p.village}, {p.district} · {formatArea(p.areaSqft)} ·{' '}
                        {p.findingCount === 0 ? 'no findings' : `${p.findingCount} finding(s)`}
                      </span>
                      {p.dataStatus ? <DataStatusChip status={p.dataStatus} short /> : null}
                    </div>
                    {'findingCodes' in p && (p as SearchHit).findingCodes?.length ? (
                      <div className="chip-row" style={{ marginTop: 5 }}>
                        {(p as SearchHit).findingCodes.map((c) => (
                          <span key={c} className="badge badge-neutral mono tiny">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        <div className="stack">
          <GlassPanel>
            <CardHead
              title="Integrity findings across the dataset"
              subtitle="Recomputed from current records"
              actions={
                <select
                  className="select"
                  style={{ minWidth: 150, fontSize: 11.5 }}
                  value={ruleFilter}
                  onChange={(e) => setRuleFilter(e.target.value)}
                  aria-label="Filter findings by rule"
                >
                  <option value="">All rules</option>
                  {ruleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              }
            />
            {findings.loading ? (
              <LoadingState lines={4} />
            ) : findings.error ? (
              <ErrorState error={findings.error} onRetry={findings.reload} />
            ) : activeFindings.length === 0 ? (
              <EmptyState title="No findings to show" body="No integrity finding matches the current rule filter." />
            ) : (
              <div className="stack" style={{ gap: 7, maxHeight: 380, overflowY: 'auto' }}>
                {activeFindings.map((f) => (
                  <button
                    key={String(f.finding_id)}
                    type="button"
                    className="glass-inset card-tight btn-ghost"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => navigate(`/intelligence/${f.parcel_id}?tab=integrity`)}
                  >
                    <div className="row-between">
                      <span className="mono tiny">{String(f.parcel_id)}</span>
                      <StatusBadge status={String(f.severity)} />
                    </div>
                    <div className="small" style={{ marginTop: 3 }}>
                      {String(f.title)}
                    </div>
                    <div className="tiny muted">
                      {String(f.rule_code)} · routed to {String(f.routed_authority)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </GlassPanel>

          <GlassPanel>
            <CardHead title="Source health" subtitle="Which adapters are feeding this workspace" actions={<button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>Data fabric</button>} />
            {sources.loading ? (
              <LoadingState lines={3} />
            ) : sources.error ? (
              <ErrorState error={sources.error} onRetry={sources.reload} />
            ) : (
              <ul className="pill-list" style={{ flexDirection: 'column', gap: 7 }}>
                {(sources.data?.items ?? []).slice(0, 9).map((s) => (
                  <li key={s.sourceId} className="row-between" style={{ width: '100%' }}>
                    <span className="small truncate grow">{s.name}</span>
                    <SourceBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel>
            <CardHead title="How ranking works" subtitle="Deterministic and explainable" />
            <ol className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Parcels with more active findings rank first.</li>
              <li>Ties break on the lower verification-support score.</li>
              <li>Every finding can be traced to evidence, source, record and authority.</li>
              <li>No ranking implies a legal conclusion; it only orders review effort.</li>
            </ol>
            <div className="divider" />
            <ProvenanceNotice tone="demo">
              Demonstration dataset. Some sections show no data simply because no fixture exists for them; the
              interface explains which.
            </ProvenanceNotice>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
