/**
 * Family Dashboard
 *
 * Shows the family's own info and a quick link to manage people.
 * Family users can edit their own family info and navigate to people management.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFamilyMe, patchFamilyMe } from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { esc } from '../lib/utils';

const FAMILY_ME_KEY = ['familyMe'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyDashboard() {
  const queryClient = useQueryClient();

  const { data: familyInfo, isLoading } = useQuery({
    queryKey: FAMILY_ME_KEY,
    queryFn: getFamilyMe,
  });

  const updateSelfMut = useMutation({
    mutationFn: patchFamilyMe,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_ME_KEY);
      setShowEdit(false);
    },
  });

  const [showEdit, setShowEdit] = useState(false);

  function handleUpdateSelf(e) {
    e.preventDefault();
    updateSelfMut.mutate(e.data);
  }

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to="/dashboard" label="Dashboard" />}
      />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          Family Dashboard
        </h2>

        {/* ── Family info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">My Family Profile</h3>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setShowEdit(!showEdit)}
            >
              {showEdit ? 'Cancel' : 'Edit'}
            </Button>
          </div>

          {showEdit ? (
            <FamilySelfForm
              initial={familyInfo ?? defaultFamilyForm}
              onSubmit={handleUpdateSelf}
              onCancel={() => setShowEdit(false)}
              loading={updateSelfMut.isPending}
            />
          ) : (
            familyInfo && (
              <div className="space-y-0">
                <InfoRow label="Family Name" value={familyInfo.family_name} />
                <InfoRow label="Contact" value={familyInfo.contact_name} />
                <InfoRow label="Family Wish" value={familyInfo.family_wish} />
                <InfoRow label="Bio" value={familyInfo.bio} />
                <InfoRow label="Address" value={familyInfo.address} />
                <InfoRow label="Phone" value={familyInfo.phone_number} />
                <InfoRow label="People Count" value={familyInfo.person_count ?? 0} isLast />
              </div>
            )
          )}
        </Card>

        {/* ── Quick nav cards ───────────────────────────────── */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to="/family/people"
            className="group flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md"
          >
            <span className="text-2xl">✨</span>
            <span className="text-sm font-semibold text-gray-900 group-hover:text-btn-start">
              Manage People
            </span>
            <span className="text-xs text-gray-400">
              Add, edit, and delete family members and their wishes
            </span>
          </Link>
        </div>

        {/* ── Errors ────────────────────────────────────────── */}
        {updateSelfMut.error && (
          <ErrorBox
            message={
              updateSelfMut.error?.response?.data?.detail ||
              JSON.stringify(updateSelfMut.error?.response?.data) ||
              'Request failed.'
            }
          />
        )}
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
/* FamilySelfForm                                                      */
/* ------------------------------------------------------------------ */
function FamilySelfForm({ initial, onSubmit, onCancel, loading }) {
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
