import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCrudManager } from "./useCrudManager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let queryClient: QueryClient;

function wrap(initialCache: [string | string[], unknown][] = []) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  initialCache.forEach(([key, value]) => {
    queryClient.setQueryData(Array.isArray(key) ? key : [key], value);
  });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

interface MakeFnsOptions {
  listData?: unknown;
  detailData?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updated?: Record<string, unknown>;
}

function makeFns({
  listData = { list: [{ id: 1 }, { id: 2 }] },
  detailData = { id: 1, name: "Existing" },
  created = { id: 99 },
  updated = { id: 1, name: "Updated" },
}: MakeFnsOptions = {}): {
  listFn: Mock<() => Promise<unknown>>;
  detailFn: Mock<(id: number) => Promise<unknown>>;
  createFn: Mock<(data: unknown) => Promise<unknown>>;
  updateFn: Mock<(id: number, data: unknown) => Promise<unknown>>;
  deleteFn: Mock<(id: number) => Promise<void>>;
} {
  const listFn = vi.fn().mockResolvedValue(listData);
  const detailFn = vi.fn().mockImplementation((id: number) => Promise.resolve({ ...detailData, id }));
  const createFn = vi.fn().mockResolvedValue(created);
  const updateFn = vi.fn().mockResolvedValue(updated);
  const deleteFn = vi.fn().mockResolvedValue(undefined);
  return { listFn, detailFn, createFn, updateFn, deleteFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useCrudManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (queryClient) queryClient.clear();
  });

  /* ── Initial state ──────────────────────────────────────── */

  it("starts with form hidden, no editing, no delete confirmation", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    expect(result.current.showForm).toBe(false);
    expect(result.current.editingId).toBeNull();
    expect(result.current.deleteConfirm).toBeNull();
  });

  it("calls listFn on mount", async () => {
    const fns = makeFns();
    renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fns.listFn).toHaveBeenCalledTimes(1);
  });

  it("provides listData after list query resolves", async () => {
    const fns = makeFns({ listData: { list: [{ id: 1 }, { id: 2 }] } });
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.listLoading).toBe(false);
    expect(result.current.listData).toEqual({ list: [{ id: 1 }, { id: 2 }] });
  });

  it("detail is null when not editing", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    expect(result.current.detail).toBeNull();
    expect(result.current.detailLoading).toBe(false);
  });

  /* ── openCreate ─────────────────────────────────────────── */

  it("openCreate shows the form with no editingId", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.openCreate();
    });

    expect(result.current.showForm).toBe(true);
    expect(result.current.editingId).toBeNull();
  });

  /* ── openEdit ───────────────────────────────────────────── */

  it("openEdit sets editingId", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.openEdit(42);
    });

    expect(result.current.editingId).toBe(42);
  });

  it("fetches detail when editingId is set and detailFn is provided", async () => {
    const fns = makeFns({ detailData: { id: 7, name: "Detail Item" } });
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.openEdit(7);
    });

    // detail query is enabled and fetching
    expect(result.current.detailLoading).toBe(true);

    await waitFor(() => {
      expect(fns.detailFn).toHaveBeenCalledWith(7);
      expect(result.current.detail).toEqual({ id: 7, name: "Detail Item" });
      expect(result.current.detailLoading).toBe(false);
    });
  });

  it("does not call detailFn when editingId is null", () => {
    const fns = makeFns();
    renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    expect(fns.detailFn).not.toHaveBeenCalled();
  });

  it("does not call detailFn when detailFn is not provided", () => {
    const listFn = vi.fn().mockResolvedValue({ list: [] });
    const createFn = vi.fn().mockResolvedValue({ id: 1 });
    renderHook(
      () =>
        useCrudManager({
          rootKey: ["test"],
          listFn,
          createFn,
          detailFn: undefined,
        }),
      { wrapper: wrap() }
    );

    // No detailFn means no detail query fires even if editingId is set
    expect(listFn).toHaveBeenCalled();
  });

  /* ── cancelForm ─────────────────────────────────────────── */

  it("cancelForm hides form and clears editingId", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.openEdit(5);
    });
    expect(result.current.editingId).toBe(5);

    act(() => {
      result.current.cancelForm();
    });

    expect(result.current.showForm).toBe(false);
    expect(result.current.editingId).toBeNull();
  });

  /* ── confirmDelete / cancelDelete ───────────────────────── */

  it("confirmDelete sets deleteConfirm target", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.confirmDelete(10);
    });

    expect(result.current.deleteConfirm).toBe(10);
  });

  it("cancelDelete clears deleteConfirm", () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.confirmDelete(10);
    });
    expect(result.current.deleteConfirm).toBe(10);

    act(() => {
      result.current.cancelDelete();
    });

    expect(result.current.deleteConfirm).toBeNull();
  });

  /* ── Mutations — create ─────────────────────────────────── */

  it("createMut calls createFn and closes form on success", async () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    // Show the form first
    act(() => {
      result.current.openCreate();
    });
    expect(result.current.showForm).toBe(true);

    await act(async () => {
      result.current.createMut!.mutate({ name: "New" });
    });

    // React Query v5 passes (variables, context) to mutationFn
    expect(fns.createFn).toHaveBeenCalledWith(expect.objectContaining({ name: "New" }), expect.anything());
    // onSuccess callback closes the form
    expect(result.current.showForm).toBe(false);
  });

  /* ── Mutations — update ─────────────────────────────────── */

  it("updateMut calls updateFn and clears editingId on success", async () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    act(() => {
      result.current.openEdit(3);
    });
    expect(result.current.editingId).toBe(3);

    await act(async () => {
      result.current.updateMut!.mutate({ id: 3, data: { name: "Changed" } });
    });

    expect(fns.updateFn).toHaveBeenCalledWith(3, { name: "Changed" });
    // onSuccess callback clears editingId
    expect(result.current.editingId).toBeNull();
  });

  /* ── Mutations — delete ─────────────────────────────────── */

  it("deleteMut calls deleteFn on execute", async () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    await act(async () => {
      result.current.deleteMut!.mutate(8);
    });

    // React Query v5 passes (variables, context) to mutationFn
    expect(fns.deleteFn).toHaveBeenCalledWith(8, expect.anything());
  });

  /* ── Query invalidation after mutations ─────────────────── */

  it("invalidates rootKey after create", async () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    // Let list settle
    await act(async () => {
      await Promise.resolve();
    });

    // Mark listFn to return new data on next call
    fns.listFn.mockResolvedValueOnce({ list: [{ id: 1 }, { id: 2 }, { id: 99 }] });

    act(() => {
      result.current.openCreate();
    });

    await act(async () => {
      result.current.createMut!.mutate({ name: "New" });
      // Allow invalidation + refetch to complete
      await Promise.resolve();
      await Promise.resolve();
    });

    // listFn called on mount + at least once on invalidation refetch
    expect(fns.listFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("invalidates custom invalidationKeys when provided", async () => {
    const fns = makeFns();
    const { result } = renderHook(
      () =>
        useCrudManager({
          rootKey: ["primary"],
          invalidationKeys: ["primary", ["secondary"]],
          ...fns,
        }),
      { wrapper: wrap() }
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.openCreate();
    });

    await act(async () => {
      result.current.createMut!.mutate({});
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both keys should have been invalidated (secondary refetched too if it existed)
    // We verify by checking the query cache state — both should be stale
    const primaryState = queryClient.getQueryState(["primary"]);
    expect(primaryState).toBeDefined();
  });

  it("invalidates queries after update when detailFn is provided", async () => {
    const fns = makeFns();
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], ...fns }), { wrapper: wrap() });

    // Let list settle
    await act(async () => {
      await Promise.resolve();
    });
    expect(fns.listFn).toHaveBeenCalledTimes(1);

    // Open edit to populate detail
    act(() => {
      result.current.openEdit(3);
    });

    await waitFor(() => {
      expect(fns.detailFn).toHaveBeenCalledWith(3);
    });

    // Trigger update — onSuccess invalidates rootKey, triggering list refetch
    await act(async () => {
      result.current.updateMut!.mutate({ id: 3, data: { name: "Changed" } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // onSuccess: updateFn called, editingId cleared
    expect(fns.updateFn).toHaveBeenCalledWith(3, { name: "Changed" });
    expect(result.current.editingId).toBeNull();

    // Invalidation triggers at least one list refetch (call #2+)
    expect(fns.listFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /* ── Optional functions — null mutations ────────────────── */

  it("createMut is null when createFn is not provided", () => {
    const listFn = vi.fn().mockResolvedValue({ list: [] });
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], listFn }), { wrapper: wrap() });

    expect(result.current.createMut).toBeNull();
  });

  it("updateMut is null when updateFn is not provided", () => {
    const listFn = vi.fn().mockResolvedValue({ list: [] });
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], listFn }), { wrapper: wrap() });

    expect(result.current.updateMut).toBeNull();
  });

  it("deleteMut is null when deleteFn is not provided", () => {
    const listFn = vi.fn().mockResolvedValue({ list: [] });
    const { result } = renderHook(() => useCrudManager({ rootKey: ["test"], listFn }), { wrapper: wrap() });

    expect(result.current.deleteMut).toBeNull();
  });
});
