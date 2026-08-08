"""Public family endpoints (list + wish-list).

This router is resource-oriented (``/api/families``) and does **not**
require authentication.  It sits alongside the self-service ``/api/family``
router which is scoped to the authenticated family user.
"""

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, FamilyApprovalStatus, Person, WishLockLevel
from app.response_builders import (
    PUBLIC_FAMILY_SORT_FIELDS,
    FAMILY_MAX_AGE,
    FAMILY_MIN_AGE,
    FAMILY_PERSON_COUNT,
    batch_load_person_wishes,
    build_sort_clause,
    compute_display_ids,
)
from app.schemas import FamilyWishListResponse, PersonWishItem, PublicFamilyListResponse, PublicFamilySummary, WishSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/families", tags=["families"])


# ---------------------------------------------------------------------------
# Public families list
# ---------------------------------------------------------------------------


@router.get("")
def list_public_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
    min_person_count: int | None = Query(None, ge=1),
    max_person_count: int | None = Query(None, ge=1),
    min_age: int | None = Query(None, ge=0),
    max_age: int | None = Query(None, ge=0),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
) -> PublicFamilyListResponse:
    """List approved families for the public donor browse page.

    * No authentication required.
    * Only returns families that are: approved, not soft-deleted, and
      wish_lock_level == admin (fully reviewed).
    * Supports pagination, filtering by person count / age range, and sorting.
    """
    # Base query: active, approved, admin-locked families
    query = db.query(Family).filter(
        Family.deleted_at.is_(None),
        Family.approval_status == FamilyApprovalStatus.approved,
        Family.wish_lock_level == WishLockLevel.admin,
    )

    # Build filter conditions using correlated subqueries
    filters = []
    person_count_expr = FAMILY_PERSON_COUNT
    min_age_expr = FAMILY_MIN_AGE
    max_age_expr = FAMILY_MAX_AGE

    if min_person_count is not None:
        filters.append(person_count_expr >= min_person_count)
    if max_person_count is not None:
        filters.append(person_count_expr <= max_person_count)
    if min_age is not None:
        filters.append(min_age_expr >= min_age)
    if max_age is not None:
        filters.append(max_age_expr <= max_age)

    if filters:
        query = query.filter(and_(*filters))

    # Count total before pagination
    total = query.count()

    # Sorting
    sort_clause = build_sort_clause(
        sort,
        PUBLIC_FAMILY_SORT_FIELDS,
        Family.id.asc(),
    )

    # Paginate — include correlated subquery aggregates in the SELECT
    offset = (page - 1) * page_size
    results = (
        query.add_columns(
            FAMILY_PERSON_COUNT.label("pc"),
            FAMILY_MIN_AGE.label("ma"),
            FAMILY_MAX_AGE.label("xa"),
        )
        .order_by(sort_clause, Family.id)
        .offset(offset)
        .limit(page_size)
        .all()
    )

    families = [row[0] for row in results] if results else []

    # Compute flat-format display IDs (unscoped)
    display_id_map = compute_display_ids(db, "family", families, scope=None)

    # Build response items from the single query result
    result_families = []
    for fam, pc, ma, xa in results or []:
        result_families.append(
            PublicFamilySummary(
                id=fam.id,
                display_id=display_id_map.get(fam.id, "0"),
                bio=fam.bio,
                person_count=pc if pc else 0,
                min_age=ma,
                max_age=xa,
            )
        )

    total_pages = math.ceil(total / page_size) if total else 0

    return PublicFamilyListResponse(
        families=result_families,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


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
    # Look up family (skip soft-deleted and non-admin-locked)
    fam = (
        db.query(Family)
        .filter(
            Family.id == family_id,
            Family.deleted_at.is_(None),
            Family.wish_lock_level == WishLockLevel.admin,
        )
        .first()
    )
    if fam is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family not found",
        )

    # Active people ordered by id
    people = db.query(Person).filter(Person.family_id == family_id, Person.deleted_at.is_(None)).order_by(Person.id).all()

    # Batch-load wishes for all people in one query (avoids N+1)
    person_ids = [p.id for p in people]
    wishes_by_person = batch_load_person_wishes(db, person_ids)

    # Compute display_id (unscoped — flat format for public view)
    display_id_map = compute_display_ids(db, "family", [fam], scope=None)
    display_id = display_id_map.get(fam.id, "0")

    return FamilyWishListResponse(
        display_id=display_id,
        bio=fam.bio,
        family_wish=fam.family_wish,
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
