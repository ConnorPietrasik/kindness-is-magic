"""Shared helpers for building response dicts and applying partial updates.

Centralises logic that was duplicated across admin_routes, referrer_routes,
and family_routes.
"""

from typing import Type, TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import DeclarativeBase, Session

from app.models import Family, Person, Referrer

T = TypeVar("T", bound=DeclarativeBase)


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
    if getattr(obj, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return obj


# ---------------------------------------------------------------------------
# Detail builders (computed fields)
# ---------------------------------------------------------------------------


def build_referrer_detail(ref: Referrer, db: Session) -> dict:
    """Build a dict suitable for ReferrerDetail, including family_count."""
    family_count = db.query(Family).filter(Family.referrer_id == ref.id, Family.is_deleted == False).count()
    return {
        "id": ref.id,
        "name": ref.name,
        "family_limit": ref.family_limit,
        "phone_number": ref.phone_number,
        "family_count": family_count,
    }


def build_family_detail(fam: Family, db: Session) -> dict:
    """Build a dict suitable for FamilyDetail, including person_count."""
    person_count = db.query(Person).filter(Person.family_id == fam.id, Person.is_deleted == False).count()
    return {
        "id": fam.id,
        "referrer_id": fam.referrer_id,
        "family_name": fam.family_name,
        "bio": fam.bio,
        "address": fam.address,
        "phone_number": fam.phone_number,
        "family_wish": fam.family_wish,
        "contact_name": fam.contact_name,
        "is_deleted": fam.is_deleted,
        "person_count": person_count,
    }


# ---------------------------------------------------------------------------
# Partial update
# ---------------------------------------------------------------------------


def partial_update(obj, schema_model):
    """Apply all explicitly-set fields from a Pydantic model to a SQLAlchemy object.

    Fields omitted by the client are excluded (via ``exclude_unset``).
    Fields sent as ``null`` are ignored (no change).
    Fields sent as ``""`` on nullable string columns clear the value (set to ``None``).
    """
    update_data = schema_model.model_dump(exclude_unset=True)
    columns = obj.__table__.columns
    for field, value in update_data.items():
        if value is None:
            continue  # null means "don't change"
        if isinstance(value, str) and value == "" and field in columns and columns[field].nullable:
            value = None  # "" on nullable field means "clear"
        setattr(obj, field, value)
