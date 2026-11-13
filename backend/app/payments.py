"""Cash-claim payment lifecycle: shared apply path, the Zeffy payment
mirror sync, and the hourly expiry sweep.

The apply path is the single place a Zeffy payment gets marked onto claims
(idempotent on the stored payment id) and the per-donor confirmation email
goes out (when ``SEND_PAYMENT_CONFIRMED_EMAIL`` is on — off by default,
since Zeffy emails its own receipt) — used by the manual confirm endpoint,
the webhook, and the admin manual match, so every payment — however
recorded — gets at most one confirmation (a sequential re-apply is a no-op
before any email is considered; a double send is only possible inside the
sub-second check→apply→send window of a *concurrent* first-apply, which is
accepted).

The expiry sweep soft-deletes lapsed pending cash claims on the hourly
cycle only (no lazy sweep) — an expired family can stay hidden / 409 /
visible in the owner's cart for up to one hour past the deadline (its
derived ``payment_expires_at`` is already in the past in that window).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import (
    APP_BASE_URL,
    CASH_CLAIM_AMOUNT_USD,
    CASH_CLAIM_GROCERIES_AMOUNT_USD,
    CASH_CLAIM_PAYMENT_HOURS,
    SEND_PAYMENT_CONFIRMED_EMAIL,
)
from app.database import get_db
from app.mail import (
    build_payment_confirmed_email,
    build_payment_email_failure_notice,
    build_payment_expired_email,
    build_payment_request_email,
    payment_request_already_sent,
    send_email,
    send_admin_notification,
)
from app.models import ClaimPaymentStatus, CommitmentType, EmailKind, FamilyClaim, User, ZeffyPaymentRecord
from app.response_builders import batch_build_family_info
import app.zeffy as zeffy
from app.zeffy import ZeffyPayment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pricing — the server recompute at checkout is the source of truth. The
# donor cart prices lines from these values as served by GET /api/donor/cart
# (no mirroring); the only frontend constant mirror is display-only copy on
# the public families page (frontend/src/lib/constants.ts).
# ---------------------------------------------------------------------------


def claim_line_total(claim: FamilyClaim) -> int:
    """USD total for one cash claim: flat amount + optional groceries add-on."""
    return CASH_CLAIM_AMOUNT_USD + (CASH_CLAIM_GROCERIES_AMOUNT_USD if claim.includes_groceries else 0)


def claims_total_usd(claims: list[FamilyClaim]) -> int:
    """USD total over a set of cash claims."""
    return sum(claim_line_total(c) for c in claims)


def pending_cash_claims_for(db: Session, donor_user_id: int) -> list[FamilyClaim]:
    """A donor's committed (in-progress) pending cash claims, oldest first."""
    return (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.donor_user_id == donor_user_id,
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.commitment_type == CommitmentType.cash,
            FamilyClaim.payment_status == ClaimPaymentStatus.pending,
        )
        .order_by(FamilyClaim.created_at)
        .all()
    )


def cart_window_anchor(claims: list[FamilyClaim]) -> datetime | None:
    """The payment-window anchor: ``min(created_at)`` of the pending claims.

    The same derivation as the cart's displayed earliest expiry; passed to
    ``payment_request_already_sent`` (nudge dedup) and ``find_cart_payment``
    (stale-payment guard).
    """
    return min((c.created_at for c in claims), default=None)


def cart_payment_expires_at(claims: list[FamilyClaim]) -> datetime | None:
    """Earliest expiry across the pending cart (None for an empty cart)."""
    anchor = cart_window_anchor(claims)
    return anchor + timedelta(hours=CASH_CLAIM_PAYMENT_HOURS) if anchor is not None else None


def _payment_email_lines(claims: list[FamilyClaim], family_info_map: dict[int, object]) -> list[dict]:
    """Email table rows for a donor's claims (display id, groceries, line total)."""
    lines = []
    for claim in claims:
        info = family_info_map.get(claim.family_id)
        lines.append(
            {
                "display_id": info.display_id if info is not None else "?",
                "includes_groceries": claim.includes_groceries,
                "line_total_usd": claim_line_total(claim),
            }
        )
    return lines


