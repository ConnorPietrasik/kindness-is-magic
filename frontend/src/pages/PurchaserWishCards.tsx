/**
 * Purchaser — Wish Cards
 *
 * Printable wish-card sheet covering every active wish assigned to the
 * current purchaser: the shared WishCardsPage scoped to the purchaser's
 * assigned gifts. No family PII — the cards are keyed by display IDs,
 * exactly like the public sheet.
 */

import { WishCardsPage } from "../components/WishCardsPage";
import { purchaserGetWishCards } from "../lib/api";
import { purchaserWishCards } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

export default function PurchaserWishCards() {
  return (
    <WishCardsPage
      listFn={purchaserGetWishCards}
      queryKey={purchaserWishCards}
      backTo={ROUTES.PURCHASER_ASSIGNED_GIFTS}
      backLabel="Assigned Gifts"
    />
  );
}
