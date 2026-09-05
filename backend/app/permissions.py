"""Role-based access-control dependencies for FastAPI."""

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import joinedload, Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Family, User, UserRole, WishLockLevel


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
    """Raise 403 unless the user is a referrer. Admins are excluded because they have their own routes."""
    if current_user.role != UserRole.referrer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Referrer access required",
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


def require_purchaser(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user is a purchaser. Admins are excluded because they have their own routes."""
    if current_user.role != UserRole.purchaser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Purchaser access required",
        )
    return current_user


def require_delivery(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user is a delivery person. Admins are excluded because they have their own routes."""
    if current_user.role != UserRole.delivery:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Delivery access required",
        )
    return current_user


def require_claim_capable(current_user: User = Depends(_get_user_or_raise)) -> User:
    """Raise 403 unless the user can claim families.

    Claim-capable roles: admin, referrer, purchaser, donor.
    """
    if current_user.role not in (
        UserRole.admin,
        UserRole.referrer,
        UserRole.purchaser,
        UserRole.donor,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage sponsorships",
        )
    return current_user


# ---------------------------------------------------------------------------
# Wish edit lock
# ---------------------------------------------------------------------------

_FAMILY_LOCKED_MSG = "Your family profile is locked for editing. Contact your referrer to request changes."
_REFERRER_LOCKED_MSG = "This family is locked (admin-approved). Contact an admin to make changes."


def check_wish_edit_lock(user: User, family: Family) -> None:
    """Raise 403 if the user cannot edit the family's standard fields at the current lock level.

    - Admin: never blocked
    - Referrer: blocked only at ``admin`` lock
    - Family: blocked at ``referrer`` or ``admin`` lock

    ``referrer_notes`` bypasses this check by convention — apply it only to
    standard family/person edits.
    """
    if user.role == UserRole.admin:
        return

    if user.role == UserRole.referrer:
        if family.wish_lock_level == WishLockLevel.admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_REFERRER_LOCKED_MSG,
            )
    elif user.role == UserRole.family:
        if family.wish_lock_level != WishLockLevel.family:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_FAMILY_LOCKED_MSG,
            )


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
# Family ownership guard
# ---------------------------------------------------------------------------


@dataclass
class FamilyOwner:
    """Returned by require_family_owner so route handlers can reuse the loaded Family."""

    user: User
    family: "Family"  # noqa: F821


def require_family_owner(
    request: Request,
    current_user: User = Depends(_get_user_or_raise),
    db: Session = Depends(get_db),
) -> FamilyOwner:
    """
    Runtime dependency that ensures the current user owns the family.
    Returns both the authenticated user and the already-loaded Family object
    so route handlers don't need to re-query.

    - Referrer: family.referrer_id == user.referrer_id
    """
    from app.models import Family

    fam_id = request.path_params.get("fam_id") or request.path_params.get("fid")
    if fam_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing family id path parameter",
        )

    fam = db.query(Family).filter(Family.id == int(fam_id)).first()
    if fam is None or fam.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family not found",
        )

    if fam.referrer_id != current_user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )

    return FamilyOwner(user=current_user, family=fam)


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
    per = db.query(Person).options(joinedload(Person.family)).filter(Person.id == int(per_id)).first()
    if per is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )
    if per.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )

    if current_user.role == UserRole.referrer:
        if per.family and per.family.deleted_at is None and per.family.referrer_id == current_user.referrer_id:
            return PersonOwner(user=current_user, person=per)

    elif current_user.role == UserRole.family:
        if per.family_id == current_user.family_id:
            return PersonOwner(user=current_user, person=per)

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource",
    )
