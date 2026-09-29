import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
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
  SourceBadge,
  StatusBadge,
  formatDateTime,
  formatNumber,
} from '../components/ui';

const DOMAIN_MAP: Record<string, { internal: string[]; note: string }> = {
  Revenue: {
    internal: ['Parcel', 'Party', 'Right', 'Record of Rights'],
    note: 'RoR and revenue records map into the parcel, party and right entities. Owner assertions are attributed to the revenue authority and never inferred from other sources.',
  },
  Registration: {
    internal: ['Document', 'Registration', 'Encumbrance'],
    note: 'Registered instruments map into registration and document entities, with encumbrances derived where an instrument creates a restriction.',
  },
  'Municipal Tax': {
    internal: ['Tax', 'Party'],
    note: 'Assessment records map into tax records. The assessment name is an administrative attribution, not a title determination.',
  },
  Planning: {
    internal: ['Planning', 'Restriction'],
    note: 'Building permissions, zoning and master plan references map into planning and restriction entities.',
  },
  Judiciary: {
    internal: ['Judiciary', 'Document'],
    note: 'Court proceedings map into judiciary entities. In this deployment the adapter carries a demonstration fixture and claims no live court data.',
  },
  'Survey/GIS': {
    internal: ['Parcel', 'Geometry'],
    note: 'Cadastral geometry maps into parcel and geometry entities. Planar area is derived from the polygon and is labelled as derived.',
  },
};

