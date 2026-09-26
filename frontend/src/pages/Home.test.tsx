import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CONTACT_EMAIL, DONATE_URL, FACEBOOK_URL, INSTAGRAM_URL } from "../lib/links";
import { auth } from "../lib/queryKeys";
import type { User } from "../types";
import Home from "./Home";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockUser: User = {
  id: 7,
  email: "donor@example.com",
  role: "donor",
  display_name: "Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

/**
 * Exposes the current router hash for assertions — MemoryRouter never
 * touches window.location, so the URL bar can't be read from outside.
 */
function HashProbe() {
  const location = useLocation();
  return <div data-testid="hash-probe" data-hash={location.hash} />;
}

/**
 * Renders the page inside router + query + auth providers, with a HashProbe
 * alongside for asserting the current router hash.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = (user: User | null = null, path = "/home") => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Home />
          <HashProbe />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("Home", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { scrollY?: number }).scrollY;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    cleanup();
  });

  /** jsdom has no layout, so scrollIntoView is undefined — stub it (deleted in afterEach). */
  const stubScrollIntoView = () => {
    const mock = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: mock, writable: true, configurable: true });
    return mock;
  };

  /** jsdom has no layout, so scrollY is always 0 — shadow it (deleted in afterEach). */
  const setScrollY = (value: number) => {
    Object.defineProperty(window, "scrollY", { value, configurable: true });
  };

  it("renders a hero heading", () => {
    wrap();

    // Assert by role, not text — the copy may change
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders how-it-works, founder, and mission sections", () => {
    wrap();

    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meet the founder" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Our mission" })).toBeInTheDocument();
  });

  it("the sponsor-family CTAs link to the browse page", () => {
    wrap();

    // Hero CTA and closing-band CTA both point at the browse page
    const links = screen.getAllByRole("link", { name: "Choose a family to sponsor" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    links.forEach((link) => expect(link).toHaveAttribute("href", "/families"));
  });

  it("the hero's second CTA is the generic external donate link", () => {
    wrap();

    // Hero and closing band carry the donate CTA (the footer's is asserted separately)
    const links = screen.getAllByRole("link", { name: "Donate" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    links.forEach((link) => {
      expect(link).toHaveAttribute("href", DONATE_URL);
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("shows legal, donate, social, and contact links with exact hrefs in the footer", () => {
    wrap();

    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Financials" })).toHaveAttribute("href", "/financials");

    const donate = within(footer).getByRole("link", { name: "Donate" });
    expect(donate).toHaveAttribute("href", DONATE_URL);
    expect(donate).toHaveAttribute("target", "_blank");

    const instagram = within(footer).getByRole("link", { name: "Instagram" });
    expect(instagram).toHaveAttribute("href", INSTAGRAM_URL);
    expect(instagram).toHaveAttribute("target", "_blank");

    const facebook = within(footer).getByRole("link", { name: "Facebook" });
    expect(facebook).toHaveAttribute("href", FACEBOOK_URL);
    expect(facebook).toHaveAttribute("target", "_blank");

    expect(within(footer).getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });

  it("shows a Dashboard link for signed-in visitors", () => {
    wrap(mockUser);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("scrolls to the section named by the URL hash", () => {
    const scrollIntoView = stubScrollIntoView();

    wrap(null, "/home#how-it-works");

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not scroll when the URL has no hash", () => {
    const scrollIntoView = stubScrollIntoView();

    wrap();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("re-scrolls when the same section link is clicked again (same URL)", async () => {
    const event = userEvent.setup();
    const scrollIntoView = stubScrollIntoView();
    vi.stubGlobal("scrollTo", vi.fn());

    wrap(null, "/home#how-it-works");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Re-clicking the same section link in the header nav navigates to the
    // same URL; the location object still gets a new identity, so the
    // hash-scroll effect re-runs.
    const header = within(screen.getByRole("banner"));
    await event.click(header.getByRole("link", { name: "How it works" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("clears the section hash and scrolls to top when the title is clicked on /home", async () => {
    const event = userEvent.setup();
    stubScrollIntoView();
    const scrollToSpy = vi.fn();
    vi.stubGlobal("scrollTo", scrollToSpy);

    wrap(null, "/home#mission");
    expect(screen.getByTestId("hash-probe")).toHaveAttribute("data-hash", "#mission");

    await event.click(screen.getByRole("button", { name: "Kindness is Magic" }));

    expect(screen.getByTestId("hash-probe")).toHaveAttribute("data-hash", "");
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("shows a back-to-top button once scrolled past the threshold, and clicking it scrolls to the top", async () => {
    const event = userEvent.setup();
    const scrollToSpy = vi.fn();
    vi.stubGlobal("scrollTo", scrollToSpy);
    setScrollY(500);

    wrap();
    window.dispatchEvent(new Event("scroll"));

    await event.click(screen.getByRole("button", { name: "Back to top" }));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("does not show the back-to-top button while near the top of the page", () => {
    setScrollY(100);

    wrap();
    window.dispatchEvent(new Event("scroll"));

    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
  });
});
