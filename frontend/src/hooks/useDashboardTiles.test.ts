import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DASHBOARD_TILES } from "../types/tiles";
import { useDashboardTiles } from "./useDashboardTiles";

const defaultAdminKeys = (DASHBOARD_TILES.admin ?? []).filter((d) => d.visible).map((d) => d.key);

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
