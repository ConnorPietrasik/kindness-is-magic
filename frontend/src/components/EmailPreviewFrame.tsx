import type { ReactNode } from "react";

export interface EmailPreviewFrameProps {
  /**
   * Recipient for the optional meta line. The line is rendered only when `to`
   * is provided — never keyed on the subject alone (InviteEmailPreview always
   * has a subject but must render unchanged when its email is null).
   */
  to?: string | null;
  /** Subject shown next to the recipient in the meta line (ignored without `to`). */
  subject?: string | null;
  /** Email body content (between the branded header and the unsubscribe footer). */
  children: ReactNode;
}

/**
 * EmailPreviewFrame — branded header + white content + gray unsubscribe
 * footer, mirroring app/mail.py::_wrap_email.
 *
 * Shared by InviteEmailPreview and AdminEmailComposer so both previews show
 * the same chrome as the actual emails.
 */
export function EmailPreviewFrame({ to, subject, children }: EmailPreviewFrameProps) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
      {/* Branded header (mirrors _wrap_email in app/mail.py) */}
      <div className="bg-brand-dark px-6 py-4 text-center">
        <h4 className="text-xl font-bold text-white">Kindness Is Magic</h4>
      </div>

      {/* Email body */}
      <div className="bg-white px-6 py-6 text-sm text-gray-800">
        {/* Rendered as a single text node (no nested element containing the bare
            address) — the InviteEmailPreview test asserts an exact-text match on
            the locked email, and a second node holding just the address would
            make it a strict-mode violation. */}
        {to && <p className="mb-3 text-xs text-gray-500">{`To: ${to}${subject ? ` — Subject: ${subject}` : ""}`}</p>}
        {children}
      </div>

      {/* Gray unsubscribe footer (mirrors _wrap_email in app/mail.py) */}
      <div className="border-t border-gray-100 px-6 py-4 text-center text-xs text-gray-400">
        If you no longer wish to receive these emails, click here to unsubscribe.
      </div>
    </div>
  );
}
