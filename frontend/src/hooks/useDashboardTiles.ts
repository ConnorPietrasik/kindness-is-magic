/** Hook for managing per-role dashboard tile visibility with localStorage persistence. */

import { useEffect, useState } from "react";
import { DASHBOARD_TILES, type DashboardTileDef } from "../types/tiles";

const STORAGE_PREFIX = "kim:dashboardTiles:";
const EVENT_TYPE = "kim:dashboard-tile-change";

export interface UseDashboardTilesResult {
  /** Tile keys the user has shown (a set — tiles always render in registry order). */
  visibleTiles: string[];
  /** Toggle a single tile's visibility. */
  toggleTile: (key: string) => void;
  /** Set the visible tile list directly. */
  setVisibleTiles: (keys: string[]) => void;
  /** Restore the default-visible set. */
  resetTiles: () => void;
  defs: DashboardTileDef[];
}

export function useDashboardTiles(role: string): UseDashboardTilesResult {
  const defs: DashboardTileDef[] = DASHBOARD_TILES[role] ?? [];
  const storageKey = STORAGE_PREFIX + role;

  const getDefaultKeys = () => defs.filter((d) => d.visible).map((d) => d.key);

  const [visibleTiles, setVisibleTilesState] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          const validKeys = new Set(defs.map((d) => d.key));
          return parsed.filter((k): k is string => typeof k === "string" && validKeys.has(k));
        }
      }
    } catch {
      // ignore malformed data
    }
    return getDefaultKeys();
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(visibleTiles));
  }, [storageKey, visibleTiles]);

  // Listen for changes from other hook instances (e.g. TileToggle applying changes)
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ role: string; tiles: string[] }>;
      if (customEvent.detail.role === role) {
        setVisibleTilesState(customEvent.detail.tiles);
      }
    };
    window.addEventListener(EVENT_TYPE, handler);
    return () => window.removeEventListener(EVENT_TYPE, handler);
  }, [role]);

  /** Internal setter that persists + dispatches a sync event for other hook instances. */
  const setVisibleTiles = (keys: string[]) => {
    localStorage.setItem(storageKey, JSON.stringify(keys));
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: { role, tiles: keys } }));
    setVisibleTilesState(keys);
  };

  const toggleTile = (key: string) => {
    const next = visibleTiles.includes(key) ? visibleTiles.filter((k) => k !== key) : [...visibleTiles, key];
    setVisibleTiles(next);
  };

  const resetTiles = () => setVisibleTiles(getDefaultKeys());

  return { visibleTiles, toggleTile, setVisibleTiles, resetTiles, defs };
}
