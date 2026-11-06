/** Hook for managing per-role dashboard tile order and visibility with localStorage persistence. */

import { useEffect, useState } from "react";
import { normalizeKeyOrder, safeGetItem, safeSetItem } from "../lib/utils";
import { DASHBOARD_TILES, type DashboardTileDef } from "../types/tiles";
import { reorderKeys } from "./useColumnOrder";

const STORAGE_PREFIX = "kim:dashboardTiles:";
const ORDER_STORAGE_PREFIX = "kim:dashboardTileOrder:";
const EVENT_TYPE = "kim:dashboard-tile-change";

/**
 * Order and visibility are separate state:
 * - `orderedTiles` is a full list of ALL tile keys (hidden tiles included —
 *   they hold their slot), persisted under `kim:dashboardTileOrder:<role>`.
 * - `visibleTiles` is the visible-key set, persisted under
 *   `kim:dashboardTiles:<role>` (pre-existing key and format).
 * Rendering is `orderedTiles` filtered to `visibleTiles`, so toggling
 * visibility never disturbs the order and a re-shown tile returns to its
 * saved position.
 */
export interface UseDashboardTilesResult {
  /** Tile keys the user has shown (a set — display order comes from orderedTiles). */
  visibleTiles: string[];
  /** All tile keys for the role in the user's current order (hidden tiles included). */
  orderedTiles: string[];
  /** Toggle a single tile's visibility. */
  toggleTile: (key: string) => void;
  /** Move a tile so it sits immediately before/after the target tile. */
  reorder: (key: string, targetKey: string, position: "before" | "after") => void;
  /**
   * Shift a tile one visible step left (-1) or right (+1) — keyboard
   * reorder. Hidden tiles are skipped, matching what the user sees.
   */
  moveBy: (key: string, delta: -1 | 1) => void;
  /** Restore the default-visible set AND the registry (default) order. */
  resetTiles: () => void;
  defs: DashboardTileDef[];
}

export function useDashboardTiles(role: string): UseDashboardTilesResult {
  const defs: DashboardTileDef[] = DASHBOARD_TILES[role] ?? [];
  const storageKey = STORAGE_PREFIX + role;
  const orderStorageKey = ORDER_STORAGE_PREFIX + role;

  const getDefaultKeys = () => defs.filter((d) => d.visible).map((d) => d.key);
  const getDefaultOrder = () => defs.map((d) => d.key);

  const [visibleTiles, setVisibleTilesState] = useState<string[]>(() => {
    const stored = safeGetItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          const validKeys = new Set(defs.map((d) => d.key));
          return parsed.filter((k): k is string => typeof k === "string" && validKeys.has(k));
        }
      } catch {
        // ignore malformed data
      }
    }
    return getDefaultKeys();
  });

  // No stored order (e.g. a browser that predates tile reordering) falls back
  // to the registry order; stale data is normalized against the registry.
  const [orderedTiles, setOrderedTilesState] = useState<string[]>(() => {
    const stored = safeGetItem(orderStorageKey);
    if (stored) {
      try {
        return normalizeKeyOrder(JSON.parse(stored), defs);
      } catch {
        // ignore malformed data
      }
    }
    return getDefaultOrder();
  });

  // Persist to localStorage
  useEffect(() => {
    safeSetItem(storageKey, JSON.stringify(visibleTiles));
  }, [storageKey, visibleTiles]);

  useEffect(() => {
    safeSetItem(orderStorageKey, JSON.stringify(orderedTiles));
  }, [orderStorageKey, orderedTiles]);

  // Listen for changes from other hook instances (e.g. TileToggle applying changes)
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ role: string; tiles: string[]; order: string[] }>;
      if (customEvent.detail.role === role) {
        setVisibleTilesState(customEvent.detail.tiles);
        setOrderedTilesState(customEvent.detail.order);
      }
    };
    window.addEventListener(EVENT_TYPE, handler);
    return () => window.removeEventListener(EVENT_TYPE, handler);
  }, [role]);

  /** Internal setter that persists + dispatches a sync event for other hook instances. */
  const commit = (tiles: string[], order: string[]) => {
    safeSetItem(storageKey, JSON.stringify(tiles));
    safeSetItem(orderStorageKey, JSON.stringify(order));
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: { role, tiles, order } }));
    setVisibleTilesState(tiles);
    setOrderedTilesState(order);
  };

  const toggleTile = (key: string) => {
    const next = visibleTiles.includes(key) ? visibleTiles.filter((k) => k !== key) : [...visibleTiles, key];
    commit(next, orderedTiles);
  };

  const reorder = (key: string, targetKey: string, position: "before" | "after") => {
    const next = reorderKeys(orderedTiles, [key], targetKey, position);
    if (next) commit(visibleTiles, next);
  };

  const moveBy = (key: string, delta: -1 | 1) => {
    // One press = one visible tile: move next to the visible neighbor,
    // whatever hidden tiles sit between them in the stored order.
    const visible = orderedTiles.filter((k) => visibleTiles.includes(k));
    const start = visible.indexOf(key);
    if (start === -1) return;
    const neighbor = delta < 0 ? visible[start - 1] : visible[start + 1];
    // No neighbor means the tile is at the edge of what the user can see.
    if (neighbor !== undefined) reorder(key, neighbor, delta < 0 ? "before" : "after");
  };

  const resetTiles = () => {
    const defaultKeys = getDefaultKeys();
    const defaultOrder = getDefaultOrder();
    const visibilityChanged = visibleTiles.length !== defaultKeys.length || defaultKeys.some((k) => !visibleTiles.includes(k));
    const orderChanged = orderedTiles.length !== defaultOrder.length || defaultOrder.some((k, i) => k !== orderedTiles[i]);
    if (visibilityChanged || orderChanged) commit(defaultKeys, defaultOrder);
  };

  return { visibleTiles, orderedTiles, toggleTile, reorder, moveBy, resetTiles, defs };
}
