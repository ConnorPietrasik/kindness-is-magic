/**
 * Family Dashboard
 *
 * Shows the family's own info and a quick link to manage people.
 * Family users can edit their own family info and navigate to people management.
 *
 * Wish lock states:
 * - family + no request + no rejection → normal editing
 * - family + no request + rejection → show rejection reason, allow editing
 * - family + requested → "Awaiting referrer review" + cancel button
 * - referrer + rejection → admin rejected, contact referrer
 * - referrer (no rejection) → referrer reviewed, locked
 * - admin → fully approved and visible to donors
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { FamilyLockBanner } from "../components/FamilyLockBanner";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { useToast } from "../context/ToastContext";
import { cancelFamilyReview, getFamilyMe, patchFamilyMe, requestFamilyReview } from "../lib/api";
import { familyMe } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatDateTime, isFamilyLocked, normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, FamilySelfPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyDashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: familyInfo, isLoading } = useQuery({
    queryKey: familyMe,
    queryFn: getFamilyMe,
  });

  const updateSelfMut = useMutation({
    mutationFn: patchFamilyMe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyMe });
      setShowEdit(false);
      toast.success("Profile updated");
    },
  });

  const requestReviewMut = useMutation({
    mutationFn: requestFamilyReview,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyMe });
      toast.success("Review requested");
    },
  });

  const cancelReviewMut = useMutation({
    mutationFn: cancelFamilyReview,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyMe });
      toast.success("Review request cancelled");
    },
  });

  const [showEdit, setShowEdit] = useState(false);

  const isLocked = isFamilyLocked(familyInfo);

  function handleUpdateSelf(formData: FamilyPayload) {
    const normalized = normalizeUpdatePayload(formData, familyInfo as FamilyDetail);
    // Strip referrer_notes — family self-service endpoints don't accept it
    const { referrer_notes: _rn, ...safe } = normalized as { referrer_notes?: string | null };
    updateSelfMut.mutate(safe as FamilySelfPayload);
  }

  function handleRequestReview() {
    requestReviewMut.mutate();
  }

  function handleCancelReview() {
    cancelReviewMut.mutate();
  }

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family Dashboard</h2>

        {/* ── Pending approval banner (legacy) ────────────────── */}
        {familyInfo?.approval_status === "pending" && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800 shadow-sm">
            Your family is awaiting approval from your referrer. You can still add and edit family members while you wait.
          </div>
        )}

        {/* ── Wish lock state banner ──────────────────────────── */}
        {familyInfo && (
          <FamilyLockBanner
            lockLevel={familyInfo.wish_lock_level}
            requestedAt={familyInfo.wish_review_requested_at}
            rejectionReason={familyInfo.wish_rejection_reason}
            onRequestReview={handleRequestReview}
            onCancelReview={handleCancelReview}
            requestMutPending={requestReviewMut.isPending}
            cancelMutPending={cancelReviewMut.isPending}
          />
        )}

        {/* ── Family info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">My Family Profile</h3>
            {!isLocked && (
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEdit(!showEdit)}>
                {showEdit ? "Cancel" : "Edit"}
              </Button>
            )}
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
                <InfoRow label="Pickup Window" value={formatDateTime(familyInfo.pickup_window)} />
                <InfoRow label="People Count" value={familyInfo.person_count ?? 0} isLast />
              </div>
            )
          )}
        </Card>

        {/* ── Quick nav cards ───────────────────────────────── */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to={ROUTES.FAMILY_PEOPLE}
            className={`group flex flex-col gap-2 rounded-xl border px-5 py-5 shadow-sm transition-all ${
              isLocked
                ? "border-gray-100 bg-gray-50 opacity-60"
                : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md"
            }`}
            onClick={(e) => {
              if (isLocked) e.preventDefault();
            }}
          >
            <span className="text-2xl">✨</span>
            <span className={`text-sm font-semibold ${isLocked ? "text-gray-400" : "text-gray-900 group-hover:text-btn-start"}`}>
              Manage People
            </span>
            <span className="text-xs text-gray-400">
              {isLocked ? "Locked — contact your referrer to request changes" : "Add, edit, and delete family members and their wishes"}
            </span>
          </Link>
        </div>

        {/* ── Errors ────────────────────────────────────────── */}
        <MutationErrors mutations={[updateSelfMut, requestReviewMut, cancelReviewMut]} />
      </main>
    </div>
  );
}
