/**
 * Family Wish Cards — Public Page
 *
 * Printable wish-card sheet: one card per active wish — people in id order,
 * each person's wishes in practical → fun → adult order (adults: adult),
 * then the family-wish card last — packed 4 per US Letter page (2×2 grid).
 * The card layout and print styles are shared with the purchaser's sheet
 * via `WishCardSheet`/`WishCardView`.
 * Donors print the sheet (linked from the gift-claim confirmation email)
 * and attach each card to the gift they buy for that wish.
 *
 * No authentication required — donors arriving from the email may be logged
 * out. Data comes from the public wish-list endpoint (same query key as
 * FamilyWishList).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { HeaderBar } from "../components/HeaderBar";
import { PageError } from "../components/PageError";
import { PageSpinner } from "../components/Spinner";
import { orderWishesForCards, personCard, type WishCard, WishCardSheet, WishCardView } from "../components/WishCards";
import { getFamilyWishList } from "../lib/api";
import { familyWishList } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import type { FamilyWishListResponse } from "../types";

/* ------------------------------------------------------------------ */
/* Card mapping                                                        */
/* ------------------------------------------------------------------ */

/**
 * Flatten a wish-list response into the printable card set: people in list
 * (id) order, each person's wishes in practical → fun → adult order, then
 * the family-wish card last (absent when the family has no family wish).
 */
export function buildWishCards(list: FamilyWishListResponse): WishCard[] {
  const cards: WishCard[] = [];
  for (const person of list.people) {
    for (const wish of orderWishesForCards(person.wishes)) {
      cards.push(personCard(person, wish));
    }
  }
  const familyWish = list.family_wish;
  if (familyWish) {
    cards.push({
      key: "family",
      kind: "family",
      display_id: familyWish.display_id ?? list.display_id,
      name: null,
      age: null,
      wish_type: null,
      description: familyWish.description,
      size: familyWish.size,
      color: familyWish.color,
    });
  }
  return cards;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyWishCards() {
  const { id } = useParams<{ id: string }>();
  const familyId = id ? parseInt(id, 10) : NaN;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: familyWishList(familyId),
    queryFn: () => getFamilyWishList(familyId),
    enabled: !Number.isNaN(familyId),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar className="no-print" left={<BackToWishList familyId={familyId} />} />
        <PageError
          error={error}
          heading="Unable to Load Wish Cards"
          fallback="This wish list doesn't exist or has been removed."
          to={ROUTES.ROOT}
          linkLabel="← Back to home"
        />
      </div>
    );
  }

  const cards = buildWishCards(data);

  return (
    <div className="min-h-screen bg-slate-100">
      <HeaderBar className="no-print" left={<BackToWishList familyId={familyId} />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* No-print toolbar */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Wish Cards</h1>
            <p className="mt-1 text-sm text-gray-600">
              Family ID: {data.display_id} — To help us stay organized, please print and attach each card to its gift.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              The numbers are each person's individual ID, and the final letter is the wish type.
            </p>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No wishes to print yet.</p>
            <p className="mt-1 text-sm text-gray-400">This family has no active wishes.</p>
          </div>
        ) : (
          <WishCardSheet>
            {cards.map((card) => (
              <WishCardView key={card.key} card={card} />
            ))}
          </WishCardSheet>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function BackToWishList({ familyId }: { familyId: number }) {
  return (
    <Link to={route.familyWishList(familyId)} className="text-sm text-white/80 transition-colors hover:text-white">
      ← Back to wish list
    </Link>
  );
}
