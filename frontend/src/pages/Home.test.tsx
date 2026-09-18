import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
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
 * Renders the page inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = (user: User | null = null) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Home />
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
    cleanup();
  });

  it("renders a hero heading", () => {
    wrap();

    // Assert by role, not text — the copy may change
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders how-it-works and mission sections", () => {
    wrap();

    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why it matters" })).toBeInTheDocument();
  });

  it("Meet the Families links to the browse page", () => {
    wrap();

    // Hero CTA and closing-band CTA both point at the browse page
    const links = screen.getAllByRole("link", { name: "Meet the Families" });
    expect(links.length).toBeGreaterThanOrEqual(1);
    links.forEach((link) => expect(link).toHaveAttribute("href", "/families"));
  });

  it("shows legal, donate, social, and contact links with exact hrefs in the footer", () => {
    wrap();

    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "CA Privacy Notice" })).toHaveAttribute("href", "/privacy-california");
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
});
