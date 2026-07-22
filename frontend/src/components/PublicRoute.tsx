import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import AlreadyLoggedIn from "../pages/AlreadyLoggedIn";
import { PageSpinner } from "./Spinner";

interface PublicRouteProps {
  children: ReactNode;
}

/**
 * PublicRoute — renders children only when the user is NOT authenticated.
 *
 * Authenticated users see an "Already Logged In" page with a link to their
 * dashboard and a logout button, so they understand why the form isn't shown.
 */
export function PublicRoute({ children }: PublicRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }

  if (user) {
    return <AlreadyLoggedIn />;
  }

  return children;
}