async def _best_effort_payment_email(
    donor: User,
    subject: str,
    body_html: str,
    db: Session,
    kind: EmailKind,
) -> str | None:
    """Send a payment-flow email best-effort (SMTP failure never fails the action).

    Returns an error string when the send failed (unsubscribe suppression
    counts as success), None otherwise. On failure an admin failure notice is
    attempted first, following the gift-claim-confirmation pattern.
    """
    try:
        result = await send_email(to=donor.email, subject=subject, html_body=body_html, db=db, kind=kind, user_id=donor.id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error sending %s email (user_id=%s): %s", kind.value, donor.id, exc, exc_info=True)
        result = {"sent": False, "reason": "unexpected error"}

    if result["sent"] or result.get("reason") == "unsubscribed":
        return

    logger.error("Payment email failed: kind=%s user_id=%s reason=%s", kind.value, donor.id, result.get("reason"))
    try:
        await send_admin_notification(
            subject=f"Sponsorship Payment Email Failed ({kind.value})",
            body_html=build_payment_email_failure_notice(donor.email, kind.value, result.get("reason", "unknown")),
            db=db,
            kind=EmailKind.admin_failure_notice,
            user_id=donor.id,
        )
    except Exception:  # noqa: BLE001
        logger.error("Admin notification also failed for %s email (user_id=%s)", kind.value, donor.id, exc_info=True)
    return "Payment email failed to send"


# ---------------------------------------------------------------------------
# Shared apply path (confirm / webhook / admin Zeffy match)
# ---------------------------------------------------------------------------


async def apply_payment_to_claims(db: Session, claims: list[FamilyClaim], payment: ZeffyPayment) -> bool:
    """Mark *claims* paid with *payment* and send per-donor confirmations.

    Idempotent on the stored payment id: if *any* claim in the DB already
    stores this payment id (webhook retries, duplicate polls, double-apply),
    the whole apply is a no-op — no state writes, no emails.

    On a first apply: a single commit flips every claim to paid
    (``paid_at`` = the payment's ``created`` timestamp, ``zeffy_payment_id``
    = the payment id), then the per-donor confirmation email goes out when
    enabled (``SEND_PAYMENT_CONFIRMED_EMAIL``, off by default). Returns True
    when the payment was applied.
    """
    if not claims:
        return False

    already = db.query(FamilyClaim.id).filter(FamilyClaim.zeffy_payment_id == payment.id, FamilyClaim.deleted_at.is_(None)).first()
    if already is not None:
        logger.info("Payment %s already stored on a claim — apply is a no-op", payment.id)
        return False

    paid_at = datetime.fromtimestamp(payment.created, tz=timezone.utc)
    for claim in claims:
        claim.payment_status = ClaimPaymentStatus.paid
        claim.paid_at = paid_at
        claim.zeffy_payment_id = payment.id
    # Mirror row (idempotent) so every applied payment — webhook, donor
    # confirm, manual match — appears in the local reconciliation list, and
    # clear any "seen" acknowledgment: the match resolves what the banner
    # flagged, and a later unmatch re-surfaces the payment.
    record = upsert_zeffy_payment(db, payment)
    record.seen_at = None
    record.seen_by = None
    db.commit()
    logger.info("Payment %s applied to claims %s", payment.id, [c.id for c in claims])

    # Confirmation email per affected donor (best-effort, after commit).
    await send_payment_confirmation_email(db, claims)
    return True


async def send_payment_confirmation_email(db: Session, claims: list[FamilyClaim]) -> None:
    """Best-effort payment-confirmed email, one per affected donor.

    Disabled by default (``SEND_PAYMENT_CONFIRMED_EMAIL``): Zeffy already
    emails the donor a receipt for the same payment, and a second
    "payment received" email from us tends to confuse. When enabled, covers
    the matched claims only (an admin partial match emails just the covered
    claim; a re-match after unmatch re-emails with the new coverage).
    """
    if not SEND_PAYMENT_CONFIRMED_EMAIL:
        logger.info("Payment-confirmed email disabled (SEND_PAYMENT_CONFIRMED_EMAIL) — skipping %d claims", len(claims))
        return
    if not claims:
        return
    by_donor: dict[int, list[FamilyClaim]] = {}
    for claim in claims:
        by_donor.setdefault(claim.donor_user_id, []).append(claim)
    for donor_id, donor_claims in by_donor.items():
        donor = db.get(User, donor_id)
        if donor is None or donor.deleted_at is not None:
            continue
        families = [c.family for c in donor_claims]
        family_info_map = batch_build_family_info(db, families)
        lines = _payment_email_lines(donor_claims, family_info_map)
        total = claims_total_usd(donor_claims)
        body = build_payment_confirmed_email(donor.display_name, lines, total)
        await _best_effort_payment_email(donor, f"Sponsorship Payment Confirmed — ${total:,.0f}", body, db, EmailKind.payment_confirmed)


# ---------------------------------------------------------------------------
# Zeffy payment mirror (local reconciliation list + admin banner)
# ---------------------------------------------------------------------------


def payment_buyer_name(payment: ZeffyPayment) -> str | None:
    """The buyer's display name: first + last, falling back to the company."""
    buyer = payment.buyer
    if buyer is None:
        return None
    name = " ".join(n for n in (buyer.first_name, buyer.last_name) if n).strip()
    return name or buyer.company_name


def upsert_zeffy_payment(db: Session, payment: ZeffyPayment) -> ZeffyPaymentRecord:
    """Insert or refresh the mirror row for *payment*; return the row.

    Does not commit — the caller owns the transaction (the webhook commits
    before its business checks, the match endpoint before its own, the sync
    walk per row, the apply path together with the claim flip). Idempotent
    on the Zeffy payment id: a concurrent first insert loses to the unique
    constraint on the losing path's commit; every delivery/retry re-runs
    this upsert, so the state converges. Refreshes snapshot fields only —
    the ``seen_at``/``seen_by`` attention state survives syncs.
    """
    values = dict(
        created_at=datetime.fromtimestamp(payment.created, tz=timezone.utc),
        amount_cents=payment.amount,
        currency=payment.currency,
        buyer_email=payment.buyer.email if payment.buyer is not None else None,
        buyer_name=payment_buyer_name(payment),
        campaign_id=payment.campaign_id,
        receipt_url=payment.receipt_url,
        status=payment.status,
        refund_status=payment.refund_status,
    )
    record = db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == payment.id).first()
    if record is None:
        record = ZeffyPaymentRecord(payment_id=payment.id, **values)
        db.add(record)
    else:
        for field, value in values.items():
            setattr(record, field, value)
    return record


