/**
 * ApprovalBadge — colored badge for referrer approval status and family verification status.
 *
 * Shared between admin referrer/invite views (approval) and admin family views (verification).
 */

import type { FamilyVerificationStatus, ReferrerApprovalStatus } from "../types";

export type ApprovalBadgeStatus = ReferrerApprovalStatus | FamilyVerificationStatus;

const STYLES: Record<ApprovalBadgeStatus, string> = {
  approved: "rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700",
  verified: "rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700",
  pending: "rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700",
  rejected: "rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700",
};

export function ApprovalBadge({ status }: { status: ApprovalBadgeStatus }) {
  return <span className={STYLES[status]}>{status}</span>;
}
