/**
 * RejectReasonModal — modal asking the user to provide a rejection reason.
 *
 * Shared between referrer and admin review queue pages.
 */

import { useEffect, useState } from "react";
import { Button } from "./Button";

interface RejectReasonModalProps {
  open: boolean;
  /** Name of the family being rejected (shown in the prompt). */
  familyName: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
  /** Placeholder text for the reason textarea. */
  placeholder?: string;
  /** Label shown to the user describing who will see the reason. */
  audienceLabel?: string;
}

export function RejectReasonModal({
  open,
  familyName,
  onConfirm,
  onCancel,
  loading,
  placeholder = "e.g. Please add more details...",
  audienceLabel = "Provide a reason the recipient can see:",
}: RejectReasonModalProps) {
  const [reason, setReason] = useState("");

  // Reset reason when modal opens so stale text from a previous use doesn't persist
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-3 text-sm font-medium text-gray-700">
          Reject wishes for <strong>{familyName}</strong>?
        </p>
        <p className="mb-2 text-xs text-gray-500">{audienceLabel}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={400}
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-btn-start focus:outline-none"
          placeholder={placeholder}
        />
        <p className="mt-1 text-right text-xs text-gray-400">{reason.length}/400</p>
        <div className="mt-4 flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => onConfirm(reason)}
            loading={loading}
            disabled={reason.trim().length === 0}
          >
            {loading ? "Rejecting…" : "Reject"}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
