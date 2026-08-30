import { Link } from "react-router-dom";
import { route } from "../lib/routes";

export interface ClaimBadgeProps {
  status: string;
  commitmentType: string;
  donorName?: string;
  claimId?: number;
}

/**
 * ClaimBadge — pill showing a family's claim status and commitment type.
 * Links to the claim detail page when the claim row exists.
 */
export function ClaimBadge({ status, commitmentType, donorName, claimId }: ClaimBadgeProps) {
  const colorMap: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 border-emerald-200",
    fulfilled: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const cls = colorMap[status] ?? "bg-blue-100 text-blue-800 border-blue-200";

  if (claimId != null) {
    return (
      <Link
        to={route.donorClaimDetail(claimId)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls} cursor-pointer transition-colors hover:opacity-80`}
      >
        {status} — {commitmentType}
        {donorName && <span className="text-[11px] opacity-75">({donorName})</span>}
      </Link>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status} — {commitmentType}
      {donorName && <span className="text-[11px] opacity-75">({donorName})</span>}
    </span>
  );
}
