import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages (lazy-loaded on route visit)
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';

/* ------------------------------------------------------------------ */
/* Role-based redirect after login                                     */
/* ------------------------------------------------------------------ */
function DashboardRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading…</div>
      </div>
    );
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

      {/* ── Role-specific dashboards (Phase 3 placeholders) ───── */}
      <Route
        path="/referrer/dashboard"
        element={
          <ProtectedRoute roles={['admin', 'referrer']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/family/dashboard"
        element={
          <ProtectedRoute roles={['admin', 'referrer', 'family']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* ── Catch-all: redirect root to login or dashboard ────── */}
      <Route path="/" element={<DashboardRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
