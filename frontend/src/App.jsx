import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { PageSpinner } from './components/Spinner';

// Pages (lazy-loaded on route visit)
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import AdminReferrers from './pages/AdminReferrers';
import AdminFamilies from './pages/AdminFamilies';
import AdminPeople from './pages/AdminPeople';
import CsvUpload from './pages/CsvUpload';
import ReferrerDashboard from './pages/ReferrerDashboard';
import ReferrerFamilyDetail from './pages/ReferrerFamilyDetail';
import FamilyDashboard from './pages/FamilyDashboard';
import FamilyPeople from './pages/FamilyPeople';

/* ------------------------------------------------------------------ */
/* Role-based redirect after login                                     */
/* ------------------------------------------------------------------ */
function DashboardRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }

  // Route to role-specific sections (placeholders for Phase 3)
  if (user?.role === 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  if (user?.role === 'referrer') {
    return <Navigate to="/referrer/dashboard" replace />;
  }
  if (user?.role === 'family') {
    return <Navigate to="/family/dashboard" replace />;
  }

  return <Navigate to="/login" replace />;
}

/* ------------------------------------------------------------------ */
/* App router                                                          */
/* ------------------------------------------------------------------ */
export default function App() {
  return (
    <Routes>
      {/* ── Public routes ──────────────────────────────────────── */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      {/* ── Authenticated routes ───────────────────────────────── */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={['admin', 'referrer', 'family']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* ── Admin-only ─────────────────────────────────────────── */}
      <Route
        path="/register"
        element={
          <ProtectedRoute roles={['admin']}>
            <Register />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/referrers"
        element={
          <ProtectedRoute roles={['admin']}>
            <AdminReferrers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/families"
        element={
          <ProtectedRoute roles={['admin']}>
            <AdminFamilies />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/people"
        element={
          <ProtectedRoute roles={['admin']}>
            <AdminPeople />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/csv-upload"
        element={
          <ProtectedRoute roles={['admin']}>
            <CsvUpload />
          </ProtectedRoute>
        }
      />

      {/* ── Referrer self-service ────────────────────────────── */}
      <Route
        path="/referrer/dashboard"
        element={
          <ProtectedRoute roles={['referrer']}>
            <ReferrerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/referrer/families/:id"
        element={
          <ProtectedRoute roles={['referrer']}>
            <ReferrerFamilyDetail />
          </ProtectedRoute>
        }
      />

      {/* ── Family self-service ──────────────────────────────── */}
      <Route
        path="/family/dashboard"
        element={
          <ProtectedRoute roles={['family']}>
            <FamilyDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/family/people"
        element={
          <ProtectedRoute roles={['family']}>
            <FamilyPeople />
          </ProtectedRoute>
        }
      />

      {/* ── Catch-all: redirect root to login or dashboard ────── */}
      <Route path="/" element={<DashboardRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
