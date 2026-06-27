/**
 * Admin — Manage Referrers
 *
 * List, create, edit, delete referrers.
 * Uses React Query for data fetching and mutations.
 */

import { useState, useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adminListReferrers,
  adminGetReferrer,
  adminCreateReferrer,
  adminUpdateReferrer,
  adminDeleteReferrer,
} from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import { esc } from '../lib/utils';

const REFERRER_KEYS = ['adminReferrers'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrers() {
  const queryClient = useQueryClient();

  // List
  const { data, isLoading } = useQuery({
    queryKey: REFERRER_KEYS,
    queryFn: adminListReferrers,
  });

  // Detail for edit
  const [editingId, setEditingId] = useState(null);
  const detailQuery = useQuery({
    queryKey: ['adminReferrerDetail', editingId],
    queryFn: () => adminGetReferrer(editingId),
    enabled: !!editingId,
  });
  const { data: detail } = detailQuery;
  const detailLoading = !!editingId && detailQuery.isLoading;

  // Mutations
  const createMut = useMutation({
    mutationFn: adminCreateReferrer,
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_KEYS);
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => adminUpdateReferrer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_KEYS);
      queryClient.invalidateQueries(['adminReferrerDetail']);
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteReferrer,
    onSuccess: () => queryClient.invalidateQueries(REFERRER_KEYS),
  });

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    createMut.mutate(e.data);
  }

  function handleUpdate(e) {
    e.preventDefault();
    if (!editingId) return;
    updateMut.mutate({ id: editingId, data: e.data });
  }

  function openEdit(id) {
    setEditingId(id);
  }

  function confirmDelete(id) {
    setDeleteConfirm(id);
  }

  function executeDelete(id) {
    deleteMut.mutate(id);
    setDeleteConfirm(null);
  }

  if (isLoading) return <PageSpinner />;

  const referrers = data?.referrers ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink />}
      />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Referrers</h2>
          <Button onClick={() => { setEditingId(null); setShowForm(true); }}>
            + Add Referrer
          </Button>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <ReferrerForm
            title={editingId ? 'Edit Referrer' : 'Add Referrer'}
            initial={editingId ? (detail ?? defaultForm) : defaultForm}
            isEdit={!!editingId}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            loading={createMut.isPending || updateMut.isPending}
          />
        )}

        {/* Table */}
        {referrers.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No referrers yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Family Limit</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {referrers.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.id}</Td>
                  <Td>{esc(r.name)}</Td>
                  <Td>{r.family_limit}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(r.id)}
                        disabled={!!editingId}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(r.id)}
                        disabled={deleteMut.isPending}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Delete confirmation modal */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="w-[90%] max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <p className="mb-4">
                Delete referrer <strong>#{deleteConfirm}</strong>?
                <br />
                <span className="block text-xs text-gray-500">
                  Families will be reassigned to orphan. Linked users will be detached.
                </span>
              </p>
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => executeDelete(deleteConfirm)} loading={deleteMut.isPending}>
                  {deleteMut.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        <div className="mt-4 flex flex-col gap-2">
          {[createMut, updateMut, deleteMut].map((mut, i) =>
            mut.error ? (
              <ErrorBox
                key={i}
                message={
                  mut.error?.response?.data?.detail ||
                  mut.error?.response?.data?.msg ||
                  JSON.stringify(mut.error?.response?.data) ||
                  'Request failed.'
                }
              />
            ) : null
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerForm sub-component                                          */
/* ------------------------------------------------------------------ */
function ReferrerForm({ title, initial, isEdit, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField
            label="Name"
            fieldProps={{
              value: form.name,
              onChange: (e) => update('name', e.target.value),
              required: true,
              maxLength: 60,
            }}
          />
          <FormField
            label="Family Limit"
            type="number"
            fieldProps={{
              value: form.family_limit,
              onChange: (e) => update('family_limit', parseInt(e.target.value) || 1),
              required: true,
              min: 1,
              max: 999,
            }}
          />
          <FormField
            label="Phone"
            fieldProps={{
              value: form.phone_number,
              onChange: (e) => update('phone_number', e.target.value),
              required: true,
              maxLength: 20,
            }}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const defaultForm = { name: '', family_limit: 1, phone_number: '' };
