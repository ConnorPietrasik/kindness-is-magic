import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "../lib/queryKeys";
import type { User } from "../types";
import { AuthProvider } from "./AuthContext";
import { CartProvider, useCart } from "./CartContext";

const mockDonor: User = {
  id: 4,
  email: "donor@example.com",
  role: "donor",
  display_name: "Alice Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

/** Pre-seed the auth query cache (staleTime: Infinity) so no /api/auth/me request happens. */
function setup(user: User | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return renderHook(() => useCart(), {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CartProvider>{children}</CartProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    ),
  });
}

describe("CartContext", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("persists items under the user's id and restores them on remount", () => {
    const { result } = setup(mockDonor);
    expect(result.current.items).toEqual([]);

    act(() => result.current.addToCart(5));
    act(() => result.current.addToCart(9));
    act(() => result.current.setGroceries(5, true));

    expect(result.current.items).toEqual([
      { family_id: 5, includes_groceries: true },
      { family_id: 9, includes_groceries: false },
    ]);
    // Keyed by the user id
    expect(JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]")).toEqual([
      { family_id: 5, includes_groceries: true },
      { family_id: 9, includes_groceries: false },
    ]);

    // A second hook for the same user sees the persisted cart
    const { result: second } = setup(mockDonor);
    expect(second.current.items).toEqual([
      { family_id: 5, includes_groceries: true },
      { family_id: 9, includes_groceries: false },
    ]);
  });

  it("addToCart is idempotent per family", () => {
    const { result } = setup(mockDonor);
    act(() => result.current.addToCart(5));
    act(() => result.current.addToCart(5));
    expect(result.current.items).toEqual([{ family_id: 5, includes_groceries: false }]);
  });

  it("removeFromCart and removeMany drop the right items", () => {
    const { result } = setup(mockDonor);
    act(() => result.current.addToCart(5));
    act(() => result.current.addToCart(9));

    act(() => result.current.removeFromCart(5));
    expect(result.current.items).toEqual([{ family_id: 9, includes_groceries: false }]);

    act(() => result.current.removeMany([9, 100])); // unknown ids are a no-op
    expect(result.current.items).toEqual([]);
  });

  it("keeps carts separate per user", () => {
    localStorage.setItem("kim:cart:55", JSON.stringify([{ family_id: 1, includes_groceries: false }]));

    const { result } = setup({ ...mockDonor, id: 55 });
    expect(result.current.items).toEqual([{ family_id: 1, includes_groceries: false }]);

    act(() => result.current.addToCart(2));
    // Only this user's storage is touched
    expect(JSON.parse(localStorage.getItem("kim:cart:55") ?? "[]")).toEqual([
      { family_id: 1, includes_groceries: false },
      { family_id: 2, includes_groceries: false },
    ]);
    expect(localStorage.getItem("kim:cart:4")).toBeNull();
  });

  it("ignores corrupt persisted carts", () => {
    localStorage.setItem("kim:cart:4", "not json {");
    const { result } = setup(mockDonor);
    expect(result.current.items).toEqual([]);
  });

  it("ignores malformed persisted entries (wrong types / duplicate families)", () => {
    localStorage.setItem(
      "kim:cart:4",
      JSON.stringify([
        { family_id: 5, includes_groceries: "yes" }, // wrong type
        { family_id: 9 }, // missing groceries
        "garbage",
        { family_id: 7, includes_groceries: false },
        { family_id: 7, includes_groceries: true }, // duplicate family
      ])
    );
    const { result } = setup(mockDonor);
    expect(result.current.items).toEqual([{ family_id: 7, includes_groceries: false }]);
  });

  it("empty cart for logged-out users", () => {
    localStorage.setItem("kim:cart:4", JSON.stringify([{ family_id: 5, includes_groceries: false }]));
    const { result } = setup(null);
    expect(result.current.items).toEqual([]);
  });
});
