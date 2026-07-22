"""Referrer self-service routes: own info, family CRUD, family people collection.

Self endpoints use ``require_referrer``. Family-scoped endpoints use
``require_family_owner`` which authenticates the referrer and verifies
ownership of the target family in a single dependency.
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, FamilyApprovalStatus, Person, Referrer, User
from app.permissions import FamilyOwner, require_family_owner, require_referrer
from app.response_builders import (
    build_family_detail,
    build_referrer_detail,
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
        .all()
    )

    # Single aggregation query instead of N+1 count() calls
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                approval_status=f.approval_status,
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
            family_name=f.family_name,
            family_wish=f.family_wish,
            contact_name=f.contact_name,
            approval_status=f.approval_status,
            person_count=count_map.get(f.id, 0),
            created_at=f.created_at if hasattr(f, "created_at") else None,
        )
        for f in families
    ]


@router.post("/families/{fam_id}/approve", status_code=200)
def approve_family(
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
    _send_family_approved_email(
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


def _send_family_approved_email(
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
    send_email(
        to=family_user.email,
        subject="Your family has been approved — Kindness Is Magic ✨",
        html_body=html_body,
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
    people = db.query(Person).filter(Person.family_id == fid, Person.deleted_at.is_(None)).all()
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
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
    per = Person(
        family_id=fid,
        given_name=body.given_name,
        age=body.age,
        practical_wish=body.practical_wish,
        fun_wish=body.fun_wish,
        title=body.title,
        note=body.note,
    )
    db.add(per)
    db.commit()
    db.refresh(per)
    logger.info("Referrer %s created person '%s' (id=%s) in family %s", owner.user.email, per.given_name, per.id, fid)
    return PersonDetail.model_validate(per)
