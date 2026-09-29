import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../app/AppState';
import { ToastStack } from '../components/ui';
import { CommandPalette } from './CommandPalette';

const NAV = [
  { to: '/', label: 'MAP', end: true },
  { to: '/parcels', label: 'PARCELS' },
  { to: '/intelligence', label: 'INTELLIGENCE' },
  { to: '/cases', label: 'CASES' },
  { to: '/officer', label: 'OFFICER' },
  { to: '/analytics', label: 'ANALYTICS' },
  { to: '/gateway', label: 'GATEWAY' },
  { to: '/sources', label: 'SOURCES' },
  { to: '/studio', label: 'STUDIO' },
];

const MOBILE_NAV = [
  { to: '/', label: 'Map', icon: '◉', end: true },
  { to: '/parcels', label: 'Parcels', icon: '▤' },
  { to: '/intelligence', label: 'Intel', icon: '◆' },
  { to: '/officer', label: 'Officer', icon: '⚑' },
  { to: '/cases', label: 'Cases', icon: '⚖' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { meta, metaLoading, metaError, theme, toggleTheme, user, logout, setPaletteOpen, paletteOpen } = useApp();
  const navigate = useNavigate();

  // Global keyboard access to the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (!typing && e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark" aria-hidden="true">
            भू
          </span>
          <span className="brand-text">
            <span className="brand-name">BHUMISETU</span>
            <span className="brand-tag">Integrated GIS Land Stack &amp; Parcel Intelligence Platform</span>
          </span>
        </NavLink>

        <div className="grow" />

        <span
          className={`data-mode mode-${meta?.dataMode ?? 'MIXED'}`}
          title="Real GIS context is combined with demonstration governance records in this deployment."
        >
          <span className="dot" style={{ background: 'currentColor' }} aria-hidden="true" />
          {metaLoading ? 'Loading…' : metaError ? 'Mode unavailable' : 'Mixed — real context + demonstration records'}
        </span>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setPaletteOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
        >
          ⌕ <span className="hidden-xs">Search</span>
        </button>

        <button
          type="button"
          className="btn btn-sm btn-icon"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        {user ? (
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate('/account')}
              title={`${user.fullName} · ${user.roleLabel}`}
            >
              {user.fullName.split(' ')[0]}
              <span className="badge badge-neutral tiny">{user.roleLabel}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              ⏻
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/login')}>
            Sign in
          </button>
        )}
      </header>

      <nav className="app-nav" aria-label="Primary">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="app-body">{children}</div>

      <nav className="mobile-tabs" aria-label="Primary mobile">
        {MOBILE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <CommandPalette />
      <ToastStack />
    </div>
  );
}
