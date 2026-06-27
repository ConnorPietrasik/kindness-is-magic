/**
 * Admin — Manage People
 *
 * List, create, edit, delete people.
 * Fetches families for dropdown and display.
 */

import { useState, useMemo, useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adminListPeople,
  adminGetPerson,
  adminCreatePerson,
  adminUpdatePerson,
  adminDeletePerson,
  adminListFamilies,
} from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import { esc } from '../lib/utils';

const PEOPLE_KEYS = ['adminPeople'];
const FAMILY_KEYS = ['adminFamilies'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminPeople() {
  const queryClient = useQueryClient();

  // People list
  const { data, isLoading } = useQuery({
    queryKey: PEOPLE_KEYS,
    queryFn: adminListPeople,
  });

  // Families lookup (for dropdown + display)
  const { data: familyData } = useQuery({
    queryKey: FAMILY_KEYS,
    queryFn: adminListFamilies,
  });

  const familyMap = useMemo(() => {
    const map = {};
    (familyData?.families ?? []).forEach((f) => {
      map[f.id] = f.family_name;
    });
    return map;
  }, [familyData]);

  // Detail for edit
  const [editingId, setEditingId] = useState(null);
  const detailQuery = useQuery({
    queryKey: ['adminPersonDetail', editingId],
    queryFn: () => adminGetPerson(editingId),
    enabled: !!editingId,
  });
  const { data: detail } = detailQuery;
  const detailLoading = !!editingId && detailQuery.isLoading;

  // Mutations
  const createMut = useMutation({
    mutationFn: adminCreatePerson,
    onSuccess: () => {
      queryClient.invalidateQueries(PEOPLE_KEYS);
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => adminUpdatePerson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(PEOPLE_KEYS);
      queryClient.invalidateQueries(['adminPersonDetail']);
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: adminDeletePerson,
    onSuccess: () => queryClient.invalidateQueries(PEOPLE_KEYS),
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

  const people = data?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink />}
      />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage People</h2>
          <Button onClick={() => { setEditingId(null); setShowForm(true); }}>
            + Add Person
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
          <PersonForm
            title={editingId ? 'Edit Person' : 'Add Person'}
            initial={editingId ? (detail ?? defaultForm) : defaultForm}
            isEdit={!!editingId}
            familyMap={familyMap}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            loading={createMut.isPending || updateMut.isPending}
          />
        )}

        {/* Table */}
        {people.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No people yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Age</Th>
              <Th>Family</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {people.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.id}</Td>
                  <Td>{esc(p.given_name)}</Td>
                  <Td>{p.age}</Td>
                  <Td>{familyMap[p.family_id] || `ID ${p.family_id}`}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(p.id)}
                        disabled={!!editingId}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(p.id)}
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
                Delete person <strong>#{deleteConfirm}</strong>?
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
/* PersonForm sub-component                                            */
/* ------------------------------------------------------------------ */
function PersonForm({ title, initial, isEdit, familyMap, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const familyOptions = Object.entries(familyMap);

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}>
        <div className="flex flex-col gap-4">
          {/* Family select (create only) */}
          {!isEdit && familyOptions.length > 0 && (
            <FormField
              label="Family"
              as="select"
              fieldProps={{
                value: form.family_id || '',
                onChange: (e) => update('family_id', parseInt(e.target.value)),
                required: true,
              }}
            >
              <option value="">Select family…</option>
              {familyOptions.map(([id, name]) => (
                <option key={id} value={id}>{name} (ID {id})</option>
              ))}
            </FormField>
          )}

          {!isEdit && familyOptions.length === 0 && (
            <FormField
              label="Family ID"
              type="number"
              fieldProps={{
                value: form.family_id ?? '',
                onChange: (e) => update('family_id', e.target.value ? parseInt(e.target.value) : ''),
                required: true,
                min: 1,
              }}
            />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Given Name"
              fieldProps={{
                value: form.given_name,
                onChange: (e) => update('given_name', e.target.value),
                required: true,
                maxLength: 40,
              }}
            />
            <FormField
              label="Age"
              type="number"
              fieldProps={{
                value: form.age,
                onChange: (e) => update('age', parseInt(e.target.value) || 0),
                required: true,
                min: 0,
                max: 200,
              }}
            />
          </div>

          <FormField
            label="Title <span className='font-normal text-gray-400'>(optional)</span>"
            fieldProps={{
              value: form.title || '',
              onChange: (e) => update('title', e.target.value),
              maxLength: 40,
            }}
          />

          <FormField
            label="Practical Wish"
            as="textarea"
            fieldProps={{
              value: form.practical_wish,
              onChange: (e) => update('practical_wish', e.target.value),
              required: true,
              maxLength: 400,
              rows: 2,
            }}
          />

          <FormField
            label="Fun Wish"
            as="textarea"
            fieldProps={{
              value: form.fun_wish,
              onChange: (e) => update('fun_wish', e.target.value),
              required: true,
              maxLength: 400,
              rows: 2,
            }}
          />

          <FormField
            label="Note <span className='font-normal text-gray-400'>(optional)</span>"
            as="textarea"
            fieldProps={{
              value: form.note || '',
              onChange: (e) => update('note', e.target.value),
              maxLength: 400,
              rows: 2,
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
  family_id: '',
  given_name: '',
  age: 0,
  title: '',
  practical_wish: '',
  fun_wish: '',
  note: '',
};
