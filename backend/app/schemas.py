"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_serializer, model_validator

from app.models import (
    CommitmentType,
    EmailKind,
    EmailStatus,
    FamilyApprovalStatus,
    ReferrerApprovalStatus,
    UserRole,
    WishLockLevel,
    WishType,
)
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
            raise ValueError("display_name cannot be empty")
        if isinstance(v, str) and len(v) > 40:
            raise ValueError("display_name must be 40 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v

    def to_update_dict(self) -> dict:
        """Return only fields that should be written to the DB.

        * Field omitted → excluded (no-op)
        * Field sent as ``null`` → excluded (no-op)
        * Field sent as ``"Name"`` → included as the string
        * Field sent as ``""`` → rejected (display_name is non-nullable)
        """
        result: dict[str, str | None] = {}
        dn = self.display_name
        if dn is not _NOT_PROVIDED and dn is not None:
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
    display_name: str
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
    email_error: str | None = None

    model_config = {"from_attributes": True}


class ReferrerSummary(BaseModel):
    """Minimal referrer info returned on self-registration and list views."""

    id: int
    name: str
    family_limit: int
    family_count: int = 0
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
# Dropdown schemas — minimal {id, name} for select inputs
# ---------------------------------------------------------------------------


class UserDropdownItem(BaseModel):
    """Minimal user entry for dropdown selects."""

    id: int
    display_name: str

    model_config = {"from_attributes": True}


class ReferrerDropdownItem(BaseModel):
    """Minimal referrer entry for dropdown selects."""

    id: int
    name: str

    model_config = {"from_attributes": True}


class FamilyDropdownItem(BaseModel):
    """Minimal family entry for dropdown selects."""

    id: int
    family_name: str

    model_config = {"from_attributes": True}


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
    invite_count: int | None = None
    approval_status: ReferrerApprovalStatus
    approved_by_admin_name: str | None = None
    approved_at: datetime | None = None
    created_at: datetime
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
    """Response from the send-family-invite endpoint.

    Failures are communicated via HTTP status codes (429, 500).
    A 200 response means the email was sent successfully.
    """

    message: str = "Invite email sent successfully."


class ReferrerListResponse(BaseModel):
    referrers: list[ReferrerDetail]
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


class ReferrerInviteEmailItem(BaseModel):
    """Referrer-facing history entry for one family invite email attempt.

    All statuses are included (sent / failed / reset) — the referrer can see
    what happened to each address they invited.
    """

    id: int
    recipient_email: str
    status: EmailStatus
    failure_reason: str | None = None
    sent_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Admin sent-email log schemas
# ---------------------------------------------------------------------------


class SentEmailSummary(BaseModel):
    """Sent-email log entry for the admin log view."""

    id: int
    recipient_email: str
    kind: EmailKind
    status: EmailStatus
    failure_reason: str | None = None
    sent_at: datetime
    sender_name: str | None = None

    model_config = {"from_attributes": True}


class EmailListResponse(BaseModel):
    emails: list[SentEmailSummary]
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
    pickup_window: Optional[datetime] = None

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
    pickup_window: datetime | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("pickup_window", mode="before")
    @classmethod
    def _pickup_window_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        return v

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


class ReferrerFamilyUpdate(FamilyUpdate):
    """Referrer: extends FamilyUpdate with referrer_notes.

    Referrer notes are internal metadata visible only to referrers and admins.
    Sending ``""`` clears the notes to NULL.
    """

    referrer_notes: str | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("referrer_notes", mode="before")
    @classmethod
    def _referrer_notes_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str) and len(v) > 1000:
            raise ValueError("referrer_notes must be 1000 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v


class AdminFamilyUpdate(FamilyUpdate):
    """Admin-only: extends FamilyUpdate with referrer_id, referrer_notes, and delivery_user_id.

    Send ``0`` to unassign a referrer or delivery person (set FK to NULL).
    """

    referrer_id: Optional[int] = None
    referrer_notes: str | None | object = Field(default=None)  # type: ignore[assignment]
    delivery_user_id: Optional[int] = None

    @field_validator("referrer_notes", mode="before")
    @classmethod
    def _referrer_notes_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str) and len(v) > 1000:
            raise ValueError("referrer_notes must be 1000 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v


class FamilyDetail(BaseModel):
    id: int
    referrer_id: int | None
    referrer_name: Optional[str] = None
    delivery_user_id: int | None = None
    delivery_user_name: Optional[str] = None
    display_id: str | None = None
    family_name: str
    bio: Optional[str] = None
    address: Optional[str] = None
    phone_number: str
    family_wish: str
    contact_name: str
    approval_status: FamilyApprovalStatus
    pickup_window: datetime | None = None
    deleted_at: datetime | None = None
    person_count: int
    wish_lock_level: WishLockLevel
    wish_review_requested_at: datetime | None = None
    wish_rejection_reason: Optional[str] = None
    referrer_notes: str | None = None
    # Claim info for admin families table
    claim_status: str | None = None
    claim_commitment_type: str | None = None
    claim_donor_name: str | None = None
    claim_id: int | None = None

    model_config = {"from_attributes": True}


class FamilySelfServiceDetail(BaseModel):
    """Family detail for family self-service — excludes referrer_notes."""

    id: int
    referrer_id: int | None
    referrer_name: Optional[str] = None
    display_id: str
    family_name: str
    bio: Optional[str]
    address: Optional[str]
    phone_number: str
    family_wish: str
    contact_name: str
    approval_status: FamilyApprovalStatus
    pickup_window: datetime | None = None
    deleted_at: datetime | None
    person_count: int
    wish_lock_level: WishLockLevel
    wish_review_requested_at: datetime | None = None
    wish_rejection_reason: Optional[str] = None

    model_config = {"from_attributes": True}


class FamilySummary(BaseModel):
    id: int
    display_id: str
    family_name: str
    family_wish: str
    contact_name: str
    referrer_id: int | None
    delivery_user_id: int | None = None
    delivery_user_name: Optional[str] = None
    approval_status: FamilyApprovalStatus
    pickup_window: datetime | None = None
    deleted_at: datetime | None
    person_count: int = 0
    wish_lock_level: WishLockLevel
    wish_review_requested_at: datetime | None = None
    wish_rejection_reason: Optional[str] = None
    has_notes: bool = False

    model_config = {"from_attributes": True}


class FamilyReviewRequest(BaseModel):
    """Body for reject-wishes endpoints carrying the rejection reason."""

    reason: str = Field(..., min_length=1, max_length=400)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, v: str) -> str:
        return sanitize_plain_text(v)


