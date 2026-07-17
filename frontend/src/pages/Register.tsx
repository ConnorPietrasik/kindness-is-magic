import { useState } from "react";
import { Link } from "react-router-dom";
import { registerRequest } from "../lib/api";
import { ROUTES } from "../lib/routes";
import type { RegisterPayload, UserRole } from "../types";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "referrer", label: "Referrer" },
  { value: "family", label: "Family" },
];

interface RegisterForm {
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
  referrer_id: string;
  family_id: string;
}

const emptyForm: RegisterForm = {
  email: "",
  password: "",
  confirmPassword: "",
  role: "referrer",
  referrer_id: "",
  family_id: "",
};

export default function Register() {
  const [form, setForm] = useState<RegisterForm>(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key: keyof RegisterForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const isReferrer = form.role === "referrer";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const payload: RegisterPayload = {
        email: form.email,
        password: form.password,
        role: form.role,
        referrer_id: isReferrer ? (form.referrer_id ? parseInt(form.referrer_id, 10) : null) : null,
        family_id: !isReferrer ? (form.family_id ? parseInt(form.family_id, 10) : null) : null,
      };

      await registerRequest(payload);
      setSuccess("User created successfully!");
      setForm(emptyForm);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 shadow-lg">
        <h1 className="mb-1 text-2xl font-bold text-brand-dark">Register User</h1>
        <p className="mb-6 text-sm text-gray-500">Create a new account (admin only)</p>

        {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600">{error}</div>}
        {success && <div className="mb-4 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-600">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="reg-email" className="mb-1.5 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="user@example.com"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="reg-password" className="mb-1.5 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="Min 8 characters"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="reg-confirm" className="mb-1.5 block text-sm font-medium text-gray-700">
              Confirm Password
            </label>
            <input
              id="reg-confirm"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="Re-enter password"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="reg-role" className="mb-1.5 block text-sm font-medium text-gray-700">
              Role
            </label>
            <select
              id="reg-role"
              value={form.role}
              onChange={(e) => update("role", e.target.value as UserRole)}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {isReferrer && (
            <div className="mb-4">
              <label htmlFor="reg-referrer" className="mb-1.5 block text-sm font-medium text-gray-700">
                Referrer ID
              </label>
              <input
                id="reg-referrer"
                type="number"
                value={form.referrer_id}
                onChange={(e) => update("referrer_id", e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                placeholder="e.g. 1"
              />
            </div>
          )}

          {!isReferrer && (
            <div className="mb-4">
              <label htmlFor="reg-family" className="mb-1.5 block text-sm font-medium text-gray-700">
                Family ID
              </label>
              <input
                id="reg-family"
                type="number"
                value={form.family_id}
                onChange={(e) => update("family_id", e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                placeholder="e.g. 1"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-btn-start to-btn-end py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create User"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link to={ROUTES.DASHBOARD} className="text-btn-start hover:underline">
            ← Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
