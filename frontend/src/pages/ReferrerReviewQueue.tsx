/**
 * Referrer Wish Review Queue
 *
 * Lists families awaiting referrer wish review.
 * Referrer can approve (submit to admin) or reject (send back to family).
 * Queue logic/rendering is shared with the admin page via `WishReviewQueue`.
 *
 * Shows the referrer_review deadline banner (with the queue count). The
 * banner's count query shares the queue's key, so it reuses the same cache —
 * no extra request.
 */

import { useQuery } from "@tanstack/react-query";
import { DeadlineBanner } from "../components/DeadlineBanner";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { WishReviewQueue } from "../components/WishReviewQueue";
import { useDeadlineBanner } from "../hooks/useDeadlineBanner";
import { listReferrerReviewQueue, referrerApproveWishes, referrerRejectWishes } from "../lib/api";
import { referrerReviewQueue } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

export default function ReferrerReviewQueue() {
  const banner = useDeadlineBanner("referrer_review");

  // Only needed to show the waiting count on the banner; shares the queue's
  // cache, so this is a no-op request once the queue below has loaded.
  const { data: queue } = useQuery({
    queryKey: referrerReviewQueue,
    queryFn: listReferrerReviewQueue,
    enabled: banner != null,
  });

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
        banner={
          <DeadlineBanner
            result={banner}
            extra={banner && queue ? `${queue.length} famil${queue.length === 1 ? "y" : "ies"} waiting in the queue` : undefined}
          />
        }
      />
    </div>
  );
}
