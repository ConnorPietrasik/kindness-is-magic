"""Donor / claim-capable self-service routes: /api/donor/*

Endpoints for managing family claims — available to any claim-capable role
(admin, referrer, purchaser, donor).
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Family,
    FamilyClaim,
    Person,
    User,
    UserRole,
    Wish,
)
from app.permissions import require_admin, require_claim_capable
from app.response_builders import (
    batch_load_person_wishes,
    compute_display_ids,
    FAMILY_MAX_AGE,
    FAMILY_MIN_AGE,
    FAMILY_PERSON_COUNT,
    get_or_404,
    partial_update,
)
from app.schemas import (
    _CLEAR,
    DonorWishPurchaseMark,
    FamilyClaimDetail,
    FamilyClaimSummary,
    FamilyClaimUpdate,
    PersonWishItem,
    UserResponse,
    WishSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/donor", tags=["donor"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_family_info(fam: Family, db: Session) -> dict:
    """Build the family info dict used in claim responses."""
    display_id_map = compute_display_ids(db, "family", [fam], scope=None)
    display_id = display_id_map.get(fam.id, "0")
    pc = db.query(FAMILY_PERSON_COUNT).filter(Family.id == fam.id).scalar()
    ma = db.query(FAMILY_MIN_AGE).filter(Family.id == fam.id).scalar()
    xa = db.query(FAMILY_MAX_AGE).filter(Family.id == fam.id).scalar()
    return {
        "id": fam.id,
        "display_id": display_id,
        "bio": fam.bio,
        "person_count": pc if pc else 0,
        "min_age": ma,
        "max_age": xa,
    }


# ---------------------------------------------------------------------------
# GET /api/donor/me
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserResponse)
def donor_me(user: User = Depends(require_claim_capable)):
    """Return the current user's profile."""
    return user


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

    return [
        FamilyClaimSummary(
            id=c.id,
            family=_build_family_info(families[c.family_id], db),
            commitment_type=c.commitment_type,
            notes=c.notes,
            created_at=c.created_at,
            fulfilled_at=c.fulfilled_at,
        )
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
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Owner or admin only
    if user.role != UserRole.admin and claim.donor_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to view this claim")

    fam = get_or_404(db, Family, claim.family_id, "Family not found")
    if fam.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Family not found")

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

    return FamilyClaimDetail(
        id=claim.id,
        family=_build_family_info(fam, db),
        commitment_type=claim.commitment_type,
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
        donor_user_id=claim.donor_user_id,
        donor_display_name=claim.donor_user.display_name,
        people=[
            PersonWishItem(
                given_name=p.given_name,
                title=p.title,
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
def update_claim(
    claim_id: int,
    data: FamilyClaimUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> FamilyClaimSummary:
    """Update commitment_type, notes. Owner or admin only."""
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Owner or admin only
    if user.role != UserRole.admin and claim.donor_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this claim")

    partial_update(claim, data)
    db.commit()
    db.refresh(claim)

    fam = get_or_404(db, Family, claim.family_id, "Family not found")
    return FamilyClaimSummary(
        id=claim.id,
        family=_build_family_info(fam, db),
        commitment_type=claim.commitment_type,
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
    )


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
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Owner or admin only
    if user.role != UserRole.admin and claim.donor_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to cancel this claim")

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
) -> dict:
    """Mark a wish as purchased. Sets purchased_at, purchased_where, purchaser_note, assigned_to_id.

    No received_at — that's set by delivery. Owner or admin only.
    """
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Owner or admin only
    if user.role != UserRole.admin and claim.donor_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this claim")

    # Wish must exist and belong to the claimed family
    wish = get_or_404(db, Wish, wish_id, "Wish not found")
    if wish.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found")
    if person.family_id != claim.family_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wish does not belong to the claimed family")

    now = datetime.now(timezone.utc)
    wish.purchased_at = now
    wish.assigned_to_id = user.id

    # purchased_where always overwrites (null sets to None)
    wish.purchased_where = data.purchased_where

    # purchaser_note follows partial-update convention
    if data.purchaser_note is _CLEAR:
        wish.purchaser_note = None
    elif data.purchaser_note is not None:
        wish.purchaser_note = data.purchaser_note

    db.commit()
    db.refresh(wish)

    logger.info("User %s marked wish %s as purchased on claim %s", user.id, wish_id, claim_id)
    return {
        "id": wish.id,
        "purchased_at": wish.purchased_at,
        "purchased_where": wish.purchased_where,
        "purchaser_note": wish.purchaser_note,
        "assigned_to_id": wish.assigned_to_id,
    }


# ---------------------------------------------------------------------------
# POST /api/donor/claims/{claim_id}/fulfill (admin only)
# ---------------------------------------------------------------------------


@router.post("/claims/{claim_id}/fulfill")
def fulfill_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FamilyClaimSummary:
    """Mark a claim as fulfilled. Admin only."""
    claim = get_or_404(db, FamilyClaim, claim_id, "Claim not found")
    if claim.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    if claim.fulfilled_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Claim is already fulfilled")

    claim.fulfilled_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(claim)

    logger.info("Admin %s fulfilled claim %s", admin.id, claim_id)

    fam = get_or_404(db, Family, claim.family_id, "Family not found")
    return FamilyClaimSummary(
        id=claim.id,
        family=_build_family_info(fam, db),
        commitment_type=claim.commitment_type,
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
    )
