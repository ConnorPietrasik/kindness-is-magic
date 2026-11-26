/**
 * WishCards — shared printable wish-card sheet.
 *
 * Used by the public per-family sheet (FamilyWishCards) and the purchaser's
 * sheet covering every assigned wish (PurchaserWishCards): the same card
 * layout, 2×2 US Letter grid (4 cards per page), and print styles (B&W,
 * cards unsplit, screen chrome hidden).
 *
 * Each card leads with the wish ID + logo oversized for distance
 * readability — the ID block takes ~2/3 of the card width, the logo the
 * remaining 1/3. The family-wish card keeps a heavier green border so the
 * two card styles stay distinguishable in B&W.
 *
 * Print contract (e2e asserts on it): `.wish-cards-grid` is 2 columns,
 * `article.wish-card` keeps `break-inside: avoid` under print media, and
 * `@page` margin is 0 so the browser skips its print header/footer — the
 * cards' own 0.25in print margins keep content off the paper edge on every
 * page.
 */

import type { ReactNode } from "react";
import type { DonorWishSummary, PersonRole, WishCardFamily, WishType } from "../types";
import { personRoleLabel } from "../types";
import { Logo } from "./Logo";

/* ------------------------------------------------------------------ */
/* Card model                                                          */
/* ------------------------------------------------------------------ */

export interface WishCard {
  /** Stable React key — the wish's id (the family-wish card uses its wish id too). */
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

/* ------------------------------------------------------------------ */
/* Person-card mapping (shared by the public and purchaser sheets)    */
/* ------------------------------------------------------------------ */

/** A person-shaped owner for the person cards — matches both the public
    list's `PersonWishItem` and the assigned-gift sheets' `WishCardPerson`. */
export interface WishCardPersonOwner {
  display_id: string;
  given_name: string;
  role: PersonRole;
  age: number;
  wishes: DonorWishSummary[];
}

/** Wish types that appear on person cards, in card order (adults have only "adult"). */
const PERSON_WISH_ORDER: WishType[] = ["practical", "fun", "adult"];

function wishTypeLabel(type: WishType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** A person's wishes in card order (practical → fun → adult), dropping wish
    types that don't appear on person cards. */
export function orderWishesForCards(wishes: DonorWishSummary[]): DonorWishSummary[] {
  return [...wishes]
    .filter((w) => PERSON_WISH_ORDER.includes(w.type))
    .sort((a, b) => PERSON_WISH_ORDER.indexOf(a.type) - PERSON_WISH_ORDER.indexOf(b.type));
}

/** One card for one of a person's wishes. */
export function personCard(owner: WishCardPersonOwner, wish: DonorWishSummary): WishCard {
  return {
    key: String(wish.id),
    kind: "person",
    display_id: wish.display_id ?? owner.display_id,
    name: `${personRoleLabel(owner.role)} ${owner.given_name}`,
    age: owner.age,
    wish_type: wish.type === "adult" ? null : wishTypeLabel(wish.type),
    description: wish.description,
    size: wish.size,
    color: wish.color,
  };
}

/**
 * Flatten a family-grouped wish-card response (the assigned-gift sheets)
 * into the printable card set: family blocks in list order, each block
 * leading with its family-wish card (when assigned), then people in id
 * order with each person's wishes in the order the endpoint sent them
 * (practical → fun → adult, then id — the sheet does not re-sort).
 */
export function buildWishCardsFromGroups(groups: WishCardFamily[]): WishCard[] {
  const cards: WishCard[] = [];
  for (const fam of groups) {
    const familyWish = fam.family_wish;
    if (familyWish) {
      cards.push({
        key: String(familyWish.id),
        kind: "family",
        display_id: familyWish.display_id ?? fam.display_id,
        name: null,
        age: null,
        wish_type: null,
        description: familyWish.description,
        size: familyWish.size,
        color: familyWish.color,
      });
    }
    for (const person of fam.people) {
      for (const wish of person.wishes) {
        cards.push(personCard(person, wish));
      }
    }
  }
  return cards;
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

export interface WishCardSheetProps {
  /** One card element per card (keyed), in print order. */
  children: ReactNode;
}

/**
 * The 2×2 wish-card grid plus the print styles that ship with it.
 *
 * Four cards fit per US Letter page on screen and under print media alike.
 * The styles are page-agnostic: they target the grid/card classes, the
 * page's `.no-print` chrome, and the page's <main>.
 */
export function WishCardSheet({ children }: WishCardSheetProps) {
  return (
    <>
      <div className="wish-cards-grid">{children}</div>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function WishCardView({ card }: { card: WishCard }) {
  if (card.kind === "family") {
    return (
      <article className="wish-card wish-card--family flex flex-col rounded-xl border-2 border-green-700 bg-green-50 p-5">
        {/* ID + logo oversized for distance readability — ID block ≈ 2/3 of
            the card width, logo the remaining 1/3 */}
        <div className="flex items-center">
          <div className="flex w-1/3 justify-center">
            <Logo className="h-24 w-24" variant="print" />
          </div>
          <span className="w-2/3 text-right font-mono text-4xl font-black leading-none text-green-900">#{card.display_id}</span>
        </div>
        <h2 className="mt-4 text-2xl font-bold text-green-900">Family Wish</h2>
        <p className="mt-3 flex-1 text-xl font-semibold leading-snug text-gray-900">{card.description}</p>
        <div className="text-lg font-semibold text-green-900">
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
          <Logo className="h-24 w-24" variant="print" />
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