def sync_zeffy_payments(db: Session) -> tuple[int, int]:
    """One sync cycle: walk the dedicated campaign's succeeded payments
    (newest first) and upsert rows until the first already-known one — the
    newest-first ordering means everything older is already mirrored, so
    the walk stops there (late webhook deliveries of older payments remain
    the webhook's job). The first known row is upserted too, which refreshes
    its snapshot fields (e.g. a recent refund that landed after the
    webhook); older known rows are not revisited — the match endpoint
    refreshes a row when it is acted on. Returns ``(new, refreshed)``.

    Commits per row so a mid-walk failure keeps its progress. The
    org-wide Zeffy rate budget applies (client throttle + one 429 retry);
    the multi-page case is the one-time full-history backfill.
    """
    if not zeffy.ZEFFY_CAMPAIGN_ID:
        return 0, 0

    cursor: str | None = None
    new_count = 0
    refreshed = 0
    while True:
        page = zeffy.list_payments(campaign_id=zeffy.ZEFFY_CAMPAIGN_ID, status="succeeded", starting_after=cursor, limit=100)
        stop = False
        for payment in page.data:
            record = upsert_zeffy_payment(db, payment)
            is_new = record.id is None  # PK assigns on the commit below
            db.commit()
            if is_new:
                new_count += 1
            else:
                refreshed += 1
                stop = True  # known row — the rest of the walk is redundant
                break
        if stop or not page.has_more:
            break
        cursor = page.next_cursor
    return new_count, refreshed


SYNC_INTERVAL_SECONDS = 3600


async def zeffy_payment_sync_loop() -> None:
    """Sync the Zeffy payment mirror immediately, then hourly.

    The immediate first run backfills history (a one-page no-op once
    caught up — the walk stops at the first known row). Skips quietly
    while Zeffy is unconfigured (the dev/e2e default state); API/DB errors
    are logged and swallowed (the next run retries) — mirroring
    ``claim_expiry_loop``.
    """
    while True:
        if zeffy.ZEFFY_API_KEY and zeffy.ZEFFY_CAMPAIGN_ID:
            try:
                db = next(get_db())
                try:
                    new_count, refreshed = await asyncio.to_thread(sync_zeffy_payments, db)
                    if new_count or refreshed:
                        logger.info("Zeffy payment sync: %d new, %d refreshed", new_count, refreshed)
                finally:
                    db.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Zeffy payment sync failed (will retry at the next run): %s", exc)
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# "Please pay" nudge (checkout / gifts→cash toggle)
# ---------------------------------------------------------------------------


