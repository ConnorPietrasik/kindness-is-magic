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
  // Keep the callback in a ref: callers pass inline lambdas (new identity each
  // render), and putting it in the deps array would re-arm the timer on every
  // render — firing the callback (e.g. a pagination reset) even when the value
  // never changed.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setDebounced(value);
      onChangeRef.current?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
