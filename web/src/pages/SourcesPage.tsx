import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  ConfirmDialog,
  DataStatusChip,
  EmptyState,
  ErrorState,
  FilterBar,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  SourceBadge,
  formatDateTime,
  formatNumber,
} from '../components/ui';
import type { AdapterHealth, DataSourceEntry } from '../types/api';

const CATEGORIES = [
  'State GIS',
  'National GIS',
  'Contextual',
  'Satellite',
  'Government open data',
  'Soil',
  'Boundaries',
  'Governance (demonstration)',
];

export function SourcesPage() {
  const navigate = useNavigate();
  const { user, reportError, pushToast } = useApp();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [probing, setProbing] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<{ source: DataSourceEntry; enable: boolean } | null>(null);
  const [detailSource, setDetailSource] = useState<string | null>(null);

  const state = useAsync((s) => api.dataSources({}, s), []);
  const health = useAsync((s) => api.dataSources({ probe: true }, s), []);

  const canConfigure = Boolean(user?.permissions.includes('source.configure'));

  const items = state.data?.items ?? [];

  const healthById = useMemo(() => {
    const map = new Map<string, AdapterHealth>();
    for (const h of health.data?.health ?? []) {
      if (h) map.set(h.sourceId, h);
    }
    return map;
  }, [health.data]);

  const filtered = useMemo(
    () =>
      items.filter((s) => {
        if (category && s.category !== category) return false;
        if (status && s.status !== status) return false;
        if (query) {
          const q = query.toLowerCase();
          if (
            !s.name.toLowerCase().includes(q) &&
            !s.organization.toLowerCase().includes(q) &&
            !s.sourceId.toLowerCase().includes(q) &&
            !s.capability.join(' ').toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      }),
    [items, category, status, query],
  );

  const runProbe = async () => {
    setProbing(true);
    try {
      health.reload();
      pushToast({ kind: 'info', title: 'Probing adapters', body: 'Live reachability checks are running.' });
    } finally {
      // The probe result arrives via the reloaded query; clear the busy flag once
      // the request settles.
      window.setTimeout(() => setProbing(false), 1200);
    }
  };

  const toggleSource = async () => {
    if (!confirmToggle) return;
    try {
      await api.toggleSource(
        confirmToggle.source.sourceId,
        confirmToggle.enable,
        `${confirmToggle.enable ? 'Enabled' : 'Disabled'} by ${user?.username ?? 'administrator'} from the data fabric console.`,
      );
      pushToast({
        kind: 'success',
        title: `${confirmToggle.source.name} ${confirmToggle.enable ? 'enabled' : 'disabled'}`,
        body: 'The change is written to the audit trail.',
      });
      setConfirmToggle(null);
      state.reload();
    } catch (err) {
      reportError(err, 'Source configuration');
      setConfirmToggle(null);
    }
  };

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Data fabric &amp; sources</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '92ch' }}>
            The control plane for every feed into BHUMISETU. Each entry states its authority, coverage, licence note
            and whether it is authoritative, contextual, derived or demonstration. A status is only{' '}
            <span className="mono">CONNECTED</span> when a live upstream check actually succeeded.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => navigate('/gateway')}>
            Department gateway
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void runProbe()} disabled={probing}>
            {probing ? <span className="spinner" aria-hidden="true" /> : null}
            Probe live sources
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        <MetricCard label="Registered sources" value={formatNumber(items.length)} hint="Data fabric entries" />
        <MetricCard
          label="Connected / available"
          value={formatNumber(items.filter((s) => ['CONNECTED', 'AVAILABLE'].includes(s.status)).length)}
          tone="ok"
        />
        <MetricCard
          label="Adapter ready"
          value={formatNumber(items.filter((s) => s.status === 'ADAPTER_READY').length)}
          tone="info"
          hint="Interface exists, no upstream"
        />
        <MetricCard
          label="Needs attention"
          value={formatNumber(items.filter((s) => ['UPSTREAM_UNAVAILABLE', 'NOT_CONFIGURED'].includes(s.status)).length)}
          tone="warn"
        />
        <MetricCard label="Requires auth" value={formatNumber(items.filter((s) => s.status === 'REQUIRES_AUTH').length)} tone="warn" />
        <MetricCard label="Demonstration" value={formatNumber(items.filter((s) => s.isDemonstration).length)} hint="Clearly labelled fixtures" />
        <MetricCard label="Authoritative" value={formatNumber(items.filter((s) => s.isAuthoritative).length)} />
        <MetricCard label="Contextual" value={formatNumber(items.filter((s) => s.isContextual).length)} />
      </div>

      {health.error ? (
        <ProvenanceNotice tone="warn">
          Live probe failed to complete: {health.error instanceof Error ? health.error.message : 'unknown error'}. The
          last recorded statuses are still shown below. External failures never block the core parcel workflow.
        </ProvenanceNotice>
      ) : null}

      <GlassCard>
        <FilterBar>
          <div className="field grow" style={{ minWidth: 220 }}>
            <label htmlFor="source-search">Search</label>
            <input
              id="source-search"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Source name, organisation, capability"
            />
          </div>
          <div className="field" style={{ minWidth: 190 }}>
            <label htmlFor="source-category">Category</label>
            <select id="source-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 190 }}>
            <label htmlFor="source-status">Status</label>
            <select id="source-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {['CONNECTED', 'AVAILABLE', 'ADAPTER_READY', 'UPSTREAM_UNAVAILABLE', 'REQUIRES_AUTH', 'DEMO_DATA', 'NOT_CONFIGURED'].map(
                (s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ),
              )}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setQuery('');
              setCategory('');
              setStatus('');
            }}
          >
            Reset
          </button>
        </FilterBar>

        <div style={{ marginTop: 12 }}>
          {state.loading ? (
            <LoadingState lines={5} />
          ) : state.error ? (
            <ErrorState error={state.error} onRetry={state.reload} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No sources match these filters"
              icon="◻"
              body="No data fabric entry matches the current category, status and text filters."
            />
          ) : (
            <div className="grid grid-2">
              {filtered.map((s) => {
                const live = healthById.get(s.sourceId);
                return (
                  <GlassPanel key={s.sourceId}>
                    <CardHead
                      title={s.name}
                      subtitle={`${s.organization} · ${s.category}`}
                      actions={
                        <div className="chip-row">
                          <DataStatusChip status={s.dataStatus} short />
                          <SourceBadge status={s.status} />
                        </div>
                      }
                    />

                    <div className="chip-row" style={{ marginBottom: 8 }}>
                      {s.isAuthoritative ? <span className="badge badge-ok">authoritative</span> : null}
                      {s.isContextual ? <span className="badge badge-context">contextual</span> : null}
                      {s.isDerived ? <span className="badge badge-info">derived</span> : null}
                      {s.isDemonstration ? <span className="badge badge-demo">demonstration</span> : null}
                      {!s.isEnabled ? <span className="badge badge-neutral">disabled</span> : null}
                    </div>

                    <dl className="kv kv-tight">
                      <dt>Authority</dt>
                      <dd className="small">{s.authority}</dd>
                      <dt>Coverage</dt>
                      <dd className="small">{s.coverage}</dd>
                      <dt>Freshness</dt>
                      <dd className="small">{s.freshnessNote}</dd>
                      <dt>Last checked</dt>
                      <dd className="small">{s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : 'never'}</dd>
                      <dt>Last success</dt>
                      <dd className="small">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : 'never'}</dd>
                      <dt>Latency</dt>
                      <dd className="small">{s.latencyMs === null ? '—' : `${s.latencyMs} ms`}</dd>
                      <dt>Licence / terms</dt>
                      <dd className="tiny muted">{s.licenceNote}</dd>
                      {s.endpoint ? (
                        <>
                          <dt>Endpoint</dt>
                          <dd className="mono tiny">{s.endpoint}</dd>
                        </>
                      ) : null}
                    </dl>

                    <div className="divider" />
                    <div className="label">Capabilities</div>
                    <div className="chip-row" style={{ marginTop: 5 }}>
                      {s.capability.map((c) => (
                        <span key={c} className="badge badge-neutral">
                          {c}
                        </span>
                      ))}
                    </div>

                    {live ? (
                      <>
                        <div className="divider" />
                        <div className="label">Live probe</div>
                        <div className="glass-inset card-tight" style={{ marginTop: 5 }}>
                          <div className="row-between">
                            <span className="small">{live.detail}</span>
                            <SourceBadge status={live.status} />
                          </div>
                          <div className="tiny muted">
                            {live.latencyMs === null ? 'no latency recorded' : `${live.latencyMs} ms`} ·{' '}
                            {formatDateTime(live.checkedAt)}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {s.lastError ? (
                      <div className="notice notice-warn" style={{ marginTop: 9 }}>
                        <span aria-hidden="true">⚠</span>
                        <div>
                          <div style={{ fontWeight: 620 }}>Last error</div>
                          <div className="tiny">{s.lastError}</div>
                          {s.lastErrorAt ? <div className="tiny muted">{formatDateTime(s.lastErrorAt)}</div> : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="row" style={{ marginTop: 10, gap: 7, flexWrap: 'wrap' }}>
                      <a className="btn btn-sm" href={s.url} target="_blank" rel="noreferrer noopener">
                        Documentation ↗
                      </a>
                      <button type="button" className="btn btn-sm" onClick={() => setDetailSource(s.sourceId)}>
                        Adapter detail
                      </button>
                      {canConfigure ? (
                        <button
                          type="button"
                          className={`btn btn-sm ${s.isEnabled ? 'btn-danger' : 'btn-primary'}`}
                          onClick={() => setConfirmToggle({ source: s, enable: !s.isEnabled })}
                        >
                          {s.isEnabled ? 'Disable' : 'Enable'}
                        </button>
                      ) : null}
                    </div>
                  </GlassPanel>
                );
              })}
            </div>
          )}
        </div>
      </GlassCard>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Status semantics" subtitle="What each status guarantees" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>
              <strong>CONNECTED</strong> — a live upstream request succeeded and returned a usable response.
            </li>
            <li>
              <strong>AVAILABLE</strong> — the public endpoint is reachable without credentials.
            </li>
            <li>
              <strong>ADAPTER_READY</strong> — the adapter interface is implemented and registered; no upstream is
              configured, so no data is claimed.
            </li>
            <li>
              <strong>UPSTREAM_UNAVAILABLE</strong> — the last probe failed. The cached status and error are shown, and
              the platform continues to operate.
            </li>
            <li>
              <strong>REQUIRES_AUTH</strong> — credentials are necessary and must be supplied through environment
              variables.
            </li>
            <li>
              <strong>DEMO_DATA</strong> — a labelled fixture substitutes for the authoritative feed.
            </li>
            <li>
              <strong>NOT_CONFIGURED</strong> — not enabled, by design or by administrator action.
            </li>
          </ul>
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Degradation policy" subtitle="External failure never breaks the application" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>Every adapter call has a timeout, bounded retries and a recorded outcome.</li>
            <li>Contextual calls are cached with a TTL; Overpass is never called on every render.</li>
            <li>Rate limiting applies to the outward-facing contextual and search endpoints.</li>
            <li>A failed tile or WMS layer degrades to the neutral basemap with a visible message.</li>
            <li>A failed contextual query shows a notice and leaves the parcel workflow fully usable.</li>
            <li>No credential is ever exposed to the browser; secrets live only in server environment variables.</li>
          </ul>
          <div className="divider" />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => navigate('/studio/health')}>
              System health
            </button>
            <button type="button" className="btn btn-sm" onClick={() => navigate('/analytics')}>
              Analytics
            </button>
          </div>
        </GlassPanel>
      </div>

      <SourceDetailDrawer sourceId={detailSource} onClose={() => setDetailSource(null)} />

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={confirmToggle?.enable ? 'Enable this source?' : 'Disable this source?'}
        body={
          confirmToggle
            ? confirmToggle.enable
              ? `${confirmToggle.source.name} will be marked enabled. If it carries governance records, those records become available to the integrity engine again.`
              : `${confirmToggle.source.name} will be marked disabled and its status set to NOT_CONFIGURED. Adapters are skipped at runtime. The change is written to the audit trail.`
            : ''
        }
        confirmLabel={confirmToggle?.enable ? 'Enable source' : 'Disable source'}
        destructive={!confirmToggle?.enable}
        onConfirm={() => void toggleSource()}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  );
}

function SourceDetailDrawer({ sourceId, onClose }: { sourceId: string | null; onClose: () => void }) {
  const state = useAsync((s) => api.dataSource(sourceId ?? '', s), [sourceId], { enabled: Boolean(sourceId) });
  if (!sourceId) return null;

  return (
    <div className="scrim drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Adapter detail">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{state.data?.definition?.name ?? sourceId}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : (
          <div className="stack">
            {state.data?.definition ? (
              <GlassPanel>
                <CardHead title="Definition" subtitle={state.data.definition.sourceId} actions={<SourceBadge status={state.data.definition.status} />} />
                <dl className="kv kv-tight">
                  <dt>Organisation</dt>
                  <dd>{state.data.definition.organization}</dd>
                  <dt>Authority</dt>
                  <dd>{state.data.definition.authority}</dd>
                  <dt>Coverage</dt>
                  <dd>{state.data.definition.coverage}</dd>
                  <dt>Licence</dt>
                  <dd className="tiny muted">{state.data.definition.licenceNote}</dd>
                  <dt>Data status</dt>
                  <dd>
                    <DataStatusChip status={state.data.definition.dataStatus} />
                  </dd>
                </dl>
              </GlassPanel>
            ) : null}

            {state.data?.health ? (
              <GlassPanel>
                <CardHead title="Health" subtitle="Live probe result" actions={<SourceBadge status={state.data.health.status} />} />
                <div className="small">{state.data.health.detail}</div>
                <div className="tiny muted">
                  checked {formatDateTime(state.data.health.checkedAt)} ·{' '}
                  {state.data.health.latencyMs === null ? 'no latency' : `${state.data.health.latencyMs} ms`} · configured{' '}
                  {state.data.health.configured ? 'yes' : 'no'} · requires auth {state.data.health.requiresAuth ? 'yes' : 'no'}
                </div>
              </GlassPanel>
            ) : null}

            <GlassPanel>
              <CardHead title="Ingestion pipeline" subtitle="Stages every record passes through" />
              <div className="chip-row">
                {(state.data?.pipeline ?? []).map((p) => (
                  <span key={p} className="badge badge-info">
                    {p}
                  </span>
                ))}
              </div>
            </GlassPanel>

            <GlassPanel>
              <CardHead title="Ingestion history" subtitle="Recorded runs for this source" />
              {(state.data?.ingestion.length ?? 0) === 0 ? (
                <EmptyState title="No ingestion runs" icon="◻" body="No ingestion run has been recorded for this source. Run a probe from the data fabric console to populate history." />
              ) : (
                <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                  {state.data?.ingestion.map((r, i) => (
                    <li className="glass-inset card-tight" key={String(r.ingestion_id ?? i)}>
                      <div className="row-between">
                        <span className="small">{String(r.stage ?? r.status ?? 'run')}</span>
                        <span className="tiny muted">
                          {r.started_at ? formatDateTime(String(r.started_at)) : '—'}
                        </span>
                      </div>
                      {r.message ? <div className="tiny muted">{String(r.message)}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>

            <GlassPanel>
              <CardHead title="Adapter runs" subtitle="Probe and sync operations" />
              {(state.data?.runs.length ?? 0) === 0 ? (
                <EmptyState title="No adapter runs" icon="◻" body="No adapter run has been recorded yet." />
              ) : (
                <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                  {state.data?.runs.map((r, i) => (
                    <li className="glass-inset card-tight" key={String(r.run_id ?? i)}>
                      <div className="row-between">
                        <span className="small">{String(r.operation ?? 'PROBE')}</span>
                        <span className="badge badge-neutral">{String(r.status)}</span>
                      </div>
                      <div className="tiny muted">
                        {r.started_at ? formatDateTime(String(r.started_at)) : '—'}
                        {r.record_count !== null && r.record_count !== undefined
                          ? ` · ${formatNumber(Number(r.record_count))} record(s)`
                          : ''}
                      </div>
                      {r.message ? <div className="tiny muted">{String(r.message)}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </div>
        )}
      </div>
    </div>
  );
}
