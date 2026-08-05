"""Family self-service routes: own info, people collection.

All endpoints are guarded with ``require_family``.
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, User
from app.permissions import require_family
from app.response_builders import (
    batch_load_person_wishes,
    build_family_detail,
    build_person_detail,
    compute_display_ids,
    create_person_with_wishes,
    get_active_or_404,
    partial_update,
)
from app.schemas import (
    FamilySelfServiceDetail,
    FamilyUpdate,
    PersonCreateInFamily,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    WishSummary,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/family", tags=["family"])

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_FAMILY_LOCKED_MSG = "Your family profile is locked for editing. Contact your referrer to request changes."


def _check_family_edit_lock(fam: Family) -> None:
    """Raise 403 if the family cannot edit at the current lock level."""
    if fam.wish_lock_level != "family":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_FAMILY_LOCKED_MSG,
        )


# ---------------------------------------------------------------------------
# Family — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilySelfServiceDetail:
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")
    return FamilySelfServiceDetail(**build_family_detail(fam, db))


@router.patch("/me")
def update_self(
    body: FamilyUpdate,
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilySelfServiceDetail:
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")
    _check_family_edit_lock(fam)

    partial_update(fam, body)

    db.commit()
    db.refresh(fam)
    logger.info("Family user %s updated own profile (family id=%s)", user.email, fam.id)
    return FamilySelfServiceDetail(**build_family_detail(fam, db))


# ---------------------------------------------------------------------------
# Family — Review workflow
# ---------------------------------------------------------------------------


@router.post("/me/request-review")
def request_review(
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilySelfServiceDetail:
    """Family requests referrer review of their wishes."""
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")

    if fam.wish_lock_level != "family":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot request review at current lock level.",
        )
    if fam.wish_review_requested_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A review request is already pending.",
        )

    fam.wish_review_requested_at = datetime.now(timezone.utc)
    fam.wish_rejection_reason = None

    db.commit()
    db.refresh(fam)
    logger.info("Family user %s requested review (family id=%s)", user.email, fam.id)
    return FamilySelfServiceDetail(**build_family_detail(fam, db))


@router.post("/me/cancel-review")
def cancel_review(
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilySelfServiceDetail:
    """Family cancels a pending review request."""
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")

    if fam.wish_lock_level != "family":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel review at current lock level.",
        )
    if fam.wish_review_requested_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending review request to cancel.",
        )

    fam.wish_review_requested_at = None

    db.commit()
    db.refresh(fam)
    logger.info("Family user %s cancelled review request (family id=%s)", user.email, fam.id)
    return FamilySelfServiceDetail(**build_family_detail(fam, db))


# ---------------------------------------------------------------------------
# Family — People
# ---------------------------------------------------------------------------


@router.get("/people")
def list_people(
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> PersonListResponse:
    people = db.query(Person).filter(Person.family_id == user.family_id, Person.deleted_at.is_(None)).order_by(Person.id).all()
    pos_map = compute_display_ids(db, "person", people, scope=user.family_id)
    wish_map = batch_load_person_wishes(db, [p.id for p in people])
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
                display_id=pos_map[p.id],
                family_id=p.family_id,
                given_name=p.given_name,
                age=p.age,
                deleted_at=p.deleted_at,
                wishes=[WishSummary.model_validate(w) for w in wish_map.get(p.id, [])],
            )
            for p in people
        ]
    )


@router.post("/people", status_code=201)
def create_person(
    body: PersonCreateInFamily,
    user: User = Depends(require_family),
    db: Session = Depends(get_db),
) -> PersonDetail:
    family_id = user.family_id
    fam = get_active_or_404(db, Family, family_id, "Family record not found")
    _check_family_edit_lock(fam)

    per = create_person_with_wishes(
        db,
        family_id=family_id,
        given_name=body.given_name,
        age=body.age,
        wishes=body.wishes,
        title=body.title,
        note=body.note,
    )
    db.commit()
    db.refresh(per)
    logger.info(
        "Family user %s created person '%s' (id=%s) in family %s",
        user.email,
        per.given_name,
        per.id,
        family_id,
    )
    return PersonDetail(**build_person_detail(per, db))
