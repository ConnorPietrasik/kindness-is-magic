/**
 * humanize — capitalise first letter of a string.
 */
export function humanize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * formatApiError — extract a user-facing error string from an axios error.
 *
 * Tries these sources in order:
 *  1. error.response.data.detail  (string)
 *  2. error.response.data.msg     (string)
 *  3. JSON.stringify of the full response data
 *  4. error.message               (network / transport errors)
 *  5. fallback message
 */
export function formatApiError(error, fallback = 'An error occurred') {
  if (!error) return fallback;

  const data = error.response?.data;
  if (data) {
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.msg === 'string') return data.msg;
    try {
      return JSON.stringify(data);
    } catch {
      // ignore
    }
  }

  if (typeof error.message === 'string') return error.message;
  return fallback;
}
