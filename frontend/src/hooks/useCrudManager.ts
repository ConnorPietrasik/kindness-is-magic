/**
 * useCrudManager — custom hook that encapsulates the repeated CRUD pattern
 * used across admin, referrer, and family management pages.
 *
 * Handles:
 *  - List query (fetch all items)
 *  - Optional detail query (fetch single item by id, for editing)
 *  - Create, update, delete mutations with automatic query invalidation
 *  - UI state: showForm, editingId, deleteConfirm
 */

import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrudManagerOptions<ListResponse, Item, Payload = unknown, ListParams = Record<string, unknown>> {
  /** Query key for the list (e.g. `['adminReferrers']`) */
  rootKey: string[];
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
  /** Keys to invalidate after mutations (defaults to `[rootKey]`) */
  invalidationKeys?: (string | string[])[];
}

export interface CrudManagerReturn<ListResponse, Item, Payload = unknown> {
  // Query data
  listData: UseQueryResult<ListResponse>["data"];
  listLoading: boolean;
  detail: Item | null;
  detailLoading: boolean;
  // Mutations
  createMut: UseMutationResult<Item, Error, Payload> | null;
  updateMut: UseMutationResult<Item, Error, { id: number; data: Payload }> | null;
  deleteMut: UseMutationResult<void, Error, number> | null;
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
  const { rootKey, listFn, listParams, detailFn, createFn, updateFn, deleteFn, invalidationKeys = [rootKey] } = options;

  const queryClient = useQueryClient();

  /* ── List query ─────────────────────────────────────────── */
  const listQueryKey = listParams != null ? [...rootKey, listParams] : rootKey;
  const { data: listData, isLoading: listLoading } = useQuery({
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

  /* ── Mutations ──────────────────────────────────────────── */
  const createMut = createFn
    ? useMutation({
        mutationFn: createFn,
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
          setShowForm(false);
        },
      })
    : null;

  const updateMut = updateFn
    ? useMutation({
        mutationFn: ({ id, data }: { id: number; data: Payload }) => updateFn(id, data),
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
          if (detailFn) {
            queryClient.invalidateQueries({ queryKey: [...rootKey, "detail"] });
          }
          setEditingId(null);
        },
      })
    : null;

  const deleteMut = deleteFn
    ? useMutation({
        mutationFn: deleteFn as (variables: number) => Promise<void>,
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
        },
      })
    : null;

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
    // Mutations
    createMut,
    updateMut,
    deleteMut,
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
