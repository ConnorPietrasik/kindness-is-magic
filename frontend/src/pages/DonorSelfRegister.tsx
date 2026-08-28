import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { registerDonor } from "../lib/api";
import { ROUTES, route } from "../lib/routes";
import { clearPendingClaimFamilyId, formatApiError, getPendingClaimFamilyId } from "../lib/utils";

interface SelfRegisterForm {
  display_name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: SelfRegisterForm = {
  display_name: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export default function DonorSelfRegister() {
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState<SelfRegisterForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const update = (key: keyof SelfRegisterForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const result = await registerDonor({
        display_name: form.display_name,
        email: form.email,
        password: form.password,
      });

      // Backend auto-logs the user in via cookies. Update auth context and redirect.
      setUser(result.user);

      // If they got here by trying to claim a family, take them straight
      // back to it with the claim modal open.
      const pendingFamilyId = getPendingClaimFamilyId();
      clearPendingClaimFamilyId();
      if (pendingFamilyId != null) {
        navigate(route.familyWishList(pendingFamilyId), { replace: true, state: { openClaim: true } });
      } else {
        navigate(ROUTES.DASHBOARD, { replace: true });
      }
    } catch (err: unknown) {
      toast.error(formatApiError(err, "Registration failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-lg">
        <Logo className="mx-auto mb-4 h-16 w-16" />
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-dark">Donor Registration</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Create an account to claim and support families</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Display Name"
            fieldProps={{
              value: form.display_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("display_name", e.target.value),
              required: true,
              placeholder: "Your name",
              maxLength: 40,
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
              autoComplete: "email",
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
