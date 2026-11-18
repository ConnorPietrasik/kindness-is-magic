/**
 * AdminCampaignDialog — modal for composing a new email campaign (batch
 * email) or editing one that has not started delivering (a draft, or a
 * pending campaign with nothing sent yet).
 *
 * The recipient selection is role checkboxes, state-group checkboxes
 * (state-aware audiences — families/referrers/sponsors matching a review
 * or sponsorship state), plus an optional free-text list of extra
 * addresses. A debounced preview shows the resolved blast size before the
 * admin commits; the preview is a bonus display — a failing preview never
 * blocks the buttons (the backend re-resolves and validates at
 * creation/activation).
 *
 * Delivery: the optional "Send at" picker sets the earliest send time —
 * empty means send as soon as possible. A campaign with a future send
 * time finalizes its recipients when it sends (a state group matches who
 * is in that state then) — whether created scheduled or activated from a
 * draft; without one, activation finalizes immediately. A draft never
 * sends on its own. A time in the past is due now and is stored as
 * send-as-possible (create: null; edit: the stored time is cleared).
 * Create mode offers Save as draft / Create campaign (relabeling to
 * Schedule campaign when a time is picked). Edit mode offers Save changes
 * plus, for a draft, Save & send now (or Save & schedule): the patch is
 * persisted first, then the draft is activated. An already-activated
 * campaign only offers Save changes — sending is not a save action (the
 * detail's "Send now" clears the stored time instead; clearing it in the
 * picker and saving has the same effect).
 *
 * The form borrows the generic compose drawer's presentation: a live
 * preview in the branded email frame (same line-break rule as the
 * server), the same subject/message caps (the backend enforces identical
 * limits on both send paths), and its heading/field styling. The
 * recipient model (roles, state groups, manual addresses), the
 * draft/schedule/activate lifecycle, and the resolved-count preview are
 * campaign-specific, so this stays its own modal rather than a mode of
 * AdminEmailComposer.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { adminCreateEmailCampaign, adminPreviewEmailCampaign, adminSendEmailCampaign, adminUpdateEmailCampaign } from "../lib/api";
import { CUSTOM_EMAIL_DEFAULT_SUBJECT, splitMessageParagraphs } from "../lib/emailPreview";
import { adminEmailCampaignPreview, adminEmailCampaigns } from "../lib/queryKeys";
import { formatApiError, formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type { AdminCampaignUpdatePayload, EmailCampaignDetail, RecipientSegment, UserRole } from "../types";
import { Button } from "./Button";
import { DatePicker } from "./DatePicker";
import { EmailPreviewFrame } from "./EmailPreviewFrame";
import { FormField } from "./FormField";

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
 * State groups offered as checkboxes, in the order shown. Values mirror
 * the backend RecipientSegment enum (closed set — see
 * backend/app/models.py); labels use user-facing terminology (a donor's
 * claim is a "sponsorship"). ``label`` is the full sentence for form and
 * prose contexts; ``shortLabel`` is the table-column form (full label on
 * hover).
 */
export const SEGMENT_OPTIONS: { value: RecipientSegment; label: string; shortLabel: string }[] = [
  { value: "families_not_submitted_for_review", label: "Families that haven't submitted for review", shortLabel: "Unsubmitted families" },
  {
    value: "referrers_families_not_submitted",
    label: "Referrers with families not yet submitted for review",
    shortLabel: "Referrers with unsubmitted families",
  },
  { value: "donors_unfulfilled_gift_claims", label: "Sponsors with unfulfilled gift sponsorships", shortLabel: "Unfulfilled sponsorships" },
];

/**
 * Per-role, per-state-group + manual breakdown of a resolved preview, e.g.
 * "2 donors, 2 families that haven't submitted for review, 3 manual".
 * Non-empty whenever the preview's total is non-zero (the counts sum to
 * it — a recipient in several selections is counted in the winning bucket
 * only).
 */
