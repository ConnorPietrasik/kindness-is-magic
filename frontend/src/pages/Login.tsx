import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ROUTES, route } from "../lib/routes";
import { clearPendingClaimFamilyId, getPendingClaimFamilyId } from "../lib/utils";

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || ROUTES.DASHBOARD;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const user = await login(email, password);

      // If they got here by trying to claim a family (claim dialog "Sign in"),
      // take them straight back to it with the claim modal open.
      const pendingFamilyId = getPendingClaimFamilyId();
      clearPendingClaimFamilyId();

      // Families skip the main dashboard and go straight to their family dashboard
      if (user.role === "family") {
        navigate(ROUTES.FAMILY_DASHBOARD, { replace: true });
      } else if (pendingFamilyId != null) {
        navigate(route.familyWishList(pendingFamilyId), { replace: true, state: { openClaim: true } });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Login failed. Check your credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 shadow-lg">
        <Logo className="mx-auto mb-4" />
        <h1 className="mb-6 text-center text-base text-gray-500 font-normal">Sign in</h1>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="you@example.com"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-btn-start to-btn-end py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link to={ROUTES.FORGOT_PASSWORD} className="text-btn-start hover:underline">
            Forgot your password?
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to={ROUTES.REFERRER_SELF_REGISTER} className="text-btn-start hover:underline">
            Referrer self-registration
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to={ROUTES.FAMILY_SELF_REGISTER} className="text-btn-start hover:underline">
            Family signup
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to={ROUTES.DONOR_SELF_REGISTER} className="text-btn-start hover:underline">
            Register to sponsor a family
          </Link>
        </p>
        <p className="mt-4 text-center text-sm">
          <Link to={ROUTES.PUBLIC_FAMILIES} className="text-gray-500 hover:underline">
            ← Browse families
          </Link>
        </p>
      </div>
    </div>
  );
}
