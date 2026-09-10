/**
 * Purchaser — Assigned Gifts
 *
 * Paginated list of wishes assigned to the current purchaser. Table,
 * filters, dialogs, and the inline edit form live in `AssignedGiftsView`;
 * this page renders the family cell as a link to the public wishlist
 * (only when the family is admin-locked — the public endpoint 404s
 * otherwise).
 *
 * Purchasers cannot unassign wishes or edit wish definitions.
 */

import { Link } from "react-router-dom";
import { AssignedGiftsView } from "../components/AssignedGifts";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  purchaserBatchMarkPurchased,
  purchaserGetWish,
  purchaserListWishes,
  purchaserMarkPurchased,
  purchaserUpdateWish,
} from "../lib/api";
import { purchaserWishDetail, purchaserWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function PurchaserAssignedGifts() {
  // useTableWidth syncs with the view's ColumnToggle via window events — the
  // view doesn't render <main>, so the width class applies here.
  const { widthClass } = useTableWidth("purchaserAssignedGifts");

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        <AssignedGiftsView
          title="Assigned Gifts"
          emptyMessage="No wishes found."
          rootKey={purchaserWishes}
          detailKey={purchaserWishDetail}
          invalidationKeys={[purchaserWishes]}
          listFn={purchaserListWishes}
          columnResourceKey="purchaserAssignedGifts"
          familyColumn={{ key: "family_display_id", sortable: false }}
          detailFn={purchaserGetWish}
          updateFn={purchaserUpdateWish}
          markPurchasedFn={purchaserMarkPurchased}
          batchMarkPurchasedFn={purchaserBatchMarkPurchased}
          renderFamilyCell={(w) =>
            w.wish_lock_level === "admin" ? (
              <Link to={route.familyWishList(w.family_id)} className="text-btn-start hover:underline">
                {w.family_display_id}
              </Link>
            ) : (
              <span>{w.family_display_id}</span>
            )
          }
        />
      </main>
    </div>
  );
}
