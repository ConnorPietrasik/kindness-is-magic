/**
 * Wish cell components for person list tables.
 *
 * Renders wish descriptions with inline size and color (e.g. "Sweater (M, Blue)").
 * Adults (age ≥ 18) get a single wish spanning Fun + Practical columns.
 * Children get separate columns per wish type.
 */

import type { WishSummary } from "../types";
import { Td } from "./Table";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Format a wish as "Description (size, color)" — present parts joined by ", ",
 * parentheses omitted when both are empty (e.g. "Sweater (M, Blue)", "Sweater").
 */
export function wishText(wish: { description: string; size: string | null; color: string | null }): string {
  const parts = [wish.size, wish.color].filter((p): p is string => p != null && p !== "");
  return parts.length > 0 ? `${wish.description} (${parts.join(", ")})` : wish.description;
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
