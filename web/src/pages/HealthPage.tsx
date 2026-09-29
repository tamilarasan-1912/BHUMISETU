import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import {
  CardHead,
  EmptyState,
  ErrorState,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  SourceBadge,
  StatusBadge,
  formatDateTime,
} from '../components/ui';

export function HealthPage() {
  const navigate = useNavigate();
  const health = useAsync((s) => api.health(s), []);
  const meta = useAsync((s) => api.meta(s), []);

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>System health</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '88ch' }}>
            Database, API and external source reachability. External failures are reported here and degrade gracefully
            everywhere else; they never block the core parcel workflow.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => health.reload()}>
            Re-check
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
            Data fabric
          </button>
        </div>
      </div>

      {health.loading ? (
        <LoadingState lines={5} label="Checking system health" />
      ) : health.error ? (
        <ErrorState error={health.error} onRetry={health.reload}>
          The health endpoint could not be reached. That itself indicates the API server is down or unreachable.
        </ErrorState>
      ) : (
        <>
          <div className="grid grid-4">
            <MetricCard
              label="Application"
              value={health.data?.ok ? 'OPERATIONAL' : 'DEGRADED'}
              tone={health.data?.ok ? 'ok' : 'danger'}
              hint={`v${health.data?.version ?? '—'}`}
            />
            <MetricCard
              label="Database"
              value={health.data?.database.ok ? 'HEALTHY' : 'UNAVAILABLE'}
              tone={health.data?.database.ok ? 'ok' : 'danger'}
              hint={`${health.data?.database.latencyMs ?? '—'} ms round trip`}
            />
            <MetricCard
              label="PostGIS"
              value={health.data?.database.postgis ? 'ACTIVE' : 'ABSENT'}
              tone={health.data?.database.postgis ? 'ok' : 'warn'}
              hint="Spatial extension"
            />
            <MetricCard
              label="API latency"
              value={`${health.data?.api.latencyMs ?? '—'} ms`}
              tone="info"
              hint="Health endpoint response"
            />
          </div>

          <div className="grid grid-4">
            <MetricCard
              label="Sources reachable"
              value={`${(health.data?.sources ?? []).filter((s) => s && s.reachable).length}/${(health.data?.sources ?? []).filter(Boolean).length}`}
              tone="ok"
            />
            <MetricCard
              label="Sources unavailable"
              value={`${(health.data?.sources ?? []).filter((s) => s && s.status === 'UPSTREAM_UNAVAILABLE').length}`}
              tone="warn"
            />
            <MetricCard
              label="Awaiting credentials"
              value={`${(health.data?.sources ?? []).filter((s) => s && s.requiresAuth).length}`}
              tone="warn"
            />
            <MetricCard
              label="Adapter ready"
              value={`${(health.data?.sources ?? []).filter((s) => s && s.status === 'ADAPTER_READY').length}`}
              tone="info"
            />
          </div>
        </>
      )}

      <GlassCard>
        <CardHead title="Source reachability" subtitle="Live probe results, recorded per adapter" />
        {health.loading ? (
          <LoadingState lines={5} />
        ) : (health.data?.sources ?? []).filter(Boolean).length === 0 ? (
          <EmptyState
            title="No adapters probed"
            icon="◻"
            body="No adapter health result was returned. Confirm the data fabric catalogue is seeded, then re-check."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reachable</th>
                  <th scope="col">Latency</th>
                  <th scope="col">Last success</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {(health.data?.sources ?? [])
                  .filter((s): s is NonNullable<typeof s> => Boolean(s))
                  .map((s) => (
                    <tr key={s.sourceId}>
                      <td className="mono tiny">{s.sourceId}</td>
                      <td>
                        <SourceBadge status={s.status} />
                      </td>
                      <td>{s.reachable ? <span className="badge badge-ok">yes</span> : <span className="badge badge-warn">no</span>}</td>
                      <td className="num tiny">{s.latencyMs === null ? '—' : `${s.latencyMs} ms`}</td>
                      <td className="tiny muted">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : 'never'}</td>
                      <td className="tiny muted">{s.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="divider" />
        <div className="tiny muted">
          Checked {health.data?.checkedAt ? formatDateTime(health.data.checkedAt) : '—'}
        </div>
      </GlassCard>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Platform metadata" subtitle="Version, data mode and identifier policy" />
          {meta.loading ? (
            <LoadingState lines={3} />
          ) : meta.error ? (
            <ErrorState error={meta.error} onRetry={meta.reload} />
          ) : (
            <dl className="kv kv-tight">
              <dt>Product</dt>
              <dd>{meta.data?.product}</dd>
              <dt>Full name</dt>
              <dd className="small">{meta.data?.productFullName}</dd>
              <dt>Tagline</dt>
              <dd className="small">{meta.data?.tagline}</dd>
              <dt>Version</dt>
              <dd className="mono">{meta.data?.version}</dd>
              <dt>Data mode</dt>
              <dd>
                <span className="badge badge-demo">{meta.data?.dataMode}</span>
              </dd>
              <dt>Identifier scheme</dt>
              <dd className="small">
                {meta.data?.algorithm.label} · official: {meta.data?.algorithm.official ? 'yes' : 'no'}
              </dd>
            </dl>
          )}
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Known limitations" subtitle="Stated plainly rather than hidden" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>Governance records (RoR, registration, tax, planning, judiciary) are demonstration fixtures in this deployment.</li>
            <li>TNGIS, eCourts and state registration systems are adapter interfaces only; no authorised endpoint is configured.</li>
            <li>Copernicus Sentinel-2 acquisition requires credentials supplied through environment variables.</li>
            <li>Bhuvan LULC is consumed as contextual land cover; if unreachable the map falls back and says so.</li>
            <li>OpenStreetMap and Overpass provide contextual geography only — never ownership or cadastral authority.</li>
            <li>PDF export and document file storage are not enabled; CSV and JSON exports are.</li>
            <li>The AI assistant is an architecture stub; every deterministic capability works without it.</li>
          </ul>
        </GlassPanel>
      </div>

      <GlassPanel>
        <CardHead title="Application version and build" subtitle="Deployment information" />
        <div className="grid grid-4">
          <div>
            <div className="label">Backend</div>
            <div className="mono small">v{health.data?.version ?? '—'}</div>
          </div>
          <div>
            <div className="label">Frontend</div>
            <div className="mono small">v{meta.data?.version ?? '—'}</div>
          </div>
          <div>
            <div className="label">PWA</div>
            <div className="small">
              <StatusBadge status="AVAILABLE" /> installable
            </div>
          </div>
          <div>
            <div className="label">Data mode</div>
            <div className="small">Mixed — real context with demonstration records</div>
          </div>
        </div>
      </GlassPanel>

      <ProvenanceNotice tone="warn">
        A green status here means the component responded to a live check. It does not mean that the data it returns is
        an official government record. Record authority is always stated per record, in its provenance block.
      </ProvenanceNotice>
    </div>
  );
}
