/**
 * useCrudManager — custom hook that encapsulates the repeated CRUD pattern
 * used across admin, referrer, and family management pages.
 *
 * Handles:
 *  - List query (fetch all items)
 *  - Optional detail query (fetch single item by id, for editing)
 *  - Create, update, delete mutations with automatic query invalidation
 *  - UI state: showForm, editingId, deleteConfirm
 *
 * @param {object}   opts
 * @param {string[]} opts.rootKey          — query key for the list (e.g. ['adminReferrers'])
 * @param {function} opts.listFn           — () => Promise<{ list: [...] }>
 * @param {function} [opts.detailFn]       — (id) => Promise<item>  (optional, for edit-by-id)
 * @param {function} [opts.createFn]       — (data) => Promise<item>
 * @param {function} [opts.updateFn]       — (id, data) => Promise<item>
 * @param {function} [opts.deleteFn]       — (id) => Promise<void>
 * @param {string[]} [opts.invalidationKeys] — keys to invalidate after mutations
 *                                              (defaults to rootKey)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useCrudManager({
  rootKey,
  listFn,
  detailFn,
  createFn,
  updateFn,
  deleteFn,
  invalidationKeys = [rootKey],
}) {
  const queryClient = useQueryClient();

  /* ── List query ─────────────────────────────────────────── */
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: rootKey,
    queryFn: listFn,
  });

  /* ── UI state ───────────────────────────────────────────── */
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  /* ── Detail query (for edit-by-id) ──────────────────────── */
  const detailQuery = useQuery({
    queryKey: [...rootKey, 'detail', editingId],
    queryFn: () => detailFn(editingId),
    enabled: !!editingId && !!detailFn,
  });
  const detail = detailQuery.data ?? null;
  const detailLoading = !!editingId && !!detailFn && detailQuery.isLoading;

  /* ── Mutations ──────────────────────────────────────────── */
  const createMut = createFn
    ? useMutation({
        mutationFn: createFn,
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries(Array.isArray(k) ? k : [k]));
          setShowForm(false);
        },
      })
    : null;

  const updateMut = updateFn
    ? useMutation({
        mutationFn: ({ id, data }) => updateFn(id, data),
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries(Array.isArray(k) ? k : [k]));
          if (detailFn) {
            queryClient.invalidateQueries([...rootKey, 'detail']);
          }
          setEditingId(null);
        },
      })
    : null;

  const deleteMut = deleteFn
    ? useMutation({
        mutationFn: deleteFn,
        onSuccess: () => {
          invalidationKeys.forEach((k) => queryClient.invalidateQueries(Array.isArray(k) ? k : [k]));
        },
      })
    : null;

  /* ── Actions ────────────────────────────────────────────── */
  function openCreate() {
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(id) {
    setEditingId(id);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function confirmDelete(id) {
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
