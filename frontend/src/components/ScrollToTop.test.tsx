import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "./ScrollToTop";

const PageA = () => (
  <div>
    <p>Page A</p>
    <Link to="/b">Go to B</Link>
    <Link to="/a?filter=1">Filter A</Link>
  </div>
);

const PageB = () => (
  <div>
    <p>Page B</p>
    <Link to="/b#section">Go to B section</Link>
    <Link to="/a">Back to A</Link>
  </div>
);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ScrollToTop />
      <Routes>
        <Route path="/a" element={<PageA />} />
        <Route path="/b" element={<PageB />} />
      </Routes>
    </MemoryRouter>
  );

describe("ScrollToTop", () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    vi.stubGlobal("scrollTo", scrollToSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not scroll on the initial mount (a refresh keeps its restored position)", () => {
    renderAt("/a");

    expect(screen.getByText("Page A")).toBeInTheDocument();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("scrolls to the top on every route change, but not on hash-only or search-only changes", async () => {
    const user = userEvent.setup();
    renderAt("/a");

    await user.click(screen.getByRole("link", { name: "Go to B" }));
    expect(screen.getByText("Page B")).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });

    // A hash-only change is a section jump the destination page owns.
    await user.click(screen.getByRole("link", { name: "Go to B section" }));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    // Coming back is another route change.
    await user.click(screen.getByRole("link", { name: "Back to A" }));
    expect(screen.getByText("Page A")).toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when only the search params change (filters)", async () => {
    const user = userEvent.setup();
    renderAt("/a");

    await user.click(screen.getByRole("link", { name: "Filter A" }));

    expect(screen.getByText("Page A")).toBeInTheDocument();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
