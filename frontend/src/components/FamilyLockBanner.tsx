/**
 * FamilyLockBanner — shows the current wish lock state and actions for a family user.
 *
 * Renders different banners for each lock state:
 * - Editable (request review)
 * - Rejected by referrer (show reason + re-request)
 * - Awaiting referrer review (cancel request)
 * - Rejected by admin (show reason)
 * - Referrer reviewed (locked)
 * - Admin approved (fully visible to donors)
 */

import { useState } from "react";
import type { WishLockLevel } from "../types";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";

interface FamilyLockBannerProps {
  lockLevel: WishLockLevel;
  requestedAt: string | null;
  rejectionReason: string | null;
  onRequestReview: () => void;
  onCancelReview: () => void;
  requestMutPending: boolean;
  cancelMutPending: boolean;
}

export function FamilyLockBanner({
  lockLevel,
  requestedAt,
  rejectionReason,
  onRequestReview,
  onCancelReview,
  requestMutPending,
  cancelMutPending,
}: FamilyLockBannerProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // family + no request + no rejection → editable, show request button
  if (lockLevel === "family" && !requestedAt && !rejectionReason) {
    return (
      <>
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
          <div>
            <p className="text-base font-semibold text-gray-900">Add everyone in your family, then click DONE.</p>
            <p className="text-sm text-gray-600">
              Click DONE when you are finished adding people and wishes. This sends everything to your referrer. After your referrer
              approves it, you will no longer be able to make changes.
            </p>
          </div>
          <Button
            className="h-11 px-6 text-sm font-bold whitespace-nowrap flex-shrink-0"
            onClick={() => setShowConfirmDialog(true)}
            loading={requestMutPending}
          >
            {requestMutPending ? "Sending…" : "DONE"}
          </Button>
        </div>
        <ConfirmDialog
          open={showConfirmDialog}
          title="Send your information to your referrer?"
          description={
            <>
              After your referrer approves it, you will no longer be able to make changes. If you need to make changes after that, you must
              ask your referrer.
            </>
          }
          onConfirm={() => {
            setShowConfirmDialog(false);
            onRequestReview();
          }}
          onCancel={() => setShowConfirmDialog(false)}
          loading={requestMutPending}
          confirmLabel="Yes, I am done"
          loadingLabel="Sending…"
          confirmVariant="primary"
        />
      </>
    );
  }

  // family + no request + rejection → show rejection, allow re-request
  if (lockLevel === "family" && !requestedAt && rejectionReason) {
    return (
      <>
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800 shadow-sm">
          <p className="font-medium">Your referrer sent this back for revisions:</p>
          <p className="mt-1 italic">{rejectionReason}</p>
          <p className="mt-2 text-xs text-amber-700">You can make changes below and request review again.</p>
        </div>
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Make the changes above, then click DONE to send it back to your referrer. After your referrer approves it, you will no longer be
            able to make changes.
          </p>
          <Button
            className="h-11 px-6 text-sm font-bold whitespace-nowrap flex-shrink-0"
            onClick={() => setShowConfirmDialog(true)}
            loading={requestMutPending}
          >
            {requestMutPending ? "Sending…" : "DONE"}
          </Button>
        </div>
        <ConfirmDialog
          open={showConfirmDialog}
          title="Send your changes to your referrer?"
          description={
            <>
              After your referrer approves it, you will no longer be able to make changes. If you need to make changes after that, you must
              ask your referrer.
            </>
          }
          onConfirm={() => {
            setShowConfirmDialog(false);
            onRequestReview();
          }}
          onCancel={() => setShowConfirmDialog(false)}
          loading={requestMutPending}
          confirmLabel="Yes, I am done"
          loadingLabel="Sending…"
          confirmVariant="primary"
        />
      </>
    );
  }

  // family + requested → awaiting referrer review
  if (lockLevel === "family" && requestedAt) {
    return (
      <div className="mb-6 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-6 py-4 shadow-sm">
        <div>
          <p className="text-sm font-medium text-blue-800">Awaiting referrer review</p>
          <p className="text-xs text-blue-600">Your referrer is reviewing your family profile.</p>
        </div>
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs whitespace-nowrap flex-shrink-0"
          onClick={() => onCancelReview()}
          loading={cancelMutPending}
        >
          {cancelMutPending ? "Cancelling…" : "Cancel Request"}
        </Button>
      </div>
    );
  }

  // referrer + rejection → admin rejected, contact referrer
  if (lockLevel === "referrer" && rejectionReason) {
    return (
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800 shadow-sm">
        <p className="font-medium">Your admin sent this back for revisions:</p>
        <p className="mt-1 italic">{rejectionReason}</p>
        <p className="mt-2 text-xs text-amber-700">Contact your referrer to make changes.</p>
      </div>
    );
  }

  // referrer (no rejection) → referrer reviewed, locked
  if (lockLevel === "referrer") {
    return (
      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-6 py-4 text-sm text-gray-700 shadow-sm">
        <p className="font-medium">Your family profile has been reviewed by your referrer and is now locked.</p>
        <p className="mt-1 text-xs text-gray-500">Contact your referrer if changes are needed.</p>
      </div>
    );
  }

  // admin → fully approved
  if (lockLevel === "admin") {
    return (
      <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-sm text-emerald-800 shadow-sm">
        <p className="font-medium">Your family profile is fully approved and visible to donors. ✨</p>
      </div>
    );
  }

  return null;
}
