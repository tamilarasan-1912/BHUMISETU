import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  EmptyState,
  ErrorState,
  GlassCard,
  GlassPanel,
  LoadingState,
  ProvenanceNotice,
  StatusBadge,
  formatDateTime,
} from '../components/ui';

export function AccountPage() {
  const navigate = useNavigate();
  const { user, logout } = useApp();
  const me = useAsync((s) => api.me(s), []);
  const notifications = useAsync((s) => api.notifications(s), []);

  if (!user) return null;

  return (
    <div className="page stack" style={{ gap: 14 }}>
      <div className="row-between">
        <div>
          <h1>Profile and settings</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '84ch' }}>
            Your role determines which records you can read, which workflow actions you can take and which parts of the
            platform are visible at all.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void logout()}>
          Sign out
        </button>
      </div>

      <div className="grid grid-2">
        <GlassCard>
          <CardHead
            title={user.fullName}
            subtitle={`@${user.username}`}
            actions={<StatusBadge status="ACTIVE" />}
          />
          <dl className="kv kv-tight">
            <dt>Role</dt>
            <dd>
              {user.roleLabel} <span className="mono tiny muted">{user.role}</span>
            </dd>
            <dt>Officer</dt>
            <dd>{user.isOfficer ? 'yes' : 'no'}</dd>
            <dt>Administrator</dt>
            <dd>{user.isAdmin ? 'yes' : 'no'}</dd>
            <dt>District scope</dt>
            <dd>{user.district ?? 'platform-wide'}</dd>
            <dt>Department</dt>
            <dd>{user.department ?? '—'}</dd>
            <dt>Session</dt>
            <dd className="mono tiny">{user.sessionId.slice(0, 18)}…</dd>
          </dl>
        </GlassCard>

        <GlassPanel>
          <CardHead title="Granted permissions" subtitle="What this session may do" />
          <div className="chip-row">
            {user.permissions.map((p) => (
              <span key={p} className="badge badge-neutral mono tiny">
                {p}
              </span>
            ))}
          </div>
          {me.data?.masking ? (
            <>
              <div className="divider" />
              <div className="label">Masking policy applied to you</div>
              <ul className="small muted" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
                <li>Party names masked: {me.data.masking.maskPartyNames ? 'yes' : 'no'}</li>
                <li>Monetary amounts masked: {me.data.masking.maskAmounts ? 'yes' : 'no'}</li>
                <li>Assessment numbers masked: {me.data.masking.maskAssessmentNumbers ? 'yes' : 'no'}</li>
                <li>Internal notes visible: {me.data.masking.includeInternalNotes ? 'yes' : 'no'}</li>
                <li>Restricted documents visible: {me.data.masking.includePrivateDocuments ? 'yes' : 'no'}</li>
              </ul>
            </>
          ) : null}
        </GlassPanel>
      </div>

      <GlassPanel>
        <CardHead
          title="Notifications"
          subtitle="In-app notifications for cases, requests and source events"
          actions={
            notifications.data ? (
              <span className="badge badge-warn">{notifications.data.unread} unread</span>
            ) : null
          }
        />
        {notifications.loading ? (
          <LoadingState lines={3} />
        ) : notifications.error ? (
          <ErrorState error={notifications.error} onRetry={notifications.reload} />
        ) : (notifications.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No notifications"
            icon="◻"
            body="Notifications appear when a case you are involved in changes, a request is acknowledged, or a data source fails. Email and push delivery are architecture stubs, not enabled here."
          />
        ) : (
          <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
            {notifications.data?.items.map((n) => (
              <li className="glass-inset card-tight" key={n.notification_id}>
                <div className="row-between">
                  <span className="small" style={{ fontWeight: 620 }}>
                    {n.title}
                  </span>
                  <span className="chip-row">
                    {!n.read_at ? <span className="badge badge-warn">unread</span> : null}
                    <span className="badge badge-neutral tiny">{n.type.replace(/_/g, ' ')}</span>
                  </span>
                </div>
                <div className="small muted">{n.body}</div>
                <div className="row-between" style={{ marginTop: 4 }}>
                  <span className="tiny muted">{formatDateTime(n.created_at)}</span>
                  {!n.read_at ? (
                    <button
                      type="button"
                      className="link-btn tiny"
                      onClick={async () => {
                        await api.markNotificationRead(n.notification_id);
                        notifications.reload();
                      }}
                    >
                      Mark as read
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <div className="grid grid-2">
        <GlassPanel>
          <CardHead title="Settings" subtitle="Interface preferences" />
          <div className="stack">
            <div className="row-between">
              <span className="small">Theme</span>
              <span className="small muted">Toggle from the header — your choice is remembered on this device.</span>
            </div>
            <div className="row-between">
              <span className="small">Install as an application</span>
              <span className="small muted">
                Use your browser's install option. BHUMISETU ships a web app manifest and an offline-ready shell.
              </span>
            </div>
            <div className="row-between">
              <span className="small">Keyboard shortcuts</span>
              <span className="small muted">⌘K / Ctrl+K or “/” opens the command palette.</span>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel>
          <CardHead title="Privacy and data handling" subtitle="What the platform does and does not do" />
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>No Aadhaar number is collected, stored or used for authentication.</li>
            <li>No unnecessary personal information is requested.</li>
            <li>Citizen views mask personal identifiers and withhold monetary values.</li>
            <li>Internal officer notes are never exposed to citizen roles.</li>
            <li>Every read of a land passport and every workflow action is audited.</li>
          </ul>
          <div className="divider" />
          <button type="button" className="btn btn-sm" onClick={() => navigate('/')}>
            Return to the map
          </button>
        </GlassPanel>
      </div>

      <ProvenanceNotice tone="demo">
        This deployment serves a demonstration dataset. No record shown is an official government land record.
      </ProvenanceNotice>
    </div>
  );
}
