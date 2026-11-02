/**
 * AdminEmailComposer — right-docked, non-modal drawer for sending a freeform
 * ("custom") email to any recipient, with a live preview in the branded email
 * style.
 *
 * The drawer is intentionally non-modal on desktop: no backdrop, and the page
 * behind stays visible and interactive, so the admin can compose next to the
 * reference material (e.g. the family's wishes). The left edge is drag-to-
 * resize (double-click resets, arrow keys when focused); the chosen width is
 * remembered, and once the panel is at least TWO_COLUMN_MIN_WIDTH the form and
 * preview sit side by side — below that they stack. Dragging the edge past the
 * minimum (beyond a small grace, with a "Release to park" hint) — or the
 * header's park button — collapses the panel into a slim rail; pulling the
 * edge back, double-clicking, or an arrow key restores the previous width.
 * The form's state is kept while parked, so a draft is never lost. Below the
 * `lg` breakpoint the drawer is a full-width sheet with a light tap-to-close
 * backdrop.
 *
 * When the entry point passes `recipientOptions` (the people it knows about,
 * e.g. the family contact and the referrer), the recipient is a select over
 * them plus an "Other…" option that reveals a free-text field — the common
 * case is a click, not a typed email, which guards against typos to known
 * people. Entry points without options (e.g. the Sent Emails "+ Compose")
 * get the plain editable field: anyone, anywhere. Sends via
 * POST /api/admin/emails/send, which reuses the shared send path: the
 * unsubscribe gate applies (unsubscribed recipients are blocked and
 * reported), and one SentEmail row (kind custom_message) is recorded per
 * attempt — so the sent-email log is invalidated on every completed attempt.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useToast } from "../context/ToastContext";
import { DEFAULT_PANEL_WIDTH, getMaxPanelWidth, MIN_PANEL_WIDTH, PARKED_PANEL_WIDTH, useResizablePanel } from "../hooks/useResizablePanel";
import { adminSendCustomEmail } from "../lib/api";
import { splitMessageParagraphs } from "../lib/emailPreview";
import { adminSentEmails } from "../lib/queryKeys";
import { formatApiError } from "../lib/utils";
import type { AdminSendEmailPayload } from "../types";
import { Button } from "./Button";
import { EmailPreviewFrame } from "./EmailPreviewFrame";
import { FormField } from "./FormField";

// COUPLING: mirrors CUSTOM_EMAIL_DEFAULT_SUBJECT in backend/app/admin_emails.py —
// shown as the Subject placeholder and in the preview whenever the subject is
// blank (the server applies the same default).
const DEFAULT_SUBJECT = "A message from Kindness Is Magic ✨";

/** Select value for the "Other…" free-text recipient option. */
const OTHER = "other";

/** Narrowest panel width at which form and preview sit side by side (px). */
const TWO_COLUMN_MIN_WIDTH = 680;
// Mirrors Tailwind's `lg` — below it the drawer is a full-width sheet, so the
// px width and the two-column layout only apply at lg and up.
const LG_BREAKPOINT = 1024;
/** Popup roles that get Escape before the drawer does (each closes itself). */
const POPUP_ROLES_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** A known recipient the entry point can offer in the recipient select. */
export interface EmailRecipientOption {
  /** The address sent to (the select option's value). */
  email: string;
  /** Short role shown before the address, e.g. "Family contact". */
  label: string;
}

export interface AdminEmailComposerProps {
  open: boolean;
  /** Context line under the title, e.g. "Family 2-1 — The Johnsons". Omit for a generic compose. */
  contextLabel?: string | null;
  /** Optional read-only reference block under the title (e.g. the family's wishes). */
  context?: ReactNode | null;
  /** Recipient preselected (a matching option) or pretyped (Other free text). */
  prefilledRecipient?: string | null;
  /** Known recipients offered as a select (plus "Other…" free text). Omit for a plain editable field. */
  recipientOptions?: EmailRecipientOption[] | null;
  onClose: () => void;
}

