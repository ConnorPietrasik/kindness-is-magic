"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models import FamilyApprovalStatus, UserRole
from app.user_validation import sanitize_plain_text, validate_email


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    """Admin-only: create a new user."""

    email: str
    password: str = Field(..., min_length=8)
    role: UserRole
    display_name: Optional[str] = Field(None, max_length=40)
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


class UserLogin(BaseModel):
    """Login with email + password."""

    email: str
    password: str

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


class ChangePassword(BaseModel):
    """Change own password."""

    old_password: str
    new_password: str = Field(..., min_length=8)


class ForgotPassword(BaseModel):
    """Request a password-reset token."""

    email: str

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


class ResetPassword(BaseModel):
    """Consume a reset token and set a new password."""

    token: str
    new_password: str = Field(..., min_length=8)


class ReferrerInviteCreate(BaseModel):
    """Admin: create an invite token."""

    family_limit: int = Field(..., ge=1, le=999)
    email: str | None = None

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_email(v)


class ReferrerSelfRegister(BaseModel):
    """Public: redeem an invite code to register as a referrer."""

    code: str
    name: str = Field(..., min_length=1, max_length=60)
    email: str = Field(..., min_length=1, max_length=40)
    phone_number: str = Field(..., min_length=1, max_length=20)
    password: str = Field(..., min_length=8)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return sanitize_plain_text(v)


class FamilySelfRegister(BaseModel):
    """Public: family self-registers via a referrer's family invite code."""

    code: str
    family_name: str = Field(..., min_length=1, max_length=40)
    family_wish: str = Field(..., min_length=1, max_length=400)
    contact_name: str = Field(..., min_length=1, max_length=40)
    email: str = Field(..., min_length=1, max_length=120)
    password: str = Field(..., min_length=8)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("family_name", "family_wish", "contact_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


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
    display_name: Optional[str] = None
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
    email_sent: bool | None = None
    email_send_reason: str | None = None

    model_config = {"from_attributes": True}


class ReferrerSummary(BaseModel):
    """Minimal referrer info returned on self-registration."""

    id: int
    name: str
    family_limit: int
    family_invite_code: str | None = None
    deleted_at: datetime | None = None

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

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return sanitize_plain_text(v)


class ReferrerUpdate(BaseModel):
    """Referrer self-service update — family_limit is not allowed."""

    name: Optional[str] = Field(None, min_length=1, max_length=60)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=20)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class AdminReferrerUpdate(ReferrerUpdate):
    """Admin-only: extends ReferrerUpdate with family_limit."""

    family_limit: Optional[int] = Field(None, ge=1, le=999)


class ReferrerDetail(BaseModel):
    id: int
    name: str
    family_limit: int
    phone_number: str
    family_invite_code: str | None = None
    family_count: int
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class ReferrerListResponse(BaseModel):
    referrers: list[ReferrerSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Admin CRUD schemas — Families
# ---------------------------------------------------------------------------


class FamilyCreate(BaseModel):
    referrer_id: int | None = None
    family_name: str = Field(..., min_length=1, max_length=40)
    family_wish: str = Field(..., min_length=1, max_length=400)
    contact_name: str = Field(..., min_length=1, max_length=40)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)

    @field_validator("family_name", "family_wish", "contact_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class FamilyUpdate(BaseModel):
    family_name: Optional[str] = Field(None, min_length=1, max_length=40)
    family_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    contact_name: Optional[str] = Field(None, min_length=1, max_length=40)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)

    @field_validator("family_name", "family_wish", "contact_name", "bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class AdminFamilyUpdate(FamilyUpdate):
    """Admin-only: extends FamilyUpdate with referrer_id.

    Send ``0`` to unassign a referrer (set referrer_id to NULL).
    """

    referrer_id: Optional[int] = None


class FamilyDetail(BaseModel):
    id: int
    referrer_id: int | None
    family_name: str
    bio: Optional[str]
    address: Optional[str]
    phone_number: Optional[str]
    family_wish: str
    contact_name: str
    approval_status: FamilyApprovalStatus
    deleted_at: datetime | None
    person_count: int

    model_config = {"from_attributes": True}


class FamilySummary(BaseModel):
    id: int
    family_name: str
    family_wish: str
    contact_name: str
    referrer_id: int | None
    approval_status: FamilyApprovalStatus
    deleted_at: datetime | None
    person_count: int = 0

    model_config = {"from_attributes": True}


class PendingFamilySummary(BaseModel):
    """Like FamilySummary but adds approval_status and created_at for the approval queue."""

    id: int
    family_name: str
    family_wish: str
    contact_name: str
    approval_status: FamilyApprovalStatus
    person_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class FamilySelfRegisterResponse(BaseModel):
    """Returned when a family self-registers via invite."""

    user: UserResponse
    family: FamilySummary


class FamilyListResponse(BaseModel):
    families: list[FamilySummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


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

    @field_validator("given_name", "practical_wish", "fun_wish")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class PersonUpdate(BaseModel):
    given_name: Optional[str] = Field(None, min_length=1, max_length=40)
    age: Optional[int] = Field(None, ge=0, le=200)
    practical_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    fun_wish: Optional[str] = Field(None, min_length=1, max_length=400)
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)

    @field_validator("given_name", "practical_wish", "fun_wish", "title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class PersonDetail(BaseModel):
    id: int
    family_id: int
    given_name: str
    title: Optional[str]
    age: int
    practical_wish: str
    fun_wish: str
    note: Optional[str]
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class PersonSummary(BaseModel):
    id: int
    family_id: int
    given_name: str
    age: int
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class PersonListResponse(BaseModel):
    people: list[PersonSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Self-service schemas (referrer / family — no FK IDs in body)
# ---------------------------------------------------------------------------


class FamilyCreateByReferrer(BaseModel):
    """Referrer creates a family — referrer_id is inferred from the session."""

    family_name: str = Field(..., min_length=1, max_length=40)
    family_wish: str = Field(..., min_length=1, max_length=400)
    contact_name: str = Field(..., min_length=1, max_length=40)
    bio: Optional[str] = None
    address: Optional[str] = Field(None, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=20)

    @field_validator("family_name", "family_wish", "contact_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class PersonCreateInFamily(BaseModel):
    """Create a person inside a family — family_id is inferred from the URL or session."""

    given_name: str = Field(..., min_length=1, max_length=40)
    age: int = Field(..., ge=0, le=200)
    practical_wish: str = Field(..., min_length=1, max_length=400)
    fun_wish: str = Field(..., min_length=1, max_length=400)
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)

    @field_validator("given_name", "practical_wish", "fun_wish")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)
