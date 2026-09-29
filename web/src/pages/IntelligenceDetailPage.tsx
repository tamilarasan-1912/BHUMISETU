import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  ColumnChart,
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
  { id: 'identity', label: 'Land identity' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'registration', label: 'Registration' },
  { id: 'encumbrance', label: 'Encumbrance' },
  { id: 'tax', label: 'Tax' },
  { id: 'planning', label: 'Planning' },
  { id: 'judiciary', label: 'Judiciary' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'context', label: 'Spatial context' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'sources', label: 'Sources' },
];

export function IntelligenceDetailPage() {
  const { parcelId = '' } = useParams();
  const navigate = useNavigate();
  const { pushToast, reportError } = useApp();
  const [params, setParams] = useSearchParams();
  const active = params.get('tab') ?? 'overview';
  const [basemap, setBasemap] = useState<BasemapId>('dark-gis');
  const [withContext, setWithContext] = useState(true);

  const passport = useAsync((s) => api.passport(parcelId, { context: withContext, radius: 600 }, s), [parcelId, withContext]);

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  if (passport.loading) {
    return (
      <div className="page">
        <LoadingState lines={6} label="Loading parcel intelligence" />
      </div>
    );
  }
  if (passport.error) {
    return (
      <div className="page stack">
        <ErrorState title={`Parcel ${parcelId} is unavailable`} error={passport.error} onRetry={passport.reload} />
        <button type="button" className="btn" onClick={() => navigate('/intelligence')}>
          Back to intelligence index
        </button>
      </div>
    );
  }
  const data = passport.data;
  if (!data) return null;
  const s = data.executiveSummary;

  const geojson = data.geometry
    ? {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            id: s.parcelId,
            properties: {
              parcelId: s.parcelId,
              displayId: s.displayId,
              surveyNumber: String(data.identity.surveyNumber ?? ''),
              village: s.village,
              district: s.district,
              areaSqft: s.areaSqft,
              risk: s.riskBand,
              findingCount: s.findingCount,
              findingCodes: data.findings.map((f) => f.ruleCode),
              dataStatus: 'DEMONSTRATION' as const,
              isDemonstration: true,
            },
            geometry: data.geometry.geometry as { type: 'Polygon'; coordinates: unknown },
          },
        ],
        metadata: { layer: 'cadastral-parcels', dataStatus: 'DEMONSTRATION' },
      }
    : null;

  const createCaseFor = async (ruleCode: string) => {
    try {
      const created = await api.createCase({
        parcelId,
        title: `${ruleCode.replace(/_/g, ' ').toLowerCase()} — ${s.displayId}`,
        description: `Raised from the parcel intelligence workspace for ${parcelId}. The integrity engine flagged ${ruleCode}; records require reconciliation.`,
        priority: s.riskBand === 'HIGH RISK' ? 'HIGH' : 'NORMAL',
        findingRefs: [`FND-${parcelId}-${ruleCode}`],
      });
      pushToast({ kind: 'success', title: `Case ${created.case_number} created`, body: 'Routed to the responsible authority.' });
      navigate(`/cases/${created.case_id}`);
    } catch (err) {
      reportError(err, 'Create case');
    }
  };

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <GlassPanel>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>{s.displayId}</h1>
              <span className="badge badge-neutral mono">{s.parcelId}</span>
              <RiskBadge band={s.riskBand} score={s.score} />
              <LinkageBadge linkage={s.linkage} />
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              {s.village}, {s.district} · {formatArea(s.areaSqft)} · survey {String(data.identity.surveyNumber ?? '—')}
            </p>
          </div>
          <div className="chip-row">
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/passport/${parcelId}`)}>
              Land Passport
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => navigate(`/cases/new?parcelId=${encodeURIComponent(parcelId)}`)}
            >
              Start verification
            </button>
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <MetricCard label="Findings" value={formatNumber(s.findingCount)} tone={s.findingCount > 0 ? 'warn' : 'ok'} />
          <MetricCard label="Score" value={`${s.score}/100`} hint={s.riskBand} />
          <MetricCard label="Quality" value={`${s.dataQualityScore}/100`} tone="info" />
          <MetricCard label="Open cases" value={formatNumber(s.openCases)} hint={s.verificationStatus} />
        </div>
      </GlassPanel>

      <div className="grid grid-2">
        <GlassCard>
          <CardHead
            title="Spatial context"
            subtitle="Parcel geometry with contextual layers"
            actions={
              <label className="checkbox">
                <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} />
                OSM context
              </label>
            }
          />
          <MapView
            parcels={geojson as never}
            selectedParcelId={parcelId}
            basemap={basemap}
            onBasemapChange={setBasemap}
            showParcels
            showContext={withContext}
            context={data.spatialContext}
            extraOverlay={
              <MapStatChips
                parcels={1}
                findings={s.findingCount}
                highRisk={s.riskBand === 'HIGH RISK' ? 1 : 0}
                unlinked={s.linkage === 'UNLINKED' ? 1 : 0}
                cases={s.openCases}
                datasetLabel={`${parcelId} · demonstration`}
              />
            }
          />
          {withContext && data.spatialContext?.unavailable ? (
            <div style={{ marginTop: 10 }}>
              <ProvenanceNotice tone="warn">
                {data.spatialContext.message} Core parcel workflow remains operational.
              </ProvenanceNotice>
            </div>
          ) : null}
        </GlassCard>

        <div className="stack">
          <GlassPanel>
            <CardHead title="Risk summary" subtitle="Every deduction is itemised" />
            <div className="row" style={{ gap: 14 }}>
              <div className="metric-value" style={{ fontSize: 34 }}>
                {data.score.score}
              </div>
              <div>
                <RiskBadge band={data.score.band} />
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {data.score.deductions.length} deduction(s) · internal support indicator
                </div>
              </div>
            </div>
            <div className="divider" />
            {data.score.deductions.length === 0 ? (
              <EmptyState title="No deductions" icon="✓" body="All compared records agree in the available dataset." />
            ) : (
              <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                {data.score.deductions.map((d) => (
                  <li className="glass-inset card-tight row-between" key={d.ruleCode}>
                    <div className="grow">
                      <div className="small">{d.label}</div>
                      <div className="tiny muted">{d.reason}</div>
                    </div>
                    <span className="badge badge-warn mono">{d.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel>
            <CardHead title="Recommendations" subtitle="Actions the record set supports right now" />
            {data.findings.length === 0 ? (
              <EmptyState title="No action required" icon="✓" body="No discrepancy was detected for this parcel." />
            ) : (
              <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
                {data.findings.map((f) => (
                  <li key={f.findingId} className="glass-inset card-tight">
                    <div className="row-between">
                      <span className="badge badge-neutral mono tiny">{f.ruleCode}</span>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void createCaseFor(f.ruleCode)}>
                        Raise case
                      </button>
                    </div>
                    <div className="small" style={{ marginTop: 5 }}>
                      {f.recommendedAction}
                    </div>
                    <div className="tiny muted">Routed authority: {f.routedAuthority}</div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel>
            <CardHead title="Spatial context summary" subtitle="Labelled contextual — never a legal attribute" />
            {!withContext ? (
              <EmptyState title="Context disabled" icon="○" body="Enable the OpenStreetMap context toggle to query nearby roads, buildings, water and amenities." />
            ) : !data.spatialContext ? (
              <LoadingState lines={3} />
            ) : data.spatialContext.unavailable ? (
              <ProvenanceNotice tone="warn">{data.spatialContext.message}</ProvenanceNotice>
            ) : (
              <>
                <div className="grid grid-3">
                  <MetricCard label="Roads" value={formatNumber(data.spatialContext.roads.length)} />
                  <MetricCard label="Buildings" value={formatNumber(data.spatialContext.buildings.length)} />
                  <MetricCard label="Water" value={formatNumber(data.spatialContext.water.length)} />
                  <MetricCard label="Amenities" value={formatNumber(data.spatialContext.amenities.length)} />
                  <MetricCard label="Land use" value={formatNumber(data.spatialContext.landuse.length)} />
                  <MetricCard label="Radius" value={`${data.spatialContext.radius} m`} />
                </div>
                <div className="divider" />
                <div className="tiny muted">{data.spatialContext.licence}</div>
              </>
            )}
          </GlassPanel>
        </div>
      </div>

      <GlassCard>
        <Tabs tabs={TABS} active={active} onChange={setTab} ariaLabel="Parcel intelligence sections" />
        <TabPanel id={`intel-${active}`} labelledBy={`intel-${active}`}>
          {active === 'overview' ? <IntelOverview data={data} /> : null}
          {active === 'identity' ? <IntelIdentity data={data} /> : null}
          {active === 'ownership' ? <IntelOwnership data={data} /> : null}
          {active === 'registration' ? <IntelRegistration data={data} /> : null}
          {active === 'encumbrance' ? <IntelEncumbrance data={data} /> : null}
          {active === 'tax' ? <IntelTax data={data} /> : null}
          {active === 'planning' ? <IntelPlanning data={data} /> : null}
          {active === 'judiciary' ? <IntelJudiciary data={data} /> : null}
          {active === 'satellite' ? <IntelSatellite data={data} /> : null}
          {active === 'integrity' ? <IntelIntegrity data={data} parcelId={parcelId} onCreate={createCaseFor} /> : null}
          {active === 'evidence' ? <IntelEvidence data={data} /> : null}
          {active === 'context' ? <IntelContext data={data} onEnable={() => setWithContext(true)} /> : null}
          {active === 'timeline' ? (
            <GlassPanel>
              <CardHead title="Parcel timeline" subtitle="Records, findings, cases and officer actions in order" />
              <Timeline events={data.timeline} />
            </GlassPanel>
          ) : null}
          {active === 'sources' ? <IntelSources data={data} /> : null}
        </TabPanel>
      </GlassCard>
    </div>
  );
}

function IntelOverview({ data }: { data: LandPassport }) {
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Data completeness" subtitle="Transparent quality score inputs" />
        <ColumnChart
          ariaLabel="Quality score components"
          data={[
            { label: 'Compl.', value: data.quality.completeness },
            { label: 'Consist.', value: data.quality.consistency },
            { label: 'Fresh', value: data.quality.freshness },
            { label: 'Link', value: data.quality.linkage },
            { label: 'Geom', value: data.quality.geometryValidity },
            { label: 'Source', value: data.quality.sourceAvailability },
          ]}
        />
        <div className="divider" />
        <div className="small muted">{String(data.quality.breakdown.note ?? '')}</div>
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Workflow status" subtitle="Verification state for this parcel" />
        <dl className="kv kv-tight">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={data.executiveSummary.verificationStatus} />
          </dd>
          <dt>Open cases</dt>
          <dd>{data.executiveSummary.openCases}</dd>
          <dt>Linkage</dt>
          <dd>
            <LinkageBadge linkage={data.linkage.state} />
          </dd>
          <dt>Linkage note</dt>
          <dd className="small muted">{data.linkage.reason}</dd>
          <dt>Last updated</dt>
          <dd>{formatDateTime(data.executiveSummary.lastUpdated)}</dd>
        </dl>
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Linked record counts" subtitle="Coverage across governance domains" />
        <ColumnChart
          ariaLabel="Linked record counts"
          data={[
            { label: 'RoR', value: data.ror.length },
            { label: 'Reg', value: data.registration.transactions.length },
            { label: 'Enc', value: data.encumbrance.items.length },
            { label: 'Tax', value: data.tax.records.length },
            { label: 'Bldg', value: data.building.permissions.length },
            { label: 'Jud', value: data.judiciary.cases.length },
            { label: 'Doc', value: data.documents.length },
            { label: 'Sat', value: data.satellite.observations.length },
          ]}
        />
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Change detection" subtitle="Possible changes flagged for verification" />
        {data.satellite.changeDetections.length === 0 ? (
          <EmptyState
            title="No change detection results"
            icon="◌"
            body="No change-detection result is linked to this parcel. Live acquisition requires Copernicus authorisation."
          />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {data.satellite.changeDetections.map((c, i) => (
              <div className="glass-inset card-tight" key={`${c.changeType}-${i}`}>
                <div className="row-between">
                  <span className="small">{c.changeType.replace(/_/g, ' ')}</span>
                  <span className="badge badge-demo">DEMONSTRATION</span>
                </div>
                <div className="tiny muted">{c.description}</div>
                <div className="tiny muted">
                  score {c.changeScore?.toFixed(2) ?? '—'} · confidence {c.confidence?.toFixed(2) ?? '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function IntelIdentity({ data }: { data: LandPassport }) {
  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Land identity" subtitle="Identifiers, classification and provenance" />
        <dl className="kv">
          <dt>Internal ID</dt>
          <dd className="mono">{data.executiveSummary.parcelId}</dd>
          <dt>Display ID</dt>
          <dd className="mono">{data.executiveSummary.displayId}</dd>
          <dt>Survey / subdivision</dt>
          <dd className="mono">
            {String(data.identity.surveyNumber ?? '—')}
            {data.identity.subdivisionNumber ? ` / ${String(data.identity.subdivisionNumber)}` : ''}
          </dd>
          <dt>Classification</dt>
          <dd>{String(data.identity.classification ?? '—')}</dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={String(data.identity.status ?? 'ACTIVE')} />
          </dd>
        </dl>
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Identifier schemes" subtitle="Official vs demonstration, stated explicitly" />
        <div className="stack" style={{ gap: 8 }}>
          {data.identity.identifiers.map((i) => (
            <div className="glass-inset card-tight" key={`${i.scheme}-${i.value}`}>
              <div className="row-between">
                <span className="mono small">{i.value}</span>
                <span className={`badge ${i.isOfficial ? 'badge-ok' : 'badge-demo'}`}>
                  {i.isOfficial ? 'official' : 'demonstration'}
                </span>
              </div>
              <div className="tiny muted">{i.scheme}</div>
            </div>
          ))}
          {data.identity.identifiers.length === 0 ? (
            <EmptyState title="No identifiers" body="No identifier scheme is linked to this parcel." />
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function IntelOwnership({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead title="Ownership records" subtitle="Revenue, registration and municipal attributions side by side" />
        {data.ownership.parties.length === 0 ? (
          <EmptyState title="No ownership records" body="No ownership, rights or interests record is linked to this parcel." />
        ) : (
          <div className="grid grid-2">
            {data.ownership.parties.map((p, i) => (
              <div className="glass-inset card-tight" key={`${p.role}-${i}`}>
                <div className="row-between">
                  <span style={{ fontWeight: 620 }}>{p.name ?? '—'}</span>
                  <DataStatusChip status={p.provenance.dataStatus} short />
                </div>
                <div className="tiny muted">
                  {p.role} · share {p.share}
                </div>
                <div style={{ marginTop: 6 }}>
                  <DataProvenance
                    source={p.provenance.source}
                    authority={p.provenance.sourceAuthority}
                    dataStatus={p.provenance.dataStatus}
                    recordedAt={p.provenance.recordedAt}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Agreement assessment" subtitle="What the engine compared and what it found" />
        <div className="small">{data.ownership.agreement}</div>
        {data.findings.some((f) => f.ruleCode === 'OWNERSHIP_MISMATCH') ? (
          <div style={{ marginTop: 10 }}>
            <ProvenanceNotice tone="warn">
              Records require reconciliation. The platform reports a possible discrepancy between the revenue,
              registration and municipal records; it does not determine who owns the parcel, and it makes no finding
              of fraud.
            </ProvenanceNotice>
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}

function IntelRegistration({ data }: { data: LandPassport }) {
  if (data.registration.transactions.length === 0) {
    return (
      <EmptyState
        title="No registration records"
        icon="⚠"
        body="The registration adapter is ready but no authorised feed is configured for this deployment, so no instrument is linked. This is a data coverage gap."
      />
    );
  }
  return (
    <GlassPanel>
      <CardHead title="Registered instruments" subtitle="Each transaction carries its registration provenance" />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
              <th scope="col">Transferor</th>
              <th scope="col">Transferee</th>
              <th scope="col">Consideration</th>
              <th scope="col">Data</th>
            </tr>
          </thead>
          <tbody>
            {data.registration.transactions.map((t) => (
              <tr key={t.registrationId}>
                <td className="mono tiny">{t.documentNumber}</td>
                <td className="small">{t.documentType.replace(/_/g, ' ')}</td>
                <td className="tiny">{formatDate(t.registrationDate)}</td>
                <td className="small">{t.transferor ?? '—'}</td>
                <td className="small">{t.transferee ?? '—'}</td>
                <td className="num">{t.consideration === null ? '—' : formatNumber(t.consideration)}</td>
                <td>
                  <DataStatusChip status={t.provenance.dataStatus} short />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

function IntelEncumbrance({ data }: { data: LandPassport }) {
  const items = [
    ...data.encumbrance.items.map((e) => ({
      key: e.encumbranceId,
      kind: e.type.replace(/_/g, ' '),
      detail: e.holder ?? '—',
      active: e.isActive,
      extra: e.nocStatus ?? 'NOC not recorded',
      status: e.provenance.dataStatus,
    })),
    ...data.encumbrance.mortgages.map((m) => ({
      key: m.mortgageId,
      kind: 'Mortgage',
      detail: m.lender ?? '—',
      active: m.status === 'ACTIVE',
      extra: m.closureDate ? `closed ${formatDate(m.closureDate)}` : 'not closed',
      status: m.provenance.dataStatus,
    })),
  ];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No encumbrances"
        icon="✓"
        body="No encumbrance, mortgage or restriction is linked to this parcel in the available dataset."
      />
    );
  }
  return (
    <div className="stack">
      {items.map((i) => (
        <GlassPanel key={i.key}>
          <CardHead
            title={i.kind}
            subtitle={i.detail}
            actions={
              <div className="chip-row">
                <span className={`badge ${i.active ? 'badge-warn' : 'badge-ok'}`}>{i.active ? 'ACTIVE' : 'CLOSED'}</span>
                <DataStatusChip status={i.status} />
              </div>
            }
          />
          <div className="small muted">{i.extra}</div>
        </GlassPanel>
      ))}
      {data.findings.some((f) => f.ruleCode === 'ENCUMBRANCE_RISK') ? (
        <ProvenanceNotice tone="warn">
          High-risk verification: an active restriction and a recent transfer are both recorded without a recorded
          no-objection certificate. This is a signal to verify, not a determination about the transaction&apos;s validity.
        </ProvenanceNotice>
      ) : null}
    </div>
  );
}

function IntelTax({ data }: { data: LandPassport }) {
  if (data.tax.records.length === 0) {
    return (
      <EmptyState
        title="No tax records"
        icon="⚠"
        body="No municipal property tax record is linked to this parcel. The municipal adapter is the integration point for the urban local body's assessment system."
      />
    );
  }
  return (
    <GlassPanel>
      <CardHead title="Property tax" subtitle="Assessment, payment and outstanding position" />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Assessment no.</th>
              <th scope="col">Demand</th>
              <th scope="col">Paid</th>
              <th scope="col">Outstanding</th>
              <th scope="col">Assessment name</th>
              <th scope="col">Data</th>
            </tr>
          </thead>
          <tbody>
            {data.tax.records.map((t) => (
              <tr key={t.taxRecordId}>
                <td className="small">{t.taxPeriod}</td>
                <td className="mono tiny">{t.assessmentNumber ?? '—'}</td>
                <td className="num">{formatNumber(Number(t.demand))}</td>
                <td className="num">{formatNumber(Number(t.paid))}</td>
                <td className="num">
                  <span className={Number(t.due) > 0 ? 'badge badge-warn' : ''}>{formatNumber(Number(t.due))}</span>
                </td>
                <td className="small">{t.ownerName ?? '—'}</td>
                <td>
                  <DataStatusChip status={t.provenance.dataStatus} short />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

function IntelPlanning({ data }: { data: LandPassport }) {
  const empty = data.planning.zoning.length === 0 && data.planning.landUse.length === 0;
  if (empty) {
    return (
      <EmptyState
        title="No planning or land use records"
        icon="⚠"
        body="No zoning, master plan or land use record is linked to this parcel. Planning data arrives through the planning adapter; Bhuvan LULC is contextual and is not treated as a legal land use attribute."
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
        </GlassPanel>
      ))}
      {data.planning.landUse.map((l) => (
        <GlassPanel key={l.useCode}>
          <CardHead title={`${l.useCode} · ${l.useDescription}`} subtitle="Contextual land use" />
          <DataProvenance
            source={l.provenance.source}
            authority={l.provenance.sourceAuthority}
            dataStatus={l.provenance.dataStatus}
            note={l.provenance.note}
          />
        </GlassPanel>
      ))}
    </div>
  );
}

function IntelJudiciary({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <ProvenanceNotice tone="warn">{data.judiciary.disclaimer}</ProvenanceNotice>
      {data.judiciary.cases.length === 0 ? (
        <EmptyState
          title="No judiciary records"
          icon="⚖"
          body="No case is linked to this parcel in the available dataset. The judiciary adapter is the integration point for eCourts."
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
          </GlassPanel>
        ))
      )}
    </div>
  );
}

function IntelSatellite({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Observation and change detection"
          subtitle="Architecture ready for a real Sentinel-2 pipeline"
          actions={<span className="badge badge-demo">DEMONSTRATION</span>}
        />
        <dl className="kv kv-tight">
          <dt>Model in use</dt>
          <dd>{data.satellite.processingState.model}</dd>
          <dt>Replaceable by operator</dt>
          <dd>{data.satellite.processingState.operatorReady ? 'Yes' : 'No'}</dd>
          <dt>Copernicus</dt>
          <dd>
            {data.satellite.processingState.copernicusConfigured ? (
              <span className="badge badge-ok">configured</span>
            ) : (
              <span className="badge badge-warn">credentials required</span>
            )}
          </dd>
        </dl>
        <div className="small muted" style={{ marginTop: 8 }}>
          {data.satellite.processingState.note}
        </div>
      </GlassPanel>
      {data.satellite.observations.length === 0 ? (
        <EmptyState
          title="No satellite observations"
          icon="◌"
          body="No observation is linked to this parcel. Live Sentinel-2 acquisition requires Copernicus authorisation via environment variables."
        />
      ) : (
        data.satellite.observations.map((o) => (
          <GlassPanel key={o.observationId}>
            <CardHead
              title={`${o.sensor} · ${formatDate(o.captureDate)}`}
              subtitle={o.possibleChange ? 'Possible change detected' : 'No change detected'}
              actions={<DataStatusChip status={o.provenance.dataStatus} />}
            />
            <div className="grid grid-3">
              <ProvenanceField label="Cloud coverage" value={o.cloudCoverage === null ? '—' : `${o.cloudCoverage}%`} />
              <ProvenanceField label="Change score" value={o.changeScore?.toFixed(2) ?? '—'} />
              <ProvenanceField label="Confidence" value={o.confidence?.toFixed(2) ?? '—'} />
            </div>
            <div className="divider" />
            <ProvenanceNotice tone="warn">{o.processingNote}</ProvenanceNotice>
          </GlassPanel>
        ))
      )}
    </div>
  );
}

function IntelIntegrity({
  data,
  parcelId,
  onCreate,
}: {
  data: LandPassport;
  parcelId: string;
  onCreate: (rule: string) => Promise<void>;
}) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead
          title="Integrity engine"
          subtitle="Deterministic rules recomputed at read time"
          actions={<span className="badge badge-info">DERIVED</span>}
        />
        <div className="grid grid-4">
          <MetricCard label="Findings" value={formatNumber(data.findings.length)} tone={data.findings.length ? 'warn' : 'ok'} />
          <MetricCard label="Score" value={`${data.score.score}/100`} hint={data.score.band} />
          <MetricCard label="Linkage" value={data.linkage.state.replace(/_/g, ' ')} />
          <MetricCard label="Quality" value={`${data.quality.score}/100`} tone="info" />
        </div>
        <div className="divider" />
        {data.findings.length === 0 ? (
          <EmptyState title="No findings" icon="✓" body={`No rule fired for ${parcelId} against the current record set.`} />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {data.findings.map((f) => (
              <FindingCard
                key={f.findingId}
                finding={f}
                actions={
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void onCreate(f.ruleCode)}>
                    Raise case
                  </button>
                }
              />
            ))}
          </div>
        )}
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Rule catalogue" subtitle="Configured thresholds and routing for every rule" />
        <RuleTable />
      </GlassPanel>
    </div>
  );
}

function RuleTable() {
  const rules = useAsync((s) => api.rules(s), []);
  if (rules.loading) return <LoadingState lines={4} />;
  if (rules.error) return <ErrorState error={rules.error} onRetry={rules.reload} />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Severity</th>
            <th scope="col">Deduction</th>
            <th scope="col">Routed authority</th>
            <th scope="col">Enabled</th>
            <th scope="col">Version</th>
          </tr>
        </thead>
        <tbody>
          {(rules.data?.items ?? []).map((r) => (
            <tr key={r.rule_code}>
              <td>
                <div className="mono tiny">{r.rule_code}</div>
                <div className="tiny muted">{r.title}</div>
              </td>
              <td>
                <StatusBadge status={r.severity} />
              </td>
              <td className="num">{r.deduction}</td>
              <td className="small muted">{r.routed_authority}</td>
              <td>{r.is_enabled ? <span className="badge badge-ok">enabled</span> : <span className="badge badge-neutral">disabled</span>}</td>
              <td className="mono tiny">v{r.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntelEvidence({ data }: { data: LandPassport }) {
  if (data.evidence.length === 0) {
    return (
      <EmptyState
        title="No evidence assembled"
        icon="▤"
        body="No rule fired for this parcel, so no evidence chain was built. Evidence is only created where a comparison produced a discrepancy."
      />
    );
  }
  return (
    <GlassPanel>
      <CardHead
        title="Evidence chain"
        subtitle="Finding → evidence → source → record → authority"
        actions={<span className="badge badge-info">DERIVED</span>}
      />
      <div className="stack" style={{ gap: 8 }}>
        {data.evidence.map((e, i) => (
          <EvidenceCard key={e.evidenceId} evidence={e} defaultOpen={i === 0} />
        ))}
      </div>
    </GlassPanel>
  );
}

function IntelContext({ data, onEnable }: { data: LandPassport; onEnable: () => void }) {
  const ctx = data.spatialContext;
  if (!ctx) {
    return (
      <EmptyState
        title="Context not loaded"
        icon="○"
        body="Contextual GIS information is fetched on demand and cached. Enable it to query nearby roads, buildings, water bodies and amenities."
        action={
          <button type="button" className="btn btn-sm btn-primary" onClick={onEnable}>
            Load context
          </button>
        }
      />
    );
  }
  if (ctx.unavailable) {
    return (
      <div className="stack">
        <ProvenanceNotice tone="warn">
          {ctx.message} Core parcel workflow remains operational.
        </ProvenanceNotice>
        <EmptyState title="Thematic layers inaccessible" body="Roads, buildings, waterways and amenities are all served by the same contextual service." />
      </div>
    );
  }
  return (
    <div className="stack">
      <ProvenanceNotice tone="context">
        <strong>CONTEXTUAL GIS INFORMATION.</strong> Derived from OpenStreetMap. It is not cadastral, ownership or
        legal information, and it does not affect the integrity findings on this parcel.
      </ProvenanceNotice>
      <GlassPanel>
        <CardHead title="Roads within radius" subtitle={`${ctx.roads.length} feature(s) · ${ctx.radius} m`} />
        {ctx.roads.length === 0 ? (
          <EmptyState title="No roads found" body="No highway feature was returned for this radius in the contextual dataset." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Class</th>
                  <th scope="col">Distance</th>
                </tr>
              </thead>
              <tbody>
                {ctx.roads.slice(0, 25).map((r) => (
                  <tr key={r.id}>
                    <td className="small">{r.name ?? 'Unnamed'}</td>
                    <td className="tiny muted">{r.highway ?? '—'}</td>
                    <td className="num tiny">{r.distanceM === null ? '—' : `${formatNumber(r.distanceM)} m`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Water features" subtitle={`${ctx.water.length} feature(s)`} />
          {ctx.water.length === 0 ? (
            <EmptyState title="No water features" body="No waterway or water body was returned for this radius." />
          ) : (
            <ul className="pill-list" style={{ flexDirection: 'column', gap: 6 }}>
              {ctx.water.slice(0, 12).map((w) => (
                <li key={w.id} className="small row-between" style={{ width: '100%' }}>
                  <span>{w.name ?? w.waterType}</span>
                  <span className="tiny muted">{w.distanceM === null ? '—' : `${formatNumber(w.distanceM)} m`}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
        <GlassPanel>
          <CardHead title="Amenities" subtitle={`${ctx.amenities.length} feature(s)`} />
          {ctx.amenities.length === 0 ? (
            <EmptyState title="No amenities" body="No amenity was returned for this radius." />
          ) : (
            <ul className="pill-list" style={{ flexDirection: 'column', gap: 6 }}>
              {ctx.amenities.slice(0, 12).map((a) => (
                <li key={a.id} className="small row-between" style={{ width: '100%' }}>
                  <span>
                    {a.name ?? 'Unnamed'} <span className="tiny muted">· {a.category}</span>
                  </span>
                  <span className="tiny muted">{a.distanceM === null ? '—' : `${formatNumber(a.distanceM)} m`}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>
      <div className="tiny muted">{ctx.licence}</div>
    </div>
  );
}

function IntelSources({ data }: { data: LandPassport }) {
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead title="Sources referenced" subtitle="Every value in this workspace traces back here" />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Authority</th>
                <th scope="col">Data status</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((src) => (
                <tr key={`${src.sourceId}-${src.source}-${src.recordedAt}`}>
                  <td className="small">{src.source}</td>
                  <td className="small muted">{src.sourceAuthority}</td>
                  <td>
                    <DataStatusChip status={src.dataStatus} />
                  </td>
                  <td className="tiny muted">{src.recordedAt ? formatDateTime(src.recordedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.sources.length === 0 ? (
          <EmptyState title="No sources recorded" body="This workspace referenced no source records." />
        ) : null}
      </GlassPanel>
      <GlassPanel>
        <CardHead title="Source health across the platform" subtitle="Live probe results where the adapter supports it" />
        <PlatformSourceHealth />
      </GlassPanel>
    </div>
  );
}

function PlatformSourceHealth() {
  const health = useAsync((s) => api.dataSources({ probe: true }, s), []);
  if (health.loading) return <LoadingState lines={4} />;
  if (health.error) return <ErrorState error={health.error} onRetry={health.reload} />;
  const items = health.data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No sources registered" body="The data fabric catalogue is empty." />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Data</th>
            <th scope="col">Latency</th>
            <th scope="col">Last checked</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.sourceId}>
              <td>
                <div className="small">{s.name}</div>
                <div className="tiny muted">{s.organization}</div>
              </td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td>
                <DataStatusChip status={s.dataStatus} short />
              </td>
              <td className="num tiny">{s.latencyMs === null ? '—' : `${s.latencyMs} ms`}</td>
              <td className="tiny muted">{s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
