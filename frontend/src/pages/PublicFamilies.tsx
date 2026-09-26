/**
 * Public Families Browse Page
 *
 * Lists all fully-approved families as tappable cards for donors.
 * No authentication required — the public entry point is the brochure at /home.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { PageError } from "../components/PageError";
import { Pagination } from "../components/Pagination";
import { PublicHeader } from "../components/PublicHeader";
import { SiteFooter } from "../components/SiteFooter";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { donorListClaims, listPublicFamilies, type PublicFamiliesListParams } from "../lib/api";
import { donorClaims, publicFamilies } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { type FamilyClaimSummary, isPendingCash, type PublicFamilySummary } from "../types";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Show the milestone banner once this many families are fully sponsored. */
const FULLY_SPONSORED_MILESTONE = 5;

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
  sort: SortValue;
  showSponsored: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  minPersonCount: "",
  maxPersonCount: "",
  sort: null,
  showSponsored: false,
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function PublicFamilies() {
  const { isAdmin, isClaimCapable } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page")) || 1;

  // Sort is persisted in URL so it survives refresh. The show-claimed toggle
  // is admin-only — an admin's shared ?include_claimed=true link must not
  // reveal claimed families to non-admins.
  const urlSort = searchParams.get("sort");
  const initialSort: SortValue = SORT_CYCLE.includes(urlSort as SortValue) ? (urlSort as SortValue) : null;
  const initialShowSponsored = isAdmin && searchParams.get("include_claimed") === "true";

  // "Sponsored by me" section — the claimant's own claims, visible regardless
  // of the show-claimed toggle. One card per claim; the grid dedupes these
  // families out when claimed families are revealed.
  const { data: myClaims } = useQuery({
    queryKey: donorClaims,
    queryFn: () => donorListClaims(),
    enabled: isClaimCapable,
  });
  const myClaimFamilyIds = useMemo(() => new Set((myClaims ?? []).map((c) => c.family.id)), [myClaims]);

  // Local filter inputs (sort + sponsored toggle start from URL)
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    sort: initialSort,
    showSponsored: initialShowSponsored,
  }));

  // Debounced filter values (300ms) — writes sort + sponsored toggle to URL, resets page
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
      if (isAdmin && filters.showSponsored) {
        params.set("include_claimed", "true");
      } else {
        params.delete("include_claimed");
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
  if (debouncedFilters.sort) apiParams.sort = debouncedFilters.sort;
  if (isAdmin && debouncedFilters.showSponsored) apiParams.include_claimed = true;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...publicFamilies, apiParams],
    queryFn: () => listPublicFamilies(apiParams),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PublicHeader />
        <PageError
          error={error}
          heading="Unable to Load Families"
          fallback="Something went wrong. Please try again later."
          to={ROUTES.ROOT}
          linkLabel="← Back to home"
        />
        <SiteFooter />
      </div>
    );
  }

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleShowSponsoredChange = (checked: boolean) => {
    setFilters((prev) => ({ ...prev, showSponsored: checked }));
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
      <PublicHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Families Needing Gifts</h1>
          <p className="mt-1 text-sm text-gray-500">Browse families and view their wish lists to help this holiday season.</p>
        </div>

        {/* Sponsored by me — the claimant's own claims, above the grid */}
        {myClaims && myClaims.length > 0 && (
          <section aria-label="Sponsored by me" className="mb-6">
            <h2 className="mb-3 text-lg font-bold text-gray-900">Sponsored by me</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myClaims.map((claim) => (
                <SponsoredClaimCard key={claim.id} claim={claim} />
              ))}
            </div>
          </section>
        )}

        {/* Milestone banner — shown once enough families are fully sponsored */}
        {data.fulfilled_count >= FULLY_SPONSORED_MILESTONE && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            🎉 {data.fulfilled_count} families fully sponsored so far
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="min-person-count" className="text-xs font-medium text-gray-500">
              Min Family Members
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
              Max Family Members
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

          <button
            type="button"
            onClick={cycleSort}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
            aria-label={`Sort: ${sortLabel}`}
          >
            Sort: {sortLabel}
          </button>

          {isAdmin && (
            <label htmlFor="show-claimed" className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm font-medium text-gray-700">
              <input
                id="show-claimed"
                type="checkbox"
                checked={filters.showSponsored}
                onChange={(e) => handleShowSponsoredChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Show sponsored families
            </label>
          )}

          {(filters.minPersonCount || filters.maxPersonCount || filters.sort || filters.showSponsored) && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
            >
              Clear
            </button>
          )}
        </div>

        {/* Card grid — the claimant's own claimed families are deduped out
            (they appear in the "Sponsored by me" section instead) */}
        {data.families.filter((family) => !myClaimFamilyIds.has(family.id)).length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm">
            <p className="text-gray-500">No families available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.families
              .filter((family) => !myClaimFamilyIds.has(family.id))
              .map((family) => (
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

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Family Card                                                         */
/* ------------------------------------------------------------------ */

/** Claim chip on a revealed (include_claimed) family card. */
const CLAIM_CHIP: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "bg-amber-100 text-amber-800" },
  active: { label: "Sponsored", cls: "bg-emerald-100 text-emerald-800" },
  fulfilled: { label: "Fulfilled", cls: "bg-slate-200 text-slate-600" },
};

function FamilyCard({ family }: { family: PublicFamilySummary }) {
  const chip = family.claim_status != null ? CLAIM_CHIP[family.claim_status] : null;

  return (
    <Link to={route.familyWishList(family.id)}>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-gray-900">{family.display_id}</span>
          {chip && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${chip.cls}`}>
              {chip.label}
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

/* ------------------------------------------------------------------ */
/* Sponsored-by-me card                                                */
/* ------------------------------------------------------------------ */

/** Per-claim chip: pending cash → amber, other active → green, fulfilled → grey. */
function sponsoredClaimChip(claim: FamilyClaimSummary): { label: string; cls: string } {
  if (claim.fulfilled_at != null) return CLAIM_CHIP.fulfilled!;
  if (isPendingCash(claim)) return CLAIM_CHIP.pending!;
  return CLAIM_CHIP.active!;
}

function SponsoredClaimCard({ claim }: { claim: FamilyClaimSummary }) {
  const navigate = useNavigate();
  const chip = sponsoredClaimChip(claim);
  const pending = isPendingCash(claim);

  return (
    <Link to={route.familyWishList(claim.family.id)}>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-gray-900">{claim.family.display_id}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${chip.cls}`}>
            {chip.label}
          </span>
        </div>

        {claim.family.bio && <p className="mb-3 line-clamp-2 text-sm text-gray-600">{claim.family.bio}</p>}

        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span className="font-medium">
            {claim.family.person_count} {claim.family.person_count === 1 ? "member" : "members"}
          </span>
          {claim.family.min_age != null && <span>Ages {formatAgeRange(claim.family.min_age, claim.family.max_age)}</span>}
        </div>

        {pending && (
          <button
            type="button"
            onClick={(e) => {
              // Go to the cart without following the card's wish-list link.
              e.preventDefault();
              e.stopPropagation();
              navigate(ROUTES.DONOR_CART);
            }}
            className="mt-3 inline-block text-xs font-medium text-btn-start hover:underline"
          >
            Go to cart →
          </button>
        )}
      </Card>
    </Link>
  );
}