export function AdminEmailComposer({
  open,
  contextLabel = null,
  context = null,
  prefilledRecipient = null,
  recipientOptions = null,
  onClose,
}: AdminEmailComposerProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Recipient: one of the known options (its email) or "other" (free text)
  const [recipientChoice, setRecipientChoice] = useState(OTHER);
  const [otherRecipient, setOtherRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const {
    width,
    isResizing,
    collapsed,
    collapseArmed,
    onPointerDown: startResize,
    onDoubleClick: resetWidth,
    onKeyDown: resizeKeyDown,
    park,
    expand,
  } = useResizablePanel("kim:emailComposerWidth");

  // Track the lg breakpoint in JS too: the panel is CSS-full-width below it,
  // so the px width and the two-column layout only apply at lg and up.
  const [isLg, setIsLg] = useState(() => window.innerWidth >= LG_BREAKPOINT);
  useEffect(() => {
    const onWindowResize = () => setIsLg(window.innerWidth >= LG_BREAKPOINT);
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // Close on Escape (the drawer is non-modal, so there's no backdrop to
  // click) — but only when no popup is stacked on top of it. A confirm dialog
  // or open menu closes itself on Escape and gets the key first; the drawer
  // yields. Popups are detected by role, so any dialog/menu in the document
  // qualifies (the drawer's own panel is the one dialog we ignore).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const popups = document.querySelectorAll<HTMLElement>(POPUP_ROLES_SELECTOR);
      if (Array.from(popups).some((el) => el !== panelRef.current)) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Put focus in the drawer when it opens (when it closes, focus falls back
  // to the page, which is the point of a non-modal drawer).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // When it parks, move focus to the resize handle — the element that can
  // restore the panel with an arrow key (the rail body is pointer-only).
  useEffect(() => {
    if (collapsed) handleRef.current?.focus();
  }, [collapsed]);

  const options = recipientOptions ?? [];
  const hasOptions = options.length > 0;
  const isOther = recipientChoice === OTHER;
  const recipient = isOther ? otherRecipient : recipientChoice;

  // The prefill, when it matches a known recipient — its email (a stable
  // string, so the reset effect below can depend on it directly) — else ""
  const prefillMatch = options.find((o) => o.email === prefilledRecipient)?.email ?? "";

  // Reset the form whenever the dialog opens — and when its prefill or option
  // match changes while open (e.g. the lazy referrer fetch landing). The
  // prefill lands in the select when it matches a known recipient, else in
  // the Other free-text field.
  useEffect(() => {
    if (open) {
      if (prefillMatch) setRecipientChoice(prefillMatch);
      else {
        setRecipientChoice(OTHER);
        setOtherRecipient(prefilledRecipient ?? "");
      }
      setSubject("");
      setMessage("");
    }
  }, [open, prefilledRecipient, prefillMatch]);

  const trimmedRecipient = recipient.trim();
  const canSend = trimmedRecipient.length > 0 && message.trim().length > 0;

  const sendMut = useMutation({
    mutationFn: (data: AdminSendEmailPayload) => adminSendCustomEmail(data),
    onSuccess: (result) => {
      // A SentEmail row is recorded for every attempt (sent, unsubscribed, or
      // SMTP failure) — always refresh the log.
      queryClient.invalidateQueries({ queryKey: adminSentEmails });
      if (result.sent) {
        toast.success("Email sent");
      } else if (result.reason === "unsubscribed") {
        toast.info("Send skipped — the recipient has unsubscribed from our emails.");
      } else {
        toast.error("The email could not be sent (SMTP error). Please try again.");
      }
      onClose();
    },
    onError: (err: unknown) => {
      // Request-level failure (validation, rate limit, network) — stay open so
      // the admin can fix and retry.
      toast.error(formatApiError(err, "Failed to send email."));
    },
  });

  if (!open) return null;

  const paragraphs = splitMessageParagraphs(message);
  const panelWidth = width ?? DEFAULT_PANEL_WIDTH;
  const twoCol = isLg && panelWidth >= TWO_COLUMN_MIN_WIDTH;
  const maxPanelWidth = getMaxPanelWidth();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMut.mutate({
      recipient_email: trimmedRecipient,
      subject, // blank → null in the api function (server applies the default)
      message,
    });
  }

  return (
    // Non-modal on desktop: the wrapper is pointer-transparent so the page
    // behind stays fully interactive; the drawer (and the mobile-only backdrop)
    // re-enable pointer events for themselves.
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Below lg the drawer is a full-width sheet: light backdrop, tap to close. */}
      <div className="pointer-events-auto absolute inset-0 bg-black/20 lg:hidden" onClick={onClose} role="presentation" />

      <div
        ref={panelRef}
        role="dialog"
        aria-label="Send email"
        tabIndex={-1}
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl outline-none"
        style={isLg ? { width: collapsed ? PARKED_PANEL_WIDTH : panelWidth, maxWidth: "100%" } : undefined}
      >
        {/* Left-edge resize handle (lg+ only — the sheet is full-width below):
            drag to resize, drag past the minimum and release to park,
            double-click to reset/restore, arrow keys when focused. */}
        <div
          ref={handleRef}
          role="slider"
          aria-label="Resize panel"
          aria-orientation="horizontal"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={maxPanelWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          onKeyDown={resizeKeyDown}
          className="group absolute inset-y-0 -left-2 z-10 hidden w-4 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 lg:block"
        >
          <div
            className={
              "absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-all " +
              (isResizing
                ? collapseArmed
                  ? "w-1 bg-violet-600"
                  : "w-0.5 bg-violet-400"
                : "w-0.5 bg-gray-200 group-hover:bg-violet-300 group-focus-visible:bg-violet-400")
            }
          />
          {collapseArmed && (
            /* Release and the panel parks into the slim rail */
            <span
              role="status"
              className="absolute -left-14 top-1/2 -translate-y-1/2 rounded-full bg-violet-600 px-2 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-md [writing-mode:vertical-rl]"
            >
              Release to park
            </span>
          )}
        </div>

        {collapsed ? (
          /* Parked rail: click the rail, pull the edge, or double-click it to
             restore. The form's state is kept, so the draft survives. */
          /* Keyboard restore lives on the adjacent slider handle (arrow keys). */
          /* biome-ignore lint/a11y/useKeyWithClickEvents: restore is reachable on the focusable resize handle next to this rail */
          <div className="flex min-h-0 flex-1 cursor-pointer flex-col items-center gap-4 py-3" onClick={expand}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
            <span className="text-sm font-medium text-gray-500 [writing-mode:vertical-rl]">Send email</span>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Send email</h3>
                {contextLabel && <p className="text-sm text-gray-500">{contextLabel}</p>}
              </div>
              <div className="flex items-center">
                {/* Park — a desktop concept, so hidden where the drawer is a sheet */}
                <button
                  type="button"
                  onClick={park}
                  aria-label="Park panel"
                  title="Park panel — drag its edge back, double-click it, or press an arrow key to restore"
                  className="hidden rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:inline-flex"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M2.5 7h9" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            {context != null && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{context}</div>
            )}

            <form onSubmit={handleSubmit} className={twoCol ? "grid grid-cols-2 gap-6" : "grid grid-cols-1 gap-6"}>
              <div className="flex flex-col gap-3">
                {hasOptions ? (
                  <>
                    <FormField
                      label="Recipient"
                      as="select"
                      fieldProps={{
                        value: recipientChoice,
                        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setRecipientChoice(e.target.value),
                        autoComplete: "off",
                      }}
                    >
                      {options.map((o) => (
                        <option key={o.email} value={o.email}>
                          {o.label} — {o.email}
                        </option>
                      ))}
                      <option value={OTHER}>Other…</option>
                    </FormField>
                    {isOther && (
                      <FormField
                        label="Recipient email"
                        type="email"
                        fieldProps={{
                          value: otherRecipient,
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOtherRecipient(e.target.value),
                          required: true,
                          placeholder: "recipient@example.com",
                          autoComplete: "email",
                        }}
                      />
                    )}
                  </>
                ) : (
                  <FormField
                    label="Recipient"
                    type="email"
                    fieldProps={{
                      value: recipient,
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOtherRecipient(e.target.value),
                      required: true,
                      placeholder: "recipient@example.com",
                      autoComplete: "email",
                    }}
                  />
                )}
                <FormField
                  label="Subject (optional)"
                  fieldProps={{
                    value: subject,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value),
                    placeholder: DEFAULT_SUBJECT,
                    autoComplete: "off",
                    // Keep in sync with subject max_length on AdminSendEmailRequest (backend/app/schemas.py)
                    maxLength: 200,
                  }}
                />
                <FormField
                  label="Message"
                  as="textarea"
                  fieldProps={{
                    value: message,
                    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value),
                    required: true,
                    placeholder: "Write your message (plain text)…",
                    autoComplete: "off",
                    rows: 8,
                    // Keep in sync with message max_length on AdminSendEmailRequest (backend/app/schemas.py)
                    maxLength: 5000,
                  }}
                />
                <p className="text-right text-xs text-gray-400">{message.length}/5000</p>
                <div className="mt-1 flex justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={sendMut.isPending} disabled={!canSend}>
                    {sendMut.isPending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>

              {/* Live preview — same line-break rule as the server's rendering */}
              <EmailPreviewFrame to={trimmedRecipient || null} subject={subject.trim() || DEFAULT_SUBJECT}>
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
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
