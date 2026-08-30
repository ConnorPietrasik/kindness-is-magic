/**
 * Admin Wish Review Queue
 *
 * Lists families awaiting admin wish approval.
 * Admin can approve (make visible to donors) or reject (send back to referrer).
 * Queue logic/rendering is shared with the referrer page via `WishReviewQueue`.
 */

import { BackLink, HeaderBar } from "../components/HeaderBar";
import { WishReviewQueue } from "../components/WishReviewQueue";
import { adminApproveWishes, adminRejectWishes, listAdminReviewQueue } from "../lib/api";
import { adminPackingSlips, adminReviewQueue, adminWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

export default function AdminWishReview() {
  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <WishReviewQueue
        title="Wish Approval Queue"
        emptyMessage="No families awaiting wish approval."
        queryKey={adminReviewQueue}
        listFn={listAdminReviewQueue}
        approveFn={adminApproveWishes}
        rejectFn={adminRejectWishes}
        approveInvalidate={[adminReviewQueue, adminPackingSlips, adminWishes]}
        rejectInvalidate={[adminReviewQueue, adminWishes]}
        approveMessage="Wishes approved — family is now visible to donors"
        rejectMessage="Wishes sent back to referrer"
        showReferrerColumn
        viewRoute={(id) => route.adminFamilyPeople(id)}
        rejectPlaceholder="e.g. Wishes need more specificity..."
        rejectAudienceLabel="Provide a reason the referrer can see:"
      />
    </div>
  );
}
