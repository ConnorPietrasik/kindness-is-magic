/**
 * useCrudManager — custom hook that encapsulates the repeated CRUD pattern
 * used across admin, referrer, and family management pages.
 *
 * Handles:
 *  - List query (fetch all items)
 *  - Optional detail query (fetch single item by id, for editing)
 *  - Create, update, delete mutations with automatic query invalidation
 *  - UI state: showForm, editingId, deleteConfirm
 *  - Fetch-failure feedback: toasts list/detail fetch errors so a failure
 *    never renders as a silent empty state or a vanished edit row
 */

import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext";
import { formatApiError } from "../lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrudManagerOptions<ListResponse, Item, Payload = unknown, ListParams = Record<string, unknown>> {
  /** Query key for the list (e.g. `['adminReferrers']`) */
  rootKey: readonly string[];
  /** Fetches the full list response. Receives `listParams` if provided. */
  listFn: (params?: ListParams) => Promise<ListResponse>;
  /** Optional params passed to `listFn` and included in the query key for cache separation. */
  listParams?: ListParams;
  /** Fetches a single item by id (optional, for edit-by-id) */
  detailFn?: (id: number) => Promise<Item>;
  /** Creates a new item */
  createFn?: (data: Payload) => Promise<Item>;
  /** Updates an existing item */
  updateFn?: (id: number, data: Payload) => Promise<Item>;
  /** Deletes an item by id */
  deleteFn?: (id: number) => Promise<void>;
  /** Restores a soft-deleted item by id (optional) */
  restoreFn?: (id: number) => Promise<Item>;
  /** Keys to invalidate after mutations (defaults to `[rootKey]`) */
  invalidationKeys?: (string | readonly string[])[];
  /** Entity name for success toast messages (e.g. "Referrer", "Family"). Omit to disable success toasts. */
  entityName?: string;
}

export interface CrudManagerReturn<ListResponse, Item, Payload = unknown> {
  // Query data
  listData: UseQueryResult<ListResponse>["data"];
  listLoading: boolean;
  detail: Item | null;
  detailLoading: boolean;
  // Capability flags — true when the corresponding fn was provided
  hasCreate: boolean;
  hasUpdate: boolean;
  hasDelete: boolean;
  hasRestore: boolean;
  // Mutations (always created to satisfy Rules of Hooks; no-op when fn not provided)
  createMut: UseMutationResult<Item, Error, Payload>;
  updateMut: UseMutationResult<Item, Error, { id: number; data: Payload }>;
  deleteMut: UseMutationResult<void, Error, number>;
  restoreMut: UseMutationResult<Item, Error, number>;
  // UI state
  showForm: boolean;
  editingId: number | null;
  deleteConfirm: number | null;
  // Actions
  openCreate: () => void;
  openEdit: (id: number) => void;
  cancelForm: () => void;
  confirmDelete: (id: number) => void;
  cancelDelete: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCrudManager<ListResponse, Item, Payload = unknown, ListParams = Record<string, unknown>>(
  options: CrudManagerOptions<ListResponse, Item, Payload, ListParams>
): CrudManagerReturn<ListResponse, Item, Payload> {
  const {
    rootKey,
    listFn,
    listParams,
    detailFn,
    createFn,
    updateFn,
    deleteFn,
    restoreFn,
    invalidationKeys = [rootKey],
    entityName,
  } = options;

  const queryClient = useQueryClient();
  const toast = useToast();

  /* ── List query ─────────────────────────────────────────── */
  const listQueryKey = listParams != null ? [...rootKey, listParams] : rootKey;
  const {
    data: listData,
    isLoading: listLoading,
    isError: listIsError,
    isFetching: listIsFetching,
    error: listError,
  } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listFn(listParams),
  });

  /* ── UI state ───────────────────────────────────────────── */
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  /* ── Detail query (for edit-by-id) ──────────────────────── */
  const detailQuery = useQuery({
    queryKey: [...rootKey, "detail", editingId],
    queryFn: () => (editingId != null ? detailFn!(editingId) : Promise.reject(new Error("No editingId"))),
    enabled: editingId != null && detailFn != null,
  });
  const detail: Item | null = detailQuery.data ?? null;
  const detailLoading = editingId != null && detailFn != null && detailQuery.isLoading;

  /* ── Fetch-failure feedback ───────────────────────────────
     A failed detail fetch would otherwise silently drop the edit row
     back to the normal row, and a failed list fetch would render the
     misleading "empty" state. Toast both (once retries are exhausted);
     for the detail fetch also revert and drop the poisoned cache entry
     so clicking Edit again performs a fresh fetch. */
  useEffect(() => {
    if (detailQuery.isError && !detailQuery.isFetching) {
      toast.error(formatApiError(detailQuery.error, `Unable to load ${entityName ?? "record"}. Please try again.`));
      queryClient.removeQueries({ queryKey: [...rootKey, "detail", editingId] });
      setEditingId(null);
    }
  }, [detailQuery.isError, detailQuery.isFetching, detailQuery.error, editingId, entityName, queryClient, rootKey, toast]);

  useEffect(() => {
    if (listIsError && !listIsFetching) {
      toast.error(formatApiError(listError, "Unable to load data. Please try again."));
    }
  }, [listIsError, listIsFetching, listError, toast]);

  /* ── Mutations (always created to satisfy Rules of Hooks) ── */
  const createMut = useMutation({
    mutationFn: createFn ?? ((_data: Payload) => Promise.resolve(null as unknown as Item)),
    onSuccess: () => {
      if (!createFn) return;
      invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      setShowForm(false);
      if (entityName) toast.success(`${entityName} created`);
    },
  });

  const updateMut = useMutation({
    mutationFn: updateFn
      ? ({ id, data }: { id: number; data: Payload }) => updateFn!(id, data)
      : (_data: { id: number; data: Payload }) => Promise.resolve(null as unknown as Item),
    onSuccess: () => {
      if (!updateFn) return;
      invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      if (detailFn) {
        queryClient.invalidateQueries({ queryKey: [...rootKey, "detail"] });
      }
      setEditingId(null);
      if (entityName) toast.success(`${entityName} updated`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteFn ?? ((_data: number) => Promise.resolve()),
    onSuccess: () => {
      if (!deleteFn) return;
      invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      if (entityName) toast.success(`${entityName} deleted`);
    },
  });

  const restoreMut = useMutation({
    mutationFn: restoreFn ?? ((_data: number) => Promise.resolve(null as unknown as Item)),
    onSuccess: () => {
      if (!restoreFn) return;
      invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      if (entityName) toast.success(`${entityName} restored`);
    },
  });

  /* ── Actions ────────────────────────────────────────────── */
  function openCreate() {
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(id: number) {
    setEditingId(id);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function confirmDelete(id: number) {
    setDeleteConfirm(id);
  }

  function cancelDelete() {
    setDeleteConfirm(null);
  }

  return {
    // Query data
    listData,
    listLoading,
    detail,
    detailLoading,
    // Capability flags
    hasCreate: createFn != null,
    hasUpdate: updateFn != null,
    hasDelete: deleteFn != null,
    hasRestore: restoreFn != null,
    // Mutations
    createMut,
    updateMut,
    deleteMut,
    restoreMut,
    // UI state
    showForm,
    editingId,
    deleteConfirm,
    // Actions
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  };
}
