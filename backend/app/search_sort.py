"""Sort/search infrastructure for list endpoints.

Sort-clause parsing, LIKE escaping, and the module-level sort/search field
registries — including the shared table aliases, the owner-family coalesce
helper, and the correlated aggregate subqueries behind them.
"""

from sqlalchemy import ColumnElement, String, case, func, select
from sqlalchemy.orm import aliased
from sqlalchemy.orm.util import AliasedClass

from app.models import Family, Person, Referrer, ReferrerInviteToken, SentEmail, User, Wish, WishType


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
