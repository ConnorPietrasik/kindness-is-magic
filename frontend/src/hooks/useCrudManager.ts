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

import { useState } from 'react';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrudManagerOptions<ListResponse, Item> {
  /** Query key for the list (e.g. `['adminReferrers']`) */
  rootKey: string[];
  /** Fetches the full list response */
  listFn: () => Promise<ListResponse>;
  /** Fetches a single item by id (optional, for edit-by-id) */
  detailFn?: (id: number) => Promise<Item>;
  /** Creates a new item */
  createFn?: (data: unknown) => Promise<Item>;
  /** Updates an existing item */
  updateFn?: (id: number, data: unknown) => Promise<Item>;
  /** Deletes an item by id */
  deleteFn?: (id: number) => Promise<void>;
  /** Keys to invalidate after mutations (defaults to `[rootKey]`) */
  invalidationKeys?: (string | string[])[];
}

export interface CrudManagerReturn<ListResponse, Item> {
  // Query data
  listData: UseQueryResult<ListResponse>['data'];
  listLoading: boolean;
  detail: Item | null;
  detailLoading: boolean;
  // Mutations
  createMut: UseMutationResult<Item, Error, unknown> | null;
  updateMut: UseMutationResult<Item, Error, { id: number; data: unknown }> | null;
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

export function useCrudManager<ListResponse, Item>(
  options: CrudManagerOptions<ListResponse, Item>,
): CrudManagerReturn<ListResponse, Item> {
  const {
    rootKey,
    listFn,
    detailFn,
    createFn,
    updateFn,
    deleteFn,
    invalidationKeys = [rootKey],
  } = options;

  const queryClient = useQueryClient();

  /* ── List query ─────────────────────────────────────────── */
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: rootKey,
    queryFn: listFn,
  });

  /* ── UI state ───────────────────────────────────────────── */
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  /* ── Detail query (for edit-by-id) ──────────────────────── */
  const detailQuery = useQuery({
    queryKey: [...rootKey, 'detail', editingId],
    queryFn: () => (editingId != null ? detailFn!(editingId) : Promise.reject(new Error('No editingId'))),
    enabled: editingId != null && detailFn != null,
  });
  const detail: Item | null = detailQuery.data ?? null;
  const detailLoading = editingId != null && detailFn != null && detailQuery.isLoading;

  /* ── Mutations ──────────────────────────────────────────── */
  const createMut = createFn
    ? useMutation({
        mutationFn: createFn as (variables: unknown) => Promise<Item>,
        onSuccess: () => {
          invalidationKeys.forEach((k) =>
            queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }),
          );
          setShowForm(false);
        },
      })
    : null;

  const updateMut = updateFn
    ? useMutation({
        mutationFn: ({ id, data }: { id: number; data: unknown }) => updateFn(id, data),
        onSuccess: () => {
          invalidationKeys.forEach((k) =>
            queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }),
          );
          if (detailFn) {
            queryClient.invalidateQueries({ queryKey: [...rootKey, 'detail'] });
          }
          setEditingId(null);
        },
      })
    : null;

  const deleteMut = deleteFn
    ? useMutation({
        mutationFn: deleteFn as (variables: number) => Promise<void>,
        onSuccess: () => {
          invalidationKeys.forEach((k) =>
            queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }),
          );
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
