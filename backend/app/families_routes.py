"""Public family wish-list endpoint.

This router is resource-oriented (``/api/families/{id}/...``) and does **not**
require authentication.  It sits alongside the self-service ``/api/family``
router which is scoped to the authenticated family user.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person
from app.schemas import FamilyWishListResponse, PersonWishItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/families", tags=["families"])


# ---------------------------------------------------------------------------
# Wish list
# ---------------------------------------------------------------------------


@router.get("/{family_id}/wish-list")
def get_family_wish_list(
    family_id: int,
    db: Session = Depends(get_db),
) -> FamilyWishListResponse:
    """Return the public wish list for a family.

    * No authentication required.
    * Soft-deleted families return 404.
    * Soft-deleted people are excluded from the people list.
    """
    # Look up family (skip soft-deleted)
    fam = db.query(Family).filter(Family.id == family_id, Family.deleted_at.is_(None)).first()
    if fam is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family not found",
        )

    # Active people ordered by id
    people = db.query(Person).filter(Person.family_id == family_id, Person.deleted_at.is_(None)).order_by(Person.id).all()

    return FamilyWishListResponse(
        family_name=fam.family_name,
        bio=fam.bio,
        family_wish=fam.family_wish,
        people=[
            PersonWishItem(
                given_name=p.given_name,
                title=p.title,
                age=p.age,
                practical_wish=p.practical_wish,
                fun_wish=p.fun_wish,
                note=p.note,
            )
            for p in people
        ],
    )
