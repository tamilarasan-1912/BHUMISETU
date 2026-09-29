import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  DataStatusChip,
  EmptyState,
  ErrorState,
  FieldErrors,
  FindingCard,
  GlassCard,
  GlassPanel,
  LoadingState,
  ProvenanceNotice,
  RiskBadge,
  SearchBar,
  StatusBadge,
  formatArea,
  formatNumber,
} from '../components/ui';
import type { IntegrityFinding } from '../types/api';

/**
 * Case creation. The parcel is chosen first, then the integrity findings on that
 * parcel are offered as the basis, and routing is derived from the finding's
 * authority mapping unless the officer overrides it.
 */
export function NewCasePage() {
  const navigate = useNavigate();
  const { pushToast, reportError, user } = useApp();
  const [params] = useSearchParams();
  const initialParcel = params.get('parcelId') ?? '';

  const [parcelQuery, setParcelQuery] = useState(initialParcel);
  const [parcelId, setParcelId] = useState(initialParcel);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [selectedFindings, setSelectedFindings] = useState<string[]>([]);
  const [department, setDepartment] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const parcels = useAsync((s) => api.parcels({ limit: 100 }, s), []);
  const selectedParcel = useMemo(
    () => (parcels.data?.items ?? []).find((p) => p.parcelId === parcelId || p.displayId === parcelId),
    [parcels.data, parcelId],
  );

  const detail = useAsync((s) => api.parcel(parcelId, s), [parcelId], { enabled: Boolean(parcelId) });

  const findings: IntegrityFinding[] = detail.data?.findings ?? [];

  useEffect(() => {
    if (!parcelId || findings.length === 0) return;
    if (selectedFindings.length > 0) return;
    // Default to every finding on the parcel — the case then routes to the
    // highest-priority mapped authority.
    setSelectedFindings(findings.map((f) => f.findingId));
    if (!title) {
      setTitle(`${findings.map((f) => f.ruleCode).join(', ')} — ${selectedParcel?.displayId ?? parcelId}`);
    }
  }, [findings, parcelId, selectedFindings.length, title, selectedParcel]);

  const departments = useMemo(() => {
    const set = new Set(findings.map((f) => f.routedAuthority));
    return [...set].sort();
  }, [findings]);

  const submit = async () => {
    const errs: string[] = [];
    if (!parcelId) errs.push('Select a parcel for this case.');
    if (title.trim().length < 4) errs.push('Provide a title of at least 4 characters.');
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const created = await api.createCase({
        parcelId,
        title: title.trim(),
        description: description.trim(),
        priority,
        findingRefs: selectedFindings,
        assignedDepartment: department || null,
        dueDate: dueDate || null,
      });
      pushToast({
        kind: 'success',
        title: `Case ${created.case_number} submitted`,
        body: created.assigned_department
          ? `Routed to ${created.assigned_department}.`
          : 'Awaiting officer assignment.',
      });
      navigate(`/cases/${created.case_id}`);
    } catch (err) {
      reportError(err, 'Create case');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>New verification case</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '84ch' }}>
            A case records the discrepancy, the evidence relied on and the authority responsible for reconciliation.
            Creation writes a case event and an audit record.
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('/cases')}>
          Back to cases
        </button>
      </div>

      <div className="grid grid-2-start">
        <GlassCard>
          <CardHead title="Step 1 — Select the parcel" subtitle="Search by identifier, survey number, owner or village" />
          <SearchBar
            id="case-parcel-search"
            value={parcelQuery}
            onChange={setParcelQuery}
            onSubmit={() => setParcelId(parcelQuery.trim())}
            placeholder="e.g. 3301DEMO000042 or PARC-B"
          />
          <div className="chip-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setParcelId(parcelQuery.trim())}
              disabled={!parcelQuery.trim()}
            >
              Load parcel
            </button>
            <span className="tiny muted">Parcel: <span className="mono">{parcelId || 'none selected'}</span></span>
          </div>

          <div className="divider" />

          {detail.loading && parcelId ? (
            <LoadingState lines={3} />
          ) : detail.error && parcelId ? (
            <ErrorState title="Parcel not found" error={detail.error} />
          ) : selectedParcel ? (
            <div className="glass-inset card-tight">
              <div className="row-between">
                <span className="mono small">{selectedParcel.displayId}</span>
                <RiskBadge band={selectedParcel.riskBand} score={selectedParcel.score} />
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                {selectedParcel.village}, {selectedParcel.district} · {formatArea(selectedParcel.areaSqft)}
              </div>
              <div className="tiny muted">
                {selectedParcel.parcelId} · survey {selectedParcel.surveyNumber ?? '—'} ·{' '}
                {selectedParcel.findingCount} finding(s)
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="label">Demonstration parcels</div>
              <ul className="pill-list" style={{ flexDirection: 'column', gap: 5 }}>
                {(parcels.data?.items ?? []).map((p) => (
                  <li key={p.parcelId}>
                    <button
                      type="button"
                      className="link-btn small"
                      onClick={() => {
                        setParcelId(p.parcelId);
                        setParcelQuery(p.parcelId);
                      }}
                    >
                      <span className="mono">{p.displayId}</span> · {p.parcelId} · {p.village}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <CardHead title="Step 2 — Case details" subtitle="Title, priority, routing and due date" />
          <div className="stack">
            <FieldErrors errors={errors} />
            <div className="field">
              <label htmlFor="case-title">Title</label>
              <input
                id="case-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ownership records require reconciliation"
                required
                minLength={4}
              />
            </div>
            <div className="field">
              <label htmlFor="case-description">Description</label>
              <textarea
                id="case-description"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the discrepancy, the records compared and what the officer should verify."
              />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="case-priority">Priority</label>
                <select id="case-priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="case-due">Due date</label>
                <input
                  id="case-due"
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="case-dept">Route to department (optional)</label>
              <select id="case-dept" className="select" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">Derive from the selected findings</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="tiny muted">
                Leaving this unset routes the case to the authority mapped to the findings you select.
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <CardHead
          title="Step 3 — Findings relied on"
          subtitle={
            parcelId
              ? `${findings.length} finding(s) resolved for this parcel by the integrity engine`
              : 'Select a parcel to load its integrity findings'
          }
          actions={
            findings.length > 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setSelectedFindings(
                    selectedFindings.length === findings.length ? [] : findings.map((f) => f.findingId),
                  )
                }
              >
                {selectedFindings.length === findings.length ? 'Clear selection' : 'Select all'}
              </button>
            ) : null
          }
        />
        {!parcelId ? (
          <EmptyState title="No parcel selected" icon="◉" body="Select a parcel above to load the findings available to raise a case against." />
        ) : detail.loading ? (
          <LoadingState lines={3} />
        ) : findings.length === 0 ? (
          <EmptyState
            title="No integrity findings on this parcel"
            icon="✓"
            body="The integrity engine raised no discrepancy, so there is no evidence-backed basis for a case. A case can still be created for a citizen request or a coverage gap, but it will not reference a finding."
          />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {findings.map((f) => (
              <div key={f.findingId} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <label className="checkbox" style={{ paddingTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={selectedFindings.includes(f.findingId)}
                    onChange={(e) =>
                      setSelectedFindings((prev) =>
                        e.target.checked ? [...prev, f.findingId] : prev.filter((id) => id !== f.findingId),
                      )
                    }
                    aria-label={`Include finding ${f.ruleCode}`}
                  />
                </label>
                <div className="grow">
                  <FindingCard finding={f} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="divider" />
        <ProvenanceNotice tone="demo">
          Findings are verification-support signals produced by the rules engine. Raising a case records a request to
          reconcile records; it is not a finding of fraud, illegality or invalid ownership.
        </ProvenanceNotice>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => navigate('/cases')} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <span className="spinner" aria-hidden="true" /> : null}
            Submit case
          </button>
        </div>
      </GlassCard>

      {detail.data ? (
        <GlassPanel>
          <CardHead title="Context for the selected parcel" subtitle="What the officer will be looking at" />
          <div className="grid grid-3">
            <div>
              <div className="label">Linkage</div>
              <div className="small">
                <StatusBadge status={detail.data.linkage.state} />
              </div>
              <div className="tiny muted">{detail.data.linkage.reason}</div>
            </div>
            <div>
              <div className="label">Data quality</div>
              <div className="metric-value" style={{ fontSize: 18 }}>
                {formatNumber(detail.data.quality.score)}/100
              </div>
            </div>
            <div>
              <div className="label">Parcel data status</div>
              <DataStatusChip status={detail.data.parcel.dataStatus} />
            </div>
          </div>
        </GlassPanel>
      ) : null}
    </div>
  );
}
