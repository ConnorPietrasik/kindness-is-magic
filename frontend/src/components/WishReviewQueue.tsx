/**
 * WishReviewQueue — shared wish review/approval queue.
 *
 * Used by both AdminWishReview (approve → visible to donors; reject → sent
 * back to referrer) and ReferrerReviewQueue (approve → submitted to admin;
 * reject → sent back to family). Owns the queue query, the approve/reject
 * mutations, and the reject-reason modal; the page supplies config (API
 * functions, invalidation keys, heading/copy, row options).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../context/ToastContext";
import { formatDateTime } from "../lib/utils";
import type { FamilyDetail, FamilyReviewQueueItem } from "../types";
import { Button } from "./Button";
import { Card } from "./Card";
import { DisplayId } from "./DisplayId";
import { MutationErrors } from "./MutationErrors";
import { RejectReasonModal } from "./RejectReasonModal";
import { PageSpinner } from "./Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "./Table";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface WishReviewQueueConfig {
  /** Query key for the queue list (from `queryKeys.ts`). */
  queryKey: readonly string[];
  /** Fetch the queue. */
  listFn: () => Promise<FamilyReviewQueueItem[]>;
  /** Approve a family's wishes by family id. */
  approveFn: (id: number) => Promise<FamilyDetail>;
  /** Reject a family's wishes with a reason. */
  rejectFn: (id: number, reason: string) => Promise<FamilyDetail>;
  /** Query keys to invalidate after a successful approve. */
  approveInvalidate: readonly (readonly string[])[];
  /** Query keys to invalidate after a successful reject. */
  rejectInvalidate: readonly (readonly string[])[];
  /** Toast message after a successful approve. */
  approveMessage: string;
  /** Toast message after a successful reject. */
  rejectMessage: string;
  /** Page heading. */
  title: string;
  /** Empty-state text. */
  emptyMessage: string;
  /** Show the "Referrer" column (admin view). Default: hidden. */
  showReferrerColumn?: boolean;
  /** Route for the per-family "View" link. */
  viewRoute: (id: number) => string;
  /** RejectReasonModal placeholder. */
  rejectPlaceholder: string;
  /** RejectReasonModal audience label. */
  rejectAudienceLabel: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function WishReviewQueue({
  queryKey,
  listFn,
  approveFn,
  rejectFn,
  approveInvalidate,
  rejectInvalidate,
  approveMessage,
  rejectMessage,
  title,
  emptyMessage,
  showReferrerColumn = false,
  viewRoute,
  rejectPlaceholder,
  rejectAudienceLabel,
}: WishReviewQueueConfig) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: queue, isLoading } = useQuery({
    queryKey,
    queryFn: listFn,
  });

  const approveMut = useMutation({
    // Wrap so the config function only sees the id (not React Query's context arg)
    mutationFn: (id: number) => approveFn(id),
    onSuccess: () => {
      approveInvalidate.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast.success(approveMessage);
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectFn(id, reason),
    onSuccess: () => {
      rejectInvalidate.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast.success(rejectMessage);
    },
  });

  // Reject modal state
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectingName, setRejectingName] = useState("");

  function handleApprove(id: number) {
    approveMut.mutate(id);
  }

  function handleRejectOpen(id: number, name: string) {
    setRejectingId(id);
    setRejectingName(name);
  }

  function handleRejectConfirm(reason: string) {
    if (rejectingId != null) {
      rejectMut.mutate({ id: rejectingId, reason });
      setRejectingId(null);
      setRejectingName("");
    }
  }

  function handleRejectCancel() {
    setRejectingId(null);
    setRejectingName("");
  }

  if (isLoading) return <PageSpinner />;

  const items = queue ?? [];

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
      <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{title}</h2>

      {items.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-gray-400">{emptyMessage}</p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            <Th>ID</Th>
            <Th>Family</Th>
            <Th>Contact</Th>
            {showReferrerColumn && <Th>Referrer</Th>}
            <Th>People</Th>
            <Th>Requested</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                onApprove={handleApprove}
                onRejectOpen={handleRejectOpen}
                isPending={approveMut.isPending || rejectMut.isPending}
                showReferrerColumn={showReferrerColumn}
                viewRoute={viewRoute}
              />
            ))}
          </TableBody>
        </Table>
      )}

      {/* Reject reason modal */}
      <RejectReasonModal
        open={rejectingId != null}
        familyName={rejectingName}
        onConfirm={handleRejectConfirm}
        onCancel={handleRejectCancel}
        loading={rejectMut.isPending}
        placeholder={rejectPlaceholder}
        audienceLabel={rejectAudienceLabel}
      />

      {/* Errors */}
      <MutationErrors mutations={[approveMut, rejectMut]} />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

interface ReviewRowProps {
  item: FamilyReviewQueueItem;
  onApprove: (id: number) => void;
  onRejectOpen: (id: number, name: string) => void;
  isPending: boolean;
  showReferrerColumn: boolean;
  viewRoute: (id: number) => string;
}

function ReviewRow({ item, onApprove, onRejectOpen, isPending, showReferrerColumn, viewRoute }: ReviewRowProps) {
  return (
    <Tr key={item.id} data-id={item.id}>
      <Td className="whitespace-nowrap text-xs text-gray-400">
        <DisplayId displayId={item.display_id} familyId={item.id} referrerId={item.referrer_id} />
      </Td>
      <Td>
        <div className="font-medium text-gray-900">{item.family_name}</div>
      </Td>
      <Td>{item.contact_name}</Td>
      {showReferrerColumn && <Td>{item.referrer_name ?? "—"}</Td>}
      <Td>
        <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
          {item.person_count}
        </span>
      </Td>
      <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(item.wish_review_requested_at)}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Link
            to={viewRoute(item.id)}
            className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            View
          </Link>
          <Button variant="success" className="h-7 px-2 text-xs" onClick={() => onApprove(item.id)} disabled={isPending}>
            {isPending ? "…" : "Approve"}
          </Button>
          <Button
            variant="danger"
            className="h-7 px-2 text-xs"
            onClick={() => onRejectOpen(item.id, item.family_name)}
            disabled={isPending}
          >
            Reject
          </Button>
        </div>
      </Td>
    </Tr>
  );
}
