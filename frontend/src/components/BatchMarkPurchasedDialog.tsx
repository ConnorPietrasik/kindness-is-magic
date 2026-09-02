import { type ChangeEvent, useEffect, useState } from "react";
import type { WishBatchMarkPurchased } from "../types";
import { Button } from "./Button";
import { DatePicker } from "./DatePicker";
import { FormField } from "./FormField";

interface BatchMarkPurchasedDialogProps {
  open: boolean;
  wishIds: number[];
  onSubmit: (data: WishBatchMarkPurchased) => void;
  onCancel: () => void;
  loading: boolean;
}

/**
 * Dialog for batch-marking selected wishes as purchased (e.g. things bought
 * at the same place).
 *
 * Clear semantics (backend contract):
 * - purchased_where: empty input submits null, which clears the value
 * - received_at: "" is the backend sentinel for clearing
 * purchaser_note is not touched — notes are per-item (use the row's Edit form).
 */
export function BatchMarkPurchasedDialog({ open, wishIds, onSubmit, onCancel, loading }: BatchMarkPurchasedDialogProps) {
  const [purchasedWhere, setPurchasedWhere] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  useEffect(() => {
    if (open) {
      setPurchasedWhere("");
      setReceivedAt("");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="presentation">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          Mark{" "}
          <strong>
            {wishIds.length} wish{wishIds.length > 1 ? "es" : ""}
          </strong>{" "}
          as purchased
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              wish_ids: wishIds,
              // Empty input → null (clears); otherwise overwrites
              purchased_where: purchasedWhere || null,
              // "" is the backend sentinel for clearing
              received_at: receivedAt,
            });
          }}
          className="space-y-3"
        >
          <FormField
            label="Purchased Where"
            fieldProps={{
              value: purchasedWhere,
              onChange: (e: ChangeEvent<HTMLInputElement>) => setPurchasedWhere(e.target.value),
              maxLength: 200,
              autoComplete: "off",
            }}
          />

          <DatePicker label="Received At" isOptional value={receivedAt} onChange={setReceivedAt} />

          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" loading={loading}>
              {loading ? "Marking…" : "Mark Purchased"}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
