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
  // The value the debounced state + callback last emitted. Gating on an actual
  // change — not on "not the first effect run" — keeps onChange from firing
  // on a timer armed by a run where the value never changed. That matters
  // under React StrictMode in dev builds (e2e + local dev serve the dev
  // server, main.tsx renders under <StrictMode>): the mount effect runs
  // twice, a first-render flag is consumed by the first run, and the second
  // arms a real timer that would fire ~delay ms after every mount with the
  // value unchanged — silently calling the pagination reset and overwriting
  // the persisted page back to 1.
  const lastEmitted = useRef(value);
  // Keep the callback in a ref: callers pass inline lambdas (new identity each
  // render), and putting it in the deps array would re-arm the timer on every
  // render — firing the callback (e.g. a pagination reset) even when the value
  // never changed.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (value === lastEmitted.current) return;
    const timer = setTimeout(() => {
      lastEmitted.current = value;
      setDebounced(value);
      onChangeRef.current?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
