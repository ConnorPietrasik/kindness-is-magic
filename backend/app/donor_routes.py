"""Donor / claim-capable self-service routes: /api/donor/*

Endpoints for managing family claims — available to any claim-capable role
(admin, referrer, purchaser, donor).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import CASH_CLAIM_PAYMENT_HOURS, GIFT_CLAIM_CAP, ZEFFY_FORM_URL
from app.database import get_db
from app.deadlines import GIFT_CLAIM_BLOCKED_DETAIL, is_type_armed
from app.display_ids import compute_display_ids
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    DeadlineType,
    EmailKind,
    EmailStatus,
    Family,
    FamilyClaim,
    Person,
    SentEmail,
    User,
    UserRole,
    Wish,
    WishLockLevel,
    WishType,
)
from app.payments import (
    apply_payment_to_claims,
    cart_payment_expires_at,
    cart_window_anchor,
    claims_total_usd,
    claim_line_total,
    pending_cash_claims_for,
    send_payment_confirmation_email,
    send_payment_request_email,
)
from app.permissions import require_admin, require_claim_capable
from app.rate_limit import limiter
from app.response_builders import (
    apply_purchase_fields,
    batch_build_family_info,
    batch_load_person_wishes,
    build_claim_summary,
    build_family_info,
    claim_payment_expires_at,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    AdminClaimMarkPaid,
    CartCheckoutRequest,
    CartCheckoutResponse,
    CartConfirmResponse,
    CartItem,
    CartItemUpdate,
    CartResponse,
    DonorWishPurchaseMark,
    DonorWishPurchaseResponse,
    FamilyClaimDetail,
    FamilyClaimSummary,
    FamilyClaimUpdate,
    FamilyInfo,
    PersonWishItem,
    UserResponse,
    WishSummary,
)
import app.zeffy as zeffy
from app.mail import send_claim_confirmation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/donor", tags=["donor"])


def get_claim_or_403(db: Session, claim_id: int, user: User) -> FamilyClaim:
    """Load a non-deleted claim the user may access, else raise.

    Raises 404 if the claim does not exist or is soft-deleted, and 403
    unless the user is the claim's donor or an admin.
    """
    claim = get_active_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if user.role != UserRole.admin and claim.donor_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this sponsorship")
    return claim


def _get_own_pending_cash_claim(db: Session, claim_id: int, user: User) -> FamilyClaim:
    """Load the donor's own non-deleted PENDING CASH claim, else raise.

    404 when missing/deleted, 403 for other users' claims, 400 when the
    claim is not a pending cash claim (gifts or already-paid cash don't live
    in the cart).
    """
    claim = get_claim_or_403(db, claim_id, user)
    if claim.commitment_type != CommitmentType.cash or claim.payment_status != ClaimPaymentStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only unpaid cash sponsorships are in the cart")
    return claim


def _nudge_send_failed(db: Session, donor_email: str, window_anchor: datetime) -> bool:
    """True when the window's "please pay" nudge has a failed send and no successful one.

    Derived from the email log — the nudge was sent on a previous request.
    Only rows at/after the window anchor (min created_at of the donor's
    pending cash claims) count — ``>=`` so a failed nudge recorded in the
    same instant as its claims (one long transaction) still shows.
    """
    rows = (
        db.query(SentEmail.status)
        .filter(
            SentEmail.recipient_email == donor_email.strip().lower(),
            SentEmail.kind == EmailKind.payment_request,
            SentEmail.sent_at >= window_anchor,
        )
        .all()
    )
    statuses = {row[0] for row in rows}
    return EmailStatus.failed in statuses and EmailStatus.sent not in statuses


# ---------------------------------------------------------------------------
# GET /api/donor/me
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserResponse)
def donor_me(user: User = Depends(require_claim_capable)):
    """Return the current user's profile."""
    return user


# ---------------------------------------------------------------------------
# Donor cart (cash sponsorship checkout)
# ---------------------------------------------------------------------------


