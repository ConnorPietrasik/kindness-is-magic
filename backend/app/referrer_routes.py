"""Referrer self-service routes: own info, family CRUD, family people collection.

Self endpoints use ``require_referrer``. Family-scoped endpoints use
``require_family_owner`` which authenticates the referrer and verifies
ownership of the target family in a single dependency.
"""

import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Family,
    FamilyApprovalStatus,
    Person,
    Referrer,
    ReferrerApprovalStatus,
    ReferrerInviteEmail,
    User,
)
from app.permissions import FamilyOwner, require_family_owner, require_referrer
from app.response_builders import (
    build_family_detail,
    build_person_detail,
    build_referrer_detail,
    compute_display_ids,
    create_person_with_wishes,
    get_or_404,
    partial_update,
)
from app.schemas import (
    FamilyCreateByReferrer,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    FamilyUpdate,
    PendingFamilySummary,
    PersonCreateInFamily,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    ReferrerDetail,
    ReferrerUpdate,
    SendFamilyInviteRequest,
    SendFamilyInviteResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/referrer", tags=["referrer"])

# ---------------------------------------------------------------------------
# Referrer — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, user.referrer_id, "Referrer record not found")
    return ReferrerDetail(**build_referrer_detail(ref, db))


@router.patch("/me")
def update_self(
    body: ReferrerUpdate,
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, user.referrer_id, "Referrer record not found")
    partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    logger.info("Referrer %s updated own profile (id=%s)", user.email, ref.id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


# ---------------------------------------------------------------------------
# Referrer — Families
# ---------------------------------------------------------------------------


@router.get("/families")
def list_families(
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyListResponse:
    families = (
        db.query(Family)
        .filter(
            Family.referrer_id == user.referrer_id,
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
        )
        .order_by(Family.id)
        .all()
    )

    # Single aggregation query instead of N+1 count() calls
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    pos_map = compute_display_ids(db, "family", families, scope=user.referrer_id)

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                display_id=pos_map[f.id],
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                approval_status=f.approval_status,
                pickup_window=f.pickup_window,
                deleted_at=f.deleted_at,
                person_count=count_map.get(f.id, 0),
            )
            for f in families
        ]
    )


