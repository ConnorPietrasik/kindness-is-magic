import { Fragment } from "react";
import { splitMessageParagraphs } from "../lib/emailPreview";
import { EmailPreviewFrame } from "./EmailPreviewFrame";

export interface InviteEmailPreviewProps {
  /** Custom message from the form (blank → the default prose is shown). */
  message: string;
  /** Parsed family limit; null when the limit field is empty/invalid. */
  familyLimit: number | null;
  /** Locked-to email from the form (blank → the invite is not locked). */
  email: string | null;
  /** The current admin's display name for the greeting (null → generic variant). */
  inviterName: string | null;
}

// COUPLING: mirrors the referrer-invite subject hardcoded in
// backend/app/auth_routes.py and backend/app/referrer_routes.py. It is a fixed
// string — if it ever changes server-side, this preview line is stale.
const INVITE_EMAIL_SUBJECT = "You're invited to join Kindness Is Magic";

/**
 * InviteEmailPreview — live preview of the referrer invite email.
 *
 * Mirrors the structure of app/mail.py::build_invite_email (personal prose +
 * functional block) inside the branded header/footer of app/mail.py::_wrap_email
 * (shared via EmailPreviewFrame).
 * Server-generated parts are shown as representative placeholders (code as
 * KRI-XXXXXX, expiry as "7 days from now"); the message, family limit, and
 * locked email come from the form, and the greeting from the session user.
 */
export function InviteEmailPreview({ message, familyLimit, email, inviterName }: InviteEmailPreviewProps) {
  // Same line-break rule as app/mail.py::render_custom_message_html (shared
  // with the admin custom-email composer preview).
  const messageParagraphs = splitMessageParagraphs(message);
  const hasCustomMessage = messageParagraphs.length > 0;
  const familyWord = familyLimit === 1 ? "family" : "families";

  const body = (
    <>
      {hasCustomMessage ? (
        messageParagraphs.map((lines, i) => (
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
        /* Default prose — verbatim from app/mail.py::build_invite_email; keep in
           sync if the default email text ever changes. */
        <>
          <p className="mb-3">
            {inviterName ? (
              <>
                You've been invited by <strong>{inviterName}</strong> to help make a difference with <strong>Kindness Is Magic</strong> ✨
              </>
            ) : (
              <>
                You're invited to help make a difference with <strong>Kindness Is Magic</strong> ✨
              </>
            )}
          </p>
          <p className="mb-3">
            We'd love your help connecting {familyWord} in need with the support and joy they deserve. Here's your unique invite code to get
            started:
          </p>
        </>
      )}

      {/* Functional block — always rendered in both modes */}
      <div className="my-3 border border-dashed border-brand-dark bg-[#f0f4f0] px-4 py-4 text-center text-2xl font-bold tracking-widest text-gray-900">
        KRI-XXXXXX
      </div>
      {email && (
        <p className="mb-3 text-xs text-gray-600">
          This invite is locked to <strong>{email}</strong>. You'll register using this email address.
        </p>
      )}
      {!hasCustomMessage && familyLimit !== null && (
        <p className="mb-3">
          As a referrer, you'll be able to connect up to <strong>{familyLimit}</strong> {familyWord}. They deserve the kindness they need
          most.
        </p>
      )}
      <p className="mb-3">
        {/* COUPLING: "7 days" mirrors INVITE_EXPIRY_HOURS (default 168h) in backend/app/auth.py.
            It is env-overridable (see .env) — if the stack runs with a different value,
            this preview line is stale. */}
        This invite expires on <strong>7 days from now</strong>.
      </p>
      <div className="mb-3 text-center">
        {/* Non-interactive CTA styled like the email's "Get Started" button */}
        <span className="inline-block rounded bg-brand-dark px-6 py-3 font-bold text-white">Get Started</span>
      </div>
      {!hasCustomMessage && (
        <p className="mt-4">Thank you for being part of something wonderful. Together, we can make kindness magical.</p>
      )}
    </>
  );

  return (
    <EmailPreviewFrame to={email} subject={INVITE_EMAIL_SUBJECT}>
      {body}
    </EmailPreviewFrame>
  );
}
