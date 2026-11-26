/**
 * WishCardsPage — shared printable wish-card sheet page.
 *
 * Used by the purchaser's sheet (every wish assigned to them) and the
 * admin's own sheet ("My Assigned Gifts"): same header, toolbar, states,
 * and the `WishCardSheet` 2×2 US Letter grid with its print styles. The
 * page is read-only — print and attach each card to its gift.
 *
 * The endpoint sends family blocks in the assigned-gifts list's grouped
 * default order (re-sorting the list does not change the sheet), each
 * leading with its family-wish card (when assigned), then people in id
 * order with each person's wishes in practical → fun → adult order.
 * No family PII — the cards are keyed by display IDs.
 */

import { useQuery } from "@tanstack/react-query";
import type { WishCardFamily } from "../types";
import { Button } from "./Button";
import { BackLink, HeaderBar } from "./HeaderBar";
import { PageError } from "./PageError";
import { PageSpinner } from "./Spinner";
import { buildWishCardsFromGroups, WishCardSheet, WishCardView } from "./WishCards";

export interface WishCardsPageProps {
  /** Fetch the family-grouped wish-card data for the current user. */
  listFn: () => Promise<WishCardFamily[]>;
  /** React Query key for the sheet. */
  queryKey: readonly unknown[];
  /** Back-link destination (header and error state) — the user's assigned-gifts list. */
  backTo: string;
  /** Back-link label (e.g. "Assigned Gifts", "My Assigned Gifts"). */
  backLabel: string;
}

export function WishCardsPage({ listFn, queryKey, backTo, backLabel }: WishCardsPageProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: listFn,
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar className="no-print" left={<BackLink to={backTo} label={backLabel} />} />
        <PageError
          error={error}
          heading="Unable to Load Wish Cards"
          fallback="Unable to load your wish cards. Please try again."
          to={backTo}
          linkLabel={`← Back to ${backLabel.toLowerCase()}`}
        />
      </div>
    );
  }

  const cards = buildWishCardsFromGroups(data);

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar className="no-print" left={<BackLink to={backTo} label={backLabel} />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* No-print toolbar */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Wish Cards</h1>
            <p className="mt-1 text-sm text-gray-600">
              One card per gift you are assigned — grouped by family, in your assigned gifts list's default order. Print and attach each
              card to its gift.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              The numbers are each person's individual ID, and the final letter is the wish type.
            </p>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            🖨️ Print
          </Button>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No wishes to print yet.</p>
            <p className="mt-1 text-sm text-gray-400">No wishes are assigned to you right now.</p>
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
