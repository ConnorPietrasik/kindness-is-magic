import { describe, expect, it } from "vitest";
import { validatePhoneNumber } from "./validators";

describe("validatePhoneNumber", () => {
  it("returns error for empty string", () => {
    expect(validatePhoneNumber("")).toBe("Phone number is required");
  });

  it("returns error for fewer than 10 digits", () => {
    expect(validatePhoneNumber("555123456")).toBe("Phone number must contain 10 digits");
  });

  it("returns null for exactly 10 digits", () => {
    expect(validatePhoneNumber("5551234567")).toBeNull();
  });

  it("returns null for more than 10 digits (e.g. with country code)", () => {
    expect(validatePhoneNumber("15551234567")).toBeNull();
  });
});
