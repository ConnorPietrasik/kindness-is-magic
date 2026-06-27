/**
 * Referrer Family Detail
 *
 * View/edit a specific family and manage its people.
 * Accessible from ReferrerDashboard via "Manage" link.
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getReferrerFamily,
  updateReferrerFamily,
  listReferrerFamilyPeople,
  createReferrerFamilyPerson,
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
import { PageSpinner, InlineSpinner } from '../components/Spinner';
import { esc } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyDetail() {
  const { id: famId } = useParams();
  const famIdNum = parseInt(famId);
  const queryClient = useQueryClient();

  const { data: family, isLoading: famLoading } = useQuery({
    queryKey: ['referrerFamily', famIdNum],
    queryFn: () => getReferrerFamily(famIdNum),
  });

  const { data, isLoading: peopleLoading } = useQuery({
    queryKey: ['referrerFamilyPeople', famIdNum],
    queryFn: () => listReferrerFamilyPeople(famIdNum),
  });

  const [editingPersonId, setEditingPersonId] = useState(null);
  const personDetailQuery = useQuery({
    queryKey: ['personDetail', editingPersonId],
    queryFn: () => getPerson(editingPersonId),
    enabled: !!editingPersonId,
  });
  const { data: personDetail } = personDetailQuery;
  const personDetailLoading = !!editingPersonId && personDetailQuery.isLoading;

  const updateFamMut = useMutation({
    mutationFn: ({ id, data }) => updateReferrerFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
      queryClient.invalidateQueries(['referrerFamilies']);
    },
  });

  const createPersonMut = useMutation({
    mutationFn: (data) => createReferrerFamilyPerson(famIdNum, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
      setShowCreatePerson(false);
    },
  });

  const updatePersonMut = useMutation({
    mutationFn: ({ id, data }) => updatePerson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['personDetail']);
      setEditingPersonId(null);
    },
  });

  const deletePersonMut = useMutation({
    mutationFn: deletePerson,
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
    },
  });

  const [showEditFamily, setShowEditFamily] = useState(false);
  const [showCreatePerson, setShowCreatePerson] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleUpdateFam(e) {
    e.preventDefault();
    updateFamMut.mutate({ id: famIdNum, data: e.data });
  }

  function handleCreatePerson(e) {
    e.preventDefault();
    createPersonMut.mutate(e.data);
  }

  function handleUpdatePerson(e) {
    e.preventDefault();
    if (!editingPersonId) return;
    updatePersonMut.mutate({ id: editingPersonId, data: e.data });
  }

  if (famLoading || peopleLoading) return <PageSpinner />;

  const people = data?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to="/referrer/dashboard" label="My Families" />}
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          Family Detail
        </h2>

        {/* ── Family info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">
                {family ? esc(family.family_name) : '—'}
              </h3>
              {family && (
                <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
                  {family.person_count ?? 0} person{(family.person_count ?? 0) !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setShowEditFamily(!showEditFamily)}
            >
              {showEditFamily ? 'Cancel' : 'Edit'}
            </Button>
          </div>

          {showEditFamily ? (
            <FamilyEditForm
              initial={family ?? defaultFamilyForm}
              onSubmit={handleUpdateFam}
              onCancel={() => setShowEditFamily(false)}
              loading={updateFamMut.isPending}
            />
          ) : (
            family && (
              <div className="space-y-0">
                <InfoRow label="Family Name" value={family.family_name} />
                <InfoRow label="Contact" value={family.contact_name} />
                <InfoRow label="Family Wish" value={family.family_wish} />
                <InfoRow label="Bio" value={family.bio} />
                <InfoRow label="Address" value={family.address} />
                <InfoRow label="Phone" value={family.phone_number} isLast />
              </div>
            )
          )}
        </Card>

        {/* ── People section ────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">People</h3>
          <Button onClick={() => setShowCreatePerson(true)}>+ Add Person</Button>
        </div>

        {showCreatePerson && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreatePerson}
            onCancel={() => setShowCreatePerson(false)}
            loading={createPersonMut.isPending}
          />
        )}

        {editingPersonId && personDetailLoading && (
          <Card className="mb-6 border border-gray-200">
            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
              <InlineSpinner className="py-0" />
              <span className="text-sm font-medium">Loading person details…</span>
            </div>
          </Card>
        )}

        {editingPersonId && personDetail && (
          <PersonForm
            title="Edit Person"
            initial={personDetail}
            isEdit={true}
            onSubmit={handleUpdatePerson}
            onCancel={() => setEditingPersonId(null)}
            loading={updatePersonMut.isPending}
          />
        )}

        <Table className="mb-6">
          {people.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">No people in this family yet.</Td>
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
                          onClick={() => setEditingPersonId(p.id)}
                          disabled={!!editingPersonId}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDeleteConfirm(p.id)}
                          disabled={deletePersonMut.isPending}
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

        {/* ── Delete confirmation ───────────────────────────── */}
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
                    deletePersonMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
                  loading={deletePersonMut.isPending}
                >
                  {deletePersonMut.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Errors ────────────────────────────────────────── */}
        <div className="space-y-2">
          {[updateFamMut, createPersonMut, updatePersonMut, deletePersonMut].map(
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
/* InfoRow                                                             */
/* ------------------------------------------------------------------ */
function InfoRow({ label, value, isLast }) {
  return (
    <div
      className={`flex items-baseline justify-between px-1 py-2 ${
        isLast ? '' : 'border-b border-gray-100'
      }`}
    >
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-semibold text-gray-900">
        {esc(value ?? '—')}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FamilyEditForm                                                      */
/* ------------------------------------------------------------------ */
function FamilyEditForm({ initial, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}
      className="mx-auto max-w-lg space-y-3"
    >
      <div className="sm:grid sm:grid-cols-2 sm:gap-x-4">
        <FormField
          label="Family Name"
          fieldProps={{
            type: 'text',
            value: form.family_name,
            onChange: (e) => update('family_name', e.target.value),
            required: true,
            maxLength: 40,
          }}
        />
        <FormField
          label="Family Wish"
          fieldProps={{
            type: 'text',
            value: form.family_wish,
            onChange: (e) => update('family_wish', e.target.value),
            required: true,
            maxLength: 400,
          }}
        />
        <FormField
          label="Contact Name"
          fieldProps={{
            type: 'text',
            value: form.contact_name,
            onChange: (e) => update('contact_name', e.target.value),
            required: true,
            maxLength: 40,
          }}
        />
      </div>
      <div className="sm:col-span-2">
        <OptionalLabel text="Bio" />
        <textarea
          value={form.bio || ''}
          onChange={(e) => update('bio', e.target.value)}
          rows={2}
          className="w-full resize-vertical rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        />
      </div>
      <div className="sm:grid sm:grid-cols-2 sm:gap-x-4">
        <div>
          <OptionalLabel text="Address" />
          <input
            type="text"
            value={form.address || ''}
            onChange={(e) => update('address', e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          />
        </div>
        <div>
          <OptionalLabel text="Phone" />
          <input
            type="text"
            value={form.phone_number || ''}
            onChange={(e) => update('phone_number', e.target.value)}
            maxLength={20}
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          />
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading}>
          {loading ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
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
const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};

const defaultPersonForm = {
  given_name: '',
  age: 0,
  title: '',
  practical_wish: '',
  fun_wish: '',
  note: '',
};
