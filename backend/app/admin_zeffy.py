"""Admin routes for Zeffy payment reconciliation (unmatched-payments page).

All endpoints are guarded with ``require_admin``.

* ``GET /payments`` — the local mirror table (refreshed by the webhook,
  the hourly sync, and ``POST /sync``), enriched with local match state;
  unmatched-only by default (the admin banner's population),
  ``show_matched`` includes the rest; standard page envelope, ``columns``
  supported. Local read — works unconfigured.
* ``GET /pending-claims`` — local read only (works unconfigured): every
  active unpaid cash claim grouped by donor; feeds the match modal.
* ``POST /sync`` — pull the campaign's succeeded payments into the mirror
  now (the hourly background loop does the same in the background).
* ``GET /unmatched-summary`` — count + oldest of the payments waiting for
  action; feeds the admin dashboard banner.
* ``POST /payments/{id}/seen`` / ``DELETE /payments/{id}/seen`` — the
  admin's "no action needed" acknowledgment (suppresses the banner).
* ``POST /payments/{id}/match`` — manual match: mark the chosen unpaid cash
  claims paid with the payment (shared apply path → confirmation emails).
* ``POST /payments/{id}/unmatch`` — correction: clear the payment id +
  paid state, revert the claims to pending with a fresh payment window.

The payment id in the path is a Zeffy UUID string, not our DB int — route
typing differs from the sibling admin modules on purpose.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import zeffy
from app.column_filter import column_filtered_page
from app.config import CASH_CLAIM_PAYMENT_HOURS
from app.database import get_db
from app.models import ClaimPaymentStatus, CommitmentType, Family, FamilyClaim, User, ZeffyPaymentRecord
from app.payments import (
    apply_payment_to_claims,
    claim_line_total,
    claims_total_usd,
    sync_zeffy_payments,
    upsert_zeffy_payment,
)
from app.permissions import require_admin
from app.response_builders import batch_build_family_info, build_claim_summary, build_zeffy_payment_item
from app.schemas import (
    AdminZeffyMatchRequest,
    AdminZeffyMatchResponse,
    AdminZeffyPayment,
    AdminZeffyPaymentsResponse,
    AdminZeffyPendingClaimItem,
    AdminZeffyPendingClaimsResponse,
    AdminZeffyPendingDonorGroup,
    AdminZeffySeenResponse,
    AdminZeffySyncResponse,
    AdminZeffyUnmatchedSummary,
    AdminZeffyUnmatchResponse,
    FamilyInfo,
)

logger = logging.getLogger(__name__)

zeffy_admin_router = APIRouter(
    prefix="/api/admin/zeffy",
    tags=["admin-zeffy"],
)


def _require_zeffy_configured() -> None:
    """Gate for the Zeffy-backed endpoints: 503 when unconfigured (no key /
    campaign not found), 502 for upstream failures — same mapping as the
    donor confirm endpoint."""
    try:
        zeffy.validate_configured_campaign()
    except zeffy.ZeffyNotConfiguredError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy is not configured")
    except zeffy.ZeffyCampaignNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")
    except zeffy.ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not fetch payments: {exc}")


def _fetch_zeffy_payment(payment_id: str) -> zeffy.ZeffyPayment:
    """One payment from the read API, mapped to friendly errors.

    404 when the id doesn't exist in Zeffy; 503/502 for configuration and
    upstream failures (same mapping as the donor confirm endpoint).
    """
    try:
        payment = zeffy.get_payment(payment_id)
    except zeffy.ZeffyNotConfiguredError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy is not configured")
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")
    except zeffy.ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not fetch the payment: {exc}")
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found in Zeffy")
    return payment


def _get_zeffy_payment_record(db: Session, payment_id: str) -> ZeffyPaymentRecord:
    """The mirror row for a Zeffy payment id — 404 when never mirrored."""
    record = db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == payment_id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found in the local mirror — sync first")
    return record


def _is_mirror_payment_race(exc: IntegrityError) -> bool:
    """Whether a failed commit lost a first-insert race on the mirror's
    one-row-per-payment index (uq_zeffy_payments_payment_id).

    Same duck-typed driver detection as ``is_active_claim_race``: only a
    violation of exactly this constraint is a lost race; any other
    IntegrityError is a genuine surprise for the 500 handler.
    """
    orig = exc.orig
    diag = getattr(orig, "diag", None)
    return getattr(orig, "pgcode", None) == "23505" and getattr(diag, "constraint_name", None) == "uq_zeffy_payments_payment_id"


def _unmatched_conditions(db: Session) -> list:
    """The banner's filter conditions: no "seen" acknowledgment and no live
    claim storing the payment id (a soft-deleted claim does not count as a
    match). One filter in the list endpoint, unpacked into the summary
    aggregate."""
    matched_ids = db.query(FamilyClaim.zeffy_payment_id).filter(
        FamilyClaim.deleted_at.is_(None),
        FamilyClaim.zeffy_payment_id.isnot(None),
    )
    return [ZeffyPaymentRecord.seen_at.is_(None), ZeffyPaymentRecord.payment_id.notin_(matched_ids)]


@zeffy_admin_router.get("/payments", response_model=AdminZeffyPaymentsResponse, response_model_exclude_unset=True)
def list_zeffy_payments(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    show_matched: bool = Query(False, description="Include matched and seen payments (default: unmatched only)"),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """The dedicated campaign's mirrored payments (newest first), enriched
    with local match state. Unmatched-only by default — the admin banner's
    population; ``show_matched`` includes matched and seen rows. Standard
    page envelope; ``columns`` supported. Local read: works unconfigured."""
    query = db.query(ZeffyPaymentRecord)
    if not show_matched:
        query = query.filter(*_unmatched_conditions(db))

    total = query.count()
    records = (
        query.order_by(ZeffyPaymentRecord.created_at.desc(), ZeffyPaymentRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Local match state: which (non-deleted) claims store each payment id
    claims_by_payment: dict[str, list[int]] = {}
    if records:
        rows = (
            db.query(FamilyClaim.zeffy_payment_id, FamilyClaim.id)
            .filter(
                FamilyClaim.zeffy_payment_id.in_([r.payment_id for r in records]),
                FamilyClaim.deleted_at.is_(None),
            )
            .all()
        )
        for payment_id, claim_id in rows:
            claims_by_payment.setdefault(payment_id, []).append(claim_id)

    items = [build_zeffy_payment_item(r, claims_by_payment.get(r.payment_id, [])) for r in records]

    # claim_ids / seen_at / refund_status are selectable columns, but they
    # drive the row's chips and actions — always_include guarantees them in
    # the output regardless of the user's column selection (a missing
    # seen_at or refund_status reads as "fresh, non-refunded" client-side
    # and breaks the Seen/Refunded UI).
    return column_filtered_page(
        items,
        columns,
        model=AdminZeffyPayment,
        key="payments",
        total=total,
        page=page,
        page_size=page_size,
        always_include={"id", "matched", "claim_ids", "seen_at", "refund_status"},
    )


@zeffy_admin_router.get("/pending-claims", response_model=AdminZeffyPendingClaimsResponse)
def list_pending_cash_claims(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffyPendingClaimsResponse:
    """Every active unpaid cash claim, grouped by donor — the match modal's
    data (per-donor checkboxes + expected amount). Local read: no Zeffy
    call, works unconfigured. No columns/pagination (modal data)."""
    claims = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.commitment_type == CommitmentType.cash,
            FamilyClaim.payment_status == ClaimPaymentStatus.pending,
            FamilyClaim.deleted_at.is_(None),
        )
        .order_by(FamilyClaim.created_at, FamilyClaim.id)
        .all()
    )
    if not claims:
        return AdminZeffyPendingClaimsResponse(donors=[])

    family_ids = sorted({c.family_id for c in claims})
    families = db.query(Family).filter(Family.id.in_(family_ids)).all()
    family_info_map = batch_build_family_info(db, families)

    donor_ids = sorted({c.donor_user_id for c in claims})
    donors = {u.id: u for u in db.query(User).filter(User.id.in_(donor_ids)).all()}

    by_donor: dict[int, list[FamilyClaim]] = {}
    for claim in claims:  # already ordered by created_at
        by_donor.setdefault(claim.donor_user_id, []).append(claim)

    groups = []
    for donor_id, donor_claims in by_donor.items():
        donor = donors.get(donor_id)
        groups.append(
            AdminZeffyPendingDonorGroup(
                donor_id=donor_id,
                donor_email=donor.email if donor is not None else "unknown",
                donor_display_name=donor.display_name if donor is not None else None,
                item_count=len(donor_claims),
                total_usd=claims_total_usd(donor_claims),
                claims=[
                    AdminZeffyPendingClaimItem(
                        claim_id=c.id,
                        family=family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0)),
                        includes_groceries=c.includes_groceries,
                        line_total_usd=claim_line_total(c),
                        payment_expires_at=c.created_at + timedelta(hours=CASH_CLAIM_PAYMENT_HOURS),
                    )
                    for c in donor_claims
                ],
            )
        )

    return AdminZeffyPendingClaimsResponse(donors=groups)


@zeffy_admin_router.post("/sync", response_model=AdminZeffySyncResponse)
def sync_payments(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffySyncResponse:
    """Pull the dedicated campaign's succeeded payments into the local
    mirror now (the page's "Sync with Zeffy" button; the hourly background
    loop does the same in the background). Returns the number of rows
    inserted / refreshed. Steady state is one Zeffy call (the walk stops
    at the first known row)."""
    _require_zeffy_configured()

    try:
        new_count, updated_count = sync_zeffy_payments(db)
    except IntegrityError as exc:
        # Roll back first — the session is broken after a DBAPI error either
        # way. A unique violation on the mirror's payment_id index is a lost
        # first-insert race (the webhook or a sibling sync committed the same
        # payment first) — the row is already mirrored and the next sync
        # converges. Anything else re-raises into the 500 handler.
        db.rollback()
        if not _is_mirror_payment_race(exc):
            raise
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Another sync is in progress — please try again")
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")
    except zeffy.ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not sync payments: {exc}")

    logger.info("Admin Zeffy sync: %d new, %d refreshed", new_count, updated_count)
    return AdminZeffySyncResponse(new_count=new_count, updated_count=updated_count)


@zeffy_admin_router.get("/unmatched-summary", response_model=AdminZeffyUnmatchedSummary)
def unmatched_summary(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffyUnmatchedSummary:
    """How many mirrored payments are waiting for admin action (no live
    match, no "seen" acknowledgment) plus the oldest — the admin dashboard
    banner. Local read; works unconfigured."""
    row = db.query(func.count(ZeffyPaymentRecord.id), func.min(ZeffyPaymentRecord.created_at)).filter(*_unmatched_conditions(db)).first()
    count, oldest = row if row is not None else (0, None)
    return AdminZeffyUnmatchedSummary(count=count, oldest_created_at=oldest)


@zeffy_admin_router.post("/payments/{payment_id}/seen", response_model=AdminZeffySeenResponse)
def mark_payment_seen(
    payment_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffySeenResponse:
    """Mark a payment "seen": the admin's "no action needed" acknowledgment
    (suppresses the dashboard banner). Idempotent — re-marking refreshes
    the timestamp and the actor. Local write; no Zeffy call."""
    record = _get_zeffy_payment_record(db, payment_id)
    record.seen_at = datetime.now(timezone.utc)
    record.seen_by = _admin.id
    db.commit()
    logger.info("Payment %s marked seen by admin %s", payment_id, _admin.id)
    return AdminZeffySeenResponse(payment_id=payment_id, seen_at=record.seen_at)


@zeffy_admin_router.delete("/payments/{payment_id}/seen", response_model=AdminZeffySeenResponse)
def clear_payment_seen(
    payment_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffySeenResponse:
    """Clear the "seen" acknowledgment — the payment re-enters the banner
    while still unmatched. Idempotent — clearing a fresh payment is a
    no-op. Local write; no Zeffy call."""
    record = _get_zeffy_payment_record(db, payment_id)
    if record.seen_at is not None:
        record.seen_at = None
        record.seen_by = None
        db.commit()
    return AdminZeffySeenResponse(payment_id=payment_id, seen_at=record.seen_at)


@zeffy_admin_router.post("/payments/{payment_id}/match", response_model=AdminZeffyMatchResponse)
async def match_payment(
    payment_id: str,
    data: AdminZeffyMatchRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffyMatchResponse:
    """Manual match: mark the chosen unpaid cash claims paid with the payment.

    The payment is fetched fresh from the read API and checked first —
    exists, succeeded, on the dedicated campaign: the mirror's population
    (a payment outside it is never mirrored). Its mirror row is then
    refreshed + committed *before* the remaining business checks — a
    rejected match still leaves the page with the fresh state (e.g. a
    refund that landed after the webhook). Not-yet-matched and active-claim
    checks are local. A partial match (a $600 payment covering one $500
    claim) is allowed. The shared apply path does the single commit +
    per-donor confirmation email covering exactly the matched claims (a
    re-match after unmatch re-emails).
    """
    if not data.claim_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one sponsorship")

    payment = await asyncio.to_thread(_fetch_zeffy_payment, payment_id)
    if payment.status != "succeeded":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This payment hasn't completed yet (status: {payment.status})")
    if payment.campaign_id != zeffy.ZEFFY_CAMPAIGN_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment is not on the dedicated sponsorship campaign")
    # Refresh the mirror row with the fresh payment, persisted before the
    # business checks below (see the docstring).
    upsert_zeffy_payment(db, payment)
    db.commit()

    already = db.query(FamilyClaim.id).filter(FamilyClaim.zeffy_payment_id == payment_id, FamilyClaim.deleted_at.is_(None)).first()
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This payment is already matched to sponsorships — unmatch it first"
        )

    requested = set(data.claim_ids)
    claims = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.id.in_(requested),
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.commitment_type == CommitmentType.cash,
            FamilyClaim.payment_status == ClaimPaymentStatus.pending,
        )
        .all()
    )
    if len(claims) != len(requested):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All selected sponsorships must be active, unpaid cash sponsorships",
        )

    applied = await apply_payment_to_claims(db, claims, payment)
    if not applied:
        # A concurrent apply stored the same payment id between the check
        # and the write — identical state, report it as already matched.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This payment is already matched to sponsorships — unmatch it first"
        )

    families = [c.family for c in claims]
    family_info_map = batch_build_family_info(db, families)
    return AdminZeffyMatchResponse(
        payment_id=payment_id,
        claims=[
            build_claim_summary(c, family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0)))
            for c in claims
        ],
    )


@zeffy_admin_router.post("/payments/{payment_id}/unmatch", response_model=AdminZeffyUnmatchResponse)
def unmatch_payment(
    payment_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffyUnmatchResponse:
    """Correction for a wrong match: clear the payment id + paid state on
    every live claim storing it and revert them to pending with a fresh
    payment window (created_at = now — without it the next sweep would
    delete a claim whose window already lapsed). 400 if any target is
    fulfilled (fulfillment is not undone here); 404 if no claim stores the
    id. No email — a re-match (the typical next step) re-emails."""
    claims = (
        db.query(FamilyClaim)
        .filter(FamilyClaim.zeffy_payment_id == payment_id, FamilyClaim.deleted_at.is_(None))
        .order_by(FamilyClaim.id)
        .all()
    )
    if not claims:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No sponsorship is linked to this payment")

    for claim in claims:
        if claim.fulfilled_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sponsorship {claim.id} is already fulfilled — unmatching the payment won't undo that",
            )

    now = datetime.now(timezone.utc)
    for claim in claims:
        claim.zeffy_payment_id = None
        claim.paid_at = None
        claim.payment_status = ClaimPaymentStatus.pending
        claim.created_at = now  # fresh payment window
    db.commit()
    logger.info("Payment %s unmatched from claims %s", payment_id, [c.id for c in claims])

    return AdminZeffyUnmatchResponse(payment_id=payment_id, claim_ids=[c.id for c in claims])