function previewBreakdown(preview: {
  by_role: Partial<Record<UserRole, number>>;
  by_segment: Partial<Record<RecipientSegment, number>>;
  manual: number;
}): string {
  const parts: string[] = [];
  for (const { value, label } of ROLE_OPTIONS) {
    const count = preview.by_role[value];
    if (count) parts.push(`${count} ${label.toLowerCase()}`);
  }
  for (const { value, label } of SEGMENT_OPTIONS) {
    const count = preview.by_segment[value];
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
  /** When provided, the dialog edits this campaign (prefilled) instead of creating a new one. */
  campaign?: EmailCampaignDetail;
}

export function AdminCampaignDialog({ open, onClose, campaign }: AdminCampaignDialogProps) {
  // A drag that starts inside the dialog and ends on the backdrop (e.g.
  // releasing a text selection) fires click on the backdrop — the common
  // ancestor of the press and release — so a bare target check on the
  // click would close the dialog. Track the gesture: close only when both
  // the pointer-down and the pointer-up stayed on the backdrop.
  const backdropPressRef = useRef({ down: false, up: false });

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    const press = backdropPressRef.current;
    backdropPressRef.current = { down: false, up: false };
    if (e.target === e.currentTarget && press.down && press.up) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      role="presentation"
      onPointerDown={(e) => {
        backdropPressRef.current.down = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        backdropPressRef.current.up = e.target === e.currentTarget;
      }}
      onClick={handleBackdropClick}
    >
      {/* All hooks live in the content component (mounted only while open,
          per the ClaimModal pattern) so a conditional early return never
          changes the hook count. Closing unmounts it — the draft resets. */}
      <CampaignDialogContent onClose={onClose} campaign={campaign} />
    </div>
  );
}

