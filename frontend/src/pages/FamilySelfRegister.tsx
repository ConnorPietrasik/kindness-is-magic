import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Logo } from "../components/Logo";
import { OptionalLabel } from "../components/OptionalLabel";
import { PhoneInput } from "../components/PhoneInput";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { registerFamilyViaInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";
import { validatePhoneNumber } from "../lib/validators";

interface SelfRegisterForm {
  code: string;
  family_name: string;
  family_wish: string;
  contact_name: string;
  email: string;
  password: string;
  confirmPassword: string;
  bio: string;
  address: string;
  phone_number: string;
}

const emptyForm: SelfRegisterForm = {
  code: "",
  family_name: "",
  family_wish: "",
  contact_name: "",
  email: "",
  password: "",
  confirmPassword: "",
  bio: "",
  address: "",
  phone_number: "",
};

export default function FamilySelfRegister() {
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlCode = searchParams.get("code") ?? "";

  const [form, setForm] = useState<SelfRegisterForm>({
    ...emptyForm,
    code: urlCode,
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Keep form in sync if URL params change
  useEffect(() => {
    setForm((prev) => ({ ...prev, code: urlCode }));
  }, [urlCode]);

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

    const phoneErr = validatePhoneNumber(form.phone_number);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }

    setLoading(true);
    try {
      const result = await registerFamilyViaInvite({
        code: form.code,
        family_name: form.family_name,
        family_wish: form.family_wish,
        contact_name: form.contact_name,
        email: form.email,
        password: form.password,
        bio: form.bio || null,
        address: form.address,
        phone_number: form.phone_number,
      });

      // Backend auto-logs the user in via cookies. Update auth context and redirect.
      setUser(result.user);
      navigate(ROUTES.FAMILY_DASHBOARD, { replace: true });
    } catch (err: unknown) {
      toast.error(formatApiError(err, "Registration failed. Check your invite code and try again."));
    } finally {
      setLoading(false);
    }
  };

  const isCodeLocked = urlCode.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-lg">
        <Logo className="mx-auto mb-4 h-16 w-16" />
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-dark">Family Registration</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Use your invite code to create an account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Invite Code"
            fieldProps={{
              value: form.code,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("code", e.target.value),
              required: true,
              placeholder: "e.g. KFI-A7X9P2",
              readOnly: isCodeLocked,
              autoComplete: "off",
              className: isCodeLocked
                ? "w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-base text-gray-500 outline-none"
                : undefined,
            }}
          />

          <FormField
            label="Family Name"
            fieldProps={{
              value: form.family_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_name", e.target.value),
              required: true,
              maxLength: 40,
              placeholder: "e.g. The Smith Family",
              autoComplete: "family-name",
            }}
          />

          <FormField
            label="Family Wish"
            fieldProps={{
              value: form.family_wish,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_wish", e.target.value),
              required: true,
              maxLength: 100,
              placeholder: "What would make your family's year special?",
              autoComplete: "off",
            }}
          />

          <FormField
            label="Contact Name"
            fieldProps={{
              value: form.contact_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("contact_name", e.target.value),
              required: true,
              maxLength: 40,
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

          <div>
            <OptionalLabel text="Bio" />
            <FormField
              as="textarea"
              fieldProps={{
                value: form.bio,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("bio", e.target.value),
                rows: 3,
                autoComplete: "off",
              }}
            />
          </div>

          <div>
            <FormField
              label="Address"
              fieldProps={{
                value: form.address,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("address", e.target.value),
                required: true,
                maxLength: 200,
                autoComplete: "street-address",
              }}
            />
            <p className="mt-1 text-xs text-gray-400">If no address, write 'none'</p>
          </div>

          <PhoneInput value={form.phone_number} onChange={(val) => update("phone_number", val)} />

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
