"""Shared helpers for building response dicts and applying partial updates.

Centralises logic that was duplicated across admin_*_routes, referrer_routes,
and family_routes.
"""

from dataclasses import dataclass
from typing import Type, TypeVar, Literal

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import DeclarativeBase, Session

from datetime import datetime, timezone

from app.config import MAX_FAMILY_PERSONS
from app.models import (
    Family,
    FamilyApprovalStatus,
    FamilyClaim,
    Person,
    Referrer,
    ReferrerInviteToken,
    User,
    Wish,
    WishType,
)
from app.schemas import _CLEAR, WishCreate

T = TypeVar("T", bound=DeclarativeBase)


def _is_clear_sentinel(value) -> bool:
    """Check for the 0 sentinel meaning 'clear this FK to None'.

    Referrer IDs are SERIAL starting at 1, so 0 is never a valid id.
    """
    return value == 0


# ---------------------------------------------------------------------------
# Sorting helper
# ---------------------------------------------------------------------------


def build_sort_clause(
    sort_param: str | None,
    field_map: dict[str, ColumnElement],
    default_clause: ColumnElement,
) -> ColumnElement:
    """Parse a ``sort`` query param into a SQLAlchemy order-by clause.

    The param format is ``field`` (ascending) or ``-field`` (descending).
    The *field_map* dict maps allowed field names to SQLAlchemy column
    expressions.  If the param is missing, empty, or references an
    unknown field, *default_clause* is returned unchanged.

    Example::

        clause = build_sort_clause(
            sort="-created_at",
            field_map={"name": Referrer.name, "created_at": Referrer.created_at},
            default_clause=Referrer.id.asc(),
        )
    """
    if not sort_param:
        return default_clause

    descending = False
    field = sort_param
    if field.startswith("-"):
        descending = True
        field = field[1:]

    if field not in field_map:
        return default_clause

    col = field_map[field]
    return col.desc() if descending else col.asc()


# ---------------------------------------------------------------------------
# Sort-field registries (module-level so they aren't rebuilt per request)
# ---------------------------------------------------------------------------

# Reusable correlated subqueries: aggregate stats over active persons per family.
# Used by sort registries, filter logic, and public family list endpoint.
FAMILY_PERSON_COUNT = (
    select(func.count(Person.id)).where(Person.family_id == Family.id, Person.deleted_at.is_(None)).correlate(Family).scalar_subquery()
)

FAMILY_MIN_AGE = (
    select(func.min(Person.age)).where(Person.family_id == Family.id, Person.deleted_at.is_(None)).correlate(Family).scalar_subquery()
)

FAMILY_MAX_AGE = (
    select(func.max(Person.age)).where(Person.family_id == Family.id, Person.deleted_at.is_(None)).correlate(Family).scalar_subquery()
)

FAMILY_SORT_FIELDS: dict[str, ColumnElement] = {
    "family_name": Family.family_name,
    "id": Family.id,
    "created_at": Family.created_at,
    "approval_status": Family.approval_status,
    "wish_lock_level": Family.wish_lock_level,
    "referrer_id": func.coalesce(Family.referrer_id, 0),
    "person_count": FAMILY_PERSON_COUNT,
}

INVITE_SORT_FIELDS: dict[str, ColumnElement] = {
    "code": ReferrerInviteToken.code,
    "id": ReferrerInviteToken.id,
    "created_at": ReferrerInviteToken.created_at,
    "expires_at": ReferrerInviteToken.expires_at,
}

PERSON_SORT_FIELDS: dict[str, ColumnElement] = {
    "given_name": Person.given_name,
    "age": Person.age,
    "id": Person.id,
    "created_at": Person.created_at,
    "family_id": Person.family_id,
}

REFERRER_SORT_FIELDS: dict[str, ColumnElement] = {
    "name": Referrer.name,
    "id": Referrer.id,
    "created_at": Referrer.created_at,
    "approved_at": Referrer.approved_at,
    "approval_status": Referrer.approval_status,
}

USER_SORT_FIELDS: dict[str, ColumnElement] = {
    "display_name": User.display_name,
    "email": User.email,
    "role": User.role,
    "id": User.id,
    "created_at": User.created_at,
}

