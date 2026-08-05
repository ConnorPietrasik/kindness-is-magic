/**
 * Wish cell components for person list tables.
 *
 * Renders wish descriptions with inline size (e.g. "Sweater (M)").
 * Adults (age ≥ 18) get a single wish spanning Fun + Practical columns.
 * Children get separate columns per wish type.
 */

import type { WishSummary } from "../types";
import { Td } from "./Table";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function wishText(wish: { description: string; size: string | null }): string {
  return wish.description + (wish.size ? ` (${wish.size})` : "");
}

/* ------------------------------------------------------------------ */
/* Adult — single wish spanning both columns                           */
/* ------------------------------------------------------------------ */

/** Renders an adult's single wish across Fun + Practical columns (colSpan=2). */
export function WishCellAdult({ wishes }: { wishes: WishSummary[] }) {
  const wish = wishes.find((w) => !w.deleted_at && w.type === "adult");
  return <Td colSpan={2}>{wish ? wishText(wish) : "—"}</Td>;
}

/* ------------------------------------------------------------------ */
/* Child — single wish type column                                     */
/* ------------------------------------------------------------------ */

/** Renders a single wish-type column (fun or practical) for a child. */
export function WishCellType({ wishes, type }: { wishes: WishSummary[]; type: "fun" | "practical" }) {
  const wish = wishes.find((w) => !w.deleted_at && w.type === type);
  return <Td>{wish ? wishText(wish) : "—"}</Td>;
}
