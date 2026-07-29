"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models import FamilyApprovalStatus, ReferrerApprovalStatus, UserRole
from app.user_validation import sanitize_plain_text, validate_email, validate_phone_number


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


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

    @field_validator("phone_number")
    @classmethod
    def check_phone(cls, v: str) -> str:
        validate_phone_number(v)
        return v


_NOT_PROVIDED = object()
"""Sentinel: field was not present in the JSON payload."""

_CLEAR = object()
"""Sentinel: field was sent as empty string — clear to NULL."""


class UpdateProfile(BaseModel):
    """Update the authenticated user's profile."""

    display_name: str | None | object = Field(default=_NOT_PROVIDED)  # type: ignore[assignment]

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, v: str | None | object) -> str | None | object:  # type: ignore[misc]
        if v is _NOT_PROVIDED:
            return v
        if v is None:
            return v  # null → no-op (handled in to_update_dict)
        if isinstance(v, str) and v == "":
            return _CLEAR  # "" → clear to NULL
        if isinstance(v, str) and len(v) > 40:
            raise ValueError("display_name must be 40 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v

    def to_update_dict(self) -> dict:
        """Return only fields that should be written to the DB.

        * Field omitted → excluded (no-op)
        * Field sent as ``null`` → excluded (no-op)
        * Field sent as ``""`` → included as ``None`` (clear)
        * Field sent as ``"Name"`` → included as the string
        """
        result: dict[str, str | None] = {}
        dn = self.display_name
        if dn is _CLEAR:
            result["display_name"] = None
        elif dn is not _NOT_PROVIDED and dn is not None:
            result["display_name"] = dn  # type: ignore[assignment]
        return result


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
    phone_number: str = Field(..., min_length=1, max_length=20)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("family_name", "family_wish", "contact_name", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("phone_number")
    @classmethod
    def check_phone(cls, v: str) -> str:
        validate_phone_number(v)
        return v


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class UserResponse(BaseModel):
    """Public user profile — never exposes the password hash."""

    id: int
    email: str
    role: UserRole
    display_name: Optional[str] = None
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReferrerInviteResponse(BaseModel):
    """Returned when admin creates an invite."""

    code: str
    family_limit: int
    locked_email: str | None = None
    expires_at: datetime
    created_at: datetime
    email_sent: bool | None = None
    email_send_reason: str | None = None

    model_config = {"from_attributes": True}


class ReferrerSummary(BaseModel):
    """Minimal referrer info returned on self-registration and list views."""

    id: int
    name: str
    family_limit: int
    family_invite_code: str
    approval_status: ReferrerApprovalStatus
    approved_by_admin_name: str | None = None
    approved_at: datetime | None = None
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

    @field_validator("phone_number")
    @classmethod
    def check_phone(cls, v: str) -> str:
        validate_phone_number(v)
        return v


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

    @field_validator("phone_number", mode="before")
    @classmethod
    def check_phone(cls, v: str | None) -> str | None:
        if v is not None:
            validate_phone_number(v)
        return v


class AdminReferrerUpdate(ReferrerUpdate):
    """Admin-only: extends ReferrerUpdate with family_limit."""

    family_limit: Optional[int] = Field(None, ge=1, le=999)


class ReferrerDetail(BaseModel):
    id: int
    name: str
    family_limit: int
    phone_number: str
    family_invite_code: str
    family_count: int
    approval_status: ReferrerApprovalStatus
    approved_by_admin_name: str | None = None
    approved_at: datetime | None = None
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class SendFamilyInviteRequest(BaseModel):
    """Referrer sends a family invite email to a given address."""

    email: str

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


class SendFamilyInviteResponse(BaseModel):
    """Response from the send-family-invite endpoint."""

    email_sent: bool
    email_send_reason: str | None = None


class ReferrerListResponse(BaseModel):
    referrers: list[ReferrerSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


class ReferrerInviteSummary(BaseModel):
    """Invite token summary for admin list/detail views."""

    id: int
    code: str
    family_limit: int
    locked_email: str | None = None
    expires_at: datetime
    created_at: datetime
    created_by_admin_name: str | None = None
    redeemed: bool = False
    redeemed_by_referrer_name: str | None = None
    referrer_approval_status: ReferrerApprovalStatus | None = None

    model_config = {"from_attributes": True}


class InviteListResponse(BaseModel):
    invites: list[ReferrerInviteSummary]
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
    phone_number: str = Field(..., min_length=1, max_length=20)

    @field_validator("family_name", "family_wish", "contact_name", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("phone_number")
    @classmethod
    def check_phone(cls, v: str) -> str:
        validate_phone_number(v)
        return v


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

    @field_validator("phone_number", mode="before")
    @classmethod
    def _phone_number_validate(cls, v: str | None) -> str | None:
        if v == "":
            raise ValueError("phone_number cannot be empty")
        if v is not None:
            validate_phone_number(v)
            return sanitize_plain_text(v)
        return v


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
    phone_number: str
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
    created_at: datetime

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
# Admin CRUD schemas — Users
# ---------------------------------------------------------------------------


class AdminUserCreate(BaseModel):
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

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class AdminUserUpdate(BaseModel):
    """Admin-only: partial update for a user.

    No password field — password changes go through the dedicated reset endpoint.
    """

    display_name: Optional[str] = Field(None, max_length=40)
    role: Optional[UserRole] = None
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class UserPasswordReset(BaseModel):
    """Admin-only: reset a user's password via the dedicated endpoint."""

    password: str = Field(..., min_length=8)


class UserDetail(BaseModel):
    """User detail response, including joined names."""

    id: int
    email: str
    display_name: Optional[str] = None
    role: UserRole
    referrer_id: Optional[int] = None
    family_id: Optional[int] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime
    referrer_name: Optional[str] = None
    family_name: Optional[str] = None

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    users: list[UserDetail]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Public wish-list schemas
# ---------------------------------------------------------------------------


class PersonWishItem(BaseModel):
    """Single person on the public wish list."""

    given_name: str
    title: str | None = None
    age: int
    practical_wish: str
    fun_wish: str
    note: str | None = None

    model_config = {"from_attributes": True}


class FamilyWishListResponse(BaseModel):
    """Public family wish list (family info + per-person wishes)."""

    family_name: str
    bio: str | None = None
    family_wish: str
    people: list[PersonWishItem]


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
    phone_number: str = Field(..., min_length=1, max_length=20)

    @field_validator("family_name", "family_wish", "contact_name", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio", "address")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("phone_number")
    @classmethod
    def check_phone(cls, v: str) -> str:
        validate_phone_number(v)
        return v


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
