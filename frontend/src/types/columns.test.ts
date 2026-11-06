import { describe, expect, it } from "vitest";
import { COLUMNS } from "./columns";

describe("COLUMNS", () => {
  it("registers the donor table resources", () => {
    expect(COLUMNS.donorClaims!.map((d) => d.key)).toEqual(["family", "status", "commitment", "created"]);
    expect(COLUMNS.donorClaimWishes!.map((d) => d.key)).toEqual(["name", "age", "practical_wish", "fun_wish"]);
  });
});
