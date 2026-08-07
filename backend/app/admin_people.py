"""Admin CRUD routes for People and Wishes.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, FamilyApprovalStatus, Person, User, Wish
from sqlalchemy import or_ as sql_or
from app.permissions import require_admin
from app.response_builders import (
    apply_column_filter,
    batch_load_person_wishes,
    build_person_detail,
    build_sort_clause,
    build_wish_detail,
    ColumnRequest,
    compute_display_ids,
    create_person_with_wishes,
    PERSON_SORT_FIELDS,
    get_active_or_404,
    get_or_404,
    partial_update,
    restore_person_wishes,
    soft_delete_person_wishes,
    sync_person_wishes,
)
from app.schemas import (
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonUpdate,
    WishCreate,
    WishDetail,
    WishSummary,
    WishUpdate,
    validate_wishes_for_age,
)

logger = logging.getLogger(__name__)

people_admin_router = APIRouter(
    prefix="/api/admin/people",
    tags=["admin-people"],
)


# ---------------------------------------------------------------------------
# Person — List / Get / Create / Update / Delete / Restore
# ---------------------------------------------------------------------------


@people_admin_router.get("", response_model_exclude_unset=True)
def list_people(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    family_id: int | None = Query(None),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    search_name: str | None = Query(None),
    search_title: str | None = Query(None),
    search_note: str | None = Query(None),
    search_wish: str | None = Query(None),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonListResponse:
    """List active (non-deleted) people with stable display IDs.

    When scoped to a family, display IDs are simple sequential numbers
    matching the referrer/family's own view. In the flat view, the format
    is {referrer_id_or_0}-{family_position}-{person_position}.
    """
    # Optional wish join — only when wish-related search is active
    needs_wish_search = search is not None or search_wish is not None
    query = (
        db.query(Person).join(Family).outerjoin(Wish, Wish.person_id == Person.id) if needs_wish_search else db.query(Person).join(Family)
    )
    query = query.filter(
        Person.deleted_at.is_(None),
        Family.deleted_at.is_(None),
        Family.approval_status == FamilyApprovalStatus.approved,
    )
    if family_id is not None:
        query = query.filter(Person.family_id == family_id)

    # Multi-field search: each active filter is ANDed together.
    # `search` uses OR across all fields (including wish.description via join).
    # Targeted params search single fields.
    if search is not None:
        pattern = f"%{search}%"
        query = query.filter(
            sql_or(
                Person.given_name.ilike(pattern),
                Person.title.ilike(pattern),
                Person.note.ilike(pattern),
                Wish.description.ilike(pattern),
            )
        )
    if search_name is not None:
        query = query.filter(Person.given_name.ilike(f"%{search_name}%"))
    if search_title is not None:
        query = query.filter(Person.title.ilike(f"%{search_title}%"))
    if search_note is not None:
        query = query.filter(Person.note.ilike(f"%{search_note}%"))
    if search_wish is not None:
        query = query.filter(Wish.description.ilike(f"%{search_wish}%"))

    # Deduplicate when wish join is active (a person with multiple wishes would
    # otherwise appear multiple times in the result set).
    if needs_wish_search:
        query = query.distinct(Person.id)

    total = query.count()
    offset = (page - 1) * page_size

    sort_clause = build_sort_clause(sort, PERSON_SORT_FIELDS, Person.id.asc())
    people = query.order_by(sort_clause, Person.id).offset(offset).limit(page_size).all()

    # Wishes are always loaded (always_include)
    wish_map = batch_load_person_wishes(db, [p.id for p in people])

    cols = ColumnRequest.parse(columns)
    pos_map: dict[int, str] = {}
    if cols.needs("display_id"):
        pos_map = compute_display_ids(db, "person", people, scope=family_id)

    items = [
        PersonDetail(
            id=p.id,
            display_id=pos_map.get(p.id),
            family_id=p.family_id,
            given_name=p.given_name,
            title=p.title,
            age=p.age,
            note=p.note,
            created_at=p.created_at,
            deleted_at=p.deleted_at,
            wishes=[WishSummary.model_validate(w) for w in wish_map.get(p.id, [])],
        )
        for p in people
    ]

    # NOTE: Returns a plain dict (not PersonListResponse) because apply_column_filter
    # produces partial dicts with only requested columns. FastAPI validates this dict
    # against the annotated response model — required fields are always included so
    # validation passes. See response_builders.apply_column_filter for details.
    return {
        "people": apply_column_filter(items, columns, always_include={"id", "wishes"}),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@people_admin_router.get("/deleted", response_model_exclude_unset=True)
def list_deleted_people(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    family_id: int | None = Query(None),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonListResponse:
    """List soft-deleted people."""
    query = db.query(Person).filter(Person.deleted_at.isnot(None))
    if family_id is not None:
        query = query.filter(Person.family_id == family_id)

    total = query.count()
    offset = (page - 1) * page_size
    people = query.order_by(Person.deleted_at.desc(), Person.id).offset(offset).limit(page_size).all()

    items = [
        PersonDetail(
            id=p.id,
            display_id="DELETED",
            family_id=p.family_id,
            given_name=p.given_name,
            title=p.title,
            age=p.age,
            note=p.note,
            created_at=p.created_at,
            deleted_at=p.deleted_at,
            wishes=[],
        )
        for p in people
    ]

    # NOTE: Returns a plain dict (not PersonListResponse) because apply_column_filter
    # produces partial dicts with only requested columns. FastAPI validates this dict
    # against the annotated response model — required fields are always included so
    # validation passes. See response_builders.apply_column_filter for details.
    return {
        "people": apply_column_filter(items, columns, always_include={"id", "wishes"}),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@people_admin_router.get("/{per_id}")
def get_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    return PersonDetail(**build_person_detail(per, db))


@people_admin_router.post("", status_code=201)
def create_person(
    body: PersonCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    # Validate family exists
    get_or_404(db, Family, body.family_id, "Family not found")

    per = create_person_with_wishes(
        db,
        family_id=body.family_id,
        given_name=body.given_name,
        age=body.age,
        wishes=body.wishes,
        title=body.title,
        note=body.note,
    )
    db.commit()
    db.refresh(per)
    logger.info("Admin %s created person '%s' (id=%s) in family %s", _admin.email, per.given_name, per.id, body.family_id)
    return PersonDetail(**build_person_detail(per, db))


@people_admin_router.patch("/{per_id}")
def update_person(
    per_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    # Intentionally uses get_or_404 (not get_active_or_404) so admins can modify or restore soft-deleted people.
    per = get_or_404(db, Person, per_id, "Person not found")

    # Validate wishes against age if both are provided
    if body.wishes is not None:
        effective_age = body.age if body.age is not None else per.age
        validate_wishes_for_age(body.wishes, effective_age)

    # Apply person field updates (exclude 'wishes' — handled separately below)
    partial_update(per, body, exclude={"wishes"})

    # Handle wishes update if provided
    if body.wishes is not None:
        sync_person_wishes(db, per_id, body.wishes)
        db.flush()

    db.commit()
    db.refresh(per)
    logger.info("Admin %s updated person (id=%s)", _admin.email, per_id)
    return PersonDetail(**build_person_detail(per, db))


@people_admin_router.post("/{per_id}/restore", status_code=200)
def restore_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    per = get_or_404(db, Person, per_id, "Person not found")
    if per.deleted_at is None:
        raise HTTPException(status_code=400, detail="Person is not deleted")
    family = db.query(Family).filter(Family.id == per.family_id).first()
    if family and family.deleted_at is not None:
        raise HTTPException(status_code=400, detail="family_deleted")
    per.deleted_at = None
    # Restore associated wishes too
    restore_person_wishes(db, per_id)
    db.commit()
    db.refresh(per)
    logger.info("Admin %s restored person (id=%s)", _admin.email, per_id)
    return PersonDetail(**build_person_detail(per, db))


@people_admin_router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    now = datetime.now(timezone.utc)
    per.deleted_at = now
    # Soft-delete all associated wishes
    soft_delete_person_wishes(db, per_id, now)
    db.commit()
    logger.info("Admin %s soft-deleted person (id=%s)", _admin.email, per_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Wish CRUD (scoped to a person)
# ---------------------------------------------------------------------------


@people_admin_router.get("/{per_id}/wishes")
def list_person_wishes(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[WishSummary]:
    """List all active wishes for a person."""
    get_active_or_404(db, Person, per_id, "Person not found")
    wishes = db.query(Wish).filter(Wish.person_id == per_id, Wish.deleted_at.is_(None)).all()
    return [WishSummary.model_validate(w) for w in wishes]


@people_admin_router.post("/{per_id}/wishes", status_code=201)
def create_person_wish(
    per_id: int,
    body: WishCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> WishDetail:
    """Create a single wish for a person."""
    per = get_active_or_404(db, Person, per_id, "Person not found")

    # Validate wish type matches person age
    try:
        validate_wishes_for_age([body], per.age)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Check for duplicate type
    existing = (
        db.query(Wish)
        .filter(
            Wish.person_id == per_id,
            Wish.type == body.type,
            Wish.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Wish of type '{body.type.value}' already exists")

    # Hard-delete any soft-deleted wish of the same (person_id, type) first
    old_deleted = (
        db.query(Wish)
        .filter(
            Wish.person_id == per_id,
            Wish.type == body.type,
            Wish.deleted_at.isnot(None),
        )
        .first()
    )
    if old_deleted:
        logger.info(
            "Admin %s replacing soft-deleted wish (id=%s, type=%s, desc='%s', size=%s) for person (id=%s)",
            _admin.email,
            old_deleted.id,
            old_deleted.type.value,
            old_deleted.description,
            old_deleted.size,
            per_id,
        )
        db.delete(old_deleted)

    wish = Wish(
        person_id=per_id,
        type=body.type,
        description=body.description,
        size=body.size,
    )
    db.add(wish)
    db.commit()
    db.refresh(wish)
    logger.info("Admin %s created wish (id=%s) for person (id=%s)", _admin.email, wish.id, per_id)

    return WishDetail(**build_wish_detail(wish, per))


@people_admin_router.patch("/{per_id}/wishes/{wish_id}")
def update_person_wish(
    per_id: int,
    wish_id: int,
    body: WishUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> WishDetail:
    """Update a single wish for a person."""
    per = get_active_or_404(db, Person, per_id, "Person not found")
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")

    if wish.person_id != per_id:
        raise HTTPException(status_code=404, detail="Wish not found")

    # If type is being changed, validate against person age and check for conflicts
    if body.type is not None:
        try:
            validate_wishes_for_age([WishCreate(type=body.type, description=body.description or wish.description, size=body.size)], per.age)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if body.type != wish.type:
            conflicting = (
                db.query(Wish)
                .filter(
                    Wish.person_id == per_id,
                    Wish.type == body.type,
                    Wish.deleted_at.is_(None),
                    Wish.id != wish_id,
                )
                .first()
            )
            if conflicting:
                raise HTTPException(
                    status_code=409,
                    detail=f"Wish of type '{body.type.value}' already exists (id={conflicting.id})",
                )

    partial_update(wish, body)
    db.commit()
    db.refresh(wish)
    logger.info("Admin %s updated wish (id=%s) for person (id=%s)", _admin.email, wish_id, per_id)

    return WishDetail(**build_wish_detail(wish, per))


@people_admin_router.delete("/{per_id}/wishes/{wish_id}", status_code=204)
def delete_person_wish(
    per_id: int,
    wish_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    """Soft-delete a single wish."""
    get_active_or_404(db, Person, per_id, "Person not found")
    wish = get_active_or_404(db, Wish, wish_id, "Wish not found")

    if wish.person_id != per_id:
        raise HTTPException(status_code=404, detail="Wish not found")

    wish.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Admin %s soft-deleted wish (id=%s) for person (id=%s)", _admin.email, wish_id, per_id)
    return Response(status_code=204)


@people_admin_router.post("/{per_id}/wishes/{wish_id}/restore", status_code=200)
def restore_person_wish(
    per_id: int,
    wish_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> WishDetail:
    """Restore a soft-deleted wish."""
    per = get_active_or_404(db, Person, per_id, "Person not found")
    wish = get_or_404(db, Wish, wish_id, "Wish not found")

    if wish.person_id != per_id:
        raise HTTPException(status_code=404, detail="Wish not found")
    if wish.deleted_at is None:
        raise HTTPException(status_code=400, detail="Wish is not deleted")

    # Check for active wish of the same type that would conflict
    conflicting = (
        db.query(Wish)
        .filter(
            Wish.person_id == per_id,
            Wish.type == wish.type,
            Wish.deleted_at.is_(None),
            Wish.id != wish_id,
        )
        .first()
    )
    if conflicting:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot restore: active wish of type '{wish.type.value}' already exists (id={conflicting.id})",
        )

    wish.deleted_at = None
    db.commit()
    db.refresh(wish)
    logger.info("Admin %s restored wish (id=%s) for person (id=%s)", _admin.email, wish_id, per_id)

    return WishDetail(**build_wish_detail(wish, per))
