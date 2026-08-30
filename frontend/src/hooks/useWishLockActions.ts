/**
 * useWishLockActions — shared mutations for family wish-lock transitions.
 *
 * Both admin family pages (flat list + referrer-scoped) offer the same two
 * row actions, so the mutations and their invalidation sets live here:
 *
 *  - "Reset Lock" (adminResetWishState) — sends the family's wishes back to
 *    family-editable state, clearing any referrer/admin lock.
 *  - "Fully Approve" (adminApproveWishes) — skips referrer review and makes
 *    the family visible to donors immediately.
 *
 * Both invalidate the family lists, the wish review queue, packing slips,
 * and the wishes list. Pass `extraInvalidationKeys` for scoped lists that
 * also need refreshing (e.g. a referrer's family list).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../context/ToastContext";
import { adminApproveWishes, adminResetWishState } from "../lib/api";
import { adminFamilies, adminPackingSlips, adminReviewQueue, adminWishes } from "../lib/queryKeys";

export interface UseWishLockActionsOptions {
  /** Extra query keys to invalidate (e.g. a referrer-scoped family list). */
  extraInvalidationKeys?: (string | readonly string[])[];
}

export function useWishLockActions(options: UseWishLockActionsOptions = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const invalidationKeys: (string | readonly string[])[] = [
    adminFamilies,
    adminReviewQueue,
    adminPackingSlips,
    adminWishes,
    ...(options.extraInvalidationKeys ?? []),
  ];

  function invalidate(): void {
    invalidationKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: typeof key === "string" ? [key] : key }));
  }

  const resetMut = useMutation({
    mutationFn: (id: number) => adminResetWishState(id),
    onSuccess: () => {
      invalidate();
      toast.success("Wish lock reset — family can now edit their wishes");
    },
  });

  const fullyApproveMut = useMutation({
    mutationFn: (id: number) => adminApproveWishes(id),
    onSuccess: () => {
      invalidate();
      toast.success("Family fully approved and visible to donors");
    },
  });

  return { resetMut, fullyApproveMut };
}
