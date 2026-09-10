import { describe, expect, it } from "vitest";
import type { Deadline } from "../types";
import { getBannerDeadline, localDateKey } from "./deadlines";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 1,
    type: "family_info",
    label: "Family information",
    due_date: "2026-12-15",
    mode: "display",
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Fixed "now" — 2026-06-15 in any timezone within ±12h of UTC. */
const NOW = new Date("2026-06-15T12:00:00Z");

describe("localDateKey", () => {
  it("formats a date as local YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 11, 5))).toBe("2026-12-05");
  });
});

describe("getBannerDeadline", () => {
  it("returns null for no rows (null, undefined, empty)", () => {
    expect(getBannerDeadline(null, "family_info", NOW)).toBeNull();
    expect(getBannerDeadline(undefined, "family_info", NOW)).toBeNull();
    expect(getBannerDeadline([], "family_info", NOW)).toBeNull();
  });

  it("ignores rows of other types", () => {
    expect(getBannerDeadline([makeDeadline({ type: "gift_dropoff" })], "family_info", NOW)).toBeNull();
  });

  it("returns the earliest future dated display row as upcoming", () => {
    const result = getBannerDeadline(
      [
        makeDeadline({ id: 1, due_date: "2026-12-15" }),
        makeDeadline({ id: 2, due_date: "2026-12-01" }),
        makeDeadline({ id: 3, due_date: "2026-11-20" }),
      ],
      "family_info",
      NOW
    );
    expect(result).toEqual({ label: "Family information", dueDate: "2026-11-20", status: "upcoming" });
  });

  it("includes enforced rows (they feed the banner too)", () => {
    const result = getBannerDeadline([makeDeadline({ mode: "enforced", due_date: "2026-12-01" })], "family_info", NOW);
    expect(result).toEqual({ label: "Family information", dueDate: "2026-12-01", status: "upcoming" });
  });

  it("treats a row due today as upcoming (the deadline day stays in effect)", () => {
    const result = getBannerDeadline([makeDeadline({ due_date: "2026-06-15" })], "family_info", NOW);
    expect(result).toEqual({ label: "Family information", dueDate: "2026-06-15", status: "upcoming" });
  });

  it("falls back to the most recent past row when no future row exists", () => {
    const result = getBannerDeadline(
      [
        makeDeadline({ id: 1, due_date: "2026-01-10" }),
        makeDeadline({ id: 2, due_date: "2026-05-02" }),
        makeDeadline({ id: 3, due_date: "2026-02-01" }),
      ],
      "family_info",
      NOW
    );
    expect(result).toEqual({ label: "Family information", dueDate: "2026-05-02", status: "past" });
  });

  it("prefers the earliest future row over past rows when mixed", () => {
    const result = getBannerDeadline(
      [makeDeadline({ id: 1, due_date: "2026-01-10" }), makeDeadline({ id: 2, due_date: "2026-12-01" })],
      "family_info",
      NOW
    );
    expect(result).toEqual({ label: "Family information", dueDate: "2026-12-01", status: "upcoming" });
  });

  it("ignores remind rows (the email channel never feeds the banner)", () => {
    expect(getBannerDeadline([makeDeadline({ mode: "remind", due_date: "2026-12-15" })], "family_info", NOW)).toBeNull();

    // A remind row must not shadow a past enforced row either.
    const result = getBannerDeadline(
      [makeDeadline({ id: 1, mode: "remind", due_date: "2026-12-15" }), makeDeadline({ id: 2, mode: "enforced", due_date: "2026-05-02" })],
      "family_info",
      NOW
    );
    expect(result).toEqual({ label: "Family information", dueDate: "2026-05-02", status: "past" });
  });

  it("ignores undated rows (they are inert)", () => {
    expect(getBannerDeadline([makeDeadline({ due_date: null })], "family_info", NOW)).toBeNull();
  });

  it("works per type across a mixed set", () => {
    const rows = [
      makeDeadline({ id: 1, type: "family_info", due_date: "2026-01-01" }),
      makeDeadline({ id: 2, type: "referrer_review", label: "Referrer review", due_date: "2026-12-01", mode: "enforced" }),
      makeDeadline({ id: 3, type: "gift_dropoff", due_date: null }),
    ];
    expect(getBannerDeadline(rows, "referrer_review", NOW)).toEqual({
      label: "Referrer review",
      dueDate: "2026-12-01",
      status: "upcoming",
    });
    expect(getBannerDeadline(rows, "gift_dropoff", NOW)).toBeNull();
  });
});