class FamilyReviewList(BaseModel):
    """Review queue item for referrer and admin review list endpoints."""

    id: int
    display_id: str
    family_name: str
    contact_name: str
    referrer_id: int | None = None
    referrer_name: Optional[str] = None
    person_count: int = 0
    wish_review_requested_at: datetime
    wish_rejection_reason: Optional[str] = None


class PendingFamilySummary(BaseModel):
    """Like FamilySummary but adds approval_status and created_at for the approval queue."""

    id: int
    display_id: str
    family_name: str
    family_wish: str
    contact_name: str
    approval_status: FamilyApprovalStatus
    pickup_window: datetime | None = None
    person_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class FamilySelfRegisterResponse(BaseModel):
    """Returned when a family self-registers via invite."""

    user: UserResponse
    family: FamilySummary


class FamilyListResponse(BaseModel):
    families: list[FamilyDetail]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Wish schemas
# ---------------------------------------------------------------------------


class WishCreate(BaseModel):
    """Create a single wish for a person (person_id inferred from route)."""

    type: WishType
    description: str = Field(..., min_length=1, max_length=60)
    size: str | None = Field(None, max_length=20)

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("size")
    @classmethod
    def normalize_size(cls, v: str | None) -> str | None:
        """Map empty string or '0' to None (N/A size)."""
        if v is None or v == "" or v == "0":
            return None
        return sanitize_plain_text(v)


class WishUpdate(BaseModel):
    """Partial update for a wish."""

    type: WishType | None = None
    description: Optional[str] = Field(None, min_length=1, max_length=60)
    size: Optional[str] = Field(None, max_length=20)

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("size", mode="before")
    @classmethod
    def normalize_size(cls, v: str | None) -> str | None:
        """Map empty string or '0' to None (N/A size)."""
        if v is None or v == "" or v == "0":
            return None
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v


