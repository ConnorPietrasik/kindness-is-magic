import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_TILES } from "../types/tiles";
import { useDashboardTiles } from "./useDashboardTiles";

const defaultAdminKeys = (DASHBOARD_TILES.admin ?? []).filter((d) => d.visible).map((d) => d.key);
const allAdminKeys = (DASHBOARD_TILES.admin ?? []).map((d) => d.key);

afterEach(() => {
  localStorage.clear();
});

describe("useDashboardTiles", () => {
  it("returns the default-visible tiles when localStorage is empty (csv-upload hidden)", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
    expect(result.current.visibleTiles).not.toContain("csv-upload");
  });

  it("restores a stored visibility subset", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "wishes"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(["users", "wishes"]);
  });

  it("restores a default-hidden tile the user explicitly enabled", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "csv-upload"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(["users", "csv-upload"]);
  });

  it("filters out unknown/stale keys from stored data", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "nonexistent_tile", "wishes"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(["users", "wishes"]);
  });

  it("falls back to defaults when stored data is not an array", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify({ users: true }));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
  });

  it("falls back to defaults when stored data is malformed", () => {
    localStorage.setItem("kim:dashboardTiles:admin", "not-json");

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
  });

  it("saves to localStorage on toggle", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("wishes");
    });

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys.filter((k) => k !== "wishes"));
    expect(localStorage.getItem("kim:dashboardTiles:admin")).toBe(JSON.stringify(defaultAdminKeys.filter((k) => k !== "wishes")));
  });

  it("shows a default-hidden tile when toggled on", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("csv-upload");
    });

    expect(result.current.visibleTiles).toEqual([...defaultAdminKeys, "csv-upload"]);
    expect(localStorage.getItem("kim:dashboardTiles:admin")).toBe(JSON.stringify([...defaultAdminKeys, "csv-upload"]));
  });

  it("re-shows a hidden tile when toggled again", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("wishes");
    });

    expect(result.current.visibleTiles).toEqual(["users", "wishes"]);
  });

  it("resetTiles restores the default-visible set (hides a re-enabled csv-upload)", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "csv-upload"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.resetTiles();
    });

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
    expect(localStorage.getItem("kim:dashboardTiles:admin")).toBe(JSON.stringify(defaultAdminKeys));
  });

  it("returns empty defs for roles without a registry entry", () => {
    const { result } = renderHook(() => useDashboardTiles("donor"));

    expect(result.current.defs).toEqual([]);
    expect(result.current.visibleTiles).toEqual([]);
    expect(result.current.orderedTiles).toEqual([]);
  });

  it("keeps independent hook instances in sync", () => {
    const first = renderHook(() => useDashboardTiles("admin"));
    const second = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      first.result.current.toggleTile("users");
    });

    expect(second.result.current.visibleTiles).toEqual(defaultAdminKeys.filter((k) => k !== "users"));
  });
});

