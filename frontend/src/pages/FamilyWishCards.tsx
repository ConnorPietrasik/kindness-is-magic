/**
 * Family Wish Cards — Public Page
 *
 * Printable wish-card sheet: one card per active wish — people in id order,
 * each person's wishes in practical → fun → adult order (adults: adult),
 * then the family-wish card last — packed 4 per US Letter page (2×2 grid).
 * Each card leads with the wish ID + logo oversized for distance
 * readability — ID block ≈ 2/3 of the card width, logo the remaining 1/3.
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
import { Logo } from "../components/Logo";
import { PageError } from "../components/PageError";
import { PublicHeader } from "../components/PublicHeader";
import { PageSpinner } from "../components/Spinner";
import { getFamilyWishList } from "../lib/api";
import { familyWishList } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import type { FamilyWishListResponse, WishType } from "../types";
import { personRoleLabel } from "../types";

/* ------------------------------------------------------------------ */
/* Card model                                                          */
/* ------------------------------------------------------------------ */

export interface WishCard {
  /** Stable React key — the wish id, or "family" for the family-wish card. */
  key: string;
  kind: "person" | "family";
  /** The wish's own display ID (owner's flat ID + type suffix, e.g. 3-2-1A;
      family wish: 3-2-F) — rendered with a "#" prefix on the card. */
  display_id: string;
  /** "Son Alice" (personRoleLabel + given name) — person cards only. */
  name: string | null;
  /** Person cards only. */
  age: number | null;
  /** Capitalized wish type ("Practical", "Fun") — null for adult wishes
      (the age line stands on its own) and for family cards. */
  wish_type: string | null;
  description: string;
  size: string | null;
  color: string | null;
}

/** Wish types that appear on person cards, in card order (adults have only "adult"). */
const PERSON_WISH_ORDER: WishType[] = ["practical", "fun", "adult"];

/**
 * Flatten a wish-list response into the printable card set: people in list
 * (id) order, each person's wishes in practical → fun → adult order, then
 * the family-wish card last (absent when the family has no family wish).
 */
export function buildWishCards(list: FamilyWishListResponse): WishCard[] {
  const cards: WishCard[] = [];
  for (const person of list.people) {
    const ordered = [...person.wishes]
      .filter((w) => PERSON_WISH_ORDER.includes(w.type))
      .sort((a, b) => PERSON_WISH_ORDER.indexOf(a.type) - PERSON_WISH_ORDER.indexOf(b.type));
    for (const wish of ordered) {
      cards.push({
        key: String(wish.id),
        kind: "person",
        display_id: wish.display_id ?? person.display_id,
        name: `${personRoleLabel(person.role)} ${person.given_name}`,
        age: person.age,
        wish_type: wish.type === "adult" ? null : wishTypeLabel(wish.type),
        description: wish.description,
        size: wish.size,
        color: wish.color,
      });
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

function wishTypeLabel(type: WishType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
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
        <PublicHeader className="no-print" left={<BackToWishList familyId={familyId} />} />
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
      <PublicHeader className="no-print" left={<BackToWishList familyId={familyId} />} />

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
          <div className="wish-cards-grid">
            {cards.map((card) => (
              <WishCardView key={card.key} card={card} />
            ))}
          </div>
        )}
      </main>

      {/* Print styles — US Letter, 2×2 grid, 4 cards per page */}
      <style>{`
        /* @page margin 0 — with any margin, the browser draws its print
           header/footer (date, page title, URL) in that space. The visual
           page margins come from the cards' own print margins instead. */
        @page { size: letter; margin: 0; }
        .wish-cards-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 3.7in));
          gap: 0.2in;
          justify-content: center;
        }
        .wish-card {
          min-height: 4.9in;
          /* Keep each card whole — the browser moves it to the next page
             instead of splitting it across pages. */
          break-inside: avoid;
          page-break-inside: avoid;
          overflow-wrap: break-word;
        }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          main { max-width: none !important; padding: 0 !important; }
          /* Per-page visual margins: every card carries its own top/bottom
             margin — block-level padding/margin would only apply at the
             sheet's start/end, not on each page. 2 rows × (4.9in + 2×0.25in)
             = 10.8in < 11in, so the 2×2 grid still fits per US Letter page. */
          .wish-cards-grid { row-gap: 0; }
          /* B&W print — the family card keeps a heavier border so the two
             card styles stay distinguishable without color. */
          .wish-card {
            margin: 0.25in 0;
            background: white !important;
            color: black !important;
            border-color: black !important;
            box-shadow: none !important;
          }
          .wish-card--family { border-width: 3px !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function WishCardView({ card }: { card: WishCard }) {
  if (card.kind === "family") {
    return (
      <article className="wish-card wish-card--family flex flex-col rounded-xl border-2 border-violet-400 bg-violet-50 p-5">
        {/* ID + logo oversized for distance readability — ID block ≈ 2/3 of
            the card width, logo the remaining 1/3 */}
        <div className="flex items-center">
          <div className="flex w-1/3 justify-center">
            <Logo className="h-24 w-24" />
          </div>
          <span className="w-2/3 text-right font-mono text-4xl font-black leading-none text-violet-800">#{card.display_id}</span>
        </div>
        <h2 className="mt-4 text-2xl font-bold text-violet-900">Family Wish</h2>
        <p className="mt-3 flex-1 text-xl font-semibold leading-snug text-gray-900">{card.description}</p>
        <div className="text-lg font-semibold text-violet-900">
          <SizeColorLines card={card} />
        </div>
      </article>
    );
  }

  return (
    <article className="wish-card flex flex-col rounded-xl border border-slate-300 bg-white p-5">
      {/* ID + logo oversized for distance readability — ID block ≈ 2/3 of
          the card width, logo the remaining 1/3 */}
      <div className="flex items-center">
        <div className="flex w-1/3 justify-center">
          <Logo className="h-24 w-24" />
        </div>
        <span className="w-2/3 text-right font-mono text-4xl font-black leading-none text-gray-700">#{card.display_id}</span>
      </div>
      <h2 className="mt-4 text-2xl font-bold text-gray-900">{card.name}</h2>
      <p className="mt-1 text-sm font-medium text-gray-600">
        Age {card.age}
        {card.wish_type ? ` · ${card.wish_type}` : ""}
      </p>
      <p className="mt-3 flex-1 text-xl font-semibold leading-snug text-gray-900">{card.description}</p>
      <div className="text-lg font-semibold text-gray-900">
        <SizeColorLines card={card} />
      </div>
    </article>
  );
}

/** Size and color lines — each shown only when set. */
function SizeColorLines({ card }: { card: WishCard }) {
  if (!card.size && !card.color) return null;
  return (
    <>
      {card.size ? <p>Size: {card.size}</p> : null}
      {card.color ? <p>Color: {card.color}</p> : null}
    </>
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
