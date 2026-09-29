import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, csvExportUrl, downloadExport } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  DataStatusChip,
  EmptyState,
  ErrorState,
  FieldErrors,
  GlassCard,
  GlassPanel,
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  RiskBadge,
  SearchBar,
  StatusBadge,
  TabPanel,
  Tabs,
  formatArea,
  formatDate,
  formatDateTime,
  formatNumber,
} from '../components/ui';
import type { SearchHit } from '../types/api';

const REQUEST_TYPES = [
  'OWNERSHIP_VERIFICATION',
  'PARCEL_CORRECTION',
  'AREA_CORRECTION',
  'DOCUMENT_UPDATE',
  'REGISTRATION_INQUIRY',
  'TAX_INQUIRY',
  'BUILDING_VERIFICATION',
  'OTHER',
] as const;

/**
 * Citizen-facing services. This view never exposes internal officer notes,
 * restricted documents, unmasked personal identifiers or full monetary values.
 */
export function CitizenPage() {
  const navigate = useNavigate();
  const { user, reportError } = useApp();
  const [tab, setTab] = useState('find');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedParcel, setSelectedParcel] = useState<string | null>(null);

  const myRequests = useAsync((s) => api.serviceRequests({ limit: 30 }, s), [], { enabled: Boolean(user) });
  const myCases = useAsync((s) => api.cases({ limit: 30 }, s), [], { enabled: Boolean(user) });
  const passport = useAsync(
    (s) => api.passport(selectedParcel ?? '', {}, s),
    [selectedParcel],
    { enabled: Boolean(selectedParcel) },
  );

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.search(query.trim(), 12);
      setHits(res.hits);
    } catch (err) {
      reportError(err, 'Search');
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Citizen services</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '90ch' }}>
            Search a parcel, review the information you are entitled to see, check verification status, download a land
            passport summary, and raise a service request or verification request.
          </p>
        </div>
        {!user ? (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
            Sign in to request
          </button>
        ) : null}
      </div>

      <ProvenanceNotice tone="warn">
        <strong>What you see is masked for privacy.</strong> Personal identifiers are partially hidden, monetary
        amounts are withheld, and internal officer notes and restricted documents are never shown in the citizen view.
      </ProvenanceNotice>

      <GlassCard>
        <Tabs
          tabs={[
            { id: 'find', label: 'Find a parcel' },
            { id: 'requests', label: 'My requests' },
            { id: 'cases', label: 'My verification cases' },
          ]}
          active={tab}
          onChange={setTab}
          ariaLabel="Citizen services sections"
        />
        <TabPanel id={`citizen-${tab}`} labelledBy={`citizen-${tab}`}>
          {tab === 'find' ? (
            <div className="stack">
              <SearchBar
                id="citizen-search"
                value={query}
                onChange={setQuery}
                onSubmit={() => void search()}
                busy={searching}
                placeholder="Parcel ID, survey number, owner name or village"
              />

              {hits && hits.length === 0 ? (
                <EmptyState
                  title="No parcel matched"
                  icon="⌕"
                  body="No parcel in the dataset matches your search. Check the survey number or parcel identifier and try again."
                />
              ) : null}

              {hits && hits.length > 0 ? (
                <div className="grid grid-3">
                  {hits.map((h) => (
                    <button
                      key={h.parcelId}
                      type="button"
                      className="glass-inset card-tight btn-ghost"
                      style={{ textAlign: 'left', display: 'block' }}
                      onClick={() => setSelectedParcel(h.parcelId)}
                    >
                      <div className="row-between">
                        <span className="mono small">{h.displayId}</span>
                        <RiskBadge band={h.riskBand} score={h.score} />
                      </div>
                      <div className="small" style={{ marginTop: 4 }}>
                        {h.village}, {h.district}
                      </div>
                      <div className="tiny muted">{formatArea(h.areaSqft)}</div>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedParcel ? (
                <CitizenParcelPanel
                  parcelId={selectedParcel}
                  loading={passport.loading}
                  error={passport.error}
                  data={passport.data}
                  onRetry={passport.reload}
                />
              ) : (
                <EmptyState
                  title="Search for a parcel to begin"
                  icon="◉"
                  body="Enter a parcel identifier, survey number, owner name or village. Matching parcels appear above, and selecting one shows the information you are entitled to see."
                />
              )}
            </div>
          ) : null}

          {tab === 'requests' ? (
            <CitizenRequests
              signedIn={Boolean(user)}
              loading={myRequests.loading}
              error={myRequests.error}
              requests={myRequests.data?.items ?? []}
              onReload={myRequests.reload}
              onSignIn={() => navigate('/login')}
            />
          ) : null}

          {tab === 'cases' ? (
            <div className="stack">
              {!user ? (
                <EmptyState
                  title="Sign in to see your cases"
                  icon="⚿"
                  body="Verification cases you have raised are visible only to you and the assigned officers."
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
                      Sign in
                    </button>
                  }
                />
              ) : myCases.loading ? (
                <LoadingState lines={4} />
              ) : myCases.error ? (
                <ErrorState error={myCases.error} onRetry={myCases.reload} />
              ) : (myCases.data?.items.length ?? 0) === 0 ? (
                <EmptyState
                  title="No verification cases"
                  icon="⚑"
                  body="You have not raised a verification case. Raise one from a parcel's page when a record needs reconciliation."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Case</th>
                        <th scope="col">Parcel</th>
                        <th scope="col">Status</th>
                        <th scope="col">Raised</th>
                        <th scope="col">Last update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myCases.data?.items.map((c) => (
                        <tr
                          key={c.case_id}
                          className="clickable"
                          tabIndex={0}
                          onClick={() => navigate(`/cases/${c.case_id}`)}
                          onKeyDown={(e) => e.key === 'Enter' && navigate(`/cases/${c.case_id}`)}
                        >
                          <td className="mono tiny">{c.case_number}</td>
                          <td className="mono tiny">{c.display_id ?? c.parcel_id}</td>
                          <td>
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="tiny muted">{formatDate(c.created_at)}</td>
                          <td className="tiny muted">{formatDateTime(c.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </TabPanel>
      </GlassCard>
    </div>
  );
}

function CitizenParcelPanel({
  parcelId,
  loading,
  error,
  data,
  onRetry,
}: {
  parcelId: string;
  loading: boolean;
  error: unknown;
  data: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.passport>>>>['data'];
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const { pushToast, reportError, user } = useApp();

  if (loading) return <LoadingState lines={4} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;

  const s = data.executiveSummary;

  const download = async () => {
    try {
      await downloadExport(csvExportUrl(parcelId), `bhumisetu-${parcelId}-summary.csv`);
      pushToast({ kind: 'success', title: 'Summary downloaded', body: 'The export carries the platform disclaimer.' });
    } catch (err) {
      reportError(err, 'Download');
    }
  };

  return (
    <GlassPanel>
      <CardHead
        title={s.displayId}
        subtitle={`${s.village}, ${s.district} · ${formatArea(s.areaSqft)}`}
        actions={<RiskBadge band={s.riskBand} score={s.score} />}
      />

      <div className="grid grid-4">
        <MetricCard label="Verification status" value={<StatusBadge status={s.verificationStatus} />} />
        <MetricCard label="Open cases" value={formatNumber(s.openCases)} />
        <MetricCard label="Recorded holder" value={<span className="small">{data.ownership.currentRecordedHolder ?? '—'}</span>} hint="Personal identifiers are masked" />
        <MetricCard label="Data quality" value={`${s.dataQualityScore}/100`} tone="info" />
      </div>

      <div className="divider" />
      <div className="label">Findings that may affect you</div>
      {data.findings.length === 0 ? (
        <EmptyState title="No issues detected" icon="✓" body="The records linked to this parcel are consistent in the available dataset." />
      ) : (
        <div className="stack" style={{ gap: 9 }}>
          {data.findings.map((f) => (
            <div className={`finding-card finding-${f.severity}`} key={f.findingId}>
              <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                <StatusBadge status={f.severity} />
                <span className="badge badge-neutral mono tiny">{f.ruleCode}</span>
              </div>
              <div style={{ fontWeight: 620, marginTop: 5 }}>{f.title}</div>
              <p className="small muted" style={{ margin: '5px 0 0' }}>
                {f.description}
              </p>
              <div className="tiny muted" style={{ marginTop: 5 }}>
                What happens next: {f.recommendedAction}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="divider" />
      <div className="label">Where this information comes from</div>
      <div className="stack" style={{ gap: 6, marginTop: 5 }}>
        {data.sources.slice(0, 6).map((src) => (
          <div className="row-between" key={`${src.sourceId}-${src.source}`}>
            <span className="small">{src.source}</span>
            <span className="chip-row">
              <DataStatusChip status={src.dataStatus} short />
              <span className="tiny muted">{src.sourceAuthority}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="divider" />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={() => void download()}>
          Download summary (CSV)
        </button>
        <button type="button" className="btn btn-sm" onClick={() => navigate(`/passport/${parcelId}`)}>
          Open full land passport
        </button>
        {user ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => navigate(`/cases/new?parcelId=${encodeURIComponent(parcelId)}`)}
          >
            Request verification
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/login')}>
            Sign in to request verification
          </button>
        )}
      </div>

      <div className="divider" />
      <ProvenanceNotice tone="demo">
        {data.header.datasetNotice}. {data.header.disclaimer}
      </ProvenanceNotice>
    </GlassPanel>
  );
}

function CitizenRequests({
  signedIn,
  loading,
  error,
  requests,
  onReload,
  onSignIn,
}: {
  signedIn: boolean;
  loading: boolean;
  error: unknown;
  requests: Awaited<ReturnType<typeof api.serviceRequests>>['items'];
  onReload: () => void;
  onSignIn: () => void;
}) {
  const { pushToast, reportError } = useApp();
  const [requestType, setRequestType] = useState<string>('OWNERSHIP_VERIFICATION');
  const [parcelId, setParcelId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: string[] = [];
    if (subject.trim().length < 4) errs.push('Provide a subject of at least 4 characters.');
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const created = await api.createServiceRequest({
        parcelId: parcelId.trim() || null,
        requestType,
        subject: subject.trim(),
        description: description.trim(),
      });
      pushToast({
        kind: 'success',
        title: `Request ${created.reference_number} submitted`,
        body: 'You will be able to track its status here.',
      });
      setSubject('');
      setDescription('');
      setParcelId('');
      onReload();
    } catch (err) {
      reportError(err, 'Service request');
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <EmptyState
        title="Sign in to raise a request"
        icon="⚿"
        body="Service requests are tied to your account so you can track their progress. Sign in to submit one."
        action={
          <button type="button" className="btn btn-primary" onClick={onSignIn}>
            Sign in
          </button>
        }
      />
    );
  }

  return (
    <div className="grid grid-2">
      <GlassPanel>
        <CardHead title="Raise a service request" subtitle="Choose the request type that matches your need" />
        <FieldErrors errors={errors} />
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="request-type">Request type</label>
            <select id="request-type" className="select" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="request-parcel">Parcel identifier (optional)</label>
            <input
              id="request-parcel"
              className="input"
              value={parcelId}
              onChange={(e) => setParcelId(e.target.value)}
              placeholder="e.g. 3301DEMO000042"
            />
          </div>
          <div className="field">
            <label htmlFor="request-subject">Subject</label>
            <input
              id="request-subject"
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your request"
              minLength={4}
            />
          </div>
          <div className="field">
            <label htmlFor="request-description">Details</label>
            <textarea
              id="request-description"
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you need. Do not include identity numbers or sensitive personal information."
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            Submit request
          </button>
          <span className="tiny muted">
            Please do not enter Aadhaar numbers or other sensitive identifiers. BHUMISETU does not collect them.
          </span>
        </div>
      </GlassPanel>

      <GlassPanel>
        <CardHead title="My requests" subtitle="Track the status of everything you have submitted" />
        {loading ? (
          <LoadingState lines={4} />
        ) : error ? (
          <ErrorState error={error} onRetry={onReload} />
        ) : requests.length === 0 ? (
          <EmptyState
            title="No requests yet"
            icon="▤"
            body="You have not submitted a service request. Use the form to raise one; you can track its progress here."
          />
        ) : (
          <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
            {requests.map((r) => (
              <li className="glass-inset card-tight" key={r.request_id}>
                <div className="row-between">
                  <span className="mono tiny">{r.reference_number}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="small" style={{ marginTop: 3 }}>
                  {r.subject}
                </div>
                <div className="tiny muted">
                  {r.request_type.replace(/_/g, ' ')} · {r.parcel_id ?? 'no parcel'} ·{' '}
                  {r.assigned_department ?? 'awaiting routing'} · {formatDate(r.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="divider" />
        <div className="tiny muted">
          Requests progress through SUBMITTED → ACKNOWLEDGED → UNDER REVIEW → FIELD VERIFICATION → RESOLVED or
          REJECTED. Every transition is recorded against your request.
        </div>
      </GlassPanel>
    </div>
  );
}
