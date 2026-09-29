import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useApp } from '../app/AppState';
import {
  CardHead,
  ErrorState,
  FieldErrors,
  GlassCard,
  GlassPanel,
  LoadingState,
  ProvenanceNotice,
  StatusBadge,
} from '../components/ui';

/**
 * Sign-in. Accounts are provisioned by an administrator; there is no public
 * self-registration, and no Aadhaar-based authentication anywhere in the platform.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, user, logout, reportError } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const capabilities = useAsync((s) => api.capabilities(s), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (username.trim().length === 0) errs.push('Enter your username.');
    if (password.length === 0) errs.push('Enter your password.');
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await login(username.trim(), password);
      const next = params.get('next');
      navigate(next && next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      reportError(err, 'Sign in');
      setErrors(['Sign-in failed. Check your username and password, then try again.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page stack" style={{ gap: 14, maxWidth: 1080 }}>
      <div className="row-between">
        <div>
          <h1>Sign in</h1>
          <p className="small muted" style={{ margin: 0, maxWidth: '76ch' }}>
            Access is role-based. A citizen sees their own requests and masked parcel information; an officer sees the
            case queue scoped to their department; an administrator sees the studio and the audit trail.
          </p>
        </div>
      </div>

      {user ? (
        <GlassPanel>
          <CardHead
            title={`Already signed in as ${user.fullName}`}
            subtitle={`${user.roleLabel} · ${user.role}`}
            actions={<StatusBadge status={user.isAdmin ? 'ACTIVE' : 'ACTIVE'} />}
          />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
              Continue to the map
            </button>
            <button type="button" className="btn" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </GlassPanel>
      ) : null}

      <div className="grid grid-2">
        <GlassCard>
          <CardHead title="Credentials" subtitle="Provisioned by an administrator" />
          <form onSubmit={(e) => void submit(e)} className="stack">
            <FieldErrors errors={errors} />
            <div className="field">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              Sign in
            </button>
            <div className="tiny muted">
              Passwords are stored only as salted hashes. Sign-in attempts are rate limited and both successful and
              failed attempts are written to the audit trail.
            </div>
          </form>
        </GlassCard>

        <div className="stack">
          <GlassPanel>
            <CardHead title="Demonstration accounts" subtitle="Seeded for evaluating this deployment" />
            <div className="table-wrap">
              <table className="data" style={{ minWidth: 340 }}>
                <thead>
                  <tr>
                    <th scope="col">Username</th>
                    <th scope="col">Password</th>
                    <th scope="col">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['citizen', 'citizen@123', 'Citizen'],
                    ['revenue', 'officer@123', 'Revenue Officer'],
                    ['registration', 'officer@123', 'Registration Officer'],
                    ['municipal', 'officer@123', 'Municipal Officer'],
                    ['planning', 'officer@123', 'Planning Officer'],
                    ['field', 'officer@123', 'Field Officer'],
                    ['judiciary', 'officer@123', 'Judiciary Viewer'],
                    ['gisadmin', 'admin@123', 'GIS Admin'],
                    ['admin', 'admin@123', 'System Administrator'],
                  ].map(([u, p, r]) => (
                    <tr key={u}>
                      <td className="mono tiny">{u}</td>
                      <td className="mono tiny">{p}</td>
                      <td className="small">{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divider" />
            <ProvenanceNotice tone="demo">
              These accounts exist only to evaluate a demonstration dataset. Change every credential before any real
              deployment, and never reuse these values.
            </ProvenanceNotice>
          </GlassPanel>

          <GlassPanel>
            <CardHead title="Roles and permissions" subtitle="Granular capability model" />
            {capabilities.loading ? (
              <LoadingState lines={3} />
            ) : capabilities.error ? (
              <ErrorState error={capabilities.error} onRetry={capabilities.reload} />
            ) : (
              <ul className="stack" style={{ gap: 7, listStyle: 'none', padding: 0, margin: 0 }}>
                {(capabilities.data?.roles ?? []).map((r) => (
                  <li className="glass-inset card-tight" key={r.role}>
                    <div className="row-between">
                      <span className="small" style={{ fontWeight: 620 }}>
                        {r.label}
                      </span>
                      <span className="chip-row">
                        {r.isOfficer ? <span className="badge badge-info">officer</span> : null}
                        {r.isAdmin ? <span className="badge badge-warn">admin</span> : null}
                      </span>
                    </div>
                    <div className="tiny muted">{r.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
