/**
 * Donor Cart — cash sponsorship checkout
 *
 * Merges the uncommitted (frontend-local) cart from CartContext with the
 * committed pending cash claims from `GET /api/donor/cart`:
 *
 * - Local items: display/claimed-state resolved per item via the public
 *   wish-list endpoint; a failed lookup or a non-null claim_status renders
 *   the row as unavailable (still removable).
 * - Committed items: claim id, family display info, line price, derived
 *   expiry (items whose `payment_expires_at` is already past render as
 *   expired — the hourly-sweep lag).
 *
 * "Pay with Zeffy" commits the local items (`POST /cart/checkout`), opens
 * the returned Zeffy URL in a new tab, and drops the committed families from
 * the local cart. A 409 (family claimed in the meantime) drops that family
 * from the local cart, matched by the raw id in the 409 detail.
 *
 * The how-to-pay instructions show in the cart phase (before checkout) and
 * the waiting state (the donor is paying in the other tab): Zeffy forms
 * can't pre-fill the amount, so the donor enters the exact total by hand
 * and sets the optional 11% "Help keep Zeffy free" tip to $0 ("Other"),
 * with a screenshot of how (`/zeffy-tip-zero.png`).
 *
 * Then the page switches to a waiting state that polls `GET /api/donor/cart`
 * (~15s — a cheap local read that catches webhook-applied payments without
 * touching the confirm rate limit) with a manual "I completed my payment"
 * button. The cart emptying while waiting (a payment just applied) shows the
 * success panel.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageError } from "../components/PageError";
import { PageSpinner } from "../components/Spinner";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import {
  donorCancelClaim,
  donorCartCheckout,
  donorCartConfirm,
  donorGetCart,
  donorToggleCartGroceries,
  getFamilyWishList,
} from "../lib/api";
import { CASH_CLAIM_AMOUNT_USD, CASH_CLAIM_GROCERIES_AMOUNT_USD, PAYMENT_REASSURANCE_COPY } from "../lib/constants";
import { donorCart, donorClaims, familyWishList, publicFamilies } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatApiError, formatDateTime, parseCheckoutConflictFamilyId } from "../lib/utils";
import type { CartCheckoutItem, DonorCartItem } from "../types";

/** ~15s poll of the cart in the waiting state (webhook-applied payments show up without donor action). */
const CART_POLL_INTERVAL_MS = 15_000;

type Phase = "cart" | "waiting" | "success";

/** Local (uncommitted) cart line price — mirrors the backend constants. */
function localLineTotal(includesGroceries: boolean): number {
  return CASH_CLAIM_AMOUNT_USD + (includesGroceries ? CASH_CLAIM_GROCERIES_AMOUNT_USD : 0);
}

/** A derived expiry is "expired" once it's in the past (hourly-sweep lag). */
function isExpired(expiresAt: string | null): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() < Date.now();
}

