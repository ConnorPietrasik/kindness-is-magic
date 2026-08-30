import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFamiliesDropdown, useReferrersDropdown, useUsersDropdown } from "./useDropdowns";

// ---------------------------------------------------------------------------
// Mock the API module and query keys
// ---------------------------------------------------------------------------
vi.mock("../lib/api", () => ({
  adminGetFamiliesDropdown: vi.fn(),
  adminGetReferrersDropdown: vi.fn(),
  adminGetUsersDropdown: vi.fn(),
}));

vi.mock("../lib/queryKeys", () => ({
  adminFamiliesDropdown: ["adminFamiliesDropdown"],
  adminReferrersDropdown: ["adminReferrersDropdown"],
  adminUsersDropdown: ["adminUsersDropdown"],
  adminUsersDropdownRoles: (roles: string) => ["adminUsersDropdown", roles],
}));

import { adminGetFamiliesDropdown, adminGetReferrersDropdown, adminGetUsersDropdown } from "../lib/api";

const mockReferrers = adminGetReferrersDropdown as Mock;
const mockFamilies = adminGetFamiliesDropdown as Mock;
const mockUsers = adminGetUsersDropdown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Each test gets a fresh QueryClient — no cross-test cache state to clear.
function wrap() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useReferrersDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches referrers on mount and builds the id → name map", async () => {
    mockReferrers.mockResolvedValue([
      { id: 1, name: "Referrer One" },
      { id: 2, name: "Referrer Two" },
    ]);

    const { result } = renderHook(() => useReferrersDropdown(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.referrersLoading).toBe(false);
    });

    expect(mockReferrers).toHaveBeenCalledTimes(1);
    expect(result.current.referrers).toHaveLength(2);
    expect(result.current.referrerMap).toEqual({ 1: "Referrer One", 2: "Referrer Two" });
  });

  it("returns empty array/map while loading", () => {
    mockReferrers.mockResolvedValue([]);

    const { result } = renderHook(() => useReferrersDropdown(), { wrapper: wrap() });

    expect(result.current.referrersLoading).toBe(true);
    expect(result.current.referrers).toEqual([]);
    expect(result.current.referrerMap).toEqual({});
  });

  it("does not refetch on re-renders (uses React Query cache)", async () => {
    mockReferrers.mockResolvedValue([{ id: 1, name: "Referrer One" }]);

    const { result, rerender } = renderHook(() => useReferrersDropdown(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.referrersLoading).toBe(false);
    });

    rerender();

    expect(mockReferrers).toHaveBeenCalledTimes(1);
  });
});

describe("useFamiliesDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches families on mount and builds the id → family_name map", async () => {
    mockFamilies.mockResolvedValue([
      { id: 5, family_name: "The Johnsons" },
      { id: 6, family_name: "The Smiths" },
    ]);

    const { result } = renderHook(() => useFamiliesDropdown(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.familiesLoading).toBe(false);
    });

    expect(mockFamilies).toHaveBeenCalledTimes(1);
    expect(result.current.families).toHaveLength(2);
    expect(result.current.familyMap).toEqual({ 5: "The Johnsons", 6: "The Smiths" });
  });
});

describe("useUsersDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches users with the given role filter and builds the id → display_name map", async () => {
    mockUsers.mockResolvedValue([{ id: 3, display_name: "Jane Admin" }]);

    const { result } = renderHook(() => useUsersDropdown("admin,purchaser"), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.usersLoading).toBe(false);
    });

    expect(mockUsers).toHaveBeenCalledWith("admin,purchaser");
    expect(result.current.users).toHaveLength(1);
    expect(result.current.userMap).toEqual({ 3: "Jane Admin" });
  });

  it("keeps caches separate per role filter", async () => {
    // Two role filters must not share a cache entry (regression: both previously
    // queried under the bare adminUsersDropdown key).
    mockUsers.mockImplementation((roles: string) =>
      roles === "delivery"
        ? Promise.resolve([{ id: 1, display_name: "Delivery Dan" }])
        : Promise.resolve([{ id: 2, display_name: "Purchaser Pat" }])
    );

    const { result: delivery, result: purchasers } = renderHook(
      () => ({ delivery: useUsersDropdown("delivery"), purchasers: useUsersDropdown("admin,purchaser") }),
      { wrapper: wrap() }
    );

    await waitFor(() => {
      expect(delivery.current.delivery.usersLoading).toBe(false);
      expect(purchasers.current.purchasers.usersLoading).toBe(false);
    });

    expect(mockUsers).toHaveBeenCalledTimes(2);
    expect(delivery.current.delivery.userMap).toEqual({ 1: "Delivery Dan" });
    expect(purchasers.current.purchasers.userMap).toEqual({ 2: "Purchaser Pat" });
  });
});
