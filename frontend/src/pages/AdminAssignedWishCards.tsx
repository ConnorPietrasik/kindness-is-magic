/**
 * Admin — Assigned Wish Cards
 *
 * Printable wish-card sheet covering every active wish assigned to the
 * calling admin ("My Assigned Gifts"): the shared WishCardsPage scoped to
 * the admin's own assignments. No family PII on the cards — display IDs
 * only, so each card still matches a gift to its family and person.
 */

import { WishCardsPage } from "../components/WishCardsPage";
import { adminGetAssignedWishCards } from "../lib/api";
import { adminWishCards } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

export default function AdminAssignedWishCards() {
  return (
    <WishCardsPage
      listFn={adminGetAssignedWishCards}
      queryKey={adminWishCards}
      backTo={ROUTES.ADMIN_ASSIGNED_GIFTS}
      backLabel="My Assigned Gifts"
    />
  );
}