WISH_SORT_FIELDS: dict[str, ColumnElement] = {
    "description": Wish.description,
    "type": Wish.type,
    "id": Wish.id,
    "purchased_at": Wish.purchased_at,
    "created_at": Wish.created_at,
}

PUBLIC_FAMILY_SORT_FIELDS: dict[str, ColumnElement] = {
    "person_count": FAMILY_PERSON_COUNT,
    "min_age": FAMILY_MIN_AGE,
    "max_age": FAMILY_MAX_AGE,
}


# ---------------------------------------------------------------------------
# Repository helpers
# ---------------------------------------------------------------------------


def get_or_404(db: Session, model: Type[T], id: int, detail: str = "Not found") -> T:
    """Fetch a record by id or raise 404."""
    obj = db.query(model).filter(model.id == id).first()
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return obj


def get_active_or_404(db: Session, model: Type[T], id: int, detail: str = "Not found") -> T:
    """Like get_or_404 but also rejects soft-deleted records."""
    obj = get_or_404(db, model, id, detail)
    if getattr(obj, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return obj


# ---------------------------------------------------------------------------
# Detail builders (computed fields)
# ---------------------------------------------------------------------------


def build_referrer_detail(ref: Referrer, db: Session, *, family_count: int | None = None) -> dict:
    """Build a dict suitable for ReferrerDetail, including family_count.

    Only *approved*, non-deleted families count toward the family count.
    Pass ``family_count`` to skip the query when it is already known.
    """
    if family_count is None:
        family_count = (
            db.query(Family)
            .filter(
                Family.referrer_id == ref.id,
                Family.deleted_at.is_(None),
                Family.approval_status == FamilyApprovalStatus.approved,
            )
            .count()
        )

    # Resolve approved_by_admin name
    approved_by_name: str | None = None
    if ref.approved_by_admin_id is not None:
        admin = db.query(User).filter(User.id == ref.approved_by_admin_id).first()
        if admin and admin.deleted_at is None:
            approved_by_name = admin.display_name

    return {
        "id": ref.id,
        "name": ref.name,
        "family_limit": ref.family_limit,
        "phone_number": ref.phone_number,
        "family_invite_code": ref.family_invite_code,
        "family_count": family_count,
        "approval_status": ref.approval_status,
        "approved_by_admin_name": approved_by_name,
        "approved_at": ref.approved_at,
        "created_at": ref.created_at,
        "deleted_at": ref.deleted_at,
    }


def build_person_detail(per: Person, db: Session) -> dict:
    """Build a dict suitable for PersonDetail, including eager-loaded wishes and display_id.

    Only non-deleted wishes are included.
    """
    wishes = db.query(Wish).filter(Wish.person_id == per.id, Wish.deleted_at.is_(None)).all()

    # Compute display_id scoped to the person's family
    display_id_map = compute_display_ids(db, "person", [per], scope=per.family_id)
    display_id = display_id_map.get(per.id, "0")

    return {
        "id": per.id,
        "family_id": per.family_id,
        "display_id": display_id,
        "given_name": per.given_name,
        "title": per.title,
        "age": per.age,
        "note": per.note,
        "created_at": per.created_at,
        "deleted_at": per.deleted_at,
        "wishes": [
            {
                "id": w.id,
                "type": w.type,
                "description": w.description,
                "size": w.size,
                "assigned_to_id": w.assigned_to_id,
                "purchased_at": w.purchased_at,
                "purchased_where": w.purchased_where,
                "received_at": w.received_at,
                "purchaser_note": w.purchaser_note,
                "deleted_at": w.deleted_at,
            }
            for w in wishes
        ],
    }


def sync_person_wishes(
    db: Session,
    person_id: int,
    new_wishes: list[WishCreate],
    *,
    now: datetime | None = None,
) -> None:
    """Sync a person's active wishes to match *new_wishes*.

    * Wishes whose ``type`` already exists are updated in place (preserving ID / purchase tracking).
    * Wishes whose ``type`` is new are created (soft-deleted remnants of that type are hard-deleted first).
    * Active wishes whose ``type`` is no longer present are soft-deleted.

    Does **not** commit — caller owns the transaction.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    active_wishes = db.query(Wish).filter(Wish.person_id == person_id, Wish.deleted_at.is_(None)).all()
    active_by_type: dict[WishType, Wish] = {w.type: w for w in active_wishes}
    new_types = {wd.type for wd in new_wishes}

    for wish_data in new_wishes:
        existing = active_by_type.get(wish_data.type)
        if existing:
            existing.description = wish_data.description
            existing.size = wish_data.size
        else:
            # Hard-delete any soft-deleted wish of this type first (partial unique index)
            old_deleted = (
                db.query(Wish)
                .filter(
                    Wish.person_id == person_id,
                    Wish.type == wish_data.type,
                    Wish.deleted_at.isnot(None),
                )
                .first()
            )
            if old_deleted:
                db.delete(old_deleted)

            db.add(
                Wish(
                    person_id=person_id,
                    type=wish_data.type,
                    description=wish_data.description,
                    size=wish_data.size,
                )
            )

    # Soft-delete active wishes whose type is no longer in the new set
    for wtype, w in active_by_type.items():
        if wtype not in new_types:
            w.deleted_at = now


def soft_delete_person_wishes(db: Session, person_id: int, now: datetime) -> None:
    """Soft-delete all wishes belonging to a person.

    Does **not** commit — caller owns the transaction.
    """
    db.query(Wish).filter(Wish.person_id == person_id).update({Wish.deleted_at: now}, synchronize_session=False)


def restore_person_wishes(db: Session, person_id: int) -> None:
    """Restore (un-delete) all soft-deleted wishes for a person.

    Does **not** commit — caller owns the transaction.
    """
    db.query(Wish).filter(Wish.person_id == person_id).update({Wish.deleted_at: None}, synchronize_session=False)


def batch_load_person_wishes(db: Session, person_ids: list[int]) -> dict[int, list[Wish]]:
    """Load all active wishes for a batch of person IDs in a single query.

    Returns ``{person_id: [Wish, ...]}``.
    """
    if not person_ids:
        return {}
    wishes = db.query(Wish).filter(Wish.person_id.in_(person_ids), Wish.deleted_at.is_(None)).all()
    result: dict[int, list[Wish]] = {pid: [] for pid in person_ids}
    for w in wishes:
        result[w.person_id].append(w)
    return result


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def check_family_person_cap(db: Session, family_id: int) -> None:
    """Raise 400 if the family has reached the person cap.

    Only active (non-deleted) persons are counted.  Admin routes bypass
    this check — call it only from self-service / referrer endpoints.
    """
    current_count = db.query(Person).filter(Person.family_id == family_id, Person.deleted_at.is_(None)).count()
    if current_count >= MAX_FAMILY_PERSONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Family person limit of {MAX_FAMILY_PERSONS} reached",
        )


# ---------------------------------------------------------------------------
# Person creation
# ---------------------------------------------------------------------------


def create_person_with_wishes(
    db: Session,
    family_id: int,
    given_name: str,
    age: int,
    wishes: list[WishCreate],
    *,
    title: str | None = None,
    note: str | None = None,
) -> Person:
    """Create a Person and their initial Wish records in a single call.

    Flushes the session so that ``person.id`` is populated.  Does **not**
    commit — caller owns the transaction.
    """
    per = Person(
        family_id=family_id,
        given_name=given_name,
        age=age,
        title=title,
        note=note,
    )
    db.add(per)
    db.flush()

    for wish_data in wishes:
        db.add(
            Wish(
                person_id=per.id,
                type=wish_data.type,
                description=wish_data.description,
                size=wish_data.size,
            )
        )

    return per


def build_wish_detail(wish: Wish, person: Person) -> dict:
    """Build a dict suitable for WishDetail, including person context."""
    return {
        "id": wish.id,
        "type": wish.type,
        "description": wish.description,
        "size": wish.size,
        "assigned_to_id": wish.assigned_to_id,
        "purchased_at": wish.purchased_at,
        "purchased_where": wish.purchased_where,
        "received_at": wish.received_at,
        "purchaser_note": wish.purchaser_note,
        "person_id": wish.person_id,
        "person_given_name": person.given_name,
        "person_family_name": person.family.family_name if person.family else None,
    }


def build_wish_list_item(wish: Wish, person: Person, *, assigned_users: dict[int, User] | None = None) -> dict:
    """Build a dict suitable for WishListSummary (flat admin list view).

    Pass *assigned_users* as a pre-loaded {user_id: User} map to avoid N+1
    queries.  If omitted the caller is responsible for populating the
    relationship via joinedload.
    """
    assigned_to_name: str | None = None
    if wish.assigned_to_id is not None:
        user = assigned_users.get(wish.assigned_to_id) if assigned_users is not None else wish.assigned_to
        if user is not None and user.deleted_at is None:
            assigned_to_name = user.display_name

    return {
        "id": wish.id,
        "type": wish.type,
        "description": wish.description,
        "size": wish.size,
        "person_id": wish.person_id,
        "person_given_name": person.given_name,
        "family_id": person.family_id,
        "assigned_to_id": wish.assigned_to_id,
        "assigned_to_name": assigned_to_name,
        "purchased_at": wish.purchased_at,
        "purchased_where": wish.purchased_where,
        "received_at": wish.received_at,
        "purchaser_note": wish.purchaser_note,
    }


def build_family_detail(
    fam: Family, db: Session, *, person_count: int | None = None, include_referrer_notes: bool = False, include_delivery: bool = True
) -> dict:
    """Build a dict suitable for FamilyDetail, including person_count, display_id, and referrer_name.

    Pass ``person_count`` to skip the query when it is already known.
    Pass ``include_referrer_notes=True`` to include the referrer_notes field
    (for referrer and admin views; omit for family self-service).
    Pass ``include_delivery=False`` to skip the delivery-user lookup
    (for family self-service views that don't expose delivery info).
    """
    if person_count is None:
        person_count = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).count()

    # Compute display_id scoped to the family's referrer
    display_id_map = compute_display_ids(db, "family", [fam], scope=fam.referrer_id)
    display_id = display_id_map.get(fam.id, "0")

    # Resolve referrer name
    referrer_name: str | None = None
    if fam.referrer_id is not None:
        ref = db.query(Referrer).filter(Referrer.id == fam.referrer_id, Referrer.deleted_at.is_(None)).first()
        if ref:
            referrer_name = ref.name

    # Resolve delivery user name (skip for self-service views)
    delivery_user_name: str | None = None
    if include_delivery and fam.delivery_user_id is not None:
        del_user = db.query(User).filter(User.id == fam.delivery_user_id, User.deleted_at.is_(None)).first()
        if del_user:
            delivery_user_name = del_user.display_name

    # Resolve active claim info
    active_claim = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.family_id == fam.id,
            FamilyClaim.deleted_at.is_(None),
        )
        .first()
    )
    claim_status: str | None = None
    claim_commitment_type: str | None = None
    claim_donor_name: str | None = None
    claim_id: int | None = None
    if active_claim:
        claim_status = "fulfilled" if active_claim.fulfilled_at is not None else "active"
        claim_commitment_type = active_claim.commitment_type.value
        claim_id = active_claim.id
        donor = db.query(User).filter(User.id == active_claim.donor_user_id).first()
        if donor and donor.deleted_at is None:
            claim_donor_name = donor.display_name

    result: dict = {
        "id": fam.id,
        "referrer_id": fam.referrer_id,
        "referrer_name": referrer_name,
        "delivery_user_id": fam.delivery_user_id if include_delivery else None,
        "delivery_user_name": delivery_user_name,
        "display_id": display_id,
        "family_name": fam.family_name,
        "bio": fam.bio,
        "address": fam.address,
        "phone_number": fam.phone_number,
        "family_wish": fam.family_wish,
        "contact_name": fam.contact_name,
        "approval_status": fam.approval_status,
        "pickup_window": fam.pickup_window,
        "deleted_at": fam.deleted_at,
        "person_count": person_count,
        "wish_lock_level": fam.wish_lock_level,
        "wish_review_requested_at": fam.wish_review_requested_at,
        "wish_rejection_reason": fam.wish_rejection_reason,
        "claim_status": claim_status,
        "claim_commitment_type": claim_commitment_type,
        "claim_donor_name": claim_donor_name,
        "claim_id": claim_id,
    }

    if include_referrer_notes:
        result["referrer_notes"] = fam.referrer_notes

    return result


def build_family_review_summary(
    fam: Family, db: Session, *, person_count: int | None = None, referrer_map: dict[int, str] | None = None
) -> dict:
    """Build a dict suitable for FamilyReviewList (review queue items).

    Includes referrer_name resolution.  Pass ``person_count`` to skip the
    query when it is already known.  Pass ``referrer_map`` (id → name) to
    avoid per-family referrer lookups when building a list response.
    """
    if person_count is None:
        person_count = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).count()

    referrer_name: str | None = None
    if fam.referrer_id is not None:
        if referrer_map is not None:
            referrer_name = referrer_map.get(fam.referrer_id)
        else:
            ref = db.query(Referrer).filter(Referrer.id == fam.referrer_id, Referrer.deleted_at.is_(None)).first()
            if ref:
                referrer_name = ref.name

    return {
        "id": fam.id,
        "family_name": fam.family_name,
        "contact_name": fam.contact_name,
        "referrer_id": fam.referrer_id,
        "referrer_name": referrer_name,
        "person_count": person_count,
        "wish_review_requested_at": fam.wish_review_requested_at,
        "wish_rejection_reason": fam.wish_rejection_reason,
    }


def build_user_detail(
    user: User,
    db: Session,
    *,
    referrer_map: dict[int, str] | None = None,
    family_map: dict[int, str] | None = None,
) -> dict:
    """Build a dict suitable for UserDetail, including joined referrer/family names.

    Pass pre-loaded ``referrer_map`` / ``family_map`` (id → name) to avoid
    per-user queries when building a list response.
    """
    referrer_name = None
    if user.referrer_id is not None:
        if referrer_map is not None:
            referrer_name = referrer_map.get(user.referrer_id)
        else:
            ref = db.query(Referrer).filter(Referrer.id == user.referrer_id).first()
            if ref and ref.deleted_at is None:
                referrer_name = ref.name

    family_name = None
    if user.family_id is not None:
        if family_map is not None:
            family_name = family_map.get(user.family_id)
        else:
            fam = db.query(Family).filter(Family.id == user.family_id).first()
            if fam and fam.deleted_at is None:
                family_name = fam.family_name

    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "referrer_id": user.referrer_id,
        "family_id": user.family_id,
        "deleted_at": user.deleted_at,
        "created_at": user.created_at,
        "referrer_name": referrer_name,
        "family_name": family_name,
    }


# ---------------------------------------------------------------------------
# Partial update
# ---------------------------------------------------------------------------


def _resolve_sentinels(obj, update_data: dict) -> dict:
    """Resolve sentinel values in update data before they are applied.

    * ``0`` on a nullable FK column → ``_CLEAR`` (clear the FK to NULL).
    * ``""`` on any nullable column → ``_CLEAR`` (clear to NULL).
    * ``None`` is left as-is (means "don't change").

    Returns a new dict with resolved values. Callers can inspect the result
    to see the effective values before committing.
    """
    columns = obj.__table__.columns
    resolved: dict[str, object] = {}
    for field, value in update_data.items():
        if value is None:
            resolved[field] = None
            continue
        if _is_clear_sentinel(value) and field in columns and columns[field].nullable:
            resolved[field] = _CLEAR  # 0 sentinel means "clear FK"
        elif isinstance(value, str) and value == "" and field in columns and columns[field].nullable:
            resolved[field] = _CLEAR  # "" on nullable field means "clear"
        else:
            resolved[field] = value
    return resolved


def partial_update(obj, schema_model, *, exclude: set[str] | None = None):
    """Apply all explicitly-set fields from a Pydantic model to a SQLAlchemy object.

    Fields omitted by the client are excluded (via ``exclude_unset``).
    Fields sent as ``null`` are ignored (no change).
    Fields sent as ``0`` on nullable FK columns clear the value (set to ``None``).
    Fields sent as ``""`` on nullable string columns clear the value (set to ``None``).

    Pass ``exclude`` to skip specific fields (e.g. ``{'wishes'}``).
    """
    update_data = schema_model.model_dump(exclude_unset=True, exclude=exclude or set())
    resolved = _resolve_sentinels(obj, update_data)
    for field, value in resolved.items():
        if value is None:
            continue  # null means "don't change"
        if value is _CLEAR:
            setattr(obj, field, None)
        else:
            setattr(obj, field, value)


# ---------------------------------------------------------------------------
# Column filtering
# ---------------------------------------------------------------------------


@dataclass
class ColumnRequest:
    """Parsed column filter from the ``columns`` query parameter.

    Use ``request.needs("field_name")`` to check whether a column
    (and its dependent DB lookups) are required for the response.
    When the client sends no ``columns`` param, all fields are needed.
    """

    _requested: set[str] | None = None

    @classmethod
    def parse(cls, columns: str | None) -> "ColumnRequest":
        if columns is None:
            return cls(None)
        return cls({c.strip() for c in columns.split(",") if c.strip()})

    def needs(self, *field_names: str) -> bool:
        """Return True if any of the given field names are needed."""
        if self._requested is None:
            return True
        return any(name in self._requested for name in field_names)


def _get_required_fields(item) -> set[str]:
    """Extract required field names from a Pydantic model instance."""
    required: set[str] = set()
    for name, field_info in item.model_fields.items():
        if field_info.is_required():
            required.add(name)
    return required


def apply_column_filter(items: list, columns: str | None, *, always_include: set[str] | None = None) -> list[dict]:
    """Filter model instances (or dicts) to only include requested columns.

    When *columns* is None, return full model_dump for each item (or the dicts
    as-is).
    When *columns* is provided, serialize with model_dump(include=...) using
    the comma-separated field names. *always_include* fields are forced into
    the selection (e.g. "id" for mutations, "wishes" for people).

    Required fields from the Pydantic model are always included regardless of
    the column filter, so the partial dicts remain valid against the response
    schema.

    Raises 400 if any requested column name is not a valid field on the
    response model (whitelist enforcement).
    """
    if columns is None:
        if items and isinstance(items[0], dict):
            return list(items)
        return [item.model_dump() for item in items]

    requested = set(c.strip() for c in columns.split(",") if c.strip())
    if always_include:
        requested.update(always_include)

    # Always include required fields so partial dicts satisfy the response schema
    if items and hasattr(items[0], "model_fields"):
        requested.update(_get_required_fields(items[0]))

    # Validate against whitelist — reject unknown column names
    if items and hasattr(items[0], "model_fields"):
        allowed = set(items[0].model_fields.keys())
        unknown = requested - allowed
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown column(s): {', '.join(sorted(unknown))}",
            )

    if items and isinstance(items[0], dict):
        return [{k: v for k, v in item.items() if k in requested} for item in items]
    return [item.model_dump(include=requested) for item in items]


# ---------------------------------------------------------------------------
# Display ID computation
# ---------------------------------------------------------------------------


def compute_display_ids(
    db: Session,
    entity_type: Literal["family", "person"],
    page_entities: list,
    scope: int | None = None,
    *,
    show_status_labels: bool = False,
) -> dict[int, str]:
    """Compute stable display IDs for a page of entities.

    Display IDs are hierarchical positions based on ROW_NUMBER over *active
    only* entities (approved, non-deleted).  Positions are ordered by database
    ``id`` so they are stable across viewers and pagination — a position shifts
    only when an entity before it is created, deleted, restored, or changes
    approval status.

    Format by view:

    +---------------------+---------------------------+----------------------------------+
    | View                | Family                    | Person                           |
    +=====================+===========================+==================================+
    | Flat (admin)        | ``{ref_or_0}-{pos}``      | ``{ref_or_0}-{fam}-{per}``       |
    +---------------------+---------------------------+----------------------------------+
    | Scoped to referrer  | ``{pos}``                 | n/a                              |
    +---------------------+---------------------------+----------------------------------+
    | Scoped to family    | n/a                       | ``{per}``                        |
    +---------------------+---------------------------+----------------------------------+

    Non-enumerated entities (pending, rejected, deleted) receive ``"0"`` or,
    when ``show_status_labels`` is True, their status label (``"PENDING"``,
    ``"REJECTED"``, ``"DELETED"``).

    Args:
        db: database session.
        entity_type: ``"family"`` or ``"person"``.
        page_entities: entities on the current page (used to scope queries).
        scope: ``referrer_id`` for family views, ``family_id`` for person
            views. ``None`` for flat (unscoped) views.
        show_status_labels: if True, non-enumerated entities get their status
            label instead of ``"0"``.

    Returns:
        ``{entity.id: display_id}`` for each entity in page_entities.
    """
    if not page_entities:
        return {}

    # ------------------------------------------------------------------ #
    # 1. Compute family positions (always needed)
    # ------------------------------------------------------------------ #
    # ROW_NUMBER must be computed over the full partition to preserve
    # pagination continuity.  We scope the query by referrer_id so it
    # doesn't scan the entire table.
    page_family_ids = {e.family_id if entity_type == "person" else e.id for e in page_entities}

    if entity_type == "family":
        # Collect the referrer_ids that appear on this page
        page_referrer_ids = {(e.referrer_id if e.referrer_id is not None else 0) for e in page_entities}
    else:
        # For person views we need family positions — resolve referrer_ids
        # from the families referenced by the page's people.
        fam_rows = db.query(Family.id, Family.referrer_id).filter(Family.id.in_(page_family_ids)).all()
        page_referrer_ids = {(ref_id if ref_id is not None else 0) for _, ref_id in fam_rows}

    # Build the family-position filter.
    # For family views, ``scope`` is a referrer_id.
    # For person views, ``scope`` is a family_id — so we always use the
    # page_referrer_ids approach (resolved from the page's families).
    if entity_type == "family" and scope is not None:
        # Scoped family view (e.g. admin with referrer_id, or referrer's
        # own view).  Compute over all approved families for that referrer.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
            Family.referrer_id == scope,
        ]
    else:
        # Flat family view or any person view — compute over all approved
        # families whose referrer_id appears on the current page.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
            func.coalesce(Family.referrer_id, 0).in_(page_referrer_ids),
        ]

    positions = (
        db.query(
            Family.id,
            Family.referrer_id,
            func.row_number()
            .over(
                partition_by=func.coalesce(Family.referrer_id, 0),
                order_by=Family.id,
            )
            .label("rn"),
        )
        .filter(*fam_filter)
        .all()
    )

    fam_pos_map: dict[int, int] = {}
    fam_ref_map: dict[int, int] = {}  # family_id -> referrer_id_or_0
    for fid, ref_id, rn in positions:
        fam_pos_map[fid] = int(rn)
        fam_ref_map[fid] = ref_id if ref_id is not None else 0

    # ------------------------------------------------------------------ #
    # 2. Compute person positions (only for person views)
    # ------------------------------------------------------------------ #
    per_pos_map: dict[int, int] = {}
    if entity_type == "person":
        # Filter by family_id, not person_id, so ROW_NUMBER is computed
        # over all people in each family (preserves pagination continuity).
        if scope is not None:
            per_filter = [
                Person.deleted_at.is_(None),
                Person.family_id == scope,
            ]
        else:
            per_filter = [
                Person.deleted_at.is_(None),
                Person.family_id.in_(page_family_ids),
            ]

        positions = (
            db.query(
                Person.id,
                func.row_number()
                .over(
                    partition_by=Person.family_id,
                    order_by=Person.id,
                )
                .label("rn"),
            )
            .filter(*per_filter)
            .all()
        )
        per_pos_map = {pid: int(rn) for pid, rn in positions}

    # ------------------------------------------------------------------ #
    # 3. Format display IDs
    # ------------------------------------------------------------------ #
    result: dict[int, str] = {}

    for entity in page_entities:
        eid = entity.id

        if entity_type == "family":
            if eid in fam_pos_map:
                pos = fam_pos_map[eid]
                ref = fam_ref_map[eid]
                if scope is not None:
                    result[eid] = str(pos)
                else:
                    result[eid] = f"{ref}-{pos}"
            else:
                # Not in active enumeration (pending / rejected / deleted)
                if show_status_labels:
                    if entity.deleted_at is not None:
                        result[eid] = "DELETED"
                    else:
                        result[eid] = entity.approval_status.value.upper()
                else:
                    result[eid] = "0"

        elif entity_type == "person":
            fid = entity.family_id
            if eid in per_pos_map and fid in fam_pos_map:
                fpos = fam_pos_map[fid]
                ppos = per_pos_map[eid]
                ref = fam_ref_map[fid]
                if scope is not None:
                    # Scoped to family — show person position only
                    result[eid] = str(ppos)
                else:
                    result[eid] = f"{ref}-{fpos}-{ppos}"
            else:
                if show_status_labels and entity.deleted_at is not None:
                    result[eid] = "DELETED"
                else:
                    result[eid] = "0"

    return result
