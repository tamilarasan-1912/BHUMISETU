import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, csvExportUrl, downloadExport } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  DataProvenance,
  DataStatusChip,
  EmptyState,
  ErrorState,
  EvidenceCard,
  FindingCard,
  GlassCard,
  GlassPanel,
  LinkageBadge,
  LoadingState,
  MaskedValue,
  MetricCard,
  ProvenanceField,
  ProvenanceNotice,
  RiskBadge,
  StatusBadge,
  TabPanel,
  Tabs,
  Timeline,
  formatArea,
  formatDate,
  formatDateTime,
  formatNumber,
} from '../components/ui';
import { MapStatChips, MapView, type BasemapId } from '../map/MapView';
import type { LandPassport } from '../types/api';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'identity', label: 'Identity' },
  { id: 'location', label: 'Location' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'area', label: 'Area' },
  { id: 'ownership', label: 'Ownership / Rights' },
  { id: 'ror', label: 'RoR' },
  { id: 'registration', label: 'Registration' },
  { id: 'encumbrance', label: 'Encumbrance' },
  { id: 'tax', label: 'Tax' },
  { id: 'planning', label: 'Planning' },
  { id: 'building', label: 'Building' },
  { id: 'landuse', label: 'Land use' },
  { id: 'zoning', label: 'Zoning' },
  { id: 'judiciary', label: 'Judiciary' },
  { id: 'documents', label: 'Documents' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'verification', label: 'Verification' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'sources', label: 'Sources' },
  { id: 'audit', label: 'Audit' },
];