class WishSummary(BaseModel):
    """Compact wish representation embedded in person responses."""

    id: int
    type: WishType
    description: str
    size: str | None = None
    assigned_to_id: int | None = None
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None = None
    purchaser_note: str | None = None

    model_config = {"from_attributes": True}


class WishDetail(WishSummary):
    """Full wish with person info."""

    person_id: int
    person_given_name: str | None = None
    person_family_name: str | None = None


class AdminWishUpdate(BaseModel):
    """Admin-only partial update for a wish.

    Includes definition fields (type, description, size) and
    purchase-tracking fields (assigned_to_id, purchased_at, purchased_where,
    received_at, purchaser_note).
    """

    type: WishType | None = None
    description: Optional[str] = Field(None, min_length=1, max_length=60)
    size: Optional[str] = Field(None, max_length=20)
    assigned_to_id: int | None | object = Field(default=None)  # type: ignore[assignment]
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None | object = Field(default=None)  # type: ignore[assignment]
    purchaser_note: str | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("size", mode="before")
    @classmethod
    def normalize_size(cls, v: str | None) -> str | None:
        """Map empty string or '0' to None (N/A size)."""
        if v is None or v == "" or v == "0":
            return None
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v

    @field_validator("assigned_to_id", mode="before")
    @classmethod
    def _assigned_to_id_validate(cls, v):
        if isinstance(v, int) and v == 0:
            return _CLEAR
        return v

    @field_validator("received_at", mode="before")
    @classmethod
    def _received_at_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        return v

    @field_validator("purchaser_note", mode="before")
    @classmethod
    def _purchaser_note_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        return v


class WishPurchaseMark(BaseModel):
    """Body for the mark-purchased endpoint."""

    purchased_where: str | None = None
    purchaser_note: str | None | object = Field(default=None)  # type: ignore[assignment]
    received_at: datetime | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("purchaser_note", mode="before")
    @classmethod
    def _purchaser_note_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v

    @field_validator("received_at", mode="before")
    @classmethod
    def _received_at_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        return v


class WishBatchAssign(BaseModel):
    """Batch-assign multiple wishes to a user.

    Set *assigned_to_id* to ``0`` to unassign the selected wishes.
    """

    wish_ids: list[int] = Field(..., min_length=1)
    assigned_to_id: int


class WishListSummary(BaseModel):
    """Flat wish summary for the admin list view."""

    id: int
    type: WishType
    description: str
    size: str | None = None
    person_id: int
    person_given_name: str
    family_id: int
    assigned_to_id: int | None = None
    assigned_to_name: str | None = None
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None = None
    purchaser_note: str | None = None


