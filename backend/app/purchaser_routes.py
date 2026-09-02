"""Purchaser self-service routes for managing assigned wishes.

All endpoints are guarded with ``require_purchaser``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Family, Person, User, Wish, WishType
from app.permissions import require_purchaser
from app.response_builders import (
    apply_purchase_fields,
    build_wish_detail,
    compute_display_ids,
    escape_like,
    get_active_or_404,
    get_or_404,
    partial_update,
    wish_display_id,
)
from app.schemas import (
    _CLEAR,
    PurchaserWishListResponse,
    PurchaserWishSummary,
    PurchaserWishUpdate,
    WishBatchMarkPurchased,
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


def _build_purchaser_wish_item(wish: Wish, person: Person | None, family_display_id: str, display_id: str, db: Session) -> dict:
    """Build a dict suitable for PurchaserWishSummary.

    Reuses ``build_wish_detail`` for the shared wish+person fields,
    then swaps ``person_family_name`` for ``family_id`` (no PII).
    *person* is ``None`` for family wishes.
    Includes ``wish_lock_level`` so the frontend can gate the
    public wishlist link on admin lock (family is already loaded
    via joinedload — no extra query), ``family_display_id`` and
    ``display_id`` (both pre-computed by the caller from batched
    position maps) for presentational display.
    """
    data = build_wish_detail(wish, person, db, display_id=display_id)
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
    search: str | None = Query(None),
    wish_type: WishType | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> PurchaserWishListResponse:
    """List wishes assigned to the current purchaser.

    Supports ``purchased`` filter: ``true`` (purchased only), ``false``
    (unpurchased only), ``all`` (no filter); ``search`` — case-insensitive
    match on wish description or person given name (family names are
    excluded: purchaser responses carry no family PII); and ``wish_type``
    (same values the admin endpoint accepts).
    """
    # Phase 1: filter query.  The explicit Person outer-join is needed for
    # the given-name search.
    query = (
        db.query(Wish)
        .outerjoin(Person, Wish.person_id == Person.id)
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
    if search is not None:
        pattern = f"%{escape_like(search)}%"
        query = query.filter(
            or_(
                Wish.description.ilike(pattern, escape="\\"),
                Person.given_name.ilike(pattern, escape="\\"),
            )
        )
    if wish_type is not None:
        query = query.filter(Wish.type == wish_type)

    total = query.count()
    wish_ids = [w.id for w in query.order_by(Wish.id).offset((page - 1) * page_size).limit(page_size).all()]

    # Phase 2: re-query the page's wish IDs with joinedload to build items —
    # a join and an eagerload on the same relationship don't mix, which is
    # why the admin list uses this two-phase pattern.
    wishes = (
        db.query(Wish)
        .options(joinedload(Wish.person).joinedload(Person.family), joinedload(Wish.family))
        .filter(Wish.id.in_(wish_ids))
        .order_by(Wish.id)
        .all()
        if wish_ids
        else []
    )

    # Display IDs for the families on this page (unscoped flat format —
    # same format the public wish-list page shows as its heading).
    # The family rows come from the joinedload above (no N+1); computing
    # positions issues a single ROW_NUMBER query for the page's referrers.
    page_families = list({_wish_family(w).id: _wish_family(w) for w in wishes if _wish_family(w)}.values())
    display_id_map = compute_display_ids(db, "family", page_families, scope=None)

    # Flat person display ids for person wishes (family wishes use the
    # family map above).
    page_persons = [w.person for w in wishes if w.person is not None]
    person_display_map = compute_display_ids(db, "person", page_persons, scope=None) if page_persons else {}

    def _wish_display_id(w: Wish) -> str:
        if w.person_id is not None:
            owner_display_id = person_display_map.get(w.person.id, "0") if w.person is not None else "0"
        else:
            fam = _wish_family(w)
            owner_display_id = display_id_map.get(fam.id, "0") if fam is not None else "0"
        return wish_display_id(owner_display_id, w.type)

    items = [
        PurchaserWishSummary(
            **_build_purchaser_wish_item(
                w, w.person, display_id_map.get(_wish_family(w).id if _wish_family(w) else 0, "0"), _wish_display_id(w), db
            )
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
    return WishDetail(**build_wish_detail(wish, person, db))


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

    # purchased_at, purchased_where and purchaser_note (partial-update convention)
    apply_purchase_fields(wish, now=datetime.now(timezone.utc), purchased_where=body.purchased_where, purchaser_note=body.purchaser_note)

    # received_at follows partial-update convention (None means no-op)
    if body.received_at is _CLEAR:
        wish.received_at = None
    elif body.received_at is not None:
        wish.received_at = body.received_at
    # None means no-op

    db.commit()
    db.refresh(wish)

    logger.info("Purchaser %s marked wish (id=%d) as purchased", current_user.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person, db))


@purchaser_router.post("/wishes/batch-mark-purchased")
def batch_mark_purchased(
    body: WishBatchMarkPurchased,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_purchaser),
) -> dict:
    """Batch-mark multiple assigned wishes as purchased.

    Mirrors the single mark-purchased semantics for every selected wish:
    ``purchased_at=now``, ``purchased_where`` overwritten (None clears),
    ``received_at`` per the partial-update sentinel convention.  Does
    **not** touch ``purchaser_note`` or change ``assigned_to_id``.
    Fail-fast on any missing/soft-deleted ID or any ID not assigned to
    the caller.
    """
    # Deduplicate so repeated IDs don't inflate the count
    seen: set[int] = set()
    wish_ids = [wid for wid in body.wish_ids if not (wid in seen or seen.add(wid))]

    wishes = db.query(Wish).filter(Wish.id.in_(wish_ids)).all()
    wish_map = {w.id: w for w in wishes}

    for wid in wish_ids:
        wish = wish_map.get(wid)
        if wish is None or wish.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Wish {wid} not found")
        if wish.assigned_to_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Wish {wid} is not assigned to you")

    now = datetime.now(timezone.utc)
    for wid in wish_ids:
        wish = wish_map[wid]
        # purchaser_note=None is a no-op — notes are per-item
        apply_purchase_fields(wish, now=now, purchased_where=body.purchased_where, purchaser_note=None)

        # received_at follows partial-update convention (None means no-op)
        if body.received_at is _CLEAR:
            wish.received_at = None
        elif body.received_at is not None:
            wish.received_at = body.received_at

    db.commit()

    logger.info("Purchaser %s batch-marked %d wishes as purchased", current_user.email, len(wish_ids))
    return {"marked_count": len(wish_ids)}


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
    return WishDetail(**build_wish_detail(wish, person, db))
