/**
 * Family People Management
 *
 * List, create, edit, delete people for the current family.
 * Uses shared /api/people/{id} endpoints for individual operations.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listFamilyPeople,
  createFamilyPerson,
  getPerson,
  updatePerson,
  deletePerson,
} from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { esc } from '../lib/utils';

const FAMILY_PEOPLE_KEY = ['familyPeople'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyPeople() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: FAMILY_PEOPLE_KEY,
    queryFn: listFamilyPeople,
  });

  const [editingPersonId, setEditingPersonId] = useState(null);
  const personDetailQuery = useQuery({
    queryKey: ['personDetail', editingPersonId],
    queryFn: () => getPerson(editingPersonId),
    enabled: !!editingPersonId,
  });
  const { data: personDetail } = personDetailQuery;
  const personDetailLoading = !!editingPersonId && personDetailQuery.isLoading;

  const createMut = useMutation({
    mutationFn: createFamilyPerson,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_PEOPLE_KEY);
      setShowCreate(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updatePerson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_PEOPLE_KEY);
      queryClient.invalidateQueries(['personDetail']);
      setEditingPersonId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deletePerson,
    onSuccess: () => queryClient.invalidateQueries(FAMILY_PEOPLE_KEY),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    createMut.mutate(e.data);
  }

  function handleUpdate(e) {
    e.preventDefault();
    if (!editingPersonId) return;
    updateMut.mutate({ id: editingPersonId, data: e.data });
  }

  function openEdit(id) {
    setEditingPersonId(id);
  }

  if (isLoading) return <PageSpinner />;

  const people = data?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to="/family/dashboard" label="Family Dashboard" />}
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            Manage People
          </h2>
          <Button
            onClick={() => {
              setEditingPersonId(null);
              setShowCreate(true);
            }}
          >
            + Add Person
          </Button>
        </div>

        {/* Create form */}
        {showCreate && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            loading={createMut.isPending}
          />
        )}

        {/* Edit loading */}
        {editingPersonId && personDetailLoading && (
          <Card className="mb-6 border border-gray-200">
            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
              <svg
                className="h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <span className="text-sm font-medium">Loading person details…</span>
            </div>
          </Card>
        )}

        {/* Edit form */}
        {editingPersonId && personDetail && (
          <PersonForm
            title="Edit Person"
            initial={personDetail}
            isEdit={true}
            onSubmit={handleUpdate}
            onCancel={() => setEditingPersonId(null)}
            loading={updateMut.isPending}
          />
        )}

        {/* Table */}
        <Table className="mb-6">
          {people.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">
                  No people yet. Add one to get started.
                </Td>
              </Tr>
            </TableBody>
          ) : (
            <>
              <TableHead>
                <Th>ID</Th>
                <Th>Name</Th>
                <Th>Age</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {people.map((p) => (
                  <Tr key={p.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-400">{p.id}</Td>
                    <Td className="font-medium text-gray-900">{esc(p.given_name)}</Td>
                    <Td>{p.age}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEdit(p.id)}
                          disabled={!!editingPersonId}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 border-red-300 bg-white text-xs text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteConfirm(p.id)}
                          disabled={deleteMut.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TableBody>
            </>
          )}
        </Table>

        {/* Delete confirmation */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
              <p className="mb-4 text-sm text-gray-700">
                Delete person <strong>#{deleteConfirm}</strong>?
              </p>
              <div className="flex gap-3">
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    deleteMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
                  loading={deleteMut.isPending}
                >
                  {deleteMut.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        <div className="space-y-2">
          {[createMut, updateMut, deleteMut].map(
            (mut, i) =>
              mut.error && (
                <ErrorBox
                  key={i}
                  message={
                    mut.error?.response?.data?.detail ||
                    mut.error?.response?.data?.msg ||
                    JSON.stringify(mut.error?.response?.data) ||
                    'Request failed.'
                  }
                />
              )
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PersonForm                                                          */
/* ------------------------------------------------------------------ */
function PersonForm({ title, initial, isEdit, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-base font-semibold text-gray-900">{title}</h3>
      <form onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}>
        <div className="space-y-3">
          <div className="sm:grid sm:grid-cols-3 sm:gap-x-4">
            <FormField
              label="Given Name"
              fieldProps={{
                type: 'text',
                value: form.given_name,
                onChange: (e) => update('given_name', e.target.value),
                required: true,
                maxLength: 40,
              }}
            />
            <FormField
              label="Age"
              fieldProps={{
                type: 'number',
                value: form.age,
                onChange: (e) => update('age', parseInt(e.target.value) || 0),
                required: true,
                min: 0,
                max: 200,
              }}
            />
            <div>
              <OptionalLabel text="Title" />
              <input
                type="text"
                value={form.title || ''}
                onChange={(e) => update('title', e.target.value)}
                maxLength={40}
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              />
            </div>
          </div>

          <FormField
            label="Practical Wish"
            as="textarea"
            fieldProps={{
              value: form.practical_wish,
              onChange: (e) => update('practical_wish', e.target.value),
              required: true,
              maxLength: 400,
              rows: 2,
              className: 'resize-vertical',
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
              className: 'resize-vertical',
            }}
          />
          <div>
            <OptionalLabel text="Note" />
            <textarea
              value={form.note || ''}
              onChange={(e) => update('note', e.target.value)}
              maxLength={400}
              rows={2}
              className="w-full resize-vertical rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button type="submit" loading={loading}>
            {loading ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* OptionalLabel                                                       */
/* ------------------------------------------------------------------ */
function OptionalLabel({ text }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-gray-700">
      {text} <span className="font-normal text-gray-400">(optional)</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const defaultPersonForm = {
  given_name: '',
  age: 0,
  title: '',
  practical_wish: '',
  fun_wish: '',
  note: '',
};
