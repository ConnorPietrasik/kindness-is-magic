/** Hook for managing per-resource column order with localStorage persistence. */

import { useEffect, useState } from "react";
import { COLUMNS, type ColumnDef, normalizeColumnOrder } from "../types/columns";

const STORAGE_PREFIX = "kim:columnOrder:";
const EVENT_TYPE = "kim:column-order-change";

export interface UseColumnOrderResult {
  /** All column keys for the resource in the user's current order. */
  orderedKeys: string[];
  /** Move a drag unit so it sits immediately before/after the target key. */
  reorder: (dragged: string[], targetKey: string, position: "before" | "after") => void;
  /**
   * Shift a unit one step left (-1) or right (+1) — keyboard reorder.
   * When `visibleKeys` was provided, steps one *visible* column at a time
   * (hidden columns are skipped), matching what the user sees.
   */
  moveBy: (unit: string[], delta: -1 | 1) => void;
  /** Restore the registry (default) order. */
  resetOrder: () => void;
  /** True when the current order matches the registry order. */
  isDefaultOrder: boolean;
  defs: ColumnDef[];
}

/**
 * Pure: move `dragged` (a set of keys to keep together) to immediately
 * before/after `targetKey`. Returns null when the move is a no-op
 * (target is part of the dragged unit, or target unknown).
 */
export function reorderKeys(order: string[], dragged: string[], targetKey: string, position: "before" | "after"): string[] | null {
  const draggedSet = new Set(dragged);
  if (draggedSet.has(targetKey)) return null;
  const rest = order.filter((k) => !draggedSet.has(k));
  const idx = rest.indexOf(targetKey);
  if (idx === -1) return null;
  const insertAt = position === "before" ? idx : idx + 1;
  return [...rest.slice(0, insertAt), ...dragged, ...rest.slice(insertAt)];
}

/**
 * Pure: shift a contiguous `unit` one step left (-1) or right (+1).
 * Returns null at the edges or when the unit is not contiguous.
 */
export function moveKeysBy(order: string[], unit: string[], delta: -1 | 1): string[] | null {
  if (unit.length === 0) return null;
  const start = order.indexOf(unit[0]!);
  if (start === -1) return null;
  for (let i = 1; i < unit.length; i++) {
    if (order[start + i] !== unit[i]) return null;
  }
  const end = start + unit.length;
  if (delta < 0 && start === 0) return null;
  if (delta > 0 && end >= order.length) return null;
  const next = [...order];
  const block = next.splice(start, unit.length);
  // `end` is also the insert index in the shortened array (elements right of
  // the unit shift left by one after removal).
  next.splice(delta < 0 ? start - 1 : end, 0, ...block);
  return next;
}

/**
 * @param visibleKeys - keys currently shown in the table (from
 *   `useColumnVisibility`). Only used by `moveBy` so keyboard reordering
 *   steps over hidden columns; omit it when every registered column is
 *   always visible (donor tables).
 */
export function useColumnOrder(resourceKey: string, visibleKeys?: string[]): UseColumnOrderResult {
  const defs: ColumnDef[] = COLUMNS[resourceKey] ?? [];
  const storageKey = STORAGE_PREFIX + resourceKey;

  const [orderedKeys, setOrderedKeysState] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        return normalizeColumnOrder(JSON.parse(stored), defs);
      }
    } catch {
      // ignore malformed data
    }
    return defs.map((d) => d.key);
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(orderedKeys));
  }, [storageKey, orderedKeys]);

  // Listen for changes from other hook instances (e.g. ColumnToggle resetting)
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ resourceKey: string; columns: string[] }>;
      if (customEvent.detail.resourceKey === resourceKey) {
        setOrderedKeysState(customEvent.detail.columns);
      }
    };
    window.addEventListener(EVENT_TYPE, handler);
    return () => window.removeEventListener(EVENT_TYPE, handler);
  }, [resourceKey]);

  /** Internal setter that persists + dispatches a sync event for other hook instances. */
  const setOrderedKeys = (keys: string[]) => {
    localStorage.setItem(storageKey, JSON.stringify(keys));
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: { resourceKey, columns: keys } }));
    setOrderedKeysState(keys);
  };

  const reorder = (dragged: string[], targetKey: string, position: "before" | "after") => {
    const next = reorderKeys(orderedKeys, dragged, targetKey, position);
    if (next) setOrderedKeys(next);
  };

  const moveBy = (unit: string[], delta: -1 | 1) => {
    if (visibleKeys) {
      // One press = one visible column: move the unit immediately
      // before/after its visible neighbor, whatever hidden columns sit
      // between them in the stored order.
      const visible = orderedKeys.filter((k) => visibleKeys.includes(k));
      const start = visible.indexOf(unit[0]!);
      let contiguous = start !== -1;
      for (let i = 1; i < unit.length && contiguous; i++) {
        contiguous = visible[start + i] === unit[i];
      }
      if (contiguous) {
        const neighbor = delta < 0 ? visible[start - 1] : visible[start + unit.length];
        if (neighbor !== undefined) reorder(unit, neighbor, delta < 0 ? "before" : "after");
        return;
      }
    }
    const next = moveKeysBy(orderedKeys, unit, delta);
    if (next) setOrderedKeys(next);
  };

  const resetOrder = () => {
    const defaults = defs.map((d) => d.key);
    if (defaults.length !== orderedKeys.length || defaults.some((k, i) => k !== orderedKeys[i])) {
      setOrderedKeys(defaults);
    }
  };

  const isDefaultOrder = defs.length === orderedKeys.length && defs.every((d, i) => d.key === orderedKeys[i]);

  return { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder, defs };
}
