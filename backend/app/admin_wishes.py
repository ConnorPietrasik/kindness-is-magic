"""Admin CRUD routes for Wishes.

All endpoints are guarded with ``require_admin``.
"""

import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Family, Person, Referrer, User, Wish, WishType
from app.permissions import require_admin
from app.response_builders import (
    apply_purchase_fields,
    column_filtered_page,
    build_wish_detail,
    build_wish_list_item,
    ColumnRequest,
    compute_display_ids,
    escape_like,
    get_active_or_404,
    get_or_404,
    WISH_DATE_RANGE_FIELDS,
    WISH_SEARCH_FIELDS,
    WISH_SEARCH_EXACT_FIELDS,
    WISH_SORT_FIELDS,
    ASSIGNED_USER,
    DIRECT_FAMILY,
    WISH_REFERRER,
    partial_update,
    wish_display_id,
    wish_global_search_terms,
    wish_grouped_order,
)
from app.schemas import (
    _CLEAR,
    AdminWishUpdate,
    WishBatchAssign,
    WishBatchMarkPurchased,
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


def _utc_day_start(day: date) -> datetime:
    """Start of a UTC calendar day as a timezone-aware datetime."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


@admin_wishes_router.get("", response_model_exclude_unset=True)
def list_wishes(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    family_id: int | None = Query(None),
    person_id: int | None = Query(None),
    assigned_to_id: int | None = Query(None),
    purchased: str | None = Query(None),
    search: str | None = Query(None),
    wish_type: WishType | None = Query(None),
    columns: str | None = Query(None),
    sort: str | None = Query(None),
    # Per-column text search: one optional param per text-searchable field
    # (named after the item field) — substring ILIKE for free text, whole
    # (case-insensitive) value for closed vocabularies (role/age/status) —
    # ANDed together.
    description: str | None = Query(None),
    size: str | None = Query(None),
    color: str | None = Query(None),
    person_given_name: str | None = Query(None),
    person_role: str | None = Query(None),
    person_age: str | None = Query(None),
    person_note: str | None = Query(None),
    family_name: str | None = Query(None),
    family_contact_name: str | None = Query(None),
    family_phone_number: str | None = Query(None),
    family_address: str | None = Query(None),
    family_verification_status: str | None = Query(None),
    family_bio: str | None = Query(None),
    referrer_name: str | None = Query(None),
    referrer_phone_number: str | None = Query(None),
    assigned_to_name: str | None = Query(None),
    purchased_where: str | None = Query(None),
    purchaser_note: str | None = Query(None),
    # Per-column date ranges: inclusive day boundaries in UTC.
    purchased_at_from: date | None = Query(None),
    purchased_at_to: date | None = Query(None),
    received_at_from: date | None = Query(None),
    received_at_to: date | None = Query(None),
    created_at_from: date | None = Query(None),
    created_at_to: date | None = Query(None),
    family_pickup_window_from: date | None = Query(None),
    family_pickup_window_to: date | None = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishListResponse:
    """List active wishes with person/family context and purchase tracking.

    Person wishes resolve their family through the person; family wishes
    (``person_id`` null) are bound to the family directly, so both sources
    are outer-joined and handled by the filters and search below. The
    owner family's referrer and the assigned user are outer-joined the same
    way (soft-deleted rows join as NULL, so search/sort cannot match them).

    Besides the global ``search`` box (OR across every text-searchable
    field), each text-searchable field has its own optional param (named
    after the item field; substring for free text, whole case-insensitive
    value for the closed-vocabulary role/age/status fields) and each of the
    four date fields has ``<field>_from`` / ``<field>_to`` day-boundary
    params; all of them AND with the other filters.

    Default order groups each family's wishes together — owner family's
    referrer (unassigned families first), owner family, person — with the
    family wish first in each family block, then wish type in display order
    (practical, fun, adult) and wish id. An explicit ``sort`` naming a
    ``WISH_SORT_FIELDS`` column (``-`` prefix for descending) orders by that
    single column instead, with NULLs last in both directions; unknown or
    empty values fall back to the grouped default.
    """
    # Base query: outer-join Wish → Person → Family (person's family), the
    # wish's direct family, the owner family's referrer, and the assigned
    # user — all used by the filters, search, and sort below. The
    # referrer/user joins carry their soft-delete check in the ON clause.
    query = (
        db.query(Wish)
        .outerjoin(Person, Wish.person_id == Person.id)
        .outerjoin(Family, Person.family_id == Family.id)
        .outerjoin(DIRECT_FAMILY, Wish.family_id == DIRECT_FAMILY.id)
        .outerjoin(
            WISH_REFERRER,
            and_(
                WISH_REFERRER.id == func.coalesce(Family.referrer_id, DIRECT_FAMILY.referrer_id),
                WISH_REFERRER.deleted_at.is_(None),
            ),
        )
        .outerjoin(ASSIGNED_USER, and_(Wish.assigned_to_id == ASSIGNED_USER.id, ASSIGNED_USER.deleted_at.is_(None)))
        .filter(Wish.deleted_at.is_(None))
    )

    # Filters
    if family_id is not None:
        query = query.filter(or_(Wish.family_id == family_id, Person.family_id == family_id))
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
        query = query.filter(or_(*wish_global_search_terms(f"%{escape_like(search)}%")))
    # Per-column text search: one optional param per text-searchable field,
    # ANDed with each other and everything above.
    for field, value in {
        "description": description,
        "size": size,
        "color": color,
        "person_given_name": person_given_name,
        "person_role": person_role,
        "person_age": person_age,
        "person_note": person_note,
        "family_name": family_name,
        "family_contact_name": family_contact_name,
        "family_phone_number": family_phone_number,
        "family_address": family_address,
        "family_verification_status": family_verification_status,
        "family_bio": family_bio,
        "referrer_name": referrer_name,
        "referrer_phone_number": referrer_phone_number,
        "assigned_to_name": assigned_to_name,
        "purchased_where": purchased_where,
        "purchaser_note": purchaser_note,
    }.items():
        if value is None:
            continue
        pattern = escape_like(value)
        if field in WISH_SEARCH_EXACT_FIELDS:
            # Closed vocabulary (enum/age cast to text): whole-value match.
            query = query.filter(WISH_SEARCH_FIELDS[field].ilike(pattern, escape="\\"))
        else:
            query = query.filter(WISH_SEARCH_FIELDS[field].ilike(f"%{pattern}%", escape="\\"))
    # Per-column date ranges: from = start of that UTC day (inclusive),
    # to = end of that UTC day (exclusive next-midnight bound).
    for field, (from_day, to_day) in {
        "purchased_at": (purchased_at_from, purchased_at_to),
        "received_at": (received_at_from, received_at_to),
        "created_at": (created_at_from, created_at_to),
        "family_pickup_window": (family_pickup_window_from, family_pickup_window_to),
    }.items():
        if from_day is not None:
            query = query.filter(WISH_DATE_RANGE_FIELDS[field] >= _utc_day_start(from_day))
        if to_day is not None:
            query = query.filter(WISH_DATE_RANGE_FIELDS[field] < _utc_day_start(to_day + timedelta(days=1)))
    if wish_type is not None:
        query = query.filter(Wish.type == wish_type)

    total = query.count()

    # An explicit ``sort`` naming a WISH_SORT_FIELDS column keeps the
    # single-column order (+ id tie-breaker); unknown or empty values fall
    # back to the grouped default. NULLs sort last in both directions,
    # uniformly for every sort field.
    field = sort[1:] if sort and sort.startswith("-") else sort
    if sort and field in WISH_SORT_FIELDS:
        column = WISH_SORT_FIELDS[field]
        order_by = [(column.desc() if sort.startswith("-") else column.asc()).nullslast(), Wish.id]
    else:
        order_by = wish_grouped_order(DIRECT_FAMILY)
    wishes = query.order_by(*order_by).offset((page - 1) * page_size).limit(page_size).all()

    # Build list items — need person/family context and assigned-to names.
    # Re-query with joinedload to avoid N+1. The re-query is join-free, so
    # the grouped default cannot be expressed in it — order by id there and
    # restore the phase-1 page order in Python.
    cols = ColumnRequest.parse(columns)
    wish_ids = [w.id for w in wishes]
    if wish_ids:
        wishes_with_context = (
            db.query(Wish)
            .options(
                joinedload(Wish.person).joinedload(Person.family),
                joinedload(Wish.family),
                joinedload(Wish.assigned_to),
            )
            .filter(Wish.id.in_(wish_ids))
            .order_by(Wish.id)
            .all()
        )
        position = {wid: i for i, wid in enumerate(wish_ids)}
        wishes_with_context.sort(key=lambda w: position[w.id])
        # Batch-collect assigned-to users for name resolution (conditional)
        assigned_users: dict[int, User] = {}
        if cols.needs("assigned_to_name"):
            assigned_user_ids = {w.assigned_to_id for w in wishes_with_context if w.assigned_to_id is not None}
            if assigned_user_ids:
                assigned_users = {u.id: u for u in db.query(User).filter(User.id.in_(assigned_user_ids)).all()}
        # Batch-collect the page's owner-family referrers (conditional;
        # soft-deleted referrers display as None)
        referrer_map: dict[int, Referrer] = {}
        if cols.needs("referrer_name", "referrer_phone_number"):
            owner_referrer_ids: set[int] = set()
            for w in wishes_with_context:
                owner_family = w.person.family if w.person is not None else w.family
                if owner_family is not None and owner_family.referrer_id is not None:
                    owner_referrer_ids.add(owner_family.referrer_id)
            if owner_referrer_ids:
                referrer_map = {
                    r.id: r for r in db.query(Referrer).filter(Referrer.id.in_(owner_referrer_ids), Referrer.deleted_at.is_(None)).all()
                }
    else:
        wishes_with_context = []
        assigned_users = {}
        referrer_map = {}

    # Batch-compute wish display ids (owner's flat display id + type suffix)
    # from the joinedload query's objects — the ones items are built from.
    # Family-wish rows (person_id null) come from the family map, not the
    # person map.
    wish_display_map: dict[int, str] = {}
    if cols.needs("display_id"):
        page_persons = [w.person for w in wishes_with_context if w.person is not None]
        page_families = [w.family for w in wishes_with_context if w.person is None and w.family is not None]
        person_map = compute_display_ids(db, "person", page_persons, scope=None) if page_persons else {}
        family_map = compute_display_ids(db, "family", page_families, scope=None) if page_families else {}
        for w in wishes_with_context:
            if w.person_id is not None:
                owner_display_id = person_map.get(w.person.id, "0") if w.person is not None else "0"
            else:
                owner_display_id = family_map.get(w.family.id, "0") if w.family is not None else "0"
            wish_display_map[w.id] = wish_display_id(owner_display_id, w.type)

    items = [
        WishListSummary(
            **build_wish_list_item(
                w,
                w.person,
                display_id=wish_display_map.get(w.id),
                assigned_users=assigned_users,
                referrer_map=referrer_map,
            )
        )
        for w in wishes_with_context
    ]

    logger.info("Admin %s listed wishes (page=%d, total=%d)", admin.email, page, total)

    return column_filtered_page(items, columns, key="wishes", total=total, page=page, page_size=page_size, always_include={"id"})


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
    )
    return {"assigned_count": count}


@admin_wishes_router.post("/batch-mark-purchased")
def batch_mark_purchased(
    body: WishBatchMarkPurchased,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Batch-mark multiple wishes as purchased. Fail-fast on any invalid ID.

    Mirrors the single mark-purchased semantics for every selected wish:
    ``purchased_at`` from the body (omitted/null defaults to now, ``''``
    clears), ``purchased_where`` overwritten (None clears), ``received_at``
    per the partial-update sentinel convention, and ``assigned_to_id`` set
    to the calling admin.  ``purchaser_note`` is not touched.
    """
    # Deduplicate so repeated IDs don't inflate the count
    seen: set[int] = set()
    wish_ids = [wid for wid in body.wish_ids if not (wid in seen or seen.add(wid))]

    # Fail-fast: check all wish IDs exist and are not deleted
    wishes = db.query(Wish).filter(Wish.id.in_(wish_ids)).all()
    wish_map = {w.id: w for w in wishes}

    for wid in wish_ids:
        if wid not in wish_map:
            raise HTTPException(status_code=400, detail=f"Wish {wid} not found")
        if wish_map[wid].deleted_at is not None:
            raise HTTPException(status_code=400, detail=f"Wish {wid} is deleted")

    # All valid — mark each wish
    purchased_at = body.purchased_at or datetime.now(timezone.utc)
    for wid in wish_ids:
        wish = wish_map[wid]
        # purchaser_note=None is a no-op — notes are per-item
        apply_purchase_fields(wish, purchased_at=purchased_at, purchased_where=body.purchased_where, purchaser_note=None)

        # Assign to the calling admin
        wish.assigned_to_id = admin.id

        # received_at follows partial-update convention (None means no-op)
        if body.received_at is _CLEAR:
            wish.received_at = None
        elif body.received_at is not None:
            wish.received_at = body.received_at

    db.commit()

    logger.info("Admin %s batch-marked %d wishes as purchased", admin.email, len(wish_ids))
    return {"marked_count": len(wish_ids)}


@admin_wishes_router.get("/{wish_id}")
def get_wish(
    wish_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Get a single wish with person context (null person for family wishes)."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None
    return WishDetail(**build_wish_detail(wish, person, db))


@admin_wishes_router.patch("/{wish_id}")
def update_wish(
    wish_id: int,
    body: AdminWishUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Partially update a wish (definition + purchase tracking fields)."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None

    # Validate type change against person age
    if body.type is not None and body.type != wish.type:
        if person is None:
            # Type is fixed per owner — family wishes can't change type
            raise HTTPException(status_code=400, detail="Family wish type cannot be changed")
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
    return WishDetail(**build_wish_detail(wish, person, db))


@admin_wishes_router.post("/{wish_id}/mark-purchased")
def mark_purchased(
    wish_id: int,
    body: WishPurchaseMark,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WishDetail:
    """Mark a wish as purchased. Sets purchased_at (body value; omitted/null defaults to now, ``''`` clears) and assigned_to_id=admin."""
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")
    person = get_or_404(db, Person, wish.person_id, "Person not found") if wish.person_id is not None else None

    # purchased_at (omitted/null → now, '' → clear), purchased_where and purchaser_note (partial-update convention)
    apply_purchase_fields(
        wish,
        purchased_at=body.purchased_at or datetime.now(timezone.utc),
        purchased_where=body.purchased_where,
        purchaser_note=body.purchaser_note,
    )

    # Assign to the calling admin
    wish.assigned_to_id = admin.id

    # received_at follows partial-update convention (None means no-op)
    if body.received_at is _CLEAR:
        wish.received_at = None
    elif body.received_at is not None:
        wish.received_at = body.received_at
    # None means no-op

    db.commit()
    db.refresh(wish)

    logger.info("Admin %s marked wish (id=%d) as purchased", admin.email, wish_id)
    return WishDetail(**build_wish_detail(wish, person, db))
