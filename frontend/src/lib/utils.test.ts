import { describe, expect, it } from "vitest";
import { formatApiError, humanize, normalizePayload } from "./utils";

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
    const input = { family_name: "Smith", bio: "", address: "", phone_number: "" };
    const result = normalizePayload(input);
    expect(result.bio).toBeNull();
    expect(result.address).toBeNull();
    expect(result.phone_number).toBeNull();
    expect(result.family_name).toBe("Smith");
  });

  it("leaves non-empty strings untouched", () => {
    const input = { bio: "Hello", address: "123 Main", title: "Dr" };
    const result = normalizePayload(input);
    expect(result.bio).toBe("Hello");
    expect(result.address).toBe("123 Main");
    expect(result.title).toBe("Dr");
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
});