function CampaignDialogContent({ onClose, campaign }: { onClose: () => void; campaign?: EmailCampaignDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const isEdit = campaign !== undefined;

  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>(campaign?.roles ?? []);
  const [selectedSegments, setSelectedSegments] = useState<RecipientSegment[]>(campaign?.segments ?? []);
  const [manualEmailsText, setManualEmailsText] = useState((campaign?.extra_emails ?? []).join("\n"));
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [message, setMessage] = useState(campaign?.message ?? "");
  // ISO 8601 UTC string, or "" for send-as-soon-as-possible.
  const [scheduledFor, setScheduledFor] = useState(campaign?.scheduled_for ?? "");

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
    () => ({ roles: selectedRoles, segments: selectedSegments, extra_emails: parseManualEmails(manualEmailsText) }),
    [selectedRoles, selectedSegments, manualEmailsText]
  );
  const debouncedSelection = useDebouncedState(selection, 500);
  const hasSelection =
    debouncedSelection.roles.length > 0 || debouncedSelection.segments.length > 0 || debouncedSelection.extra_emails.length > 0;
  const { data: preview, isError: previewError } = useQuery({
    queryKey: adminEmailCampaignPreview(debouncedSelection),
    queryFn: () => adminPreviewEmailCampaign(debouncedSelection),
    enabled: hasSelection,
  });

  // Live email preview (the compose drawer's shared parts): the server's
  // line-break rule + the branded frame, with the resolved count in the
  // frame's "To:" line once the debounced preview has counted it.
  const paragraphs = splitMessageParagraphs(message);
  const previewTo = preview && preview.total > 0 ? `${preview.total} recipient${preview.total === 1 ? "" : "s"}` : null;

  // A picked time in the past is due now — treat it as send-as-soon-as-
  // possible everywhere (create sends null; an edit clears the stored
  // time). A past time never travels to the backend as-is — the
  // create/update routes 422 on it.
  const sendsLater = scheduledFor !== "" && new Date(scheduledFor).getTime() > Date.now();

  const selectionEmpty = selectedRoles.length === 0 && selectedSegments.length === 0 && parseManualEmails(manualEmailsText).length === 0;
  // A blank message is invalid in both modes (the update route 422s it),
  // so it disables the save buttons instead of failing on submit.
  const messageBlank = message.trim().length === 0;
  const canSave = !selectionEmpty && !messageBlank;

  /** Minimal patch for edit mode (unchanged fields omitted). */
  const buildPatch = (): AdminCampaignUpdatePayload => {
    if (!campaign) return {};
    // A picked time in the past means send-as-soon-as-possible — on update
    // that is an explicit clear ("" — null would be a no-op, a past time
    // 422s).
    const effectiveScheduledFor = sendsLater ? scheduledFor : "";
    const patch: AdminCampaignUpdatePayload = normalizeUpdatePayload(
      {
        subject,
        message,
        roles: selectedRoles,
        segments: selectedSegments,
        extra_emails: parseManualEmails(manualEmailsText),
        scheduled_for: effectiveScheduledFor,
      },
      {
        subject: campaign.subject,
        message: campaign.message,
        roles: campaign.roles,
        segments: campaign.segments,
        extra_emails: campaign.extra_emails,
        scheduled_for: campaign.scheduled_for,
      }
    );
    return patch;
  };

  const patchEmpty = isEdit && Object.keys(buildPatch()).length === 0;

  // A draft edit offers Save changes plus Save & send now (a draft can
  // always be activated, even with an empty patch). An activated campaign
  // has no send action here — /send only applies to drafts and the
  // detail's "Send now" clears the stored time — so its buttons collapse
  // to a single Save changes (nothing to persist → disabled).
  const isDraftEdit = isEdit && campaign!.status === "draft";
  const canSaveChanges = isEdit && canSave && !patchEmpty;

  const createMutation = useMutation({
    mutationFn: (asDraft: boolean) =>
      adminCreateEmailCampaign({
        roles: selectedRoles,
        segments: selectedSegments,
        extra_emails: parseManualEmails(manualEmailsText),
        subject: subject.trim() ? subject : null,
        message,
        save_as_draft: asDraft,
        // A past time is due now — send ASAP (null) instead of 422ing.
        scheduled_for: sendsLater ? scheduledFor : null,
      }),
    onSuccess: (created, asDraft) => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
      if (asDraft) {
        // Drafts never send on their own — the stored time is the intended
        // send time if the admin ever activates the draft.
        toast.success(sendsLater ? "Draft saved — it won't send until you send it." : "Draft saved.");
      } else if (sendsLater) {
        // No recipient count — a scheduled campaign finalizes its
        // recipients when it sends (a state group matches the state then).
        toast.success(`Campaign scheduled for ${formatDateTime(scheduledFor)} — recipients are finalized when it sends.`);
      } else {
        toast.success(`Campaign queued — ${created.total_recipients} recipient${created.total_recipients === 1 ? "" : "s"}.`);
      }
      onClose();
    },
    onError: (err) => {
      toast.error(formatApiError(err, "Failed to save the campaign."));
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ send }: { send: boolean }) => {
      const patch = buildPatch();
      if (Object.keys(patch).length > 0) {
        await adminUpdateEmailCampaign(campaign!.id, patch);
      }
      if (send && campaign!.status === "draft") {
        return adminSendEmailCampaign(campaign!.id);
      }
      return null;
    },
    onSuccess: (sent, { send }) => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
      if (send) {
        if (sendsLater) {
          // No recipient count — a scheduled campaign finalizes its
          // recipients when it sends (a state group matches the state then).
          toast.success(`Campaign scheduled for ${formatDateTime(scheduledFor)} — recipients are finalized when it sends.`);
        } else {
          toast.success(
            sent
              ? `Campaign queued — ${sent.total_recipients} recipient${sent.total_recipients === 1 ? "" : "s"}.`
              : "The campaign will send as soon as possible."
          );
        }
      } else {
        toast.success("Campaign updated.");
      }
      onClose();
    },
    onError: (err) => {
      toast.error(formatApiError(err, "Failed to update the campaign."));
    },
  });

  const toggleRole = (role: UserRole) => {
    setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const toggleSegment = (segment: RecipientSegment) => {
    setSelectedSegments((prev) => (prev.includes(segment) ? prev.filter((s) => s !== segment) : [...prev, segment]));
  };

  const primaryLabel = !isEdit
    ? sendsLater
      ? "Schedule campaign"
      : "Create campaign"
    : isDraftEdit
      ? sendsLater
        ? "Save & schedule"
        : "Save & send now"
      : "Save changes";

  return (
    <div
      className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit campaign" : "New email campaign"}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{isEdit ? "Edit campaign" : "New email campaign"}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Single column: form above, preview below. The two-column split
          borrowed from the compose drawer was awkward at this dialog's
          height (both sides scrolling), so the wider max-w-3xl just gives
          the form and the framed preview more room. */}
      <div className="space-y-6">
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

          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Send to state groups</span>
            <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {SEGMENT_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedSegments.includes(value)}
                    onChange={() => toggleSegment(value)}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-btn-start focus:ring-btn-start/30"
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

          <FormField
            label="Subject"
            labelSuffix={isEdit ? undefined : "(optional)"}
            fieldProps={{
              value: subject,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value),
              placeholder: CUSTOM_EMAIL_DEFAULT_SUBJECT,
              autoComplete: "off",
              // Keep in sync with subject max_length on the campaign create/update requests (backend/app/schemas.py)
              maxLength: 200,
            }}
          />

          <div>
            <FormField
              label="Message"
              as="textarea"
              fieldProps={{
                value: message,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value),
                placeholder: "Plain text — blank lines start a new paragraph.",
                rows: 8,
                autoComplete: "off",
                // Keep in sync with message max_length on the campaign create/update requests (backend/app/schemas.py)
                maxLength: 5000,
              }}
            />
            <p className="mt-1 text-right text-xs text-gray-400">{message.length}/5000</p>
          </div>

          <DatePicker label="Send at" isOptional value={scheduledFor || null} onChange={setScheduledFor} />
          <p className="-mt-2 text-xs text-gray-500">Leave empty to send as soon as possible.</p>
        </div>

        {/* Preview — the resolved count and the email as the recipients
            will see it (branded frame, server's line-break rule), like
            the generic compose drawer. */}
        <div>
          {/* Recipient preview — a bonus display; a failing preview is
              ignored (the backend re-validates at creation/activation). */}
          <div className="rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
            {hasSelection ? (
              previewError ? (
                // Usually an invalid manual address (422) — the backend
                // re-validates and surfaces the exact error, so this never blocks.
                "Preview unavailable — check the extra addresses. You can still save the campaign."
              ) : preview ? (
                preview.total === 0 ? (
                  "No matching users — select at least one role or state group, or add an address."
                ) : (
                  <>
                    Will send to <strong>{preview.total}</strong> recipient{preview.total === 1 ? "" : "s"} · {previewBreakdown(preview)}
                  </>
                )
              ) : (
                "Counting recipients…"
              )
            ) : (
              "Select roles, state groups, or add addresses to see how many people will be emailed."
            )}
          </div>

          <EmailPreviewFrame to={previewTo} subject={subject.trim() || CUSTOM_EMAIL_DEFAULT_SUBJECT}>
            {paragraphs.length > 0 ? (
              paragraphs.map((lines, i) => (
                <p key={i} className="mb-3">
                  {lines.map((line, j) => (
                    <Fragment key={j}>
                      {j > 0 && <br />}
                      {line}
                    </Fragment>
                  ))}
                </p>
              ))
            ) : (
              <p className="italic text-gray-400">Your message will appear here as you type.</p>
            )}
          </EmailPreviewFrame>

          <p className="mt-4 text-xs text-gray-500">
            {isEdit
              ? "Recipients are finalized when the campaign is sent. You can cancel a campaign any time before it finishes — un-sent recipients are skipped."
              : "Emails are delivered slowly over time so they don't look like spam. You can cancel a campaign any time before it finishes — un-sent recipients are skipped."}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {!isEdit && (
          <Button
            variant="secondary"
            onClick={() => createMutation.mutate(true)}
            disabled={!canSave}
            loading={createMutation.isPending && createMutation.variables === true}
          >
            Save as draft
          </Button>
        )}
        {isDraftEdit && (
          <Button
            variant="secondary"
            onClick={() => saveMutation.mutate({ send: false })}
            disabled={!canSaveChanges}
            loading={saveMutation.isPending && saveMutation.variables?.send === false}
          >
            Save changes
          </Button>
        )}
        {!isEdit ? (
          <Button
            onClick={() => createMutation.mutate(false)}
            disabled={!canSave}
            loading={createMutation.isPending && createMutation.variables === false}
          >
            {primaryLabel}
          </Button>
        ) : isDraftEdit ? (
          <Button
            onClick={() => saveMutation.mutate({ send: true })}
            disabled={!canSave}
            loading={saveMutation.isPending && saveMutation.variables?.send === true}
          >
            {primaryLabel}
          </Button>
        ) : (
          <Button onClick={() => saveMutation.mutate({ send: false })} disabled={!canSaveChanges} loading={saveMutation.isPending}>
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
