/**
 * AdminCampaignDialog — modal for composing a new email campaign (batch email).
 *
 * The recipient selection is role checkboxes (any subset of the six roles)
 * plus an optional free-text list of extra addresses. A debounced preview
 * shows the resolved blast size before the admin commits; the preview is a
 * bonus display — a failing preview never blocks the Create button (the
 * backend re-resolves and validates at creation).
 *
 * Creates via POST /api/admin/email-campaigns, which freezes the recipient
 * snapshot and queues delivery to the paced background worker — so success
 * means "queued", not "delivered".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { adminCreateEmailCampaign, adminPreviewEmailCampaign } from "../lib/api";
import { adminEmailCampaignPreview, adminEmailCampaigns } from "../lib/queryKeys";
import { formatApiError } from "../lib/utils";
import type { EmailCampaignPreview, UserRole } from "../types";
import { Button } from "./Button";
import { FormField } from "./FormField";

/** COUPLING: mirrors CUSTOM_EMAIL_DEFAULT_SUBJECT in backend/app/mail.py —
 * shown as the Subject placeholder (the server applies the same default). */
const DEFAULT_SUBJECT = "A message from Kindness Is Magic ✨";

/** Roles offered as checkboxes, in the order shown. */
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "donor", label: "Donors" },
  { value: "referrer", label: "Referrers" },
  { value: "family", label: "Families" },
  { value: "purchaser", label: "Purchasers" },
  { value: "delivery", label: "Delivery" },
  { value: "admin", label: "Admins" },
];

/**
 * Per-role + manual breakdown of a resolved preview, e.g. "2 donors, 3 manual".
 * Non-empty whenever the preview's total is non-zero (the counts sum to it).
 */
function previewBreakdown(preview: EmailCampaignPreview): string {
  const parts: string[] = [];
  for (const { value, label } of ROLE_OPTIONS) {
    const count = preview.by_role[value];
    if (count) parts.push(`${count} ${label.toLowerCase()}`);
  }
  if (preview.manual) parts.push(`${preview.manual} manual`);
  return parts.join(", ");
}

/**
 * Parse the free-text manual-address field into a normalized, deduped email
 * list. Accepts comma, semicolon, or whitespace (incl. newlines) as
 * separators; trims, lowercases, and drops empties.
 */
export function parseManualEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

export interface AdminCampaignDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AdminCampaignDialog({ open, onClose }: AdminCampaignDialogProps) {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={handleBackdropClick} role="presentation">
      {/* All hooks live in the content component (mounted only while open,
          per the ClaimModal pattern) so a conditional early return never
          changes the hook count. Closing unmounts it — the draft resets. */}
      <CampaignDialogContent onClose={onClose} />
    </div>
  );
}

function CampaignDialogContent({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const [manualEmailsText, setManualEmailsText] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Close on Escape via a window-level listener — a bubbling onKeyDown on
  // the backdrop div only fires while focus is inside the dialog. The
  // content mounts only while the dialog is open, so the listener's
  // lifetime matches the open state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The debounced selection drives the preview query (a new object per
  // keystroke — React Query hashes the key structurally).
  const selection = useMemo(
    () => ({ roles: selectedRoles, extra_emails: parseManualEmails(manualEmailsText) }),
    [selectedRoles, manualEmailsText]
  );
  const debouncedSelection = useDebouncedState(selection, 500);
  const hasSelection = debouncedSelection.roles.length > 0 || debouncedSelection.extra_emails.length > 0;
  const { data: preview, isError: previewError } = useQuery({
    queryKey: adminEmailCampaignPreview(debouncedSelection),
    queryFn: () => adminPreviewEmailCampaign(debouncedSelection),
    enabled: hasSelection,
  });

  const canSubmit = message.trim().length > 0 && (selectedRoles.length > 0 || parseManualEmails(manualEmailsText).length > 0);

  const createMutation = useMutation({
    mutationFn: () =>
      adminCreateEmailCampaign({
        roles: selectedRoles,
        extra_emails: parseManualEmails(manualEmailsText),
        subject: subject.trim() ? subject : null,
        message,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
      toast.success(`Campaign queued — ${created.total_recipients} recipient${created.total_recipients === 1 ? "" : "s"}.`);
      onClose();
    },
    onError: (err) => {
      toast.error(formatApiError(err, "Failed to create the campaign."));
    },
  });

  const toggleRole = (role: UserRole) => {
    setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  return (
    <div
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="New email campaign"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-violet-950">New email campaign</h3>
        <button type="button" onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Send to roles</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-3">
            {ROLE_OPTIONS.map(({ value, label }) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(value)}
                  onChange={() => toggleRole(value)}
                  className="h-4 w-4 rounded border-gray-300 text-btn-start focus:ring-btn-start/30"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <FormField
          label="Extra email addresses"
          labelSuffix="(optional)"
          as="textarea"
          fieldProps={{
            value: manualEmailsText,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setManualEmailsText(e.target.value),
            placeholder: "One address per line, or comma-separated…",
            rows: 3,
            autoComplete: "off",
          }}
        />

        {/* Recipient preview — a bonus display; a failing preview is
            ignored (the backend re-validates at creation). */}
        <div className="rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          {hasSelection ? (
            previewError ? (
              // Usually an invalid manual address (422) — creation re-validates
              // server-side and surfaces the exact error, so this never blocks.
              "Preview unavailable — check the extra addresses. You can still create the campaign."
            ) : preview ? (
              preview.total === 0 ? (
                "No matching users — select at least one role or add an address."
              ) : (
                <>
                  Will send to <strong>{preview.total}</strong> recipient{preview.total === 1 ? "" : "s"} · {previewBreakdown(preview)}
                </>
              )
            ) : (
              "Counting recipients…"
            )
          ) : (
            "Select roles or add addresses to see how many people will be emailed."
          )}
        </div>

        <FormField
          label="Subject"
          labelSuffix="(optional)"
          fieldProps={{
            value: subject,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value),
            placeholder: DEFAULT_SUBJECT,
            autoComplete: "off",
          }}
        />

        <FormField
          label="Message"
          as="textarea"
          fieldProps={{
            value: message,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value),
            placeholder: "Plain text — blank lines start a new paragraph.",
            rows: 6,
            autoComplete: "off",
          }}
        />
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Emails are delivered slowly over time so they don't look like spam. You can cancel a campaign any time before it finishes — un-sent
        recipients are skipped.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} loading={createMutation.isPending}>
          Create campaign
        </Button>
      </div>
    </div>
  );
}
