"""Role-based access-control dependencies for FastAPI."""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

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
    """Raise 403 unless the user is a family"""
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


def require_person_owner(
    request: Request,
    current_user: User = Depends(_get_user_or_raise),
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency that ensures the current user has ownership of the person record.

    - Admin: always allowed
    - Referrer: person.family.referrer_id == user.referrer_id
    - Family: person.family_id == user.family_id
    """
    from app.models import Family, Person

    if current_user.role == UserRole.admin:
        return current_user

    per_id = request.path_params.get("per_id")
    if per_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing per_id path parameter",
        )

    per = db.query(Person).filter(Person.id == int(per_id)).first()
    if per is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )

    if current_user.role == UserRole.referrer:
        fam = db.query(Family).filter(Family.id == per.family_id).first()
        if fam and fam.referrer_id == current_user.referrer_id:
            return current_user

    elif current_user.role == UserRole.family:
        if per.family_id == current_user.family_id:
            return current_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource",
    )
