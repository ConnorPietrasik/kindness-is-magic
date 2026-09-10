import { useQuery } from "@tanstack/react-query";
import { listDeadlines } from "../lib/api";
import { type BannerDeadline, getBannerDeadline } from "../lib/deadlines";
import { deadlines } from "../lib/queryKeys";
import type { DeadlineListResponse, DeadlineType } from "../types";

/**
 * useDeadlineBanner — the banner deadline for a type, from the single
 * globally cached public `deadlines` query + the pure selection helper.
 *
 * Returns null when the type has no dated `display`/`enforced` row (nothing
 * to show). All banner placements share this hook, so the rows are fetched
 * once and reused across the app.
 */
export function useDeadlineBanner(type: DeadlineType, listFn: () => Promise<DeadlineListResponse> = listDeadlines): BannerDeadline | null {
  const { data } = useQuery({
    queryKey: deadlines,
    queryFn: listFn,
  });
  return getBannerDeadline(data?.deadlines, type);
}
