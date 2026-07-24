"""Shared helpers for building response dicts and applying partial updates.

Centralises logic that was duplicated across admin_routes, referrer_routes,
and family_routes.
"""

from typing import Type, TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import DeclarativeBase, Session

from app.models import Family, FamilyApprovalStatus, Person, Referrer, User

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


def build_referrer_detail(ref: Referrer, db: Session) -> dict:
    """Build a dict suitable for ReferrerDetail, including family_count.

    Only *approved*, non-deleted families count toward the family count.
    """
    family_count = (
        db.query(Family)
        .filter(
            Family.referrer_id == ref.id,
            Family.deleted_at.is_(None),
            Family.approval_status == FamilyApprovalStatus.approved,
        )
        .count()
    )
    return {
        "id": ref.id,
        "name": ref.name,
        "family_limit": ref.family_limit,
        "phone_number": ref.phone_number,
        "family_invite_code": ref.family_invite_code,
        "family_count": family_count,
        "deleted_at": ref.deleted_at,
    }


def build_family_detail(fam: Family, db: Session) -> dict:
    """Build a dict suitable for FamilyDetail, including person_count."""
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


def build_user_detail(user: User, db: Session) -> dict:
    """Build a dict suitable for UserDetail, including joined referrer/family names."""
    referrer_name = None
    if user.referrer_id is not None:
        ref = db.query(Referrer).filter(Referrer.id == user.referrer_id).first()
        if ref and ref.deleted_at is None:
            referrer_name = ref.name

    family_name = None
    if user.family_id is not None:
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


def build_user_summary(user: User, db: Session) -> dict:
    """Build a dict suitable for UserSummary, including joined referrer/family names.

    Shares the same shape as UserDetail so the list table can show linked names
    without N+1 detail fetches.
    """
    return build_user_detail(user, db)


# ---------------------------------------------------------------------------
# Partial update
# ---------------------------------------------------------------------------


def partial_update(obj, schema_model):
    """Apply all explicitly-set fields from a Pydantic model to a SQLAlchemy object.

    Fields omitted by the client are excluded (via ``exclude_unset``).
    Fields sent as ``null`` are ignored (no change).
    Fields sent as ``0`` on nullable FK columns clear the value (set to ``None``).
    Fields sent as ``""`` on nullable string columns clear the value (set to ``None``).
    """
    update_data = schema_model.model_dump(exclude_unset=True)
    columns = obj.__table__.columns
    for field, value in update_data.items():
        if value is None:
            continue  # null means "don't change"
        if _is_clear_sentinel(value) and field in columns and columns[field].nullable:
            value = None  # -1 sentinel means "clear FK"
        if isinstance(value, str) and value == "" and field in columns and columns[field].nullable:
            value = None  # "" on nullable field means "clear"
        setattr(obj, field, value)
