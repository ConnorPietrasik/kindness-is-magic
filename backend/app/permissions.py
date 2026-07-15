"""Role-based access-control dependencies for FastAPI."""

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import joinedload, Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User, UserRole


def _get_user_or_raise(
    current_user: User = Depends(get_current_user),
) -> User:
    """Thin pass-through so callers can type-hint `User` cleanly."""
    return current_user


# ---------------------------------------------------------------------------
# Role guards
# ---------------------------------------------------------------------------


def require_admin(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user is an admin."""
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def require_referrer(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user is a referrer or admin."""
    if current_user.role not in (UserRole.admin, UserRole.referrer):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Referrer or admin access required",
        )
    return current_user


def require_family(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user is a family. This intentionally excludes admins because they have their own routes"""
    if current_user.role not in (UserRole.family):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Family access required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Ownership guard
# ---------------------------------------------------------------------------


def require_owner_or_admin(resource_id: int):
    """
    Factory: returns a dependency that ensures the current user owns the
    resource (via referrer_id or family_id) or is an admin.
    """

    def _check(
        current_user: User = Depends(_get_user_or_raise),
        db: Session = Depends(get_db),
    ) -> User:
        if current_user.role == UserRole.admin:
            return current_user

        owns = False
        if current_user.role == UserRole.referrer and current_user.referrer_id == resource_id:
            owns = True
        elif current_user.role == UserRole.family and current_user.family_id == resource_id:
            owns = True

        if not owns:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource",
            )
        return current_user

    return _check


# ---------------------------------------------------------------------------
# Shared person ownership guard
# ---------------------------------------------------------------------------

@dataclass
class PersonOwner:
    """Returned by require_person_owner so route handlers can reuse the loaded Person."""
    user: User
    person: "Person | None"  # noqa: F821  # None for admins; loaded Person for referrer/family


def require_person_owner(
    request: Request,
    current_user: User = Depends(_get_user_or_raise),
    db: Session = Depends(get_db),
) -> PersonOwner:
    """
    Dependency that ensures the current user has ownership of the person record.
    Returns both the authenticated user and the already-loaded Person object
    so route handlers don't need to re-query.

    - Admin: always allowed (person=None — handler should load with desired eager-loading)
    - Referrer: person.family.referrer_id == user.referrer_id
    - Family: person.family_id == user.family_id
    """
    from app.models import Person

    if current_user.role == UserRole.admin:
        return PersonOwner(user=current_user, person=None)

    per_id = request.path_params.get("per_id")
    if per_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing per_id path parameter",
        )

    # Use joinedload to get Family in the same query — avoids the separate Family lookup
    per = (
        db.query(Person)
        .options(joinedload(Person.family))
        .filter(Person.id == int(per_id))
        .first()
    )
    if per is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )
    if per.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )

    if current_user.role == UserRole.referrer:
        if per.family and not per.family.is_deleted and per.family.referrer_id == current_user.referrer_id:
            return PersonOwner(user=current_user, person=per)

    elif current_user.role == UserRole.family:
        if per.family_id == current_user.family_id:
            return PersonOwner(user=current_user, person=per)

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource",
    )
