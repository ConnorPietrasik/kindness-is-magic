/**
 * Admin — Thank-You Emails
 *
 * The donors owed a personal thank-you: sponsors with fulfilled
 * sponsorships, plus people who gave through the general donation link
 * (campaign payments not tied to a sponsorship). Each row offers a
 * personalized draft — the shared email composer opens pre-filled and a
 * successful send auto-marks the donor thanked — and a manual
 * "Mark thanked" / "Mark unthanked" for out-of-band thanking (a card in
 * person, an email from the admin's own client, …).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useMemo, useState } from "react";
import { AdminEmailComposer } from "../components/AdminEmailComposer";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnHeader } from "../components/ColumnHeader";
import { ColumnToggle } from "../components/ColumnToggle";
import { DraggableTh } from "../components/DraggableTh";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import { adminListThankYouDonors, adminMarkDonorThanked, adminUnmarkDonorThanked } from "../lib/api";
import { thankYouDonors } from "../lib/queryKeys";
import { buildThankYouDraft } from "../lib/thankYouDraft";
import { formatDateTime, formatUsd } from "../lib/utils";
import type { AdminThankYouDonorsListParams, ThankYouDonor } from "../types";

const THANKED_FILTERS: { value: "" | "unthanked" | "thanked"; label: string }[] = [
  { value: "", label: "All" },
  { value: "unthanked", label: "Not thanked" },
  { value: "thanked", label: "Thanked" },
];

const SOURCE_FILTERS: { value: "" | "claims" | "general" | "both"; label: string }[] = [
  { value: "", label: "All" },
  { value: "claims", label: "Sponsorships" },
  { value: "general", label: "General donations" },
  { value: "both", label: "Both" },
];

/** Backend sort field per column key — undefined → the header is plain
    (not sortable). The source chip is a derived kind with no single field
    to order by. */
const COLUMN_SORT_FIELD: Record<string, string | undefined> = {
  email: "email",
  display_name: "display_name",
  sponsorships: "claim_count",
  general_donations: "general_total_cents",
  thanked: "thanked_at",
};

/** Header labels per column key. */
const COLUMN_HEADERS: Record<string, string> = {
  email: "Donor",
  display_name: "Name",
  source: "Source",
  sponsorships: "Sponsorships",
  general_donations: "General Donations",
  thanked: "Thanked",
};

