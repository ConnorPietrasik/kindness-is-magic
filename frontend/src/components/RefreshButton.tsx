import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useToast } from "../context/ToastContext";
import { auth } from "../lib/queryKeys";
import { formatApiError } from "../lib/utils";

/**
 * Queries the refresh button acts on: the active (mounted) app-data queries.
 * The root-level session query (`auth`) is excluded — it stays mounted on
 * every page (so counting it would keep the button visible on pages with no
 * data), and it doesn't go stale on its own (staleTime: Infinity). Matched by
 * exact key, not first segment, so a future ["auth", …] sub-query would still
 * be counted and refetched.
 */
const isAuthQuery = (query: { queryKey: readonly unknown[] }): boolean =>
  query.queryKey.length === auth.length && query.queryKey.every((seg, i) => seg === auth[i]);

const REFRESH_FILTER = {
  type: "active",
  predicate: (query: { queryKey: readonly unknown[] }) => !isAuthQuery(query),
} as const;

/**
 * RefreshButton — ghost icon button for the header that refetches every
 * active (mounted) app-data query on the current page, so users can force
 * fresh data without navigating. Spins while in flight and toasts the outcome.
 *
 * Renders only while the current page has active app-data queries — on a
 * static page the button would be a no-op. Activity is tracked reactively via
 * the query cache: observer attach/detach (query mount/unmount) fires cache
 * events, so the button appears and disappears as the page's queries do.
 */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const queryCache = queryClient.getQueryCache();
  const subscribe = useCallback((onStoreChange: () => void) => queryCache.subscribe(onStoreChange), [queryCache]);
  const hasAppData = useSyncExternalStore(subscribe, () => queryCache.findAll(REFRESH_FILTER).length > 0);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // REFRESH_FILTER — refetch exactly the mounted app-data queries on this
      // page (what's on screen), not every query still in the cache.
      // throwOnError — refetchQueries swallows per-query errors by default, so
      // pass this to surface a failure (any app-data query that errors) to the
      // toast.
      await queryClient.refetchQueries(REFRESH_FILTER, { throwOnError: true });
      toast.success("Data refreshed");
    } catch (error) {
      toast.error(formatApiError(error, "Refresh failed"));
    } finally {
      setRefreshing(false);
    }
  };

  if (!hasAppData) return null;

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      aria-label="Refresh data"
      title="Refresh data"
      className="rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
