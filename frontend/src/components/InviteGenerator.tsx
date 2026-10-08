/**
 * InviteGenerator — inline form for creating new referrer invite codes.
 *
 * Self-contained: reads the inviter name from auth, toasts its own results,
 * and invalidates the admin invites query cache on success. The live email
 * preview (InviteEmailPreview) is part of this flow and lives with it.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { createReferrerInvite } from "../lib/api";
import { adminInvites } from "../lib/queryKeys";
import { formatApiError, formatDateTime, safeGetItem, safeSetItem } from "../lib/utils";
import type { ReferrerInviteCreatePayload, ReferrerInviteResponse } from "../types";
import { Button } from "./Button";
import { Card } from "./Card";
import { FormField } from "./FormField";
import { InviteEmailPreview } from "./InviteEmailPreview";

/* Persisted locally so an admin can reuse the same custom message for many
   referrers across visits (per-browser preference, like the other kim:* keys). */
const INVITE_MESSAGE_STORAGE_KEY = "kim:referrerInviteMessage";

export function InviteGenerator() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [familyLimit, setFamilyLimit] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(() => safeGetItem(INVITE_MESSAGE_STORAGE_KEY) ?? "");
  const [invite, setInvite] = useState<ReferrerInviteResponse | null>(null);

  // Persist to localStorage so the message survives navigation and browser restarts.
  useEffect(() => {
    safeSetItem(INVITE_MESSAGE_STORAGE_KEY, message);
  }, [message]);

  // The invite email is only sent when an email address is provided — the
  // custom message field and preview only make sense in that case.
  const hasEmail = email.trim().length > 0;

  // Parsed limit for the email preview; null while the field is empty/invalid.
  const parsedLimit = useMemo(() => {
    if (familyLimit === "") return null;
    const n = parseInt(familyLimit, 10);
    return Number.isNaN(n) || n < 1 || n > 999 ? null : n;
  }, [familyLimit]);

  // Inviter name for the email preview — mirrors _get_inviter_name (backend/app/auth_routes.py).
  // This route is admin-only, so only the admin branch is reachable: the display name, falling
  // back to "Kindness Fairy" (truthy check, so an empty string falls through too).
  const inviterName = user?.display_name || (user?.role === "admin" ? "Kindness Fairy" : null);

  const createMut = useMutation({
    mutationFn: (data: ReferrerInviteCreatePayload) => createReferrerInvite(data),
    onSuccess: (data) => {
      setInvite(data);
      queryClient.invalidateQueries({ queryKey: adminInvites });
      if (data.email_error) {
        toast.info(data.email_error);
      }
    },
    onError: (err: unknown) => {
      toast.error(formatApiError(err, "Failed to create invite."));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInvite(null);

    const limit = parseInt(familyLimit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 999) {
      toast.error("Family limit must be between 1 and 999.");
      return;
    }

    createMut.mutate({
      family_limit: limit,
      email: email.trim() || null,
      email_message: message.trim() || null,
    });
  };

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-3 text-base font-semibold text-gray-900">Generate Invite Code</h3>
      <p className="mb-4 text-sm text-gray-500">
        Create a one-time invite code that allows someone to self-register as a referrer. The code expires after 7 days.
      </p>

      {/* Success display */}
      {invite && (
        <div className="mb-4 rounded-lg border-2 border-green-200 bg-green-50/50 p-4">
          <p className="mb-2 text-sm font-medium text-green-800">Invite Code Generated</p>
          <div className="mb-2 text-2xl font-mono font-bold tracking-wider text-brand-dark">{invite.code}</div>
          <div className="flex gap-4 text-sm text-green-700">
            <span>Family limit: {invite.family_limit}</span>
            <span>Expires: {formatDateTime(invite.expires_at)}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
              autoComplete: "off",
            }}
          />
          <FormField
            label="Email (optional)"
            type="email"
            fieldProps={{
              value: email,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
              placeholder: "referrer@example.com",
              autoComplete: "off",
            }}
          />
          <Button type="submit" loading={createMut.isPending} className="sm:ml-auto">
            {createMut.isPending ? "Generating\u2026" : "Generate"}
          </Button>
        </div>
        {hasEmail && (
          <FormField
            label="Custom Message (optional)"
            as="textarea"
            fieldProps={{
              value: message,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value),
              placeholder: "Leave blank to send the default message",
              autoComplete: "off",
              rows: 4,
              // Keep in sync with the email_message max_length on ReferrerInviteCreate (backend/app/schemas.py)
              maxLength: 5000,
            }}
          />
        )}
      </form>
      <p className="mt-3 text-xs text-gray-400">Including an email locks this invite to that address</p>

      {/* Live preview of the invite email as it will be sent — only when an email
          is set, since the backend skips sending without one */}
      {hasEmail && (
        <InviteEmailPreview message={message} familyLimit={parsedLimit} email={email.trim() || null} inviterName={inviterName} />
      )}
    </Card>
  );
}
