import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  LoadingState,
  MetricCard,
  ProvenanceNotice,
  StatusBadge,
  TabPanel,
  Tabs,
  formatDateTime,
  formatNumber,
} from '../components/ui';

const TABS = [
  { id: 'sources', label: 'Data sources' },
  { id: 'layers', label: 'GIS layers' },
  { id: 'rules', label: 'Integrity rules' },
  { id: 'authorities', label: 'Authorities' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'users', label: 'Users & roles' },
  { id: 'audit', label: 'Audit logs' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'health', label: 'System health' },
];

export function StudioPage() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [tab, setTab] = useState('sources');

  const overview = useAsync((s) => api.adminOverview(s), []);

  if (!user) return null;

  const canAny =
    user.permissions.includes('user.manage') ||
    user.permissions.includes('source.configure') ||
    user.permissions.includes('rule.configure') ||
    user.permissions.includes('audit.read');

  if (!canAny) {
    return (
      <div className="page">
        <EmptyState
          title="Administrative access required"
          icon="⛔"
          body={`You are signed in as ${user.roleLabel}. The studio needs one of: user.manage, source.configure, rule.configure or audit.read.`}
        />
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Administrative studio</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '90ch' }}>
            Source catalogue, layer management, rule configuration, authority mapping, workflow definitions, users,
            roles and audit inspection. Every configuration change is written to the audit trail with a reason.
          </p>
        </div>
        <div className="chip-row">
          <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
            Data fabric
          </button>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/studio/health')}>
            System health
          </button>
        </div>
      </div>

      {overview.loading ? (
        <LoadingState lines={3} />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      ) : (
        <div className="grid grid-4">
          <MetricCard label="Users" value={formatNumber(overview.data?.users.length)} hint={`${overview.data?.roles.length ?? 0} roles`} />
          <MetricCard label="Open cases" value={formatNumber(overview.data?.openCases)} tone="warn" />
          <MetricCard label="Audit entries" value={formatNumber(overview.data?.auditCount)} hint="Append-only" />
          <MetricCard
            label="Degraded sources"
            value={formatNumber(overview.data?.sources.degraded)}
            tone={overview.data && overview.data.sources.degraded > 0 ? 'warn' : 'ok'}
            hint={`of ${overview.data?.sources.total ?? 0} registered`}
          />
        </div>
      )}

      <GlassCard>
        <Tabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Studio modules" />
        <TabPanel id={`studio-${tab}`} labelledBy={`studio-${tab}`}>
          {tab === 'sources' ? <SourcesModule /> : null}
          {tab === 'layers' ? <LayersModule /> : null}
          {tab === 'rules' ? <RulesModule canConfigure={user.permissions.includes('rule.configure')} /> : null}
          {tab === 'authorities' ? <AuthoritiesModule /> : null}
          {tab === 'workflow' ? <WorkflowModule /> : null}
          {tab === 'users' ? <UsersModule /> : null}
          {tab === 'audit' ? <AuditModule canRead={user.permissions.includes('audit.read')} /> : null}
          {tab === 'ingestion' ? <IngestionModule /> : null}
          {tab === 'health' ? <HealthModule /> : null}
        </TabPanel>
      </GlassCard>
    </div>
  );
}

