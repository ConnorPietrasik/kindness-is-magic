import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Location } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDeadlineBanner } from "../hooks/useDeadlineBanner";
import { claimFamily } from "../lib/api";
import { DONATE_URL } from "../lib/links";
import { donorClaims, familyWishList, publicFamilies } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDay, setPendingClaimFamilyId } from "../lib/utils";
import type { CommitmentType, FamilyClaimSummary } from "../types";
import { Button } from "./Button";
import { MutationErrors } from "./MutationErrors";

interface ClaimModalProps {
  familyId: number;
  open: boolean;
  onClose: () => void;
  currentLocation?: Location;
}

export function ClaimModal({ familyId, open, onClose, currentLocation }: ClaimModalProps) {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        <AuthGateContent familyId={familyId} onClose={onClose} currentLocation={currentLocation} />
      </div>
    </div>
  );
}

function AuthGateContent({ familyId, onClose, currentLocation }: { familyId: number; onClose: () => void; currentLocation?: Location }) {
  const { user } = useAuth();

  if (!user) {
    return (
      <>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">Sign in to Sponsor</h3>
        <p className="mb-4 text-sm text-gray-600">
          You need to be signed in to sponsor a family. Create a free donor account to get started.
        </p>
        <div className="flex gap-3">
          <Link
            to={ROUTES.LOGIN}
            state={{ from: currentLocation }}
            className="flex-1"
            onClick={() => {
              // Remember this family so a successful sign-in is taken straight
              // back to the claim flow. Only the dialog buttons set this —
              // signing in via the header link does not.
              setPendingClaimFamilyId(familyId);
              onClose();
            }}
          >
            <Button className="w-full">Sign in</Button>
          </Link>
          <Link
            to={ROUTES.DONOR_SELF_REGISTER}
            className="flex-1"
            onClick={() => {
              // Remember this family so the new account is taken straight
              // back to the claim flow after registration.
              setPendingClaimFamilyId(familyId);
              onClose();
            }}
          >
            <Button variant="secondary" className="w-full">
              Register
            </Button>
          </Link>
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full text-center text-sm text-gray-500 hover:underline">
          Maybe later
        </button>
      </>
    );
  }

  return <ClaimForm familyId={familyId} onClose={onClose} />;
}

function ClaimForm({ familyId, onClose }: { familyId: number; onClose: () => void }) {
  const [commitmentType, setCommitmentType] = useState<CommitmentType>("gifts");
  const [claimed, setClaimed] = useState<FamilyClaimSummary | null>(null);
  const queryClient = useQueryClient();

  const claimMut = useMutation({
    mutationFn: () => claimFamily(familyId, commitmentType),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: donorClaims });
      queryClient.invalidateQueries({ queryKey: publicFamilies });
      queryClient.invalidateQueries({ queryKey: familyWishList(familyId) });
      setClaimed(data);
    },
  });

  if (claimed) {
    return <ClaimSuccess claim={claimed} onClose={onClose} />;
  }

  return (
    <>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">Sponsor This Family</h3>
      <p className="mb-4 text-sm text-gray-600">How would you like to support this family?</p>

      <div className="mb-4 space-y-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50">
          <input
            type="radio"
            name="commitment"
            value="gifts"
            checked={commitmentType === "gifts"}
            onChange={() => setCommitmentType("gifts")}
            className="h-4 w-4 accent-btn-start"
          />
          <div>
            <span className="block text-sm font-medium text-gray-900">Gifts</span>
            <span className="block text-xs text-gray-500">I'll purchase the items on their wish list</span>
          </div>
        </label>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50">
          <input
            type="radio"
            name="commitment"
            value="cash"
            checked={commitmentType === "cash"}
            onChange={() => setCommitmentType("cash")}
            className="h-4 w-4 accent-btn-start"
          />
          <div>
            <span className="block text-sm font-medium text-gray-900">Cash</span>
            <span className="block text-xs text-gray-500">I'll provide monetary support</span>
          </div>
        </label>
      </div>

      <div className="flex gap-3">
        <Button className="flex-1" onClick={() => claimMut.mutate()} loading={claimMut.isPending}>
          {claimMut.isPending ? "Sponsoring…" : "Sponsor family"}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <MutationErrors mutations={[claimMut]} />
    </>
  );
}

/**
 * ClaimSuccess — celebratory in-modal view after a successful claim.
 *
 * Replaces the form (the modal stays open); the donor chooses the next
 * step. Backdrop/Escape close behaves as "Keep browsing" — the claim is
 * already committed, so closing has no side effects.
 */
function ClaimSuccess({ claim, onClose }: { claim: FamilyClaimSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const dropoff = useDeadlineBanner("gift_dropoff");

  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-brand-dark to-brand-light px-5 py-6 text-center text-white">
        <span className="text-3xl" aria-hidden="true">
          ✨
        </span>
        <h3 className="mt-2 text-lg font-bold leading-snug">You made Family {claim.family.display_id}&apos;s Christmas magical</h3>
        <p className="mt-1 text-sm text-white/85">Thank you for sponsoring this family.</p>
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-gray-900">What happens next</h4>
        <ul className="mt-2 space-y-2 text-sm text-gray-600">
          {claim.commitment_type === "gifts" ? (
            <>
              <li>
                {claim.email_error
                  ? "We couldn't email you the wish list — you can view it on your sponsorship page."
                  : "We've emailed you the family's full wish list."}
              </li>
              {dropoff && <li>Drop your wrapped gifts off by {formatDay(dropoff.dueDate)}.</li>}
            </>
          ) : (
            <>
              <li>Our volunteers will purchase the family's wishes with your donation.</li>
              {/* TODO(payment): this points at the external Zeffy form — replace with the in-app payment flow when one exists. */}
              <li>
                <a
                  href={DONATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-dark underline underline-offset-2 hover:text-brand-light"
                >
                  Complete your donation
                </a>
              </li>
            </>
          )}
        </ul>
      </div>

      <div className="mt-5 flex gap-3">
        <Button className="flex-1" onClick={() => navigate(route.donorClaimDetail(claim.id))}>
          View your sponsorship
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Keep browsing
        </Button>
      </div>
    </>
  );
}
