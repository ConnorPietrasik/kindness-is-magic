import { Button } from "./Button";

interface ClearViewButtonProps {
  /** True while the saved list view (filters/sort/search/page/tab) differs from defaults. */
  isNonDefault: boolean;
  /** Reset the saved list view to defaults (pages own the reset logic). */
  onClear: () => void;
}

/**
 * ClearViewButton — "obvious escape hatch" for persisted list views.
 *
 * List pages persist their view state (filters, sort, search, page, tab) in
 * localStorage so a view survives navigating away and back. This button
 * appears in the page header / filter row only while the saved view differs
 * from defaults and resets it in one click — so a stale view from a previous
 * session can always be dismissed without hunting each control down. On
 * pages with an active/deleted tab, clearing also returns to the active tab.
 *
 * Deliberately does NOT touch column visibility/order or table width — those
 * are separate preferences with their own reset controls.
 */
export function ClearViewButton({ isNonDefault, onClear }: ClearViewButtonProps) {
  if (!isNonDefault) return null;

  return (
    <Button variant="secondary" type="button" onClick={onClear} title="Reset the saved view (filters, sort, search, page, tab) to defaults">
      Clear filters
    </Button>
  );
}
