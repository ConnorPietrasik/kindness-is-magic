"""Shared helpers for building response dicts and applying partial updates.

Centralises logic that was duplicated across admin_*_routes, referrer_routes,
and family_routes.
"""

import math
from dataclasses import dataclass
from typing import Type, TypeVar, Literal

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, String, case, func, select
from sqlalchemy.orm import DeclarativeBase, Session, aliased
from sqlalchemy.orm.util import AliasedClass

from datetime import datetime, timezone

from app.config import MAX_FAMILY_PERSONS
from app.models import (
    Family,
    FamilyVerificationStatus,
    FamilyClaim,
    Person,
    PersonRole,
    Referrer,
    ReferrerInviteToken,
    SentEmail,
    User,
    Wish,
    WishType,
)
from app.schemas import _CLEAR, WishCreate, WishSummary

T = TypeVar("T", bound=DeclarativeBase)


def _is_clear_sentinel(value) -> bool:
    """Check for the 0 sentinel meaning 'clear this FK to None'.

    Referrer IDs are SERIAL starting at 1, so 0 is never a valid id.
    """
    return value == 0


# ---------------------------------------------------------------------------
# Batch family info helpers
# ---------------------------------------------------------------------------


def _batch_family_aggregates(db: Session, family_ids: list[int]) -> dict[int, tuple]:
    """Batch-load person_count, min_age, max_age for a list of families.

    Returns ``{family_id: (person_count, min_age, max_age)}``.
    """
    if not family_ids:
        return {}
    rows = (
        db.query(
            Person.family_id,
            func.count(Person.id).label("pc"),
            func.min(Person.age).label("ma"),
            func.max(Person.age).label("xa"),
        )
        .filter(Person.family_id.in_(family_ids), Person.deleted_at.is_(None))
        .group_by(Person.family_id)
        .all()
    )
    return {fid: (pc, ma, xa) for fid, pc, ma, xa in rows}


def batch_build_family_info(db: Session, families: list[Family]) -> dict[int, dict]:
    """Build family info dicts for a batch of families in a single pass.

    Returns ``{family_id: {id, display_id, bio, person_count, min_age, max_age}}``.
    """
    if not families:
        return {}

    family_ids = [f.id for f in families]
    fam_map: dict[int, Family] = {f.id: f for f in families}

    # Batch display IDs
    display_id_map = compute_display_ids(db, "family", families, scope=None)

    # Batch aggregates (person_count, min_age, max_age)
    agg_map = _batch_family_aggregates(db, family_ids)

    return {
        fid: {
            "id": fid,
            "display_id": display_id_map.get(fid, "0"),
            "bio": fam_map[fid].bio,
            "person_count": agg_map.get(fid, (0, None, None))[0],
            "min_age": agg_map.get(fid, (0, None, None))[1],
            "max_age": agg_map.get(fid, (0, None, None))[2],
        }
        for fid in family_ids
    }


def build_family_info(fam: Family, db: Session) -> dict:
    """Build the family info dict used in claim/public responses.

    For single families. Use ``batch_build_family_info()`` for lists.
    """
    result = batch_build_family_info(db, [fam])
    return result.get(fam.id, {"id": fam.id, "display_id": "0", "bio": fam.bio, "person_count": 0})


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


def wish_grouped_order(direct_family: AliasedClass) -> list[ColumnElement]:
    """Grouped default order for wish list endpoints.

    Groups each family's wishes together — owner family's referrer
    (unassigned families first), owner family, person — with the family
    wish first in each family block, then wish type in display order
    (practical, fun, adult) and wish id. The owner family is the person's
    family or the wish's own family.

    Callers must outer-join Person and the person's Family, plus
    *direct_family*, an ``aliased(Family)`` on ``Wish.family_id`` for
    family wishes.
    """
    return [
        func.coalesce(Family.referrer_id, direct_family.referrer_id, 0),
        func.coalesce(Family.id, direct_family.id),
        case((Wish.person_id.is_(None), 0), else_=1),
        Wish.person_id,
        case((Wish.type == WishType.practical, 0), (Wish.type == WishType.fun, 1), else_=2),
        Wish.id,
    ]


# ---------------------------------------------------------------------------
# Search-pattern helper
# ---------------------------------------------------------------------------