@router.get("/cart", response_model=CartResponse)
def get_cart(
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> CartResponse:
    """The donor's committed (in-progress) pending cash claims.

    The server half of the cart page — the frontend merges this with the
    local (uncommitted) items. Line prices use the same constants as the
    checkout recompute (the server total at checkout is the source of
    truth). ``email_error`` is set when the window's "please pay" nudge has
    a failed send and no successful one, so a donor who missed the email
    isn't left guessing.
    """
    claims = pending_cash_claims_for(db, user.id)

    items: list[CartItem] = []
    if claims:
        families = [c.family for c in claims]
        family_info_map = batch_build_family_info(db, families)
        for claim in claims:
            items.append(
                CartItem(
                    claim_id=claim.id,
                    family=family_info_map.get(claim.family_id, FamilyInfo(id=claim.family_id, display_id="0", bio=None, person_count=0)),
                    includes_groceries=claim.includes_groceries,
                    line_total_usd=claim_line_total(claim),
                    payment_expires_at=claim_payment_expires_at(claim),
                )
            )

    email_error = None
    anchor = cart_window_anchor(claims)
    if anchor is not None and _nudge_send_failed(db, user.email, anchor):
        email_error = "Payment request email failed to send — you can still pay from the cart."

    return CartResponse(
        items=items,
        item_count=len(items),
        total_usd=claims_total_usd(claims),
        payment_expires_at=cart_payment_expires_at(claims),
        email_error=email_error,
    )


@router.patch("/cart/items/{claim_id}", response_model=CartItem)
def toggle_cart_groceries(
    claim_id: int,
    data: CartItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> CartItem:
    """Toggle the groceries add-on on the donor's own pending cash claim."""
    claim = _get_own_pending_cash_claim(db, claim_id, user)
    claim.includes_groceries = data.includes_groceries
    db.commit()
    db.refresh(claim)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return CartItem(
        claim_id=claim.id,
        family=build_family_info(fam, db),
        includes_groceries=claim.includes_groceries,
        line_total_usd=claim_line_total(claim),
        payment_expires_at=claim_payment_expires_at(claim),
    )


@router.post("/cart/checkout", response_model=CartCheckoutResponse)
async def cart_checkout(
    data: CartCheckoutRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> CartCheckoutResponse:
    """Commit the donor's uncommitted cart items into pending cash claims and
    return the Zeffy URL for the server-recomputed whole-cart total.

    * 503 when Zeffy is unconfigured (no form URL / campaign ID) — this gate
      runs **before** item validation, so nothing is created when checkout
      can't complete (unconfigured dev/e2e default state).
    * 400 when the resulting cart (existing pending + submitted items) is
      empty; 409 (detail carries the family's display_id **and** raw id so
      the frontend can drop exactly that local item) when a submitted family
      is already claimed — by anyone, including this donor's cart.
    * The pending claims are created in a single commit; the "please pay"
      nudge goes out best-effort, at most once per payment window.
    """
    data = data or CartCheckoutRequest()

    # 1. 503 gate — before any validation (a typo'd campaign ID or an
    #    unconfigured backend fails loudly on the donor's first checkout;
    #    nothing is created. One-time campaign validation, cached on
    #    success, failures never cached)
    if not ZEFFY_FORM_URL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy checkout is not configured — please contact the organization."
        )
    try:
        await asyncio.to_thread(zeffy.validate_configured_campaign)
    except zeffy.ZeffyCampaignNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except zeffy.ZeffyNotConfiguredError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy is not configured — please contact the organization."
        )
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")

    # 2. Existing pending cart + empty-resulting-cart check
    pending_claims = pending_cash_claims_for(db, user.id)
    existing_family_ids = {c.family_id for c in pending_claims}
    if not pending_claims and not data.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your sponsorship cart is empty")

    # 3. Validate the submitted items
    new_claims: list[FamilyClaim] = []
    if data.items:
        submitted_ids = [item.family_id for item in data.items]
        fams = {f.id: f for f in db.query(Family).filter(Family.id.in_(submitted_ids)).all()}
        display_id_map = compute_display_ids(db, "family", list(fams.values()), scope=None) if fams else {}

        seen: set[int] = set()
        for item in data.items:
            fam = fams.get(item.family_id)
            if fam is None or fam.deleted_at is not None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Family not found")
            if fam.wish_lock_level != WishLockLevel.admin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This family hasn't been fully approved yet.",
                )
            display_id = display_id_map.get(fam.id, "0")
            if item.family_id in existing_family_ids or item.family_id in seen:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Family {display_id} (id {fam.id}) is already in your cart",
                )
            seen.add(item.family_id)
            taken = db.query(FamilyClaim.id).filter(FamilyClaim.family_id == fam.id, FamilyClaim.deleted_at.is_(None)).first()
            if taken is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Family {display_id} (id {fam.id}) was just sponsored — it has been removed from your cart",
                )

        # 4. Create the pending cash claims (single commit)
        for item in data.items:
            new_claims.append(
                FamilyClaim(
                    donor_user_id=user.id,
                    family_id=item.family_id,
                    commitment_type=CommitmentType.cash,
                    payment_status=ClaimPaymentStatus.pending,
                    includes_groceries=item.includes_groceries,
                )
            )
        db.add_all(new_claims)
        try:
            db.commit()
        except IntegrityError:
            # Two checkouts raced on the reservation index — the loser is
            # this request. Roll back and name the family that got taken.
            db.rollback()
            taken_now = {
                family_id
                for (family_id,) in db.query(FamilyClaim.family_id)
                .filter(FamilyClaim.family_id.in_(submitted_ids), FamilyClaim.deleted_at.is_(None))
                .all()
                if family_id not in existing_family_ids
            }
            for item in data.items:
                if item.family_id in taken_now:
                    display_id = display_id_map.get(item.family_id, "0")
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Family {display_id} (id {item.family_id}) was just sponsored — it has been removed from your cart",
                    )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="One of the families in your cart was just sponsored — remove it and try again.",
            )
        for claim in new_claims:
            db.refresh(claim)

    # 5. Whole pending cart (existing + newly committed) — the server
    #    recompute is the source of truth for the required payment amount.
    #    Zeffy forms can't pre-fill it via URL, so the donor enters the
    #    total by hand (the cart page and the nudge email carry the
    #    instructions); the URL only pre-fills the donor's email.
    all_pending = pending_cash_claims_for(db, user.id)
    total_usd = claims_total_usd(all_pending)
    zeffy_url = f"{ZEFFY_FORM_URL}?{urlencode({'email': user.email})}"

    logger.info("User %s checked out cart (new claims: %s, total: $%s)", user.id, [c.id for c in new_claims], total_usd)

    # 6. "Please pay" nudge — at most once per payment window (best-effort;
    #    SMTP failure never fails the checkout)
    await send_payment_request_email(db, user, all_pending)

    return CartCheckoutResponse(zeffy_url=zeffy_url, claim_ids=[c.id for c in new_claims])


