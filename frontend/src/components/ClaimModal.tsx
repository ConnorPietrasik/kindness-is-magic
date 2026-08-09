import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Location } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { claimFamily } from "../lib/api";
import { donorClaims, familyWishList } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import type { CommitmentType } from "../types";
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
        <h3 className="mb-2 text-lg font-semibold text-gray-900">Sign in to Claim</h3>
        <p className="mb-4 text-sm text-gray-600">
          You need to be signed in to claim a family. Create a free donor account to get started.
        </p>
        <div className="flex gap-3">
          <Link to={ROUTES.LOGIN} state={{ from: currentLocation }} className="flex-1" onClick={onClose}>
            <Button className="w-full">Sign in</Button>
          </Link>
          <Link to={ROUTES.DONOR_SELF_REGISTER} state={{ from: currentLocation }} className="flex-1" onClick={onClose}>
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const claimMut = useMutation({
    mutationFn: () => claimFamily(familyId, commitmentType),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: donorClaims });
      queryClient.invalidateQueries({ queryKey: ["publicFamilies"] });
      queryClient.invalidateQueries({ queryKey: familyWishList(familyId) });
      onClose();
      // Navigate to the claim detail page
      navigate(`/donor/claims/${data.id}`);
    },
  });

  return (
    <>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">Claim This Family</h3>
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
          {claimMut.isPending ? "Claiming…" : "Claim Family"}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <MutationErrors mutations={[claimMut]} />
    </>
  );
}
