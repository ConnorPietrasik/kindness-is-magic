/**
 * Referrer Family Invites
 *
 * Shows the referrer's family invite code with a "Send Invite" button,
 * plus the approval queue below — families that self-registered via invite
 * and are awaiting the referrer's approval.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { approveFamily, getReferrerMe, listPendingFamilies, rejectFamily, sendReferrerFamilyInvite } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";

const REFERRER_ME_KEY = ["referrerMe"];
const REFERRER_FAMILIES_KEY = ["referrerFamilies"];
const PENDING_FAMILIES_KEY = ["pendingFamilies"];

/* ------------------------------------------------------------------ */
/* Invite section — code display + send invite dialog                  */
/* ------------------------------------------------------------------ */
function InviteSection() {
  const { data: referrerInfo } = useQuery({
    queryKey: REFERRER_ME_KEY,
    queryFn: getReferrerMe,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState(false);

  const isApproved = referrerInfo?.approval_status === "approved";
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const sendInviteMut = useMutation({
    mutationFn: sendReferrerFamilyInvite,
    onSuccess: (data) => {
      if (data.email_sent) {
        setSendSuccess(true);
        setEmail("");
      } else {
        setSendError(data.email_send_reason ?? "Email was not sent.");
      }
    },
    onError: (err: unknown) => {
      setSendError(formatApiError(err, "Failed to send invite."));
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    setSendError("");
    setSendSuccess(false);
    sendInviteMut.mutate(email.trim());
  };

  const handleOpenDialog = () => {
    setDialogOpen(true);
    setSendError("");
    setSendSuccess(false);
    setEmail("");
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSendError("");
    setSendSuccess(false);
    setEmail("");
  };

  const code = referrerInfo?.family_invite_code;

  return (
    <>
      <Card className="mb-8">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Family Invite Code</h3>
        <p className="mb-4 text-sm text-gray-500">Share this code with families so they can self-register under your referral.</p>

        {!isApproved && !bannerDismissed && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-amber-800">You can send invites once your account is approved.</p>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="flex-shrink-0 text-amber-500 transition-colors hover:text-amber-700"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-4">
          <div className="flex-1 rounded-lg bg-gray-50 p-4 shadow-sm">
            <div className="text-sm text-gray-500">Your code</div>
            <div className="text-2xl font-mono font-bold tracking-wider text-brand-dark">{code ?? ""}</div>
          </div>
          <Button onClick={handleOpenDialog} disabled={!code || !isApproved}>
            Send Invite
          </Button>
        </div>
      </Card>

      {/* ── Send invite dialog ──────────────────────────────────── */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-sm font-semibold text-gray-900">Send Family Invite</p>
            <p className="mb-4 text-xs text-gray-500">Enter the email address to send the invite link to.</p>

            <form onSubmit={handleSend} className="space-y-3">
              {sendError && <ErrorBox message={sendError} />}
              {sendSuccess && (
                <div className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-700">Invite email sent successfully!</div>
              )}
              <FormField
                label="Email"
                type="email"
                fieldProps={{
                  value: email,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
                  required: true,
                  placeholder: "family@example.com",
                  autoComplete: "off",
                }}
              />
              <div className="flex gap-3 pt-1">
                <Button type="submit" loading={sendInviteMut.isPending} className="flex-1">
                  {sendInviteMut.isPending ? "Sending…" : "Send Invite"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseDialog} className="flex-1">
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyInvites() {
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
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family Invites</h2>

        {/* ── Invite code + send ────────────────────────────────── */}
        <InviteSection />

        {/* ── Pending approvals ─────────────────────────────────── */}
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Pending Family Approvals</h3>

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