@router.post("/cart/confirm", response_model=CartConfirmResponse)
@limiter.limit("1/30 seconds", error_message="try again in a moment")
async def cart_confirm(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> CartConfirmResponse:
    """Manual "I completed my payment" — run reconciliation against Zeffy.

    Rate-limited to 1 per 30 seconds per IP (spam guard against scripted
    hammering; a 429 returns the friendly hint in the limit string — the
    webhook and admin manual match are the backstops, so a blocked donor is
    never stuck). Match → the donor's current pending claims flip to paid
    (single commit) and the confirmation email goes out; no match →
    ``pending``; a same-donor different-amount payment → ``mismatch``.

    An empty cart whose claims are freshly paid (a payment already landed via
    the webhook / a rival apply / an admin match) also reports ``paid`` — a
    swept (expired, released) cart leaves no paid rows and reports
    ``pending``.
    """
    claims = pending_cash_claims_for(db, user.id)
    if not claims:
        # No pending cart — nothing to reconcile. Usually the payment already
        # landed (webhook, rival apply, admin match) and paid the donor's
        # claims — report "paid" (claims paid within one payment window +
        # sweep-lag margin) instead of "pending", which would send the donor
        # polling. A swept expired cart leaves no paid rows, so "pending"
        # stands there; an OLD paid claim from a previous sponsorship is
        # excluded by the freshness bound.
        fresh_since = datetime.now(timezone.utc) - timedelta(hours=CASH_CLAIM_PAYMENT_HOURS + 1)
        paid = (
            db.query(FamilyClaim)
            .filter(
                FamilyClaim.donor_user_id == user.id,
                FamilyClaim.commitment_type == CommitmentType.cash,
                FamilyClaim.payment_status == ClaimPaymentStatus.paid,
                FamilyClaim.paid_at >= fresh_since,
                FamilyClaim.deleted_at.is_(None),
            )
            .order_by(FamilyClaim.id)
            .all()
        )
        if paid:
            families = [c.family for c in paid]
            family_info_map = batch_build_family_info(db, families)
            return CartConfirmResponse(
                status="paid",
                claims=[
                    build_claim_summary(
                        c, family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0))
                    )
                    for c in paid
                ],
            )
        return CartConfirmResponse(status="pending")

    total_usd = claims_total_usd(claims)
    anchor = cart_window_anchor(claims)
    try:
        match = await asyncio.to_thread(zeffy.find_cart_payment, user.email, total_usd * 100, anchor)
    except zeffy.ZeffyNotConfiguredError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy is not configured — please contact the organization."
        )
    except zeffy.ZeffyAuthError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zeffy is misconfigured — please try again later.")
    except zeffy.ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not check your payment: {exc}")

    if match.payment is not None:
        applied = await apply_payment_to_claims(db, claims, match.payment)
        if applied:
            families = [c.family for c in claims]
            family_info_map = batch_build_family_info(db, families)
            return CartConfirmResponse(
                status="paid",
                claims=[
                    build_claim_summary(
                        c, family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0))
                    )
                    for c in claims
                ],
            )
        # The payment id was already stored (a webhook/rival apply landed
        # first) — the claims may or may not be paid now; report from the DB.
        claims = pending_cash_claims_for(db, user.id)
        if not claims:
            # No pending claims left: the rival apply paid this donor's cart —
            # report "paid" with the claims now storing the payment id (a
            # "pending" response would send the donor polling). Filtered to
            # this donor: the stored id could in principle sit on another
            # donor's claims, which are not this user's to report.
            paid = (
                db.query(FamilyClaim)
                .filter(
                    FamilyClaim.donor_user_id == user.id,
                    FamilyClaim.zeffy_payment_id == match.payment.id,
                    FamilyClaim.deleted_at.is_(None),
                )
                .order_by(FamilyClaim.id)
                .all()
            )
            if paid:
                families = [c.family for c in paid]
                family_info_map = batch_build_family_info(db, families)
                return CartConfirmResponse(
                    status="paid",
                    claims=[
                        build_claim_summary(
                            c, family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0))
                        )
                        for c in paid
                    ],
                )
            return CartConfirmResponse(status="pending")
        # fall through to the normal report for whatever is still pending

    if match.other_payments:
        found = match.other_payments[0]
        return CartConfirmResponse(status="mismatch", expected_usd=total_usd, found_usd=found.amount // 100)

    return CartConfirmResponse(status="pending")


# ---------------------------------------------------------------------------
# GET /api/donor/claims
# ---------------------------------------------------------------------------


@router.get("/claims")
def list_claims(
    fulfilled: bool | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> list[FamilyClaimSummary]:
    """List this user's claims (excludes soft-deleted).

    Optional ``fulfilled`` query param: ``true`` for fulfilled only,
    ``false`` for active only, omit for all.
    """
    query = db.query(FamilyClaim).filter(
        FamilyClaim.donor_user_id == user.id,
        FamilyClaim.deleted_at.is_(None),
    )

    if fulfilled is not None:
        query = query.filter(FamilyClaim.fulfilled_at.isnot(None) if fulfilled else FamilyClaim.fulfilled_at.is_(None))

    claims = query.order_by(FamilyClaim.created_at.desc()).all()

    # Batch load family info
    family_ids = [c.family_id for c in claims]
    families: dict[int, Family] = {}
    if family_ids:
        for f in db.query(Family).filter(Family.id.in_(family_ids)).all():
            families[f.id] = f

    family_info_map = batch_build_family_info(db, list(families.values()))

    return [
        build_claim_summary(c, family_info_map.get(c.family_id, FamilyInfo(id=c.family_id, display_id="0", bio=None, person_count=0)))
        for c in claims
    ]


# ---------------------------------------------------------------------------
# GET /api/donor/claims/{claim_id}
# ---------------------------------------------------------------------------


@router.get("/claims/{claim_id}")
def get_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> FamilyClaimDetail:
    """Get claim detail with wish list. Owner or admin only."""
    claim = get_claim_or_403(db, claim_id, user)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")

    # Active people ordered by id
    people = (
        db.query(Person)
        .filter(
            Person.family_id == claim.family_id,
            Person.deleted_at.is_(None),
        )
        .order_by(Person.id)
        .all()
    )

    # Batch-load wishes
    person_ids = [p.id for p in people]
    wishes_by_person = batch_load_person_wishes(db, person_ids)

    # The family wish is part of the claim too — a claim covers the whole family
    family_wish = db.query(Wish).filter(Wish.family_id == fam.id, Wish.type == WishType.family, Wish.deleted_at.is_(None)).first()

    return FamilyClaimDetail(
        id=claim.id,
        family=build_family_info(fam, db),
        commitment_type=claim.commitment_type,
        payment_status=claim.payment_status,
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
        paid_at=claim.paid_at,
        payment_expires_at=claim_payment_expires_at(claim),
        zeffy_payment_id=claim.zeffy_payment_id,
        includes_groceries=claim.includes_groceries,
        donor_user_id=claim.donor_user_id,
        donor_display_name=claim.donor_user.display_name,
        family_wish=WishSummary.model_validate(family_wish) if family_wish is not None else None,
        people=[
            PersonWishItem(
                given_name=p.given_name,
                role=p.role,
                age=p.age,
                note=p.note,
                wishes=[WishSummary.model_validate(w) for w in wishes_by_person.get(p.id, [])],
            )
            for p in people
        ],
    )


# ---------------------------------------------------------------------------
# PATCH /api/donor/claims/{claim_id}
# ---------------------------------------------------------------------------


@router.patch("/claims/{claim_id}")
async def update_claim(
    claim_id: int,
    data: FamilyClaimUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> FamilyClaimSummary:
    """Update notes; switch commitment_type while unpaid. Owner or admin only.

    * ``notes`` editing stays unrestricted as today.
    * The commitment type can only change while the claim is **unpaid**
      (``paid_at`` null) and active (unfulfilled) — otherwise 400. Side
      effects (email, ``created_at`` restart) fire **only on an actual type
      change** — re-sending the same type is a plain no-op:

      * **gifts→cash** — the claim enters the payment flow (``pending``,
        a fresh 48h window via ``created_at = now``) and the "please pay"
        nudge goes out (a one-item checkout; the once-per-window rule
        applies).
      * **cash→gifts** — only possible while pending: the claim is released
        (``paid``; the donor never got a gift confirmation, so one goes out
        now) and must pass the standard new-gift-claim checks — the gift
        cap and the armed ``gift_dropoff`` deadline gate (a conversion is a
        new gift claim), each with the same 400 as the claim endpoint.
    """
    claim = get_claim_or_403(db, claim_id, user)

    new_type = data.commitment_type
    is_toggle = new_type is not None and new_type != claim.commitment_type

    if is_toggle:
        if claim.paid_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Commitment type can only be changed while the sponsorship is unpaid",
            )
        if claim.fulfilled_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Commitment type can only be changed while the sponsorship is active",
            )

    email_error: str | None = None
    if new_type == CommitmentType.cash and claim.commitment_type == CommitmentType.gifts:
        # gifts→cash: into the payment flow + a fresh payment window.
        claim.commitment_type = CommitmentType.cash
        claim.payment_status = ClaimPaymentStatus.pending
        claim.created_at = datetime.now(timezone.utc)
        partial_update(claim, data, exclude={"commitment_type"})  # notes, if sent
        db.commit()
        db.refresh(claim)
        logger.info("User %s toggled claim %s gifts→cash (new payment window)", user.id, claim_id)
        email_error = await send_payment_request_email(db, user, [claim])
    elif new_type == CommitmentType.gifts and claim.commitment_type == CommitmentType.cash:
        # cash→gifts: release the claim (pending only) as a new gift claim.
        if claim.payment_status != ClaimPaymentStatus.pending:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Commitment type can only be changed while the sponsorship is unpaid",
            )
        if is_type_armed(db, DeadlineType.gift_dropoff):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=GIFT_CLAIM_BLOCKED_DETAIL)
        current_gift_count = (
            db.query(func.count(FamilyClaim.id))
            .filter(
                FamilyClaim.donor_user_id == user.id,
                FamilyClaim.deleted_at.is_(None),
                FamilyClaim.fulfilled_at.is_(None),
                FamilyClaim.commitment_type == CommitmentType.gifts,
            )
            .scalar()
        )
        if current_gift_count >= GIFT_CLAIM_CAP:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gift sponsorship limit of {GIFT_CLAIM_CAP} reached",
            )
        claim.commitment_type = CommitmentType.gifts
        claim.payment_status = ClaimPaymentStatus.paid
        claim.paid_at = None
        claim.zeffy_payment_id = None
        claim.includes_groceries = False
        partial_update(claim, data, exclude={"commitment_type"})  # notes, if sent
        db.commit()
        db.refresh(claim)
        logger.info("User %s toggled claim %s cash→gifts (released to a gift claim)", user.id, claim_id)
        fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
        email_error = await send_claim_confirmation(claim, fam, user, db)
    else:
        # Notes-only update, or the same type re-sent (plain no-op for the type).
        partial_update(claim, data)
        db.commit()
        db.refresh(claim)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db), email_error=email_error)


