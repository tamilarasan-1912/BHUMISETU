import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, geojsonExportUrl, downloadExport } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  DataTable,
  DataStatusChip,
  EmptyState,
  ErrorState,
  FindingCard,
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
  formatDateTime,
  formatNumber,
  type Column,
} from '../components/ui';
import { MapStatChips, MapView, type BasemapId } from '../map/MapView';
import type { ParcelSummary, SearchHit } from '../types/api';

export function HomePage() {
  const navigate = useNavigate();
  const { reportError, user } = useApp();
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('dark-gis');
  const [showParcels, setShowParcels] = useState(true);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom?: number; nonce: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const geojson = useAsync((s) => api.geojson({}, s), []);
  const stats = useAsync((s) => api.stats(s), []);
  const parcels = useAsync((s) => api.parcels({ limit: 50 }, s), []);
  const sources = useAsync((s) => api.dataSources({}, s), []);
  const highPriority = useAsync((s) => api.findings({ severity: 'HIGH', limit: 6 }, s), []);

  const parcelRows: ParcelSummary[] = parcels.data?.items ?? [];
  const selectedSummary = useMemo(
    () => parcelRows.find((p) => p.parcelId === selected) ?? null,
    [parcelRows, selected],
  );

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.search(query.trim(), 12);
      setSearchHits(res.hits);
      if (res.hits.length > 0) {
        const first = res.hits[0];
        setFlyTo({ lat: first.latitude, lon: first.longitude, zoom: 15, nonce: Date.now() });
        setSelected(first.parcelId);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      reportError(err, 'Search');
    } finally {
      setSearching(false);
    }
  };

  const findingColumns: Column<Record<string, unknown>>[] = [
    {
      key: 'parcel',
      header: 'Parcel',
      render: (r) => (
        <button type="button" className="link-btn mono" onClick={() => navigate(`/intelligence/${r.parcel_id}`)}>
          {String(r.parcel_id)}
        </button>
      ),
    },
    { key: 'rule', header: 'Rule', render: (r) => <span className="badge badge-neutral mono">{String(r.rule_code)}</span> },
    { key: 'severity', header: 'Severity', render: (r) => <StatusBadge status={String(r.severity)} /> },
    { key: 'title', header: 'Finding', render: (r) => <span className="small">{String(r.title)}</span> },
    { key: 'authority', header: 'Routed authority', render: (r) => <span className="small muted">{String(r.routed_authority)}</span> },
  ];

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <section className="hero">
        <div className="row-between">
          <div className="grow">
            <h1>Land records connected around the parcel.</h1>
            <p>
              One parcel, one digital identity, every record, every change. BHUMISETU reconciles revenue,
              registration, municipal, planning and judiciary records against a single georeferenced spatial
              unit, and shows exactly where each value came from.
            </p>
          </div>
          <div className="chip-row">
            <button type="button" className="btn btn-sm" onClick={() => navigate('/intelligence')}>
              Parcel intelligence
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void downloadExport(geojsonExportUrl(), 'bhumisetu-parcels.geojson')}
            >
              Export GeoJSON
            </button>
            {user ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/cases/new')}>
                Start verification
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/login')}>
                Sign in to verify
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 14, maxWidth: 720 }}>
          <SearchBar
            id="hero-search"
            value={query}
            onChange={setQuery}
            onSubmit={() => void doSearch()}
            busy={searching}
            placeholder="Search by ULPIN / Survey / Owner / Village — e.g. 3301DEMO000042"
          />
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Try “Show parcels in Chennai with ownership mismatch”, “owner: Meenakshi”, or “unlinked parcels”.
          </div>
        </div>
      </section>

      {searchError ? <ErrorState title="Search unavailable" error={searchError} /> : null}

      {searchHits && searchHits.length > 0 ? (
        <GlassCard>
          <CardHead
            title={`${searchHits.length} parcel${searchHits.length === 1 ? '' : 's'} matched`}
            subtitle="Structured search · results resolved from indexed records and the integrity engine"
            actions={
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSearchHits(null)}>
                Clear results
              </button>
            }
          />
          <div className="grid grid-3">
            {searchHits.map((h) => (
              <button
                key={h.parcelId}
                type="button"
                className="glass-inset card-tight btn-ghost"
                style={{ textAlign: 'left', display: 'block' }}
                onClick={() => {
                  setSelected(h.parcelId);
                  setFlyTo({ lat: h.latitude, lon: h.longitude, zoom: 16, nonce: Date.now() });
                }}
              >
                <div className="row-between">
                  <span className="mono small">{h.displayId}</span>
                  <RiskBadge band={h.riskBand} score={h.score} />
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {h.village}, {h.district}
                </div>
                <div className="tiny muted">
                  {h.matchType} · confidence {h.confidence.toFixed(2)} · {formatArea(h.areaSqft)}
                </div>
              </button>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {searchHits && searchHits.length === 0 ? (
        <EmptyState
          title="No parcels matched that search"
          icon="⌕"
          body="No parcel in the current dataset matches the identifiers, owner, district or finding code you supplied. The search covers the parcel register and the linked revenue, registration and tax records."
        />
      ) : null}

      <div className="grid grid-4">
        <MetricCard label="Parcels" value={stats.loading ? '—' : formatNumber(stats.data?.parcels)} hint={stats.data?.datasetLabel} />
        <MetricCard
          label="Integrity findings"
          value={stats.loading ? '—' : formatNumber(stats.data?.findings)}
          tone="warn"
          hint="Recomputed by the rules engine"
        />
        <MetricCard label="High risk" value={stats.loading ? '—' : formatNumber(stats.data?.highRisk)} tone="danger" hint="Internal support band" />
        <MetricCard label="Unlinked records" value={stats.loading ? '—' : formatNumber(stats.data?.unlinked)} tone="info" hint="Coverage gap" />
        <MetricCard label="Verified" value={stats.loading ? '—' : formatNumber(stats.data?.verified)} tone="ok" hint="No active findings" />
        <MetricCard label="Verification cases" value={stats.loading ? '—' : formatNumber(stats.data?.cases)} hint="Workflow items" />
        <MetricCard label="Sources registered" value={stats.loading ? '—' : formatNumber(stats.data?.sources)} hint="Data fabric entries" />
        <MetricCard label="Data mode" value="MIXED" hint="Real context + demonstration records" />
      </div>

      <div className="map-layout">
        <div className="stack">
          <MapView
            parcels={geojson.data}
            selectedParcelId={selected}
            onSelectParcel={(id) => setSelected(id)}
            basemap={basemap}
            onBasemapChange={setBasemap}
            showParcels={showParcels}
            showContext={false}
            flyTo={flyTo}
            onRegisterMap={() => undefined}
            extraOverlay={
              <>
                <div className="map-toolbar top-left" role="group" aria-label="Map layers">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={showParcels}
                      onChange={(e) => setShowParcels(e.target.checked)}
                    />
                    Parcel geometry
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const f = geojson.data?.features ?? [];
                      if (f.length === 0) return;
                      const [lon, lat] = centroidOf(f.map((x) => x.geometry.coordinates));
                      setFlyTo({ lat, lon, zoom: 11, nonce: Date.now() });
                    }}
                  >
                    Locate all
                  </button>
                </div>
                <MapStatChips
                  parcels={stats.data?.parcels ?? 0}
                  findings={stats.data?.findings ?? 0}
                  highRisk={stats.data?.highRisk ?? 0}
                  unlinked={stats.data?.unlinked ?? 0}
                  cases={stats.data?.cases ?? 0}
                  datasetLabel={stats.data?.datasetLabel ?? 'Demo dataset'}
                />
              </>
            }
          />

          <div className="grid grid-2">
            <GlassCard>
              <CardHead
                title="High-priority verification queue"
                subtitle="Findings requiring reconciliation, routed to the responsible authority"
              />
              {highPriority.loading ? (
                <LoadingState lines={3} />
              ) : highPriority.error ? (
                <ErrorState error={highPriority.error} onRetry={highPriority.reload} />
              ) : (highPriority.data?.items.length ?? 0) === 0 ? (
                <EmptyState title="No high-severity findings" body="Every parcel currently resolves without a high-severity discrepancy." />
              ) : (
                <DataTable
                  columns={findingColumns}
                  rows={highPriority.data?.items ?? []}
                  rowKey={(r) => String(r.finding_id)}
                  caption="Demonstration dataset — findings are verification-support signals, not legal determinations."
                />
              )}
            </GlassCard>

            <GlassCard>
              <CardHead
                title="Data source health"
                subtitle="Adapter status as last recorded by the platform"
                actions={
                  <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
                    Open data fabric
                  </button>
                }
              />
              {sources.loading ? (
                <LoadingState lines={4} />
              ) : sources.error ? (
                <ErrorState error={sources.error} onRetry={sources.reload} />
              ) : (
                <ul className="pill-list" style={{ flexDirection: 'column', gap: 8 }}>
                  {(sources.data?.items ?? []).slice(0, 8).map((s) => (
                    <li key={s.sourceId} className="row-between" style={{ width: '100%', gap: 10 }}>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="small truncate" style={{ display: 'block' }}>
                          {s.name}
                        </span>
                        <span className="tiny muted">
                          {s.organization} · {s.category}
                          {s.isAuthoritative ? ' · authoritative' : s.isContextual ? ' · contextual' : ''}
                        </span>
                      </span>
                      <span className="chip-row">
                        <DataStatusChip status={s.dataStatus} short />
                        <SourceBadge status={s.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </div>
        </div>

        <aside className="panel-right stack" aria-label="Selected parcel">
          {selectedSummary ? (
            <GlassPanel>
              <CardHead
                title={selectedSummary.displayId}
                subtitle={`${selectedSummary.parcelId} · demonstration identifier`}
                actions={<RiskBadge band={selectedSummary.riskBand} score={selectedSummary.score} />}
              />
              <dl className="kv kv-tight">
                <dt>Village</dt>
                <dd>{selectedSummary.village}</dd>
                <dt>District</dt>
                <dd>{selectedSummary.district}</dd>
                <dt>Taluk</dt>
                <dd>{selectedSummary.taluk ?? '—'}</dd>
                <dt>Survey no.</dt>
                <dd className="mono">{selectedSummary.surveyNumber ?? '—'}</dd>
                <dt>Area</dt>
                <dd>{formatArea(selectedSummary.areaSqft)}</dd>
                <dt>Linkage</dt>
                <dd>
                  <StatusBadge status={selectedSummary.linkage} />
                </dd>
                <dt>Data status</dt>
                <dd>
                  <DataStatusChip status={selectedSummary.dataStatus} />
                </dd>
              </dl>

              <div className="divider" />
              <div className="label">Findings</div>
              {selectedSummary.findings.length === 0 ? (
                <EmptyState
                  title="No integrity findings"
                  body="The records linked to this parcel are mutually consistent in the available dataset."
                  icon="✓"
                />
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {selectedSummary.findings.map((f) => (
                    <FindingCard
                      key={f.ruleCode}
                      finding={{
                        findingId: `${selectedSummary.parcelId}-${f.ruleCode}`,
                        ruleCode: f.ruleCode,
                        severity: f.severity,
                        confidence: 1,
                        title: f.title,
                        description: 'Open the land passport for the full evidence chain and recommended action.',
                        expectedValue: null,
                        observedValue: null,
                        routedAuthority: 'See passport',
                        recommendedAction: 'Review the linked records.',
                        status: 'OPEN',
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="divider" />
              <ProvenanceNotice tone="demo">
                Demonstration records — not official government land records. Identifiers are synthetic and
                ULPIN-compatible only in shape.
              </ProvenanceNotice>
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary grow"
                  onClick={() => navigate(`/passport/${selectedSummary.parcelId}`)}
                >
                  Open Land Passport
                </button>
                <button
                  type="button"
                  className="btn grow"
                  onClick={() => navigate(`/intelligence/${selectedSummary.parcelId}`)}
                >
                  Intelligence
                </button>
              </div>
            </GlassPanel>
          ) : (
            <GlassPanel>
              <CardHead title="No parcel selected" subtitle="Select a polygon on the map or search for an identifier" />
              <EmptyState
                title="Select a parcel to begin"
                icon="◉"
                body="Parcel selection highlights the polygon and opens its identity, area, risk band, findings and verification state. From there you can open the full land passport."
              />
              <div className="divider" />
              <div className="label">Recent demonstration parcels</div>
              <ul className="pill-list" style={{ flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {parcelRows.slice(0, 6).map((p) => (
                  <li key={p.parcelId}>
                    <button
                      type="button"
                      className="link-btn mono small"
                      onClick={() => {
                        setSelected(p.parcelId);
                        setFlyTo({ lat: p.latitude, lon: p.longitude, zoom: 16, nonce: Date.now() });
                      }}
                    >
                      {p.displayId} · {p.parcelId}
                    </button>
                  </li>
                ))}
                {parcelRows.length === 0 && !parcels.loading ? (
                  <li className="small muted">No parcels returned by the API.</li>
                ) : null}
              </ul>
            </GlassPanel>
          )}

          <GlassPanel>
            <CardHead title="Parcel register" subtitle={`${parcelRows.length} parcel(s) in the current view`} />
            {parcels.loading ? (
              <LoadingState lines={3} />
            ) : parcels.error ? (
              <ErrorState error={parcels.error} onRetry={parcels.reload} />
            ) : (
              <div className="stack" style={{ gap: 7, maxHeight: 300, overflowY: 'auto' }}>
                {parcelRows.map((p) => (
                  <button
                    key={p.parcelId}
                    type="button"
                    className={`glass-inset card-tight btn-ghost ${selected === p.parcelId ? 'layer-row' : ''}`}
                    style={{ textAlign: 'left', width: '100%', display: 'block' }}
                    onClick={() => {
                      setSelected(p.parcelId);
                      setFlyTo({ lat: p.latitude, lon: p.longitude, zoom: 16, nonce: Date.now() });
                    }}
                  >
                    <div className="row-between">
                      <span className="mono tiny">{p.displayId}</span>
                      <RiskBadge band={p.riskBand} score={p.score} />
                    </div>
                    <div className="tiny muted">
                      {p.village}, {p.district} · {formatArea(p.areaSqft)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </GlassPanel>

          <RecentActivityPanel />
        </aside>
      </div>
    </div>
  );
}

function RecentActivityPanel() {
  const audit = useAsync((s) => api.audit({ limit: 8 }, s), []);
  return (
    <GlassPanel>
      <CardHead title="Recent activity" subtitle="Latest audit-derived platform events" />
      {audit.loading ? (
        <LoadingState lines={3} />
      ) : audit.error ? (
        <EmptyState
          title="Activity feed requires officer access"
          icon="⚑"
          body="The audit trail is restricted. Sign in with an officer or administrator account to see platform events."
        />
      ) : (audit.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No audit events yet"
          body="Platform activity will appear here as records are accessed and workflows run."
        />
      ) : (
        <ul className="pill-list" style={{ flexDirection: 'column', gap: 7 }}>
          {audit.data?.items.map((a) => (
            <li key={a.audit_id} className="small">
              <span className="badge badge-neutral">{a.action.replace(/_/g, ' ')}</span>{' '}
              <span className="muted">
                {a.actor} · {a.entity_type} {a.entity_id.slice(0, 22)}
              </span>
              <div className="tiny muted">{formatDateTime(a.timestamp)}</div>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function centroidOf(coords: unknown[]): [number, number] {
  const points: [number, number][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      points.push([node[0] as number, node[1] as number]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coords);
  if (points.length === 0) return [79.1587, 12.9716];
  const lon = points.reduce((a, p) => a + p[0], 0) / points.length;
  const lat = points.reduce((a, p) => a + p[1], 0) / points.length;
  return [lon, lat];
}
