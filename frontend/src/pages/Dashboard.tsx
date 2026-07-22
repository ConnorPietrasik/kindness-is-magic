import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { HeaderBar, LogoutButton } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { changePasswordRequest, getReferrerMe, listPendingFamilies, patchReferrerMe } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { humanize, normalizeUpdatePayload } from "../lib/utils";
import type { ReferrerDetail, ReferrerPayload, UserRole } from "../types";

const REFERRER_ME_KEY = ["referrerMe"];
const PENDING_FAMILIES_KEY = ["pendingFamilies"];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  const roleColors: Record<UserRole, string> = {
    admin: "bg-red-600",
    referrer: "bg-blue-600",
    family: "bg-green-600",
  };

  const badgeClass = `${roleColors[user?.role as UserRole] ?? "bg-gray-500"} inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white`;

  // Referrer-specific queries (only run when role is referrer)
  const { data: referrerInfo, isLoading: referrerLoading } = useQuery({
    queryKey: REFERRER_ME_KEY,
    queryFn: getReferrerMe,
    enabled: user?.role === "referrer",
  });

  const { data: pendingFamilies } = useQuery({
    queryKey: PENDING_FAMILIES_KEY,
    queryFn: listPendingFamilies,
    enabled: user?.role === "referrer",
  });

  if (user?.role === "referrer" && referrerLoading) {
    return <PageSpinner />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" right={<LogoutButton onClick={handleLogout} />} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Welcome card */}
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Welcome back!</h2>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-btn-start to-btn-end text-lg font-bold text-white">
              {user?.email?.[0]?.toUpperCase() || "?"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-gray-900">{user?.email}</span>
                <span className={badgeClass}>{humanize(user?.role)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                {user?.referrer_id && <span>Referrer ID: {user.referrer_id}</span>}
                {user?.family_id && <span>Family ID: {user.family_id}</span>}
              </div>
            </div>
          </div>
        </Card>

        {/* Referrer profile card */}
        {user?.role === "referrer" && referrerInfo && <ReferrerInfoCard referrerInfo={referrerInfo} />}

        {/* Referrer pending approvals alert */}
        {user?.role === "referrer" && pendingFamilies && pendingFamilies.length > 0 && (
          <Link
            to={ROUTES.REFERRER_PENDING_FAMILIES}
            className="mb-6 block rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100"
          >
            {pendingFamilies.length} family{pendingFamilies.length > 1 ? "ies" : ""} awaiting your approval →
          </Link>
        )}

        {/* Navigation cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {user?.role === "admin" && (
            <>
              <NavCard to={ROUTES.REGISTER} icon="👤" label="Register Users" desc="Create new accounts" />
              <NavCard to={ROUTES.ADMIN_REFERRERS} icon="👥" label="Manage Referrers" desc="Create, edit, delete referrers" />
              <NavCard to={ROUTES.ADMIN_FAMILIES} icon="🏠" label="Manage Families" desc="Create, edit, delete families" />
              <NavCard to={ROUTES.ADMIN_PEOPLE} icon="✨" label="Manage People" desc="Create, edit, delete people" />
              <NavCard to={ROUTES.ADMIN_CSV_UPLOAD} icon="📊" label="CSV Import" desc="Bulk-import referrers, families, people & users" />
              <NavCard
                to={ROUTES.ADMIN_INVITE_REFERRER}
                icon="💌"
                label="Invite Referrers"
                desc="Generate invite codes for self-registration"
              />
            </>
          )}

          {user?.role === "referrer" && (
            <>
              <NavCard to={ROUTES.REFERRER_FAMILIES} icon="🏠" label="My Families" desc="Manage your approved families" />
              <NavCard to={ROUTES.REFERRER_PENDING_FAMILIES} icon="⏳" label="Pending Approvals" desc="Review family applications" />
            </>
          )}

          {user?.role === "family" && (
            <NavCard to={ROUTES.FAMILY_DASHBOARD} icon="✨" label="My Family" desc="View your profile and manage people" />
          )}
        </div>

        {/* Change password */}
        <ChangePasswordSection />
      </main>
    </div>
  );
}

/**
 * ReferrerInfoCard — referrer profile info with invite code and inline self-edit.
 */
interface ReferrerInfoCardProps {
  referrerInfo: ReferrerDetail;
}

function ReferrerInfoCard({ referrerInfo }: ReferrerInfoCardProps) {
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);

  const updateSelfMut = useMutation({
    mutationFn: patchReferrerMe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REFERRER_ME_KEY });
      setShowEdit(false);
    },
  });

  const familyLimit = referrerInfo.family_limit ?? 0;
  const familyCount = referrerInfo.family_count ?? 0;

  function handleUpdateSelf(formData: ReferrerPayload) {
    const payload = normalizeUpdatePayload(formData, referrerInfo);
    updateSelfMut.mutate(payload);
  }

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Referrer Profile</h3>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEdit(!showEdit)}>
          {showEdit ? "Cancel" : "Edit"}
        </Button>
      </div>

      {showEdit ? (
        <ReferrerSelfForm
          initial={referrerInfo}
          onSubmit={handleUpdateSelf}
          onCancel={() => setShowEdit(false)}
          loading={updateSelfMut.isPending}
        />
      ) : (
        <div className="space-y-0">
          <InfoRow label="Name" value={referrerInfo.name} truncate={false} />
          <InfoRow label="Phone" value={referrerInfo.phone_number} truncate={false} />
          <CopyableRow label="Family Invite Code" value={referrerInfo.family_invite_code ?? "Generating…"} />
          <InfoRow label="Family Limit" value={`${familyCount} / ${familyLimit}`} isLast truncate={false} />
        </div>
      )}

      <MutationErrors mutations={[updateSelfMut]} />
    </Card>
  );
}

