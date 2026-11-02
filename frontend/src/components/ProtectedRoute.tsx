import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../lib/routes";
import type { UserRole } from "../types/domain";
import { SiteFooter } from "./SiteFooter";
import { PageSpinner } from "./Spinner";

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: UserRole[];
}

/**
 * ProtectedRoute — renders children only if the user is authenticated
 * and (optionally) has one of the allowed roles. Every authenticated page
 * gets the SiteFooter here (single place — pages never render it themselves).
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

  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
