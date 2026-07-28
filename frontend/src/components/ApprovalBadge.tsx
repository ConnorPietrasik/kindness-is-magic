/**
 * ApprovalBadge — colored badge for referrer approval status.
 *
 * Shared between AdminReferrers and AdminInviteCodes.
 */

import type { ReferrerApprovalStatus } from "../types";

const STYLES: Record<ReferrerApprovalStatus, string> = {
  approved: "rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700",
  pending: "rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700",
  rejected: "rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700",
};

export function ApprovalBadge({ status }: { status: ReferrerApprovalStatus }) {
  return <span className={STYLES[status]}>{status}</span>;
}
