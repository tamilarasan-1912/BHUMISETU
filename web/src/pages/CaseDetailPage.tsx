import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';
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
  InlineSpinner,
  LoadingState,
  ProvenanceNotice,
  RiskBadge,
  StatusBadge,
  TabPanel,
  Tabs,
  Timeline,
  formatDate,
  formatDateTime,
} from '../components/ui';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'risk', label: 'Risk' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'records', label: 'Records' },
  { id: 'context', label: 'Spatial context' },
  { id: 'history', label: 'History' },
  { id: 'actions', label: 'Actions' },
];

export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const { user, reportError, pushToast } = useApp();
  const [tab, setTab] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [commentVisibility, setCommentVisibility] = useState<'INTERNAL' | 'PUBLIC'>('INTERNAL');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const state = useAsync((s) => api.case(caseId, s), [caseId]);
  const parcelDetail = useAsync((s) => api.parcel(state.data?.parcel_id ?? '', s), [state.data?.parcel_id], {
    enabled: Boolean(state.data?.parcel_id),
  });
  const officers = useAsync((s) => api.officers(s), [], {
    enabled: Boolean(user?.permissions.includes('case.assign')),
  });

  const canUpdate = Boolean(user?.permissions.includes('case.update'));
  const canAssign = Boolean(user?.permissions.includes('case.assign'));

  const act = async (
    body: Omit<Parameters<typeof api.updateCase>[1], 'reason'> & { reason?: string },
    successMessage: string,
  ) => {
    // The audit trail requires a reason for every action; fall back to a
    // generated one only when the officer has not supplied their own.
    const effectiveReason = reason.trim() || body.reason?.trim() || '';
    if (effectiveReason.length < 3) {
      setErrors(['Provide a reason of at least 3 characters — it is written to the audit trail.']);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await api.updateCase(caseId, { ...body, reason: effectiveReason });
      pushToast({ kind: 'success', title: successMessage });
      setReason('');
      setComment('');
      state.reload();
    } catch (err) {
      reportError(err, 'Case update');
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return (
      <div className="page">
        <LoadingState lines={6} label="Loading case" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="page stack">
        <ErrorState title="Case unavailable" error={state.error} onRetry={state.reload}>
          The case may not exist, or it may be outside your role's scope. Citizens can only open cases they raised.
        </ErrorState>
        <button type="button" className="btn" onClick={() => navigate('/cases')}>
          Back to cases
        </button>
      </div>
    );
  }
  const c = state.data;
  if (!c) return null;

  const parcel = parcelDetail.data;

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <GlassPanel>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>{c.title}</h1>
              <StatusBadge status={c.status} />
              <span className={`badge badge-${c.priority === 'URGENT' ? 'danger' : c.priority === 'HIGH' ? 'warn' : 'neutral'}`}>
                {c.priority}
              </span>
              {c.maskingApplied ? <span className="badge badge-neutral">masked view</span> : null}
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              <span className="mono">{c.case_number}</span> · parcel{' '}
              <button
                type="button"
                className="link-btn mono"
                onClick={() => navigate(`/passport/${c.parcel_id}`)}
              >
                {c.parcel_id}
              </button>
              {' · '}
              {c.assigned_department ?? c.assigned_role ?? 'unassigned'} · created {formatDateTime(c.created_at)} ·
              updated {formatDateTime(c.updated_at)}
              {c.due_date ? ` · due ${formatDate(c.due_date)}` : ''}
            </p>
          </div>
          <div className="chip-row">
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/passport/${c.parcel_id}`)}>
              Land Passport
            </button>
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/intelligence/${c.parcel_id}`)}>
              Intelligence
            </button>
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <GlassPanel className="card-tight">
            <div className="label">Parcel</div>
            <div className="mono small">{c.parcel_id}</div>
            <div className="tiny muted">
              {parcel ? `${parcel.parcel.village}, ${parcel.parcel.district}` : 'location not loaded'}
            </div>
          </GlassPanel>
          <GlassPanel className="card-tight">
            <div className="label">Findings referenced</div>
            <div className="metric-value" style={{ fontSize: 18 }}>
              {c.findings.length}
            </div>
          </GlassPanel>
          <GlassPanel className="card-tight">
            <div className="label">Evidence records</div>
            <div className="metric-value" style={{ fontSize: 18 }}>
              {parcel?.evidence.length ?? 0}
            </div>
          </GlassPanel>
          <GlassPanel className="card-tight">
            <div className="label">Events</div>
            <div className="metric-value" style={{ fontSize: 18 }}>
              {c.events.length}
            </div>
          </GlassPanel>
        </div>
      </GlassPanel>

      <GlassCard>
        <Tabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Case sections" />
        <TabPanel id={`case-${tab}`} labelledBy={`case-${tab}`}>
          {tab === 'summary' ? (
            <div className="grid grid-2">
              <GlassPanel>
                <CardHead title="Case summary" subtitle="What is being verified and why" />
                <dl className="kv">
                  <dt>Case number</dt>
                  <dd className="mono">{c.case_number}</dd>
                  <dt>Origin</dt>
                  <dd>{c.origin.replace(/_/g, ' ')}</dd>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={c.status} />
                  </dd>
                  <dt>Priority</dt>
                  <dd>{c.priority}</dd>
                  <dt>Routed department</dt>
                  <dd>{c.assigned_department ?? '—'}</dd>
                  <dt>Routed role</dt>
                  <dd>{c.assigned_role ?? '—'}</dd>
                  <dt>Assigned officer</dt>
                  <dd>{c.officer_name ?? 'Unassigned'}</dd>
                  <dt>Due date</dt>
                  <dd>{c.due_date ? formatDate(c.due_date) : '—'}</dd>
                  <dt>Resolution note</dt>
                  <dd className="small">{c.resolution_note ?? '—'}</dd>
                </dl>
                <div className="divider" />
                <div className="label">Description</div>
                <p className="small">{c.description || 'No description recorded on this case.'}</p>
              </GlassPanel>

              <GlassPanel>
                <CardHead title="Referenced findings" subtitle="The integrity findings this case rests on" />
                {c.findings.length === 0 ? (
                  <EmptyState title="No finding referenced" icon="⚑" body="This case was not raised against a specific integrity finding — for example a citizen request or a coverage gap." />
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {c.findings.map((f) => (
                      <div className="glass-inset card-tight" key={f.finding_id}>
                        <div className="row-between">
                          <span className="badge badge-neutral mono tiny">{f.rule_code}</span>
                          <StatusBadge status={f.severity} />
                        </div>
                        <div className="small" style={{ marginTop: 4 }}>
                          {f.title}
                        </div>
                        <div className="tiny muted">Finding status: {f.status.replace(/_/g, ' ')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassPanel>
            </div>
          ) : null}

          {tab === 'risk' ? (
            <div className="grid grid-2">
              <GlassPanel>
                <CardHead title="Parcel risk" subtitle="Verification-support band and score from the integrity engine" />
                {parcelDetail.loading ? (
                  <LoadingState lines={3} />
                ) : !parcel ? (
                  <EmptyState title="Parcel not loaded" body="The parcel detail could not be loaded for this case." />
                ) : (
                  <>
                    <div className="row" style={{ gap: 14 }}>
                      <div className="metric-value" style={{ fontSize: 34 }}>
                        {parcel.score.score}
                      </div>
                      <div>
                        <RiskBadge band={parcel.score.band} />
                        <div className="tiny muted">Internal indicator — not a legal score.</div>
                      </div>
                    </div>
                    <div className="divider" />
                    {parcel.score.deductions.length === 0 ? (
                      <EmptyState title="No deductions" icon="✓" body="No rule deducted points for this parcel." />
                    ) : (
                      <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                        {parcel.score.deductions.map((d) => (
                          <li className="glass-inset card-tight row-between" key={d.ruleCode}>
                            <div>
                              <div className="small">{d.label}</div>
                              <div className="tiny muted">{d.reason}</div>
                            </div>
                            <span className="badge badge-warn mono">{d.points}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </GlassPanel>
              <GlassPanel>
                <CardHead title="Data quality" subtitle="Completeness, consistency, freshness and linkage" />
                {parcel ? (
                  <div className="chart">
                    {[
                      ['Completeness', parcel.quality.completeness],
                      ['Consistency', parcel.quality.consistency],
                      ['Freshness', parcel.quality.freshness],
                      ['Linkage', parcel.quality.linkage],
                      ['Geometry validity', parcel.quality.geometryValidity],
                      ['Source availability', parcel.quality.sourceAvailability],
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
                ) : (
                  <LoadingState lines={3} />
                )}
              </GlassPanel>
            </div>
          ) : null}

          {tab === 'evidence' ? (
            <GlassPanel>
              <CardHead title="Evidence" subtitle="Finding → evidence → source → record → authority" />
              {parcelDetail.loading ? (
                <LoadingState lines={4} />
              ) : !parcel || parcel.evidence.length === 0 ? (
                <EmptyState
                  title="No evidence records"
                  icon="▤"
                  body="No evidence chain is attached to this parcel's findings. Evidence is created only where the engine compared records and found a discrepancy."
                />
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {parcel.evidence.map((e) => (
                    <details className="evidence-card" key={e.evidenceId}>
                      <summary>
                        <span className="mono tiny">{e.field}</span>
                        <DataStatusChip status={e.dataStatus} short />
                        <span className="grow truncate tiny muted">{e.source}</span>
                      </summary>
                      <div className="evidence-body">
                        <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
                          <div>
                            <div className="label">Observed</div>
                            <div className="small mono">{e.observedValue ?? '—'}</div>
                          </div>
                          <div>
                            <div className="label">Expected</div>
                            <div className="small mono">{e.expectedValue ?? '—'}</div>
                          </div>
                        </div>
                        <div className="chain">
                          <div className="chain-step">
                            <b>Source</b>
                            <span>{e.source}</span>
                          </div>
                          <div className="chain-step">
                            <b>Record</b>
                            <span className="mono tiny">
                              {e.recordTable} · {e.recordId.slice(0, 22)}
                            </span>
                          </div>
                          <div className="chain-step">
                            <b>Authority</b>
                            <span>{e.sourceAuthority}</span>
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </GlassPanel>
          ) : null}

          {tab === 'records' ? (
            <GlassPanel>
              <CardHead title="Source records" subtitle="Records the officer should compare to close this case" />
              {parcelDetail.loading ? (
                <LoadingState lines={4} />
              ) : !parcel ? (
                <EmptyState title="Parcel not loaded" body="The source records could not be loaded." />
              ) : (
                <div className="stack" style={{ gap: 12 }}>
                  <RecordBlock title="Record of Rights" rows={parcel.records.ror ?? []} columns={['record_number', 'owner_name', 'asserted_area_sqft', 'recorded_at']} />
                  <RecordBlock title="Registrations" rows={parcel.records.registrations ?? []} columns={['document_number', 'document_type', 'registration_date', 'status']} />
                  <RecordBlock title="Deeds" rows={parcel.records.deeds ?? []} columns={['deed_number', 'transferor_name', 'transferee_name', 'execution_date']} />
                  <RecordBlock title="Tax records" rows={parcel.records.tax ?? []} columns={['tax_period', 'assessment_number', 'due_amount', 'last_payment_date']} />
                  <RecordBlock title="Encumbrances" rows={parcel.records.encumbrances ?? []} columns={['encumbrance_type', 'holder_name', 'is_active', 'noc_status']} />
                  <RecordBlock title="Building permissions" rows={parcel.records.buildingPermissions ?? []} columns={['permission_number', 'building_use', 'approval_date', 'status']} />
                  <RecordBlock title="Judiciary" rows={parcel.records.judiciary ?? []} columns={['case_number', 'court', 'case_type', 'status']} />
                </div>
              )}
            </GlassPanel>
          ) : null}

          {tab === 'context' ? (
            <SpatialContextBlock parcelId={c.parcel_id} />
          ) : null}

          {tab === 'history' ? (
            <div className="grid grid-2">
              <GlassPanel>
                <CardHead title="Case events" subtitle="Every transition, assignment, comment and escalation" />
                {c.events.length === 0 ? (
                  <EmptyState title="No events" body="No case event has been recorded yet." />
                ) : (
                  <Timeline
                    events={c.events.map((e) => ({
                      at: e.created_at,
                      kind: e.event_type,
                      title: e.description,
                      description:
                        e.from_status && e.to_status ? `${e.from_status} → ${e.to_status}` : 'Status recorded',
                      source: 'Case workflow',
                      actor: `${e.actor} (${e.actor_role})`,
                      dataStatus: 'REAL' as const,
                      visibility: e.visibility,
                    }))}
                  />
                )}
              </GlassPanel>
              <div className="stack">
                <GlassPanel>
                  <CardHead title="Comments" subtitle={c.maskingApplied ? 'Public comments only for your role' : 'All comments'} />
                  {c.comments.length === 0 ? (
                    <EmptyState title="No comments" body="No comment has been added to this case." />
                  ) : (
                    <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
                      {c.comments.map((cm) => (
                        <li className="glass-inset card-tight" key={cm.comment_id}>
                          <div className="row-between">
                            <span className="small" style={{ fontWeight: 620 }}>
                              {cm.author_name}
                            </span>
                            <span className={`badge badge-${cm.visibility === 'INTERNAL' ? 'warn' : 'ok'}`}>
                              {cm.visibility}
                            </span>
                          </div>
                          <div className="small" style={{ marginTop: 4 }}>
                            {cm.body}
                          </div>
                          <div className="tiny muted">
                            {cm.author_role} · {formatDateTime(cm.created_at)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassPanel>
                <GlassPanel>
                  <CardHead title="Assignments" subtitle="Routing history" />
                  {c.assignments.length === 0 ? (
                    <EmptyState title="No assignments" body="The case has not been explicitly assigned." />
                  ) : (
                    <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                      {c.assignments.map((a) => (
                        <li className="glass-inset card-tight" key={a.assignment_id}>
                          <div className="row-between">
                            <span className="small">
                              {a.department ?? a.assigned_role ?? '—'} · {a.assignee_name ?? 'unassigned'}
                            </span>
                            {a.is_current ? <span className="badge badge-ok">current</span> : null}
                          </div>
                          <div className="tiny muted">{a.note}</div>
                          <div className="tiny muted">{formatDateTime(a.created_at)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassPanel>
              </div>
            </div>
          ) : null}

          {tab === 'actions' ? (
            <div className="grid grid-2">
              <GlassPanel>
                <CardHead title="Workflow actions" subtitle="Each action writes a case event and an audit record" />
                {!canUpdate ? (
                  <EmptyState
                    title="Read-only for your role"
                    icon="⚑"
                    body="Your role can view this case but cannot change its state. Officers and administrators hold the case.update permission."
                  />
                ) : (
                  <div className="stack">
                    <FieldErrors errors={errors} />
                    <div className="field">
                      <label htmlFor="action-reason">Reason (written to the audit trail)</label>
                      <input
                        id="action-reason"
                        className="input"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this action being taken?"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="action-comment">Comment (optional)</label>
                      <textarea
                        id="action-comment"
                        className="textarea"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Add a note for the case history."
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="action-visibility">Comment visibility</label>
                      <select
                        id="action-visibility"
                        className="select"
                        value={commentVisibility}
                        onChange={(e) => setCommentVisibility(e.target.value as 'INTERNAL' | 'PUBLIC')}
                      >
                        <option value="INTERNAL">Internal (officers only)</option>
                        <option value="PUBLIC">Public (visible to the citizen)</option>
                      </select>
                    </div>
                    <div className="divider" />
                    <div className="label">Permitted transitions from {c.status}</div>
                    <div className="chip-row">
                      {c.availableTransitions.length === 0 ? (
                        <span className="small muted">No further transitions — this case is closed.</span>
                      ) : (
                        c.availableTransitions.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                { status: t, comment: comment.trim() || null, commentVisibility },
                                `Case moved to ${t.replace(/_/g, ' ')}`,
                              )
                            }
                          >
                            {t.replace(/_/g, ' ')}
                          </button>
                        ))
                      )}
                    </div>
                    {busy ? <InlineSpinner label="Applying update…" /> : null}
                  </div>
                )}
              </GlassPanel>

              <div className="stack">
                {canAssign ? (
                  <GlassPanel>
                    <CardHead title="Assign and escalate" subtitle="Route the case to an officer or another department" />
                    <div className="stack">
                      <div className="field">
                        <label htmlFor="assign-officer">Assign officer</label>
                        <select
                          id="assign-officer"
                          className="select"
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            void act({ assignedOfficer: v }, 'Officer assigned');
                          }}
                          disabled={busy}
                        >
                          <option value="">Select an officer…</option>
                          {(officers.data?.items ?? []).map((o) => (
                            <option key={o.user_id} value={o.user_id}>
                              {o.full_name} — {o.role_label}
                              {o.department ? ` (${o.department})` : ''}
                            </option>
                          ))}
                        </select>
                        {officers.loading ? <span className="tiny muted">Loading officers…</span> : null}
                        {officers.error ? (
                          <span className="tiny muted">
                            Officer list is restricted for your role. Use the department routing below instead.
                          </span>
                        ) : null}
                      </div>
                      <div className="field">
                        <label>Quick routing actions</label>
                        <div className="chip-row">
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy || !c.availableTransitions.includes('FIELD_VERIFICATION')}
                            onClick={() =>
                              void act({ status: 'FIELD_VERIFICATION', comment: comment.trim() || null }, 'Sent for field verification')
                            }
                          >
                            Field verification
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy || !c.availableTransitions.includes('ESCALATED')}
                            onClick={() => void act({ status: 'ESCALATED', comment: comment.trim() || null }, 'Case escalated')}
                          >
                            Escalate
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busy || !c.availableTransitions.includes('RESOLVED')}
                            onClick={() =>
                              void act(
                                {
                                  status: 'RESOLVED',
                                  comment: comment.trim() || null,
                                  resolutionNote: reason.trim() || 'Resolved after review.',
                                },
                                'Case resolved',
                              )
                            }
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="assign-dept">Route to department</label>
                        <select
                          id="assign-dept"
                          className="select"
                          defaultValue=""
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            void act({ assignedDepartment: v }, `Routed to ${v}`);
                          }}
                        >
                          <option value="">Select a department…</option>
                          {['Revenue', 'Registration', 'Municipal Tax', 'Planning', 'Judiciary', 'Survey/GIS'].map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </GlassPanel>
                ) : null}

                <GlassPanel>
                  <CardHead title="Case report" subtitle="Generated views carry the platform disclaimer" />
                  <div className="chip-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          const report = await api.reportParcel(c.parcel_id);
                          const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `bhumisetu-case-${c.case_number}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          reportError(err, 'Report');
                        }
                      }}
                    >
                      Download case context (JSON)
                    </button>
                  </div>
                  <div className="divider" />
                  <ProvenanceNotice tone="demo">
                    This report is a digital information and verification-support view. It does not by itself
                    constitute a legal determination, title certificate, ownership certificate, or government record.
                  </ProvenanceNotice>
                </GlassPanel>
              </div>
            </div>
          ) : null}
        </TabPanel>
      </GlassCard>
    </div>
  );
}

function RecordBlock({ title, rows, columns }: { title: string; rows: unknown[]; columns: string[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <div className="label">{title}</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          No {title.toLowerCase()} record is linked to this parcel — a data coverage gap for this deployment.
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>
        {title}
      </div>
      <div className="table-wrap">
        <table className="data" style={{ minWidth: 460 }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} scope="col">
                  {col.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const row = r as Record<string, unknown>;
              return (
                <tr key={`${title}-${i}`}>
                  {columns.map((col) => (
                    <td key={col} className="small">
                      {row[col] === null || row[col] === undefined ? '—' : String(row[col])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpatialContextBlock({ parcelId }: { parcelId: string }) {
  const ctx = useAsync((s) => api.osmContext({ parcelId, radius: 600 }, s), [parcelId]);
  if (ctx.loading) return <LoadingState lines={4} />;
  if (ctx.error) {
    return (
      <ProvenanceNotice tone="warn">
        The contextual service is unavailable right now. Core case workflow remains operational.
      </ProvenanceNotice>
    );
  }
  const data = ctx.data;
  if (!data) return null;
  if (data.unavailable) {
    return (
      <div className="stack">
        <ProvenanceNotice tone="warn">{data.message} Core case workflow remains operational.</ProvenanceNotice>
        <EmptyState title="Contextual layers unavailable" body="Roads, buildings, waterways and amenities all come from the same contextual service." />
      </div>
    );
  }
  return (
    <div className="stack">
      <ProvenanceNotice tone="context">
        <strong>CONTEXTUAL GIS INFORMATION</strong> from OpenStreetMap. Not cadastral, ownership or legal data.
      </ProvenanceNotice>
      <div className="grid grid-3">
        <GlassPanel>
          <CardHead title="Roads" subtitle={`${data.roads.length} feature(s) within ${data.radius} m`} />
          {data.roads.length === 0 ? (
            <EmptyState title="No roads" body="No highway feature was returned for this radius." />
          ) : (
            <ul className="pill-list" style={{ flexDirection: 'column', gap: 5 }}>
              {data.roads.slice(0, 10).map((r) => (
                <li key={r.id} className="small row-between" style={{ width: '100%' }}>
                  <span className="truncate">{r.name ?? 'Unnamed'}</span>
                  <span className="tiny muted">{r.distanceM === null ? '—' : `${Math.round(r.distanceM)} m`}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
        <GlassPanel>
          <CardHead title="Water" subtitle={`${data.water.length} feature(s)`} />
          {data.water.length === 0 ? (
            <EmptyState title="No water features" body="No waterway or water body was returned." />
          ) : (
            <ul className="pill-list" style={{ flexDirection: 'column', gap: 5 }}>
              {data.water.slice(0, 10).map((w) => (
                <li key={w.id} className="small">
                  {w.name ?? w.waterType}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
        <GlassPanel>
          <CardHead title="Buildings" subtitle={`${data.buildings.length} feature(s)`} />
          {data.buildings.length === 0 ? (
            <EmptyState title="No building footprints" body="No building feature was returned for this radius." />
          ) : (
            <div className="small muted">{data.buildings.length} footprint(s) mapped within the radius.</div>
          )}
        </GlassPanel>
      </div>
      <div className="tiny muted">{data.licence}</div>
    </div>
  );
}
