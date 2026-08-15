import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { donorCancelClaim, donorFulfillClaim, donorGetClaim, donorMarkWishPurchased, donorUpdateClaim } from "../lib/api";
import { donorClaim, donorClaims, publicFamilies } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatDateTime } from "../lib/utils";
import type { CommitmentType, DonorWishPurchaseMark, FamilyClaimDetail, FamilyClaimUpdate, WishSummary } from "../types";
import { getClaimStatus } from "../types";

export default function DonorClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const claimId = id ? parseInt(id, 10) : NaN;
  const { user, isAdmin } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: donorClaim(claimId),
    queryFn: () => donorGetClaim(claimId),
    enabled: !Number.isNaN(claimId),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar title="Kindness is Magic" left={<BackToClaims />} />
        <main className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
          <h2 className="mb-2 text-xl font-bold text-gray-900">Claim Not Found</h2>
          <p className="text-gray-500">This claim doesn't exist or you don't have access.</p>
          <Link to={ROUTES.DONOR_CLAIMS} className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
            ← Back to my claims
          </Link>
        </main>
      </div>
    );
  }

  const isOwner = user?.id === data.donor_user_id;
  const canAct = isOwner || isAdmin;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackToClaims />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Claim header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{data.family.display_id}</h2>
            {data.family.bio && <p className="mt-1 text-gray-600">{data.family.bio}</p>}
            <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
              <span>
                {data.family.person_count} {data.family.person_count === 1 ? "member" : "members"}
              </span>
              {data.family.min_age != null && <span>Ages {formatAgeRange(data.family.min_age, data.family.max_age)}</span>}
            </div>
          </div>

          {canAct && <ClaimActionsMenu claim={data} isOwner={isOwner} isAdmin={isAdmin} />}
        </div>

        {/* Claim info card */}
        <Card className="mb-6">
          <h3 className="mb-3 text-base font-semibold text-gray-900">Claim Details</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <InfoRow label="Status" value={<StatusBadge status={getClaimStatus(data.fulfilled_at)} />} />
            <InfoRow label="Commitment" value={<CommitmentBadge type={data.commitment_type} />} />
            <InfoRow label="Created" value={formatDateTime(data.created_at)} />
            <InfoRow label="Fulfilled" value={data.fulfilled_at ? formatDateTime(data.fulfilled_at) : "—"} />
            {data.notes && <InfoRow label="Notes" value={data.notes} />}
            {!isOwner && <InfoRow label="Donor" value={data.donor_display_name} />}
          </div>
        </Card>

        {/* Wish list */}
        <h3 className="mb-3 text-base font-semibold text-gray-900">Family Members & Wishes</h3>
        {data.people.length === 0 ? (
          <Card className="py-8 text-center text-gray-400">No family members added yet.</Card>
        ) : (
          <WishTable people={data.people} commitmentType={data.commitment_type} canAct={canAct} claimId={claimId} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wish Table                                                          */
/* ------------------------------------------------------------------ */

function WishTable({
  people,
  commitmentType,
  canAct,
  claimId,
}: {
  people: { given_name: string; title: string | null; age: number; note: string | null; wishes: WishSummary[] }[];
  commitmentType: CommitmentType;
  canAct: boolean;
  claimId: number;
}) {
  return (
    <Table>
      <TableHead>
        <Th>Name</Th>
        <Th>Age</Th>
        <Th>Practical Wish</Th>
        <Th>Fun Wish</Th>
        {hasNotes(people) && <Th>Note</Th>}
        {commitmentType === "gifts" && canAct && <Th>Actions</Th>}
      </TableHead>
      <TableBody>
        {people.map((person, idx) => {
          const activeWishes = person.wishes.filter((w) => !w.deleted_at);
          const practicalOrAdult = activeWishes.find((w) => w.type === "practical" || w.type === "adult");
          const fun = activeWishes.find((w) => w.type === "fun");
          const isAdult = person.age >= 18;
          return (
            <Tr key={idx}>
              <Td className="font-medium text-gray-900">{person.title ? `${person.title} ${person.given_name}` : person.given_name}</Td>
              <Td>{person.age}</Td>
              {isAdult ? (
                <Td colSpan={2} className="max-w-xs">
                  {practicalOrAdult ? `${practicalOrAdult.description}${practicalOrAdult.size ? ` (${practicalOrAdult.size})` : ""}` : "—"}
                </Td>
              ) : (
                <>
                  <Td className="max-w-xs">
                    {practicalOrAdult
                      ? `${practicalOrAdult.description}${practicalOrAdult.size ? ` (${practicalOrAdult.size})` : ""}`
                      : "—"}
                  </Td>
                  <Td className="max-w-xs">{fun ? `${fun.description}${fun.size ? ` (${fun.size})` : ""}` : "—"}</Td>
                </>
              )}
              {hasNotes(people) && <Td className="max-w-xs text-gray-500">{person.note ?? "—"}</Td>}
              {commitmentType === "gifts" && canAct && (
                <Td>
                  <div className="flex flex-col gap-1">
                    {activeWishes.map((wish) => (
                      <MarkPurchasedButton key={wish.id} wish={wish} claimId={claimId} personName={person.given_name} />
                    ))}
                  </div>
                </Td>
              )}
            </Tr>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Mark Purchased Button + Dialog                                      */
/* ------------------------------------------------------------------ */

function MarkPurchasedButton({ wish, claimId, personName }: { wish: WishSummary; claimId: number; personName: string }) {
  const [open, setOpen] = useState(false);
  const [purchasedWhere, setPurchasedWhere] = useState("");
  const [purchaserNote, setPurchaserNote] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();

  const markMut = useMutation({
    mutationFn: (payload: DonorWishPurchaseMark) => donorMarkWishPurchased(claimId, wish.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: donorClaim(claimId) });
      toast.success(`Wish marked as purchased for ${personName}`);
      setOpen(false);
      setPurchasedWhere("");
      setPurchaserNote("");
    },
  });

  if (wish.purchased_at) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        ✓ Purchased{wish.purchased_where ? ` at ${wish.purchased_where}` : ""}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700"
      >
        Mark purchased
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-3 text-base font-semibold text-gray-900">Mark as purchased — {personName}</h3>
            <p className="mb-4 text-sm text-gray-600">
              {wish.description}
              {wish.size ? ` (${wish.size})` : ""}
            </p>

            <div className="mb-3">
              <label htmlFor="purchased-where" className="mb-1 block text-sm font-medium text-gray-700">
                Purchased at
              </label>
              <input
                id="purchased-where"
                type="text"
                value={purchasedWhere}
                onChange={(e) => setPurchasedWhere(e.target.value)}
                placeholder="e.g. Target, Amazon"
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="purchaser-note" className="mb-1 block text-sm font-medium text-gray-700">
                Note
              </label>
              <input
                id="purchaser-note"
                type="text"
                value={purchaserNote}
                onChange={(e) => setPurchaserNote(e.target.value)}
                placeholder="Optional note"
                maxLength={500}
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              />
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() =>
                  markMut.mutate({
                    // purchased_where always overwrites (null clears)
                    purchased_where: purchasedWhere || null,
                    // "" is the backend sentinel for clearing (null = no change)
                    purchaser_note: purchaserNote,
                  })
                }
                loading={markMut.isPending}
              >
                {markMut.isPending ? "Marking…" : "Mark Purchased"}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <MutationErrors mutations={[markMut]} />
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Claim Actions Menu                                                  */
/* ------------------------------------------------------------------ */

function ClaimActionsMenu({ claim, isOwner, isAdmin }: { claim: FamilyClaimDetail; isOwner: boolean; isAdmin: boolean }) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showFulfillConfirm, setShowFulfillConfirm] = useState(false);
  const [showEditNotes, setShowEditNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(claim.notes ?? "");
  const [commitmentValue, setCommitmentValue] = useState<CommitmentType>(claim.commitment_type);
  const queryClient = useQueryClient();
  const toast = useToast();

  const cancelMut = useMutation({
    mutationFn: () => donorCancelClaim(claim.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: donorClaims });
      queryClient.invalidateQueries({ queryKey: donorClaim(claim.id) });
      queryClient.invalidateQueries({ queryKey: publicFamilies });
      toast.success("Claim cancelled");
    },
  });

  const fulfillMut = useMutation({
    mutationFn: () => donorFulfillClaim(claim.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: donorClaim(claim.id) });
      queryClient.invalidateQueries({ queryKey: donorClaims });
      toast.success("Claim marked as fulfilled");
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: FamilyClaimUpdate) => donorUpdateClaim(claim.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: donorClaim(claim.id) });
      queryClient.invalidateQueries({ queryKey: donorClaims });
      setShowEditNotes(false);
      toast.success("Claim updated");
    },
  });

  return (
    <>
      <ActionsDropdown
        items={[
          ...(isOwner
            ? ([
                {
                  label: "Edit Details",
                  onClick: () => {
                    setNotesValue(claim.notes ?? "");
                    setCommitmentValue(claim.commitment_type);
                    setShowEditNotes(true);
                  },
                },
                {
                  label: "Cancel Claim",
                  variant: "danger" as const,
                  onClick: () => setShowCancelConfirm(true),
                },
              ] as const)
            : []),
          ...(isAdmin && !isOwner
            ? ([
                {
                  label: "Mark Fulfilled",
                  onClick: () => setShowFulfillConfirm(true),
                },
                {
                  label: "Cancel Claim",
                  variant: "danger" as const,
                  onClick: () => setShowCancelConfirm(true),
                },
              ] as const)
            : []),
        ].filter(Boolean)}
        disabled={cancelMut.isPending || fulfillMut.isPending || updateMut.isPending}
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={showCancelConfirm}
        title="Cancel this claim?"
        description="The family will become available for others to claim."
        onConfirm={() => {
          cancelMut.mutate();
          setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
        loading={cancelMut.isPending}
        confirmLabel="Yes, cancel"
        loadingLabel="Cancelling…"
        confirmVariant="danger"
      />

      {/* Fulfill confirmation */}
      <ConfirmDialog
        open={showFulfillConfirm}
        title="Mark claim as fulfilled?"
        description="This indicates gifts/cash have been received by the organization."
        onConfirm={() => {
          fulfillMut.mutate();
          setShowFulfillConfirm(false);
        }}
        onCancel={() => setShowFulfillConfirm(false)}
        loading={fulfillMut.isPending}
        confirmLabel="Yes, fulfill"
        loadingLabel="Fulfilling…"
        confirmVariant="success"
      />

      {/* Edit notes/commitment dialog */}
      {showEditNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-3 text-base font-semibold text-gray-900">Edit Claim Details</h3>

            <div className="mb-3">
              <label htmlFor="commitment-type" className="mb-1 block text-sm font-medium text-gray-700">
                Commitment Type
              </label>
              <select
                id="commitment-type"
                value={commitmentValue}
                onChange={(e) => setCommitmentValue(e.target.value as CommitmentType)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              >
                <option value="gifts">Gifts</option>
                <option value="cash">Cash</option>
              </select>
            </div>

            <div className="mb-4">
              <label htmlFor="claim-notes" className="mb-1 block text-sm font-medium text-gray-700">
                Notes
              </label>
              <textarea
                id="claim-notes"
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              />
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() =>
                  updateMut.mutate({
                    commitment_type: commitmentValue,
                    notes: notesValue || null,
                  })
                }
                loading={updateMut.isPending}
              >
                {updateMut.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setShowEditNotes(false)}>
                Cancel
              </Button>
            </div>
            <MutationErrors mutations={[updateMut]} />
          </div>
        </div>
      )}

      <MutationErrors mutations={[cancelMut, fulfillMut]} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatAgeRange(minAge: number, maxAge: number | null): string {
  if (maxAge == null || minAge === maxAge) return String(minAge);
  return `${minAge}–${maxAge}`;
}

function hasNotes(people: { note: string | null }[]): boolean {
  return people.some((p) => p.note != null && p.note.length > 0);
}

function BackToClaims() {
  return (
    <Link to={ROUTES.DONOR_CLAIMS} className="text-sm text-white/80 transition-colors hover:text-white">
      ← My Claims
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-gray-100 px-1 py-2">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "fulfilled" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

function CommitmentBadge({ type }: { type: string }) {
  const cls = type === "cash" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{type}</span>;
}
