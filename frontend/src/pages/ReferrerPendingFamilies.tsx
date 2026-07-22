/**
 * Referrer Pending Families
 *
 * Shows the approval queue — families that self-registered via invite
 * and are awaiting the referrer's approval. Referrers can approve or
 * reject each pending family.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { approveFamily, listPendingFamilies, rejectFamily } from "../lib/api";
import { ROUTES } from "../lib/routes";

const REFERRER_ME_KEY = ["referrerMe"];
const REFERRER_FAMILIES_KEY = ["referrerFamilies"];
const PENDING_FAMILIES_KEY = ["pendingFamilies"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerPendingFamilies() {
  const queryClient = useQueryClient();

  const { data: pendingFamilies, isLoading } = useQuery({
    queryKey: PENDING_FAMILIES_KEY,
    queryFn: listPendingFamilies,
  });

  const approveMut = useMutation({
    mutationFn: approveFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_FAMILIES_KEY });
      queryClient.invalidateQueries({ queryKey: REFERRER_FAMILIES_KEY });
      queryClient.invalidateQueries({ queryKey: REFERRER_ME_KEY });
    },
  });

  const rejectMut = useMutation({
    mutationFn: rejectFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_FAMILIES_KEY });
      queryClient.invalidateQueries({ queryKey: REFERRER_ME_KEY });
    },
  });

  const [rejectId, setRejectId] = useState<number | null>(null);

  if (isLoading) return <PageSpinner />;

  const families = pendingFamilies ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.REFERRER_DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Pending Family Approvals</h2>

        {families.length === 0 ? (
          <Card className="py-12 text-center text-gray-400">No families waiting for approval.</Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Family Name</Th>
              <Th>Contact</Th>
              <Th>Family Wish</Th>
              <Th>People</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.map((f) => (
                <Tr key={f.id}>
                  <Td className="font-medium text-gray-900">{f.family_name}</Td>
                  <Td>{f.contact_name}</Td>
                  <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>
                  <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => approveMut.mutate(f.id)}
                        loading={approveMut.isPending && approveMut.variables === f.id}
                        disabled={approveMut.isPending || rejectMut.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        className="h-7 px-2 text-xs"
                        onClick={() => setRejectId(f.id)}
                        disabled={approveMut.isPending || rejectMut.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}

        {/* ── Reject confirmation ─────────────────────────────── */}
        <ConfirmDialog
          open={rejectId !== null}
          title={<>Reject this family?</>}
          description="They will not be notified and will not appear in your families list."
          onConfirm={() => {
            if (rejectId != null) {
              rejectMut.mutate(rejectId);
              setRejectId(null);
            }
          }}
          onCancel={() => setRejectId(null)}
          loading={rejectMut.isPending}
          confirmLabel="Yes, reject"
          loadingLabel="Rejecting…"
          confirmVariant="danger"
        />

        {/* ── Errors ──────────────────────────────────────────── */}
        <MutationErrors mutations={[approveMut, rejectMut]} />
      </main>
    </div>
  );
}
