"""Admin CRUD routes for Wishes.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Family, Person, User, Wish, WishType
from app.permissions import require_admin
from app.response_builders import (
    apply_column_filter,
    build_wish_detail,
    build_wish_list_item,
    ColumnRequest,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    _CLEAR,
    AdminWishUpdate,
    WishBatchAssign,
    WishDetail,
    WishListResponse,
    WishListSummary,
    WishPurchaseMark,
)

logger = logging.getLogger(__name__)

admin_wishes_router = APIRouter(
    prefix="/api/admin/wishes",
    tags=["admin-wishes"],
)


def _get_valid_wish_types_for_age(age: int) -> set[WishType]:
    """Return the set of valid wish types for a person of given age."""
    if age >= 18:
        return {WishType.adult}
    return {WishType.practical, WishType.fun}


@admin_wishes_router.get("")
def list_wishes(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    family_id: int | None = Query(None),
    person_id: int | None = Query(None),
    assigned_to_id: int | None = Query(None),
    purchased: str | None = Query(None),
    search: str | None = Query(None),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishListResponse:
    """List active wishes with person/family context and purchase tracking."""
    # Base query: join Wish → Person → Family for filtering and context
    query = (
        db.query(Wish)
        .join(Person, Wish.person_id == Person.id)
        .join(Family, Person.family_id == Family.id)
        .filter(Wish.deleted_at.is_(None))
    )

    # Filters
    if family_id is not None:
        query = query.filter(Family.id == family_id)
    if person_id is not None:
        query = query.filter(Person.id == person_id)
    if assigned_to_id is not None:
        if assigned_to_id == 0:
            query = query.filter(Wish.assigned_to_id.is_(None))
        else:
            query = query.filter(Wish.assigned_to_id == assigned_to_id)
    if purchased is not None:
        if purchased.lower() == "true":
            query = query.filter(Wish.purchased_at.isnot(None))
        elif purchased.lower() == "false":
            query = query.filter(Wish.purchased_at.is_(None))
        # "all" means no filter
    if search is not None:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Wish.description.ilike(pattern),
                Person.given_name.ilike(pattern),
                Family.family_name.ilike(pattern),
            )
        )

    total = query.count()
    wishes = query.order_by(Wish.id).offset((page - 1) * page_size).limit(page_size).all()

    # Build list items — need person/family context and assigned-to names.
    # Re-query with joinedload to avoid N+1.
    cols = ColumnRequest.parse(columns)
    wish_ids = [w.id for w in wishes]
    if wish_ids:
        wishes_with_context = (
            db.query(Wish)
            .options(
                joinedload(Wish.person).joinedload(Person.family),
                joinedload(Wish.assigned_to),
            )
            .filter(Wish.id.in_(wish_ids))
            .order_by(Wish.id)
            .all()
        )
        # Batch-collect assigned-to users for name resolution (conditional)
        assigned_users: dict[int, User] = {}
        if cols.needs("assigned_to_name"):
            assigned_user_ids = {w.assigned_to_id for w in wishes_with_context if w.assigned_to_id is not None}
            if assigned_user_ids:
                assigned_users = {u.id: u for u in db.query(User).filter(User.id.in_(assigned_user_ids)).all()}
    else:
        wishes_with_context = []
        assigned_users = {}

    items = [WishListSummary(**build_wish_list_item(w, w.person, assigned_users=assigned_users)) for w in wishes_with_context]

    logger.info("Admin %s listed wishes (page=%d, total=%d)", admin.email, page, total)

    # NOTE: Returns a plain dict (not WishListResponse) because apply_column_filter
    # produces partial dicts with only requested columns. FastAPI validates this dict
    # against the annotated response model — required fields are always included so
    # validation passes. See response_builders.apply_column_filter for details.
    return {
        "wishes": apply_column_filter(items, columns, always_include={"id"}),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@admin_wishes_router.post("/batch-assign")
def batch_assign(
    body: WishBatchAssign,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Batch-assign multiple wishes to a user (or 0 to unassign). Fail-fast on any invalid ID."""
    # 0 is the clear-FK sentinel — unassign instead of looking up a user
    is_unassign = body.assigned_to_id == 0

    if not is_unassign:
        target_user = db.query(User).filter(User.id == body.assigned_to_id).first()
        if target_user is None:
            raise HTTPException(status_code=400, detail="Assigned user not found")

    # Fail-fast: check all wish IDs exist and are not deleted
    wishes = db.query(Wish).filter(Wish.id.in_(body.wish_ids)).all()
    wish_map = {w.id: w for w in wishes}

    for wid in body.wish_ids:
        if wid not in wish_map:
            raise HTTPException(status_code=400, detail=f"Wish {wid} not found")
        if wish_map[wid].deleted_at is not None:
            raise HTTPException(status_code=400, detail=f"Wish {wid} is deleted")

    # All valid — perform the assignment
    count = 0
    for wid in body.wish_ids:
        wish_map[wid].assigned_to_id = None if is_unassign else body.assigned_to_id
        count += 1

    db.commit()

    logger.info(
        "Admin %s batch-assigned %d wishes to user %s",
        admin.email,
        count,
        "(unassigned)" if is_unassign else body.assigned_to_id,
        count,
        body.assigned_to_id,
    )
    return {"assigned_count": count}


@admin_wishes_router.get("/{wish_id}")
def get_wish(
    wish_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Get a single wish with person context."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found")
    return WishDetail(**build_wish_detail(wish, person))


@admin_wishes_router.patch("/{wish_id}")
def update_wish(
    wish_id: int,
    body: AdminWishUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Partially update a wish (definition + purchase tracking fields)."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found")

    # Validate type change against person age
    if body.type is not None and body.type != wish.type:
        valid_types = _get_valid_wish_types_for_age(person.age)
        if body.type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Wish type '{body.type.value}' is not valid for a person of age {person.age}",
            )

    # Validate assigned_to_id target if set
    if body.assigned_to_id is not None and body.assigned_to_id is not _CLEAR:
        # It's an int — validate user exists
        target_user = db.query(User).filter(User.id == body.assigned_to_id).first()
        if target_user is None:
            raise HTTPException(status_code=400, detail="Assigned user not found")

    partial_update(wish, body)
    db.commit()
    db.refresh(wish)

    logger.info("Admin %s updated wish (id=%d)", admin.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person))


@admin_wishes_router.post("/{wish_id}/mark-purchased")
def mark_purchased(
    wish_id: int,
    body: WishPurchaseMark,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Mark a wish as purchased. Sets purchased_at=now and assigned_to_id=admin."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found")

    now = datetime.now(timezone.utc)

    # Always set purchased_at
    wish.purchased_at = now

    # purchased_where always overwrites (null sets to None)
    wish.purchased_where = body.purchased_where

    # Assign to the calling admin
    wish.assigned_to_id = admin.id

    # purchaser_note and received_at follow partial-update convention
    # Check raw field values (validator may have coerced "" → _CLEAR)
    if body.purchaser_note is _CLEAR:
        wish.purchaser_note = None
    elif body.purchaser_note is not None:
        wish.purchaser_note = body.purchaser_note
    # None means no-op

    if body.received_at is _CLEAR:
        wish.received_at = None
    elif body.received_at is not None:
        wish.received_at = body.received_at
    # None means no-op

    db.commit()
    db.refresh(wish)

    logger.info("Admin %s marked wish (id=%d) as purchased", admin.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person))
