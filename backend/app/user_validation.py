"""Shared user validation helpers.

Used by both :mod:`app.auth_routes` (raises ``HTTPException``) and
:mod:`app.csv_import` (appends errors to the import summary).
"""

import re

from app.models import UserRole

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")


def validate_email(email: str) -> str:
    """Normalize an email address.

    Raises ``ValueError`` if the address does not match the basic pattern.
    """
    normalized = email.strip().lower()
    if not _EMAIL_RE.match(normalized):
        raise ValueError(f"Invalid email address: {email}")
    return normalized


# ---------------------------------------------------------------------------
# Role-consistency checks
# ---------------------------------------------------------------------------


def validate_user_role_consistency(
    role: UserRole,
    referrer_id: int | None,
    family_id: int | None,
) -> list[str]:
    """Return a list of error strings (empty when valid).

    Rules::

        admin    → must NOT have referrer_id or family_id
        referrer → MUST  have referrer_id, must NOT have family_id
        family   → MUST  have family_id, must NOT have referrer_id
    """
    errors: list[str] = []

    if role == UserRole.admin:
        if referrer_id is not None:
            errors.append("Admin users must not have referrer_id")
        if family_id is not None:
            errors.append("Admin users must not have family_id")

    elif role == UserRole.referrer:
        if referrer_id is None:
            errors.append("Referrer users must have a referrer_id")
        if family_id is not None:
            errors.append("Referrer users must not have a family_id")

    elif role == UserRole.family:
        if family_id is None:
            errors.append("Family users must have a family_id")
        if referrer_id is not None:
            errors.append("Family users must not have a referrer_id")

    return errors