def escape_like(value: str) -> str:
    """Escape LIKE/ILIKE wildcards so user search input matches literally.

    Without escaping, a ``%`` or ``_`` typed by the user acts as pattern
    syntax (a search for ``50%`` behaves like ``50``).  Pair the result
    with the ``escape="\\"` kwarg on the ilike/like call::

        pattern = f"%{escape_like(search)}%"
        query = query.filter(Wish.description.ilike(pattern, escape="\\"))
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ---------------------------------------------------------------------------
# Sort-field registries (module-level so they aren't rebuilt per request)
# ---------------------------------------------------------------------------

# Shared joins for the admin wish list query and its sort/search
# expressions (see admin_wishes.list_wishes): the wish's own family (family
# wishes), the owner family's referrer, and the assigned user.
DIRECT_FAMILY = aliased(Family)
WISH_REFERRER = aliased(Referrer)
ASSIGNED_USER = aliased(User)


def _owner_family_column(attr: str, *, as_text: bool = False) -> ColumnElement:
    """Coalesce an owner-family column across both family paths.

    The owner family is the person's family or the wish's direct family
    (exactly one is joined per wish). *as_text* casts the result to text
    (for enum columns matched as text in search).
    """
    col = func.coalesce(getattr(Family, attr), getattr(DIRECT_FAMILY, attr))
    return col.cast(String) if as_text else col


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

# The family wish is now a Wish row (type=family, family_id set, no person).
# At most one active family wish exists per family (partial unique index), so
# this scalar subquery is unambiguous.
FAMILY_WISH = (
    select(Wish.description)
    .where(Wish.family_id == Family.id, Wish.type == WishType.family, Wish.deleted_at.is_(None))
    .correlate(Family)
    .scalar_subquery()
)

FAMILY_SORT_FIELDS: dict[str, ColumnElement] = {
    "family_name": Family.family_name,
    "id": Family.id,
    "created_at": Family.created_at,
    "verification_status": Family.verification_status,
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
    "size": Wish.size,
    "color": Wish.color,
    "purchased_at": Wish.purchased_at,
    "purchased_where": Wish.purchased_where,
    "received_at": Wish.received_at,
    "purchaser_note": Wish.purchaser_note,
    "created_at": Wish.created_at,
    "person_given_name": Person.given_name,
    "person_role": Person.role,
    "person_age": Person.age,
    "person_note": Person.note,
    "family_name": _owner_family_column("family_name"),
    "family_contact_name": _owner_family_column("contact_name"),
    "family_phone_number": _owner_family_column("phone_number"),
    "family_address": _owner_family_column("address"),
    "family_verification_status": _owner_family_column("verification_status"),
    "family_pickup_window": _owner_family_column("pickup_window"),
    "family_bio": _owner_family_column("bio"),
    "referrer_name": WISH_REFERRER.name,
    "referrer_phone_number": WISH_REFERRER.phone_number,
    "assigned_to_name": ASSIGNED_USER.display_name,
}

# Owner-family columns exposed as wish list fields: item field name →
# Family column attribute. Both family paths are covered by the coalesce in
# _owner_family_column(); the global-search OR expands them to separate
# terms instead (wish_global_search_terms).
WISH_FAMILY_SEARCH_ATTRS: dict[str, str] = {
    "family_name": "family_name",
    "family_contact_name": "contact_name",
    "family_phone_number": "phone_number",
    "family_address": "address",
    "family_verification_status": "verification_status",
    "family_bio": "bio",
}

# Per-column text search: item field name → column expression. Enum and
# age columns are cast to text so they match as strings.
WISH_SEARCH_FIELDS: dict[str, ColumnElement] = {
    "description": Wish.description,
    "size": Wish.size,
    "color": Wish.color,
    "purchased_where": Wish.purchased_where,
    "purchaser_note": Wish.purchaser_note,
    "person_given_name": Person.given_name,
    "person_role": Person.role.cast(String),
    "person_age": Person.age.cast(String),
    "person_note": Person.note,
    **{field: _owner_family_column(attr, as_text=attr == "verification_status") for field, attr in WISH_FAMILY_SEARCH_ATTRS.items()},
    "referrer_name": WISH_REFERRER.name,
    "referrer_phone_number": WISH_REFERRER.phone_number,
    "assigned_to_name": ASSIGNED_USER.display_name,
}

# Per-column search fields matched as whole (case-insensitive) values
# instead of substrings: closed vocabularies where substring matching is
# surprising ("1" would match ages 10 and 12, "so" would match "son").
WISH_SEARCH_EXACT_FIELDS: frozenset[str] = frozenset({"person_role", "person_age", "family_verification_status"})


# Per-column date-range search: item field name → column expression.
WISH_DATE_RANGE_FIELDS: dict[str, ColumnElement] = {
    "purchased_at": Wish.purchased_at,
    "received_at": Wish.received_at,
    "created_at": Wish.created_at,
    "family_pickup_window": _owner_family_column("pickup_window"),
}


def wish_global_search_terms(pattern: str) -> list[ColumnElement]:
    """ILIKE terms for the admin wish list's global search box.

    Covers every field in WISH_SEARCH_FIELDS. Owner-family fields keep
    both family paths as separate terms (the person's family OR the wish's
    direct family) instead of the single coalesced term used for
    per-column search, so the OR shape matches the existing family-name
    terms.
    """
    terms = [col.ilike(pattern, escape="\\") for field, col in WISH_SEARCH_FIELDS.items() if field not in WISH_FAMILY_SEARCH_ATTRS]
    for attr in WISH_FAMILY_SEARCH_ATTRS.values():
        for family_alias in (Family, DIRECT_FAMILY):
            col = getattr(family_alias, attr)
            if attr == "verification_status":
                col = col.cast(String)
            terms.append(col.ilike(pattern, escape="\\"))
    return terms


PUBLIC_FAMILY_SORT_FIELDS: dict[str, ColumnElement] = {
    "person_count": FAMILY_PERSON_COUNT,
    "min_age": FAMILY_MIN_AGE,
    "max_age": FAMILY_MAX_AGE,
}

EMAIL_SORT_FIELDS: dict[str, ColumnElement] = {
    "recipient_email": SentEmail.recipient_email,
    "kind": SentEmail.kind,
    "status": SentEmail.status,
    "sent_at": SentEmail.sent_at,
    "id": SentEmail.id,
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


def build_referrer_detail(
    ref: Referrer,
    db: Session,
    *,
    family_count: int | None = None,
    admin_map: dict[int, str] | None = None,
) -> dict:
    """Build a dict suitable for ReferrerDetail, including family_count.

    Only *verified*, non-deleted families count toward the family count.
    Pass ``family_count`` to skip the query when it is already known.
    Pass ``admin_map`` (id → display_name) to resolve the approving admin
    name without a per-referrer query when building a list response.
    """
    if family_count is None:
        family_count = (
            db.query(Family)
            .filter(
                Family.referrer_id == ref.id,
                Family.deleted_at.is_(None),
                Family.verification_status == FamilyVerificationStatus.verified,
            )
            .count()
        )

    # Resolve approved_by_admin name
    approved_by_name: str | None = None
    if ref.approved_by_admin_id is not None:
        if admin_map is not None:
            approved_by_name = admin_map.get(ref.approved_by_admin_id)
        else:
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

    Only non-deleted wishes are included. Each nested wish's ``display_id``
    is derived from this person's (family-scoped) display_id.
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
        "role": per.role,
        "age": per.age,
        "note": per.note,
        "created_at": per.created_at,
        "deleted_at": per.deleted_at,
        "wishes": [build_wish_summary(w, display_id) for w in wishes],
    }


def build_person_list_item(p: Person, *, display_id: str | None, wishes: list[Wish]) -> dict:
    """Build a dict suitable for ``PersonDetail`` (list views).

    Pass the pre-computed ``display_id`` and the person's wishes
    (typically from :func:`batch_load_person_wishes`); use ``[]`` for the
    soft-deleted list where wishes are not loaded. Each nested wish's
    ``display_id`` is derived from the person's display_id.
    """
    owner_display_id = display_id if display_id is not None else "0"
    return {
        "id": p.id,
        "display_id": display_id,
        "family_id": p.family_id,
        "given_name": p.given_name,
        "role": p.role,
        "age": p.age,
        "note": p.note,
        "created_at": p.created_at,
        "deleted_at": p.deleted_at,
        "wishes": [build_wish_summary(w, owner_display_id) for w in wishes],
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
            existing.color = wish_data.color
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
                    color=wish_data.color,
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


def _family_person_ids(db: Session, family_id: int) -> list[int]:
    """All person IDs in a family, whether soft-deleted or not."""
    return [pid for (pid,) in db.query(Person.id).filter(Person.family_id == family_id).all()]


def soft_delete_family_cascade(db: Session, family_id: int, now: datetime) -> None:
    """Soft-delete all of a family's people, their wishes, and the family wish.

    Does **not** commit — caller owns the transaction. The caller sets
    ``deleted_at`` on the loaded Family object.
    """
    person_ids = _family_person_ids(db, family_id)
    db.query(Person).filter(Person.family_id == family_id).update({Person.deleted_at: now}, synchronize_session=False)
    if person_ids:
        db.query(Wish).filter(Wish.person_id.in_(person_ids)).update({Wish.deleted_at: now}, synchronize_session=False)
    db.query(Wish).filter(Wish.family_id == family_id, Wish.type == WishType.family).update(
        {Wish.deleted_at: now}, synchronize_session=False
    )


def restore_family_cascade(db: Session, family_id: int) -> None:
    """Restore a family's soft-deleted people, their wishes, and the family wish.

    Coarse by design (same as the people restore): brings back everything
    under the family, including rows deleted independently while the family
    was active. Does **not** commit — caller owns the transaction. The
    caller clears ``deleted_at`` on the loaded Family object.
    """
    person_ids = _family_person_ids(db, family_id)
    db.query(Person).filter(Person.family_id == family_id).update({Person.deleted_at: None}, synchronize_session=False)
    if person_ids:
        db.query(Wish).filter(Wish.person_id.in_(person_ids)).update({Wish.deleted_at: None}, synchronize_session=False)
    db.query(Wish).filter(Wish.family_id == family_id, Wish.type == WishType.family).update(
        {Wish.deleted_at: None}, synchronize_session=False
    )


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


def batch_load_family_wishes(db: Session, family_ids: list[int]) -> dict[int, str]:
    """Load the active family wish description for a batch of family IDs.

    Returns ``{family_id: description}`` (families without an active family
    wish are omitted).
    """
    if not family_ids:
        return {}
    rows = (
        db.query(Wish.family_id, Wish.description)
        .filter(Wish.family_id.in_(family_ids), Wish.type == WishType.family, Wish.deleted_at.is_(None))
        .all()
    )
    return {fid: desc for fid, desc in rows}


def attach_family_wish(db: Session, fam: Family, description: str) -> Wish:
    """Attach (or update) the family's single active ``family`` wish.

    Every family is created with its family wish in the same transaction, and
    at most one active family wish exists per family (partial unique index).
    If an active wish already exists its description is updated in place
    (preserving ID / purchase tracking); otherwise any soft-deleted remnant
    is hard-deleted first and a new wish is created.

    Does **not** commit — caller owns the transaction.
    """
    # Flush first so a just-added family has its ID for the lookups below.
    db.flush()
    wish = db.query(Wish).filter(Wish.family_id == fam.id, Wish.type == WishType.family, Wish.deleted_at.is_(None)).first()
    if wish is None:
        # Hard-delete any soft-deleted remnant first (partial unique index)
        old_deleted = db.query(Wish).filter(Wish.family_id == fam.id, Wish.type == WishType.family, Wish.deleted_at.isnot(None)).first()
        if old_deleted:
            db.delete(old_deleted)
        wish = Wish(family_id=fam.id, type=WishType.family, description=description)
        db.add(wish)
    else:
        wish.description = description
    return wish


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
    role: PersonRole,
    note: str | None = None,
) -> Person:
    """Create a Person and their initial Wish records in a single call.

    Flushes the session so that ``person.id`` is populated.  Does **not**
    commit — caller owns the transaction.
    """
    per = Person(
        family_id=family_id,
        given_name=given_name,
        role=role,
        age=age,
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
                color=wish_data.color,
            )
        )

    return per


def build_wish_summary(wish: Wish, owner_display_id: str) -> dict:
    """Build a dict suitable for ``WishSummary`` with an explicit ``display_id``.

    ``WishSummary.model_validate(wish)`` on a Wish ORM object silently
    defaults ``display_id`` to None (missing attribute → field default);
    that is correct for the public/donor routes, so internal builders that
    know the owner's display id must set the field explicitly.
    """
    data = WishSummary.model_validate(wish).model_dump()
    data["display_id"] = wish_display_id(owner_display_id, wish.type)
    return data


def build_wish_detail(wish: Wish, person: Person | None, db: Session, *, display_id: str | None = None) -> dict:
    """Build a dict suitable for WishDetail, including person context.

    *person* is ``None`` for family wishes (the wish is bound to a family,
    not a person).

    ``display_id`` is the wish's presentational id in the flat view format:
    the owner's flat display id (person wish → the person's, family wish →
    the family's) plus the wish's type suffix (see
    :func:`wish_display_id`).  Pass a pre-computed ``display_id`` (from a
    batched position map) to skip the per-wish lookups.
    """
    if display_id is None:
        if person is not None:
            owner_map = compute_display_ids(db, "person", [person], scope=None)
            owner_display_id = owner_map.get(person.id, "0")
        else:
            owner_map = compute_display_ids(db, "family", [wish.family], scope=None)
            owner_display_id = owner_map.get(wish.family_id, "0")
        display_id = wish_display_id(owner_display_id, wish.type)
    return {
        "id": wish.id,
        "type": wish.type,
        "description": wish.description,
        "size": wish.size,
        "color": wish.color,
        "assigned_to_id": wish.assigned_to_id,
        "purchased_at": wish.purchased_at,
        "purchased_where": wish.purchased_where,
        "received_at": wish.received_at,
        "purchaser_note": wish.purchaser_note,
        "person_id": wish.person_id,
        "person_given_name": person.given_name if person is not None else None,
        "person_family_name": person.family.family_name if person is not None and person.family else None,
        "display_id": display_id,
    }


def build_wish_list_item(
    wish: Wish,
    person: Person | None,
    *,
    display_id: str | None = None,
    assigned_users: dict[int, User] | None = None,
    referrer_map: dict[int, Referrer] | None = None,
) -> dict:
    """Build a dict suitable for WishListSummary (flat admin list view).

    *person* is ``None`` for family wishes, which resolve their family
    directly from ``wish.family_id``; person-wishes resolve it through the
    person. The owner family's fields (name, contact, phone, address,
    verification status, pickup window, bio) and its referrer's fields come
    from that family.

    Pass *display_id* as the pre-computed wish display id (the owner's flat
    display id + type suffix); it stays None when the caller did not
    compute it (the ``display_id`` column was not requested).

    Pass *assigned_users* as a pre-loaded {user_id: User} map to avoid N+1
    queries.  If omitted the caller is responsible for populating the
    relationship via joinedload.

    Pass *referrer_map* as a pre-loaded {referrer_id: Referrer} map covering
    the page's owner families (soft-deleted referrers excluded, so they
    display as None); omit or pass {} when the referrer columns are not
    requested.
    """
    assigned_to_name: str | None = None
    if wish.assigned_to_id is not None:
        user = assigned_users.get(wish.assigned_to_id) if assigned_users is not None else wish.assigned_to
        if user is not None and user.deleted_at is None:
            assigned_to_name = user.display_name

    owner_family = person.family if person is not None else wish.family
    referrer = None
    if owner_family is not None and owner_family.referrer_id is not None and referrer_map is not None:
        referrer = referrer_map.get(owner_family.referrer_id)

    return {
        "id": wish.id,
        "display_id": display_id,
        "type": wish.type,
        "description": wish.description,
        "size": wish.size,
        "color": wish.color,
        "person_id": wish.person_id,
        "person_given_name": person.given_name if person is not None else None,
        "person_role": person.role if person is not None else None,
        "person_age": person.age if person is not None else None,
        "person_note": person.note if person is not None else None,
        "family_id": wish.family_id if person is None else person.family_id,
        "family_name": owner_family.family_name if owner_family is not None else None,
        "family_contact_name": owner_family.contact_name if owner_family is not None else None,
        "family_phone_number": owner_family.phone_number if owner_family is not None else None,
        "family_address": owner_family.address if owner_family is not None else None,
        "family_verification_status": owner_family.verification_status if owner_family is not None else None,
        "family_pickup_window": owner_family.pickup_window if owner_family is not None else None,
        "family_bio": owner_family.bio if owner_family is not None else None,
        "referrer_name": referrer.name if referrer is not None else None,
        "referrer_phone_number": referrer.phone_number if referrer is not None else None,
        "assigned_to_id": wish.assigned_to_id,
        "assigned_to_name": assigned_to_name,
        "purchased_at": wish.purchased_at,
        "purchased_where": wish.purchased_where,
        "received_at": wish.received_at,
        "purchaser_note": wish.purchaser_note,
        "created_at": wish.created_at,
    }


def build_family_detail(
    fam: Family,
    db: Session,
    *,
    person_count: int | None = None,
    display_id: str | None = None,
    include_referrer_notes: bool = False,
    include_delivery: bool = True,
    include_claim: bool = True,
    claim_map: dict[int, FamilyClaim] | None = None,
    donor_map: dict[int, str] | None = None,
    family_wish: str | None = None,
) -> dict:
    """Build a dict suitable for FamilyDetail, including person_count, display_id, and referrer_name.

    Pass ``person_count`` to skip the query when it is already known.
    Pass ``display_id`` to skip the compute_display_ids query (for list views
    that already batch-compute IDs).
    Pass ``include_referrer_notes=True`` to include the referrer_notes field
    (for referrer and admin views; omit for family self-service).
    Pass ``include_delivery=False`` to skip the delivery-user lookup
    (for family self-service views that don't expose delivery info).
    Pass ``include_claim=False`` to skip claim lookups.
    Pass pre-loaded ``claim_map`` (family_id → FamilyClaim) and ``donor_map``
    (user_id → display_name) to avoid per-family claim queries.
    Pass ``family_wish`` to skip the wish-row lookup (for callers that
    already have the description, e.g. right after attaching it).
    """
    if family_wish is None:
        family_wish = (
            db.query(Wish.description).filter(Wish.family_id == fam.id, Wish.type == WishType.family, Wish.deleted_at.is_(None)).scalar()
        ) or ""
    if person_count is None:
        person_count = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).count()

    # Compute display_id (skip if already provided)
    if display_id is None:
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
    claim_status: str | None = None
    claim_commitment_type: str | None = None
    claim_donor_name: str | None = None
    claim_id: int | None = None
    if include_claim:
        active_claim = (
            claim_map.get(fam.id)
            if claim_map is not None
            else (
                db.query(FamilyClaim)
                .filter(
                    FamilyClaim.family_id == fam.id,
                    FamilyClaim.deleted_at.is_(None),
                )
                .first()
            )
        )
        if active_claim:
            claim_status = "fulfilled" if active_claim.fulfilled_at is not None else "active"
            claim_commitment_type = active_claim.commitment_type.value
            claim_id = active_claim.id
            donor = (
                donor_map.get(active_claim.donor_user_id)
                if donor_map is not None
                else (db.query(User).filter(User.id == active_claim.donor_user_id).first())
            )
            if donor and (donor.deleted_at if isinstance(donor, User) else False) is None:
                claim_donor_name = donor.display_name if isinstance(donor, User) else donor

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
        "family_wish": family_wish,
        "contact_name": fam.contact_name,
        "verification_status": fam.verification_status,
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


@dataclass
class FamilyListContext:
    """Batch-loaded lookup maps for building a page of family list items."""

    count_map: dict[int, int]
    pos_map: dict[int, str]
    referrer_map: dict[int, str]
    delivery_user_map: dict[int, str]
    claim_map: dict[int, FamilyClaim]
    donor_map: dict[int, str]
    family_wish_map: dict[int, str]


def load_family_list_context(
    db: Session,
    families: list[Family],
    cols: "ColumnRequest | None" = None,
    *,
    scope: int | None,
    include_claim: bool = False,
    show_status_labels: bool = False,
) -> FamilyListContext:
    """Batch-load the lookup maps needed to build a family list page.

    Only runs queries for the maps that ``cols`` indicates the client needs
    (``cols=None`` loads all maps, for endpoints without a ``columns`` param).
    ``person_count`` and ``family_wish`` are optional on FamilyDetail, so
    skipping their lookups when not requested is safe.
    ``scope`` restricts display-ID numbering to a single referrer
    (``None`` = flat admin numbering).  ``include_claim`` loads claim and
    donor names (admin views); ``show_status_labels`` gives pending/rejected
    families ``"PENDING"``/``"REJECTED"`` display IDs.
    """
    if cols is None:
        cols = ColumnRequest.parse(None)

    family_ids = [f.id for f in families]

    count_map: dict[int, int] = {}
    if cols.needs("person_count"):
        counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
        count_map = {fid: cnt for fid, cnt in counts}

    family_wish_map = batch_load_family_wishes(db, family_ids) if cols.needs("family_wish") else {}

    pos_map: dict[int, str] = {}
    if cols.needs("display_id"):
        pos_map = compute_display_ids(db, "family", families, scope, show_status_labels=show_status_labels)

    referrer_map: dict[int, str] = {}
    if cols.needs("referrer_name"):
        referrer_ids = {f.referrer_id for f in families if f.referrer_id is not None}
        if referrer_ids:
            for ref in db.query(Referrer).filter(Referrer.id.in_(referrer_ids), Referrer.deleted_at.is_(None)).all():
                referrer_map[ref.id] = ref.name

    delivery_user_map: dict[int, str] = {}
    if cols.needs("delivery_user_name"):
        delivery_user_ids = {f.delivery_user_id for f in families if f.delivery_user_id is not None}
        if delivery_user_ids:
            for u in db.query(User).filter(User.id.in_(delivery_user_ids), User.deleted_at.is_(None)).all():
                delivery_user_map[u.id] = u.display_name

    claim_map: dict[int, FamilyClaim] = {}
    donor_map: dict[int, str] = {}
    if include_claim and cols.needs("claim_status", "claim_commitment_type", "claim_donor_name", "claim_id"):
        if family_ids:
            claims = (
                db.query(FamilyClaim)
                .filter(
                    FamilyClaim.family_id.in_(family_ids),
                    FamilyClaim.deleted_at.is_(None),
                )
                .all()
            )
            claim_map = {c.family_id: c for c in claims}
            donor_ids = {c.donor_user_id for c in claims}
            if donor_ids:
                for u in db.query(User).filter(User.id.in_(donor_ids), User.deleted_at.is_(None)).all():
                    donor_map[u.id] = u.display_name

    return FamilyListContext(
        count_map=count_map,
        pos_map=pos_map,
        referrer_map=referrer_map,
        delivery_user_map=delivery_user_map,
        claim_map=claim_map,
        donor_map=donor_map,
        family_wish_map=family_wish_map,
    )


def build_family_list_item(fam: Family, ctx: FamilyListContext, *, display_id: str | None = None) -> dict:
    """Build a dict suitable for ``FamilyDetail`` (list views).

    All ``FamilyDetail`` fields are always present (matching a full
    ``model_dump()``, including ``None`` claim fields when no claim is
    loaded) so column filtering and ``response_model_exclude_unset`` behave
    the same as when items were built as ``FamilyDetail`` instances directly.
    Pass ``display_id`` to override the context's computed display IDs
    (e.g. ``"DELETED"`` on the soft-deleted list).
    """
    claim = ctx.claim_map.get(fam.id)
    return {
        "id": fam.id,
        "display_id": display_id if display_id is not None else ctx.pos_map.get(fam.id),
        "family_name": fam.family_name,
        "family_wish": ctx.family_wish_map.get(fam.id, ""),
        "contact_name": fam.contact_name,
        "referrer_id": fam.referrer_id,
        "referrer_name": ctx.referrer_map.get(fam.referrer_id) if fam.referrer_id else None,
        "delivery_user_id": fam.delivery_user_id,
        "delivery_user_name": ctx.delivery_user_map.get(fam.delivery_user_id) if fam.delivery_user_id else None,
        "bio": fam.bio,
        "address": fam.address,
        "phone_number": fam.phone_number,
        "verification_status": fam.verification_status,
        "pickup_window": fam.pickup_window,
        "deleted_at": fam.deleted_at,
        "person_count": ctx.count_map.get(fam.id, 0),
        "wish_lock_level": fam.wish_lock_level,
        "wish_review_requested_at": fam.wish_review_requested_at,
        "wish_rejection_reason": fam.wish_rejection_reason,
        "referrer_notes": fam.referrer_notes,
        "claim_status": "fulfilled" if claim is not None and claim.fulfilled_at is not None else "active" if claim is not None else None,
        "claim_commitment_type": claim.commitment_type.value if claim is not None else None,
        "claim_donor_name": ctx.donor_map.get(claim.donor_user_id) if claim is not None else None,
        "claim_id": claim.id if claim is not None else None,
    }


def build_family_review_summary(
    fam: Family,
    db: Session,
    *,
    person_count: int | None = None,
    referrer_map: dict[int, str] | None = None,
    display_id: str | None = None,
) -> dict:
    """Build a dict suitable for FamilyReviewList (review queue items).

    Includes referrer_name resolution.  Pass ``person_count`` to skip the
    query when it is already known.  Pass ``referrer_map`` (id → name) to
    avoid per-family referrer lookups when building a list response.  Pass
    ``display_id`` (from ``compute_display_ids``) for the presentational ID.
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
        "display_id": display_id if display_id is not None else "0",
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


def apply_purchase_fields(
    wish: Wish,
    *,
    purchased_at,
    purchased_where: str | None,
    purchaser_note,
) -> None:
    """Apply the purchase fields shared by the mark-purchased flows.

    Applies ``purchased_at`` and ``purchaser_note`` with the
    partial-update convention (None = no-op, ``_CLEAR`` = clear to NULL —
    the mark endpoints resolve an omitted ``purchased_at`` to now before
    calling), and overwrites ``purchased_where`` (None clears it).
    """
    if purchased_at is _CLEAR:
        wish.purchased_at = None
    elif purchased_at is not None:
        wish.purchased_at = purchased_at
    wish.purchased_where = purchased_where
    if purchaser_note is _CLEAR:
        wish.purchaser_note = None
    elif purchaser_note is not None:
        wish.purchaser_note = purchaser_note


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
    for name, field_info in type(item).model_fields.items():
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
    if items and hasattr(type(items[0]), "model_fields"):
        requested.update(_get_required_fields(items[0]))

    # Validate against whitelist — reject unknown column names
    if items and hasattr(type(items[0]), "model_fields"):
        allowed = set(type(items[0]).model_fields.keys())
        unknown = requested - allowed
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown column(s): {', '.join(sorted(unknown))}",
            )

    if items and isinstance(items[0], dict):
        return [{k: v for k, v in item.items() if k in requested} for item in items]
    return [item.model_dump(include=requested) for item in items]


