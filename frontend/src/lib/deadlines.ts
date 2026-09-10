/**
 * Pure helpers for deadline display (banner deadline selection).
 *
 * The banner deadline (per type) is the nearest dated row with mode
 * `display` or `enforced`: earliest future date if any exists, else the most
 * recent past one (renders as "deadline was …"), else none. `remind` rows are
 * the email channel and never feed the banner; undated rows are inert.
 */

import type { Deadline, DeadlineType } from "../types";

/** The deadline to show in a banner for a type. */
export interface BannerDeadline {
  /** The row's admin-authored label. */
  label: string;
  /** The row's due date (date-only, YYYY-MM-DD). */
  dueDate: string;
  /** "upcoming" when the due date is today or later; "past" otherwise. */
  status: "upcoming" | "past";
}

/** A calendar date in the viewer's local timezone (YYYY-MM-DD). */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * getBannerDeadline — the banner deadline for a type.
 *
 * Upcoming/past is judged against the viewer's **local** browser calendar
 * date (no offset math client-side). The banner tracks the announced
 * deadline *day* — which stays in effect through the end of the day, so a
 * row due today is still "upcoming" — not the 01:00 Pacific enforcement
 * cutoff. Date-only strings compare correctly as plain strings.
 */
export function getBannerDeadline(rows: Deadline[] | null | undefined, type: DeadlineType, now: Date = new Date()): BannerDeadline | null {
  const today = localDateKey(now);
  const candidates = (rows ?? []).filter(
    (row): row is Deadline & { due_date: string } =>
      row.type === type && row.due_date != null && (row.mode === "display" || row.mode === "enforced")
  );
  if (candidates.length === 0) return null;

  const future = candidates.filter((row) => row.due_date >= today);
  if (future.length > 0) {
    const nearest = future.reduce((a, b) => (a.due_date <= b.due_date ? a : b));
    return { label: nearest.label, dueDate: nearest.due_date, status: "upcoming" };
  }

  const mostRecent = candidates.reduce((a, b) => (a.due_date >= b.due_date ? a : b));
  return { label: mostRecent.label, dueDate: mostRecent.due_date, status: "past" };
}
