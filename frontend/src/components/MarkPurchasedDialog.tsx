import { type ChangeEvent, useEffect, useState } from "react";
import { formatApiError, nowIso } from "../lib/utils";
import type { WishPurchaseMark } from "../types";
import { Button } from "./Button";
import { DatePicker } from "./DatePicker";
import { FormField } from "./FormField";
import { OptionalLabel } from "./OptionalLabel";
import { Spinner } from "./Spinner";

/**
 * Minimal wish shape required by MarkPurchasedDialog (satisfied by both
 * WishListSummary and PurchaserWishSummary).
 */
export interface MarkPurchasedDialogWish {
  /** Null for family wishes (no person). */
  person_given_name: string | null;
  purchased_at: string | null;
  purchased_where: string | null;
  purchaser_note: string | null;
  received_at: string | null;
}

interface MarkPurchasedDialogProps {
  open: boolean;
  /**
   * The wish to mark. May be null while the parent is still fetching it —
   * the dialog shows a spinner in that case (or the error state when
   * `error` is set). Never null for list-sourced pages where the row
   * already carries all fields.
   */
  wish: MarkPurchasedDialogWish | null;
  /** Detail-fetch failure shown inside the dialog instead of the form. */
  error?: unknown;
  /** Optional retry for the detail fetch (shown next to the error). */
  onRetry?: () => void;
  onSubmit: (data: WishPurchaseMark) => void;
  onCancel: () => void;
  loading: boolean;
}

/**
 * Dialog for marking a wish as purchased.
 *
 * States: `error` → error message with optional retry; `wish == null` →
 * loading spinner; otherwise the form.
 *
 * Field semantics (backend contract):
 * - purchased_at: defaults to the current date/time (or the wish's existing
 *   value when already purchased); empty input submits "", which clears
 *   the value (omitted/null means "now")
 * - purchased_where: empty input submits null, which clears the value
 * - purchaser_note / received_at: "" is the backend sentinel for clearing
 * Unchanged (non-empty) values are submitted as-is and leave the record unchanged.
 */
export function MarkPurchasedDialog({ open, wish, error, onRetry, onSubmit, onCancel, loading }: MarkPurchasedDialogProps) {
  const [purchasedAt, setPurchasedAt] = useState("");
  const [purchasedWhere, setPurchasedWhere] = useState("");
  const [purchaserNote, setPurchaserNote] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  // Reset on open (and whenever the wish changes) so a cached wish object
  // can't leak the previous session's edits into a reopened dialog.
  useEffect(() => {
    if (wish && open) {
      setPurchasedAt(wish.purchased_at ?? nowIso());
      setPurchasedWhere(wish.purchased_where ?? "");
      setPurchaserNote(wish.purchaser_note ?? "");
      setReceivedAt(wish.received_at ?? "");
    }
  }, [wish, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="presentation">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        {error != null ? (
          <>
            <p className="mb-4 text-sm font-semibold text-gray-700">Mark wish as purchased</p>
            <p className="py-4 text-center text-sm text-red-600">
              {formatApiError(error, "Unable to load wish details. Please try again.")}
            </p>
            <div className="flex gap-3">
              {onRetry && (
                <Button type="button" className="flex-1" onClick={onRetry}>
                  Try again
                </Button>
              )}
              <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
                Close
              </Button>
            </div>
          </>
        ) : !wish ? (
          <>
            <div className="flex items-center justify-center gap-3 py-8 text-btn-start">
              <Spinner size="sm" />
              <span className="text-sm font-medium">Loading…</span>
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm font-semibold text-gray-700">
              Mark wish for <strong>{wish.person_given_name ?? "Family"}</strong> as purchased
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                  // Empty input → "" (clears); a value overwrites
                  purchased_at: purchasedAt || "",
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
              <DatePicker label="Purchased" value={purchasedAt} onChange={setPurchasedAt} />

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
          </>
        )}
      </div>
    </div>
  );
}
