/**
 * useResizablePanel — width state for a right-docked panel the user resizes by
 * dragging its left edge (e.g. the AdminEmailComposer drawer).
 *
 * `width` is null while the panel sits at its CSS default; a number (px) once
 * the user has dragged or key-adjusted the edge. The settled width is persisted
 * to localStorage so the admin's preferred size survives reloads. All widths
 * are clamped to [MIN_PANEL_WIDTH, 85% of the viewport] so the panel can never
 * eat the whole page.
 *
 * Parking: dragging the edge past the minimum — beyond a small grace, with the
 * panel hinting at it while armed — and releasing collapses the panel into a
 * slim rail (`collapsed`). The pre-park width is kept in `width` and restored
 * by dragging the edge back out, double-clicking, or an expanding arrow key,
 * so whatever the panel renders (e.g. an in-flight draft) survives. The
 * collapsed flag itself is transient — only the width is persisted.
 */

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { safeGetItem, safeRemoveItem, safeSetItem } from "../lib/utils";

/** Smallest usable panel width (the form fields need the room). */
export const MIN_PANEL_WIDTH = 380;
/** The panel's CSS default width — the baseline for keyboard adjustments. */
export const DEFAULT_PANEL_WIDTH = 520;
/** Width of the parked (collapsed) rail. */
export const PARKED_PANEL_WIDTH = 56;
/** How far past the min-width edge the pointer must go before a release parks. */
const PARK_GRACE = 16;
/** The panel never takes more than this fraction of the viewport. */
const MAX_VIEWPORT_FRACTION = 0.85;
/** Keyboard nudge per arrow-key press (px). */
const KEY_STEP = 16;

/** Largest width the panel can take (85% of the viewport, never below the min). */
export function getMaxPanelWidth(): number {
  return Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * MAX_VIEWPORT_FRACTION));
}

function clampWidth(px: number): number {
  return Math.min(Math.max(Math.round(px), MIN_PANEL_WIDTH), getMaxPanelWidth());
}

function readStoredWidth(storageKey: string): number | null {
  const raw = safeGetItem(storageKey);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? clampWidth(n) : null;
}

export interface UseResizablePanelResult {
  /** null = CSS default width; number = user-set width in px. */
  width: number | null;
  /** True while a pointer drag is in progress. */
  isResizing: boolean;
  /** True while parked (collapsed into the slim rail). */
  collapsed: boolean;
  /** True while dragging past the min edge far enough that releasing will park. */
  collapseArmed: boolean;
  /** Pointer handler for the resize handle (starts a drag; from the rail it pulls the panel back open). */
  onPointerDown: (e: ReactPointerEvent) => void;
  /** Expanded: resets to the CSS default width (clears the stored value). Parked: restores the pre-park width. */
  onDoubleClick: () => void;
  /** Arrow keys nudge by KEY_STEP px; Home/End jump to the min/max. While parked, an expanding arrow or End restores the panel. */
  onKeyDown: (e: ReactKeyboardEvent) => void;
  /** Parks the panel (collapses to the rail), keeping the current width. */
  park: () => void;
  /** Restores a parked panel (to its pre-park width). */
  expand: () => void;
}

export function useResizablePanel(storageKey: string, defaultWidth = DEFAULT_PANEL_WIDTH): UseResizablePanelResult {
  const [width, setWidth] = useState<number | null>(() => readStoredWidth(storageKey));
  const [isResizing, setIsResizing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseArmed, setCollapseArmed] = useState(false);
  const widthRef = useRef<number | null>(width);
  widthRef.current = width;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // Width to restore if the current drag ends in a park — set on pointerdown
  // (the panel's pre-gesture width), or at the min-edge crossing for drags
  // that started from the rail.
  const preParkWidthRef = useRef<number | null>(null);

  // While dragging, listen on window (the pointer leaves the thin handle
  // immediately) and suppress text selection + the default cursor.
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: PointerEvent) => {
      const raw = window.innerWidth - e.clientX;
      if (collapsedRef.current) {
        // Dragging from the rail: the panel opens once the pointer clears the
        // rail, then follows it.
        if (raw > PARKED_PANEL_WIDTH) {
          setCollapsed(false);
          setWidth(clampWidth(raw));
          setCollapseArmed(false);
        }
        return;
      }
      setWidth(clampWidth(raw));
      if (raw < MIN_PANEL_WIDTH) {
        // Drag that started from the rail: fall back to the width this drag
        // opened the panel to.
        if (preParkWidthRef.current == null) preParkWidthRef.current = widthRef.current ?? defaultWidth;
        // Armed only beyond the grace — releasing right at the clamp is a
        // normal min-width settle, not a park.
        setCollapseArmed(raw <= MIN_PANEL_WIDTH - PARK_GRACE);
      } else {
        setCollapseArmed(false);
      }
    };
    const onUp = (e: PointerEvent) => {
      const raw = window.innerWidth - e.clientX;
      const parking = !collapsedRef.current && raw <= MIN_PANEL_WIDTH - PARK_GRACE && preParkWidthRef.current != null;
      if (parking) {
        setWidth(preParkWidthRef.current);
        setCollapsed(true);
      }
      preParkWidthRef.current = null;
      setCollapseArmed(false);
      setIsResizing(false);
    };
    // pointercancel (a system gesture took the pointer) ends the drag without
    // parking — the park gesture was never completed.
    const onCancel = () => {
      preParkWidthRef.current = null;
      setCollapseArmed(false);
      setIsResizing(false);
    };
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [isResizing, defaultWidth]);

  // Persist the settled width (skip mid-drag); clear the value on reset. The
  // safe* helpers no-op when storage is unavailable — the width still applies,
  // it just won't survive a reload. While parked, `width` holds the pre-park
  // width, so that is what gets persisted (and restored on reload).
  useEffect(() => {
    if (isResizing) return;
    if (width == null) safeRemoveItem(storageKey);
    else safeSetItem(storageKey, String(width));
  }, [isResizing, width, storageKey]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      // What a release-park restores: the panel's width before this gesture.
      // From the rail it's null — the width at the crossing is captured instead.
      preParkWidthRef.current = collapsedRef.current ? null : (widthRef.current ?? defaultWidth);
      setIsResizing(true);
    },
    [defaultWidth]
  );

  const onDoubleClick = useCallback(() => {
    if (collapsedRef.current) setCollapsed(false);
    else setWidth(null);
  }, []);

  const park = useCallback(() => {
    if (!collapsedRef.current) setCollapsed(true);
  }, []);

  const expand = useCallback(() => {
    if (collapsedRef.current) setCollapsed(false);
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (collapsedRef.current) {
        // Parked: keys restore the panel (to its kept width) rather than nudge.
        if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "End") {
          e.preventDefault();
          if (e.key === "End") setWidth(clampWidth(Number.MAX_SAFE_INTEGER));
          setCollapsed(false);
          return;
        }
        // ArrowLeft/Down/Home: already at the most-collapsed state.
        e.preventDefault();
        return;
      }
      const base = widthRef.current ?? defaultWidth;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        setWidth(clampWidth(base + KEY_STEP));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setWidth(clampWidth(base - KEY_STEP));
      } else if (e.key === "Home") {
        e.preventDefault();
        setWidth(MIN_PANEL_WIDTH);
      } else if (e.key === "End") {
        e.preventDefault();
        setWidth(clampWidth(Number.MAX_SAFE_INTEGER));
      }
    },
    [defaultWidth]
  );

  return { width, isResizing, collapsed, collapseArmed, onPointerDown, onDoubleClick, onKeyDown, park, expand };
}
