/**
 * Shared parts for the admin email previews.
 *
 * Used by the AdminEmailComposer and AdminCampaignDialog previews and
 * InviteEmailPreview so none can drift from the server's rendering.
 */

/**
 * COUPLING: mirrors CUSTOM_EMAIL_DEFAULT_SUBJECT in backend/app/mail.py —
 * the subject the server applies when the admin leaves it blank. Shared by
 * the compose drawer and the campaign dialog so both placeholders (and
 * previews) show the same default.
 */
export const CUSTOM_EMAIL_DEFAULT_SUBJECT = "A message from Kindness Is Magic ✨";

/**
 * Line-break rule for email previews.
 *
 * Mirrors app/mail.py::render_custom_message_html (which renders the
 * plain-text message to escaped HTML for the actual send): normalize
 * \r\n to \n, blank lines split paragraphs, single newlines within a
 * paragraph stay as line breaks.
 */
export function splitMessageParagraphs(message: string): string[][] {
  return message
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => p.split("\n"));
}