# ---------------------------------------------------------------------------
# DELETE /api/donor/claims/{claim_id}
# ---------------------------------------------------------------------------


@router.delete("/claims/{claim_id}", status_code=204)
def cancel_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
):
    """Soft-delete (cancel) a claim. Owner or admin only."""
    claim = get_claim_or_403(db, claim_id, user)

    claim.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("User %s cancelled claim %s", user.id, claim_id)


# ---------------------------------------------------------------------------
# POST /api/donor/claims/{claim_id}/wishes/{wish_id}/mark-purchased
# ---------------------------------------------------------------------------


@router.post("/claims/{claim_id}/wishes/{wish_id}/mark-purchased")
def mark_wish_purchased(
    claim_id: int,
    wish_id: int,
    data: DonorWishPurchaseMark,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> DonorWishPurchaseResponse:
    """Mark a wish as purchased. Sets purchased_at, purchased_where, purchaser_note, assigned_to_id.

    No received_at — that's set by delivery. Owner or admin only.

    Cash sponsorships have no wish purchasing: the flat amount covers the
    whole family (400, not 403 — the donor owns the claim, just not this
    action).
    """
    claim = get_claim_or_403(db, claim_id, user)
    if claim.commitment_type == CommitmentType.cash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cash sponsorships have no wish purchasing — the flat amount covers the family's wishes",
        )

    # Wish must exist and belong to the claimed family
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    # A claim covers the whole family: person wishes resolve their family
    # through the person; family wishes belong to the claimed family directly
    if wish.person_id is None:
        if wish.family_id != claim.family_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wish does not belong to the sponsored family")
    else:
        person = get_or_404(db, Person, wish.person_id, "Person not found")
        if person.family_id != claim.family_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wish does not belong to the sponsored family")

    wish.assigned_to_id = user.id
    apply_purchase_fields(
        wish, purchased_at=datetime.now(timezone.utc), purchased_where=data.purchased_where, purchaser_note=data.purchaser_note
    )

    db.commit()
    db.refresh(wish)

    logger.info("User %s marked wish %s as purchased on claim %s", user.id, wish_id, claim_id)
    return DonorWishPurchaseResponse.model_validate(wish)


