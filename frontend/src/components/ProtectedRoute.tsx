import type { ReactNode } from 'react';
import type { UserRole } from '../types/domain';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from './Spinner';
import { ROUTES } from '../lib/routes';

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: UserRole[];
}

/**
 * ProtectedRoute — renders children only if the user is authenticated
 * and (optionally) has one of the allowed roles.
 */
export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <PageSpinner />;
  }

  if (!user) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return children;
}