export function PassportPage() {
  const { parcelId = '' } = useParams();
  const navigate = useNavigate();
  const { user, reportError, pushToast } = useApp();
  const [params, setParams] = useSearchParams();
  const active = params.get('tab') ?? 'overview';
  const [withContext, setWithContext] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>('dark-gis');

  const passport = useAsync((s) => api.passport(parcelId, { context: withContext, radius: 500 }, s), [parcelId, withContext]);
  const audit = useAsync(
    (s) => api.audit({ parcelId, limit: 30 }, s),
    [parcelId],
    { enabled: Boolean(user && (user.isOfficer || user.isAdmin)) },
  );

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  const data = passport.data;

  const geojson = useMemo(() => {
    if (!data?.geometry) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          id: data.executiveSummary.parcelId,
          properties: {
            parcelId: data.executiveSummary.parcelId,
            displayId: data.executiveSummary.displayId,
            surveyNumber: String(data.identity.surveyNumber ?? ''),
            village: data.executiveSummary.village,
            district: data.executiveSummary.district,
            areaSqft: data.executiveSummary.areaSqft,
            risk: data.executiveSummary.riskBand,
            findingCount: data.executiveSummary.findingCount,
            findingCodes: data.findings.map((f) => f.ruleCode),
            dataStatus: 'DEMONSTRATION' as const,
            isDemonstration: true,
          },
          geometry: data.geometry.geometry as { type: 'Polygon'; coordinates: unknown },
        },
      ],
      metadata: { layer: 'cadastral-parcels', dataStatus: 'DEMONSTRATION' },
    };
  }, [data]);

  const exportCsv = async () => {
    try {
      await downloadExport(csvExportUrl(parcelId), `bhumisetu-${parcelId}-passport.csv`);
      pushToast({ kind: 'success', title: 'Passport CSV exported', body: 'The export carries the same header and disclaimer.' });
    } catch (err) {
      reportError(err, 'Export');
    }
  };

  if (passport.loading) {
    return (
      <div className="page stack">
        <LoadingState lines={5} label="Loading land passport" />
      </div>
    );
  }

  if (passport.error) {
    return (
      <div className="page stack">
        <ErrorState
          title={`Unable to load the land passport for ${parcelId}`}
          error={passport.error}
          onRetry={passport.reload}
        >
          The parcel may not exist in this dataset, or the API may be unavailable. Confirm the identifier, then retry.
        </ErrorState>
        <button type="button" className="btn" onClick={() => navigate('/parcels')}>
          Back to parcel register
        </button>
      </div>
    );
  }

  if (!data) return null;

  const s = data.executiveSummary;

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <GlassPanel>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>Land Passport</h1>
              <span className="badge badge-demo">
                <span aria-hidden="true">◇</span> {data.header.dataMode}
              </span>
              <span className="badge badge-neutral mono">{s.displayId}</span>
            </div>
            <p className="small muted" style={{ margin: '6px 0 0', maxWidth: '92ch' }}>
              {data.header.productFullName}. {data.header.tagline}
            </p>
          </div>
          <div className="chip-row">
            <button type="button" className="btn btn-sm" onClick={() => void exportCsv()}>
              Export CSV
            </button>
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/intelligence/${parcelId}`)}>
              Intelligence workspace
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigate(`/cases/new?parcelId=${encodeURIComponent(parcelId)}`)}
            >
              Start verification
            </button>
          </div>
        </div>

        {/* Executive summary */}
        <div className="grid grid-4" style={{ marginTop: 14 }}>
          <MetricCard label="Parcel ID" value={<span className="mono" style={{ fontSize: 14 }}>{s.parcelId}</span>} hint={s.displayId} />
          <MetricCard label="Village" value={s.village} hint={s.district} />
          <MetricCard label="Area" value={formatArea(s.areaSqft)} hint="As recorded (demonstration)" />
          <MetricCard
            label="Verification band"
            value={s.riskBand}
            tone={s.riskBand === 'VERIFIED' ? 'ok' : s.riskBand === 'REVIEW' ? 'warn' : 'danger'}
            hint={`Score ${s.score}/100 · internal support indicator`}
          />
          <MetricCard label="Findings" value={formatNumber(s.findingCount)} tone={s.findingCount > 0 ? 'warn' : 'ok'} hint="Active integrity findings" />
          <MetricCard label="Verification" value={<StatusBadge status={s.verificationStatus} />} hint={`${s.openCases} open case(s)`} />
          <MetricCard label="Linkage" value={<LinkageBadge linkage={s.linkage} />} hint="Record linkage state" />
          <MetricCard label="Data quality" value={`${s.dataQualityScore}/100`} tone="info" hint="Transparent, configurable score" />
        </div>

        <div className="row-between" style={{ marginTop: 12 }}>
          <div className="tiny muted">
            Generated {formatDateTime(data.header.generatedAt)} · requested as{' '}
            <span className="mono">{data.header.requestedByRole}</span> · last updated {formatDate(s.lastUpdated)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label className="checkbox">
              <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} />
              Include OSM spatial context
            </label>
            <span className="tiny muted">Contextual only</span>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <ProvenanceNotice tone="demo">
            <strong>{data.header.datasetNotice}.</strong> {data.header.disclaimer}
          </ProvenanceNotice>
        </div>
      </GlassPanel>

      {data.maskingPolicy.maskPartyNames ? (
        <ProvenanceNotice tone="warn">
          Personal identifiers are masked for the <span className="mono">{data.header.requestedByRole}</span> role.
          Internal officer notes and restricted documents are not shown.
        </ProvenanceNotice>
      ) : null}

      <GlassCard>
        <Tabs tabs={TABS} active={active} onChange={setTab} ariaLabel="Land passport sections" />
        <TabPanel id={`passport-${active}`} labelledBy={`passport-${active}`}>
          {active === 'overview' ? <OverviewSection data={data} basemap={basemap} setBasemap={setBasemap} geojson={geojson} /> : null}
          {active === 'identity' ? <IdentitySection data={data} /> : null}
          {active === 'location' ? <LocationSection data={data} /> : null}
          {active === 'geometry' ? <GeometrySection data={data} /> : null}
          {active === 'area' ? <AreaSection data={data} /> : null}
          {active === 'ownership' ? <OwnershipSection data={data} /> : null}
          {active === 'ror' ? <RorSection data={data} /> : null}
          {active === 'registration' ? <RegistrationSection data={data} /> : null}
          {active === 'encumbrance' ? <EncumbranceSection data={data} /> : null}
          {active === 'tax' ? <TaxSection data={data} /> : null}
          {active === 'planning' ? <PlanningSection data={data} /> : null}
          {active === 'building' ? <BuildingSection data={data} /> : null}
          {active === 'landuse' ? <LandUseSection data={data} /> : null}
          {active === 'zoning' ? <ZoningSection data={data} /> : null}
          {active === 'judiciary' ? <JudiciarySection data={data} /> : null}
          {active === 'documents' ? <DocumentsSection data={data} /> : null}
          {active === 'satellite' ? <SatelliteSection data={data} /> : null}
          {active === 'integrity' ? <IntegritySection data={data} /> : null}
          {active === 'verification' ? <VerificationSection data={data} parcelId={parcelId} /> : null}
          {active === 'timeline' ? <TimelineSection data={data} /> : null}
          {active === 'sources' ? <SourcesSection data={data} /> : null}
          {active === 'audit' ? (
            <AuditSection
              loading={audit.loading}
              error={audit.error}
              reload={audit.reload}
              entries={audit.data?.items ?? []}
              canRead={Boolean(user && (user.isOfficer || user.isAdmin))}
            />
          ) : null}
        </TabPanel>
      </GlassCard>
    </div>
  );
}

/* ------------------------------------------------------------- overview */

function OverviewSection({
  data,
  basemap,
  setBasemap,
  geojson,
}: {
  data: LandPassport;
  basemap: BasemapId;
  setBasemap: (b: BasemapId) => void;
  geojson: ReturnType<typeof Object> | null;
}) {
  return (
    <div className="grid grid-2">
      <div className="stack">
        <MapView
          parcels={geojson as never}
          selectedParcelId={data.executiveSummary.parcelId}
          basemap={basemap}
          onBasemapChange={setBasemap}
          showParcels
          showContext={false}
          heightClass=""
          extraOverlay={
            <MapStatChips
              parcels={1}
              findings={data.executiveSummary.findingCount}
              highRisk={data.executiveSummary.riskBand === 'HIGH RISK' ? 1 : 0}
              unlinked={data.executiveSummary.linkage === 'UNLINKED' ? 1 : 0}
              cases={data.executiveSummary.openCases}
              datasetLabel="Demonstration parcel"
            />
          }
        />
        <GlassPanel>
          <CardHead title="Verification-support score" subtitle="Internal indicator used to prioritise review — not a legal score" />
          <div className="row" style={{ gap: 14 }}>
            <div className="metric-value" style={{ fontSize: 38 }}>
              {data.score.score}
            </div>
            <div>
              <RiskBadge band={data.score.band} />
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {data.score.deductions.length === 0
                  ? 'No deductions applied.'
                  : `${data.score.deductions.length} deduction(s) applied.`}
              </div>
            </div>
          </div>
          <div className="divider" />
          {data.score.deductions.length === 0 ? (
            <EmptyState title="No deductions" body="Every compared field agrees within tolerance in the available dataset." icon="✓" />
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {data.score.deductions.map((d) => (
                <div className="glass-inset card-tight row-between" key={`${d.ruleCode}-${d.label}`}>
                  <div className="grow">
                    <div className="small">{d.label}</div>
                    <div className="tiny muted">{d.reason}</div>
                  </div>
                  <span className="badge badge-warn mono">{d.points}</span>
                </div>
              ))}
            </div>
          )}
          <div className="divider" />
          <div className="label">Data completeness</div>
          <div className="chart" style={{ marginTop: 6 }}>
            {[
              { label: 'Completeness', value: data.quality.completeness },
              { label: 'Consistency', value: data.quality.consistency },
              { label: 'Freshness', value: data.quality.freshness },
              { label: 'Linkage', value: data.quality.linkage },
              { label: 'Geometry validity', value: data.quality.geometryValidity },
              { label: 'Source availability', value: data.quality.sourceAvailability },
            ].map((row) => (
              <div className="bar-row" key={row.label}>
                <span className="muted">{row.label}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${row.value}%` }} />
                </span>
                <span className="mono">{row.value}</span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      <div className="stack">
        <GlassPanel>
          <CardHead title="What this passport contains" subtitle="Sections resolved against this single parcel" />
          <ul className="pill-list" style={{ flexDirection: 'column', gap: 5 }}>
            {TABS.filter((t) => !['overview', 'audit'].includes(t.id)).map((t) => (
              <li key={t.id} className="small muted">
                · {t.label}
              </li>
            ))}
          </ul>
        </GlassPanel>
        <GlassPanel>
          <CardHead title="Integrity findings" subtitle="Each finding links to its evidence and source authority" />
          {data.findings.length === 0 ? (
            <EmptyState title="No integrity findings" body="No discrepancy was detected across the linked records for this parcel." icon="✓" />
          ) : (
            <div className="stack" style={{ gap: 9 }}>
              {data.findings.map((f) => (
                <FindingCard key={f.findingId} finding={f} />
              ))}
            </div>
          )}
        </GlassPanel>
        <GlassPanel>
          <CardHead title="Linked records" subtitle="Counts from the current dataset" />
          <dl className="kv kv-tight">
            <dt>RoR records</dt>
            <dd>{formatNumber(data.ror.length)}</dd>
            <dt>Registrations</dt>
            <dd>{formatNumber(data.registration.transactions.length)}</dd>
            <dt>Encumbrances</dt>
            <dd>{formatNumber(data.encumbrance.items.length)}</dd>
            <dt>Tax records</dt>
            <dd>{formatNumber(data.tax.records.length)}</dd>
            <dt>Building permissions</dt>
            <dd>{formatNumber(data.building.permissions.length)}</dd>
            <dt>Judiciary cases</dt>
            <dd>{formatNumber(data.judiciary.cases.length)}</dd>
            <dt>Documents</dt>
            <dd>{formatNumber(data.documents.length)}</dd>
            <dt>Satellite observations</dt>
            <dd>{formatNumber(data.satellite.observations.length)}</dd>
          </dl>
        </GlassPanel>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- identity */

