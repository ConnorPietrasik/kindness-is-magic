/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Fetches referrers for dropdown and display.
 */

import { useState, useMemo, useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adminListFamilies,
  adminGetFamily,
  adminCreateFamily,
  adminUpdateFamily,
  adminDeleteFamily,
  adminListReferrers,
} from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import { esc } from '../lib/utils';

const FAMILY_KEYS = ['adminFamilies'];
const REFERRER_KEYS = ['adminReferrers'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const queryClient = useQueryClient();

  // Families list
  const { data, isLoading } = useQuery({
    queryKey: FAMILY_KEYS,
    queryFn: adminListFamilies,
  });

  // Referrers lookup (for dropdown + display)
  const { data: referrerData } = useQuery({
    queryKey: REFERRER_KEYS,
    queryFn: adminListReferrers,
  });

  const referrerMap = useMemo(() => {
    const map = {};
    (referrerData?.referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrerData]);

  // Detail for edit
  const [editingId, setEditingId] = useState(null);
  const detailQuery = useQuery({
    queryKey: ['adminFamilyDetail', editingId],
    queryFn: () => adminGetFamily(editingId),
    enabled: !!editingId,
  });
  const { data: detail } = detailQuery;
  const detailLoading = !!editingId && detailQuery.isLoading;

  // Mutations
  const createMut = useMutation({
    mutationFn: adminCreateFamily,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_KEYS);
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => adminUpdateFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_KEYS);
      queryClient.invalidateQueries(['adminFamilyDetail']);
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteFamily,
    onSuccess: () => queryClient.invalidateQueries(FAMILY_KEYS),
  });

  // UI state
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

  const families = data?.families ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink />}
      />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
          <Button onClick={() => { setEditingId(null); setShowForm(true); }}>
            + Add Family
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
          <FamilyForm
            title={editingId ? 'Edit Family' : 'Add Family'}
            initial={editingId ? (detail ?? defaultForm) : defaultForm}
            isEdit={!!editingId}
            referrerMap={referrerMap}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            loading={createMut.isPending || updateMut.isPending}
          />
        )}

        {/* Table */}
        {families.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Family Name</Th>
              <Th>Contact</Th>
              <Th>Referrer</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.id}</Td>
                  <Td>{esc(f.family_name)}</Td>
                  <Td>{esc(f.contact_name)}</Td>
                  <Td>{referrerMap[f.referrer_id] || `ID ${f.referrer_id}`}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(f.id)}
                        disabled={!!editingId}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(f.id)}
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
                Delete family <strong>#{deleteConfirm}</strong>?
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
/* FamilyForm sub-component                                            */
/* ------------------------------------------------------------------ */
function FamilyForm({ title, initial, isEdit, referrerMap, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  // Referrer options for dropdown (create only)
  const referrerOptions = Object.entries(referrerMap);

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}>
        <div className="flex flex-col gap-4">
          {/* Referrer select (create only) */}
          {!isEdit && referrerOptions.length > 0 && (
            <FormField
              label="Referrer"
              as="select"
              fieldProps={{
                value: form.referrer_id || '',
                onChange: (e) => update('referrer_id', parseInt(e.target.value)),
                required: true,
              }}
            >
              <option value="">Select referrer…</option>
              {referrerOptions.map(([id, name]) => (
                <option key={id} value={id}>{name} (ID {id})</option>
              ))}
            </FormField>
          )}

          {!isEdit && referrerOptions.length === 0 && (
            <FormField
              label="Referrer ID"
              type="number"
              fieldProps={{
                value: form.referrer_id ?? '',
                onChange: (e) => update('referrer_id', e.target.value ? parseInt(e.target.value) : ''),
                required: true,
                min: 1,
              }}
            />
          )}

          <FormField
            label="Family Name"
            fieldProps={{
              value: form.family_name,
              onChange: (e) => update('family_name', e.target.value),
              required: true,
              maxLength: 40,
            }}
          />

          <FormField
            label="Family Wish"
            fieldProps={{
              value: form.family_wish,
              onChange: (e) => update('family_wish', e.target.value),
              required: true,
              maxLength: 400,
            }}
          />

          <FormField
            label="Contact Name"
            fieldProps={{
              value: form.contact_name,
              onChange: (e) => update('contact_name', e.target.value),
              required: true,
              maxLength: 40,
            }}
          />

          <FormField
            label="Bio <span className='font-normal text-gray-400'>(optional)</span>"
            as="textarea"
            fieldProps={{
              value: form.bio || '',
              onChange: (e) => update('bio', e.target.value),
              rows: 3,
            }}
          />

          <FormField
            label="Address <span className='font-normal text-gray-400'>(optional)</span>"
            fieldProps={{
              value: form.address || '',
              onChange: (e) => update('address', e.target.value),
              maxLength: 200,
            }}
          />

          <FormField
            label="Phone <span className='font-normal text-gray-400'>(optional)</span>"
            fieldProps={{
              value: form.phone_number || '',
              onChange: (e) => update('phone_number', e.target.value),
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
const defaultForm = {
  referrer_id: '',
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};
