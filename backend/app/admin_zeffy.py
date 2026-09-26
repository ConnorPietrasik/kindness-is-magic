"""Admin routes for Zeffy payment reconciliation (unmatched-payments page).

All endpoints are guarded with ``require_admin``.

* ``GET /payments`` — pass-through of the Zeffy read API (503 when Zeffy is
  unconfigured), enriched with local match state; cursor-based envelope
  (Zeffy's pagination), ``columns`` supported.
* ``GET /pending-claims`` — local read only (works unconfigured): every
  active unpaid cash claim grouped by donor; feeds the match modal.
* ``POST /payments/{id}/match`` — manual match: mark the chosen unpaid cash
  claims paid with the payment (shared apply path → confirmation emails).
* ``POST /payments/{id}/unmatch`` — correction: clear the payment id +
  paid state, revert the claims to pending with a fresh payment window.

The payment id in the path is a Zeffy UUID string, not our DB int — route
typing differs from the sibling admin modules on purpose.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import zeffy
from app.column_filter import apply_column_filter
from app.config import CASH_CLAIM_PAYMENT_HOURS
from app.database import get_db
from app.models import ClaimPaymentStatus, CommitmentType, Family, FamilyClaim, User
from app.payments import apply_payment_to_claims, claim_line_total, claims_total_usd
from app.permissions import require_admin
from app.response_builders import batch_build_family_info, build_claim_summary
from app.schemas import (
    AdminZeffyMatchRequest,
    AdminZeffyMatchResponse,
    AdminZeffyPayment,
    AdminZeffyPaymentsResponse,
    AdminZeffyPendingClaimItem,
    AdminZeffyPendingClaimsResponse,
    AdminZeffyPendingDonorGroup,
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


def _payment_buyer_name(payment: zeffy.ZeffyPayment) -> str | None:
    buyer = payment.buyer
    if buyer is None:
        return None
    name = " ".join(n for n in (buyer.first_name, buyer.last_name) if n).strip()
    return name or buyer.company_name


@zeffy_admin_router.get("/payments", response_model=AdminZeffyPaymentsResponse, response_model_exclude_unset=True)
def list_zeffy_payments(
    starting_after: str | None = Query(None, description="Cursor from the previous page's next_cursor"),
    limit: int = Query(20, ge=1, le=100),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """The dedicated campaign's succeeded payments (newest first), enriched
    with local match state. Supports the ``columns`` param; the envelope
    stays cursor-based (Zeffy pagination)."""
    _require_zeffy_configured()

    try:
        page = zeffy.list_payments(campaign_id=zeffy.ZEFFY_CAMPAIGN_ID, status="succeeded", starting_after=starting_after, limit=limit)
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")
    except zeffy.ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not fetch payments: {exc}")

    # Local match state: which (non-deleted) claims store each payment id
    claims_by_payment: dict[str, list[int]] = {}
    if page.data:
        rows = (
            db.query(FamilyClaim.zeffy_payment_id, FamilyClaim.id)
            .filter(FamilyClaim.zeffy_payment_id.in_([p.id for p in page.data]), FamilyClaim.deleted_at.is_(None))
            .all()
        )
        for payment_id, claim_id in rows:
            claims_by_payment.setdefault(payment_id, []).append(claim_id)

    items = [
        AdminZeffyPayment(
            id=p.id,
            created_at=datetime.fromtimestamp(p.created, tz=timezone.utc),
            amount_cents=p.amount,
            currency=p.currency,
            buyer_name=_payment_buyer_name(p),
            buyer_email=p.buyer.email if p.buyer is not None else None,
            receipt_url=p.receipt_url,
            claim_ids=sorted(claims_by_payment.get(p.id, [])),
            matched=bool(claims_by_payment.get(p.id)),
        )
        for p in page.data
    ]

    return {
        "payments": apply_column_filter(items, columns, always_include={"id", "matched"}),
        "has_more": page.has_more,
        "next_cursor": page.next_cursor,
    }


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


@zeffy_admin_router.post("/payments/{payment_id}/match", response_model=AdminZeffyMatchResponse)
async def match_payment(
    payment_id: str,
    data: AdminZeffyMatchRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AdminZeffyMatchResponse:
    """Manual match: mark the chosen unpaid cash claims paid with the payment.

    The payment is verified via the read API (exists, succeeded, on the
    dedicated campaign, not already matched — no currency block on manual
    match; the list shows the currency, admin judgment). A partial match
    (a $600 payment covering one $500 claim) is allowed. The shared apply
    path does the single commit + per-donor confirmation email covering
    exactly the matched claims (a re-match after unmatch re-emails).
    """
    if not data.claim_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="claim_ids must not be empty")

    payment = _fetch_zeffy_payment(payment_id)
    if payment.status != "succeeded":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Payment is not succeeded (status: {payment.status})")
    if payment.campaign_id != zeffy.ZEFFY_CAMPAIGN_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment is not on the dedicated sponsorship campaign")

    already = db.query(FamilyClaim.id).filter(FamilyClaim.zeffy_payment_id == payment_id, FamilyClaim.deleted_at.is_(None)).first()
    if already is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment is already matched to claims — unmatch first")

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
            detail="All claim_ids must be active, unpaid cash claims",
        )

    applied = await apply_payment_to_claims(db, claims, payment)
    if not applied:
        # A concurrent apply stored the same payment id between the check
        # and the write — identical state, report it as already matched.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment is already matched to claims — unmatch first")

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
    id. No email — a re-match (the typical next step) re-emails.
    """
    claims = (
        db.query(FamilyClaim)
        .filter(FamilyClaim.zeffy_payment_id == payment_id, FamilyClaim.deleted_at.is_(None))
        .order_by(FamilyClaim.id)
        .all()
    )
    if not claims:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No claims store this payment id")

    for claim in claims:
        if claim.fulfilled_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Claim {claim.id} is fulfilled — unmatch cannot undo fulfillment",
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
