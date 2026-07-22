import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { OptionalLabel } from "../components/OptionalLabel";
import { useAuth } from "../context/AuthContext";
import { registerFamilyViaInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";

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
      const result = await registerFamilyViaInvite({
        code: form.code,
        family_name: form.family_name,
        family_wish: form.family_wish,
        contact_name: form.contact_name,
        email: form.email,
        password: form.password,
        bio: form.bio || null,
        address: form.address || null,
        phone_number: form.phone_number || null,
      });

      // Backend auto-logs the user in via cookies. Update auth context and redirect.
      setUser(result.user);
      navigate(ROUTES.FAMILY_DASHBOARD, { replace: true });
    } catch (err: unknown) {
      setError(formatApiError(err, "Registration failed. Check your invite code and try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-dark">Family Registration</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Use your invite code to create an account</p>

        {error && <ErrorBox message={error} className="mb-4" />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Invite Code"
            fieldProps={{
              value: form.code,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("code", e.target.value),
              required: true,
              placeholder: "e.g. KFI-A7X9P2",
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
            }}
          />

          <FormField
            label="Family Wish"
            fieldProps={{
              value: form.family_wish,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_wish", e.target.value),
              required: true,
              maxLength: 400,
              placeholder: "What would make your family's year special?",
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

          <div>
            <OptionalLabel text="Bio" />
            <FormField
              as="textarea"
              fieldProps={{
                value: form.bio,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("bio", e.target.value),
                rows: 3,
              }}
            />
          </div>

          <div>
            <OptionalLabel text="Address" />
            <FormField
              type="text"
              fieldProps={{
                value: form.address,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("address", e.target.value),
                maxLength: 200,
              }}
            />
          </div>

          <div>
            <OptionalLabel text="Phone" />
            <FormField
              type="text"
              fieldProps={{
                value: form.phone_number,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
                maxLength: 20,
                placeholder: "e.g. 07123 456789",
              }}
            />
          </div>

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
