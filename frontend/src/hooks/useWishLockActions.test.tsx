import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { useWishLockActions } from "./useWishLockActions";

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------
vi.mock("../lib/api", () => ({
  adminResetWishState: vi.fn(),
  adminApproveWishes: vi.fn(),
}));

const mockResetWishState = api.adminResetWishState as Mock;
const mockApproveWishes = api.adminApproveWishes as Mock;

const makeFamily = (id: number): Record<string, unknown> => ({ id, deleted_at: null });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let queryClient: QueryClient;

function wrap() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastContainer>{children}</ToastContainer>
    </QueryClientProvider>
  );
}

/**
 * Seed a query into the cache as FRESH (staleTime: Infinity) so that
 * `isStale()` flips only when the mutation invalidates it.
 */
async function seedFreshQuery(key: readonly string[], label: string) {
  queryClient.setQueryData(key, { label });
  await queryClient.prefetchQuery({ queryKey: key, queryFn: async () => ({ label }), staleTime: Infinity });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useWishLockActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (queryClient) queryClient.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("resetMut calls adminResetWishState with the family id", async () => {
    mockResetWishState.mockResolvedValue(makeFamily(1));

    const { result } = renderHook(() => useWishLockActions(), { wrapper: wrap() });

    await act(async () => {
      await result.current.resetMut.mutateAsync(1);
    });

    expect(mockResetWishState).toHaveBeenCalledWith(1);
  });

  it("fullyApproveMut calls adminApproveWishes with the family id", async () => {
    mockApproveWishes.mockResolvedValue(makeFamily(2));

    const { result } = renderHook(() => useWishLockActions(), { wrapper: wrap() });

    await act(async () => {
      await result.current.fullyApproveMut.mutateAsync(2);
    });

    expect(mockApproveWishes).toHaveBeenCalledWith(2);
  });

  it("reset success invalidates the base family-related caches", async () => {
    mockResetWishState.mockResolvedValue(makeFamily(1));

    const wrapper = wrap();
    await seedFreshQuery(["adminFamilies"], "families");
    await seedFreshQuery(["adminReviewQueue"], "queue");
    await seedFreshQuery(["adminPackingSlips"], "slips");
    await seedFreshQuery(["adminWishes"], "wishes");
    await seedFreshQuery(["unrelatedControl"], "control");

    const { result } = renderHook(() => useWishLockActions(), { wrapper });

    await act(async () => {
      await result.current.resetMut.mutateAsync(1);
    });

    expect(queryClient.getQueryState(["adminFamilies"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["adminReviewQueue"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["adminPackingSlips"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["adminWishes"])?.isInvalidated).toBe(true);
    // Unrelated caches are untouched
    expect(queryClient.getQueryState(["unrelatedControl"])?.isInvalidated).toBe(false);
  });

  it("fully approve also invalidates extra keys passed via options", async () => {
    mockApproveWishes.mockResolvedValue(makeFamily(2));

    const wrapper = wrap();
    await seedFreshQuery(["adminReferrerFamilies", "7"], "scoped");
    await seedFreshQuery(["unrelatedControl"], "control");

    const { result } = renderHook(() => useWishLockActions({ extraInvalidationKeys: [["adminReferrerFamilies", "7"]] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.fullyApproveMut.mutateAsync(2);
    });

    expect(queryClient.getQueryState(["adminReferrerFamilies", "7"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["unrelatedControl"])?.isInvalidated).toBe(false);
  });

  it("shows the reset toast on success", async () => {
    mockResetWishState.mockResolvedValue(makeFamily(1));

    const { result } = renderHook(() => useWishLockActions(), { wrapper: wrap() });

    await act(async () => {
      await result.current.resetMut.mutateAsync(1);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Wish lock reset — family can now edit their wishes");
    });
  });

  it("shows the fully-approve toast on success", async () => {
    mockApproveWishes.mockResolvedValue(makeFamily(2));

    const { result } = renderHook(() => useWishLockActions(), { wrapper: wrap() });

    await act(async () => {
      await result.current.fullyApproveMut.mutateAsync(2);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Family fully approved and visible to donors");
    });
  });

  it("does not invalidate or toast when a mutation fails", async () => {
    mockResetWishState.mockRejectedValue(new Error("boom"));

    const wrapper = wrap();
    await seedFreshQuery(["adminFamilies"], "families");

    const { result } = renderHook(() => useWishLockActions(), { wrapper });

    await act(async () => {
      await result.current.resetMut.mutateAsync(1).catch(() => undefined);
    });

    expect(queryClient.getQueryState(["adminFamilies"])?.isInvalidated).toBe(false);
    expect(document.body.textContent).not.toContain("Wish lock reset");
  });
});
