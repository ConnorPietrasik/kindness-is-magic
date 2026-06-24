"""Role-based access-control dependencies for FastAPI."""

from fastapi import Depends, HTTPException, status
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
    """Raise 403 unless the user is a family, referrer, or admin."""
    if current_user.role not in (UserRole.admin, UserRole.referrer, UserRole.family):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Family, referrer, or admin access required",
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
