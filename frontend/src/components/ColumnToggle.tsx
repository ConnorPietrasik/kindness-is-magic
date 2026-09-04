/**
 * ColumnToggle — gear icon button opening a popover with column checkboxes.
 *
 * Uses the useColumnVisibility hook internally so the caller only needs to
 * pass the resource key (e.g. "adminFamilies"). Changes are staged locally
 * and applied via the "Apply" button so the table refetches only once.
 */

import { useEffect, useRef, useState } from "react";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useTableWidth } from "../hooks/useTableWidth";

interface ColumnToggleProps {
  resourceKey: string;
}

export function ColumnToggle({ resourceKey }: ColumnToggleProps) {
  const { visibleColumns, setVisibleColumns, defs } = useColumnVisibility(resourceKey);
  const { resetOrder } = useColumnOrder(resourceKey);
  const { widthMode, setWidthMode, widthModes } = useTableWidth(resourceKey);
  const [open, setOpen] = useState(false);
  const [pendingColumns, setPendingColumns] = useState(visibleColumns);
  const [pendingWidth, setPendingWidth] = useState(widthMode);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setPendingColumns(visibleColumns);
    setPendingWidth(widthMode);
    setOpen(true);
  };

  const handleApply = () => {
    setVisibleColumns(pendingColumns);
    setWidthMode(pendingWidth);
    setOpen(false);
  };

  const handleReset = () => {
    const defaults = defs.filter((c) => c.visible).map((c) => c.key);
    setVisibleColumns(defaults);
    resetOrder();
    setWidthMode("compact");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        aria-label="Toggle columns"
        title="Toggle columns"
      >
        ⚙️
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl bg-white p-3 shadow-2xl border border-gray-200">
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Columns</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {defs.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pendingColumns.includes(col.key)}
                  onChange={() =>
                    setPendingColumns((prev) => (prev.includes(col.key) ? prev.filter((k) => k !== col.key) : [...prev, col.key]))
                  }
                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                  autoComplete="off"
                />
                {col.label}
              </label>
            ))}
          </div>

          <div className="my-3 border-t border-gray-200" />

          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Width</p>
          <div className="flex gap-1.5">
            {widthModes.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => setPendingWidth(mode.key)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                  pendingWidth === mode.key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleApply}
              className="flex-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