/** Read-only reference under the composer title: what the donor gave. */
function DonorContextBlock({ donor }: { donor: ThankYouDonor }) {
  return (
    <div className="space-y-1.5 text-sm">
      {donor.claim_count > 0 && (
        <p>
          <span className="font-medium text-gray-700">
            Sponsorship{donor.claim_count === 1 ? "" : "s"} ({donor.claim_count}):
          </span>{" "}
          <span className="text-gray-600">{donor.claim_family_names.join(", ")}</span>
        </p>
      )}
      {donor.general_payment_count > 0 && (
        <p>
          <span className="font-medium text-gray-700">
            General donation{donor.general_payment_count === 1 ? "" : "s"} ({donor.general_payment_count}):
          </span>{" "}
          <span className="text-gray-600">
            {formatUsd(donor.general_total_cents)} total
            {donor.latest_donation_at ? `, newest ${formatDateTime(donor.latest_donation_at)}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}

function SourceChips({ donor }: { donor: ThankYouDonor }) {
  const chips: { label: string; className: string }[] = [];
  if (donor.claim_count > 0) chips.push({ label: "Sponsorship", className: "bg-emerald-50 text-emerald-700" });
  if (donor.general_payment_count > 0) chips.push({ label: "General", className: "bg-sky-50 text-sky-700" });
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip.label} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}>
          {chip.label}
        </span>
      ))}
    </span>
  );
}

export default function AdminThankYou() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pagination = usePagination({ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] });
  const [thankedFilter, setThankedFilter] = useState<"" | "unthanked" | "thanked">("");
  const [sourceFilter, setSourceFilter] = useState<"" | "claims" | "general" | "both">("");
  const [searchQuery, setSearchQuery] = useState("");
  // Sort: clicking a column header cycles asc → desc → clear ("" → none)
  const [sortField, setSortField] = useState<string>("");

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminThankYou");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminThankYou", visibleColumns);
  const { widthClass } = useTableWidth("adminThankYou");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  // Donor whose draft is open in the composer (null = closed)
  const [draftFor, setDraftFor] = useState<ThankYouDonor | null>(null);
  const draft = useMemo(() => (draftFor ? buildThankYouDraft(draftFor) : null), [draftFor]);

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  // Sort: clicking a column header cycles asc → desc → clear
  const handleSortClick = (field: string) => {
    setSortField((prev) => {
      if (prev === field) return `-${field}`;
      if (prev === `-${field}`) return "";
      return field;
    });
    pagination.goToPage(1);
  };

  const listParams = useMemo<AdminThankYouDonorsListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      search: debouncedSearch || undefined,
      source: sourceFilter || undefined,
      thanked: thankedFilter === "thanked" ? true : thankedFilter === "unthanked" ? false : undefined,
      sort: sortField || undefined,
    }),
    [pagination.params, apiColumns, sourceFilter, thankedFilter, debouncedSearch, sortField]
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: [...thankYouDonors, listParams],
    queryFn: () => adminListThankYouDonors(listParams),
    staleTime: 0, // mutable list — always refetch when viewed (global default is 5min)
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const donors = listData?.donors ?? [];

  const markMut = useMutation({
    mutationFn: (email: string) => adminMarkDonorThanked(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: thankYouDonors });
      toast.success("Marked as thanked");
    },
  });

  const unmarkMut = useMutation({
    mutationFn: (email: string) => adminUnmarkDonorThanked(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: thankYouDonors });
      toast.info("Marked as not thanked");
    },
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Thank-You Emails</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by email, name, or family…"
              aria-label="Search by email, name, or family"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
            <select
              aria-label="Thanked filter"
              value={thankedFilter}
              onChange={(e) => {
                setThankedFilter(e.target.value as "" | "unthanked" | "thanked");
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              {THANKED_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Source filter"
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value as "" | "claims" | "general" | "both");
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              {SOURCE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {!isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            <ColumnToggle resourceKey="adminThankYou" />
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Sponsors whose sponsorships are fulfilled, plus people who gave through the general donation link. Draft a personalized thank-you
          from any row — sending it marks the donor as thanked — or use “Mark thanked” when you thanked them out-of-band.
        </div>

        {/* Table */}
        {donors.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No donors to thank yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              {displayColumns.map((key) => {
                const sortFieldForColumn = COLUMN_SORT_FIELD[key];
                return (
                  <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                    {sortFieldForColumn ? (
                      /* No per-column search on this page — only the sort button */
                      <ColumnHeader
                        label={COLUMN_HEADERS[key] ?? key}
                        field={sortFieldForColumn}
                        sortField={sortField}
                        columnSearch={{}}
                        onSort={handleSortClick}
                        onSearchChange={() => {}}
                      />
                    ) : (
                      COLUMN_HEADERS[key]
                    )}
                  </DraggableTh>
                );
              })}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {donors.map((donor) => {
                const donorCells: Record<string, React.ReactNode> = {
                  email: <Td className="font-medium text-gray-900">{donor.email}</Td>,
                  display_name: <Td className="text-sm text-gray-700">{donor.display_name ?? "—"}</Td>,
                  source: (
                    <Td>
                      <SourceChips donor={donor} />
                    </Td>
                  ),
                  sponsorships:
                    donor.claim_count === 0 ? (
                      <Td className="text-sm text-gray-400">—</Td>
                    ) : (
                      <Td className="text-sm">
                        <div className="text-gray-900">{donor.claim_count} fulfilled</div>
                        <div className="mt-0.5 text-[11px] text-gray-500">{donor.claim_family_names.join(", ")}</div>
                        {donor.latest_fulfilled_at && (
                          <div className="mt-0.5 text-[11px] text-gray-400">Fulfilled {formatDateTime(donor.latest_fulfilled_at)}</div>
                        )}
                      </Td>
                    ),
                  general_donations:
                    donor.general_payment_count === 0 ? (
                      <Td className="text-sm text-gray-400">—</Td>
                    ) : (
                      <Td className="text-sm">
                        <div className="text-gray-900">
                          {donor.general_payment_count} · {formatUsd(donor.general_total_cents)}
                        </div>
                        {donor.latest_donation_at && (
                          <div className="mt-0.5 text-[11px] text-gray-400">Newest {formatDateTime(donor.latest_donation_at)}</div>
                        )}
                      </Td>
                    ),
                  thanked: (
                    <Td className="whitespace-nowrap text-sm">
                      {donor.thanked_at ? (
                        <span className="font-medium text-emerald-600">
                          Thanked {formatDateTime(donor.thanked_at)}
                          {donor.thanked_by_name ? ` by ${donor.thanked_by_name}` : ""}
                        </span>
                      ) : (
                        <span className="text-gray-500">Not thanked</span>
                      )}
                    </Td>
                  ),
                };
                return (
                  <Tr key={donor.email}>
                    {displayColumns.map((key) => (
                      <Fragment key={key}>{donorCells[key]}</Fragment>
                    ))}
                    <Td>
                      <div className="flex items-center gap-2">
                        <Button variant="primary" onClick={() => setDraftFor(donor)}>
                          Draft email
                        </Button>
                        {donor.thanked_at ? (
                          <Button variant="secondary" disabled={unmarkMut.isPending} onClick={() => unmarkMut.mutate(donor.email)}>
                            Mark unthanked
                          </Button>
                        ) : (
                          <Button variant="secondary" disabled={markMut.isPending} onClick={() => markMut.mutate(donor.email)}>
                            Mark thanked
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        <Pagination
          page={pagination.page}
          totalPages={pageInfo.totalPages}
          total={listData?.total ?? 0}
          pageSize={pagination.pageSize}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />

        {/* Personalized draft — pre-filled; a successful send auto-marks thanked */}
        <AdminEmailComposer
          open={draftFor !== null}
          contextLabel={draftFor ? `${draftFor.display_name ?? "General donor"} — ${draftFor.email}` : null}
          context={draftFor ? <DonorContextBlock donor={draftFor} /> : null}
          prefilledRecipient={draftFor?.email ?? null}
          prefilledSubject={draft?.subject ?? null}
          prefilledMessage={draft?.message ?? null}
          onSent={(email) => {
            if (draftFor && email === draftFor.email) markMut.mutate(email);
          }}
          onClose={() => setDraftFor(null)}
        />

        {/* Errors */}
        <MutationErrors mutations={[markMut, unmarkMut]} />
      </main>
    </div>
  );
}
