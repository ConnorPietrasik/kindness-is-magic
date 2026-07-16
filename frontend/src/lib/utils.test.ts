import { describe, expect, it } from "vitest";
import { formatApiError, humanize } from "./utils";

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
