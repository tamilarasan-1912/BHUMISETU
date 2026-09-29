import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useApp } from './AppState';
import { EmptyState, LoadingState, ErrorState } from '../components/ui';

const HomePage = lazy(() => import('../pages/HomePage').then((m) => ({ default: m.HomePage })));
const ParcelsPage = lazy(() => import('../pages/ParcelsPage').then((m) => ({ default: m.ParcelsPage })));
const PassportPage = lazy(() => import('../pages/PassportPage').then((m) => ({ default: m.PassportPage })));
const IntelligencePage = lazy(() => import('../pages/IntelligencePage').then((m) => ({ default: m.IntelligencePage })));
const IntelligenceDetailPage = lazy(() =>
  import('../pages/IntelligenceDetailPage').then((m) => ({ default: m.IntelligenceDetailPage })),
);
const CasesPage = lazy(() => import('../pages/CasesPage').then((m) => ({ default: m.CasesPage })));
const NewCasePage = lazy(() => import('../pages/NewCasePage').then((m) => ({ default: m.NewCasePage })));
const CaseDetailPage = lazy(() => import('../pages/CaseDetailPage').then((m) => ({ default: m.CaseDetailPage })));
const OfficerPage = lazy(() => import('../pages/OfficerPage').then((m) => ({ default: m.OfficerPage })));
const AnalyticsPage = lazy(() => import('../pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const GatewayPage = lazy(() => import('../pages/GatewayPage').then((m) => ({ default: m.GatewayPage })));
const SourcesPage = lazy(() => import('../pages/SourcesPage').then((m) => ({ default: m.SourcesPage })));
const StudioPage = lazy(() => import('../pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const HealthPage = lazy(() => import('../pages/HealthPage').then((m) => ({ default: m.HealthPage })));
const CitizenPage = lazy(() => import('../pages/CitizenPage').then((m) => ({ default: m.CitizenPage })));
const LoginPage = lazy(() => import('../pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AccountPage = lazy(() => import('../pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function PageFallback() {
  return (
    <div className="page">
      <LoadingState lines={4} label="Loading view" />
    </div>
  );
}

/** Route guard: renders a clear explanation instead of a silent redirect. */
function RequireAuth({ children, anyPermission }: { children: ReactNode; anyPermission?: string[] }) {
  const { user, authReady } = useApp();
  const location = useLocation();

  if (!authReady) return <PageFallback />;
  if (!user) {
    return (
      <div className="page">
        <EmptyState
          title="Sign in required"
          icon="⚿"
          body={
            <>
              This area of BHUMISETU requires an authenticated session. Sign in with a citizen, officer or
              administrator account to continue. Access is role-based, so the controls you can use depend on your
              role.
            </>
          }
          action={
            <a className="btn btn-primary" href={`/login?next=${encodeURIComponent(location.pathname)}`}>
              Sign in
            </a>
          }
        />
      </div>
    );
  }
  if (anyPermission && anyPermission.length > 0) {
    const allowed = anyPermission.some((p) => user.permissions.includes(p));
    if (!allowed) {
      return (
        <div className="page">
          <EmptyState
            title="Your role does not grant access here"
            icon="⛔"
            body={
              <>
                You are signed in as <strong>{user.roleLabel}</strong>. This view needs one of:{' '}
                <span className="mono tiny">{anyPermission.join(', ')}</span>. Ask an administrator to adjust your
                role if you need access.
              </>
            }
          />
        </div>
      );
    }
  }
  return <>{children}</>;
}

export function AppRoutes() {
  const { metaError } = useApp();

  return (
    <AppShell>
      {metaError ? (
        <div className="page">
          <ErrorState
            title="Platform metadata unavailable"
            error={metaError}
          >
            BHUMISETU could not reach its API. Views that require live data will show their own error states.
            Confirm the API server is running and reachable, then reload.
          </ErrorState>
        </div>
      ) : null}
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/parcels" element={<ParcelsPage />} />
          <Route path="/passport/:parcelId" element={<PassportPage />} />
          <Route path="/intelligence" element={<IntelligencePage />} />
          <Route path="/intelligence/:parcelId" element={<IntelligenceDetailPage />} />
          <Route path="/cases" element={<RequireAuth><CasesPage /></RequireAuth>} />
          <Route path="/cases/new" element={<RequireAuth anyPermission={['case.create']}><NewCasePage /></RequireAuth>} />
          <Route path="/cases/:caseId" element={<RequireAuth><CaseDetailPage /></RequireAuth>} />
          <Route
            path="/officer"
            element={
              <RequireAuth anyPermission={['case.read.all', 'officer.dashboard']}>
                <OfficerPage />
              </RequireAuth>
            }
          />
          <Route path="/analytics" element={<RequireAuth anyPermission={['analytics.read']}><AnalyticsPage /></RequireAuth>} />
          <Route path="/gateway" element={<RequireAuth anyPermission={['gateway.read']}><GatewayPage /></RequireAuth>} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/studio" element={<RequireAuth anyPermission={['user.manage', 'source.configure', 'rule.configure', 'audit.read']}><StudioPage /></RequireAuth>} />
          <Route path="/studio/health" element={<RequireAuth anyPermission={['user.manage', 'source.configure']}><HealthPage /></RequireAuth>} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="/citizen" element={<CitizenPage />} />
          <Route path="/map" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
