/**
 * Shared frontend constants.
 *
 * Cash-claim *prices* are deliberately NOT mirrored here: GET /api/donor/cart
 * serves the live config prices (``cash_claim_amount_usd`` /
 * ``cash_claim_groceries_amount_usd``) and the cart page prices every line —
 * committed and local — from the server, so an env-overridden price (e.g. a
 * live $1 test donation) shows up in the cart instead of the stale default.
 *
 * What IS mirrored below is display-only copy: the "sponsor with $500" line on
 * the public families page (``CASH_CLAIM_AMOUNT_USD``) and the payment-window
 * hours in the admin Zeffy copy (``CASH_CLAIM_PAYMENT_HOURS``, a plain code
 * constant on the backend). If those values change in the backend, update this
 * mirror too.
 */

/** Base price of a cash sponsorship per family (USD) — display copy only; the cart prices from the server. */
export const CASH_CLAIM_AMOUNT_USD = 500;

/** Pending cash claims expire this many hours after creation (backend sweeps them). */
export const CASH_CLAIM_PAYMENT_HOURS = 48;

/**
 * Settled donor reassurance copy — shown wherever a cash claim is unpaid
 * (cart waiting state incl. the mismatch banner, pending-claim views) so a
 * donor whose payment doesn't auto-match never thinks the money was lost.
 */
export const PAYMENT_REASSURANCE_COPY = "If your payment doesn't match automatically, an admin will review it within a day.";