# ---------------------------------------------------------------------------
# POST /api/donor/claims/{claim_id}/fulfill (admin only)
# ---------------------------------------------------------------------------


@router.post("/claims/{claim_id}/fulfill")
def fulfill_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FamilyClaimSummary:
    """Mark a claim as fulfilled. Admin only.

    Cash claims must be paid first (``paid_at`` set — by the apply path or
    mark-paid) — otherwise 400, so an unpaid sponsorship can never be
    closed out.
    """
    claim = get_active_or_404(db, FamilyClaim, claim_id, "Claim not found")

    if claim.commitment_type == CommitmentType.cash and claim.paid_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cash sponsorships must be paid before fulfillment — match or record the payment first",
        )

    if claim.fulfilled_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sponsorship is already fulfilled")

    claim.fulfilled_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(claim)

    logger.info("Admin %s fulfilled claim %s", admin.id, claim_id)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db))


# ---------------------------------------------------------------------------
# Admin: manual payment recording (offline cash/cheque, staff-recorded)
# ---------------------------------------------------------------------------


@router.post("/claims/{claim_id}/mark-paid")
async def mark_claim_paid(
    claim_id: int,
    data: AdminClaimMarkPaid | None = Body(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FamilyClaimSummary:
    """Admin: manually record payment for an unpaid cash claim.

    For offline cash/cheque, staff-recorded sponsorships, anything auto-match
    couldn't handle. Sets ``paid`` + ``paid_at`` (plus an optional
    ``zeffy_payment_id`` when the offline payment does have a Zeffy record to
    link). 400 if the claim is already paid (double-click guard — and no
    re-email), and 400 for non-cash claims. Sends the payment-confirmed
    email when enabled (``SEND_PAYMENT_CONFIRMED_EMAIL``, off by default),
    keeping the 1 payment ↔ 1 confirmation story for the offline path.
    """
    claim = get_active_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.commitment_type != CommitmentType.cash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only cash sponsorships can be marked paid")
    if claim.paid_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sponsorship is already paid")

    data = data or AdminClaimMarkPaid()
    claim.payment_status = ClaimPaymentStatus.paid
    claim.paid_at = datetime.now(timezone.utc)
    if data.zeffy_payment_id:
        claim.zeffy_payment_id = data.zeffy_payment_id
    db.commit()
    db.refresh(claim)
    logger.info("Admin %s marked cash claim %s paid (zeffy_payment_id=%s)", admin.id, claim_id, data.zeffy_payment_id)

    await send_payment_confirmation_email(db, [claim])

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db))


@router.post("/claims/{claim_id}/restore")
def restore_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FamilyClaimSummary:
    """Admin: revive a soft-deleted unpaid cash claim (the expired case).

    Sets ``deleted_at = None`` and ``created_at = now`` (a fresh payment
    window — a stale ``created_at`` would be swept again immediately). No
    email: in the recovery flow the donor already paid and the confirmation
    at match is their email. 400 unless soft-deleted, cash, and unpaid;
    409 if the family was re-claimed in the meantime (the reservation index
    refuses the revive).
    """
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only cancelled or expired sponsorships can be restored")
    if claim.commitment_type != CommitmentType.cash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only cash sponsorships can be restored")
    if claim.paid_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Paid sponsorships cannot be restored")

    taken = db.query(FamilyClaim.id).filter(FamilyClaim.family_id == claim.family_id, FamilyClaim.deleted_at.is_(None)).first()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This family has been sponsored again — the cancelled claim cannot be restored"
        )

    claim.deleted_at = None
    claim.created_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(claim)
    logger.info("Admin %s restored cash claim %s (new payment window)", admin.id, claim_id)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db))
