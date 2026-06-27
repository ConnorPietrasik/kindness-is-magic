/**
 * Referrer Dashboard
 *
 * Shows the referrer's own info, family list with actions,
 * and a card linking to manage each family's people.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getReferrerMe,
  patchReferrerMe,
  listReferrerFamilies,
  createReferrerFamily,
  updateReferrerFamily,
  deleteReferrerFamily,
} from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner, InlineSpinner } from '../components/Spinner';
import { esc } from '../lib/utils';

const REFERRER_ME_KEY = ['referrerMe'];
const REFERRER_FAMILIES_KEY = ['referrerFamilies'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerDashboard() {
  const queryClient = useQueryClient();

  const { data: referrerInfo, isLoading: infoLoading } = useQuery({
    queryKey: REFERRER_ME_KEY,
    queryFn: getReferrerMe,
  });

  const { data, isLoading: famLoading } = useQuery({
    queryKey: REFERRER_FAMILIES_KEY,
    queryFn: listReferrerFamilies,
  });

  const [editingId, setEditingId] = useState(null);

  const updateSelfMut = useMutation({
    mutationFn: patchReferrerMe,
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_ME_KEY);
      setShowEditSelf(false);
    },
  });

  const createFamMut = useMutation({
    mutationFn: createReferrerFamily,
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_FAMILIES_KEY);
      queryClient.invalidateQueries(REFERRER_ME_KEY);
      setShowCreate(false);
    },
  });

  const updateFamMut = useMutation({
    mutationFn: ({ id, data }) => updateReferrerFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_FAMILIES_KEY);
      setEditingId(null);
    },
  });

  const deleteFamMut = useMutation({
    mutationFn: deleteReferrerFamily,
    onSuccess: () => queryClient.invalidateQueries(REFERRER_FAMILIES_KEY),
  });

  const [showEditSelf, setShowEditSelf] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleUpdateSelf(e) {
    e.preventDefault();
    updateSelfMut.mutate(e.data);
  }

  function handleCreateFam(e) {
    e.preventDefault();
    createFamMut.mutate(e.data);
  }

  function handleUpdateFam(e) {
    e.preventDefault();
    if (!editingId) return;
    updateFamMut.mutate({ id: editingId, data: e.data });
  }

  if (infoLoading || famLoading) return <PageSpinner />;

  const families = data?.families ?? [];
  const familyLimit = referrerInfo?.family_limit ?? 0;
  const familyCount = referrerInfo?.family_count ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to="/dashboard" label="Dashboard" />}
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          Referrer Dashboard
        </h2>

        {/* ── Referrer info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">My Profile</h3>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setShowEditSelf(!showEditSelf)}
            >
              {showEditSelf ? 'Cancel' : 'Edit'}
            </Button>
          </div>

          {showEditSelf ? (
            <ReferrerSelfForm
              initial={referrerInfo ?? defaultReferrerForm}
              onSubmit={handleUpdateSelf}
              onCancel={() => setShowEditSelf(false)}
              loading={updateSelfMut.isPending}
            />
          ) : (
            <div className="space-y-0">
              <InfoRow label="Name" value={referrerInfo?.name} />
              <InfoRow label="Phone" value={referrerInfo?.phone_number} />
              <InfoRow label="Family Limit" value={`${familyCount} / ${familyLimit}`} isLast />
            </div>
          )}
        </Card>

        {/* ── Families ────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">My Families</h3>
          {familyCount < familyLimit && (
            <Button onClick={() => setShowCreate(true)}>+ Add Family</Button>
          )}
        </div>

        {showCreate && (
          <FamilyForm
            title="Add Family"
            initial={defaultFamilyForm}
            isEdit={false}
            onSubmit={handleCreateFam}
            onCancel={() => setShowCreate(false)}
            loading={createFamMut.isPending}
          />
        )}

        {editingId && (
          <FamilyForm
            title="Edit Family"
            initial={families.find((f) => f.id === editingId) || defaultFamilyForm}
            isEdit={true}
            onSubmit={handleUpdateFam}
            onCancel={() => setEditingId(null)}
            loading={updateFamMut.isPending}
          />
        )}

        <Table className="mb-6">
          {families.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">
                  No families yet. Add one to get started.
                </Td>
              </Tr>
            </TableBody>
          ) : (
            <>
              <TableHead>
                <Th>ID</Th>
                <Th>Family Name</Th>
                <Th>Family Wish</Th>
                <Th>Contact</Th>
                <Th>People</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {families.map((f) => (
                  <Tr key={f.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-400">{f.id}</Td>
                    <Td className="font-medium text-gray-900">{esc(f.family_name)}</Td>
                    <Td className="max-w-xs truncate">{esc(f.family_wish ?? '')}</Td>
                    <Td>{esc(f.contact_name)}</Td>
                    <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/referrer/families/${f.id}`}
                          className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          Manage
                        </Link>
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => setEditingId(f.id)}
                          disabled={!!editingId}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDeleteConfirm(f.id)}
                          disabled={deleteFamMut.isPending}
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

        {/* ── Delete confirmation ─────────────────────────────── */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
              <p className="mb-4 text-sm text-gray-700">
                Delete family <strong>#{deleteConfirm}</strong>?
              </p>
              <div className="flex gap-3">
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    deleteFamMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
                  loading={deleteFamMut.isPending}
                >
                  {deleteFamMut.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Errors ──────────────────────────────────────────── */}
        <div className="space-y-2">
          {[updateSelfMut, createFamMut, updateFamMut, deleteFamMut].map(
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
      <span className="text-sm font-semibold text-gray-900">{esc(value ?? '—')}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerSelfForm                                                    */
/* ------------------------------------------------------------------ */
function ReferrerSelfForm({ initial, onSubmit, onCancel, loading }) {
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
      className="mx-auto max-w-sm space-y-3"
    >
      <FormField
        label="Name"
        fieldProps={{
          type: 'text',
          value: form.name,
          onChange: (e) => update('name', e.target.value),
          required: true,
          maxLength: 60,
        }}
      />
      <FormField
        label="Phone"
        fieldProps={{
          type: 'text',
          value: form.phone_number,
          onChange: (e) => update('phone_number', e.target.value),
          required: true,
          maxLength: 20,
        }}
      />
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading} className="flex-1">
          {loading ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* FamilyForm                                                          */
/* ------------------------------------------------------------------ */
function FamilyForm({ title, initial, isEdit, onSubmit, onCancel, loading }) {
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
        <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3">
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
          {isEdit && (
            <>
              <div className="sm:col-span-2">
                <OptionalLabel text="Bio" />
                <textarea
                  value={form.bio || ''}
                  onChange={(e) => update('bio', e.target.value)}
                  rows={2}
                  className="w-full resize-vertical rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                />
              </div>
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
            </>
          )}
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
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const defaultReferrerForm = { name: '', family_limit: 1, phone_number: '' };
const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};
