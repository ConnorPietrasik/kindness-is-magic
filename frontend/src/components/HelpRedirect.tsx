import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_GUIDE } from "../lib/routes";
import { PageSpinner } from "./Spinner";

/**
 * HelpRedirect — the /help route. Sends the visitor straight to their own
 * role's guide (ROLE_GUIDE). Only mounted under ProtectedRoute, so a
 * resolved session is guaranteed; the spinner covers the resolve window.
 */
export function HelpRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading || !user) {
    return <PageSpinner />;
  }

  return <Navigate to={ROLE_GUIDE[user.role]} replace />;
}
