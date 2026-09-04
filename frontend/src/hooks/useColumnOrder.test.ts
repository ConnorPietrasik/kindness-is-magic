import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveKeysBy, reorderKeys, useColumnOrder } from "./useColumnOrder";

afterEach(() => {
  localStorage.clear();
});

const DEFAULT_REFERRER_ORDER = [
  "name",
  "family_limit",
  "phone_number",
  "family_invite_code",
  "approval_status",
  "approved_by_admin_name",
  "approved_at",
  "created_at",
];

// adminWishes columns visible by default — 8 hidden columns sit between
// "family_name" and "type" in the registry.
const WISHES_VISIBLE = [
  "display_id",
  "person_given_name",
  "family_name",
  "type",
  "description",
  "size",
  "color",
  "assigned_to",
  "purchased_at",
];

describe("useColumnOrder", () => {
  it("returns the full registry order when localStorage is empty", () => {
    const { result } = renderHook(() => useColumnOrder("adminReferrers"));
    expect(result.current.orderedKeys).toEqual(DEFAULT_REFERRER_ORDER);
    expect(result.current.isDefaultOrder).toBe(true);
  });

  it("restores a stored order", () => {
    const stored = ["created_at", ...DEFAULT_REFERRER_ORDER.filter((k) => k !== "created_at")];
    localStorage.setItem("kim:columnOrder:adminReferrers", JSON.stringify(stored));

    const { result } = renderHook(() => useColumnOrder("adminReferrers"));
    expect(result.current.orderedKeys).toEqual(stored);
    expect(result.current.isDefaultOrder).toBe(false);
  });

  it("normalizes stale stored data (unknown keys dropped, missing appended)", () => {
    localStorage.setItem("kim:columnOrder:adminReferrers", JSON.stringify(["created_at", "removed_key", "name"]));

    const { result } = renderHook(() => useColumnOrder("adminReferrers"));
    expect(result.current.orderedKeys).toEqual([
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

  it("falls back to the registry order for malformed stored data", () => {
    localStorage.setItem("kim:columnOrder:adminReferrers", "not valid json");

    const { result } = renderHook(() => useColumnOrder("adminReferrers"));
    expect(result.current.orderedKeys).toEqual(DEFAULT_REFERRER_ORDER);
  });

  it("returns an empty order for an unregistered resource", () => {
    const { result } = renderHook(() => useColumnOrder("noSuchResource"));
    expect(result.current.orderedKeys).toEqual([]);
    expect(result.current.isDefaultOrder).toBe(true);
  });

  it("reorder moves a unit before the target and persists", () => {
    const { result } = renderHook(() => useColumnOrder("adminReferrers"));

    act(() => {
      result.current.reorder(["created_at"], "name", "before");
    });

    expect(result.current.orderedKeys).toEqual([
      "created_at",
      "name",
      "family_limit",
      "phone_number",
      "family_invite_code",
      "approval_status",
      "approved_by_admin_name",
      "approved_at",
    ]);
    expect(result.current.isDefaultOrder).toBe(false);
    expect(localStorage.getItem("kim:columnOrder:adminReferrers")).toBe(JSON.stringify(result.current.orderedKeys));
  });

  it("reorder moves a unit after the target", () => {
    const { result } = renderHook(() => useColumnOrder("adminReferrers"));

    act(() => {
      result.current.reorder(["name"], "family_limit", "after");
    });

    expect(result.current.orderedKeys.slice(0, 3)).toEqual(["family_limit", "name", "phone_number"]);
  });

  it("reorder is a no-op when the target is part of the dragged unit", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaimWishes"));

    act(() => {
      result.current.reorder(["practical_wish", "fun_wish"], "fun_wish", "before");
    });

    expect(result.current.orderedKeys).toEqual(["name", "age", "practical_wish", "fun_wish"]);
  });

  it("moveBy shifts a unit one step and clamps at the edges", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaims"));

    act(() => {
      result.current.moveBy(["family"], 1);
    });
    expect(result.current.orderedKeys).toEqual(["status", "family", "commitment", "created"]);

    // Shift the first column left — clamped, no change.
    act(() => {
      result.current.moveBy(["status"], -1);
    });
    expect(result.current.orderedKeys).toEqual(["status", "family", "commitment", "created"]);

    // Shift the last column right — clamped, no change.
    act(() => {
      result.current.moveBy(["created"], 1);
    });
    expect(result.current.orderedKeys).toEqual(["status", "family", "commitment", "created"]);
  });

  it("moveBy moves a paired unit together", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaimWishes"));

    act(() => {
      result.current.moveBy(["practical_wish", "fun_wish"], -1);
    });
    expect(result.current.orderedKeys).toEqual(["name", "practical_wish", "fun_wish", "age"]);
  });

  it("moveBy skips hidden columns when visibleKeys is provided (left)", () => {
    // One left press on "type" lands it directly left of the visible
    // "family_name" — not 8 presses, one per hidden column in between.
    const { result } = renderHook(() => useColumnOrder("adminWishes", WISHES_VISIBLE));

    act(() => {
      result.current.moveBy(["type"], -1);
    });

    const order = result.current.orderedKeys;
    // "type" is now directly left of "family_name" (which shifted one right).
    expect(order.indexOf("type")).toBe(order.indexOf("family_name") - 1);
    expect(order.indexOf("family_name")).toBe(6);
    expect(order).toHaveLength(24);
  });

  it("moveBy skips hidden columns when visibleKeys is provided (right)", () => {
    const { result } = renderHook(() => useColumnOrder("adminWishes", WISHES_VISIBLE));

    act(() => {
      result.current.moveBy(["family_name"], 1);
    });

    const order = result.current.orderedKeys;
    // The next visible column right of "family_name" is "type".
    expect(order.indexOf("family_name")).toBe(order.indexOf("type") + 1);
  });

  it("moveBy clamps at the visible edges", () => {
    const { result } = renderHook(() => useColumnOrder("adminWishes", WISHES_VISIBLE));

    act(() => {
      result.current.moveBy(["display_id"], -1);
    });
    expect(result.current.orderedKeys[0]).toBe("display_id");

    const before = [...result.current.orderedKeys];
    act(() => {
      // "purchased_at" is the last visible column, though hidden columns
      // follow it in the registry.
      result.current.moveBy(["purchased_at"], 1);
    });
    expect(result.current.orderedKeys).toEqual(before);
  });

  it("resetOrder restores the registry order and persists", () => {
    localStorage.setItem("kim:columnOrder:adminReferrers", JSON.stringify([...DEFAULT_REFERRER_ORDER].reverse()));

    const { result } = renderHook(() => useColumnOrder("adminReferrers"));
    expect(result.current.isDefaultOrder).toBe(false);

    act(() => {
      result.current.resetOrder();
    });

    expect(result.current.orderedKeys).toEqual(DEFAULT_REFERRER_ORDER);
    expect(result.current.isDefaultOrder).toBe(true);
    expect(localStorage.getItem("kim:columnOrder:adminReferrers")).toBe(JSON.stringify(DEFAULT_REFERRER_ORDER));
  });

  it("setVisible order updates state, persists and dispatches event", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaims"));
    const handler = vi.fn();
    window.addEventListener("kim:column-order-change", handler);

    act(() => {
      result.current.reorder(["created"], "family", "before");
    });

    expect(result.current.orderedKeys).toEqual(["created", "family", "status", "commitment"]);
    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0] as CustomEvent<{ resourceKey: string; columns: string[] }>;
    expect(callArg.detail.resourceKey).toBe("donorClaims");
    expect(callArg.detail.columns).toEqual(["created", "family", "status", "commitment"]);

    window.removeEventListener("kim:column-order-change", handler);
  });

  it("syncs state when another instance dispatches a matching event", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaims"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:column-order-change", {
          detail: { resourceKey: "donorClaims", columns: ["status", "family", "commitment", "created"] },
        })
      );
    });

    expect(result.current.orderedKeys).toEqual(["status", "family", "commitment", "created"]);
  });

  it("ignores events for other resource keys", () => {
    const { result } = renderHook(() => useColumnOrder("donorClaims"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:column-order-change", {
          detail: { resourceKey: "adminFamilies", columns: ["display_id", "family_name"] },
        })
      );
    });

    expect(result.current.orderedKeys).toEqual(["family", "status", "commitment", "created"]);
  });
});

