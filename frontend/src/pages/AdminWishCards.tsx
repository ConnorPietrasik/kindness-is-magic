/**
 * Admin — Blank Wish Cards
 *
 * Printable sheet of blank wish cards: the same card layout as the
 * data-driven cards on /families/:id/wish-cards, but with field labels
 * (wish ID, name, age, wish type, wish, size, color) — no ruled lines —
 * so an admin can handwrite the details and attach a card to each gift.
 *
 * Fully static — the page is behind the admin-only route but makes no API
 * calls; the card counts are local UI state. The blank card chrome
 * re-implements the filled card layout page-locally (the grid and print
 * styles come from the shared `WishCardSheet`).
 */

import { useState } from "react";
import { Button } from "../components/Button";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { Logo } from "../components/Logo";
import { WishCardSheet } from "../components/WishCards";
import { ROUTES } from "../lib/routes";

/* ------------------------------------------------------------------ */
/* Card model                                                          */
/* ------------------------------------------------------------------ */

export interface BlankCard {
  /** Stable React key — "person-0…" or "family-0…". */
  key: string;
  kind: "person" | "family";
}

/** Max cards per type — keeps the sheet manageable and the inputs bounded. */
const MAX_CARDS = 24;

/** Clamp one raw count: non-integer → truncate, negative/NaN → 0, > 24 → 24. */
function clampCount(count: number): number {
  const truncated = Math.trunc(count);
  if (Number.isNaN(truncated)) return 0;
  return Math.min(MAX_CARDS, Math.max(0, truncated));
}

/**
 * Build the blank card set from the two toolbar counts: person cards first,
 * then family cards, one card per unit.
 */
export function buildBlankCards(personCount: number, familyCount: number): BlankCard[] {
  const cards: BlankCard[] = [];
  for (let i = 0; i < clampCount(personCount); i++) cards.push({ key: `person-${i}`, kind: "person" });
  for (let i = 0; i < clampCount(familyCount); i++) cards.push({ key: `family-${i}`, kind: "family" });
  return cards;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminWishCards() {
  // Raw input values as typed (local UI state — there is no server data);
  // empty/garbage text is clamped to 0 by buildBlankCards.
  const [personCount, setPersonCount] = useState("3");
  const [familyCount, setFamilyCount] = useState("1");

  const cards = buildBlankCards(Number(personCount), Number(familyCount));

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar className="no-print" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* No-print toolbar */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Blank Wish Cards</h1>
            <p className="mt-1 text-sm text-gray-600">Print these cards, handwrite the details, and attach each card to its gift.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <label htmlFor="person-cards" className="flex items-center gap-2 text-sm font-medium text-gray-700">
                Person cards
                <input
                  id="person-cards"
                  type="number"
                  min={0}
                  max={24}
                  autoComplete="off"
                  value={personCount}
                  onChange={(e) => setPersonCount(e.target.value)}
                  className="w-20 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                />
              </label>
              <label htmlFor="family-cards" className="flex items-center gap-2 text-sm font-medium text-gray-700">
                Family cards
                <input
                  id="family-cards"
                  type="number"
                  min={0}
                  max={24}
                  autoComplete="off"
                  value={familyCount}
                  onChange={(e) => setFamilyCount(e.target.value)}
                  className="w-20 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                />
              </label>
            </div>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            🖨️ Print
          </Button>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No cards to print — set the counts above.</p>
          </div>
        ) : (
          <WishCardSheet>
            {cards.map((card) => (
              <BlankCardView key={card.key} card={card} />
            ))}
          </WishCardSheet>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function BlankCardView({ card }: { card: BlankCard }) {
  if (card.kind === "family") {
    return (
      <article className="wish-card wish-card--family flex flex-col rounded-xl border-2 border-green-700 bg-green-50 p-5">
        <CardIdLine className="text-green-900" />
        <h2 className="mt-4 text-2xl font-bold text-green-900">Family Wish</h2>
        {/* Wish field — the label tops the rest of the card, which stays
            blank for handwriting */}
        <div className="mt-3 flex-1">
          <p className="text-xl font-semibold text-green-900">Wish:</p>
        </div>
        <div className="text-lg font-semibold text-green-900">
          <SizeColorLines />
        </div>
      </article>
    );
  }

  return (
    <article className="wish-card flex flex-col rounded-xl border border-slate-300 bg-white p-5">
      <CardIdLine className="text-gray-700" />
      {/* Name label at the filled card's heading size */}
      <h2 className="mt-4 text-2xl font-bold text-gray-900">Name:</h2>
      {/* Subline with the age and wish-type labels — the wide gap after
          "Age:" is the space to write the age in */}
      <p className="mt-1 flex items-center gap-x-8 text-sm font-medium text-gray-600">
        <span>Age:</span>
        <span>Wish type:</span>
      </p>
      {/* Wish field — the label tops the rest of the card, which stays blank
          for handwriting */}
      <div className="mt-3 flex-1">
        <p className="text-xl font-semibold text-gray-900">Wish:</p>
      </div>
      <div className="text-lg font-semibold text-gray-900">
        <SizeColorLines />
      </div>
    </article>
  );
}

/**
 * Card header shared by both variants: logo in the 1/3 cell; printed "#"
 * in the 2/3 block — the admin writes the wish ID next to it.
 */
function CardIdLine({ className }: { className: string }) {
  return (
    <div className="flex items-center">
      <div className="flex w-1/3 justify-center">
        <Logo className="h-24 w-24" variant="print" />
      </div>
      <span className={`w-2/3 font-mono text-4xl font-black leading-none ${className}`}>#</span>
    </div>
  );
}

/** Size and color labels (both variants). */
function SizeColorLines() {
  return (
    <>
      <p>Size:</p>
      <p className="mt-2">Color:</p>
    </>
  );
}
