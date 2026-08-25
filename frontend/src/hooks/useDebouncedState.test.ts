import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedState } from "./useDebouncedState";

// Use a short delay for tests
const DELAY = 50;

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedState", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedState("hello", DELAY));
    expect(result.current).toBe("hello");
  });

  it("updates after the delay elapses", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedState(value, DELAY), {
      initialProps: { value: "a" },
    });

    expect(result.current).toBe("a");

    // Change the value
    rerender({ value: "b" });
    expect(result.current).toBe("a"); // still stale

    // Advance time past the delay
    act(() => vi.advanceTimersByTime(DELAY));

    expect(result.current).toBe("b");
  });

  it("resets the timer on each change", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedState(value, DELAY), {
      initialProps: { value: "a" },
    });

    // Change value, advance half the delay
    rerender({ value: "b" });
    act(() => vi.advanceTimersByTime(DELAY / 2));
    expect(result.current).toBe("a");

    // Change again before delay elapses — timer resets
    rerender({ value: "c" });
    act(() => vi.advanceTimersByTime(DELAY / 2));
    expect(result.current).toBe("a"); // still original

    // Now advance past the full delay from the last change
    act(() => vi.advanceTimersByTime(DELAY / 2));
    expect(result.current).toBe("c");
  });

  it("calls onChange when the debounced value updates", () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useDebouncedState(value, DELAY, onChange), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(DELAY));
    expect(result.current).toBe("b");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not call onChange when the callback identity changes without a value change", () => {
    vi.useFakeTimers();

    // Simulates the AdminFamilies pattern: inline () => pagination.goToPage(1)
    // gives a new callback identity on every render. Previously this re-armed
    // the timer each render and fired the callback ~delay ms after any render,
    // yanking paginated tables back to page 1 with no user input.
    const { rerender } = renderHook(({ value, onChange }) => useDebouncedState(value, DELAY, onChange), {
      initialProps: { value: "a", onChange: vi.fn() },
    });

    const freshOnChange = vi.fn();
    rerender({ value: "a", onChange: freshOnChange });
    act(() => vi.advanceTimersByTime(DELAY * 2));
    expect(freshOnChange).not.toHaveBeenCalled();
  });

  it("fires the latest callback when the value changes", () => {
    vi.useFakeTimers();

    const first = vi.fn();
    const { rerender } = renderHook(({ value, onChange }) => useDebouncedState(value, DELAY, onChange), {
      initialProps: { value: "a", onChange: first },
    });

    const latest = vi.fn();
    rerender({ value: "b", onChange: latest });
    act(() => vi.advanceTimersByTime(DELAY));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("does not call onChange on mount", () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    renderHook(() => useDebouncedState("initial", DELAY, onChange));

    act(() => vi.advanceTimersByTime(DELAY));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("works with numeric values", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedState(value, DELAY), {
      initialProps: { value: 1 },
    });

    rerender({ value: 42 });
    act(() => vi.advanceTimersByTime(DELAY));
    expect(result.current).toBe(42);
  });

  it("works with null/undefined values", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }: { value: string | null }) => useDebouncedState(value, DELAY), {
      initialProps: { value: "present" } as { value: string | null },
    });

    rerender({ value: null });
    act(() => vi.advanceTimersByTime(DELAY));
    expect(result.current).toBeNull();
  });
});
