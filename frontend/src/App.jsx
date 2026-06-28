import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, Fragment } from 'react';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { PageSpinner, Spinner } from './components/Spinner';
import { HeaderBar } from './components/HeaderBar';
import { ROUTES } from './lib/routes';

// Pages (lazy-loaded on route visit)
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AdminReferrers = lazy(() => import('./pages/AdminReferrers'));
const AdminFamilies = lazy(() => import('./pages/AdminFamilies'));
const AdminPeople = lazy(() => import('./pages/AdminPeople'));
const CsvUpload = lazy(() => import('./pages/CsvUpload'));
const ReferrerDashboard = lazy(() => import('./pages/ReferrerDashboard'));
const ReferrerFamilyDetail = lazy(() => import('./pages/ReferrerFamilyDetail'));
const FamilyDashboard = lazy(() => import('./pages/FamilyDashboard'));
const FamilyPeople = lazy(() => import('./pages/FamilyPeople'));

/* ------------------------------------------------------------------ */
/* Role-based redirect after login                                     */
/* ------------------------------------------------------------------ */
function DashboardRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }

  // Route to role-specific dashboards
  if (user?.role === 'admin') {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  if (user?.role === 'referrer') {
    return <Navigate to={ROUTES.REFERRER_DASHBOARD} replace />;
  }
  if (user?.role === 'family') {
    return <Navigate to={ROUTES.FAMILY_DASHBOARD} replace />;
  }

  return <Navigate to={ROUTES.LOGIN} replace />;
}

/* ------------------------------------------------------------------ */
/* App router                                                          */
/* ------------------------------------------------------------------ */
const AppLoadingFallback = () => (
  <Fragment>
    <HeaderBar title="Kindness is Magic" />
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner size="lg" />
    </div>
  </Fragment>
);

export default function App() {
  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <Routes>
        {/* ── Public routes ──────────────────────────────────────── */}
        <Route path={ROUTES.LOGIN} element={<Login />} />
        <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />
        <Route path={ROUTES.RESET_PASSWORD} element={<ResetPassword />} />

        {/* ── Authenticated routes ───────────────────────────────── */}
        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute roles={['admin', 'referrer', 'family']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* ── Admin-only ─────────────────────────────────────────── */}
        <Route
          path={ROUTES.REGISTER}
          element={
            <ProtectedRoute roles={['admin']}>
              <Register />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_REFERRERS}
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminReferrers />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_FAMILIES}
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminFamilies />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_PEOPLE}
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminPeople />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_CSV_UPLOAD}
          element={
            <ProtectedRoute roles={['admin']}>
              <CsvUpload />
            </ProtectedRoute>
          }
        />

        {/* ── Referrer self-service ────────────────────────────── */}
        <Route
          path={ROUTES.REFERRER_DASHBOARD}
          element={
            <ProtectedRoute roles={['referrer']}>
              <ReferrerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.REFERRER_FAMILY_DETAIL}
          element={
            <ProtectedRoute roles={['referrer']}>
              <ReferrerFamilyDetail />
            </ProtectedRoute>
          }
        />

        {/* ── Family self-service ──────────────────────────────── */}
        <Route
          path={ROUTES.FAMILY_DASHBOARD}
          element={
            <ProtectedRoute roles={['family']}>
              <FamilyDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.FAMILY_PEOPLE}
          element={
            <ProtectedRoute roles={['family']}>
              <FamilyPeople />
            </ProtectedRoute>
          }
        />

        {/* ── Catch-all: redirect root to login or dashboard ────── */}
        <Route path={ROUTES.ROOT} element={<DashboardRedirect />} />
        <Route path="*" element={<Navigate to={ROUTES.ROOT} replace />} />
      </Routes>
    </Suspense>
  );
}