function SourcesModule() {
  const navigate = useNavigate();
  const state = useAsync((s) => api.dataSources({}, s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  const items = state.data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No sources" body="The data fabric catalogue is empty." />;
  return (
    <div className="stack">
      <div className="row-between">
        <span className="small muted">
          {items.length} source(s) registered · {items.filter((s) => s.isEnabled).length} enabled
        </span>
        <button type="button" className="btn btn-sm" onClick={() => navigate('/sources')}>
          Open data fabric console
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Category</th>
              <th scope="col">Status</th>
              <th scope="col">Data</th>
              <th scope="col">Enabled</th>
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
                <td className="small muted">{s.category}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>
                  <DataStatusChip status={s.dataStatus} short />
                </td>
                <td>
                  {s.isEnabled ? <span className="badge badge-ok">enabled</span> : <span className="badge badge-neutral">disabled</span>}
                </td>
                <td className="tiny muted">{s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LayersModule() {
  const state = useAsync((s) => api.layers(s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  const layers = state.data?.items ?? [];
  if (layers.length === 0) {
    return (
      <EmptyState
        title="No GIS layers registered"
        icon="◻"
        body="No layer is registered in the catalogue. Layers are seeded from the data fabric definitions."
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Layer</th>
            <th scope="col">Category</th>
            <th scope="col">Source</th>
            <th scope="col">Service</th>
            <th scope="col">Status</th>
            <th scope="col">Opacity</th>
            <th scope="col">Visible</th>
            <th scope="col">Data</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.layerId}>
              <td>
                <div className="small">{l.name}</div>
                <div className="tiny muted">{l.description}</div>
              </td>
              <td className="small muted">{l.category}</td>
              <td className="tiny mono">{l.sourceId}</td>
              <td className="small">{l.serviceType}</td>
              <td>
                <StatusBadge status={l.status} />
              </td>
              <td className="num">{l.defaultOpacity.toFixed(2)}</td>
              <td>{l.defaultVisible ? <span className="badge badge-ok">yes</span> : <span className="badge badge-neutral">no</span>}</td>
              <td>
                <DataStatusChip status={l.dataStatus} short />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RulesModule({ canConfigure }: { canConfigure: boolean }) {
  const { reportError, pushToast } = useApp();
  const state = useAsync((s) => api.rules(s), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [severity, setSeverity] = useState('');
  const [deduction, setDeduction] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;

  const beginEdit = (rule: NonNullable<typeof state.data>['items'][number]) => {
    setEditing(rule.rule_code);
    setSeverity(rule.severity);
    setDeduction(String(rule.deduction));
    setEnabled(rule.is_enabled);
    setReason('');
    setErrors([]);
  };

  const save = async () => {
    if (reason.trim().length < 3) {
      setErrors(['A reason of at least 3 characters is required — it is stored in the audit trail.']);
      return;
    }
    const deductionNum = Number(deduction);
    if (!Number.isFinite(deductionNum) || deductionNum < 0 || deductionNum > 100) {
      setErrors(['Deduction must be a number between 0 and 100.']);
      return;
    }
    setBusy(true);
    try {
      await api.updateRule(editing!, {
        severity: severity as 'LOW' | 'MEDIUM' | 'HIGH',
        deduction: deductionNum,
        isEnabled: enabled,
        reason: reason.trim(),
      });
      pushToast({ kind: 'success', title: `Rule ${editing} updated`, body: 'Change recorded in the audit trail.' });
      setEditing(null);
      state.reload();
    } catch (err) {
      reportError(err, 'Rule configuration');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <ProvenanceNotice tone="warn">
        Threshold changes affect the verification-support score and the finding severity across the platform. The
        integrity engine always recomputes from current records, so a change takes effect immediately without
        rewriting historical findings.
      </ProvenanceNotice>

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
              <th scope="col">Updated</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {(state.data?.items ?? []).map((r) => (
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
                <td className="tiny muted">{formatDateTime(r.updated_at)}</td>
                <td>
                  {canConfigure ? (
                    <button type="button" className="btn btn-sm" onClick={() => beginEdit(r)}>
                      Configure
                    </button>
                  ) : (
                    <span className="tiny muted">read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <GlassPanel>
          <CardHead title={`Configure ${editing}`} subtitle="Changes are versioned and audited" />
          <FieldErrors errors={errors} />
          <div className="grid grid-4" style={{ marginTop: 8 }}>
            <div className="field">
              <label htmlFor="rule-severity">Severity</label>
              <select id="rule-severity" className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="rule-deduction">Deduction (0-100)</label>
              <input
                id="rule-deduction"
                className="input"
                type="number"
                min={0}
                max={100}
                value={deduction}
                onChange={(e) => setDeduction(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rule-enabled">Enabled</label>
              <label className="checkbox" style={{ paddingTop: 8 }}>
                <input id="rule-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Rule fires when enabled
              </label>
            </div>
            <div className="field">
              <label htmlFor="rule-reason">Reason (audited)</label>
              <input
                id="rule-reason"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this threshold changing?"
              />
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              Save rule
            </button>
          </div>
        </GlassPanel>
      ) : null}
    </div>
  );
}

function AuthoritiesModule() {
  const state = useAsync((s) => api.adminOverview(s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="stack">
      <p className="small muted">
        Authority mapping routes each integrity finding to the department responsible for reconciling the records. A
        finding of <span className="mono">OWNERSHIP_MISMATCH</span> routes to Revenue,{' '}
        <span className="mono">ENCUMBRANCE_RISK</span> to Registration, and so on. Routing is what makes the case queue
        actionable without manual triage.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Label</th>
              <th scope="col">Officer</th>
              <th scope="col">Administrator</th>
              <th scope="col">Permissions</th>
            </tr>
          </thead>
          <tbody>
            {(state.data?.roles ?? []).map((r) => (
              <tr key={r.code}>
                <td className="mono tiny">{r.code}</td>
                <td className="small">{r.label}</td>
                <td>{r.is_officer ? <span className="badge badge-ok">yes</span> : <span className="badge badge-neutral">no</span>}</td>
                <td>{r.is_admin ? <span className="badge badge-warn">yes</span> : <span className="badge badge-neutral">no</span>}</td>
                <td className="num">{r.permission_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GlassPanel>
        <CardHead title="Capability matrix" subtitle="Granular permissions per role" />
        <div className="stack" style={{ gap: 8 }}>
          {(state.data?.capabilityMatrix ?? []).map((c) => (
            <div className="glass-inset card-tight" key={c.role}>
              <div className="row-between">
                <span className="small" style={{ fontWeight: 620 }}>
                  {c.label} <span className="mono tiny muted">{c.role}</span>
                </span>
                <span className="chip-row">
                  {c.isOfficer ? <span className="badge badge-info">officer</span> : null}
                  {c.isAdmin ? <span className="badge badge-warn">admin</span> : null}
                </span>
              </div>
              <div className="tiny muted">{c.description}</div>
              <div className="chip-row" style={{ marginTop: 6 }}>
                {c.permissions.map((p) => (
                  <span key={p.code} className="badge badge-neutral mono tiny" title={p.label}>
                    {p.code}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

function WorkflowModule() {
  const state = useAsync((s) => api.adminOverview(s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="stack">
      <p className="small muted">
        Workflow definitions declare the permitted transitions for each status. The workflow service enforces them, so
        an invalid transition is rejected with a conflict response rather than being silently applied.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Workflow</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Requires role</th>
              <th scope="col">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {(state.data?.workflows ?? []).map((w, i) => (
              <tr key={String(w.workflow_code ?? i)}>
                <td className="mono tiny">{String(w.workflow_code ?? '')}</td>
                <td>
                  <StatusBadge status={String(w.from_status ?? '')} />
                </td>
                <td>
                  <StatusBadge status={String(w.to_status ?? '')} />
                </td>
                <td className="tiny muted">{String(w.required_role ?? 'any officer')}</td>
                <td>
                  {w.is_enabled ? <span className="badge badge-ok">yes</span> : <span className="badge badge-neutral">no</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(state.data?.workflows.length ?? 0) === 0 ? (
        <EmptyState title="No workflow definitions" body="No transition rule is registered, so the workflow service falls back to its built-in transition map." />
      ) : null}
    </div>
  );
}

function UsersModule() {
  const state = useAsync((s) => api.adminOverview(s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Role</th>
              <th scope="col">District</th>
              <th scope="col">Department</th>
              <th scope="col">Active</th>
              <th scope="col">Last login</th>
            </tr>
          </thead>
          <tbody>
            {(state.data?.users ?? []).map((u) => (
              <tr key={u.user_id}>
                <td>
                  <div className="small">{u.full_name}</div>
                  <div className="tiny mono muted">{u.username}</div>
                </td>
                <td className="mono tiny">{u.role_code}</td>
                <td className="small muted">{u.district ?? '—'}</td>
                <td className="small muted">{u.department ?? '—'}</td>
                <td>{u.active ? <span className="badge badge-ok">active</span> : <span className="badge badge-neutral">disabled</span>}</td>
                <td className="tiny muted">{u.last_login_at ? formatDateTime(u.last_login_at) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProvenanceNotice tone="warn">
        Passwords are never stored in plaintext; only a salted hash is persisted. No Aadhaar number is collected and no
        Aadhaar-based authentication is implemented anywhere in the platform.
      </ProvenanceNotice>
    </div>
  );
}

function AuditModule({ canRead }: { canRead: boolean }) {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const state = useAsync((s) => api.audit({ action: action || undefined, entityType: entityType || undefined, limit: 100 }, s), [
    action,
    entityType,
  ], { enabled: canRead });

  if (!canRead) {
    return <EmptyState title="Audit access required" icon="⚑" body="The audit trail requires the audit.read permission." />;
  }
  if (state.loading) return <LoadingState lines={5} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="audit-action">Action</label>
          <input
            id="audit-action"
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value.toUpperCase())}
            placeholder="e.g. CASE_UPDATED"
          />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="audit-entity">Entity type</label>
          <input
            id="audit-entity"
            className="input"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. verification_case"
          />
        </div>
        <div className="field" style={{ alignSelf: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setAction('');
              setEntityType('');
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {(state.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No audit entries match" icon="≡" body="No audit record matches the current filters." />
      ) : (
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
                <th scope="col">Request</th>
              </tr>
            </thead>
            <tbody>
              {state.data?.items.map((a) => (
                <tr key={a.audit_id}>
                  <td className="tiny muted">{formatDateTime(a.timestamp)}</td>
                  <td className="small">{a.actor}</td>
                  <td className="tiny muted">{a.role}</td>
                  <td>
                    <span className="badge badge-neutral">{a.action.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="tiny mono">
                    {a.entity_type}/{a.entity_id.slice(0, 16)}
                  </td>
                  <td className="tiny muted">{a.reason || '—'}</td>
                  <td className="tiny mono muted">{a.request_id ? a.request_id.slice(0, 12) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row-between">
        <span className="small muted">
          {state.data?.items.length ?? 0} of {state.data?.total ?? 0} entries
        </span>
        <span className="tiny muted">Audit records are append-only and are never modified by application code.</span>
      </div>
    </div>
  );
}

function IngestionModule() {
  const state = useAsync((s) => api.ingestion(s), []);
  if (state.loading) return <LoadingState lines={4} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="stack">
      <GlassPanel>
        <CardHead title="Pipeline" subtitle="Every external record passes through these stages" />
        <div className="chip-row">
          {(state.data?.pipeline ?? []).map((p) => (
            <span key={p} className="badge badge-info">
              {p}
            </span>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {state.data?.note}
        </p>
      </GlassPanel>

      <GlassPanel>
        <CardHead title="Ingestion runs" subtitle="Recorded ingestion attempts" />
        {(state.data?.ingestionRuns.length ?? 0) === 0 ? (
          <EmptyState
            title="No ingestion runs recorded"
            icon="◻"
            body="Ingestion runs are recorded when a fetch is executed. Probe the adapters from the data fabric console to record the first runs."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Records</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {state.data?.ingestionRuns.map((r, i) => (
                  <tr key={String(r.ingestion_id ?? i)}>
                    <td className="small">{String(r.source_name ?? r.source_id)}</td>
                    <td className="small muted">{String(r.stage ?? '—')}</td>
                    <td>
                      <StatusBadge status={String(r.status)} />
                    </td>
                    <td className="tiny muted">{r.started_at ? formatDateTime(String(r.started_at)) : '—'}</td>
                    <td className="num tiny">
                      {r.record_count === null || r.record_count === undefined ? '—' : formatNumber(Number(r.record_count))}
                    </td>
                    <td className="tiny muted">{String(r.message ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <CardHead title="Adapter runs" subtitle="Probe and sync operations across all sources" />
        {(state.data?.adapterRuns.length ?? 0) === 0 ? (
          <EmptyState title="No adapter runs" icon="◻" body="No adapter run has been recorded yet." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Operation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {state.data?.adapterRuns.map((r, i) => (
                  <tr key={String(r.run_id ?? i)}>
                    <td className="small">{String(r.source_name ?? r.source_id)}</td>
                    <td className="small muted">{String(r.operation ?? 'PROBE')}</td>
                    <td>
                      <StatusBadge status={String(r.status)} />
                    </td>
                    <td className="tiny muted">{r.started_at ? formatDateTime(String(r.started_at)) : '—'}</td>
                    <td className="tiny muted">{String(r.message ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <CardHead title="Quality metrics" subtitle="Recorded per-source quality observations" />
        {(state.data?.qualityMetrics.length ?? 0) === 0 ? (
          <EmptyState
            title="No quality metrics recorded"
            icon="◻"
            body="Quality metrics are written when an ingestion run completes. Per-parcel quality scores are available now on each parcel's passport."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Completeness</th>
                  <th scope="col">Consistency</th>
                  <th scope="col">Freshness</th>
                  <th scope="col">Computed</th>
                </tr>
              </thead>
              <tbody>
                {state.data?.qualityMetrics.map((m, i) => (
                  <tr key={String(m.metric_id ?? i)}>
                    <td className="small">{String(m.source_id)}</td>
                    <td className="num">{String(m.completeness ?? '—')}</td>
                    <td className="num">{String(m.consistency ?? '—')}</td>
                    <td className="num">{String(m.freshness ?? '—')}</td>
                    <td className="tiny muted">{m.computed_at ? formatDateTime(String(m.computed_at)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function HealthModule() {
  const health = useAsync((s) => api.health(s), []);
  if (health.loading) return <LoadingState lines={4} />;
  if (health.error) return <ErrorState error={health.error} onRetry={health.reload} />;
  const h = health.data;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <MetricCard label="API" value={h?.ok ? 'HEALTHY' : 'DEGRADED'} tone={h?.ok ? 'ok' : 'danger'} hint={`${h?.api.latencyMs ?? '—'} ms`} />
        <MetricCard label="Database" value={h?.database.ok ? 'HEALTHY' : 'UNAVAILABLE'} tone={h?.database.ok ? 'ok' : 'danger'} hint={`${h?.database.latencyMs ?? '—'} ms`} />
        <MetricCard label="PostGIS" value={h?.database.postgis ? 'ACTIVE' : 'ABSENT'} tone={h?.database.postgis ? 'ok' : 'warn'} />
        <MetricCard label="Version" value={h?.version ?? '—'} />
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Latency</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {(h?.sources ?? []).filter(Boolean).map((s) => (
              <tr key={s!.sourceId}>
                <td className="mono tiny">{s!.sourceId}</td>
                <td>
                  <StatusBadge status={s!.status} />
                </td>
                <td className="num tiny">{s!.latencyMs === null ? '—' : `${s!.latencyMs} ms`}</td>
                <td className="tiny muted">{s!.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(h?.sources ?? []).filter(Boolean).length === 0 ? (
        <EmptyState title="No adapter health recorded" body="Run a live probe from the data fabric console to record adapter health." />
      ) : null}
      <div className="tiny muted">Checked {h?.checkedAt ? formatDateTime(h.checkedAt) : '—'}</div>
    </div>
  );
}