function getHttpStatus(error: unknown): number | null {
  const response = (error as { response?: { status?: number } } | null)?.response;
  return response?.status ?? null;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function DonorCart() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { items: localItems, removeMany, removeFromCart, setGroceries } = useCart();

  const [phase, setPhase] = useState<Phase>("cart");
  const [mismatch, setMismatch] = useState<{ expected_usd: number; found_usd: number } | null>(null);
  const [rateHint, setRateHint] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DonorCartItem | null>(null);
  const [successItems, setSuccessItems] = useState<DonorCartItem[]>([]);
  const initializedRef = useRef(false);
  // The last non-empty committed cart — feeds the success panel when the
  // cart empties out from under the waiting state.
  const lastItemsRef = useRef<DonorCartItem[]>([]);

  const {
    data: cart,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: donorCart,
    queryFn: donorGetCart,
    refetchInterval: phase === "waiting" ? CART_POLL_INTERVAL_MS : false,
  });

  const committedItems = cart?.items ?? [];

  useEffect(() => {
    if (committedItems.length > 0) lastItemsRef.current = committedItems;
  }, [committedItems]);

  // Phase on arrival: a committed cart with nothing uncommitted means a
  // payment is in flight → go straight to the waiting state.
  // (Runs once — the ref guards re-runs when the local cart later changes.)
  useEffect(() => {
    if (initializedRef.current || isLoading || !cart) return;
    initializedRef.current = true;
    if (cart.items.length > 0 && localItems.length === 0) setPhase("waiting");
  }, [isLoading, cart, localItems.length]);

  // Cart emptied while waiting → a payment just applied (success) — UNLESS
  // every item was already expired, in which case the hourly sweep
  // soft-deleted lapsed claims and no payment was received (neutral empty
  // state instead of a false "payment received"). Only a cart whose items
  // were actually observed counts: right after checkout the cart data is
  // still the pre-checkout (empty) response until the invalidated refetch
  // lands — treating that stale empty as "emptied by a payment" would flash
  // a false success panel.
  useEffect(() => {
    if (phase !== "waiting" || !cart || cart.items.length > 0) return;
    if (lastItemsRef.current.length === 0) return; // stale data, first observation pending
    const sweptOnly = lastItemsRef.current.every((item) => isExpired(item.payment_expires_at));
    if (sweptOnly) {
      setPhase("cart");
    } else {
      setSuccessItems(lastItemsRef.current);
      setPhase("success");
    }
  }, [phase, cart]);

  const totalUsd = useMemo(
    () =>
      committedItems.reduce((sum, item) => sum + item.line_total_usd, 0) +
      localItems.reduce((sum, item) => sum + localLineTotal(item.includes_groceries), 0),
    [committedItems, localItems]
  );

  /* ── Mutations ─────────────────────────────────────────────── */

  const checkoutMut = useMutation({
    mutationFn: (items: CartCheckoutItem[]) => donorCartCheckout(items),
    onSuccess: (data) => {
      // The committed families leave the local cart (now server-side, still
      // listed from GET /api/donor/cart).
      removeMany(localItems.map((i) => i.family_id));
      setPhase("waiting");
      setMismatch(null);
      setRateHint(null);
      window.open(data.zeffy_url, "_blank", "noopener,noreferrer");
      void queryClient.invalidateQueries({ queryKey: donorCart });
    },
    onError: (err) => {
      const detail = formatApiError(err, "Checkout failed — please try again.");
      if (getHttpStatus(err) === 409) {
        // The 409 detail names the family ("Family 3-2-1 (id 42) …") — drop
        // exactly that local item.
        const familyId = parseCheckoutConflictFamilyId(detail);
        if (familyId != null) removeFromCart(familyId);
      }
      toast.error(detail);
    },
  });

  const confirmMut = useMutation({
    mutationFn: donorCartConfirm,
    onMutate: () => setRateHint(null),
    onSuccess: (data) => {
      if (data.status === "paid") {
        setMismatch(null);
        setPhase("success");
        setSuccessItems(lastItemsRef.current);
        void queryClient.invalidateQueries({ queryKey: donorCart });
      } else if (data.status === "mismatch") {
        setMismatch({ expected_usd: data.expected_usd ?? 0, found_usd: data.found_usd ?? 0 });
      } else {
        // "pending" — nothing found yet; a previous mismatch is stale
        setMismatch(null);
      }
    },
    onError: (err) => {
      // 429 is a friendly "try again in a moment" hint, not an error toast —
      // the webhook and the admin manual match are the backstops.
      if (getHttpStatus(err) === 429) {
        setRateHint(formatApiError(err, "Please try again in a moment."));
        return;
      }
      toast.error(formatApiError(err, "Could not check your payment."));
    },
  });

  const groceriesMut = useMutation({
    mutationFn: ({ claimId, value }: { claimId: number; value: boolean }) => donorToggleCartGroceries(claimId, value),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: donorCart }),
  });

  const cancelMut = useMutation({
    mutationFn: (claimId: number) => donorCancelClaim(claimId),
    onSuccess: () => {
      toast.success("Sponsorship cancelled");
      void queryClient.invalidateQueries({ queryKey: donorCart });
      void queryClient.invalidateQueries({ queryKey: donorClaims });
      void queryClient.invalidateQueries({ queryKey: publicFamilies });
      setCancelTarget(null);
      // Emptied the cart by cancelling (not by paying) — back to the neutral
      // empty state, no false success panel.
      if (phase === "waiting" && committedItems.length <= 1) setPhase("cart");
    },
  });

  /* ── Handlers ──────────────────────────────────────────────── */

  const handlePay = () => {
    // An empty local cart = a pure re-checkout of the existing pending cart.
    checkoutMut.mutate(localItems.map((i) => ({ family_id: i.family_id, includes_groceries: i.includes_groceries })));
  };

  /* ── Render ────────────────────────────────────────────────── */

  if (isLoading) return <PageSpinner />;

  if (isError || !cart) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar title="Kindness is Magic" />
        <PageError error={error} heading="Unable to Load Cart" fallback="Something went wrong. Please try again later." />
      </div>
    );
  }

  const hasItems = committedItems.length > 0 || localItems.length > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold text-violet-950">Sponsorship Cart</h2>

        {phase === "success" ? (
          <SuccessPanel items={successItems} onBack={() => navigate(ROUTES.DONOR_CLAIMS)} />
        ) : !hasItems && phase !== "waiting" ? (
          <Card className="py-12 text-center">
            <p className="text-gray-500">Your sponsorship cart is empty.</p>
            <Link to={ROUTES.PUBLIC_FAMILIES} className="mt-3 inline-block text-sm font-medium text-btn-start hover:underline">
              Browse families to sponsor →
            </Link>
          </Card>
        ) : (
          <Card>
            {/* "Please pay" nudge send failure (derived from the email log) */}
            {cart.email_error && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{cart.email_error}</p>
            )}

            {/* Merged item list */}
            <ul className="divide-y divide-gray-100">
              {localItems.map((item) => (
                <LocalItemRow
                  key={item.family_id}
                  item={item}
                  onRemove={() => removeFromCart(item.family_id)}
                  onToggleGroceries={setGroceries}
                />
              ))}
              {committedItems.map((item) => (
                <CommittedItemRow
                  key={item.claim_id}
                  item={item}
                  onToggleGroceries={(value) => groceriesMut.mutate({ claimId: item.claim_id, value })}
                  onRemove={() => setCancelTarget(item)}
                />
              ))}
            </ul>

            {/* Totals */}
            <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
              <span className="text-sm font-medium text-gray-600">
                Total ({committedItems.length + localItems.length} {committedItems.length + localItems.length === 1 ? "family" : "families"}
                )
              </span>
              <span className="text-lg font-bold text-gray-900">${totalUsd}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">The total is confirmed when you check out.</p>

            {/* Earliest expiry — committed items only */}
            {cart.payment_expires_at != null && (
              <p className="mt-2 text-xs text-gray-500">
                {isExpired(cart.payment_expires_at)
                  ? "The payment window has closed — an admin can still help if you've already paid."
                  : `Complete your payment by ${formatDateTime(cart.payment_expires_at)} to keep these sponsorships.`}
              </p>
            )}

            {phase === "cart" ? (
              <div className="mt-6 space-y-4">
                <PaymentInstructions totalUsd={totalUsd} />
                <Button className="w-full" onClick={handlePay} loading={checkoutMut.isPending}>
                  {checkoutMut.isPending ? "Starting checkout…" : "Pay with Zeffy"}
                </Button>
              </div>
            ) : (
              /* Waiting state — poll + manual confirm */
              <div className="mt-6 space-y-3">
                <PaymentInstructions totalUsd={totalUsd} />
                <p className="text-sm text-gray-600">{PAYMENT_REASSURANCE_COPY}</p>

                {mismatch && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    We found a payment of ${mismatch.found_usd}, but your cart total is ${mismatch.expected_usd}. An admin will match it
                    manually.
                  </div>
                )}

                {rateHint && <p className="text-sm text-amber-700">{rateHint}</p>}

                <Button className="w-full" onClick={() => confirmMut.mutate()} loading={confirmMut.isPending}>
                  {confirmMut.isPending ? "Checking…" : "I completed my payment"}
                </Button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={checkoutMut.isPending}
                    className="font-medium text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
                  >
                    Reopen payment form
                  </button>
                  <Link to={ROUTES.DONOR_CLAIMS} className="font-medium text-btn-start hover:underline">
                    Back later
                  </Link>
                </div>
              </div>
            )}
          </Card>
        )}
      </main>

      {/* Cancel-committed-item confirmation */}
      <ConfirmDialog
        open={cancelTarget != null}
        title="Cancel this sponsorship?"
        description={
          cancelTarget
            ? `Family ${cancelTarget.family.display_id} will become available for others to sponsor. The payment window closes with it.`
            : undefined
        }
        onConfirm={() => {
          if (cancelTarget) cancelMut.mutate(cancelTarget.claim_id);
          setCancelTarget(null);
        }}
        onCancel={() => setCancelTarget(null)}
        loading={cancelMut.isPending}
        confirmLabel="Yes, cancel"
        loadingLabel="Cancelling…"
        confirmVariant="danger"
      />

      <MutationErrors mutations={[groceriesMut]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Local (uncommitted) item row                                        */
/* ------------------------------------------------------------------ */

function LocalItemRow({
  item,
  onRemove,
  onToggleGroceries,
}: {
  item: { family_id: number; includes_groceries: boolean };
  onRemove: () => void;
  onToggleGroceries: (familyId: number, value: boolean) => void;
}) {
  // Resolve display info + claimed state per item via the public wish-list
  // endpoint (the local cart holds at most a handful of items).
  const { data: wishList, isError } = useQuery({
    queryKey: familyWishList(item.family_id),
    queryFn: () => getFamilyWishList(item.family_id),
    retry: false,
  });

  // A failed lookup (deleted / not fully approved) or a non-null claim_status
  // (claimed in the meantime) → unavailable.
  const unavailable = isError || wishList?.claim_status != null;
  const lineTotal = localLineTotal(item.includes_groceries);

  return (
    <li className={`flex items-center gap-3 py-3 ${unavailable ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{wishList?.display_id ?? `Family ${item.family_id}`}</span>
          {unavailable && (
            <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              No longer available
            </span>
          )}
        </div>
        {wishList?.bio && !unavailable && <p className="truncate text-xs text-gray-500">{wishList.bio}</p>}
        {unavailable && <p className="text-xs text-gray-500">This family can no longer be sponsored — remove it from your cart.</p>}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Add groceries to this family's sponsorship">
          <input
            type="checkbox"
            aria-label={`Groceries for family ${wishList?.display_id ?? item.family_id}`}
            checked={item.includes_groceries}
            disabled={unavailable}
            onChange={(e) => onToggleGroceries(item.family_id, e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Groceries (+${CASH_CLAIM_GROCERIES_AMOUNT_USD})
        </label>
        <span className="w-16 text-right text-sm font-semibold text-gray-900">${lineTotal}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-medium text-red-600 hover:underline"
          aria-label={`Remove family ${item.family_id}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Committed item row                                                  */
/* ------------------------------------------------------------------ */

function CommittedItemRow({
  item,
  onToggleGroceries,
  onRemove,
}: {
  item: DonorCartItem;
  onToggleGroceries: (value: boolean) => void;
  onRemove: () => void;
}) {
  const expired = isExpired(item.payment_expires_at);

  return (
    <li className={`flex items-center gap-3 py-3 ${expired ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{item.family.display_id}</span>
          {expired ? (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
              Expired
            </span>
          ) : item.payment_expires_at != null ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
              Awaiting payment
            </span>
          ) : null}
        </div>
        {item.family.bio && <p className="truncate text-xs text-gray-500">{item.family.bio}</p>}
        {expired && item.payment_expires_at != null && (
          <p className="text-xs text-gray-500">Payment window closed {formatDateTime(item.payment_expires_at)}.</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Add groceries to this family's sponsorship">
          <input
            type="checkbox"
            aria-label={`Groceries for family ${item.family.display_id}`}
            checked={item.includes_groceries}
            disabled={expired}
            onChange={(e) => onToggleGroceries(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Groceries (+${CASH_CLAIM_GROCERIES_AMOUNT_USD})
        </label>
        <span className="w-16 text-right text-sm font-semibold text-gray-900">${item.line_total_usd}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-medium text-red-600 hover:underline"
          aria-label={`Remove family ${item.family.display_id}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* How-to-pay instructions (Zeffy form)                                */
/* ------------------------------------------------------------------ */

/**
 * How-to-pay instructions for the Zeffy form — shown before checkout (cart
 * phase) and while waiting (the donor is paying in the other tab).
 *
 * Zeffy forms can't pre-fill the amount, so the exact total is carried here
 * (and in the "please pay" email): the donor enters it by hand, and the
 * optional 11% "Help keep Zeffy free" tip — which goes to Zeffy, not the
 * family — should be set to $0 via the "Other" option (screenshot below).
 */
function PaymentInstructions({ totalUsd }: { totalUsd: number }) {
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50 p-4">
      <h3 className="text-sm font-semibold text-violet-950">How to pay on Zeffy</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-gray-700">
        <li>
          <strong>Enter ${totalUsd} exactly</strong> as the donation amount — the form doesn&apos;t pre-fill it, and the exact total is what
          matches your payment to your cart automatically.
        </li>
        <li>
          Set the optional <strong>"Help keep Zeffy free" tip to $0</strong>: choose <em>Other</em> in the tip dropdown and enter 0. The 11%
          default tip goes to Zeffy, not the family — we use Zeffy to avoid card fees, so every penny of your donation goes to the family.
        </li>
      </ol>
      <figure className="mt-3">
        <img
          src="/zeffy-tip-zero.png"
          alt="Zeffy form: the 'Help keep Zeffy free' tip dropdown showing 11% — choose Other and enter $0"
          className="w-full rounded-md border border-violet-100"
        />
        <figcaption className="mt-1 text-xs text-gray-500">Choose "Other" in the tip dropdown and enter $0.</figcaption>
      </figure>
      <p className="mt-3 text-xs text-gray-500">
        If your payment isn&apos;t auto-matched, no worries — an admin will match it manually, and the money still goes to the family.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Success panel                                                       */
/* ------------------------------------------------------------------ */

function SuccessPanel({ items, onBack }: { items: DonorCartItem[]; onBack: () => void }) {
  return (
    <Card className="py-10 text-center">
      <span className="text-3xl" aria-hidden="true">
        ✅
      </span>
      <h3 className="mt-2 text-lg font-bold text-gray-900">Your payment was received</h3>
      <p className="mt-1 text-sm text-gray-600">
        Thank you for sponsoring {items.length === 1 ? "this family" : `${items.length} families`}:
      </p>

      {items.length > 0 && (
        <ul className="mx-auto mt-3 max-w-sm space-y-1 text-sm text-gray-700">
          {items.map((item) => (
            <li key={item.claim_id}>
              Family {item.family.display_id}
              {item.includes_groceries ? " + groceries" : ""} — ${item.line_total_usd}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-sm text-gray-600">
        Zeffy will email your receipt — no action needed. Our volunteers will now purchase the families&apos; wishes.
      </p>

      <Button className="mt-5" onClick={onBack}>
        View my sponsorships
      </Button>
    </Card>
  );
}
