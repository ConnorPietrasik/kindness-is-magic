"""Pydantic request/response schemas for authentication."""

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models import UserRole

_EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")


def _validate_email(v: str) -> str:
    if not _EMAIL_RE.match(v):
        raise ValueError("Invalid email address")
    return v.lower()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    """Admin-only: create a new user."""

    email: str
    password: str = Field(..., min_length=8)
    role: UserRole
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class UserLogin(BaseModel):
    """Login with email + password."""

    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class ChangePassword(BaseModel):
    """Change own password."""

    old_password: str
    new_password: str = Field(..., min_length=8)


class ForgotPassword(BaseModel):
    """Request a password-reset token."""

    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class ResetPassword(BaseModel):
    """Consume a reset token and set a new password."""

    token: str
    new_password: str = Field(..., min_length=8)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TokenPair(BaseModel):
    """Returned in the response body (cookies carry the real tokens)."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """Public user profile — never exposes the password hash."""

    id: int
    email: str
    role: UserRole
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
