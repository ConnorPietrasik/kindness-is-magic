import { describe, expect, it } from "vitest";
import { COLUMNS, normalizeColumnOrder } from "./columns";

describe("normalizeColumnOrder", () => {
  const defs = COLUMNS.adminReferrers!;

  it("returns registry order for empty or non-array input", () => {
    expect(normalizeColumnOrder([], defs)).toEqual(defs.map((d) => d.key));
    expect(normalizeColumnOrder(undefined, defs)).toEqual(defs.map((d) => d.key));
    expect(normalizeColumnOrder("garbage", defs)).toEqual(defs.map((d) => d.key));
    expect(normalizeColumnOrder(42, defs)).toEqual(defs.map((d) => d.key));
  });

  it("keeps stored order for valid keys", () => {
    expect(normalizeColumnOrder(["created_at", "name", "family_limit"], defs)).toEqual([
      "created_at",
      "name",
      "family_limit",
      "phone_number",
      "family_invite_code",
      "approval_status",
      "approved_by_admin_name",
      "approved_at",
    ]);
  });

  it("drops unknown keys and duplicates", () => {
    expect(normalizeColumnOrder(["name", "nonexistent_field", "name", 7, null, "family_limit"], defs)).toEqual([
      "name",
      "family_limit",
      "phone_number",
      "family_invite_code",
      "approval_status",
      "approved_by_admin_name",
      "approved_at",
      "created_at",
    ]);
  });

  it("appends missing keys at the end in registry order", () => {
    expect(normalizeColumnOrder(["family_limit"], defs)).toEqual([
      "family_limit",
      "name",
      "phone_number",
      "family_invite_code",
      "approval_status",
      "approved_by_admin_name",
      "approved_at",
      "created_at",
    ]);
  });

  it("returns an empty order for an unknown resource", () => {
    expect(normalizeColumnOrder(["anything"], [])).toEqual([]);
  });

  it("registers the donor table resources", () => {
    expect(COLUMNS.donorClaims!.map((d) => d.key)).toEqual(["family", "status", "commitment", "created"]);
    expect(COLUMNS.donorClaimWishes!.map((d) => d.key)).toEqual(["name", "age", "practical_wish", "fun_wish"]);
  });
});
