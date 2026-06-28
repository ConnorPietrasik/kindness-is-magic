/**
 * Admin — Manage Referrers
 *
 * List, create, edit, delete referrers.
 * Uses useCrudManager for data fetching and mutations.
 */

import { useState, useEffect } from 'react';
import {
  adminListReferrers,
  adminGetReferrer,
  adminCreateReferrer,
  adminUpdateReferrer,
  adminDeleteReferrer,
} from '../lib/api';
import { useCrudManager } from '../hooks/useCrudManager';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { PageSpinner, Spinner } from '../components/Spinner';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MutationErrors } from '../components/MutationErrors';
import { defaultReferrerForm } from '../components/defaults';

const REFERRER_KEYS = ['adminReferrers'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrers() {
  const {
    listData,
    listLoading,
    detail,
    detailLoading,
    createMut,
    updateMut,
    deleteMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: REFERRER_KEYS,
    listFn: adminListReferrers,
    detailFn: adminGetReferrer,
    createFn: adminCreateReferrer,
    updateFn: adminUpdateReferrer,
    deleteFn: adminDeleteReferrer,
  });

  function handleCreate(formData) {
    createMut.mutate(formData);
  }

  function handleUpdate(formData) {
    if (!editingId) return;
    updateMut.mutate({ id: editingId, data: formData });
  }

  if (listLoading) return <PageSpinner />;

  const referrers = listData?.referrers ?? [];

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
          <Button onClick={openCreate}>
            + Add Referrer
          </Button>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <Spinner size="sm" />
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <ReferrerForm
            title={editingId ? 'Edit Referrer' : 'Add Referrer'}
            initial={editingId ? (detail ?? defaultReferrerForm) : defaultReferrerForm}
            isEdit={!!editingId}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
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
                  <Td>{r.name}</Td>
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

        {/* Delete confirmation */}
        <ConfirmDialog
          open={deleteConfirm !== null}
          title={
            <>
              Delete referrer <strong>#{deleteConfirm}</strong>?
            </>
          }
          description="Families will be reassigned to orphan. Linked users will be detached."
          onConfirm={() => {
            deleteMut.mutate(deleteConfirm);
            cancelDelete();
          }}
          onCancel={cancelDelete}
          loading={deleteMut.isPending}
        />

        {/* Errors */}
        <MutationErrors mutations={[createMut, updateMut, deleteMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerForm sub-component (inline — not shared per spec)           */
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
        onSubmit(form);
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
