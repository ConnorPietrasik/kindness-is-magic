import { describe, expect, it } from "vitest";
import { ADMIN_ASSIGNED_GIFT_SORT_FIELDS, PURCHASER_ASSIGNED_GIFT_SORT_FIELDS, sanitizeAssignedGiftsView } from "./AssignedGifts";

describe("sanitizeAssignedGiftsView", () => {
  describe("sort whitelist (per instance)", () => {
    it("keeps a sort field in the instance's whitelist", () => {
      expect(sanitizeAssignedGiftsView({ sortField: "family_name" }, ADMIN_ASSIGNED_GIFT_SORT_FIELDS).sortField).toBe("family_name");
      expect(sanitizeAssignedGiftsView({ sortField: "-person_given_name" }, PURCHASER_ASSIGNED_GIFT_SORT_FIELDS).sortField).toBe(
        "-person_given_name"
      );
    });

    it("drops a sort field the instance's endpoint would silently ignore", () => {
      // family_name is sortable on the admin wishes list but not on the
      // purchaser list (PURCHASER_WISH_SORT_FIELDS) — it must not be sent.
      expect(sanitizeAssignedGiftsView({ sortField: "family_name" }, PURCHASER_ASSIGNED_GIFT_SORT_FIELDS).sortField).toBeUndefined();
      expect(sanitizeAssignedGiftsView({ sortField: "-assigned_to_name" }, PURCHASER_ASSIGNED_GIFT_SORT_FIELDS).sortField).toBeUndefined();
    });

    it("drops a sort field with a stale/unknown name", () => {
      expect(sanitizeAssignedGiftsView({ sortField: "bogus" }, ADMIN_ASSIGNED_GIFT_SORT_FIELDS).sortField).toBeUndefined();
    });
  });

  describe("filters", () => {
    it("clamps the purchased filter to known values", () => {
      expect(sanitizeAssignedGiftsView({ purchased: "true" }, ADMIN_ASSIGNED_GIFT_SORT_FIELDS).purchased).toBe("true");
      expect(sanitizeAssignedGiftsView({ purchased: "bogus" }, ADMIN_ASSIGNED_GIFT_SORT_FIELDS).purchased).toBeUndefined();
    });

    it("keeps only known column-search keys (text + date _from/_to)", () => {
      const view = sanitizeAssignedGiftsView(
        {
          columnSearch: {
            description: "red",
            purchased_at_from: "2024-01-01",
            purchased_at_to: "2024-12-31",
            bogus: "x",
            purchased_at: "not-a-date-key",
          },
        },
        ADMIN_ASSIGNED_GIFT_SORT_FIELDS
      );
      expect(view.columnSearch).toEqual({
        description: "red",
        purchased_at_from: "2024-01-01",
        purchased_at_to: "2024-12-31",
      });
    });

    it("returns nothing for non-object input", () => {
      expect(sanitizeAssignedGiftsView("garbage", ADMIN_ASSIGNED_GIFT_SORT_FIELDS)).toEqual({});
      expect(sanitizeAssignedGiftsView(null, ADMIN_ASSIGNED_GIFT_SORT_FIELDS)).toEqual({});
    });
  });
});