function IdentitySection({ data }: { data: LandPassport }) {
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Parcel identity" subtitle="Identifiers and classification" />
        <dl className="kv">
          <dt>Internal parcel ID</dt>
          <dd className="mono">{data.executiveSummary.parcelId}</dd>
          <dt>Display ID</dt>
          <dd className="mono">{data.executiveSummary.displayId}</dd>
          <dt>Survey number</dt>
          <dd className="mono">{String(data.identity.surveyNumber ?? '—')}</dd>
          <dt>Subdivision</dt>
          <dd className="mono">{String(data.identity.subdivisionNumber ?? '—')}</dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={String(data.identity.status ?? 'ACTIVE')} />
          </dd>
          <dt>Classification</dt>
          <dd>{String(data.identity.classification ?? '—')}</dd>
        </dl>
        <div className="divider" />
        <DataProvenance
          source={data.identity.provenance.source}
          authority={data.identity.provenance.sourceAuthority}
          dataStatus={data.identity.provenance.dataStatus}
          recordedAt={data.identity.provenance.recordedAt}
          note={data.identity.provenance.note}
        />
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Identifier schemes" subtitle="Each identifier records whether it is official" />
        {data.identity.identifiers.length === 0 ? (
          <EmptyState title="No identifiers recorded" body="No identifier scheme is linked to this parcel." />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {data.identity.identifiers.map((i) => (
              <div className="glass-inset card-tight" key={`${i.scheme}-${i.value}`}>
                <div className="row-between">
                  <span className="mono small">{i.value}</span>
                  <span className={`badge ${i.isOfficial ? 'badge-ok' : 'badge-demo'}`}>
                    {i.isOfficial ? 'Official' : 'Demonstration'}
                  </span>
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  {i.scheme} · {i.note}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="divider" />
        <ProvenanceNotice tone="demo">
          Display identifiers follow a ULPIN-compatible shape for interface development. They are synthetic and are
          not official ULPIN identifiers.
        </ProvenanceNotice>
      </GlassPanel>
    </div>
  );
}

function LocationSection({ data }: { data: LandPassport }) {
  const l = data.location as Record<string, unknown>;
  const p = data.location.provenance as LandPassport['identity']['provenance'];
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Administrative location" subtitle="Hierarchy used for jurisdictional routing" />
        <dl className="kv">
          <dt>State</dt>
          <dd>{String(l.state ?? '—')}</dd>
          <dt>District</dt>
          <dd>{String(l.district ?? '—')}</dd>
          <dt>Taluk</dt>
          <dd>{String(l.taluk ?? '—')}</dd>
          <dt>Block</dt>
          <dd>{String(l.block ?? '—')}</dd>
          <dt>Village</dt>
          <dd>{String(l.village ?? '—')}</dd>
          <dt>Local body</dt>
          <dd>
            {String(l.localBody ?? '—')}{' '}
            <span className="badge badge-neutral tiny">{String(l.localBodyType ?? '')}</span>
          </dd>
        </dl>
        <div className="divider" />
        <DataProvenance
          source={p.source}
          authority={p.sourceAuthority}
          dataStatus={p.dataStatus}
          recordedAt={p.recordedAt}
        />
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Coordinates" subtitle="Centroid of the recorded geometry" />
        <dl className="kv">
          <dt>Latitude</dt>
          <dd className="mono">{Number(l.latitude).toFixed(6)}</dd>
          <dt>Longitude</dt>
          <dd className="mono">{Number(l.longitude).toFixed(6)}</dd>
          <dt>SRID</dt>
          <dd className="mono">EPSG:4326</dd>
        </dl>
        <div className="divider" />
        <div className="tiny muted">
          Administrative hierarchy and coordinates are demonstration values for this deployment. In production
          these resolve from the state GIS boundary service.
        </div>
      </GlassPanel>
    </div>
  );
}

function GeometrySection({ data }: { data: LandPassport }) {
  if (!data.geometry) {
    return <EmptyState title="No geometry recorded" body="This parcel has no spatial geometry in the dataset, so area derivation and spatial joins are unavailable." />;
  }
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Geometry" subtitle={`${String(data.geometry.geometryType ?? 'Polygon')} · EPSG:4326`} />
        <dl className="kv">
          <dt>Geometry ID</dt>
          <dd className="mono tiny">{String(data.geometry.geometryId ?? '—')}</dd>
          <dt>Area (planar)</dt>
          <dd>{formatArea(Number(data.geometry.areaSqm) * 10.7639)}</dd>
          <dt>Area (sq m)</dt>
          <dd className="mono">{formatNumber(Number(data.geometry.areaSqm), 2)}</dd>
          <dt>Validity</dt>
          <dd>
            <span className={`badge ${data.geometry.isValid ? 'badge-ok' : 'badge-danger'}`}>
              {data.geometry.isValid ? 'Valid' : 'Invalid'}
            </span>
          </dd>
        </dl>
        <div className="small muted" style={{ marginTop: 8 }}>
          {data.geometry.validityNote}
        </div>
        <div className="divider" />
        <DataProvenance
          source={data.geometry.provenance.source}
          authority={data.geometry.provenance.sourceAuthority}
          dataStatus={data.geometry.provenance.dataStatus}
          note={data.geometry.provenance.note}
        />
      </GlassPanel>
      <GlassPanel>
        <CardHead title="GeoJSON" subtitle="The exact geometry consumed by the map" />
        <pre className="glass-inset" style={{ padding: 10, maxHeight: 340, overflow: 'auto', margin: 0 }}>
          {JSON.stringify({ type: 'Feature', properties: { parcelId: data.executiveSummary.parcelId }, geometry: data.geometry.geometry }, null, 1)}
        </pre>
      </GlassPanel>
    </div>
  );
}

function AreaSection({ data }: { data: LandPassport }) {
  const a = data.area;
  const diff =
    a.cadastralAreaSqft !== null && a.rorAssertedAreaSqft !== null ? a.rorAssertedAreaSqft - a.cadastralAreaSqft : null;
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Area reconciliation" subtitle="Cadastral, geometry-derived and RoR-asserted area" />
        <dl className="kv">
          <dt>Cadastral area</dt>
          <dd>{formatArea(a.cadastralAreaSqft)}</dd>
          <dt>Geometry-derived area</dt>
          <dd>{formatArea(a.geometryAreaSqft)}</dd>
          <dt>RoR asserted area</dt>
          <dd>{formatArea(a.rorAssertedAreaSqft)}</dd>
          <dt>Cadastral/RoR difference</dt>
          <dd className={diff !== null && diff !== 0 ? 'badge badge-warn' : ''}>
            {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff, 0)} sq.ft`}
          </dd>
        </dl>
        <div className="divider" />
        <DataProvenance
          source={a.provenance.source}
          authority={a.provenance.sourceAuthority}
          dataStatus={a.provenance.dataStatus}
          recordedAt={a.provenance.recordedAt}
        />
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Interpretation" subtitle="How to read an area difference" />
        {diff === null || diff === 0 ? (
          <EmptyState title="Areas agree" icon="✓" body="The cadastral area and the asserted area match in the available dataset. No area finding is raised." />
        ) : (
          <ProvenanceNotice tone="warn">
            An area difference of {formatNumber(Math.abs(diff), 0)} sq.ft is recorded between the cadastral area and
            the RoR-asserted area. This is an <strong>area discrepancy detected</strong>; it is not a determination
            that any record is wrong. Reconciliation between the survey and revenue records establishes which value
            is authoritative.
          </ProvenanceNotice>
        )}
      </GlassPanel>
    </div>
  );
}

/* -------------------------------------------------------------- ownership */

function OwnershipSection({ data }: { data: LandPassport }) {
  const o = data.ownership;
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead title="Ownership and rights" subtitle="Every party carries its own provenance" />
        {o.parties.length === 0 ? (
          <EmptyState title="No ownership records linked" body="No ownership, rights or interests record is linked to this parcel in the available dataset." />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {o.parties.map((p, i) => (
              <div className="glass-inset card-tight" key={`${p.role}-${p.name}-${i}`}>
                <div className="row-between">
                  <div>
                    <div style={{ fontWeight: 620 }}>
                      <MaskedValue value={p.name ?? '—'} masked={p.masked} />
                    </div>
                    <div className="tiny muted">
                      {p.role} · share {p.share}
                      {p.assertedAreaSqft !== null ? ` · asserted area ${formatArea(p.assertedAreaSqft)}` : ''}
                    </div>
                  </div>
                  <DataStatusChip status={p.provenance.dataStatus} />
                </div>
                <div style={{ marginTop: 6 }}>
                  <DataProvenance
                    source={p.provenance.source}
                    authority={p.provenance.sourceAuthority}
                    dataStatus={p.provenance.dataStatus}
                    recordedAt={p.provenance.recordedAt}
                    confidence={p.provenance.confidence ?? null}
                    note={p.provenance.note}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Record agreement" subtitle="Comparison across revenue, registration and municipal records" />
        <div className="grid grid-3">
          <ProvenanceField label="Current RoR holder" value={<MaskedValue value={o.currentRecordedHolder ?? '—'} masked={Boolean(o.maskedForRole)} />} />
          <ProvenanceField label="Latest registered transferee" value={<MaskedValue value={o.latestDeedTransferee ?? '—'} masked={Boolean(o.maskedForRole)} />} />
          <ProvenanceField label="Assessment name" value={<MaskedValue value={data.tax.records[0]?.ownerName ?? '—'} masked={Boolean(data.tax.records[0]?.masked)} />} />
        </div>
        <div className="divider" />
        <div className="small">{o.agreement}</div>
      </GlassPanel>
    </div>
  );
}

function RorSection({ data }: { data: LandPassport }) {
  if (data.ror.length === 0) {
    return (
      <EmptyState
        title="No Record of Rights linked"
        icon="⚠"
        body="No RoR record is linked to this parcel. This is a data coverage gap — it does not establish that no rights exist. Where an RoR linkage is missing, the platform raises a NOT_LINKED finding and routes it to the revenue authority."
      />
    );
  }
  return (
    <div className="stack">
      {data.ror.map((r) => (
        <GlassPanel key={r.rorId}>
          <CardHead
            title={r.recordNumber ?? 'Record of Rights'}
            subtitle={`Issued by ${r.issuingOffice ?? '—'}`}
            actions={<DataStatusChip status={r.provenance.dataStatus} />}
          />
          <div className="grid grid-3">
            <ProvenanceField label="Recorded holder" value={<MaskedValue value={r.ownerName ?? '—'} masked={roleMasksNames(data)} />} />
            <ProvenanceField label="Asserted area" value={formatArea(r.assertedAreaSqft)} />
            <ProvenanceField label="Land classification" value={r.landClassification ?? '—'} />
            <ProvenanceField label="Patta number" value={<span className="mono">{r.pattaNumber ?? '—'}</span>} />
            <ProvenanceField label="Recorded" value={formatDate(r.recordedAt)} />
            <ProvenanceField
              label="Confidence"
              value={r.confidence === null ? '—' : r.confidence.toFixed(2)}
            />
          </div>
          <div className="divider" />
          <DataProvenance
            source={r.provenance.source}
            authority={r.provenance.sourceAuthority}
            dataStatus={r.provenance.dataStatus}
            recordedAt={r.provenance.recordedAt}
            confidence={r.confidence}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function roleMasksNames(data: LandPassport): boolean {
  return data.ownership.parties.some((p) => p.masked);
}

function RegistrationSection({ data }: { data: LandPassport }) {
  if (data.registration.transactions.length === 0) {
    return (
      <EmptyState
        title="No registration records linked"
        icon="⚠"
        body="No registered instrument is linked to this parcel in the available dataset. The registration adapter is the integration point for the state registration system; until it is configured, absence of a record here is a coverage gap, not proof that no instrument exists."
      />
    );
  }
  return (
    <div className="stack">
      {data.registration.transactions.map((t) => (
        <GlassPanel key={t.registrationId}>
          <CardHead
            title={t.documentNumber}
            subtitle={`${t.documentType.replace(/_/g, ' ')} · ${t.office ?? 'Registration office not recorded'}`}
            actions={<DataStatusChip status={t.provenance.dataStatus} />}
          />
          <div className="grid grid-3">
            <ProvenanceField label="Registration date" value={formatDate(t.registrationDate)} />
            <ProvenanceField label="Transferor" value={<MaskedValue value={t.transferor ?? '—'} masked={roleMasksNames(data)} />} />
            <ProvenanceField label="Transferee" value={<MaskedValue value={t.transferee ?? '—'} masked={roleMasksNames(data)} />} />
            <ProvenanceField
              label="Consideration"
              value={t.consideration === null ? '—' : `₹ ${formatNumber(t.consideration)}`}
            />
            <ProvenanceField label="Area transferred" value={formatArea(t.areaTransferredSqft)} />
            <ProvenanceField label="Status" value={<StatusBadge status={t.status} />} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={t.provenance.source}
            authority={t.provenance.sourceAuthority}
            dataStatus={t.provenance.dataStatus}
            recordedAt={t.provenance.recordedAt}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function EncumbranceSection({ data }: { data: LandPassport }) {
  const empty = data.encumbrance.items.length === 0 && data.encumbrance.mortgages.length === 0;
  if (empty) {
    return (
      <EmptyState
        title="No encumbrances linked"
        icon="✓"
        body="No active or historical encumbrance, mortgage or restriction is linked to this parcel in the available dataset. Where a registration feed is not configured, this reflects the dataset rather than a cleared title."
      />
    );
  }
  return (
    <div className="stack">
      {data.encumbrance.items.map((e) => (
        <GlassPanel key={e.encumbranceId}>
          <CardHead
            title={e.type.replace(/_/g, ' ')}
            subtitle={e.isActive ? 'Active restriction' : 'Closed restriction'}
            actions={
              <div className="chip-row">
                <span className={`badge ${e.isActive ? 'badge-warn' : 'badge-ok'}`}>{e.isActive ? 'ACTIVE' : 'CLOSED'}</span>
                <DataStatusChip status={e.provenance.dataStatus} />
              </div>
            }
          />
          <div className="grid grid-3">
            <ProvenanceField label="Holder" value={<MaskedValue value={e.holder ?? '—'} masked={e.masked} />} />
            <ProvenanceField label="Amount" value={typeof e.amount === 'number' ? `₹ ${formatNumber(e.amount)}` : String(e.amount ?? '—')} />
            <ProvenanceField label="No-objection certificate" value={e.nocStatus ?? 'Not recorded'} />
            <ProvenanceField label="Start" value={formatDate(e.startDate)} />
            <ProvenanceField label="End" value={e.endDate ? formatDate(e.endDate) : 'Open-ended'} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={e.provenance.source}
            authority={e.provenance.sourceAuthority}
            dataStatus={e.provenance.dataStatus}
            recordedAt={e.provenance.recordedAt}
          />
        </GlassPanel>
      ))}
      {data.encumbrance.mortgages.map((m) => (
        <GlassPanel key={m.mortgageId}>
          <CardHead
            title="Mortgage"
            subtitle={m.lender ?? 'Lender not recorded'}
            actions={<StatusBadge status={m.status} />}
          />
          <div className="grid grid-3">
            <ProvenanceField label="Borrower" value={<MaskedValue value={m.borrower ?? '—'} masked={roleMasksNames(data)} />} />
            <ProvenanceField label="Amount" value={typeof m.amount === 'number' ? `₹ ${formatNumber(m.amount)}` : String(m.amount ?? '—')} />
            <ProvenanceField label="Mortgage date" value={formatDate(m.mortgageDate)} />
            <ProvenanceField label="Closure date" value={m.closureDate ? formatDate(m.closureDate) : 'Not closed'} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={m.provenance.source}
            authority={m.provenance.sourceAuthority}
            dataStatus={m.provenance.dataStatus}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function TaxSection({ data }: { data: LandPassport }) {
  if (data.tax.records.length === 0) {
    return (
      <EmptyState
        title="No property tax records linked"
        icon="⚠"
        body="No municipal property tax record is linked to this parcel. The municipal adapter is the integration point for the urban local body's assessment system; absence here is a coverage gap."
      />
    );
  }
  return (
    <div className="stack">
      {data.tax.records.map((t) => (
        <GlassPanel key={t.taxRecordId}>
          <CardHead
            title={`Tax period ${t.taxPeriod}`}
            subtitle={`${t.authorityType.replace(/_/g, ' ')} · assessment ${t.assessmentNumber ?? '—'}`}
            actions={<DataStatusChip status={t.provenance.dataStatus} />}
          />
          <div className="grid grid-3">
            <ProvenanceField label="Demand" value={typeof t.demand === 'number' ? `₹ ${formatNumber(t.demand)}` : String(t.demand)} />
            <ProvenanceField label="Paid" value={typeof t.paid === 'number' ? `₹ ${formatNumber(t.paid)}` : String(t.paid)} />
            <ProvenanceField
              label="Outstanding"
              value={<span className={Number(t.due) > 0 ? 'badge badge-warn' : ''}>{typeof t.due === 'number' ? `₹ ${formatNumber(t.due)}` : String(t.due)}</span>}
            />
            <ProvenanceField label="Assessment name" value={<MaskedValue value={t.ownerName ?? '—'} masked={t.masked} />} />
            <ProvenanceField label="Last payment" value={t.lastPaymentDate ? formatDate(t.lastPaymentDate) : 'Not recorded'} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={t.provenance.source}
            authority={t.provenance.sourceAuthority}
            dataStatus={t.provenance.dataStatus}
            recordedAt={t.provenance.recordedAt}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function PlanningSection({ data }: { data: LandPassport }) {
  const hasAny = data.planning.zoning.length > 0 || data.planning.masterPlanRefs.length > 0;
  return (
    <div className="stack">
      {hasAny ? (
        <>
          {data.planning.zoning.map((z) => (
            <GlassPanel key={z.zoneCode}>
              <CardHead
                title={`Zone ${z.zoneCode} — ${z.zoneName}`}
                subtitle={z.authority}
                actions={<DataStatusChip status={z.provenance.dataStatus} />}
              />
              <div className="grid grid-3">
                <ProvenanceField label="Permitted use" value={z.permittedUse ?? '—'} />
                <ProvenanceField label="Floor area ratio" value={z.farLimit === null ? '—' : z.farLimit.toFixed(2)} />
              </div>
              <div className="divider" />
              <DataProvenance
                source={z.provenance.source}
                authority={z.provenance.sourceAuthority}
                dataStatus={z.provenance.dataStatus}
                recordedAt={z.provenance.recordedAt}
              />
            </GlassPanel>
          ))}
        </>
      ) : (
        <EmptyState
          title="No planning or master plan linkage"
          icon="⚠"
          body="No zoning, master plan reference or planning record is linked to this parcel. Master plan and zoning data arrive through the planning adapter once the local planning authority configures it."
        />
      )}
    </div>
  );
}

function BuildingSection({ data }: { data: LandPassport }) {
  if (data.building.permissions.length === 0) {
    return (
      <div className="stack">
        <EmptyState
          title="No building approval record linked"
          icon="⚠"
          body={data.building.coverageGapNote ?? 'No building permission record is linked to this parcel in the available dataset.'}
        />
        <ProvenanceNotice tone="warn">
          The absence of an approval record in this dataset does not establish that any construction is unauthorised.
          Where a possible building change is observed, the correct framing is: <strong>possible building change
          detected; approval record requires verification</strong>.
        </ProvenanceNotice>
      </div>
    );
  }
  return (
    <div className="stack">
      {data.building.permissions.map((p) => (
        <GlassPanel key={p.permissionId}>
          <CardHead
            title={p.permissionNumber}
            subtitle={`${p.authority} · ${p.buildingUse ?? 'use not recorded'}`}
            actions={<StatusBadge status={p.status} />}
          />
          <div className="grid grid-3">
            <ProvenanceField label="Approval date" value={formatDate(p.approvalDate)} />
            <ProvenanceField label="Floors" value={p.floorCount ?? '—'} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={p.provenance.source}
            authority={p.provenance.sourceAuthority}
            dataStatus={p.provenance.dataStatus}
            recordedAt={p.provenance.recordedAt}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function LandUseSection({ data }: { data: LandPassport }) {
  if (data.planning.landUse.length === 0) {
    return (
      <EmptyState
        title="No land use record linked"
        icon="○"
        body="No land use record is linked to this parcel. Land use from Bhuvan LULC is contextual information and is deliberately not treated as a legal parcel attribute."
      />
    );
  }
  return (
    <div className="stack">
      {data.planning.landUse.map((l) => (
        <GlassPanel key={l.useCode}>
          <CardHead
            title={`${l.useCode} — ${l.useDescription}`}
            subtitle={l.isContextual ? 'Contextual land use / land cover' : 'Land use record'}
            actions={<DataStatusChip status={l.provenance.dataStatus} />}
          />
          <DataProvenance
            source={l.provenance.source}
            authority={l.provenance.sourceAuthority}
            dataStatus={l.provenance.dataStatus}
            recordedAt={l.provenance.recordedAt}
            note={l.provenance.note}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function ZoningSection({ data }: { data: LandPassport }) {
  if (data.planning.zoning.length === 0) {
    return (
      <EmptyState
        title="No zoning record linked"
        icon="⚠"
        body="No zoning record is linked to this parcel. Zoning arrives through the planning adapter once the planning authority configures the service."
      />
    );
  }
  return (
    <div className="stack">
      {data.planning.zoning.map((z) => (
        <GlassPanel key={z.zoneCode}>
          <CardHead title={`${z.zoneCode} · ${z.zoneName}`} subtitle={z.authority} />
          <div className="grid grid-3">
            <ProvenanceField label="Permitted use" value={z.permittedUse ?? '—'} />
            <ProvenanceField label="FAR limit" value={z.farLimit ?? '—'} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={z.provenance.source}
            authority={z.provenance.sourceAuthority}
            dataStatus={z.provenance.dataStatus}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function JudiciarySection({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <ProvenanceNotice tone="warn">{data.judiciary.disclaimer}</ProvenanceNotice>
      {data.judiciary.cases.length === 0 ? (
        <EmptyState
          title="No judiciary records linked"
          icon="⚖"
          body="No case is linked to this parcel in the available dataset. The judiciary adapter is the integration point for eCourts; absence here does not establish that no proceeding exists."
        />
      ) : (
        data.judiciary.cases.map((c) => (
          <GlassPanel key={c.caseNumber}>
            <CardHead
              title={c.caseNumber}
              subtitle={`${c.court} · ${c.caseType}`}
              actions={
                <div className="chip-row">
                  <StatusBadge status={c.status} />
                  <DataStatusChip status={c.provenance.dataStatus} />
                </div>
              }
            />
            <div className="grid grid-3">
              <ProvenanceField label="Next hearing" value={c.nextHearing ? formatDate(c.nextHearing) : 'Not scheduled'} />
              <ProvenanceField label="Source" value={c.provenance.source} />
            </div>
            {data.judiciary.events.length > 0 ? (
              <>
                <div className="divider" />
                <div className="label">Case events</div>
                <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                  {data.judiciary.events.map((e, i) => (
                    <div key={`${e.eventDate}-${i}`} className="glass-inset card-tight">
                      <div className="row-between">
                        <span className="small">{e.description}</span>
                        <span className="badge badge-neutral tiny">{e.eventType}</span>
                      </div>
                      <div className="tiny muted">{formatDate(e.eventDate)}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="divider" />
            <DataProvenance
              source={c.provenance.source}
              authority={c.provenance.sourceAuthority}
              dataStatus={c.provenance.dataStatus}
              note={c.provenance.note}
            />
          </GlassPanel>
        ))
      )}
    </div>
  );
}

function DocumentsSection({ data }: { data: LandPassport }) {
  if (data.documents.length === 0) {
    return (
      <EmptyState
        title="No documents available for this role"
        icon="▤"
        body="Either no document metadata record is linked to this parcel, or every linked document is restricted and not visible to the current role."
      />
    );
  }
  return (
    <div className="stack">
      {data.documents.map((d) => (
        <GlassPanel key={d.documentId}>
          <CardHead
            title={d.title}
            subtitle={`${d.documentType.replace(/_/g, ' ')} · issued by ${d.issuedBy}`}
            actions={
              <div className="chip-row">
                {d.restricted ? <span className="badge badge-warn">restricted</span> : <span className="badge badge-ok">public</span>}
                <DataStatusChip status={d.provenance.dataStatus} />
              </div>
            }
          />
          <div className="grid grid-3">
            <ProvenanceField label="Issue date" value={d.issueDate ? formatDate(d.issueDate) : 'Not recorded'} />
            <ProvenanceField label="MIME type" value={<span className="mono tiny">{d.mimeType}</span>} />
            <ProvenanceField label="Status" value={<StatusBadge status={d.status} />} />
            <ProvenanceField label="Content hash" value={<span className="mono tiny">{d.contentHash}</span>} />
          </div>
          <div className="divider" />
          <DataProvenance
            source={d.provenance.source}
            authority={d.provenance.sourceAuthority}
            dataStatus={d.provenance.dataStatus}
            note="Document metadata record. File content storage is not enabled in this deployment."
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function SatelliteSection({ data }: { data: LandPassport }) {
  const sat = data.satellite;
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Processing state"
          subtitle="How observation and change-detection results are produced today"
          actions={<span className="badge badge-demo">DEMONSTRATION FIXTURE</span>}
        />
        <dl className="kv kv-tight">
          <dt>Model</dt>
          <dd>{sat.processingState.model}</dd>
          <dt>Operator replaceable</dt>
          <dd>{sat.processingState.operatorReady ? 'Yes — adapter interface defined' : 'No'}</dd>
          <dt>Copernicus credentials</dt>
          <dd>
            {sat.processingState.copernicusConfigured ? (
              <span className="badge badge-ok">configured</span>
            ) : (
              <span className="badge badge-warn">not configured — requires authorisation</span>
            )}
          </dd>
        </dl>
        <div className="small muted" style={{ marginTop: 8 }}>
          {sat.processingState.note}
        </div>
      </GlassPanel>

      {sat.observations.length === 0 && sat.changeDetections.length === 0 ? (
        <EmptyState
          title="No satellite observations"
          icon="◌"
          body="No satellite observation or change detection is linked to this parcel in the available dataset. Live Sentinel-2 acquisition requires Copernicus authorisation."
        />
      ) : (
        <>
          {sat.observations.map((o) => (
            <GlassPanel key={o.observationId}>
              <CardHead
                title={`${o.sensor} — ${formatDate(o.captureDate)}`}
                subtitle={o.possibleChange ? 'Possible change detected' : 'No change detected'}
                actions={
                  <div className="chip-row">
                    {o.possibleChange ? <span className="badge badge-warn">possible change</span> : <span className="badge badge-ok">stable</span>}
                    <DataStatusChip status={o.provenance.dataStatus} />
                  </div>
                }
              />
              <div className="grid grid-3">
                <ProvenanceField label="Cloud coverage" value={o.cloudCoverage === null ? '—' : `${o.cloudCoverage}%`} />
                <ProvenanceField label="Change score" value={o.changeScore === null ? '—' : o.changeScore.toFixed(2)} />
                <ProvenanceField label="Confidence" value={o.confidence === null ? '—' : o.confidence.toFixed(2)} />
              </div>
              <div className="divider" />
              <ProvenanceNotice tone="warn">{o.processingNote}</ProvenanceNotice>
              <div style={{ marginTop: 8 }}>
                <DataProvenance
                  source={o.provenance.source}
                  authority={o.provenance.sourceAuthority}
                  dataStatus={o.provenance.dataStatus}
                  recordedAt={o.provenance.recordedAt}
                  confidence={o.confidence}
                  note="A possible change is a signal for verification, not evidence of unauthorised construction."
                />
              </div>
            </GlassPanel>
          ))}
          {sat.changeDetections.map((c, i) => (
            <GlassPanel key={`${c.changeType}-${i}`}>
              <CardHead title={c.changeType.replace(/_/g, ' ')} subtitle={c.description} actions={<span className="badge badge-demo">DEMONSTRATION</span>} />
              <div className="grid grid-3">
                <ProvenanceField label="Change score" value={c.changeScore === null ? '—' : c.changeScore.toFixed(2)} />
                <ProvenanceField label="Confidence" value={c.confidence === null ? '—' : c.confidence.toFixed(2)} />
                <ProvenanceField label="Possible change" value={c.possibleChange ? 'Yes' : 'No'} />
              </div>
            </GlassPanel>
          ))}
        </>
      )}
    </div>
  );
}

function IntegritySection({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Integrity engine output"
          subtitle="Recomputed from current records at read time — findings are never hand-inserted"
          actions={<span className="badge badge-info">DERIVED</span>}
        />
        <div className="grid grid-4">
          <MetricCard label="Findings" value={formatNumber(data.findings.length)} tone={data.findings.length > 0 ? 'warn' : 'ok'} />
          <MetricCard label="Score" value={`${data.score.score}/100`} hint={data.score.band} />
          <MetricCard label="Linkage" value={data.linkage.state.replace(/_/g, ' ')} hint={data.linkage.reason} />
          <MetricCard label="Quality" value={`${data.quality.score}/100`} tone="info" />
        </div>
        <div className="divider" />
        {data.findings.length === 0 ? (
          <EmptyState title="No integrity findings" icon="✓" body="Every compared record agrees within the configured tolerance for this parcel." />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {data.findings.map((f) => (
              <FindingCard key={f.findingId} finding={f} />
            ))}
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <CardHead title="Evidence chain" subtitle="Finding → evidence → source → record → authority" />
        {data.evidence.length === 0 ? (
          <EmptyState title="No evidence records" body="No discrepancy was detected, so no evidence chain was assembled." />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {data.evidence.map((e) => (
              <EvidenceCard key={e.evidenceId} evidence={e} />
            ))}
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <CardHead title="Quality breakdown" subtitle={String(data.quality.breakdown.note ?? '')} />
        <div className="chart">
          {[
            ['Completeness', data.quality.completeness],
            ['Consistency', data.quality.consistency],
            ['Freshness', data.quality.freshness],
            ['Linkage', data.quality.linkage],
            ['Geometry validity', data.quality.geometryValidity],
            ['Source availability', data.quality.sourceAvailability],
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
      </GlassPanel>
    </div>
  );
}

function VerificationSection({ data, parcelId }: { data: LandPassport; parcelId: string }) {
  const navigate = useNavigate();
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Verification cases"
          subtitle="Every status change writes a case event and an audit record"
          actions={
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => navigate(`/cases/new?parcelId=${encodeURIComponent(parcelId)}`)}
            >
              Create case
            </button>
          }
        />
        {data.verification.cases.length === 0 ? (
          <EmptyState
            title="No verification case on this parcel"
            icon="⚑"
            body="No verification case has been raised. A case can be created from any integrity finding to route it to the responsible authority."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Routed to</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.verification.cases.map((c) => (
                  <tr
                    key={c.case_id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => navigate(`/cases/${c.case_id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/cases/${c.case_id}`)}
                  >
                    <td className="mono tiny">{c.case_number}</td>
                    <td className="small">{c.title}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      <span className="badge badge-neutral">{c.priority}</span>
                    </td>
                    <td className="small muted">{c.assigned_department ?? c.assigned_role ?? 'Unassigned'}</td>
                    <td className="tiny muted">{formatDateTime(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Available workflow transitions" subtitle="Enforced by the workflow service; invalid transitions are rejected" />
        <div className="stack" style={{ gap: 8 }}>
          {Object.entries(data.verification.availableTransitions).map(([from, to]) => (
            <div key={from} className="glass-inset card-tight">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <StatusBadge status={from} />
                <span className="muted" aria-hidden="true">
                  →
                </span>
                {to.length === 0 ? (
                  <span className="small muted">terminal state</span>
                ) : (
                  to.map((t) => <StatusBadge key={t} status={t} />)
                )}
              </div>
            </div>
          ))}
          {Object.keys(data.verification.availableTransitions).length === 0 ? (
            <EmptyState title="No active workflow state" body="Create a case to see the permitted transitions for its current status." />
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function TimelineSection({ data }: { data: LandPassport }) {
  return (
    <GlassPanel>
      <CardHead
        title="Parcel timeline"
        subtitle="Every record creation, update, finding, case event and officer action, in order"
      />
      <Timeline events={data.timeline} />
    </GlassPanel>
  );
}

function SourcesSection({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Sources referenced by this passport"
          subtitle="Each value in this passport traces back to one of these sources"
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Authority</th>
                <th scope="col">Data status</th>
                <th scope="col">Recorded</th>
                <th scope="col">Authoritative</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={`${s.sourceId}-${s.recordedAt}-${s.source}`}>
                  <td className="small">{s.source}</td>
                  <td className="small muted">{s.sourceAuthority}</td>
                  <td>
                    <DataStatusChip status={s.dataStatus} />
                  </td>
                  <td className="tiny muted">{s.recordedAt ? formatDateTime(s.recordedAt) : '—'}</td>
                  <td>
                    {s.isAuthoritative ? (
                      <span className="badge badge-ok">authoritative</span>
                    ) : (
                      <span className="badge badge-neutral">not authoritative</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.sources.length === 0 ? (
          <EmptyState title="No sources recorded" body="This passport referenced no source records, which indicates a coverage gap." />
        ) : null}
      </GlassPanel>

      {data.spatialContext ? (
        <GlassPanel>
          <CardHead
            title="Contextual GIS information (OpenStreetMap)"
            subtitle={`Within ${data.spatialContext.radius} m of the parcel centroid`}
            actions={<span className="badge badge-context">CONTEXTUAL</span>}
          />
          {data.spatialContext.unavailable ? (
            <ProvenanceNotice tone="warn">
              {data.spatialContext.message} Core parcel workflow remains operational.
            </ProvenanceNotice>
          ) : (
            <div className="grid grid-3">
              <MetricCard label="Roads nearby" value={formatNumber(data.spatialContext.roads.length)} />
              <MetricCard label="Buildings nearby" value={formatNumber(data.spatialContext.buildings.length)} />
              <MetricCard label="Water features" value={formatNumber(data.spatialContext.water.length)} />
              <MetricCard label="Amenities" value={formatNumber(data.spatialContext.amenities.length)} />
              <MetricCard label="Land use polygons" value={formatNumber(data.spatialContext.landuse.length)} />
            </div>
          )}
          <div className="divider" />
          <div className="tiny muted">{data.spatialContext.licence}</div>
          <div className="tiny muted">
            Contextual geographic information is not cadastral, ownership or legal information.
          </div>
        </GlassPanel>
      ) : null}
    </div>
  );
}

function AuditSection({
  loading,
  error,
  reload,
  entries,
  canRead,
}: {
  loading: boolean;
  error: unknown;
  reload: () => void;
  entries: {
    audit_id: string;
    timestamp: string;
    actor: string;
    role: string;
    action: string;
    entity_type: string;
    entity_id: string;
    reason: string;
  }[];
  canRead: boolean;
}) {
  if (!canRead) {
    return (
      <EmptyState
        title="Audit trail restricted"
        icon="⚑"
        body="The parcel audit trail is visible to officers and administrators. Sign in with an authorised account to inspect immutable audit records."
      />
    );
  }
  if (loading) return <LoadingState lines={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (entries.length === 0) {
    return <EmptyState title="No audit events for this parcel" body="No auditable action has been recorded against this parcel yet." />;
  }
  return (
    <GlassPanel>
      <CardHead title="Audit trail" subtitle="Append-only records — application code never modifies them" />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Role</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.audit_id}>
                <td className="tiny muted">{formatDateTime(a.timestamp)}</td>
                <td className="small">{a.actor}</td>
                <td className="tiny muted">{a.role}</td>
                <td>
                  <span className="badge badge-neutral">{a.action.replace(/_/g, ' ')}</span>
                </td>
                <td className="tiny mono">
                  {a.entity_type}/{a.entity_id.slice(0, 18)}
                </td>
                <td className="tiny muted">{a.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}
