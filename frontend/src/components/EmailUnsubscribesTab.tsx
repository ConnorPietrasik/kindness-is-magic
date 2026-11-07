/**
 * EmailUnsubscribesTab — the "Unsubscribes" tab of the admin Emails page
 *
 * The unsubscribe blocklist: people who clicked an unsubscribe link on any
 * app email. Re-subscribing removes their record and restores all app
 * emails for that address.
 *
 * Rendered by AdminEmails (the page owns the shell, the tabs, and the
 * table width); there is no page chrome here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { adminListEmailUnsubscribes, adminResubscribeEmail } from "../lib/api";
import { adminEmailUnsubscribes } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import type { EmailUnsubscribesListParams } from "../types";
import { Button } from "./Button";
import { Card } from "./Card";
import { ColumnToggle } from "./ColumnToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { DraggableTh } from "./DraggableTh";
import { MutationErrors } from "./MutationErrors";
import { Pagination } from "./Pagination";
import { PageSpinner } from "./Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "./Table";

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */
export function EmailUnsubscribesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pagination = usePagination({ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] });

  const [searchQuery, setSearchQuery] = useState("");
  // Row email whose "Re-subscribe" action is awaiting confirmation (null = closed)
  const [resubscribeConfirm, setResubscribeConfirm] = useState<string | null>(null);

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminEmailUnsubscribes");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminEmailUnsubscribes", visibleColumns);

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const listParams = useMemo<EmailUnsubscribesListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      search: debouncedSearch || undefined,
    }),
    [pagination.params, apiColumns, debouncedSearch]
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: [...adminEmailUnsubscribes, listParams],
    queryFn: () => adminListEmailUnsubscribes(listParams),
    staleTime: 0, // small mutable list — always refetch when viewed (global default is 5min)
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const preferences = listData?.preferences ?? [];

  const resubscribeMut = useMutation({
    mutationFn: (email: string) => adminResubscribeEmail(email),
    onSuccess: (_data, email) => {
      toast.success(`Re-subscribed ${email}`);
      queryClient.invalidateQueries({ queryKey: adminEmailUnsubscribes });
    },
  });

  if (isLoading) return <PageSpinner />;

  // Header cells per column key.
  const unsubscribeHeaders: Record<string, React.ReactNode> = {
    email: "Email",
    unsubscribed_at: "Unsubscribed",
  };

  return (
    <>
      {/* Table controls */}
      <div className="mb-4 flex items-center justify-end gap-3">
        {!isDefaultOrder && (
          <Button variant="secondary" onClick={resetOrder}>
            Reset order
          </Button>
        )}
        <ColumnToggle resourceKey="adminEmailUnsubscribes" />
      </div>

      {/* Info note */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
        People who clicked an unsubscribe link on an app email — no emails go to these addresses until re-subscribed. Useful for mistaken
        clicks and people who changed their mind. If someone unsubscribes again, they reappear here.
      </div>

      {/* Search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Search by email…"
          aria-label="Search by email"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>

      {/* Table */}
      {preferences.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-gray-400">No unsubscribed emails.</p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            {displayColumns.map((key) => (
              <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                {unsubscribeHeaders[key]}
              </DraggableTh>
            ))}
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {preferences.map((pref) => {
              const prefCells: Record<string, React.ReactNode> = {
                email: <Td className="font-medium text-gray-900">{pref.email}</Td>,
                unsubscribed_at: <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(pref.unsubscribed_at)}</Td>,
              };
              return (
                <Tr key={pref.email}>
                  {displayColumns.map((key) => (
                    <Fragment key={key}>{prefCells[key]}</Fragment>
                  ))}
                  <Td>
                    <Button variant="secondary" onClick={() => setResubscribeConfirm(pref.email)}>
                      Re-subscribe
                    </Button>
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

      {/* Re-subscribe confirmation */}
      <ConfirmDialog
        open={resubscribeConfirm !== null}
        title={
          <>
            Re-subscribe <strong>{resubscribeConfirm}</strong>?
          </>
        }
        description="This removes their unsubscribe record and restores all app emails for that address. If they unsubscribe again, they reappear here."
        onConfirm={() => {
          if (resubscribeConfirm != null) {
            resubscribeMut.mutate(resubscribeConfirm);
            setResubscribeConfirm(null);
          }
        }}
        onCancel={() => setResubscribeConfirm(null)}
        loading={resubscribeMut.isPending}
        confirmLabel="Re-subscribe"
        loadingLabel="Re-subscribing…"
        confirmVariant="success"
      />

      {/* Errors */}
      <MutationErrors mutations={[resubscribeMut]} />
    </>
  );
}
