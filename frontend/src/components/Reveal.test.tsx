import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./Reveal";

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

interface MockObserver {
  callback: (entries: Array<{ isIntersecting: boolean }>) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/** jsdom has no IntersectionObserver — install a controllable stand-in. */
const installIntersectionObserver = () => {
  const observers: MockObserver[] = [];
  class MockIntersectionObserver {
    readonly callback: MockObserver["callback"];
    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    constructor(callback: MockObserver["callback"]) {
      this.callback = callback;
      observers.push({ callback, observe: this.observe, disconnect: this.disconnect });
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  return observers;
};

/** jsdom has no matchMedia — stub it (reduced: whether the preference matches). */
const stubMatchMedia = (reduced: boolean) => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduced }));
};

/** The Reveal wrapper is the text element's parent (render children as an element, not a bare string). */
const wrapperOf = () => screen.getByText("content").parentElement as HTMLElement;

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("Reveal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("starts hidden, then fades in once when it enters the viewport", () => {
    stubMatchMedia(false);
    const observers = installIntersectionObserver();

    render(
      <Reveal>
        <span>content</span>
      </Reveal>
    );

    expect(wrapperOf()).toHaveClass("opacity-0", "translate-y-4");
    expect(observers).toHaveLength(1);
    const observer = observers[0]!;
    expect(observer.observe).toHaveBeenCalledTimes(1);

    act(() => {
      observer.callback([{ isIntersecting: true }]);
    });

    expect(wrapperOf()).toHaveClass("opacity-100", "translate-y-0");
    // Disconnect runs in the callback and again in the effect cleanup when
    // `shown` flips — both harmless, so assert at least one.
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("stays hidden while the element is not intersecting", () => {
    stubMatchMedia(false);
    const observers = installIntersectionObserver();

    render(
      <Reveal>
        <span>content</span>
      </Reveal>
    );

    const observer = observers[0]!;
    act(() => {
      observer.callback([{ isIntersecting: false }]);
    });

    expect(wrapperOf()).toHaveClass("opacity-0", "translate-y-4");
    expect(observer.disconnect).not.toHaveBeenCalled();
  });

  it("renders visible immediately and observes nothing when reduced motion is preferred", () => {
    stubMatchMedia(true);
    const observers = installIntersectionObserver();

    render(
      <Reveal>
        <span>content</span>
      </Reveal>
    );

    expect(wrapperOf()).toHaveClass("opacity-100", "translate-y-0");
    expect(observers).toHaveLength(0);
  });

  it("renders visible immediately when IntersectionObserver is unavailable", () => {
    // No observer stub installed: canReveal bails out before it needs matchMedia.
    render(
      <Reveal>
        <span>content</span>
      </Reveal>
    );

    expect(wrapperOf()).toHaveClass("opacity-100", "translate-y-0");
  });

  it("merges the className prop onto the wrapper", () => {
    stubMatchMedia(false);
    installIntersectionObserver();

    render(
      <Reveal className="mx-auto max-w-3xl">
        <span>content</span>
      </Reveal>
    );

    expect(wrapperOf()).toHaveClass("mx-auto", "max-w-3xl");
  });
});
