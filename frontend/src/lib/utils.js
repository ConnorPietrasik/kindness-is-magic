/**
 * esc — XSS-safe string rendering.
 *
 * Converts a value to a plain-text React node that cannot execute scripts.
 * Pass through already-safe React elements unchanged.
 */
export function esc(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value; // let React handle elements, arrays, etc.
}

/**
 * humanize — capitalise first letter of a string.
 */
export function humanize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