async def send_payment_request_email(db: Session, donor: User, claims: list[FamilyClaim]) -> str | None:
    """Send the "please pay" nudge for the donor's current pending cart.

    At most once per payment window (preamble rule): skipped when a sent
    nudge already exists after the window anchor. Best-effort — returns an
    error string when the send failed (checkout still succeeds), None
    otherwise.
    """
    anchor = cart_window_anchor(claims)
    if anchor is None:
        return None
    if payment_request_already_sent(donor.email, anchor, db):
        logger.info("Payment request already sent after window anchor (user_id=%s) — skipping nudge", donor.id)
        return None

    families = [c.family for c in claims]
    family_info_map = batch_build_family_info(db, families)
    lines = _payment_email_lines(claims, family_info_map)
    total = claims_total_usd(claims)
    expires_at = cart_payment_expires_at(claims)
    body = build_payment_request_email(donor.display_name, lines, total, expires_at, f"{APP_BASE_URL}/donor/cart")
    error = await _best_effort_payment_email(
        donor, f"Sponsor a family — payment of ${total:,.0f} required", body, db, EmailKind.payment_request
    )
    if error:
        return "Payment request email failed to send"
    return None


# ---------------------------------------------------------------------------
# Expiry sweep (hourly background task)
# ---------------------------------------------------------------------------


def _lapsed_pending_cash_claims(db: Session, now: datetime) -> list[FamilyClaim]:
    """Pending cash claims whose payment window has lapsed (not yet swept)."""
    return (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.commitment_type == CommitmentType.cash,
            FamilyClaim.payment_status == ClaimPaymentStatus.pending,
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.created_at + timedelta(hours=CASH_CLAIM_PAYMENT_HOURS) < now,
        )
        .all()
    )


async def run_claim_expiry(db: Session) -> int:
    """One expiry cycle: sweep lapsed pending cash claims + donor emails.

    The soft-delete is a single conditional UPDATE (the WHERE re-checks
    pending + not-deleted + lapsed), so a payment applying in the same
    instant wins or loses cleanly and a just-paid claim can never be swept.
    The pre-select exists only to know which donors to email. Returns the
    number of claims soft-deleted.
    """
    now = datetime.now(timezone.utc)
    affected = _lapsed_pending_cash_claims(db, now)
    if not affected:
        return 0

    swept = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.commitment_type == CommitmentType.cash,
            FamilyClaim.payment_status == ClaimPaymentStatus.pending,
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.created_at + timedelta(hours=CASH_CLAIM_PAYMENT_HOURS) < now,
        )
        .update({FamilyClaim.deleted_at: now}, synchronize_session=False)
    )
    db.commit()
    if not swept:
        return 0
    logger.info("Expiry sweep soft-deleted %s lapsed pending cash claims", swept)

    # Expiry email per donor (best-effort). A claim paid in the sub-second
    # gap between the pre-select and the UPDATE may still be named in its
    # donor's email — harmless (the cart shows it paid; the money is
    # handled), and the sweep itself never touches a just-paid claim.
    by_donor: dict[int, list[FamilyClaim]] = {}
    for claim in affected:
        by_donor.setdefault(claim.donor_user_id, []).append(claim)
    for donor_id, donor_claims in by_donor.items():
        donor = db.get(User, donor_id)
        if donor is None or donor.deleted_at is not None:
            continue
        families = [c.family for c in donor_claims]
        family_info_map = batch_build_family_info(db, families)
        lines = _payment_email_lines(donor_claims, family_info_map)
        body = build_payment_expired_email(donor.display_name, lines)
        await _best_effort_payment_email(donor, "Your sponsorship payment window has closed", body, db, EmailKind.payment_expired)
    return swept


EXPIRY_SWEEP_INTERVAL_SECONDS = 3600


async def claim_expiry_loop() -> None:
    """Sweep expired pending cash claims immediately, then hourly.

    The immediate first run catches any claims that lapsed while the app was
    down. DB errors are logged and swallowed (the next run retries) —
    mirroring ``deadline_checks_loop``. Cancelled on shutdown by the caller.
    """
    while True:
        try:
            db = next(get_db())
            try:
                await run_claim_expiry(db)
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.error("Claim expiry sweep failed (will retry at the next run): %s", exc, exc_info=True)
        await asyncio.sleep(EXPIRY_SWEEP_INTERVAL_SECONDS)
