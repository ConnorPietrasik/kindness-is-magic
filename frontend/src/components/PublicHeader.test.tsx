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
}

/**
 * Renders the header inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = ({ user = null, left }: WrapOptions = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={["/home"]}>
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
    cleanup();
  });

  it("title links to /home when logged out", () => {
    wrap();

    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/home");
  });

  it("title links to /home when logged in", () => {
    wrap({ user: mockUser });

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
