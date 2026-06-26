/**
 * ProtectedRoute — renders children only if the user is authenticated
 * and (optionally) has one of the allowed roles.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, roles }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Authenticated but wrong role — redirect to dashboard
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

/* ------------------------------------------------------------------ */
/* Simple inline spinner (no extra dependencies)                       */
/* ------------------------------------------------------------------ */
function Spinner() {
  return (
    <svg
      style={{ animation: 'spin 1s linear infinite', width: 48, height: 48, color: '#6366f1' }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
