import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ActionItem {
  label: string;
  variant?: "secondary" | "danger";
  onClick: () => void;
  disabled?: boolean;
}

interface ActionsDropdownProps {
  /** Menu items. If empty or all disabled, the trigger is hidden. */
  items: ActionItem[];
  /** Disable the trigger button (and all items). */
  disabled?: boolean;
  /** Aria-label for the trigger button. */
  triggerTitle?: string;
  children?: ReactNode;
}

/**
 * Kebab-menu dropdown for secondary row actions.
 *
 * Keeps the most common actions (Edit, Manage) as visible buttons and
 * tucks less-frequent actions (Delete, Reset Lock, Restore) behind a
 * three-dot menu.
 */
export function ActionsDropdown({ items, disabled: propDisabled, triggerTitle = "More actions", children }: ActionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hide trigger when there are no usable items
  const visibleItems = items.filter((item) => !item.disabled);
  if (visibleItems.length === 0) {
    return <>{children}</>;
  }

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    function handleOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleTriggerClick() {
    setOpen((prev) => !prev);
  }

  function handleItemClick(item: ActionItem) {
    setOpen(false);
    item.onClick();
  }

  return (
    <>
      {children}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-label={triggerTitle}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={handleTriggerClick}
          disabled={!!propDisabled}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btn-start/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* Vertical ellipsis (kebab) icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute right-0 z-50 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            role="menu"
          >
            {items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.variant === "danger" ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
                } ${idx === 0 ? "" : "border-t border-gray-100"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
