import { Link } from "react-router-dom";
import { formatApiError } from "../lib/utils";

interface PageErrorProps {
  /** Query error from `useQuery` (may be `undefined` when `data` is missing without an error). */
  error: unknown;
  /** Neutral heading, e.g. "Unable to Load Claim". */
  heading: string;
  /** Message shown when the error has no extractable detail (network failures, etc.). */
  fallback: string;
  /** Optional target for a back link. */
  to?: string;
  /** Back link label (defaults to "← Back"). */
  linkLabel?: string;
}

/**
 * PageError — full-page error state for failed queries.
 *
 * Shows the API error detail directly (via `formatApiError`) so user-facing
 * backend messages (404, 403, ...) are displayed as-is, and falls back to a
 * page-specific message for errors without a detail (e.g. network failures).
 */
export function PageError({ error, heading, fallback, to, linkLabel = "← Back" }: PageErrorProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
      <h2 className="mb-2 text-xl font-bold text-gray-900">{heading}</h2>
      <p className="text-gray-500">{formatApiError(error, fallback)}</p>
      {to && (
        <Link to={to} className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
          {linkLabel}
        </Link>
      )}
    </main>
  );
}
