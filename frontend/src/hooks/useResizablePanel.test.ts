import { act, fireEvent, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  PARKED_PANEL_WIDTH,
  type UseResizablePanelResult,
  useResizablePanel,
} from "./useResizablePanel";

// jsdom's default viewport is 1024px wide → the max clamp is 85% of that.
const VIEWPORT = 1024;
const MAX = Math.floor(VIEWPORT * 0.85);

// The pointer x that lands `px` past the min-width edge (raw = VIEWPORT - x).
const xPastMin = (px: number) => VIEWPORT - (MIN_PANEL_WIDTH - px);

type Res = { current: UseResizablePanelResult };

// One drag that settles the panel at `px`.
function resizeTo(result: Res, px: number) {
  act(() => result.current.onPointerDown(pointerDownEvent()));
  fireEvent.pointerMove(window, { clientX: VIEWPORT - px });
  fireEvent.pointerUp(window, { clientX: VIEWPORT - px });
}

// One park gesture: grab, pull past the min edge beyond the grace, release.
function park(result: Res) {
  act(() => result.current.onPointerDown(pointerDownEvent()));
  fireEvent.pointerMove(window, { clientX: xPastMin(24) });
  fireEvent.pointerUp(window, { clientX: xPastMin(24) });
}

// The hook only touches .key / .preventDefault on keyboard events and
// .preventDefault on pointer events, so minimal fakes suffice.
const keyEvent = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent;
const pointerDownEvent = () => ({ preventDefault: vi.fn() }) as unknown as ReactPointerEvent;

describe("useResizablePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts at the CSS default (null) with no stored width", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    expect(result.current.width).toBeNull();
    expect(result.current.isResizing).toBe(false);
  });

  it("restores a stored width, clamped to the viewport", () => {
    localStorage.setItem("kim:testWidth", String(MAX + 500));
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    expect(result.current.width).toBe(MAX);
  });

  it("ignores a malformed stored value", () => {
    localStorage.setItem("kim:testWidth", "bogus");
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    expect(result.current.width).toBeNull();
  });

  it("tracks the pointer while dragging and clamps to min/max", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onPointerDown(pointerDownEvent()));
    expect(result.current.isResizing).toBe(true);

    fireEvent.pointerMove(window, { clientX: VIEWPORT - 700 });
    expect(result.current.width).toBe(700);

    fireEvent.pointerMove(window, { clientX: 10 }); // too wide → clamped to the max
    expect(result.current.width).toBe(MAX);

    fireEvent.pointerMove(window, { clientX: VIEWPORT - 100 }); // too narrow → clamped to the min
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);

    fireEvent.pointerUp(window);
    expect(result.current.isResizing).toBe(false);
    // The settled width is persisted
    expect(Number(localStorage.getItem("kim:testWidth"))).toBe(MIN_PANEL_WIDTH);
  });

  it("pointercancel ends the drag, keeping the last width", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: VIEWPORT - 700 });
    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });

    expect(result.current.isResizing).toBe(false);
    expect(result.current.width).toBe(700);
  });

  it("arrow keys nudge the width, falling back to the default when unset", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onKeyDown(keyEvent("ArrowRight")));
    expect(result.current.width).toBe(DEFAULT_PANEL_WIDTH + 16);

    act(() => result.current.onKeyDown(keyEvent("ArrowLeft")));
    act(() => result.current.onKeyDown(keyEvent("ArrowLeft")));
    expect(result.current.width).toBe(DEFAULT_PANEL_WIDTH - 16);
  });

  it("Home and End jump to the min and max widths", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onKeyDown(keyEvent("Home")));
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);

    act(() => result.current.onKeyDown(keyEvent("End")));
    expect(result.current.width).toBe(MAX);
  });

  it("double-click resets to the default and clears the stored width", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: VIEWPORT - 700 });
    fireEvent.pointerUp(window);
    expect(localStorage.getItem("kim:testWidth")).toBe("700");

    act(() => result.current.onDoubleClick());
    expect(result.current.width).toBeNull();
    expect(localStorage.getItem("kim:testWidth")).toBeNull();
  });

  /* ── Parking ────────────────────────────────────────────── */

  it("arms past the min edge only beyond the grace, and parks on release keeping the pre-park width", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);

    act(() => result.current.onPointerDown(pointerDownEvent()));
    expect(result.current.collapseArmed).toBe(false);

    // Past the min edge but inside the 16px grace — not armed yet
    fireEvent.pointerMove(window, { clientX: xPastMin(8) });
    expect(result.current.collapseArmed).toBe(false);
    // The width stays clamped at the min while below the edge
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);

    // Beyond the grace — armed
    fireEvent.pointerMove(window, { clientX: xPastMin(24) });
    expect(result.current.collapseArmed).toBe(true);
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);

    fireEvent.pointerUp(window, { clientX: xPastMin(24) });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.isResizing).toBe(false);
    expect(result.current.collapseArmed).toBe(false);
    // The pre-gesture width is kept (for restore and for persistence)
    expect(result.current.width).toBe(700);
    expect(localStorage.getItem("kim:testWidth")).toBe("700");
  });

  it("does not park when released at the clamp or inside the grace", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: xPastMin(8) });
    fireEvent.pointerUp(window, { clientX: xPastMin(8) });

    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);
  });

  it("pointercancel never parks, even when armed", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: xPastMin(24) });
    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });

    expect(result.current.collapsed).toBe(false);
    expect(result.current.isResizing).toBe(false);
    expect(result.current.width).toBe(MIN_PANEL_WIDTH);
  });

  it("double-click while parked restores the pre-park width", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);
    park(result);
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.onDoubleClick());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(700);
  });

  it("an expanding arrow key (or End) while parked restores the panel", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);
    park(result);
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.onKeyDown(keyEvent("ArrowLeft"))); // a no-op while parked
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.onKeyDown(keyEvent("ArrowRight")));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(700);
  });

  it("dragging from the rail pulls the panel back open", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);
    park(result);
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.onPointerDown(pointerDownEvent()));
    // Still over the rail — stays parked
    fireEvent.pointerMove(window, { clientX: VIEWPORT - PARKED_PANEL_WIDTH + 10 });
    expect(result.current.collapsed).toBe(true);
    // Pulled out past the rail — opens and follows the pointer
    fireEvent.pointerMove(window, { clientX: VIEWPORT - 500 });
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(500);
    fireEvent.pointerUp(window, { clientX: VIEWPORT - 500 });
    expect(result.current.width).toBe(500);
  });

  it("a rail drag that re-parks keeps the width the drag opened to", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    resizeTo(result, 700);
    park(result);

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: VIEWPORT - 450 }); // open to 450
    fireEvent.pointerMove(window, { clientX: xPastMin(24) }); // …and pull past the min
    expect(result.current.collapseArmed).toBe(true);
    fireEvent.pointerUp(window, { clientX: xPastMin(24) });

    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(450);
  });

  it("park() keeps the current width and expand() restores it", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));

    act(() => result.current.onPointerDown(pointerDownEvent()));
    fireEvent.pointerMove(window, { clientX: VIEWPORT - 640 });
    fireEvent.pointerUp(window, { clientX: VIEWPORT - 640 });
    expect(result.current.width).toBe(640);

    act(() => result.current.park());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(640);

    act(() => result.current.expand());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(640);
  });

  it("parking at the default width (never dragged) restores to the default", () => {
    const { result } = renderHook(() => useResizablePanel("kim:testWidth"));
    expect(result.current.width).toBeNull();

    act(() => result.current.park());
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.expand());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBeNull();
  });
});
