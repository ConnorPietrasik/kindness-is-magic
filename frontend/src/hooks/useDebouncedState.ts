/**
 * useDebouncedState — return a debounced copy of a value.
 *
 * Accepts a value and a delay in milliseconds. Returns the debounced
 * value that updates only after *delay* ms have elapsed since the last
 * change.  An optional callback fires each time the debounced value
 * updates (useful for resetting pagination, etc.).
 *
 * @example
 * ```tsx
 * const [search, setSearch] = useState("");
 * const debouncedSearch = useDebouncedState(search, 300, () => pagination.goToPage(1));
 * ```
 */

import { useEffect, useRef, useState } from "react";

export function useDebouncedState<T>(value: T, delay: number, onChange?: () => void): T {
  const [debounced, setDebounced] = useState(value);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setDebounced(value);
      onChange?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay, onChange]);

  return debounced;
}
