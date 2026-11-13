"""Pydantic request/response schemas."""

from datetime import date, datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_serializer,
    model_validator,
)

from app.models import (
    ADDRESS_MAX_LENGTH,
    ClaimPaymentStatus,
    CommitmentType,
    CONTACT_NAME_MAX_LENGTH,
    DeadlineMode,
    DeadlineType,
    DISPLAY_NAME_MAX_LENGTH,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    EmailCampaignStatus,
    EmailKind,
    EmailStatus,
    FAMILY_BIO_MAX_LENGTH,
    FAMILY_NAME_MAX_LENGTH,
    FamilyVerificationStatus,
    GIVEN_NAME_MAX_LENGTH,
    PERSON_NOTE_MAX_LENGTH,
    PHONE_NUMBER_MAX_LENGTH,
    PersonRole,
    REFERRER_NAME_MAX_LENGTH,
    ReferrerApprovalStatus,
    UserRole,
    WISH_COLOR_MAX_LENGTH,
    WISH_DESCRIPTION_MAX_LENGTH,
    WISH_SIZE_MAX_LENGTH,
    WishLockLevel,
    WishType,
)
from app.auth import PASSWORD_MAX_LENGTH
from app.user_validation import MAX_EMAIL_LENGTH, sanitize_plain_text, validate_email, validate_phone_number


def _validate_password_bytes(value: str) -> str:
    """Reject passwords whose UTF-8 encoding exceeds bcrypt's 72-byte limit."""
    if len(value.encode("utf-8")) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must be 8-{PASSWORD_MAX_LENGTH} characters")
    return value


# Password for auth endpoints: 8-72 characters, and at most 72 UTF-8 bytes (bcrypt limit).
PasswordField = Annotated[
    str,
    StringConstraints(min_length=8, max_length=PASSWORD_MAX_LENGTH),
    AfterValidator(_validate_password_bytes),
]


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
    new_password: PasswordField


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
    new_password: PasswordField


class ReferrerInviteCreate(BaseModel):
    """Admin: create an invite token."""

    family_limit: int = Field(..., ge=1, le=999)
    email: str | None = Field(None, max_length=MAX_EMAIL_LENGTH)
    email_message: str | None = Field(None, max_length=5000)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_email(v)

    @field_validator("email_message")
    @classmethod
    def clean_email_message(cls, v: str | None) -> str | None:
        """Strip surrounding whitespace; blank values fall back to the default email message."""
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class ReferrerSelfRegister(BaseModel):
    """Public: redeem an invite code to register as a referrer."""

    code: str
    name: str = Field(..., min_length=1, max_length=REFERRER_NAME_MAX_LENGTH)
    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)
    phone_number: str = Field(..., min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)
    password: PasswordField

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


_CLEAR = object()
"""Sentinel: field was sent as empty string — clear to NULL."""


def _validate_nullable_datetime(v):
    """Before-validator for ``datetime | None | object`` partial-update fields.

    Maps ``''`` to the ``_CLEAR`` sentinel and parses any other string into
    a ``datetime``; anything that can't be a valid datetime is rejected.
    The ``object`` union member would otherwise carry any value through
    validation untouched (a valid string stays a string all the way to the
    DB), so bad input would surface as a 500 when Postgres tries to cast
    it — with this guard it 422s here instead.
    """
    if v is None:
        return v
    if isinstance(v, str):
        if v == "":
            return _CLEAR
        try:
            return datetime.fromisoformat(v)
        except ValueError:
            raise ValueError("must be an ISO 8601 datetime (e.g. 2026-02-14T09:30:00Z)") from None
    if isinstance(v, datetime):
        return v
    raise ValueError("must be an ISO 8601 datetime (e.g. 2026-02-14T09:30:00Z)")


def clearable_text(max_length: int, zero_as_clear: bool = False):
    """Field type for a clearable partial-update text field.

    Omitted or ``null`` → no-op; ``""`` → :data:`_CLEAR` (clear to NULL);
    with *zero_as_clear* also ``"0"`` → ``_CLEAR`` (the UI's N/A marker for
    wish size/color — it is not a storable value there).

    Non-string input and over-length input 422. Both are enforced in the
    validator rather than as field constraints because the ``object`` union
    member (which exists only to carry the sentinel) would let any junk
    value through validation and reach the DB.
    """

    def _validate(v: Any, info: ValidationInfo) -> Any:
        if v is None:
            return v
        if not isinstance(v, str):
            raise ValueError(f"{info.field_name} must be a string")
        if v == "" or (zero_as_clear and v == "0"):
            return _CLEAR
        if len(v) > max_length:
            raise ValueError(f"{info.field_name} must be {max_length} characters or fewer")
        return sanitize_plain_text(v)

    return Annotated[str | None | object, Field(default=None), BeforeValidator(_validate)]


def clearable_datetime():
    """Field type for a clearable partial-update datetime field.

    Omitted or ``null`` → no-op; ``""`` → :data:`_CLEAR` (clear to NULL);
    ISO-8601 strings parse to datetime; anything else 422s (see
    :func:`_validate_nullable_datetime`).
    """
    return Annotated[datetime | None | object, Field(default=None), BeforeValidator(_validate_nullable_datetime)]


