import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "./SiteFooter";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SiteFooter />
    </MemoryRouter>
  );

describe("SiteFooter", () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    vi.stubGlobal("scrollTo", scrollToSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("links to the brochure pages", () => {
    renderAt("/home");

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Financials" })).toHaveAttribute("href", "/financials");
    expect(within(footer).getByRole("link", { name: "Wish List Guide" })).toHaveAttribute("href", "/wish-list-guide");
    expect(within(footer).getByRole("link", { name: "Sponsor Guide" })).toHaveAttribute("href", "/help/donor");
  });

  it("scrolls to the top when a link to the current page is clicked (no route change to reset the scroll)", async () => {
    const user = userEvent.setup();
    renderAt("/help/donor");

    await user.click(screen.getByRole("link", { name: "Sponsor Guide" }));

    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("does not scroll when a link to a different page is clicked (the navigation resets the scroll instead)", async () => {
    const user = userEvent.setup();
    renderAt("/help/donor");

    await user.click(screen.getByRole("link", { name: "Home" }));

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
