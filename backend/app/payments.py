"""Cash-claim payment lifecycle: shared apply path and the hourly expiry sweep.

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
from app.models import ClaimPaymentStatus, CommitmentType, EmailKind, FamilyClaim, User
from app.response_builders import batch_build_family_info
from app.zeffy import ZeffyPayment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pricing (mirrored by the frontend constants — the server recompute at
# checkout is the source of truth)
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
) -> None:
    """Send a payment-flow email best-effort (SMTP failure never fails the action).

    On failure (other than unsubscribe suppression) an admin failure notice
    is attempted, following the gift-claim-confirmation pattern.
    """
    try:
        result = await send_email(to=donor.email, subject=subject, html_body=body_html, db=db, kind=kind, user_id=donor.id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error sending %s email to %s: %s", kind.value, donor.email, exc, exc_info=True)
        result = {"sent": False, "reason": "unexpected error"}

    if result["sent"] or result.get("reason") == "unsubscribed":
        return

    logger.error("Payment email failed: kind=%s to=%s reason=%s", kind.value, donor.email, result.get("reason"))
    try:
        await send_admin_notification(
            subject=f"Sponsorship Payment Email Failed ({kind.value})",
            body_html=build_payment_email_failure_notice(donor.email, kind.value, result.get("reason", "unknown")),
            db=db,
            kind=EmailKind.admin_failure_notice,
            user_id=donor.id,
        )
    except Exception:  # noqa: BLE001
        logger.error("Admin notification also failed for %s email to %s", kind.value, donor.email, exc_info=True)


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
        donor = db.query(User).filter(User.id == donor_id, User.deleted_at.is_(None)).first()
        if donor is None:
            continue
        families = [c.family for c in donor_claims]
        family_info_map = batch_build_family_info(db, families)
        lines = _payment_email_lines(donor_claims, family_info_map)
        total = claims_total_usd(donor_claims)
        body = build_payment_confirmed_email(donor.display_name, lines, total)
        await _best_effort_payment_email(donor, f"Sponsorship Payment Confirmed — ${total:,.0f}", body, db, EmailKind.payment_confirmed)


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
        logger.info("Payment request already sent after window anchor for %s — skipping nudge", donor.email)
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
        donor = db.query(User).filter(User.id == donor_id, User.deleted_at.is_(None)).first()
        if donor is None:
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