def _validate_nullable_date(v):
    """Before-validator for ``date | None | object`` partial-update fields.

    Maps ``''`` to the ``_CLEAR`` sentinel and parses any other string into
    a ``date``; anything that can't be a valid ISO date is rejected. A
    ``datetime`` is rejected explicitly (it is a ``date`` subclass and
    would otherwise be stored truncated).
    """
    if v is None:
        return v
    if isinstance(v, str):
        if v == "":
            return _CLEAR
        try:
            return date.fromisoformat(v)
        except ValueError:
            raise ValueError("must be an ISO 8601 date (e.g. 2026-12-15)") from None
    if isinstance(v, datetime):
        raise ValueError("must be an ISO 8601 date (e.g. 2026-12-15)")
    if isinstance(v, date):
        return v
    raise ValueError("must be an ISO 8601 date (e.g. 2026-12-15)")


def clearable_date():
    """Field type for a clearable partial-update date field.

    Omitted or ``null`` → no-op; ``""`` → :data:`_CLEAR` (clear to NULL);
    ISO-8601 date strings parse to ``date``; anything else 422s (see
    :func:`_validate_nullable_date`).
    """
    return Annotated[date | None | object, Field(default=None), BeforeValidator(_validate_nullable_date)]


def clearable_fk():
    """Field type for a clearable partial-update FK field.

    Omitted or ``null`` → no-op; ``0`` → :data:`_CLEAR` (clear the FK to
    NULL — ids are SERIAL starting at 1, so 0 is never a valid id);
    non-integer input 422s. Booleans are an ``int`` subclass in Python and
    are rejected explicitly — without the check they would ride the
    ``object`` union member through to the route's target-existence query.
    """

    def _validate(v: Any, info: ValidationInfo) -> Any:
        if v is None:
            return v
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError(f"{info.field_name} must be an integer")
        if v == 0:
            return _CLEAR
        return v

    return Annotated[int | None | object, Field(default=None), BeforeValidator(_validate)]


class UpdateProfile(BaseModel):
    """Update the authenticated user's profile."""

    display_name: str | None = None

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, v: str | None) -> str | None:
        if v is None:
            return v  # null → no-op (handled in to_update_dict)
        if isinstance(v, str) and v == "":
            raise ValueError("display_name cannot be empty")
        if isinstance(v, str) and len(v) > 40:
            raise ValueError("display_name must be 40 characters or fewer")
        if isinstance(v, str):
            return sanitize_plain_text(v)
        raise ValueError("display_name must be a string")

    def to_update_dict(self) -> dict:
        """Return only fields that should be written to the DB.

        * Field omitted → excluded (no-op)
        * Field sent as ``null`` → excluded (no-op)
        * Field sent as ``"Name"`` → included as the string
        * Field sent as ``""`` → rejected (display_name is non-nullable)
        * Field sent as non-string junk → rejected
        """
        result: dict[str, str | None] = {}
        dn = self.display_name
        if dn is not None:
            result["display_name"] = dn
        return result


class FamilySelfRegister(BaseModel):
    """Public: family self-registers via a referrer's family invite code."""

    code: str
    family_name: str = Field(..., min_length=1, max_length=FAMILY_NAME_MAX_LENGTH)
    family_wish: str = Field(..., min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    contact_name: str = Field(..., min_length=1, max_length=CONTACT_NAME_MAX_LENGTH)
    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)
    password: PasswordField
    bio: Optional[str] = Field(None, max_length=FAMILY_BIO_MAX_LENGTH)
    address: str = Field(..., min_length=1, max_length=ADDRESS_MAX_LENGTH)
    phone_number: str = Field(..., min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("family_name", "family_wish", "contact_name", "address", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio")
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
    name: str = Field(..., min_length=1, max_length=REFERRER_NAME_MAX_LENGTH)
    family_limit: int = Field(..., ge=1, le=999)
    phone_number: str = Field(..., min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)
    pickup_window: Optional[datetime] = None

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
    """Referrer self-service update — family_limit and pickup_window are admin-only."""

    name: Optional[str] = Field(None, min_length=1, max_length=REFERRER_NAME_MAX_LENGTH)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)

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
    """Admin-only: extends ReferrerUpdate with family_limit and pickup_window."""

    family_limit: Optional[int] = Field(None, ge=1, le=999)
    pickup_window: clearable_datetime()


class ReferrerDetail(BaseModel):
    id: int
    name: str
    family_limit: int
    phone_number: str
    pickup_window: datetime | None = None
    family_invite_code: str
    family_count: int
    invite_count: int | None = None
    # Admin-only recipient prefill: the referrer user's email.
    # Populated only by admin endpoints (null elsewhere, incl. referrer
    # self-service, which shares this schema).
    email: str | None = None
    approval_status: ReferrerApprovalStatus
    approved_by_admin_name: str | None = None
    approved_at: datetime | None = None
    created_at: datetime
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class SendFamilyInviteRequest(BaseModel):
    """Referrer sends a family invite email to a given address."""

    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)

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


class AdminSendEmailRequest(BaseModel):
    """Admin sends a freeform ("custom") email to any recipient.

    ``message`` is plain text, never HTML — the server renders it to
    escaped HTML paragraphs. A blank subject is replaced by the default
    subject server-side.
    """

    recipient_email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)
    subject: str | None = Field(None, max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)

    @field_validator("recipient_email")
    @classmethod
    def check_recipient_email(cls, v: str) -> str:
        return validate_email(v)

    @field_validator("message")
    @classmethod
    def check_message_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be blank")
        return v


