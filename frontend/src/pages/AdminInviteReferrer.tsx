import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { HeaderBar } from "../components/HeaderBar";
import { createReferrerInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";
import type { ReferrerInviteResponse } from "../types";

export default function AdminInviteReferrer() {
  const [familyLimit, setFamilyLimit] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<ReferrerInviteResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInvite(null);

    const limit = parseInt(familyLimit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 999) {
      setError("Family limit must be between 1 and 999.");
      return;
    }

    setLoading(true);
    try {
      const result = await createReferrerInvite({ family_limit: limit });
      setInvite(result);
    } catch (err: unknown) {
      setError(formatApiError(err, "Failed to create invite."));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Invite Referrer" />

      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        {/* Create invite form */}
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Generate Invite Code</h2>
          <p className="mb-4 text-sm text-gray-500">
            Create a one-time invite code that allows someone to self-register as a referrer. The code expires after 24 hours.
          </p>

          {error && <ErrorBox message={error} className="mb-4" />}

          <form onSubmit={handleSubmit} className="space-y-3">
            <FormField
              label="Family Limit"
              type="number"
              fieldProps={{
                value: familyLimit,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFamilyLimit(e.target.value),
                required: true,
                min: 1,
                max: 999,
                placeholder: "e.g. 10",
              }}
            />
            <Button type="submit" loading={loading}>
              {loading ? "Generating…" : "Generate Invite Code"}
            </Button>
          </form>
        </Card>

        {/* Generated invite display */}
        {invite && (
          <Card className="mb-6 border-2 border-green-200 bg-green-50/50">
            <h2 className="mb-3 text-lg font-semibold text-green-800">Invite Code Generated</h2>
            <p className="mb-4 text-sm text-green-700">Share this code with the referrer so they can self-register:</p>

            <div className="mb-4 rounded-lg bg-white p-4 shadow-sm">
              <div className="mb-2 text-sm text-gray-500">Code</div>
              <div className="text-2xl font-mono font-bold tracking-wider text-brand-dark">{invite.code}</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="text-sm text-gray-500">Family Limit</div>
                <div className="text-lg font-semibold text-gray-900">{invite.family_limit}</div>
              </div>
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="text-sm text-gray-500">Expires</div>
                <div className="text-lg font-semibold text-gray-900">{formatDate(invite.expires_at)}</div>
              </div>
            </div>
          </Card>
        )}

        <p className="text-center text-sm">
          <Link to={ROUTES.DASHBOARD} className="text-btn-start hover:underline">
            ← Back to dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}
