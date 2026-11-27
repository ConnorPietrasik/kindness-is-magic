/**
 * useWishLockActions — shared mutations for family wish-lock transitions.
 *
 * Both admin family pages (flat list + referrer-scoped) offer the same two
 * row actions, so the mutations, their confirmation dialogs, and their
 * invalidation sets live here:
 *
 *  - "Unapprove" (adminResetWishState) — sends the family's wishes back to
 *    family-editable state, clearing any referrer/admin lock.
 *  - "Fully approve" (adminApproveWishes) — skips referrer review and makes
 *    the family visible to donors immediately.
 *
 * List pages render `confirmDialogs` (once) so both gated actions get the
 * same two-step confirmation from the row menus; entry points that don't
 * render it (e.g. the family & people page) confirm with their own dialog.
 *
 * Both mutations invalidate the family lists, the wish review queue, packing
 * slips, the wishes list, and the wish-card sheets (approval changes which
 * families are in the active display-ID enumeration). Pass
 * `extraInvalidationKeys` for scoped lists that also need refreshing (e.g.
 * a referrer's family list).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";
import { adminApproveWishes, adminResetWishState } from "../lib/api";
import { adminFamilies, adminPackingSlips, adminReviewQueue, adminWishCards, adminWishes } from "../lib/queryKeys";

export interface UseWishLockActionsOptions {
  /** Extra query keys to invalidate (e.g. a referrer-scoped family list). */
  extraInvalidationKeys?: (string | readonly string[])[];
}

export function useWishLockActions(options: UseWishLockActionsOptions = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [resetConfirm, setResetConfirm] = useState<{ id: number; name: string } | null>(null);
  const [fullyApproveConfirm, setFullyApproveConfirm] = useState<{ id: number; name: string } | null>(null);

  const invalidationKeys: (string | readonly string[])[] = [
    adminFamilies,
    adminReviewQueue,
    adminPackingSlips,
    adminWishes,
    adminWishCards,
    ...(options.extraInvalidationKeys ?? []),
  ];

  function invalidate(): void {
    invalidationKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: typeof key === "string" ? [key] : key }));
  }

  const resetMut = useMutation({
    mutationFn: (id: number) => adminResetWishState(id),
    onSuccess: () => {
      invalidate();
      toast.success("Family unapproved — they can now edit their wishes");
    },
  });

  const fullyApproveMut = useMutation({
    mutationFn: (id: number) => adminApproveWishes(id),
    onSuccess: () => {
      invalidate();
      toast.success("Family fully approved and visible to donors");
    },
  });

  // Confirmation dialogs for the two gated actions. The dialog closes on
  // confirm — the row's `isLockActionPending` (disabled menu) carries the
  // in-flight state — so no `loading` prop is passed.
  const confirmDialogs = (
    <>
      <ConfirmDialog
        open={resetConfirm !== null}
        title={
          <>
            Unapprove family <strong>{resetConfirm?.name}</strong>?
          </>
        }
        description="This will unlock the family's wishes so they can edit them again. Any admin approval will be removed."
        onConfirm={() => {
          if (resetConfirm != null) {
            resetMut.mutate(resetConfirm.id);
            setResetConfirm(null);
          }
        }}
        onCancel={() => setResetConfirm(null)}
        confirmLabel="Yes, unapprove"
        confirmVariant="secondary"
      />

      <ConfirmDialog
        open={fullyApproveConfirm !== null}
        title={
          <>
            Fully approve family <strong>{fullyApproveConfirm?.name}</strong>?
          </>
        }
        description="This will make the family's wishes visible to donors immediately, skipping referrer review."
        onConfirm={() => {
          if (fullyApproveConfirm != null) {
            fullyApproveMut.mutate(fullyApproveConfirm.id);
            setFullyApproveConfirm(null);
          }
        }}
        onCancel={() => setFullyApproveConfirm(null)}
        confirmLabel="Yes, fully approve"
        confirmVariant="primary"
      />
    </>
  );

  return {
    resetMut,
    fullyApproveMut,
    onResetLock: (id: number, name: string) => setResetConfirm({ id, name }),
    onFullyApprove: (id: number, name: string) => setFullyApproveConfirm({ id, name }),
    confirmDialogs,
  };
}
