import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingClaimFamilyId,
  formatApiError,
  formatDateTime,
  formatEmailStatus,
  fromDatetimeLocalValue,
  getLockLevelRowClass,
  getPendingClaimFamilyId,
  humanize,
  isFamilyLocked,
  normalizePayload,
  normalizeUpdatePayload,
  setPendingClaimFamilyId,
  toDatetimeLocalValue,
} from "./utils";

describe("formatDateTime", () => {
  it("formats a valid ISO datetime string", () => {
    const result = formatDateTime("2025-02-15T14:30:00Z");
    expect(result).not.toBe("—");
    expect(result).toContain("2025");
  });

  it("returns em-dash for null input", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("returns em-dash for undefined input", () => {
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("returns em-dash for empty string", () => {
    expect(formatDateTime("")).toBe("—");
  });
});

describe("formatEmailStatus", () => {
  it("returns Sent for sent status", () => {
    expect(formatEmailStatus("sent", null)).toBe("Sent");
  });

  it("returns Failed with the reason for failed status", () => {
    expect(formatEmailStatus("failed", "SMTP error: connection refused")).toBe("Failed — SMTP error: connection refused");
  });

  it("returns Failed without a reason when none is available", () => {
    expect(formatEmailStatus("failed", null)).toBe("Failed");
    expect(formatEmailStatus("failed", undefined)).toBe("Failed");
  });

  it("returns Reset (not counted) for reset status", () => {
    expect(formatEmailStatus("reset", null)).toBe("Reset (not counted)");
  });
});

describe("humanize", () => {
  it("capitalises first letter of a string", () => {
    expect(humanize("first_name")).toBe("First_name");
  });

  it("handles already capitalised strings", () => {
    expect(humanize("Hello")).toBe("Hello");
  });

  it("returns empty string for falsy input", () => {
    expect(humanize("")).toBe("");
    expect(humanize(null)).toBe("");
    expect(humanize(undefined)).toBe("");
  });
});

describe("normalizePayload", () => {
  it("converts empty strings to null on nullable fields", () => {
    const input = { family_name: "Smith", bio: "", address: "", note: "" };
    const result = normalizePayload(input);
    expect(result.bio).toBeNull();
    expect(result.note).toBeNull();
    expect(result.family_name).toBe("Smith");
    // address is required (never nullable) — empty string stays as-is
    expect(result.address).toBe("");
  });

  it("leaves non-empty strings untouched", () => {
    const input = { bio: "Hello", address: "123 Main", note: "Dr" };
    const result = normalizePayload(input);
    expect(result.bio).toBe("Hello");
    expect(result.address).toBe("123 Main");
    expect(result.note).toBe("Dr");
  });

  it("leaves null values as-is", () => {
    const input = { bio: null, note: null };
    const result = normalizePayload(input);
    expect(result.bio).toBeNull();
    expect(result.note).toBeNull();
  });

  it("ignores non-nullable fields with empty strings", () => {
    const input = { family_name: "", given_name: "", name: "" };
    const result = normalizePayload(input);
    expect(result.family_name).toBe("");
    expect(result.given_name).toBe("");
    expect(result.name).toBe("");
  });

  it("returns a new object (does not mutate input)", () => {
    const input = { bio: "", note: "" };
    normalizePayload(input);
    expect(input.bio).toBe("");
    expect(input.note).toBe("");
  });

  it("handles objects without any nullable fields", () => {
    const input = { name: "Test", family_limit: 5 };
    const result = normalizePayload(input);
    expect(result).toEqual({ name: "Test", family_limit: 5 });
  });
});

describe("normalizeUpdatePayload", () => {
  it("sends empty string for a cleared nullable field", () => {
    const original = { family_name: "Smith", bio: "Hello world", address: "123 Main" };
    const form = { family_name: "Smith", bio: "", address: "" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.bio).toBe("");
    expect(result.address).toBe("");
    expect(result.family_name).toBeUndefined(); // unchanged
  });

  it("omits unchanged nullable fields that were originally null", () => {
    const original = { family_name: "Smith", bio: null as string | null, address: null as string | null };
    const form = { family_name: "Smith", bio: "", address: "" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.bio).toBeUndefined();
    expect(result.address).toBeUndefined();
    expect(result.family_name).toBeUndefined();
  });

  it("omits unchanged nullable fields when the form state retains null", () => {
    const original = { family_name: "Smith", bio: null as string | null, address: null as string | null };
    const form = { family_name: "Smith Updated", bio: null as string | null, address: null as string | null };
    const result = normalizeUpdatePayload(form, original);
    expect(result.bio).toBeUndefined();
    expect(result.address).toBeUndefined();
    expect(result.family_name).toBe("Smith Updated");
  });

  it("includes changed non-nullable fields", () => {
    const original = { family_name: "Smith", contact_name: "John" };
    const form = { family_name: "Jones", contact_name: "John" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.family_name).toBe("Jones");
    expect(result.contact_name).toBeUndefined();
  });

  it("handles mixed scenarios", () => {
    const original = { family_name: "Smith", bio: "Old bio", address: null as string | null, phone_number: "555" };
    const form = { family_name: "Smith", bio: "", address: "", phone_number: "555-1234" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.family_name).toBeUndefined(); // unchanged
    expect(result.bio).toBe(""); // cleared
    expect(result.address).toBeUndefined(); // was null, still empty
    expect(result.phone_number).toBe("555-1234"); // changed (no longer nullable, still diff-tracked)
  });

  it("returns empty object when nothing changed", () => {
    const original = { name: "Test", bio: "Hello" };
    const form = { name: "Test", bio: "Hello" };
    const result = normalizeUpdatePayload(form, original);
    expect(result).toEqual({});
  });

  it("handles numeric fields", () => {
    const original = { age: 10, family_limit: 5 };
    const form = { age: 12, family_limit: 5 };
    const result = normalizeUpdatePayload(form, original);
    expect(result.age).toBe(12);
    expect(result.family_limit).toBeUndefined();
  });

  it("omits fields not present in formData", () => {
    const original = { name: "Test", bio: "Hello" };
    const form = { name: "Test", bio: "" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.name).toBeUndefined();
    expect(result.bio).toBe("");
  });

  it("treats same-instant datetimes as unchanged despite format differences", () => {
    const original = { family_name: "Smith", pickup_window: "2025-02-15T14:30:00+00:00" };
    const form = { family_name: "Smith", pickup_window: "2025-02-15T14:30:00Z" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.pickup_window).toBeUndefined(); // same instant, different format
    expect(result.family_name).toBeUndefined();
  });

  it("includes changed datetime fields", () => {
    const original = { pickup_window: "2025-02-15T14:30:00Z" };
    const form = { pickup_window: "2025-03-20T10:00:00Z" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.pickup_window).toBe("2025-03-20T10:00:00Z");
  });

  it("treats null → empty string datetime as unchanged", () => {
    const original = { pickup_window: null };
    const form = { pickup_window: "" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.pickup_window).toBeUndefined();
  });

  it("includes cleared datetime (value → empty string)", () => {
    const original = { pickup_window: "2025-02-15T14:30:00Z" };
    const form = { pickup_window: "" };
    const result = normalizeUpdatePayload(form, original);
    expect(result.pickup_window).toBe("");
  });
});

describe("toDatetimeLocalValue / fromDatetimeLocalValue", () => {
  it("round-trips an ISO datetime through datetime-local format", () => {
    const iso = "2025-02-15T14:30:00Z";
    const local = toDatetimeLocalValue(iso);
    const back = fromDatetimeLocalValue(local);
    // Both represent the same instant
    expect(new Date(iso).getTime()).toBe(new Date(back).getTime());
  });

  it("round-trips an ISO datetime with timezone offset", () => {
    const iso = "2025-02-15T14:30:00+05:00";
    const local = toDatetimeLocalValue(iso);
    const back = fromDatetimeLocalValue(local);
    expect(new Date(iso).getTime()).toBe(new Date(back).getTime());
  });

  it("returns empty string for null/undefined input", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(undefined)).toBe("");
    expect(fromDatetimeLocalValue("")).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
    expect(fromDatetimeLocalValue("not-a-date")).toBe("");
  });

  it("fromDatetimeLocalValue produces no-milliseconds output", () => {
    const result = fromDatetimeLocalValue("2025-03-20T10:00");
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(result).not.toContain(".");
  });
});

describe("formatApiError", () => {
  it("returns detail string from response.data.detail", () => {
    const error = { response: { data: { detail: "Validation failed" } } };
    expect(formatApiError(error)).toBe("Validation failed");
  });

  it("returns msg string from response.data.msg", () => {
    const error = { response: { data: { msg: "Something went wrong" } } };
    expect(formatApiError(error)).toBe("Something went wrong");
  });

  it("prefers detail over msg when both present", () => {
    const error = { response: { data: { detail: "Detail msg", msg: "Msg msg" } } };
    expect(formatApiError(error)).toBe("Detail msg");
  });

  it("joins detail array with semicolons", () => {
    const error = { response: { data: { detail: ["Admin users must not have referrer_id", "Admin users must not have family_id"] } } };
    expect(formatApiError(error)).toBe("Admin users must not have referrer_id; Admin users must not have family_id");
  });

  it("handles single-element detail array", () => {
    const error = { response: { data: { detail: ["Referrer not found"] } } };
    expect(formatApiError(error)).toBe("Referrer not found");
  });

  it("returns JSON.stringify fallback when data is an object without detail/msg", () => {
    const error = { response: { data: { code: 500, info: "internal" } } };
    expect(formatApiError(error)).toBe('{"code":500,"info":"internal"}');
  });

  it("returns error.message for non-axios errors", () => {
    const error = new Error("Network failure");
    expect(formatApiError(error)).toBe("Network failure");
  });

  it("returns fallback for null error", () => {
    expect(formatApiError(null)).toBe("An error occurred");
  });

  it("returns custom fallback for null error", () => {
    expect(formatApiError(null, "Custom fallback")).toBe("Custom fallback");
  });

  it("returns fallback for error with no response and no message", () => {
    const error = {};
    expect(formatApiError(error)).toBe("An error occurred");
  });

  it("extracts msg from Pydantic validation error objects in detail array", () => {
    const error = {
      response: {
        data: {
          detail: [{ loc: ["body", "phone_number"], msg: "phone_number must contain 10 digits", type: "value_error" }],
        },
      },
    };
    expect(formatApiError(error)).toBe("phone_number must contain 10 digits");
  });

  it("extracts msg from multiple Pydantic validation error objects", () => {
    const error = {
      response: {
        data: {
          detail: [
            { loc: ["body", "name"], msg: "HTML tags are not allowed", type: "value_error" },
            { loc: ["body", "email"], msg: "Invalid email address: bad", type: "value_error" },
          ],
        },
      },
    };
    expect(formatApiError(error)).toBe("HTML tags are not allowed; Invalid email address: bad");
  });

  it("handles mixed string and object entries in detail array", () => {
    const error = {
      response: {
        data: {
          detail: ["Plain error string", { loc: ["body", "field"], msg: "Object error", type: "value_error" }],
        },
      },
    };
    expect(formatApiError(error)).toBe("Plain error string; Object error");
  });
});

describe("pending claim family id", () => {
  const HOUR_MS = 60 * 60 * 1000;

  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a family id", () => {
    setPendingClaimFamilyId(42);
    expect(getPendingClaimFamilyId()).toBe(42);
  });

  it("returns null when nothing is stored", () => {
    expect(getPendingClaimFamilyId()).toBeNull();
  });

  it("accepts entries set within the TTL", () => {
    localStorage.setItem("kim:pending-claim-family-id", JSON.stringify({ id: 9, setAt: Date.now() - HOUR_MS }));
    expect(getPendingClaimFamilyId()).toBe(9);
  });

  it("returns null for entries older than the TTL and clears them", () => {
    localStorage.setItem("kim:pending-claim-family-id", JSON.stringify({ id: 9, setAt: Date.now() - 3 * HOUR_MS }));
    expect(getPendingClaimFamilyId()).toBeNull();
    expect(localStorage.getItem("kim:pending-claim-family-id")).toBeNull();
  });

  it("returns null for malformed values and clears them", () => {
    for (const bad of ["abc", "0", "-3", "1.5", ""] as const) {
      localStorage.setItem("kim:pending-claim-family-id", bad);
      expect(getPendingClaimFamilyId()).toBeNull();
      expect(localStorage.getItem("kim:pending-claim-family-id")).toBeNull();
    }
  });

  it("clear removes the stored id", () => {
    setPendingClaimFamilyId(7);
    clearPendingClaimFamilyId();
    expect(getPendingClaimFamilyId()).toBeNull();
  });
});