export function GatewayPage() {
  const navigate = useNavigate();
  const state = useAsync((s) => api.gateway(s), []);
  const ingestion = useAsync((s) => api.ingestion(s), []);

  if (state.loading) {
    return (
      <div className="page">
        <LoadingState lines={5} label="Loading department gateway" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="page stack">
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Department gateway</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '90ch' }}>
            Integration control plane for the departments that supply land governance records. Each card states the
            adapter's real status, and the internal entity mapping that normalises that department's records into the
            parcel-centric model.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
          Full data fabric
        </button>
      </div>

      <div className="grid grid-3">
        {(state.data?.departments ?? []).map((d) => {
          const map = DOMAIN_MAP[d.department];
          return (
            <GlassPanel key={d.department}>
              <CardHead
                title={d.department}
                subtitle={d.adapter.sourceId}
                actions={<SourceBadge status={d.adapter.status} />}
              />
              <div className="grid grid-2" style={{ gap: 8 }}>
                <div className="glass-inset card-tight">
                  <div className="label">Records available</div>
                  <div className="metric-value" style={{ fontSize: 18 }}>
                    {formatNumber(d.recordsAvailable)}
                  </div>
                </div>
                <div className="glass-inset card-tight">
                  <div className="label">Open cases</div>
                  <div className="metric-value" style={{ fontSize: 18 }}>
                    {formatNumber(d.openCases)}
                  </div>
                </div>
                <div className="glass-inset card-tight">
                  <div className="label">Sync operations</div>
                  <div className="metric-value" style={{ fontSize: 18 }}>
                    {formatNumber(d.syncOperations)}
                  </div>
                </div>
                <div className="glass-inset card-tight">
                  <div className="label">Sync failures</div>
                  <div className="metric-value" style={{ fontSize: 18, color: d.syncFailures > 0 ? 'var(--danger)' : undefined }}>
                    {formatNumber(d.syncFailures)}
                  </div>
                </div>
              </div>

              <div className="divider" />
              <dl className="kv kv-tight">
                <dt>Last sync</dt>
                <dd className="tiny">{d.lastSync ? formatDateTime(d.lastSync) : 'never'}</dd>
                <dt>Latency</dt>
                <dd className="tiny">{d.adapter.latencyMs === null ? '—' : `${d.adapter.latencyMs} ms`}</dd>
                <dt>Configured</dt>
                <dd>
                  {d.adapter.configured ? <span className="badge badge-ok">yes</span> : <span className="badge badge-warn">no</span>}
                </dd>
                <dt>Requires auth</dt>
                <dd>
                  {d.adapter.requiresAuth ? <span className="badge badge-warn">yes</span> : <span className="badge badge-neutral">no</span>}
                </dd>
              </dl>

              <div className="divider" />
              <div className="label">Internal entity mapping</div>
              <div className="chip-row" style={{ marginTop: 5 }}>
                {(map?.internal ?? []).map((e) => (
                  <span key={e} className="badge badge-neutral">
                    {e}
                  </span>
                ))}
              </div>
              <p className="tiny muted" style={{ marginTop: 7 }}>
                {map?.note}
              </p>
              <p className="tiny muted">{d.adapter.detail}</p>
            </GlassPanel>
          );
        })}
      </div>

      {state.data?.departments.length === 0 ? (
        <EmptyState title="No departments registered" body="No department adapter is registered in the data fabric catalogue." />
      ) : null}

      <GlassCard>
        <CardHead
          title="Ingestion pipeline"
          subtitle="Every external feed passes through the same staged pipeline"
        />
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {(ingestion.data?.pipeline ?? ['SOURCE', 'FETCH', 'VALIDATE', 'NORMALIZE', 'MAP', 'PROVENANCE', 'STORE', 'INDEX', 'ANALYZE', 'DISPLAY']).map(
            (stage, i, arr) => (
              <span key={stage} className="row" style={{ gap: 6 }}>
                <span className="badge badge-info">{stage}</span>
                {i < arr.length - 1 ? (
                  <span className="muted" aria-hidden="true">
                    →
                  </span>
                ) : null}
              </span>
            ),
          )}
        </div>
        <p className="small muted" style={{ maxWidth: '96ch' }}>
          {ingestion.data?.note ??
            'External records are fetched, validated, normalised into the parcel-centric schema, mapped to internal entities, stamped with provenance, stored, indexed, analysed by the rules engine and finally displayed.'}
        </p>
        <div className="divider" />
        <div className="label">Recorded adapter runs</div>
        {ingestion.loading ? (
          <LoadingState lines={3} />
        ) : (ingestion.data?.adapterRuns.length ?? 0) === 0 ? (
          <EmptyState
            title="No adapter runs recorded"
            icon="◻"
            body="Adapter runs are recorded when a probe or ingestion is executed. Open the data fabric and probe the sources to populate this history."
            action={
              <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
                Open data fabric
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Operation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Records</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {ingestion.data?.adapterRuns.map((r, i) => (
                  <tr key={String(r.run_id ?? i)}>
                    <td className="small">{String(r.source_name ?? r.source_id)}</td>
                    <td className="small muted">{String(r.operation ?? 'PROBE')}</td>
                    <td>
                      <StatusBadge status={String(r.status)} />
                    </td>
                    <td className="tiny muted">{r.started_at ? formatDateTime(String(r.started_at)) : '—'}</td>
                    <td className="num tiny">{r.record_count === null || r.record_count === undefined ? '—' : formatNumber(Number(r.record_count))}</td>
                    <td className="tiny muted">{String(r.message ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Adapter contract" subtitle="Every department adapter implements the same interface" />
          <pre className="glass-inset" style={{ padding: 12, margin: 0, overflowX: 'auto' }}>{`interface DepartmentAdapter {
  sourceId: string;
  getParcel(parcelId: string): Promise<NormalisedRecords>;
  search(query: AdapterQuery): Promise<NormalisedRecords>;
  health(): Promise<AdapterHealth>;
  lastSync(): Promise<SourceRun | null>;
  sourceMetadata(): SourceMetadata;
}`}</pre>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Adding a department means implementing this interface and registering it in the adapter index. No UI
            component reads from a hard-coded data source.
          </p>
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Honest status reporting" subtitle="What the statuses mean" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>
              <span className="badge badge-ok">CONNECTED</span> — the adapter reached a live upstream and received a
              valid response.
            </li>
            <li>
              <span className="badge badge-ok">AVAILABLE</span> — the public endpoint responded; no credentialed
              session is held.
            </li>
            <li>
              <span className="badge badge-info">ADAPTER_READY</span> — the interface exists and is registered, but no
              upstream service is configured.
            </li>
            <li>
              <span className="badge badge-danger">UPSTREAM_UNAVAILABLE</span> — the last probe failed. The failure and
              its time are recorded.
            </li>
            <li>
              <span className="badge badge-warn">REQUIRES_AUTH</span> — credentials are needed and are supplied through
              environment variables, never hard-coded.
            </li>
            <li>
              <span className="badge badge-demo">DEMO_DATA</span> — a clearly labelled demonstration fixture stands in
              for the departmental feed.
            </li>
            <li>
              <span className="badge badge-neutral">NOT_CONFIGURED</span> — deliberately disabled or not yet enabled by
              an administrator.
            </li>
          </ul>
          <div className="divider" />
          <ProvenanceNotice tone="demo">
            No card on this page claims a live government integration unless the adapter actually reached the upstream.
            Where it did not, the card says so.
          </ProvenanceNotice>
        </GlassPanel>
      </div>

      <div className="grid grid-4">
        <MetricCard
          label="Departments"
          value={formatNumber(state.data?.departments.length ?? 0)}
          hint="Registered adapters"
        />
        <MetricCard
          label="Serving records"
          value={formatNumber(
            (state.data?.departments ?? []).filter(
              (d) =>
                ['CONNECTED', 'AVAILABLE', 'ADAPTER_READY'].includes(d.adapter.status) ||
                // A DEMO_DATA adapter is deliberately serving a labelled fixture, not
                // failing. Counting only live statuses reported this as 0 while every
                // card below showed "Records available: 5".
                d.recordsAvailable > 0,
            ).length,
          )}
          hint="Live upstream or labelled fixture"
          tone="ok"
        />
        <MetricCard
          label="Awaiting authorisation"
          value={formatNumber((state.data?.departments ?? []).filter((d) => d.adapter.requiresAuth).length)}
          tone="warn"
        />
        <MetricCard
          label="Total open cases"
          value={formatNumber((state.data?.departments ?? []).reduce((acc, d) => acc + d.openCases, 0))}
          tone="warn"
        />
      </div>

      <GlassPanel>
        <CardHead title="Data status legend" subtitle="Applied consistently across every surface" />
        <div className="chip-row">
          <DataStatusChip status="REAL" />
          <DataStatusChip status="DERIVED" />
          <DataStatusChip status="CONTEXTUAL" />
          <DataStatusChip status="DEMONSTRATION" />
          <DataStatusChip status="AI" />
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          REAL is only used where a record was genuinely retrieved from the stated authority. DERIVED marks values
          BHUMISETU computed itself, such as planar area and integrity findings. CONTEXTUAL marks geographic context
          such as OpenStreetMap or Bhuvan LULC. DEMONSTRATION marks fixtures. AI marks model output, which is never a
          hard dependency for core operation.
        </p>
      </GlassPanel>
    </div>
  );
}
