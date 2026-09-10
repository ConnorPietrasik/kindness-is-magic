import type { ReactNode } from "react";
import type { BannerDeadline } from "../lib/deadlines";
import { formatDay } from "../lib/utils";

interface DeadlineBannerProps {
  /** The banner deadline for the page's type (null → render nothing). */
  result: BannerDeadline | null;
  /** Optional extra line below the deadline (e.g. a waiting-queue count). */
  extra?: ReactNode;
  /** Extra classes (e.g. "no-print" on printable pages). */
  className?: string;
}

const BANNER_TONES = {
  upcoming: "border-blue-200 bg-blue-50 text-blue-800",
  past: "border-gray-200 bg-gray-50 text-gray-600",
} as const;

/**
 * DeadlineBanner — informational banner for an upcoming or past event
 * deadline. Renders nothing when `result` is null.
 *
 * Banners are informational only — they never disable anything on the
 * client (enforcement happens server-side).
 */
export function DeadlineBanner({ result, extra, className = "" }: DeadlineBannerProps) {
  if (!result) return null;

  const upcoming = result.status === "upcoming";
  return (
    <div className={`mb-6 rounded-xl border px-6 py-4 shadow-sm ${BANNER_TONES[upcoming ? "upcoming" : "past"]} ${className}`}>
      <p className="text-sm">
        {upcoming ? (
          <>
            <span className="font-semibold">{result.label}</span> due <span className="font-semibold">{formatDay(result.dueDate)}</span>
          </>
        ) : (
          <>
            <span className="font-semibold">{result.label}</span> deadline was{" "}
            <span className="font-semibold">{formatDay(result.dueDate)}</span>
          </>
        )}
      </p>
      {extra != null && <p className="mt-1 text-sm">{extra}</p>}
    </div>
  );
}
