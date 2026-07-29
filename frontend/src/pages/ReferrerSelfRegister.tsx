import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { useAuth } from "../context/AuthContext";
import { registerReferrerViaInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";
import { validatePhoneNumber } from "../lib/validators";

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
  const [searchParams] = useSearchParams();

  const urlCode = searchParams.get("code") ?? "";
  const urlEmail = searchParams.get("email") ?? "";

  const [form, setForm] = useState<SelfRegisterForm>({
    ...emptyForm,
    code: urlCode,
    email: urlEmail,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Keep form in sync if URL params change
  useEffect(() => {
    setForm((prev) => ({ ...prev, code: urlCode, email: urlEmail }));
  }, [urlCode, urlEmail]);

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

    const phoneErr = validatePhoneNumber(form.phone_number);
    if (phoneErr) {
      setError(phoneErr);
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
      navigate(ROUTES.DASHBOARD, { replace: true });
    } catch (err: unknown) {
      setError(formatApiError(err, "Registration failed. Check your invite code and try again."));
    } finally {
      setLoading(false);
    }
  };

  const isCodeLocked = urlCode.length > 0;
  const isEmailLocked = urlEmail.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-dark">Referrer Registration</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Use your invite code to create an account</p>

        {error && <ErrorBox message={error} className="mb-4" />}

        {isEmailLocked && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            This invite is for <strong>{urlEmail}</strong>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Invite Code"
            fieldProps={{
              value: form.code,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("code", e.target.value),
              required: true,
              placeholder: "e.g. KMG-A7X9P2",
              readOnly: isCodeLocked,
              autoComplete: "off",
              className: isCodeLocked
                ? "w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-base text-gray-500 outline-none"
                : undefined,
            }}
          />

          <FormField
            label="Name"
            fieldProps={{
              value: form.name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
              required: true,
              placeholder: "Your name",
              autoComplete: "name",
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
              readOnly: isEmailLocked,
              autoComplete: "email",
              className: isEmailLocked
                ? "w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-base text-gray-500 outline-none"
                : undefined,
            }}
          />

          <FormField
            label="Phone Number"
            fieldProps={{
              value: form.phone_number,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
              required: true,
              placeholder: "e.g. 111-111-1111",
              autoComplete: "tel",
            }}
          />

          <div>
            <FormField
              label="Password"
              type={showPassword ? "text" : "password"}
              fieldProps={{
                value: form.password,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("password", e.target.value),
                required: true,
                minLength: 8,
                placeholder: "Min 8 characters",
                autoComplete: "new-password",
              }}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="mt-1 text-xs text-btn-start hover:underline">
              {showPassword ? "Hide" : "Show"} password
            </button>
          </div>

          <FormField
            label="Confirm Password"
            type={showPassword ? "text" : "password"}
            fieldProps={{
              value: form.confirmPassword,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("confirmPassword", e.target.value),
              required: true,
              minLength: 8,
              placeholder: "Re-enter password",
              autoComplete: "new-password",
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
