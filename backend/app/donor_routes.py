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
    WishType,
)
from app.permissions import require_admin, require_claim_capable
from app.response_builders import (
    apply_purchase_fields,
    batch_build_family_info,
    batch_load_person_wishes,
    build_claim_summary,
    build_family_info,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
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
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
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
def update_claim(
    claim_id: int,
    data: FamilyClaimUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> FamilyClaimSummary:
    """Update commitment_type, notes. Owner or admin only."""
    claim = get_claim_or_403(db, claim_id, user)

    partial_update(claim, data)
    db.commit()
    db.refresh(claim)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db))


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
    """
    claim = get_claim_or_403(db, claim_id, user)

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
    """Mark a claim as fulfilled. Admin only."""
    claim = get_active_or_404(db, FamilyClaim, claim_id, "Claim not found")

    if claim.fulfilled_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sponsorship is already fulfilled")

    claim.fulfilled_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(claim)

    logger.info("Admin %s fulfilled claim %s", admin.id, claim_id)

    fam = get_active_or_404(db, Family, claim.family_id, "Family not found")
    return build_claim_summary(claim, build_family_info(fam, db))
