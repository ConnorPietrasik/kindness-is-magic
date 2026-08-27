import type { EmailStatus } from "../types";

/**
 * NULLABLE_FIELDS — fields that the backend stores as `NULL` when empty.
 * Used by `normalizePayload` (create operations) to convert `""` → `null`.
 */
const NULLABLE_FIELDS = new Set(["bio", "address", "title", "note", "pickup_window", "referrer_notes"]);

/** Datetime fields that need canonical comparison in `normalizeUpdatePayload`. */
const DATETIME_FIELDS = new Set(["pickup_window"]);

/**
 * normalizePayload — convert empty strings to `null` on known nullable fields.
 *
 * Used for **create** operations where there is no original record to compare
 * against. Keeps DB values semantically clean (`null` = no value) and matches
 * the TypeScript `string | null` types on the payload interfaces.
 */
export function normalizePayload<T>(data: T): T {
  const copy = { ...(data as Record<string, unknown>) } as Record<string, unknown>;
  for (const key of NULLABLE_FIELDS) {
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
 *
 * The `original` parameter accepts a separate type parameter so it works when
 * the response shape differs from the request shape (e.g. WishSummary[] vs
 * WishCreate[] on the `wishes` field).
 */
export function normalizeUpdatePayload<T, O>(formData: T, original: O | null): Partial<T> {
  const result: Record<string, unknown> = {};
  const formRecord = formData as Record<string, unknown>;
  const origRecord = (original ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(formRecord)) {
    const formValue = formRecord[key];
    const originalValue = origRecord[key];

    // Datetime fields: normalize to UTC for comparison so that
    // "2025-02-15T14:30:00+00:00" ≡ "2025-02-15T14:30:00Z" (same instant).
    if (DATETIME_FIELDS.has(key)) {
      const formDt = typeof formValue === "string" && formValue ? new Date(formValue).toISOString() : "";
      const origDt = typeof originalValue === "string" && originalValue ? new Date(originalValue).toISOString() : "";
      if (formDt === origDt) {
        continue; // unchanged — omit
      }
      result[key] = formValue;
      continue;
    }

    // Treat null ≡ "" for comparison (forms render null as "" and retain
    // null for untouched nullable fields initialized from the detail record)
    const originalStr = originalValue ?? "";
    if (originalStr === (formValue ?? "")) {
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
 * formatDateTime — format an ISO datetime string for display.
 *
 * Used in list/detail views to show timestamps in a readable format.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * formatEmailStatus — format an email send status for display.
 *
 * Failed sends show the backend failure reason when available; reset rows
 * are the ones an admin cleared via reset-sent-emails (no longer counted
 * toward rate limits).
 */
export function formatEmailStatus(status: EmailStatus, failureReason: string | null | undefined): string {
  if (status === "failed") {
    return failureReason ? `Failed — ${failureReason}` : "Failed";
  }
  if (status === "reset") return "Reset (not counted)";
  return "Sent";
}

/**
 * toDatetimeLocalValue — convert an ISO datetime string to the format
 * expected by `<input type="datetime-local">` (YYYY-MM-DDTHH:MM).
 *
 * Converts to the browser's local timezone so the picker shows the correct
 * time for the user. Use `fromDatetimeLocalValue` to convert back to ISO
 * and preserve the original instant.
 *
 * Returns empty string if input is null/undefined.
 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * fromDatetimeLocalValue — convert a `datetime-local` input value back to
 * an ISO 8601 UTC string.
 *
 * The input value represents local time. `new Date()` interprets it as local,
 * and `.toISOString()` converts back to UTC — preserving the original instant
 * that the backend sent.
 *
 * Milliseconds are truncated (`.slice(0, -4)`) so the output matches the
 * backend's `YYYY-MM-DDTHH:MM:SSZ` shape. This prevents `normalizeUpdatePayload`
 * from treating an untouched field as "changed" (no milliseconds → `.000Z` →
 * false diff).
 *
 * Returns empty string if input is empty.
 */
export function fromDatetimeLocalValue(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // toISOString() returns "2025-01-15T14:30:00.000Z" — strip ".000Z" → "2025-01-15T14:30:00Z"
  return `${date.toISOString().slice(0, -5)}Z`;
}

/**
 * isFamilyLocked — determine whether a family's wishes are locked for editing.
 *
 * A family is locked when:
 * - wish_lock_level is not "family" (referrer or admin has taken control), or
 * - a review request is pending (wish_review_requested_at is set).
 */
export interface FamilyLockFields {
  wish_lock_level: string;
  wish_review_requested_at: string | null;
}

export function isFamilyLocked(family: FamilyLockFields | null | undefined): boolean {
  if (family == null) return false;
  return family.wish_lock_level !== "family" || family.wish_review_requested_at != null;
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
    if (Array.isArray(data.detail)) {
      // Pydantic validation errors are arrays of objects with a `msg` field
      return data.detail.map((item) => (typeof item === "string" ? item : (item.msg ?? String(item)))).join("; ");
    }
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
