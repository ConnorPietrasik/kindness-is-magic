/**
 * Referrer Wish Review Queue
 *
 * Lists families awaiting referrer wish review.
 * Referrer can approve (submit to admin) or reject (send back to family).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { RejectReasonModal } from "../components/RejectReasonModal";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { listReferrerReviewQueue, referrerApproveWishes, referrerRejectWishes } from "../lib/api";
import { referrerReviewQueue } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime } from "../lib/utils";
import type { FamilyReviewQueueItem } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerReviewQueue() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: queue, isLoading } = useQuery({
    queryKey: referrerReviewQueue,
    queryFn: listReferrerReviewQueue,
  });

  const approveMut = useMutation({
    mutationFn: referrerApproveWishes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referrerReviewQueue });
      toast.success("Wishes submitted for admin review");
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => referrerRejectWishes(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referrerReviewQueue });
      toast.success("Wishes sent back to family");
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
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Wish Review Queue</h2>

        {items.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families awaiting wish review.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Family</Th>
              <Th>Contact</Th>
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
          placeholder="e.g. Please add more details to the family wish..."
          audienceLabel="Provide a reason the family can see:"
        />

        {/* Errors */}
        <MutationErrors mutations={[approveMut, rejectMut]} />
      </main>
    </div>
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
}

function ReviewRow({ item, onApprove, onRejectOpen, isPending }: ReviewRowProps) {
  return (
    <Tr key={item.id} data-id={item.id}>
      <Td>
        <div className="font-medium text-gray-900">{item.family_name}</div>
        <div className="text-xs text-gray-400">ID {item.id}</div>
      </Td>
      <Td>{item.contact_name}</Td>
      <Td>
        <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
          {item.person_count}
        </span>
      </Td>
      <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(item.wish_review_requested_at)}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Link
            to={route.referrerFamilyDetail(item.id)}
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