def column_filtered_page(
    items: list,
    columns: str | None,
    *,
    key: str,
    total: int,
    page: int,
    page_size: int,
    always_include: set[str] | None = None,
) -> dict:
    """Build the paginated, column-filtered list envelope.

    Returns ``{"<key>": items, "total", "page", "page_size", "total_pages"}`` where the
    items are filtered through :func:`apply_column_filter`.

    NOTE: Returns a plain dict (not the ``*ListResponse`` model) because
    apply_column_filter produces partial dicts with only requested columns.
    FastAPI validates this dict against the annotated response model —
    required fields are always included so validation passes.
    """
    return {
        key: apply_column_filter(items, columns, always_include=always_include),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


# ---------------------------------------------------------------------------
# Display ID computation
# ---------------------------------------------------------------------------

# Suffix appended to the owner's display_id to form a wish display_id — a
# pure function of wish type (no DB enumeration).
_WISH_TYPE_SUFFIXES: dict[WishType, str] = {
    WishType.practical: "A",
    WishType.fun: "B",
    WishType.adult: "X",
    WishType.family: "-F",
}


def wish_display_id(owner_display_id: str, wish_type: WishType) -> str:
    """Compute a wish's presentational ``display_id`` from its owner's.

    ``display_id = {owner_display_id}{suffix}`` where the suffix is a pure
    function of the wish's type:

    +----------------+--------+
    | Wish type      | Suffix |
    +================+========+
    | ``practical``  | ``A``  |
    +----------------+--------+
    | ``fun``        | ``B``  |
    +----------------+--------+
    | ``adult``      | ``X``  |
    +----------------+--------+
    | ``family``     | ``-F`` |
    +----------------+--------+

    Person wishes get a bare letter (e.g. ``1-1-1A``); family wishes get a
    dash + ``F`` (e.g. ``1-1-F``) so they read as "the family's wish" and
    cannot collide with person wishes.

    *owner_display_id* should be in the view's existing format: flat views
    pass the full owner id (person ``1-1-1``, family ``1-1``); scoped views
    (where the person id is the bare within-family position) pass ``1``,
    yielding ``1A`` / ``1-F`` accordingly.
    """
    return f"{owner_display_id}{_WISH_TYPE_SUFFIXES[wish_type]}"


def compute_position_maps(
    db: Session,
    entity_type: Literal["family", "person"],
    page_entities: list,
    scope: int | None = None,
) -> tuple[dict[int, int], dict[int, int], dict[int, int]]:
    """Compute the raw ROW_NUMBER position maps behind display IDs.

    Returns ``(fam_pos_map, fam_ref_map, per_pos_map)`` where:

    * ``fam_pos_map`` — ``{family_id: position}`` within the referrer
      partition.
    * ``fam_ref_map`` — ``{family_id: referrer_id_or_0}``.
    * ``per_pos_map`` — ``{person_id: position}`` within the family
      partition (empty for ``entity_type="family"``).

    The maps are scope-independent: only the string formatting in
    ``compute_display_ids()`` depends on ``scope``.  Endpoints that need
    positions for entities spanning multiple scopes (e.g. packing slips over
    many families) can call this once for the whole batch instead of calling
    ``compute_display_ids()`` per scope, avoiding a query round-trip per
    scope.

    ``page_entities`` must be non-empty; the family window is resolved from
    the families referenced by the page (see ``compute_display_ids``).
    """
    if not page_entities:
        return {}, {}, {}

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
        # own view).  Compute over all verified families for that referrer.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
            Family.referrer_id == scope,
        ]
    else:
        # Flat family view or any person view — compute over all verified
        # families whose referrer_id appears on the current page.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
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

    # Filter by family_id, not person_id, so ROW_NUMBER is computed over all
    # people in each family (preserves pagination continuity).
    per_pos_map: dict[int, int] = {}
    if entity_type == "person":
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

    return fam_pos_map, fam_ref_map, per_pos_map


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
    only* entities (verified, non-deleted).  Positions are ordered by database
    ``id`` so they are stable across viewers and pagination — a position shifts
    only when an entity before it is created, deleted, restored, or changes
    verification status.

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
    fam_pos_map, fam_ref_map, per_pos_map = compute_position_maps(db, entity_type, page_entities, scope)

    # ------------------------------------------------------------------ #
    # Format display IDs
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
                        result[eid] = entity.verification_status.value.upper()
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
