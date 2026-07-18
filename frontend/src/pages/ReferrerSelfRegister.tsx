import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { useAuth } from "../context/AuthContext";
import { registerReferrerViaInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";

interface SelfRegisterForm {
  code: string;
  name: string;
  email: string;
  phone_number: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: SelfRegisterForm = {
  code: "",
  name: "",
  email: "",
  phone_number: "",
  password: "",
  confirmPassword: "",
};

export default function ReferrerSelfRegister() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<SelfRegisterForm>(emptyForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key: keyof SelfRegisterForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const result = await registerReferrerViaInvite({
        code: form.code,
        name: form.name,
        email: form.email,
        phone_number: form.phone_number,
        password: form.password,
      });

      // Backend auto-logs the user in via cookies. Update auth context and redirect.
      setUser(result.user);
      navigate(ROUTES.REFERRER_DASHBOARD, { replace: true });
    } catch (err: unknown) {
      setError(formatApiError(err, "Registration failed. Check your invite code and try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-dark">Referrer Registration</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Use your invite code to create an account</p>

        {error && <ErrorBox message={error} className="mb-4" />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Invite Code"
            fieldProps={{
              value: form.code,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("code", e.target.value),
              required: true,
              placeholder: "e.g. KMG-A7X9P2",
            }}
          />

          <FormField
            label="Name"
            fieldProps={{
              value: form.name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
              required: true,
              placeholder: "Your name",
            }}
          />

          <FormField
            label="Email"
            type="email"
            fieldProps={{
              value: form.email,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("email", e.target.value),
              required: true,
              placeholder: "you@example.com",
            }}
          />

          <FormField
            label="Phone Number"
            fieldProps={{
              value: form.phone_number,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
              required: true,
              placeholder: "e.g. 07123 456789",
            }}
          />

          <FormField
            label="Password"
            type="password"
            fieldProps={{
              value: form.password,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("password", e.target.value),
              required: true,
              minLength: 8,
              placeholder: "Min 8 characters",
            }}
          />

          <FormField
            label="Confirm Password"
            type="password"
            fieldProps={{
              value: form.confirmPassword,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("confirmPassword", e.target.value),
              required: true,
              minLength: 8,
              placeholder: "Re-enter password",
            }}
          />

          <Button type="submit" loading={loading} className="mt-2 w-full">
            {loading ? "Creating account…" : "Create Account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link to={ROUTES.LOGIN} className="text-btn-start hover:underline">
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
