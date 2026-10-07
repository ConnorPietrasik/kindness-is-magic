/**
 * WishTipsPanel — collapsible wish-writing tips digest for the family
 * "Manage People" page.
 *
 * Open by default; once the family closes it, the closed state is sticky —
 * persisted in localStorage under `wish-tips-closed` — so it stays closed on
 * later visits. Re-opening clears the flag, remembering the last action.
 * This is a plain local UI preference (same category as the CartContext
 * localStorage draft), not server state: no API or React Query involved.
 * The collapse interaction follows the InternalNotesSection pattern.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../lib/routes";

const WISH_TIPS_CLOSED_KEY = "wish-tips-closed";

/** 5-item digest of the guide's tips (the full guide carries the examples). */
const TIPS = [
  "Every individual wish has a $50 price limit.",
  "Every family member gets a gift: children (under 18) get one practical wish and one fun wish, adults (18+) get one wish, and your family gets one wish for the whole household.",
  'Be specific — include the size, color, and any details (e.g. "purple size XL sweatshirt with a giraffe on it").',
  "Wishes must be real, purchasable items — we can't ask donors for gift cards.",
  "The full guide has plenty of great fun and practical examples to copy.",
] as const;

export function WishTipsPanel() {
  const [expanded, setExpanded] = useState<boolean>(() => localStorage.getItem(WISH_TIPS_CLOSED_KEY) === null);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      localStorage.removeItem(WISH_TIPS_CLOSED_KEY);
    } else {
      localStorage.setItem(WISH_TIPS_CLOSED_KEY, "1");
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-violet-100 bg-violet-50/60 px-5 py-4 shadow-sm">
      <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-gray-700">💡 How to write a great wish</span>
        <span
          className="text-gray-400 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
      </button>

      {expanded && (
        <div className="mt-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <Link to={ROUTES.WISH_LIST_GUIDE} className="mt-2 inline-block text-sm font-medium text-btn-start hover:underline">
            See the full wish list guide
          </Link>
        </div>
      )}
    </div>
  );
}