describe("useDashboardTiles — order", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("returns the registry order when no order is stored", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.orderedTiles).toEqual(allAdminKeys);
  });

  it("legacy visibility-only storage restores visibility with the default order", () => {
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "wishes"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.visibleTiles).toEqual(["users", "wishes"]);
    expect(result.current.orderedTiles).toEqual(allAdminKeys);
  });

  it("restores a stored order", () => {
    localStorage.setItem("kim:dashboardTileOrder:admin", JSON.stringify(["wishes", ...allAdminKeys.filter((k) => k !== "wishes")]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.orderedTiles[0]).toBe("wishes");
    expect(result.current.orderedTiles).toHaveLength(allAdminKeys.length);
  });

  it("normalizes a stale stored order (unknown keys dropped, duplicates dropped, missing appended)", () => {
    localStorage.setItem("kim:dashboardTileOrder:admin", JSON.stringify(["wishes", "wishes", "removed_key", "users"]));

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.orderedTiles.slice(0, 2)).toEqual(["wishes", "users"]);
    expect(result.current.orderedTiles).toHaveLength(allAdminKeys.length);
    expect(new Set(result.current.orderedTiles).size).toBe(allAdminKeys.length);
  });

  it("falls back to the registry order for malformed stored order data", () => {
    localStorage.setItem("kim:dashboardTileOrder:admin", "not valid json");

    const { result } = renderHook(() => useDashboardTiles("admin"));

    expect(result.current.orderedTiles).toEqual(allAdminKeys);
  });

  it("reorder moves a tile before the target and persists the order", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.reorder("wishes", "users", "before");
    });

    expect(result.current.orderedTiles[0]).toBe("wishes");
    expect(result.current.orderedTiles[1]).toBe("users");
    expect(result.current.orderedTiles).toHaveLength(allAdminKeys.length);
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(result.current.orderedTiles));
    // Visibility is untouched by reordering.
    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
  });

  it("reorder is a no-op when the target is the dragged tile itself", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.reorder("users", "users", "before");
    });

    expect(result.current.orderedTiles).toEqual(allAdminKeys);
  });

  it("reordering across a hidden tile keeps the hidden tile in its slot", () => {
    // Hide "referrers" (2nd in the default order), then drag "families" in
    // front of "users" — the move spans the hidden tile's slot.
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("referrers");
    });
    act(() => {
      result.current.reorder("families", "users", "before");
    });

    const order = result.current.orderedTiles;
    expect(order[0]).toBe("families");
    // "referrers" stays in the list, right of "users" — its slot is intact.
    expect(order.indexOf("referrers")).toBe(order.indexOf("users") + 1);
  });

  it("moveBy shifts one visible step, skipping hidden tiles", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("referrers");
    });

    // "families" is the 2nd visible tile ("users", "families", ...) with
    // hidden "referrers" between them in the stored order. One left press
    // lands it directly before "users".
    act(() => {
      result.current.moveBy("families", -1);
    });

    let order = result.current.orderedTiles;
    expect(order.indexOf("families")).toBe(order.indexOf("users") - 1);

    // One right press on "users" lands it directly after "people", skipping
    // hidden "referrers" (which sits between them in the stored order).
    act(() => {
      result.current.moveBy("users", 1);
    });

    order = result.current.orderedTiles;
    expect(order.indexOf("users")).toBe(order.indexOf("people") + 1);
  });

  it("moveBy is a no-op at the visible edges", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("referrers");
    });

    // "users" is the leftmost visible tile.
    const before = [...result.current.orderedTiles];
    act(() => {
      result.current.moveBy("users", -1);
    });
    expect(result.current.orderedTiles).toEqual(before);

    // "browse-families" is the rightmost visible tile ("sponsorships" is
    // hidden before it in the registry).
    act(() => {
      result.current.moveBy("browse-families", 1);
    });
    expect(result.current.orderedTiles).toEqual(before);
  });

  it("resetTiles restores both the default-visible set and the default order", () => {
    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.toggleTile("csv-upload");
    });
    act(() => {
      result.current.reorder("emails", "users", "before");
    });

    act(() => {
      result.current.resetTiles();
    });

    expect(result.current.visibleTiles).toEqual(defaultAdminKeys);
    expect(result.current.orderedTiles).toEqual(allAdminKeys);
  });

  it("resetTiles is a no-op when visibility and order are already at defaults", () => {
    const handler = vi.fn();
    window.addEventListener("kim:dashboard-tile-change", handler);

    const { result } = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      result.current.resetTiles();
    });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("kim:dashboard-tile-change", handler);
  });

  it("syncs both visibility and order across instances", () => {
    const first = renderHook(() => useDashboardTiles("admin"));
    const second = renderHook(() => useDashboardTiles("admin"));

    act(() => {
      first.result.current.toggleTile("users");
    });
    act(() => {
      first.result.current.reorder("wishes", "users", "before");
    });

    expect(second.result.current.visibleTiles).toEqual(defaultAdminKeys.filter((k) => k !== "users"));
    expect(second.result.current.orderedTiles[0]).toBe("wishes");
    expect(second.result.current.orderedTiles).toHaveLength(allAdminKeys.length);
  });
});
