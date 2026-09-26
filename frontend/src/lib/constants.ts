/**
 * Shared frontend constants.
 *
 * Pricing/payment-window constants mirror `backend/app/config.py` (same
 * names, same values). Prices are used for *display* math on the uncommitted
 * (frontend-local) cart only — the server recomputes the total at checkout,
 * and that recompute is the source of truth. The payment-window hours feed
 * user-facing copy (a future backend change must update this mirror too).
 */

/** Base price of a cash sponsorship per family (USD). */
export const CASH_CLAIM_AMOUNT_USD = 500;

/** Optional per-family groceries add-on (USD). */
export const CASH_CLAIM_GROCERIES_AMOUNT_USD = 100;

/** Pending cash claims expire this many hours after creation (backend sweeps them). */
export const CASH_CLAIM_PAYMENT_HOURS = 48;

/**
 * Settled donor reassurance copy — shown wherever a cash claim is unpaid
 * (cart waiting state incl. the mismatch banner, pending-claim views) so a
 * donor whose payment doesn't auto-match never thinks the money was lost.
 */
export const PAYMENT_REASSURANCE_COPY = "If your payment doesn't match automatically, an admin will review it within a day.";
