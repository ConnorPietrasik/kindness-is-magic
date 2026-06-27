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


class ReferrerInviteCreate(BaseModel):
    """Admin: create an invite token."""

    family_limit: int = Field(..., ge=1, le=999)


class ReferrerSelfRegister(BaseModel):
    """Public: redeem an invite code to register as a referrer."""

    code: str
    name: str = Field(..., min_length=1, max_length=60)
    email: str = Field(..., min_length=1, max_length=40)
    phone_number: str = Field(..., min_length=1, max_length=20)
    password: str = Field(..., min_length=8)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


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


class ReferrerInviteResponse(BaseModel):
    """Returned when admin creates an invite."""

    code: str
    family_limit: int
    expires_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class ReferrerSummary(BaseModel):
    """Minimal referrer info returned on self-registration."""

    id: int
    name: str
    family_limit: int

    model_config = {"from_attributes": True}


class ReferrerSelfRegisterResponse(BaseModel):
    """Returned when a person redeems an invite."""

    user: UserResponse
    referrer: ReferrerSummary


# ---------------------------------------------------------------------------
# Admin CRUD schemas — Referrers
# ---------------------------------------------------------------------------


class ReferrerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    family_limit: int = Field(..., ge=1, le=999)
    phone_number: str = Field(..., min_length=1, max_length=20)


class ReferrerUpdate(BaseModel):
    """Admin-only: full update including family_limit."""

    name: Optional[str] = Field(None, min_length=1, max_length=60)
    family_limit: Optional[int] = Field(None, ge=1, le=999)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=20)


class ReferrerSelfUpdate(BaseModel):
    """Referrer self-service update — family_limit is not allowed."""

    name: Optional[str] = Field(None, min_length=1, max_length=60)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=20)


class ReferrerDetail(BaseModel):
    id: int
    name: str
    family_limit: int
    phone_number: str
    family_count: int

    model_config = {"from_attributes": True}


class ReferrerListResponse(BaseModel):
    referrers: list[ReferrerSummary]


# ---------------------------------------------------------------------------
# Admin CRUD schemas — Families
# ---------------------------------------------------------------------------


class FamilyCreate(BaseModel):
    referrer_id: int
    family_name: str = Field(..., min_length=1, max_length=40)
    family_wish: str = Field(..., min_length=1, max_length=400)
    contact_name: str = Field(..., min_length=1, max_length=40)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)


class FamilyUpdate(BaseModel):
    family_name: Optional[str] = Field(None, min_length=1, max_length=40)
    family_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    contact_name: Optional[str] = Field(None, min_length=1, max_length=40)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)


class FamilyDetail(BaseModel):
    id: int
    referrer_id: int
    family_name: str
    bio: Optional[str]
    address: Optional[str]
    phone_number: Optional[str]
    family_wish: str
    contact_name: str
    person_count: int

    model_config = {"from_attributes": True}


class FamilySummary(BaseModel):
    id: int
    family_name: str
    family_wish: str
    contact_name: str
    referrer_id: int
    person_count: int = 0

    model_config = {"from_attributes": True}


class FamilyListResponse(BaseModel):
    families: list[FamilySummary]


# ---------------------------------------------------------------------------
# Admin CRUD schemas — People
# ---------------------------------------------------------------------------


class PersonCreate(BaseModel):
    family_id: int
    given_name: str = Field(..., min_length=1, max_length=40)
    age: int = Field(..., ge=0, le=200)
    practical_wish: str = Field(..., min_length=1, max_length=400)
    fun_wish: str = Field(..., min_length=1, max_length=400)
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)


class PersonUpdate(BaseModel):
    given_name: Optional[str] = Field(None, min_length=1, max_length=40)
    age: Optional[int] = Field(None, ge=0, le=200)
    practical_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    fun_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)


class PersonDetail(BaseModel):
    id: int
    family_id: int
    given_name: str
    title: Optional[str]
    age: int
    practical_wish: str
    fun_wish: str
    note: Optional[str]

    model_config = {"from_attributes": True}


class PersonSummary(BaseModel):
    id: int
    family_id: int
    given_name: str
    age: int

    model_config = {"from_attributes": True}


class PersonListResponse(BaseModel):
    people: list[PersonSummary]
