/**
 * Family Dashboard
 *
 * Shows the family's own info and a quick link to manage people.
 * Family users can edit their own family info and navigate to people management.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFamilyMe, patchFamilyMe } from '../lib/api';
import { ROUTES } from '../lib/routes';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorBox } from '../components/ErrorBox';
import { PageSpinner } from '../components/Spinner';
import { InfoRow } from '../components/InfoRow';
import { FamilyForm } from '../components/FamilyForm';
import { defaultFamilyForm } from '../components/defaults';

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
      queryClient.invalidateQueries({ queryKey: FAMILY_ME_KEY });
      setShowEdit(false);
    },
  });

  const [showEdit, setShowEdit] = useState(false);

  function handleUpdateSelf(formData: Record<string, unknown>) {
    updateSelfMut.mutate(formData);
  }

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />}
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
            <FamilyForm
              title="Edit Family Profile"
              initial={familyInfo ?? defaultFamilyForm}
              isEdit={true}
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
            to={ROUTES.FAMILY_PEOPLE}
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
              (updateSelfMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              JSON.stringify((updateSelfMut.error as { response?: { data?: unknown } })?.response?.data) ||
              'Request failed.'
            }
          />
        )}
      </main>
    </div>
  );
}