@router.get("/families/{fam_id}")
def get_family(
    fam_id: int,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    return FamilyDetail(**build_family_detail(owner.family, db))


@router.post("/families", status_code=201)
def create_family(
    body: FamilyCreateByReferrer,
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    referrer_id = user.referrer_id

    # Check family_limit not exceeded (only approved, non-deleted families count)
    current_count = (
        db.query(Family)
        .filter(
            Family.referrer_id == referrer_id,
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
        )
        .count()
    )

    ref = get_or_404(db, Referrer, referrer_id, "Referrer record not found")

    if current_count >= ref.family_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Family limit of {ref.family_limit} reached",
        )

    fam = Family(
        referrer_id=referrer_id,
        family_name=body.family_name,
        family_wish=body.family_wish,
        contact_name=body.contact_name,
        bio=body.bio,
        address=body.address,
        phone_number=body.phone_number,
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)
    logger.info("Referrer %s created family '%s' (id=%s)", user.email, fam.family_name, fam.id)
    return FamilyDetail(**build_family_detail(fam, db))


@router.patch("/families/{fam_id}")
def update_family(
    fam_id: int,
    body: FamilyUpdate,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    partial_update(owner.family, body)
    db.commit()
    db.refresh(owner.family)
    logger.info("Referrer %s updated family (id=%s)", owner.user.email, fam_id)
    return FamilyDetail(**build_family_detail(owner.family, db))


@router.delete("/families/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> Response:
    fam = owner.family
    # Soft-delete all persons in the family first to avoid orphans.
    now = datetime.now(timezone.utc)
    db.query(Person).filter(Person.family_id == fam_id).update({Person.deleted_at: now}, synchronize_session=False)
    fam.deleted_at = now
    db.commit()
    logger.info("Referrer %s soft-deleted family '%s' (id=%s)", owner.user.email, fam.family_name, fam_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Referrer — Pending Families (approval queue)
# ---------------------------------------------------------------------------


@router.get("/pending-families")
def list_pending_families(
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> list[PendingFamilySummary]:
    """List families awaiting this referrer's approval."""
    families = (
        db.query(Family)
        .filter(
            Family.referrer_id == user.referrer_id,
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.pending,
        )
        .all()
    )

    # Single aggregation query instead of N+1 count() calls
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    return [
        PendingFamilySummary(
            id=f.id,
            display_id="PENDING",
            family_name=f.family_name,
            family_wish=f.family_wish,
            contact_name=f.contact_name,
            approval_status=f.approval_status,
            pickup_window=f.pickup_window,
            person_count=count_map.get(f.id, 0),
            created_at=f.created_at,
        )
        for f in families
    ]


@router.post("/families/{fam_id}/approve", status_code=200)
async def approve_family(
    fam_id: int,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    """Approve a pending family."""
    fam = owner.family

    if fam.approval_status != FamilyApprovalStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Family is not in pending status",
        )

    # Check family_limit before approving
    current_count = (
        db.query(Family)
        .filter(
            Family.referrer_id == owner.user.referrer_id,
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
        )
        .count()
    )

    ref = get_or_404(db, Referrer, owner.user.referrer_id, "Referrer record not found")
    if current_count >= ref.family_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Family limit of {ref.family_limit} reached. Cannot approve without freeing a slot.",
        )

    fam.approval_status = FamilyApprovalStatus.approved
    db.commit()
    db.refresh(fam)
    logger.info("Referrer %s approved family '%s' (id=%s)", owner.user.email, fam.family_name, fam_id)

    # Send approval notification email to the family
    await _send_family_approved_email(
        fam=fam,
        db=db,
        referrer_display_name=owner.user.display_name or "",
    )

    return FamilyDetail(**build_family_detail(fam, db))


@router.post("/families/{fam_id}/reject", status_code=200)
def reject_family(
    fam_id: int,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    """Reject a pending family."""
    fam = owner.family

    if fam.approval_status != FamilyApprovalStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Family is not in pending status",
        )

    fam.approval_status = FamilyApprovalStatus.rejected
    db.commit()
    db.refresh(fam)
    logger.info("Referrer %s rejected family '%s' (id=%s)", owner.user.email, fam.family_name, fam_id)

    return FamilyDetail(**build_family_detail(fam, db))


async def _send_family_approved_email(
    fam: Family,
    db: Session,
    referrer_display_name: str,
) -> None:
    """Send a notification email to the family contact when approved."""
    from app.mail import build_family_approved_email, send_email

    family_user = db.query(User).filter(User.family_id == fam.id).first()
    if not family_user:
        return

    html_body = build_family_approved_email(fam.family_name, referrer_display_name)
    await send_email(
        to=family_user.email,
        subject="Your family has been approved — Kindness Is Magic ✨",
        html_body=html_body,
        db=db,
    )


# ---------------------------------------------------------------------------
# Referrer — People within a family
# ---------------------------------------------------------------------------


@router.get("/families/{fid}/people")
def list_family_people(
    fid: int,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> PersonListResponse:
    people = db.query(Person).filter(Person.family_id == fid, Person.deleted_at.is_(None)).order_by(Person.id).all()
    pos_map = compute_display_ids(db, "person", people, scope=fid)
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
                display_id=pos_map[p.id],
                family_id=p.family_id,
                given_name=p.given_name,
                age=p.age,
                deleted_at=p.deleted_at,
            )
            for p in people
        ]
    )


@router.post("/families/{fid}/people", status_code=201)
def create_family_person(
    fid: int,
    body: PersonCreateInFamily,
    owner: FamilyOwner = Depends(require_family_owner),
    db: Session = Depends(get_db),
) -> PersonDetail:
    per = create_person_with_wishes(
        db,
        family_id=fid,
        given_name=body.given_name,
        age=body.age,
        wishes=body.wishes,
        title=body.title,
        note=body.note,
    )
    db.commit()
    db.refresh(per)
    logger.info("Referrer %s created person '%s' (id=%s) in family %s", owner.user.email, per.given_name, per.id, fid)
    return PersonDetail(**build_person_detail(per, db))


# ---------------------------------------------------------------------------
# Referrer — Send Family Invite Email
# ---------------------------------------------------------------------------


@router.post("/send-family-invite", response_model=SendFamilyInviteResponse)
async def send_family_invite(
    body: SendFamilyInviteRequest,
    user: User = Depends(require_referrer),
    db: Session = Depends(get_db),
) -> SendFamilyInviteResponse:
    """Send a family invite email to the given address.

    The email includes the referrer's family invite code and a link to the
    family self-registration page.

    Rate limits:
    * A recipient can receive at most one invite email every 7 days (global,
      across all referrers) to protect SMTP reputation.
    * A referrer can send at most ``family_limit`` invite emails per 24-hour
      rolling window.
    """
    from app.mail import build_family_invite_email, send_email

    ref = get_or_404(db, Referrer, user.referrer_id, "Referrer record not found")

    # Only approved referrers can send family invite emails
    if ref.approval_status != ReferrerApprovalStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can send invites once your account is approved.",
        )

    recipient = body.email.lower()
    now = datetime.now(timezone.utc)

    # --- Global per-recipient dedup (7-day window) ---
    seven_days_ago = now - timedelta(days=7)
    existing = (
        db.query(ReferrerInviteEmail)
        .filter(
            ReferrerInviteEmail.recipient_email == recipient,
            ReferrerInviteEmail.sent_at >= seven_days_ago,
        )
        .first()
    )
    if existing:
        logger.info(
            "Invite to %s blocked (already sent in last 7 days by referrer %s)",
            recipient,
            existing.referrer_id,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="An invite has already been sent to this email. Try again in 7 days.",
        )

    # --- Per-referrer daily cap (24-hour rolling window) ---
    twenty_four_hours_ago = now - timedelta(hours=24)
    daily_count = (
        db.query(ReferrerInviteEmail)
        .filter(
            ReferrerInviteEmail.referrer_id == ref.id,
            ReferrerInviteEmail.sent_at >= twenty_four_hours_ago,
        )
        .count()
    )
    if daily_count >= ref.family_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily invite limit of {ref.family_limit} reached. Try again tomorrow.",
        )

    html_body = build_family_invite_email(
        code=ref.family_invite_code,
        referrer_name=ref.name,
    )
    result = await send_email(
        to=body.email,
        subject="You're invited to join Kindness Is Magic",
        html_body=html_body,
        db=db,
    )

    # Record the send and return the appropriate status
    if result["sent"]:
        try:
            db.add(
                ReferrerInviteEmail(
                    referrer_id=ref.id,
                    recipient_email=recipient,
                    sent_at=now,
                )
            )
            db.commit()
        except Exception:
            logger.exception("Failed to record invite email for referrer %s", ref.id)
    elif result["reason"] == "unsubscribed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This email address has unsubscribed.",
        )
    else:
        # smtp_error or other infrastructure failure
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send email. Please try again later.",
        )

    logger.info(
        "Referrer %s sent family invite to %s",
        user.email,
        body.email,
    )

    return SendFamilyInviteResponse()