describe("getLockLevelRowClass", () => {
  it("returns the green tint for admin-locked families", () => {
    expect(getLockLevelRowClass({ deleted_at: null, wish_lock_level: "admin" })).toBe("bg-emerald-50");
  });

  it("returns the amber tint for referrer-locked families", () => {
    expect(getLockLevelRowClass({ deleted_at: null, wish_lock_level: "referrer" })).toBe("bg-amber-50");
  });

  it("returns no class for family-level locks", () => {
    expect(getLockLevelRowClass({ deleted_at: null, wish_lock_level: "family" })).toBe("");
  });

  it("returns no class for soft-deleted families regardless of lock level", () => {
    expect(getLockLevelRowClass({ deleted_at: "2025-02-02T00:00:00Z", wish_lock_level: "admin" })).toBe("");
    expect(getLockLevelRowClass({ deleted_at: "2025-02-02T00:00:00Z", wish_lock_level: "referrer" })).toBe("");
  });
});

describe("isFamilyLocked", () => {
  it("returns false for null/undefined input", () => {
    expect(isFamilyLocked(null)).toBe(false);
    expect(isFamilyLocked(undefined)).toBe(false);
  });

  it("returns false when lock level is family and no review requested", () => {
    expect(isFamilyLocked({ wish_lock_level: "family", wish_review_requested_at: null })).toBe(false);
  });

  it("returns true when lock level is referrer", () => {
    expect(isFamilyLocked({ wish_lock_level: "referrer", wish_review_requested_at: null })).toBe(true);
  });

  it("returns true when lock level is admin", () => {
    expect(isFamilyLocked({ wish_lock_level: "admin", wish_review_requested_at: null })).toBe(true);
  });

  it("returns true when review is requested even if lock level is family", () => {
    expect(isFamilyLocked({ wish_lock_level: "family", wish_review_requested_at: "2025-01-01T00:00:00Z" })).toBe(true);
  });

  it("returns true when both locked and review requested", () => {
    expect(isFamilyLocked({ wish_lock_level: "admin", wish_review_requested_at: "2025-01-01T00:00:00Z" })).toBe(true);
  });
});
