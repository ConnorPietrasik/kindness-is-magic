import { type ChangeEvent, useEffect, useState } from "react";
import type { WishPurchaseMark } from "../types";
import { Button } from "./Button";
import { DatePicker } from "./DatePicker";
import { FormField } from "./FormField";
import { OptionalLabel } from "./OptionalLabel";

/**
 * Minimal wish shape required by MarkPurchasedDialog (satisfied by both
 * WishListSummary and PurchaserWishSummary).
 */
export interface MarkPurchasedDialogWish {
  person_given_name: string;
  purchased_where: string | null;
  purchaser_note: string | null;
  received_at: string | null;
}

interface MarkPurchasedDialogProps {
  open: boolean;
  wish: MarkPurchasedDialogWish | null;
  onSubmit: (data: WishPurchaseMark) => void;
  onCancel: () => void;
  loading: boolean;
}

/**
 * Dialog for marking a wish as purchased.
 *
 * Clear semantics (backend contract):
 * - purchased_where: empty input submits null, which clears the value
 * - purchaser_note / received_at: "" is the backend sentinel for clearing
 * Unchanged (non-empty) values are submitted as-is and leave the record unchanged.
 */
export function MarkPurchasedDialog({ open, wish, onSubmit, onCancel, loading }: MarkPurchasedDialogProps) {
  const [purchasedWhere, setPurchasedWhere] = useState("");
  const [purchaserNote, setPurchaserNote] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  useEffect(() => {
    if (wish) {
      setPurchasedWhere(wish.purchased_where ?? "");
      setPurchaserNote(wish.purchaser_note ?? "");
      setReceivedAt(wish.received_at ?? "");
    }
  }, [wish]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          Mark wish for <strong>{wish?.person_given_name ?? "?"}</strong> as purchased
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              // Empty input → null (clears); otherwise overwrites
              purchased_where: purchasedWhere || null,
              // "" is the backend sentinel for clearing
              purchaser_note: purchaserNote,
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

          <div>
            <OptionalLabel text="Purchaser Note" />
            <textarea
              value={purchaserNote}
              onChange={(e) => setPurchaserNote(e.target.value)}
              maxLength={400}
              rows={3}
              autoComplete="off"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            />
          </div>

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
