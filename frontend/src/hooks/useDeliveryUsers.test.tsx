import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeliveryUsers } from "./useDeliveryUsers";

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------
vi.mock("../lib/api", () => ({
  adminGetUsersDropdown: vi.fn(),
}));

vi.mock("../lib/queryKeys", () => ({
  adminUsersDropdown: ["adminUsersDropdown"],
}));

import { adminGetUsersDropdown } from "../lib/api";

const mockAdminGetUsersDropdown = adminGetUsersDropdown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let queryClient: QueryClient;

function wrap() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useDeliveryUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (queryClient) queryClient.clear();
  });

  it("fetches delivery users on mount", async () => {
    mockAdminGetUsersDropdown.mockResolvedValue([
      { id: 1, display_name: "Alice" },
      { id: 2, display_name: "Bob" },
    ]);

    renderHook(() => useDeliveryUsers(), { wrapper: wrap() });

    await waitFor(() => {
      expect(mockAdminGetUsersDropdown).toHaveBeenCalledWith("delivery");
    });
  });

  it("returns empty map while loading", () => {
    mockAdminGetUsersDropdown.mockResolvedValue([]);

    const { result } = renderHook(() => useDeliveryUsers(), { wrapper: wrap() });

    expect(result.current.deliveryUsersLoading).toBe(true);
    expect(result.current.deliveryUserMap).toEqual({});
  });

  it("builds a map of id → display_name after data loads", async () => {
    mockAdminGetUsersDropdown.mockResolvedValue([
      { id: 10, display_name: "Alice" },
      { id: 20, display_name: "Bob" },
    ]);

    const { result } = renderHook(() => useDeliveryUsers(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.deliveryUsersLoading).toBe(false);
    });

    expect(result.current.deliveryUserMap).toEqual({
      10: "Alice",
      20: "Bob",
    });
  });

  it("returns empty map when no delivery users exist", async () => {
    mockAdminGetUsersDropdown.mockResolvedValue([]);

    const { result } = renderHook(() => useDeliveryUsers(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.deliveryUsersLoading).toBe(false);
    });

    expect(result.current.deliveryUserMap).toEqual({});
  });

  it("does not refetch on re-renders (uses React Query cache)", async () => {
    mockAdminGetUsersDropdown.mockResolvedValue([{ id: 1, display_name: "Alice" }]);

    const { result, rerender } = renderHook(() => useDeliveryUsers(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.deliveryUsersLoading).toBe(false);
    });

    expect(mockAdminGetUsersDropdown).toHaveBeenCalledTimes(1);

    // Re-render the hook — should not trigger another API call
    rerender();

    expect(mockAdminGetUsersDropdown).toHaveBeenCalledTimes(1);
  });
});
