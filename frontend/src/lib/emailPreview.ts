/**
 * Shared line-break rule for email previews.
 *
 * Mirrors app/mail.py::render_custom_message_html (which renders the
 * plain-text message to escaped HTML for the actual send): normalize
 * \r\n to \n, blank lines split paragraphs, single newlines within a
 * paragraph stay as line breaks.
 *
 * Used by both the AdminEmailComposer preview and InviteEmailPreview so
 * neither can drift from the server's rendering.
 */
export function splitMessageParagraphs(message: string): string[][] {
  return message
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => p.split("\n"));
}
