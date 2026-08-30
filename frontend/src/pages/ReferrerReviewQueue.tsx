/**
 * Referrer Wish Review Queue
 *
 * Lists families awaiting referrer wish review.
 * Referrer can approve (submit to admin) or reject (send back to family).
 * Queue logic/rendering is shared with the admin page via `WishReviewQueue`.
 */

import { BackLink, HeaderBar } from "../components/HeaderBar";
import { WishReviewQueue } from "../components/WishReviewQueue";
import { listReferrerReviewQueue, referrerApproveWishes, referrerRejectWishes } from "../lib/api";
import { referrerReviewQueue } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

export default function ReferrerReviewQueue() {
  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <WishReviewQueue
        title="Wish Review Queue"
        emptyMessage="No families awaiting wish review."
        queryKey={referrerReviewQueue}
        listFn={listReferrerReviewQueue}
        approveFn={referrerApproveWishes}
        rejectFn={referrerRejectWishes}
        approveInvalidate={[referrerReviewQueue]}
        rejectInvalidate={[referrerReviewQueue]}
        approveMessage="Wishes submitted for admin review"
        rejectMessage="Wishes sent back to family"
        viewRoute={(id) => route.referrerFamilyDetail(id)}
        rejectPlaceholder="e.g. Please add more details to the family wish..."
        rejectAudienceLabel="Provide a reason the family can see:"
      />
    </div>
  );
}