/**
 * ReferrerSelfForm — inline form for editing referrer name and phone.
 */
interface ReferrerSelfFormProps {
  initial: ReferrerDetail;
  onSubmit: (data: ReferrerPayload) => void;
  onCancel: () => void;
  loading: boolean;
}

function ReferrerSelfForm({ initial, onSubmit, onCancel, loading }: ReferrerSelfFormProps) {
  const [form, setForm] = useState<ReferrerPayload>(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="mx-auto max-w-sm space-y-3"
    >
      <FormField
        label="Name"
        fieldProps={{
          type: "text",
          value: form.name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
          required: true,
          maxLength: 60,
        }}
      />
      <FormField
        label="Phone"
        fieldProps={{
          type: "text",
          value: form.phone_number,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
          required: true,
          maxLength: 20,
        }}
      />
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading} className="flex-1">
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * CopyableRow — label/value row with a copy-to-clipboard button.
 */
interface CopyableRowProps {
  label: string;
  value: string;
}

function CopyableRow({ label, value }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-baseline justify-between px-1 py-2 border-b border-gray-100">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">{value ?? "\u2014"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? "✓" : "🗐"}
        </button>
      </div>
    </div>
  );
}

/**
 * NavCard — clickable nav card with icon, label and description.
 */
interface NavCardProps {
  to: string;
  icon: string;
  label: string;
  desc: string;
}

function NavCard({ to, icon, label, desc }: NavCardProps) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold text-gray-900 group-hover:text-btn-start">{label}</span>
      <span className="text-xs text-gray-400">{desc}</span>
    </Link>
  );
}

/**
 * ChangePasswordSection — form to change the user's password.
 */
function ChangePasswordSection() {
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");

    if (newPass !== confirmPass) {
      setMessage("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await changePasswordRequest(oldPass, newPass);
      setMessage("Password updated successfully!");
      setOldPass("");
      setNewPass("");
      setConfirmPass("");
    } catch (err: unknown) {
      setMessage((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };

  const isOk = message.toLowerCase().includes("success");

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Change Password</h2>
      {message && <ErrorBox variant={isOk ? "success" : "error"} message={message} className="mb-4" />}
      <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
        <FormField
          label="Current password"
          type="password"
          fieldProps={{ value: oldPass, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOldPass(e.target.value), required: true }}
        />
        <FormField
          label="New password"
          type="password"
          fieldProps={{
            value: newPass,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPass(e.target.value),
            required: true,
            minLength: 8,
            placeholder: "Min 8 characters",
          }}
        />
        <FormField
          label="Confirm new password"
          type="password"
          fieldProps={{
            value: confirmPass,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setConfirmPass(e.target.value),
            required: true,
            minLength: 8,
          }}
        />
        <Button type="submit" loading={loading}>
          {loading ? "Updating…" : "Update Password"}
        </Button>
      </form>
    </Card>
  );
}
