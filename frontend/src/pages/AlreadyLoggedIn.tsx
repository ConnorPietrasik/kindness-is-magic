import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../lib/routes";
import { humanize } from "../lib/utils";

/**
 * AlreadyLoggedIn — shown when an authenticated user visits a public page
 * (login, register, forgot password, etc.).
 *
 * Gives them two clear options: go to their dashboard or log out.
 */
export default function AlreadyLoggedIn() {
  const { user, logout } = useAuth();

  const dashboardPath =
    user?.role === "admin"
      ? ROUTES.DASHBOARD
      : user?.role === "referrer"
        ? ROUTES.REFERRER_DASHBOARD
        : user?.role === "family"
          ? ROUTES.FAMILY_DASHBOARD
          : ROUTES.ROOT;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-xl font-bold text-brand-dark">You&apos;re already logged in</h1>
        {user && (
          <p className="mb-4 text-sm text-gray-500">
            Signed in as <span className="font-medium text-gray-700">{user.email}</span> ({humanize(user.role)})
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Link to={dashboardPath}>
            <Button className="w-full">Go to Dashboard</Button>
          </Link>
          <Button variant="secondary" className="w-full" onClick={logout}>
            Log Out
          </Button>
        </div>
      </Card>
    </div>
  );
}
