/**
 * ExpiredBadge — the red "Expired" pill shown next to a lapsed invite expiry.
 *
 * Shared by the Invite Codes page and the pending-invites list on the
 * Referrers page so the two views can't drift. The badge renders itself;
 * callers decide *when* to render it (`isExpiredInvite()` from `lib/utils`,
 * the same unredeemed-and-lapsed rule the backend's `?expired=` filter uses),
 * keeping expiry arithmetic out of the presentational component.
 */

export function ExpiredBadge() {
  return <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Expired</span>;
}
