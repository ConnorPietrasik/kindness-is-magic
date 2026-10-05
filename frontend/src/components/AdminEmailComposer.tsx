/**
 * AdminEmailComposer — dialog for sending a freeform ("custom") email to any
 * recipient, with a live preview in the branded email style.
 *
 * The recipient is prefilled by the entry point (family contact email or
 * referrer email) but stays editable. Sends via POST /api/admin/emails/send,
 * which reuses the shared send path: the unsubscribe gate applies
 * (unsubscribed recipients are blocked and reported), and one SentEmail row
 * (kind custom_message) is recorded per attempt — so the sent-email log is
 * invalidated on every completed attempt.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { useToast } from "../context/ToastContext";
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

export interface AdminEmailComposerProps {
  open: boolean;
  /** Context line under the title, e.g. "Family 2-1 — The Johnsons". Omit for a generic compose. */
  contextLabel?: string | null;
  /** Recipient prefilled into the (editable) Recipient field. */
  prefilledRecipient?: string | null;
  onClose: () => void;
}

export function AdminEmailComposer({ open, contextLabel = null, prefilledRecipient = null, onClose }: AdminEmailComposerProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Reset the form whenever the dialog opens (the prefill differs per entry point/row)
  useEffect(() => {
    if (open) {
      setRecipient(prefilledRecipient ?? "");
      setSubject("");
      setMessage("");
    }
  }, [open, prefilledRecipient]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMut.mutate({
      recipient_email: trimmedRecipient,
      subject, // blank → null in the api function (server applies the default)
      message,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="presentation">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">Send email</h3>
          {contextLabel && <p className="text-sm text-gray-500">{contextLabel}</p>}
        </div>

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <FormField
              label="Recipient"
              type="email"
              fieldProps={{
                value: recipient,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value),
                required: true,
                placeholder: "recipient@example.com",
                autoComplete: "email",
              }}
            />
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
    </div>
  );
}
