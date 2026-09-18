import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import type { User } from "../types";
import { PublicHeader } from "./PublicHeader";

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

interface WrapOptions {
  user?: User | null;
  left?: React.ReactNode;
  path?: string;
}

/**
 * Renders the header inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = ({ user = null, left, path = "/home" }: WrapOptions = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PublicHeader left={left} />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("PublicHeader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("title is a button that scrolls to the top of the page on /home", async () => {
    const event = userEvent.setup();
    const scrollToSpy = vi.fn();
    vi.stubGlobal("scrollTo", scrollToSpy);

    wrap();

    await event.click(screen.getByRole("button", { name: "Kindness is Magic" }));

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("title links to /home when not on /home", () => {
    wrap({ path: "/families" });

    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/home");
  });

  it("shows a sign in link to /login when logged out", () => {
    wrap();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("shows a dashboard link and sign out button when logged in", () => {
    wrap({ user: mockUser });

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("renders the left slot", () => {
    wrap({ left: <Link to="/families">← Back</Link> });

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute("href", "/families");
  });

  it("clicking sign out logs out and navigates to login", async () => {
    const event = userEvent.setup();
    const logoutSpy = vi.spyOn(api, "logoutRequest").mockResolvedValue(undefined);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(auth, mockUser);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Routes>
              <Route path="/home" element={<PublicHeader />} />
              <Route path="/login" element={<div data-testid="login-page">Login page</div>} />
            </Routes>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    const signOutButton = await screen.findByRole("button", { name: "Sign out" });
    await event.click(signOutButton);

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
    expect(logoutSpy).toHaveBeenCalledOnce();
  });
});
