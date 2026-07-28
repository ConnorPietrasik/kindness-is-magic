"""Shared helpers for building response dicts and applying partial updates.

Centralises logic that was duplicated across admin_*_routes, referrer_routes,
and family_routes.
"""

from typing import Type, TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import DeclarativeBase, Session

from app.models import Family, FamilyApprovalStatus, Person, Referrer, User
from app.schemas import _CLEAR

T = TypeVar("T", bound=DeclarativeBase)


def _is_clear_sentinel(value) -> bool:
    """Check for the 0 sentinel meaning 'clear this FK to None'.

    Referrer IDs are SERIAL starting at 1, so 0 is never a valid id.
    """
    return value == 0


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
            approved_by_name = admin.display_name or admin.email

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
        "deleted_at": ref.deleted_at,
    }


def build_family_detail(fam: Family, db: Session, *, person_count: int | None = None) -> dict:
    """Build a dict suitable for FamilyDetail, including person_count.

    Pass ``person_count`` to skip the query when it is already known.
    """
    if person_count is None:
        person_count = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).count()
    return {
        "id": fam.id,
        "referrer_id": fam.referrer_id,
        "family_name": fam.family_name,
        "bio": fam.bio,
        "address": fam.address,
        "phone_number": fam.phone_number,
        "family_wish": fam.family_wish,
        "contact_name": fam.contact_name,
        "approval_status": fam.approval_status,
        "deleted_at": fam.deleted_at,
        "person_count": person_count,
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
    * ``""`` on a nullable string column → ``_CLEAR`` (clear to NULL).
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


def partial_update(obj, schema_model):
    """Apply all explicitly-set fields from a Pydantic model to a SQLAlchemy object.

    Fields omitted by the client are excluded (via ``exclude_unset``).
    Fields sent as ``null`` are ignored (no change).
    Fields sent as ``0`` on nullable FK columns clear the value (set to ``None``).
    Fields sent as ``""`` on nullable string columns clear the value (set to ``None``).
    """
    update_data = schema_model.model_dump(exclude_unset=True)
    resolved = _resolve_sentinels(obj, update_data)
    for field, value in resolved.items():
        if value is None:
            continue  # null means "don't change"
        if value is _CLEAR:
            setattr(obj, field, None)
        else:
            setattr(obj, field, value)
