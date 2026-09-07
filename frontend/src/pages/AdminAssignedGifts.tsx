/**
 * Admin — My Assigned Gifts
 *
 * Paginated list of wishes assigned to the current admin (mirrors the
 * purchaser view). Table, filters, dialogs, and the inline edit form live
 * in `AssignedGiftsView`; this page scopes the list to the admin via the
 * admin endpoint's `assigned_to_id` filter and renders the family cell as
 * a link to the admin family people page.
 */

import { Link } from "react-router-dom";
import { type AssignedGiftsListParams, AssignedGiftsView } from "../components/AssignedGifts";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useFamiliesDropdown } from "../hooks/useDropdowns";
import { adminBatchMarkPurchased, adminGetWish, adminListWishes, adminMarkPurchased, adminUpdateWish } from "../lib/api";
import { adminPackingSlips, adminWishDetail, adminWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminAssignedGifts() {
  const { user } = useAuth();
  // Defer the data hooks until the user is known so the list query never
  // fires unscoped (before `assigned_to_id` is available).
  if (!user) return <PageSpinner />;
  return <AdminAssignedGiftsList userId={user.id} />;
}

function AdminAssignedGiftsList({ userId }: { userId: number }) {
  const { familyMap } = useFamiliesDropdown();

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <AssignedGiftsView
          title="My Assigned Gifts"
          emptyMessage="No wishes assigned to you."
          rootKey={adminWishes}
          detailKey={adminWishDetail}
          invalidationKeys={[adminWishes, adminPackingSlips]}
          // Annotated param so the view can infer the response type from this arrow's return
          listFn={(params: AssignedGiftsListParams) => adminListWishes({ ...params, assigned_to_id: userId })}
          detailFn={adminGetWish}
          updateFn={adminUpdateWish}
          markPurchasedFn={adminMarkPurchased}
          batchMarkPurchasedFn={adminBatchMarkPurchased}
          renderFamilyCell={(w) => (
            <Link to={route.adminFamilyPeople(w.family_id)} className="text-btn-start hover:underline">
              {familyMap[w.family_id] ?? `Family #${w.family_id}`}
            </Link>
          )}
        />
      </main>
    </div>
  );
}