class AdminSendEmailResult(BaseModel):
    """Outcome of an admin custom-email send attempt.

    ``reason`` is ``"unsubscribed"``, ``"invalid_address"``, or
    ``"smtp_error"`` when ``sent`` is False — mirrors ``send_email``'s
    return dict.
    """

    sent: bool
    reason: str | None = None


class EmailPreferenceSummary(BaseModel):
    """One row of the unsubscribe blocklist for the admin view."""

    email: str
    unsubscribed_at: datetime

    model_config = {"from_attributes": True}


class EmailPreferenceListResponse(BaseModel):
    preferences: list[EmailPreferenceSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


class AdminResubscribeRequest(BaseModel):
    """Admin re-subscribes a recipient (removes their unsubscribe record).

    The email is validated and normalized (strip + lower) to match
    ``check_unsubscribed``. It travels in the body — never the URL — so
    addresses don't leak into request access logs.
    """

    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        return validate_email(v)


# ---------------------------------------------------------------------------
# Admin email campaign (batch email) schemas
# ---------------------------------------------------------------------------


class CampaignSelection(BaseModel):
    """Recipient selection shared by the create and preview requests.

    ``roles`` + ``extra_emails`` — at least one is required. Every
    ``extra_emails`` entry is validated and normalized (strip + lower).
    """

    roles: list[UserRole] = Field(default_factory=list)
    extra_emails: list[Annotated[str, StringConstraints(max_length=MAX_EMAIL_LENGTH)]] = Field(default_factory=list)

    @field_validator("extra_emails")
    @classmethod
    def check_extra_emails(cls, v: list[str]) -> list[str]:
        for email in v:
            validate_email(email)
        return v

    @model_validator(mode="after")
    def check_has_recipients(self) -> "CampaignSelection":
        if not self.roles and not self.extra_emails:
            raise ValueError("Select at least one role or add at least one email address")
        return self


class AdminCampaignCreateRequest(CampaignSelection):
    """Admin creates an email campaign.

    Inherits the recipient selection (see ``CampaignSelection``).
    ``message`` is plain text, never HTML (same cap/renderer as the single
    custom email); a blank subject falls back to the default subject
    server-side.
    """

    subject: str | None = Field(None, max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)

    @field_validator("message")
    @classmethod
    def check_message_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be blank")
        return v


class AdminCampaignPreviewRequest(CampaignSelection):
    """Recipient selection for a campaign preview.

    Only the selection travels — subject/message are irrelevant to the
    resolved blast size, so the admin can preview before writing the body.
    """


class EmailCampaignPreviewResponse(BaseModel):
    """Resolved recipient counts for a campaign selection (no campaign created).

    ``by_role`` counts recipients whose source is the role resolution, keyed
    by role; ``manual`` counts explicit addresses. An address in both is
    counted once, in ``manual`` (the explicit entry wins).
    """

    total: int
    by_role: dict[str, int]
    manual: int


class EmailCampaignSummary(BaseModel):
    """Campaign row for the admin list/detail views.

    ``pending_count`` / ``canceled_count`` are derived from the recipient
    rows (the stored counters track only sent/failed).
    """

    id: int
    subject: str
    roles: list[str]
    status: EmailCampaignStatus
    total_recipients: int
    sent_count: int
    failed_count: int
    pending_count: int
    canceled_count: int
    created_at: datetime
    completed_at: datetime | None
    sender_name: str | None = None

    model_config = {"from_attributes": True}


class EmailCampaignDetail(EmailCampaignSummary):
    """Full campaign view — the summary plus the stored message body."""

    message: str


class EmailCampaignListResponse(BaseModel):
    campaigns: list[EmailCampaignSummary]


class EmailCampaignRecipientSummary(BaseModel):
    """One recipient row of a campaign (the delivery progress audit)."""

    id: int
    email: str
    source: EmailCampaignRecipientSource
    status: EmailCampaignRecipientStatus
    failure_reason: str | None = None
    sent_at: datetime | None = None
    # Account display name when the address belongs to a user — NULL for
    # manual addresses with no account.
    user_display_name: str | None = None

    model_config = {"from_attributes": True}


class EmailCampaignDetailResponse(BaseModel):
    """Campaign detail with its recipients as a paginated, column-filtered page."""

    campaign: EmailCampaignDetail
    recipients: list[EmailCampaignRecipientSummary]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


# ---------------------------------------------------------------------------
# Admin CRUD schemas — Families
# ---------------------------------------------------------------------------


class FamilyCreate(BaseModel):
    referrer_id: int | None = None
    family_name: str = Field(..., min_length=1, max_length=FAMILY_NAME_MAX_LENGTH)
    family_wish: str = Field(..., min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    contact_name: str = Field(..., min_length=1, max_length=CONTACT_NAME_MAX_LENGTH)
    bio: Optional[str] = Field(None, max_length=FAMILY_BIO_MAX_LENGTH)
    address: str = Field(..., min_length=1, max_length=ADDRESS_MAX_LENGTH)
    phone_number: str = Field(..., min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)
    # Admin-write only cash-only lock ("already shopping") — this is the admin
    # create schema; the referrer create schema (FamilyCreateByReferrer) never
    # carries the field.
    cash_only: Optional[bool] = None

    @field_validator("family_name", "family_wish", "contact_name", "address", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio")
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
    family_name: Optional[str] = Field(None, min_length=1, max_length=FAMILY_NAME_MAX_LENGTH)
    family_wish: Optional[str] = Field(None, min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    contact_name: Optional[str] = Field(None, min_length=1, max_length=CONTACT_NAME_MAX_LENGTH)
    bio: Optional[str] = Field(None, max_length=FAMILY_BIO_MAX_LENGTH)
    address: Optional[str] = Field(None, min_length=1, max_length=ADDRESS_MAX_LENGTH)
    phone_number: Optional[str] = Field(None, max_length=PHONE_NUMBER_MAX_LENGTH)

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

    referrer_notes: clearable_text(1000)


class AdminFamilyUpdate(FamilyUpdate):
    """Admin-only: extends FamilyUpdate with referrer_id, referrer_notes, and delivery_user_id.

    Send ``0`` to unassign a referrer or delivery person (set FK to NULL).

    ``cash_only`` locks the family to cash sponsorships (new gift claims
    blocked, donors see an "(already shopping)" marker). Admin-write only —
    deliberately NOT on the ``FamilyUpdate`` base, so referrer/family
    self-service payloads ignore it.
    """

    referrer_id: clearable_fk()
    referrer_notes: clearable_text(1000)
    delivery_user_id: clearable_fk()
    cash_only: Optional[bool] = None


class FamilyDetail(BaseModel):
    id: int
    referrer_id: int | None
    referrer_name: Optional[str] = None
    delivery_user_id: int | None = None
    delivery_user_name: Optional[str] = None
    display_id: str | None = None
    family_name: str
    bio: Optional[str] = None
    address: str
    phone_number: str
    # Optional: column-filtered list responses omit fields not requested
    # (the lookups are skipped too). Always present in detail responses.
    family_wish: str | None = None
    contact_name: str
    verification_status: FamilyVerificationStatus
    deleted_at: datetime | None = None
    person_count: int | None = None
    wish_lock_level: WishLockLevel
    wish_review_requested_at: datetime | None = None
    wish_rejection_reason: Optional[str] = None
    cash_only: bool = False
    referrer_notes: str | None = None
    # Admin-only recipient prefill: the family contact user's email.
    # Populated only by admin endpoints (null elsewhere, incl. referrer
    # self-service, which shares this schema).
    contact_email: str | None = None
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
    address: str
    phone_number: str
    family_wish: str
    contact_name: str
    verification_status: FamilyVerificationStatus
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
    verification_status: FamilyVerificationStatus
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
    """Like FamilySummary but adds verification_status and created_at for the verification queue."""

    id: int
    display_id: str
    family_name: str
    family_wish: str
    contact_name: str
    verification_status: FamilyVerificationStatus
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


def _normalize_size_or_color(v: str | None) -> str | None:
    """Normalize an optional size/color tag: ``None``/``""``/``"0"`` → ``None`` (N/A); other values sanitize.

    ``"0"`` is the UI's N/A marker for size/color. Used by the WishCreate
    ``normalize_size`` / ``normalize_color`` validators (create path —
    no ``_CLEAR`` sentinel).
    """
    if v is None or v == "" or v == "0":
        return None
    return sanitize_plain_text(v)


class WishCreate(BaseModel):
    """Create a single wish for a person (person_id inferred from route)."""

    type: WishType
    description: str = Field(..., min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    size: str | None = Field(None, max_length=WISH_SIZE_MAX_LENGTH)
    color: str | None = Field(None, max_length=WISH_COLOR_MAX_LENGTH)

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("size")
    @classmethod
    def normalize_size(cls, v: str | None) -> str | None:
        """Map empty string or '0' to None (N/A size)."""
        return _normalize_size_or_color(v)

    @field_validator("color")
    @classmethod
    def normalize_color(cls, v: str | None) -> str | None:
        """Map empty string or '0' to None (N/A color)."""
        return _normalize_size_or_color(v)


class WishUpdate(BaseModel):
    """Partial update for a wish.

    Size/color: omitted or ``null`` is a no-op, ``""`` or ``"0"`` (the UI's
    N/A marker) clears to NULL — the ``_CLEAR`` sentinel is resolved by
    :func:`app.response_builders.partial_update`.
    """

    type: WishType | None = None
    description: Optional[str] = Field(None, min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    # "0" is the UI's N/A marker for size/color — it clears like "".
    size: clearable_text(WISH_SIZE_MAX_LENGTH, zero_as_clear=True)
    color: clearable_text(WISH_COLOR_MAX_LENGTH, zero_as_clear=True)

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class WishSummary(BaseModel):
    """Compact wish representation embedded in person responses."""

    id: int
    display_id: str | None = None
    type: WishType
    description: str
    size: str | None = None
    color: str | None = None
    assigned_to_id: int | None = None
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None = None
    purchaser_note: str | None = None

    model_config = {"from_attributes": True}


class DonorWishSummary(BaseModel):
    """Donor-facing wish shape — content only (claim detail + public wish list).

    Carries no purchase-tracking fields: the purchased state is set by org
    roles (purchaser/admin) and is not exposed to donors.
    """

    id: int
    display_id: str | None = None
    type: WishType
    description: str
    size: str | None = None
    color: str | None = None

    model_config = {"from_attributes": True}


class WishDetail(WishSummary):
    """Full wish with person info (person fields are null for family wishes)."""

    person_id: int | None = None
    person_given_name: str | None = None
    person_family_name: str | None = None


class AdminWishUpdate(BaseModel):
    """Admin-only partial update for a wish.

    Includes definition fields (type, description, size, color) and
    purchase-tracking fields (assigned_to_id, purchased_at, purchased_where,
    received_at, purchaser_note).
    """

    type: WishType | None = None
    description: Optional[str] = Field(None, min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    # "0" is the UI's N/A marker for size/color — it clears like "".
    size: clearable_text(WISH_SIZE_MAX_LENGTH, zero_as_clear=True)
    color: clearable_text(WISH_COLOR_MAX_LENGTH, zero_as_clear=True)
    assigned_to_id: clearable_fk()
    purchased_at: clearable_datetime()
    purchased_where: clearable_text(200)
    received_at: clearable_datetime()
    purchaser_note: clearable_text(400)

    @field_validator("description")
    @classmethod
    def clean_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class WishPurchaseMark(BaseModel):
    """Body for the mark-purchased endpoint.

    ``purchased_at`` is optional — omitted (or null) defaults to the
    server's current time; ``''`` clears it to NULL.
    """

    purchased_at: clearable_datetime()
    purchased_where: clearable_text(200)
    purchaser_note: clearable_text(400)
    received_at: clearable_datetime()


class WishBatchAssign(BaseModel):
    """Batch-assign multiple wishes to a user.

    Set *assigned_to_id* to ``0`` to unassign the selected wishes.
    """

    wish_ids: list[int] = Field(..., min_length=1)
    assigned_to_id: int


class WishBatchMarkPurchased(BaseModel):
    """Batch-mark multiple wishes as purchased.

    Semantics mirror the single mark-purchased endpoints: ``purchased_at``
    is taken from the body (omitted/null defaults to now, ``''`` clears),
    ``purchased_where`` is overwritten (``None`` or ``''`` clears), and
    ``received_at`` follows the partial-update sentinel convention (``""``
    clears, omitted is a no-op).  ``purchaser_note`` is not touched — notes
    are per-item.
    """

    wish_ids: list[int] = Field(..., min_length=1)
    purchased_at: clearable_datetime()
    purchased_where: clearable_text(200)
    received_at: clearable_datetime()


class WishListSummary(BaseModel):
    """Flat wish summary for the admin list view.

    Person-wish rows resolve their family/referrer through the person;
    family-wish rows resolve them directly. Person fields are None on
    family-wish rows; family/referrer fields are None when the owner family
    (or its referrer) doesn't exist (or the referrer is soft-deleted).
    """

    id: int
    display_id: str | None = None
    type: WishType
    description: str
    size: str | None = None
    color: str | None = None
    person_id: int | None = None
    person_given_name: str | None = None
    person_role: PersonRole | None = None
    person_age: int | None = None
    person_note: str | None = None
    family_id: int
    family_name: str | None = None
    family_contact_name: str | None = None
    family_phone_number: str | None = None
    family_address: str | None = None
    family_verification_status: FamilyVerificationStatus | None = None
    family_bio: str | None = None
    referrer_name: str | None = None
    referrer_phone_number: str | None = None
    referrer_pickup_window: datetime | None = None
    assigned_to_id: int | None = None
    assigned_to_name: str | None = None
    purchased_at: datetime | None = None
    purchased_where: str | None = None
    received_at: datetime | None = None
    purchaser_note: str | None = None
    created_at: datetime | None = None


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
    display_id: str | None = None
    type: WishType
    description: str
    size: str | None = None
    color: str | None = None
    person_id: int | None = None
    person_given_name: str | None = None
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

    purchaser_note: clearable_text(400)
    received_at: clearable_datetime()


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
    given_name: str = Field(..., min_length=1, max_length=GIVEN_NAME_MAX_LENGTH)
    role: PersonRole
    age: int = Field(..., ge=0, le=200)
    wishes: list[WishCreate]
    note: Optional[str] = Field(None, max_length=PERSON_NOTE_MAX_LENGTH)

    @field_validator("given_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("note")
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
    given_name: Optional[str] = Field(None, min_length=1, max_length=GIVEN_NAME_MAX_LENGTH)
    role: Optional[PersonRole] = None
    age: Optional[int] = Field(None, ge=0, le=200)
    wishes: list[WishCreate] | None = None
    note: Optional[str] = Field(None, max_length=PERSON_NOTE_MAX_LENGTH)

    @field_validator("given_name", "note")
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
    role: PersonRole
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

    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)
    password: PasswordField
    role: UserRole
    display_name: Optional[str] = Field(None, max_length=DISPLAY_NAME_MAX_LENGTH)
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

    display_name: Optional[str] = Field(None, max_length=DISPLAY_NAME_MAX_LENGTH)
    role: Optional[UserRole] = None
    referrer_id: clearable_fk()
    family_id: clearable_fk()

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

    password: PasswordField


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
# Admin CRUD schemas — Deadlines
# ---------------------------------------------------------------------------


class DeadlineCreate(BaseModel):
    """Admin: create a deadline row.

    ``type`` is a closed enum (the three deadline types) — admins create
    rows, not types. ``due_date`` may be omitted (undated rows are inert
    until a date is set). ``mode`` defaults to ``display``.
    """

    type: DeadlineType
    label: str = Field(..., min_length=1, max_length=100)
    due_date: date | None = None
    mode: DeadlineMode = DeadlineMode.display

    @field_validator("label")
    @classmethod
    def clean_label(cls, v: str) -> str:
        return sanitize_plain_text(v)


class DeadlineUpdate(BaseModel):
    """Admin: partial update for a deadline row.

    Omitted/null fields are no-ops. ``due_date`` follows the clearable-date
    convention (``""`` clears to NULL). ``label`` cannot be cleared
    (non-nullable column — ``""`` is rejected).
    """

    label: Optional[str] = Field(None, min_length=1, max_length=100)
    due_date: clearable_date()
    mode: DeadlineMode | None = None

    @field_validator("label")
    @classmethod
    def clean_label(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return sanitize_plain_text(v)


class DeadlineItem(BaseModel):
    """Deadline row — shared by the public and admin list endpoints."""

    id: int
    type: DeadlineType
    label: str
    due_date: date | None = None
    mode: DeadlineMode
    created_at: datetime

    model_config = {"from_attributes": True}


class DeadlineListResponse(BaseModel):
    """Deadline list response.

    No pagination/columns — a handful-of-rows settings list (a deliberate
    deviation from the admin list-endpoint convention).
    """

    deadlines: list[DeadlineItem]


# ---------------------------------------------------------------------------
# Public families list schemas
# ---------------------------------------------------------------------------


class PublicFamilySummary(BaseModel):
    """Minimal family info for the public browse page.

    Excludes all PII (family_name, contact_name, phone_number, address).
    Only ``display_id`` is exposed so donors can identify the family anonymously.

    ``claim_status`` ("active" / "pending" / "fulfilled") is set on items
    revealed via ``include_claimed=true`` — admin sees all claimed families,
    the claiming owner their own only ("pending" = cash, unpaid, not
    expired); hidden families have no claim, so it is null otherwise.
    """

    id: int
    display_id: str
    bio: str | None = None
    person_count: int
    min_age: int | None = None
    max_age: int | None = None
    claim_status: str | None = None
    # Admin-set lock: shopping has started, cash sponsorships only —
    # donors see an "(already shopping)" marker.
    cash_only: bool = False

    model_config = {"from_attributes": True}


class PublicFamilyListResponse(BaseModel):
    """Paginated public families list response."""

    families: list[PublicFamilySummary]
    total: int = 0
    page: int = 1
    page_size: int = 12
    total_pages: int = 0
    # Number of families whose sponsorship is fulfilled (global, filter-independent)
    fulfilled_count: int = 0


# ---------------------------------------------------------------------------
# Public wish-list schemas
# ---------------------------------------------------------------------------


class PersonWishItem(BaseModel):
    """Single person on the public wish list."""

    # Flat display ID (e.g. ``3-2-1``) — the person's hierarchical position.
    display_id: str
    given_name: str
    role: PersonRole
    age: int
    note: str | None = None
    wishes: list[DonorWishSummary] = []

    model_config = {"from_attributes": True}


class FamilyWishListResponse(BaseModel):
    """Public family wish list (family info + per-person wishes).

    Note: ``family_name`` is intentionally excluded for privacy / legal compliance.
    Only ``display_id`` is exposed so donors can identify the family anonymously.
    """

    display_id: str
    bio: str | None = None
    family_wish: DonorWishSummary | None = None
    people: list[PersonWishItem]
    claimed_by_current_user: bool = False
    claim_status: str | None = None
    claim_id: int | None = None
    # Admin-set lock: shopping has started, cash sponsorships only.
    cash_only: bool = False


# ---------------------------------------------------------------------------
# Packing slip schemas
# ---------------------------------------------------------------------------


class PackingSlipPersonItem(BaseModel):
    """Single person on a packing slip (no PII beyond given_name)."""

    display_id: str
    given_name: str
    role: PersonRole
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
# Delivery slip schemas
# ---------------------------------------------------------------------------


class DeliverySlipItem(BaseModel):
    """One family on a delivery slip.

    Unlike the packing slip, this deliberately carries family PII — the
    driver needs it to identify the household and call if lost.
    """

    id: int
    display_id: str
    family_name: str
    address: str
    contact_name: str
    phone_number: str


# ---------------------------------------------------------------------------
# Self-service schemas (referrer / family — no FK IDs in body)
# ---------------------------------------------------------------------------


class FamilyCreateByReferrer(BaseModel):
    """Referrer creates a family — referrer_id is inferred from the session."""

    family_name: str = Field(..., min_length=1, max_length=FAMILY_NAME_MAX_LENGTH)
    family_wish: str = Field(..., min_length=1, max_length=WISH_DESCRIPTION_MAX_LENGTH)
    contact_name: str = Field(..., min_length=1, max_length=CONTACT_NAME_MAX_LENGTH)
    bio: Optional[str] = Field(None, max_length=FAMILY_BIO_MAX_LENGTH)
    address: str = Field(..., min_length=1, max_length=ADDRESS_MAX_LENGTH)
    phone_number: str = Field(..., min_length=1, max_length=PHONE_NUMBER_MAX_LENGTH)

    @field_validator("family_name", "family_wish", "contact_name", "address", "phone_number")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("bio")
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

    given_name: str = Field(..., min_length=1, max_length=GIVEN_NAME_MAX_LENGTH)
    role: PersonRole
    age: int = Field(..., ge=0, le=200)
    wishes: list[WishCreate]
    note: Optional[str] = Field(None, max_length=PERSON_NOTE_MAX_LENGTH)

    @field_validator("given_name")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return sanitize_plain_text(v)

    @field_validator("note")
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

    display_name: str = Field(..., min_length=1, max_length=DISPLAY_NAME_MAX_LENGTH)
    email: str = Field(..., min_length=1, max_length=MAX_EMAIL_LENGTH)
    password: PasswordField

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


class FamilyInfo(BaseModel):
    """Minimal family info carried by claim responses.

    Deliberately PII-free (no family name/contact/address) — donors see
    only the display id and household summary.
    """

    id: int
    display_id: str
    bio: str | None = None
    person_count: int
    min_age: int | None = None
    max_age: int | None = None
    # Soft-deleted families stay readable on claims (e.g. an active claim whose
    # family was deleted) — this flag lets the UI say so instead of showing a
    # bare "no members" page.
    deleted: bool = False


class FamilyClaimSummary(BaseModel):
    """Compact claim representation for list views."""

    id: int
    family: FamilyInfo
    commitment_type: CommitmentType
    payment_status: ClaimPaymentStatus
    notes: str | None = None
    created_at: datetime
    fulfilled_at: datetime | None = None
    # Payment fields — for cash claims (gift claims stay at the defaults).
    paid_at: datetime | None = None
    # Derived: created_at + CASH_CLAIM_PAYMENT_HOURS for pending cash claims,
    # None otherwise. May be in the past while the claim is still pending
    # (hourly-sweep lag) — clients render such items as expired.
    payment_expires_at: datetime | None = None
    zeffy_payment_id: str | None = None
    includes_groceries: bool = False
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
    family: FamilyInfo
    commitment_type: CommitmentType
    payment_status: ClaimPaymentStatus
    notes: str | None = None
    created_at: datetime
    fulfilled_at: datetime | None = None
    paid_at: datetime | None = None
    # Derived: created_at + CASH_CLAIM_PAYMENT_HOURS for pending cash claims,
    # None otherwise (see FamilyClaimSummary).
    payment_expires_at: datetime | None = None
    zeffy_payment_id: str | None = None
    includes_groceries: bool = False
    donor_user_id: int
    donor_display_name: str
    family_wish: DonorWishSummary | None = None
    people: list[PersonWishItem] = []

    model_config = {"from_attributes": True}


class AdminClaim(FamilyClaimSummary):
    """A claim row for the admin sponsorships view.

    Adds the donor's email (operator contact point), the family name
    (searchable here — ``FamilyInfo`` is deliberately PII-free for donors,
    but admins see names elsewhere) and the deletion timestamp (null while
    the sponsorship is active) to the standard claim summary. Covers active
    and cancelled (soft-deleted) claims — the only admin surface where
    cancelled sponsorships are readable.
    """

    donor_email: str
    family_name: str
    deleted_at: datetime | None


class AdminClaimListResponse(BaseModel):
    claims: list[AdminClaim]
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 0


class FamilyClaimCreate(BaseModel):
    """Body for creating a family claim."""

    commitment_type: CommitmentType


class FamilyClaimUpdate(BaseModel):
    """Non-admin partial update for a claim.

    No status field — only owner or admin can modify, and status changes
    go through dedicated endpoints (fulfill, cancel).
    """

    commitment_type: CommitmentType | None = None
    notes: clearable_text(500)


# ---------------------------------------------------------------------------
# Donor cart (cash sponsorship checkout)
# ---------------------------------------------------------------------------


class CartItem(BaseModel):
    """One committed (in-progress) pending cash claim in the donor's cart."""

    claim_id: int
    family: FamilyInfo
    includes_groceries: bool
    line_total_usd: int
    # Derived: created_at + CASH_CLAIM_PAYMENT_HOURS. May be in the past
    # while the claim is still pending (hourly-sweep lag) — the cart renders
    # such items as expired.
    payment_expires_at: datetime | None = None


class CartResponse(BaseModel):
    """GET /api/donor/cart — the server half of the cart page.

    The frontend merges these committed items with the local uncommitted
    ones. ``payment_expires_at`` is the earliest expiry across items; the
    line/total prices here are the source of truth the server recompute at
    checkout relies on. ``cash_claim_amount_usd`` /
    ``cash_claim_groceries_amount_usd`` are the live per-claim prices served
    so the frontend prices the uncommitted (local) lines from the server
    instead of mirroring the config in build-time constants — env-overridden
    prices (e.g. a live $1 test donation) then show up in the cart.
    """

    items: list[CartItem]
    item_count: int
    total_usd: int
    # Live per-claim prices from config (env-overridable) — price of a base
    # cash claim and of the optional groceries add-on.
    cash_claim_amount_usd: int
    cash_claim_groceries_amount_usd: int
    payment_expires_at: datetime | None = None
    # Set when the window's "please pay" nudge has a failed send and no
    # successful one (derived from the email log — the nudge went out on a
    # previous request). The cart page shows a short inline note when set.
    email_error: str | None = None


class CartItemUpdate(BaseModel):
    """Body for PATCH /api/donor/cart/items/{claim_id}."""

    includes_groceries: bool


class CartCheckoutItem(BaseModel):
    """One uncommitted cart item submitted at checkout."""

    family_id: int
    includes_groceries: bool = False


class CartCheckoutRequest(BaseModel):
    """Body for POST /api/donor/cart/checkout.

    ``items`` is the donor's uncommitted (frontend-local) cart; an empty
    body is a pure re-checkout of the existing pending cart.
    """

    items: list[CartCheckoutItem] = []


class CartCheckoutResponse(BaseModel):
    """Checkout result: the Zeffy URL (donor email pre-filled, percent-encoded) and the committed claim ids.

    The amount can't be pre-filled (Zeffy forms don't accept an amount URL
    parameter) — the donor enters the whole-cart total by hand, guided by
    the cart page's how-to-pay instructions.

    The frontend opens ``zeffy_url`` in a new tab and drops the returned
    claim ids' families from local storage (they are now server-side, still
    listed from GET /api/donor/cart).
    """

    zeffy_url: str
    claim_ids: list[int]


class CartConfirmResponse(BaseModel):
    """POST /api/donor/cart/confirm result.

    * ``pending`` — no matching payment found yet (keep polling the cart).
    * ``mismatch`` — this donor paid a different amount on the campaign
      (``expected_usd`` vs ``found_usd``); an admin can match manually.
    * ``paid`` — the payment was applied; ``claims`` are the now-paid claims.
    """

    status: Literal["pending", "mismatch", "paid"]
    expected_usd: int | None = None
    found_usd: int | None = None
    claims: list[FamilyClaimSummary] = []


class AdminClaimMarkPaid(BaseModel):
    """Body for the admin mark-paid endpoint (offline cash/cheque with no
    Zeffy record). ``zeffy_payment_id`` is optional — set when the offline
    payment does have a Zeffy record to link."""

    zeffy_payment_id: str | None = None


# ---------------------------------------------------------------------------
# Admin Zeffy reconciliation (unmatched-payments page)
# ---------------------------------------------------------------------------


class AdminZeffyPayment(BaseModel):
    """One mirrored Zeffy payment enriched with local match state.

    ``matched`` / ``claim_ids`` are local: the live claims storing this
    payment id (a matched payment lists them; an unmatched one has none).
    ``seen_at`` is the admin's "no action needed" acknowledgment; the
    snapshot fields (incl. ``refund_status``) are refreshed by the match
    endpoint and the sync walk's newest known row, so a recent refund shows
    up.
    """

    id: str
    created_at: datetime
    amount_cents: int
    currency: str
    buyer_name: str | None = None
    buyer_email: str | None = None
    receipt_url: str | None = None
    claim_ids: list[int]
    matched: bool
    seen_at: datetime | None = None
    refund_status: str = "none"


class AdminZeffyPaymentsResponse(BaseModel):
    """Mirrored payment list — the standard admin page envelope (the local
    table is the source; the webhook, the hourly sync, and Sync now keep
    it fresh)."""

    payments: list[AdminZeffyPayment]
    total: int = 0
    page: int = 1
    page_size: int = 25
    total_pages: int = 0


class AdminZeffyUnmatchedSummary(BaseModel):
    """The admin dashboard banner: how many mirrored payments are waiting
    for action (no live match, no "seen" acknowledgment) and the oldest."""

    count: int = 0
    oldest_created_at: datetime | None = None


class AdminZeffySyncResponse(BaseModel):
    """Result of an admin-triggered "sync now" pull of the campaign's
    payments into the local mirror."""

    new_count: int = 0
    updated_count: int = 0


class AdminZeffySeenResponse(BaseModel):
    """Result of marking a payment seen / clearing the acknowledgment."""

    payment_id: str
    seen_at: datetime | None = None


class AdminZeffyPendingClaimItem(BaseModel):
    """One active unpaid cash claim in the match-modal payload."""

    claim_id: int
    family: FamilyInfo
    includes_groceries: bool
    line_total_usd: int
    payment_expires_at: datetime | None = None


class AdminZeffyPendingDonorGroup(BaseModel):
    """Unpaid cash claims grouped by donor (match-modal: per-donor
    checkboxes + expected amount)."""

    donor_id: int
    donor_email: str
    donor_display_name: str | None = None
    item_count: int
    total_usd: int
    claims: list[AdminZeffyPendingClaimItem]


class AdminZeffyPendingClaimsResponse(BaseModel):
    """GET /api/admin/zeffy/pending-claims — grouped modal data (no
    columns/pagination, the admin_deadlines precedent)."""

    donors: list[AdminZeffyPendingDonorGroup]


class AdminZeffyMatchRequest(BaseModel):
    """Body for the admin manual match: the claims the payment covers.

    A subset of a donor's cart is fine (a $600 payment covering one $500
    claim — the admin's judgment)."""

    claim_ids: list[int]


class AdminZeffyMatchResponse(BaseModel):
    payment_id: str
    claims: list[FamilyClaimSummary]


class AdminZeffyUnmatchResponse(BaseModel):
    payment_id: str
    claim_ids: list[int]
