import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import type { FamilyWishListResponse, User } from "../types";
import FamilyWishList from "./FamilyWishList";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockWishList: FamilyWishListResponse = {
  display_id: "0-1",
  bio: null,
  family_wish: "A warm winter for everyone.",
  people: [{ given_name: "Alex", title: null, age: 8, note: null, wishes: [] }],
  claimed_by_current_user: false,
  claim_status: null,
  claim_id: null,
};

const mockUser: User = {
  id: 7,
  email: "donor@example.com",
  role: "donor",
  display_name: "Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * Renders the page inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = (user: User | null = null) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={["/families/1/wish-list"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FamilyWishList />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests — header behaviour                                            */
/* ------------------------------------------------------------------ */

describe("FamilyWishList header", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("title links to /families and shows sign in link when logged out", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    });
    // Guests must not be sent to the protected dashboard via the title
    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/families");
    // Back link returns to the family list
    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute("href", "/families");
  });

  it("title links to /dashboard and shows display name when logged in", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap(mockUser);

    await waitFor(() => {
      expect(screen.getByText("Donor")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });
});
