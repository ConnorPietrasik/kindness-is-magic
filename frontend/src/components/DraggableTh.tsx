/**
 * DraggableTh — sortable table header cell with drag-to-reorder support.
 *
 * The whole cell is draggable; drags that start inside an interactive
 * control (filter input, sort button) are ignored so text selection keeps
 * working. Dropping on the left/right half of another header inserts the
 * unit before/after it (a violet edge indicator shows the insertion point).
 * A selection ring shows while the header is focused (by click or Tab) so
 * it's clear which column the arrow keys will move.
 * Arrow keys shift the column one step when the header is focused.
 *
 * A "unit" is the list of column keys this header belongs to — normally a
 * single key, but columns that must stay adjacent (e.g. the paired wish
 * columns) share a unit and always move together.
 */

import { type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

const DRAG_END_EVENT = "kim:column-drag-end";

/** One drag gesture is active at a time, so module state is safe. */
let activeDragUnit: string[] | null = null;

function sameUnit(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

interface DraggableThProps {
  /** Column keys this header belongs to (usually one key). */
  unit: string[];
  /** Drop handler: dragged unit, a key of the target column, insertion position. */
  onReorder: (dragged: string[], targetKey: string, position: "before" | "after") => void;
  /** Keyboard reorder: shift this unit one step. */
  onMoveBy: (unit: string[], delta: -1 | 1) => void;
  children?: ReactNode;
  colSpan?: number;
}

export function DraggableTh({ unit, onReorder, onMoveBy, children, colSpan }: DraggableThProps) {
  const [dropPos, setDropPos] = useState<"before" | "after" | null>(null);
  // Selection ring: shown while the header is focused (click or keyboard),
  // not only on :focus-visible (keyboard), so a click gives immediate feedback.
  const [selected, setSelected] = useState(false);

  // Clear the indicator if the drag ends elsewhere (e.g. Esc cancels the drag).
  useEffect(() => {
    const clear = () => setDropPos(null);
    window.addEventListener(DRAG_END_EVENT, clear);
    return () => window.removeEventListener(DRAG_END_EVENT, clear);
  }, []);

  function handleDragStart(e: DragEvent<HTMLTableCellElement>) {
    // Don't hijack drags that start inside interactive controls.
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, button")) {
      e.preventDefault();
      return;
    }
    activeDragUnit = unit;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent<HTMLTableCellElement>) {
    if (!activeDragUnit || sameUnit(activeDragUnit, unit)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    // jsdom events carry no clientX — default to the left edge ("before").
    setDropPos((e.clientX ?? 0) < rect.left + rect.width / 2 ? "before" : "after");
  }

  function handleDrop(e: DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    if (activeDragUnit && !sameUnit(activeDragUnit, unit)) {
      const rect = e.currentTarget.getBoundingClientRect();
      const position = (e.clientX ?? 0) < rect.left + rect.width / 2 ? "before" : "after";
      onReorder(activeDragUnit, unit[0] ?? "", position);
    }
    activeDragUnit = null;
    setDropPos(null);
    window.dispatchEvent(new Event(DRAG_END_EVENT));
  }

  function handleDragEnd() {
    activeDragUnit = null;
    setDropPos(null);
    window.dispatchEvent(new Event(DRAG_END_EVENT));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    // Arrow keys must keep their normal behavior inside inner controls
    // (filter inputs, sort buttons) — only react when the header cell
    // itself is focused.
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMoveBy(unit, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onMoveBy(unit, 1);
    }
  }

  const indicator =
    dropPos === "before"
      ? "bg-violet-50/60 shadow-[inset_3px_0_0_0_#8b5cf6]"
      : dropPos === "after"
        ? "bg-violet-50/60 shadow-[inset_-3px_0_0_0_#8b5cf6]"
        : "";

  return (
    <th
      {...(colSpan !== undefined && { colSpan })}
      draggable
      tabIndex={0}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onKeyDown={handleKeyDown}
      onFocus={() => setSelected(true)}
      onBlur={() => setSelected(false)}
      title="Drag to reorder"
      className={`cursor-grab select-none px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 active:cursor-grabbing focus:outline-none ${
        selected ? "ring-2 ring-inset ring-btn-start/50" : ""
      } ${indicator}`}
    >
      {children}
    </th>
  );
}