class WishListResponse(BaseModel):
    """Paginated wish list response."""

    wishes: list[WishListSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


class PurchaserWishSummary(BaseModel):
    """Wish summary for purchaser self-service views.

    Includes wish details, person context, and family context for wishlist
    linking: ``family_id`` (DB key for the route), ``family_display_id``
    (presentational, unscoped flat format — same as the public wish-list
    heading), and ``wish_lock_level`` (gates the public wishlist link on
    admin lock; the public endpoint 404s for non-admin-locked families).
    No PII (family_name, contact_name, phone_number excluded).
    """

    id: int
    type: WishType
    description: str
    size: str | None = None
    person_id: int
    person_given_name: str
    family_id: int
    family_display_id: str = "0"
    wish_lock_level: WishLockLevel | None = None
    assigned_to_id: int | None = None
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None = None
    purchaser_note: str | None = None


class PurchaserWishUpdate(BaseModel):
    """Partial update for a wish by a purchaser.

    Purchasers can only update purchaser_note and received_at.
    Uses exclude_unset=True so omitted fields are no-ops.
    """

    purchaser_note: str | None | object = Field(default=None)  # type: ignore[assignment]
    received_at: datetime | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("purchaser_note", mode="before")
    @classmethod
    def _purchaser_note_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v

    @field_validator("received_at", mode="before")
    @classmethod
    def _received_at_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        return v


class PurchaserWishListResponse(BaseModel):
    """Paginated wish list response for purchaser views."""

    wishes: list[PurchaserWishSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


def validate_wish_list(wishes: list[WishCreate]) -> None:
    """Validate non-empty wish list with no duplicate types."""
    if not wishes:
        raise ValueError("At least one wish is required")
    types = {w.type for w in wishes}
    if len(types) != len(wishes):
        raise ValueError("Duplicate wish types in batch")


def validate_wishes_for_age(wishes: list[WishCreate], age: int) -> None:
    """Validate that wishes match the person's age.

    Raises ValueError with a descriptive message on failure.
    """
    types = {w.type for w in wishes}
    if age >= 18:
        if types != {WishType.adult}:
            raise ValueError(f"Adult (age {age}) must have exactly one 'adult' wish. Got: {sorted(types)}")
    else:
        if types != {WishType.practical, WishType.fun}:
            raise ValueError(f"Child (age {age}) must have one 'practical' and one 'fun' wish. Got: {sorted(types)}")


# ---------------------------------------------------------------------------
# Admin CRUD schemas — People
# ---------------------------------------------------------------------------


class PersonCreate(BaseModel):
    family_id: int
    given_name: str = Field(..., min_length=1, max_length=40)
    age: int = Field(..., ge=0, le=200)
    wishes: list[WishCreate]
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)

    @field_validator("given_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("wishes")
    @classmethod
    def validate_wishes(cls, v: list[WishCreate], info) -> list[WishCreate]:
        validate_wish_list(v)
        age = info.data.get("age")
        if age is not None:
            validate_wishes_for_age(v, age)
        return v


class PersonUpdate(BaseModel):
    given_name: Optional[str] = Field(None, min_length=1, max_length=40)
    age: Optional[int] = Field(None, ge=0, le=200)
    wishes: list[WishCreate] | None = None
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)

    @field_validator("given_name", "title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("wishes")
    @classmethod
    def validate_wishes(cls, v: list[WishCreate] | None) -> list[WishCreate] | None:
        if v is None:
            return v
        validate_wish_list(v)
        return v

    @model_validator(mode="after")
    def _validate_wishes_match_age(self) -> "PersonUpdate":
        """When both age and wishes are sent, validate they match.

        If only wishes are sent (no age), validation happens in the route
        handler against the existing person's age.
        """
        if self.wishes is not None and self.age is not None:
            validate_wishes_for_age(self.wishes, self.age)
        return self


class PersonDetail(BaseModel):
    id: int
    family_id: int
    display_id: str | None = None
    given_name: str
    title: Optional[str] = None
    age: int
    note: Optional[str] = None
    created_at: datetime
    deleted_at: datetime | None = None
    wishes: list[WishSummary] = []

    model_config = {"from_attributes": True}


class PersonListResponse(BaseModel):
    people: list[PersonDetail]
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
    ``display_name`` cannot be cleared (non-nullable column).
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
        if v == "":
            raise ValueError("display_name cannot be empty")
        return sanitize_plain_text(v)


class UserPasswordReset(BaseModel):
    """Admin-only: reset a user's password via the dedicated endpoint."""

    password: str = Field(..., min_length=8)


class UserDetail(BaseModel):
    """User detail response, including joined names."""

    id: int
    email: str
    display_name: str
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
# Public families list schemas
# ---------------------------------------------------------------------------


class PublicFamilySummary(BaseModel):
    """Minimal family info for the public browse page.

    Excludes all PII (family_name, contact_name, phone_number, address).
    Only ``display_id`` is exposed so donors can identify the family anonymously.
    """

    id: int
    display_id: str
    bio: str | None = None
    person_count: int
    min_age: int | None = None
    max_age: int | None = None
    claimed_by_current_user: bool = False

    model_config = {"from_attributes": True}


class PublicFamilyListResponse(BaseModel):
    """Paginated public families list response."""

    families: list[PublicFamilySummary]
    total: int = 0
    page: int = 1
    page_size: int = 12
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Public wish-list schemas
# ---------------------------------------------------------------------------


class PersonWishItem(BaseModel):
    """Single person on the public wish list."""

    given_name: str
    title: str | None = None
    age: int
    note: str | None = None
    wishes: list[WishSummary] = []

    model_config = {"from_attributes": True}


class FamilyWishListResponse(BaseModel):
    """Public family wish list (family info + per-person wishes).

    Note: ``family_name`` is intentionally excluded for privacy / legal compliance.
    Only ``display_id`` is exposed so donors can identify the family anonymously.
    """

    display_id: str
    bio: str | None = None
    family_wish: str
    people: list[PersonWishItem]
    claimed_by_current_user: bool = False
    claim_status: str | None = None
    claim_id: int | None = None


# ---------------------------------------------------------------------------
# Packing slip schemas
# ---------------------------------------------------------------------------


class PackingSlipPersonItem(BaseModel):
    """Single person on a packing slip (no PII beyond given_name)."""

    display_id: str
    given_name: str
    title: str | None = None
    age: int
    note: str | None = None
    wishes: list[WishSummary] = []


class PackingSlipItem(BaseModel):
    """One family on a packing slip (no family_name/contact_name/bio)."""

    id: int
    display_id: str
    family_wish: str
    people: list[PackingSlipPersonItem] = []


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
    wishes: list[WishCreate]
    title: Optional[str] = Field(None, max_length=40)
    note: Optional[str] = Field(None, max_length=400)

    @field_validator("given_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("title", "note")
    @classmethod
    def clean_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)

    @field_validator("wishes")
    @classmethod
    def validate_wishes(cls, v: list[WishCreate], info) -> list[WishCreate]:
        validate_wish_list(v)
        age = info.data.get("age")
        if age is not None:
            validate_wishes_for_age(v, age)
        return v


# ---------------------------------------------------------------------------
# Donor self-registration schemas
# ---------------------------------------------------------------------------


class DonorSelfRegister(BaseModel):
    """Public: donor self-registration (open, no invite code required)."""

    display_name: str = Field(..., min_length=1, max_length=40)
    email: str = Field(..., min_length=1, max_length=120)
    password: str = Field(..., min_length=8)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, v: str) -> str:
        return sanitize_plain_text(v)


class DonorSelfRegisterResponse(BaseModel):
    """Returned when a donor self-registers."""

    user: UserResponse


# ---------------------------------------------------------------------------
# Donor claim schemas
# ---------------------------------------------------------------------------


class FamilyClaimSummary(BaseModel):
    """Compact claim representation for list views."""

    id: int
    family: dict  # {id, display_id, bio, person_count, min_age, max_age}
    commitment_type: CommitmentType
    notes: str | None = None
    created_at: datetime
    fulfilled_at: datetime | None = None
    email_error: str | None = None

    model_config = {"from_attributes": True}

    @model_serializer(mode="wrap")
    def _serialize(self, handler):
        result = handler(self)
        if self.email_error is None:
            result.pop("email_error", None)
        return result


class FamilyClaimDetail(BaseModel):
    """Full claim detail with wish list."""

    id: int
    family: dict  # {id, display_id, bio, person_count, min_age, max_age}
    commitment_type: CommitmentType
    notes: str | None = None
    created_at: datetime
    fulfilled_at: datetime | None = None
    donor_user_id: int
    donor_display_name: str
    people: list[PersonWishItem] = []

    model_config = {"from_attributes": True}


class FamilyClaimCreate(BaseModel):
    """Body for creating a family claim."""

    commitment_type: CommitmentType


class FamilyClaimUpdate(BaseModel):
    """Non-admin partial update for a claim.

    No status field — only owner or admin can modify, and status changes
    go through dedicated endpoints (fulfill, cancel).
    """

    commitment_type: CommitmentType | None = None
    notes: str | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("notes", mode="before")
    @classmethod
    def _notes_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str) and len(v) > 500:
            raise ValueError("notes must be 500 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v


class DonorWishPurchaseMark(BaseModel):
    """Body for marking a wish purchased by a donor.

    Like WishPurchaseMark but **no received_at** — that's set by delivery.
    """

    purchased_where: str | None = None
    purchaser_note: str | None | object = Field(default=None)  # type: ignore[assignment]

    @field_validator("purchaser_note", mode="before")
    @classmethod
    def _purchaser_note_validate(cls, v):
        if isinstance(v, str) and v == "":
            return _CLEAR
        if isinstance(v, str):
            return sanitize_plain_text(v)
        return v
