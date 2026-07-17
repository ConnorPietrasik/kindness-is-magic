/**
 * NULLABLE_STRING_FIELDS — fields that the backend stores as `NULL` when empty.
 * Used by `normalizePayload` (create operations) to convert `""` → `null`.
 */
const NULLABLE_STRING_FIELDS = new Set(["bio", "address", "phone_number", "title", "note"]);

/**
 * normalizePayload — convert empty strings to `null` on known nullable fields.
 *
 * Used for **create** operations where there is no original record to compare
 * against. Keeps DB values semantically clean (`null` = no value) and matches
 * the TypeScript `string | null` types on the payload interfaces.
 */
export function normalizePayload<T>(data: T): T {
  const copy = { ...(data as Record<string, unknown>) } as Record<string, unknown>;
  for (const key of NULLABLE_STRING_FIELDS) {
    if (key in copy && copy[key] === "") {
      copy[key] = null;
    }
  }
  return copy as T;
}

/**
 * normalizeUpdatePayload — build a patch payload from form data compared to
 * the original record.
 *
 * - Cleared field (original had data, form is `""`)  → send `""` (backend clears to NULL)
 * - Unchanged field                                  → omit from payload (backend skips)
 * - Changed field                                    → send new value
 *
 * Treats `null` and `""` as equivalent for comparison since forms always
 * render nullable fields as controlled inputs with `""` defaults.
 */
export function normalizeUpdatePayload<T>(formData: T, original: T): Partial<T> {
  const result: Record<string, unknown> = {};
  const formRecord = formData as Record<string, unknown>;
  const origRecord = original as Record<string, unknown>;
  for (const key of Object.keys(formRecord)) {
    const formValue = formRecord[key];
    const originalValue = origRecord[key];
    // Treat null ≡ "" for comparison (forms render null as "")
    const originalStr = originalValue ?? "";
    if (originalStr === formValue) {
      continue; // unchanged — omit
    }
    result[key] = formValue;
  }
  return result as Partial<T>;
}

/**
 * humanize — capitalise first letter of a string.
 */
export function humanize(str: string | null | undefined): string {
  if (!str) return "";
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
export function formatApiError(error: unknown, fallback = "An error occurred"): string {
  if (!error) return fallback;

  const obj = error as Record<string, unknown>;
  const response = obj.response as { data?: Record<string, unknown> } | undefined;
  const data = response?.data;
  if (data) {
    if (typeof data.detail === "string") return data.detail;
    if (typeof data.msg === "string") return data.msg;
    try {
      return JSON.stringify(data);
    } catch {
      // ignore
    }
  }

  if (typeof obj.message === "string") return obj.message;
  return fallback;
}
