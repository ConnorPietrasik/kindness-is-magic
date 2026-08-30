"""Purchaser self-service routes for managing assigned wishes.

All endpoints are guarded with ``require_purchaser``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Family, Person, User, Wish
from app.permissions import require_purchaser
from app.response_builders import (
    build_wish_detail,
    compute_display_ids,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    _CLEAR,
    PurchaserWishListResponse,
    PurchaserWishSummary,
    PurchaserWishUpdate,
    WishDetail,
    WishPurchaseMark,
)

logger = logging.getLogger(__name__)

purchaser_router = APIRouter(
    prefix="/api/purchaser",
    tags=["purchaser"],
)


def _wish_family(wish: Wish) -> Family | None:
    """The family a wish belongs to.

    Family wishes are bound to the family directly; person wishes
    resolve it through the person.
    """
    if wish.person_id is not None:
        return wish.person.family if wish.person else None
    return wish.family


def _build_purchaser_wish_item(wish: Wish, person: Person | None, family_display_id: str) -> dict:
    """Build a dict suitable for PurchaserWishSummary.

    Reuses ``build_wish_detail`` for the shared wish+person fields,
    then swaps ``person_family_name`` for ``family_id`` (no PII).
    *person* is ``None`` for family wishes.
    Includes ``wish_lock_level`` so the frontend can gate the
    public wishlist link on admin lock (family is already loaded
    via joinedload — no extra query), and ``family_display_id``
    (pre-computed by the caller) for presentational display.
    """
    data = build_wish_detail(wish, person)
    family = _wish_family(wish)
    data["family_id"] = family.id if family is not None else wish.family_id
    data["family_display_id"] = family_display_id
    data["wish_lock_level"] = family.wish_lock_level if family is not None else None
    del data["person_family_name"]
    return data


@purchaser_router.get("/wishes")
def list_wishes(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    purchased: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> PurchaserWishListResponse:
    """List wishes assigned to the current purchaser.

    Supports ``purchased`` filter: ``true`` (purchased only), ``false``
    (unpurchased only), ``all`` (no filter).
    """
    query = (
        db.query(Wish)
        .options(joinedload(Wish.person).joinedload(Person.family), joinedload(Wish.family))
        .filter(
            Wish.deleted_at.is_(None),
            Wish.assigned_to_id == current_user.id,
        )
    )

    if purchased is not None:
        if purchased.lower() == "true":
            query = query.filter(Wish.purchased_at.isnot(None))
        elif purchased.lower() == "false":
            query = query.filter(Wish.purchased_at.is_(None))
        # "all" means no filter

    total = query.count()
    wishes = query.order_by(Wish.id).offset((page - 1) * page_size).limit(page_size).all()

    # Display IDs for the families on this page (unscoped flat format —
    # same format the public wish-list page shows as its heading).
    # The family rows come from the joinedload above (no N+1); computing
    # positions issues a single ROW_NUMBER query for the page's referrers.
    page_families = list({_wish_family(w).id: _wish_family(w) for w in wishes if _wish_family(w)}.values())
    display_id_map = compute_display_ids(db, "family", page_families, scope=None)

    items = [
        PurchaserWishSummary(
            **_build_purchaser_wish_item(w, w.person, display_id_map.get(_wish_family(w).id if _wish_family(w) else 0, "0"))
        )
        for w in wishes
    ]

    logger.info("Purchaser %s listed wishes (page=%d, total=%d)", current_user.email, page, total)

    return PurchaserWishListResponse(
        wishes=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@purchaser_router.get("/wishes/{wish_id}")
def get_wish(
    wish_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> WishDetail:
    """Get detail of a single wish assigned to the current purchaser."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")

    if wish.assigned_to_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This wish is not assigned to you",
        )

    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None
    return WishDetail(**build_wish_detail(wish, person))


@purchaser_router.post("/wishes/{wish_id}/mark-purchased")
def mark_purchased(
    wish_id: int,
    body: WishPurchaseMark,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> WishDetail:
    """Mark a wish as purchased.

    Sets ``purchased_at=now``, ``purchased_where``, ``purchaser_note``,
    and ``received_at``.  Does **not** change ``assigned_to_id``.
    """
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")

    if wish.assigned_to_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This wish is not assigned to you",
        )

    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None

    now = datetime.now(timezone.utc)

    # Always set purchased_at
    wish.purchased_at = now

    # purchased_where always overwrites (null sets to None)
    wish.purchased_where = body.purchased_where

    # purchaser_note and received_at follow partial-update convention
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

    logger.info("Purchaser %s marked wish (id=%d) as purchased", current_user.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person))


@purchaser_router.patch("/wishes/{wish_id}")
def update_wish(
    wish_id: int,
    body: PurchaserWishUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> WishDetail:
    """Partially update purchaser_note and/or received_at on an assigned wish.

    Uses ``partial_update()`` with ``exclude_unset=True`` so only
    explicitly-set fields are modified.  PurchaserWishUpdate only
    exposes purchaser_note and received_at, naturally blocking other
    fields.
    """
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")

    if wish.assigned_to_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This wish is not assigned to you",
        )

    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None

    partial_update(wish, body)
    db.commit()
    db.refresh(wish)

    logger.info("Purchaser %s updated wish (id=%d)", current_user.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person))
