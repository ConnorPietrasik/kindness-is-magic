/**
 * Public Families Browse Page
 *
 * Lists all fully-approved families as tappable cards for donors.
 * No authentication required. Accessible from root `/` redirect.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { HeaderBar, LogoutButton } from "../components/HeaderBar";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { listPublicFamilies, type PublicFamiliesListParams } from "../lib/api";
import { publicFamilies } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import type { PublicFamilySummary } from "../types";

/* ------------------------------------------------------------------ */
/* Sort options                                                        */
/* ------------------------------------------------------------------ */

const SORT_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: "person_count", label: "Family Size ↑" },
  { value: "-person_count", label: "Family Size ↓" },
  { value: "min_age", label: "Youngest ↑" },
  { value: "-min_age", label: "Youngest ↓" },
];
const SORT_CYCLE = ["person_count", "-person_count", "min_age", "-min_age", null] as const;
type SortValue = (typeof SORT_CYCLE)[number];

/* ------------------------------------------------------------------ */
/* Filter state                                                        */
/* ------------------------------------------------------------------ */

interface FilterState {
  minPersonCount: string;
  maxPersonCount: string;
  minAge: string;
  maxAge: string;
  sort: SortValue;
}

const DEFAULT_FILTERS: FilterState = {
  minPersonCount: "",
  maxPersonCount: "",
  minAge: "",
  maxAge: "",
  sort: null,
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function PublicFamilies() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page")) || 1;

  // Sort is persisted in URL so it survives refresh
  const urlSort = searchParams.get("sort");
  const initialSort: SortValue = SORT_CYCLE.includes(urlSort as SortValue) ? (urlSort as SortValue) : null;

  // Local filter inputs (sort starts from URL)
  const [filters, setFilters] = useState<FilterState>(() => ({ ...DEFAULT_FILTERS, sort: initialSort }));

  // Debounced filter values (300ms) — writes sort to URL, resets page
  // Use functional updater so we always read the current URL, not a stale closure.
  const debouncedFilters = useDebouncedState(filters, 300, () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("page");
      if (filters.sort) {
        params.set("sort", filters.sort);
      } else {
        params.delete("sort");
      }
      return params;
    });
  });

  const pageSize = 12;

  // Build API params from debounced filters
  const apiParams: PublicFamiliesListParams = {
    page,
    page_size: pageSize,
  };
  if (debouncedFilters.minPersonCount) apiParams.min_person_count = parseInt(debouncedFilters.minPersonCount, 10);
  if (debouncedFilters.maxPersonCount) apiParams.max_person_count = parseInt(debouncedFilters.maxPersonCount, 10);
  if (debouncedFilters.minAge) apiParams.min_age = parseInt(debouncedFilters.minAge, 10);
  if (debouncedFilters.maxAge) apiParams.max_age = parseInt(debouncedFilters.maxAge, 10);
  if (debouncedFilters.sort) apiParams.sort = debouncedFilters.sort;

  const { data, isLoading, isError } = useQuery({
    queryKey: [...publicFamilies, apiParams],
    queryFn: () => listPublicFamilies(apiParams),
  });

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  // Header adapts to auth state: title links to the dashboard and the right
  // action becomes a sign-out button once the user is logged in.
  const headerTitleTo = user ? ROUTES.DASHBOARD : ROUTES.PUBLIC_FAMILIES;
  const headerRight = user ? (
    <LogoutButton onClick={handleLogout} />
  ) : (
    <Link
      to={ROUTES.LOGIN}
      className="rounded-lg border border-white/30 bg-white/15 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25"
    >
      Sign in
    </Link>
  );

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar title="Kindness is Magic" titleTo={headerTitleTo} right={headerRight} />
        <main className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="mb-2 text-xl font-bold text-gray-900">Unable to Load Families</h2>
          <p className="text-gray-500">Something went wrong. Please try again later.</p>
          <Link to={ROUTES.ROOT} className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
            ← Back to home
          </Link>
        </main>
      </div>
    );
  }

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const cycleSort = () => {
    const currentIndex = SORT_CYCLE.indexOf(debouncedFilters.sort);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % SORT_CYCLE.length : 1;
    const nextSort = SORT_CYCLE[nextIndex] ?? null;
    setFilters((prev) => ({ ...prev, sort: nextSort }));
  };

  const sortLabel = SORT_OPTIONS.find((s) => s.value === debouncedFilters.sort)?.label ?? "Default";

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    if (newPage === 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    setSearchParams(params);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" titleTo={headerTitleTo} right={headerRight} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Families Needing Gifts</h1>
          <p className="mt-1 text-sm text-gray-500">Browse families and view their wish lists to help this holiday season.</p>
        </div>

        {/* Filter bar */}
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="min-person-count" className="text-xs font-medium text-gray-500">
              Min Members
            </label>
            <input
              id="min-person-count"
              type="number"
              min={1}
              value={filters.minPersonCount}
              onChange={(e) => handleFilterChange("minPersonCount", e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-person-count" className="text-xs font-medium text-gray-500">
              Max Members
            </label>
            <input
              id="max-person-count"
              type="number"
              min={1}
              value={filters.maxPersonCount}
              onChange={(e) => handleFilterChange("maxPersonCount", e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="min-age" className="text-xs font-medium text-gray-500">
              Min Age
            </label>
            <input
              id="min-age"
              type="number"
              min={0}
              value={filters.minAge}
              onChange={(e) => handleFilterChange("minAge", e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-age" className="text-xs font-medium text-gray-500">
              Max Age
            </label>
            <input
              id="max-age"
              type="number"
              min={0}
              value={filters.maxAge}
              onChange={(e) => handleFilterChange("maxAge", e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
              autoComplete="off"
            />
          </div>

          <button
            type="button"
            onClick={cycleSort}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
            aria-label={`Sort: ${sortLabel}`}
          >
            Sort: {sortLabel}
          </button>

          {(filters.minPersonCount || filters.maxPersonCount || filters.minAge || filters.maxAge || filters.sort) && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
            >
              Clear
            </button>
          )}
        </div>

        {/* Card grid */}
        {data.families.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm">
            <p className="text-gray-500">No families available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.families.map((family) => (
              <FamilyCard key={family.id} family={family} />
            ))}
          </div>
        )}

        {/* Pagination */}
        <Pagination
          page={data.page}
          totalPages={data.total_pages}
          total={data.total}
          pageSize={data.page_size}
          onPageChange={handlePageChange}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Family Card                                                         */
/* ------------------------------------------------------------------ */

function FamilyCard({ family }: { family: PublicFamilySummary }) {
  return (
    <Link to={route.familyWishList(family.id)}>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-gray-900">{family.display_id}</span>
          {family.claimed_by_current_user && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
              Claimed
            </span>
          )}
        </div>

        {family.bio && <p className="mb-3 line-clamp-2 text-sm text-gray-600">{family.bio}</p>}

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="font-medium">
            {family.person_count} {family.person_count === 1 ? "member" : "members"}
          </span>

          {family.min_age != null && <span>Ages {formatAgeRange(family.min_age, family.max_age)}</span>}
        </div>
      </Card>
    </Link>
  );
}

function formatAgeRange(minAge: number, maxAge: number | null): string {
  if (maxAge == null || minAge === maxAge) {
    return String(minAge);
  }
  return `${minAge}–${maxAge}`;
}