describe("reorderKeys (pure)", () => {
  const order = ["a", "b", "c", "d"];

  it("inserts before and after targets", () => {
    expect(reorderKeys(order, ["a"], "c", "before")).toEqual(["b", "a", "c", "d"]);
    expect(reorderKeys(order, ["a"], "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves multi-key units keeping them contiguous", () => {
    expect(reorderKeys(order, ["c", "d"], "a", "before")).toEqual(["c", "d", "a", "b"]);
    expect(reorderKeys(order, ["a", "b"], "d", "after")).toEqual(["c", "d", "a", "b"]);
  });

  it("returns null for unknown targets or self-targets", () => {
    expect(reorderKeys(order, ["a"], "zzz", "before")).toBeNull();
    expect(reorderKeys(order, ["a", "b"], "b", "after")).toBeNull();
  });
});

describe("moveKeysBy (pure)", () => {
  const order = ["a", "b", "c"];

  it("shifts left and right", () => {
    expect(moveKeysBy(order, ["b"], -1)).toEqual(["b", "a", "c"]);
    expect(moveKeysBy(order, ["b"], 1)).toEqual(["a", "c", "b"]);
  });

  it("returns null at the edges", () => {
    expect(moveKeysBy(order, ["a"], -1)).toBeNull();
    expect(moveKeysBy(order, ["c"], 1)).toBeNull();
  });

  it("returns null for non-contiguous or missing units", () => {
    expect(moveKeysBy(order, ["a", "c"], 1)).toBeNull();
    expect(moveKeysBy(order, ["zzz"], 1)).toBeNull();
  });
});
