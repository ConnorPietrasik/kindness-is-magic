import enum
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    func,
    text,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database import Base


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------


class UserRole(str, enum.Enum):
    admin = "admin"
    referrer = "referrer"
    family = "family"
    purchaser = "purchaser"
    delivery = "delivery"
    donor = "donor"


def default_display_name_from_email(email: str | None) -> str:
    """Derive a default display name from the email local-part.

    Capitalizes the first character, e.g. ``sarah.chen@example.com`` → ``"Sarah.chen"``.
    """
    local = email.split("@")[0] if email else ""
    return local[:1].upper() + local[1:]


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Explicitly name the FK to family so SQLAlchemy can resolve the
        # circular dependency (users.family_id → family.id ↔ family.delivery_user_id → users.id)
        # during DROP ALL at test teardown.
        ForeignKeyConstraint(
            ["family_id"],
            ["family.id"],
            name="fk_users_family_id",
            ondelete="SET NULL",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)

    @validates("email")
    def _normalize_email(self, _key: str, value: str) -> str:
        """Always store email in lowercase for consistent lookups."""
        return value.strip().lower()

    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(40), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, name="user_role", create_constraint=True), nullable=False)
    referrer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("referrer.id", ondelete="SET NULL"), nullable=True)

    @validates("display_name")
    def _default_display_name(self, _key: str, value: str | None) -> str:
        """Ensure display_name always has a value.

        If not provided or empty, defaults to the email local-part with the
        first letter capitalized (e.g. ``sarah.chen@example.com`` → ``"Sarah.chen"``).
        """
        if not value:
            value = default_display_name_from_email(self.email)
        return value

    family_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships to existing domain models
    referrer_obj: Mapped["Referrer | None"] = relationship("Referrer", foreign_keys=[referrer_id], backref="users")
    family_obj: Mapped["Family | None"] = relationship("Family", foreign_keys=[family_id], backref="users")


class ReferrerInviteToken(Base):
    """One-time invite codes that admins generate for referrer self-registration.

    When ``locked_email`` is set the code can only be redeemed by that exact
    email address, enabling pre-filled / locked invite flows.
    """

    __tablename__ = "referrer_invite_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)
    family_limit: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    locked_email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    redeemed_by_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    redeemed_by_referrer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("referrer.id"), nullable=True)
    created_by_admin_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    created_by_admin: Mapped["User"] = relationship("User", foreign_keys=[created_by_admin_id])


class PasswordResetToken(Base):
    """One-time tokens for password-reset flow."""

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        # Invalidation query filters (user_id, used_at) together.
        Index("ix_password_reset_tokens_user_id_used_at", "user_id", "used_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", backref="reset_tokens")


class ReferrerApprovalStatus(str, enum.Enum):
    """Approval state for referrers who self-register via unlocked invite codes."""

    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Referrer(Base):
    __tablename__ = "referrer"
    __table_args__ = (
        # Explicitly name the FK back to users so SQLAlchemy can resolve the
        # circular dependency (users.referrer_id → referrer.id ↔ referrer.approved_by_admin_id → users.id)
        # during DROP ALL at test teardown.
        ForeignKeyConstraint(
            ["approved_by_admin_id"],
            ["users.id"],
            name="fk_referrer_approved_by_admin_id",
            ondelete="SET NULL",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    family_limit: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    family_invite_code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)
    approval_status: Mapped[ReferrerApprovalStatus] = mapped_column(
        SAEnum(ReferrerApprovalStatus, name="referrer_approval_status", create_constraint=True),
        server_default="pending",
        nullable=False,
    )
    approved_by_admin_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    families: Mapped[list["Family"]] = relationship("Family", back_populates="referrer")
    approved_by_admin: Mapped["User | None"] = relationship("User", foreign_keys=[approved_by_admin_id])


class FamilyVerificationStatus(str, enum.Enum):
    """Verification state for families that self-register via invite.

    The referrer confirms that a referred family is one they intended to
    refer (families sometimes share invite codes).
    """

    pending = "pending"
    verified = "verified"
    rejected = "rejected"


class WishLockLevel(str, enum.Enum):
    """Three-tier wish approval lock.

    * ``family`` — family can edit freely; referrer/admin can also edit.
    * ``referrer`` — family is locked out; referrer and admin can edit.
    * ``admin`` — only admin can edit (family and referrer locked out).
    """

    family = "family"
    referrer = "referrer"
    admin = "admin"


class Family(Base):
    __tablename__ = "family"
    __table_args__ = (
        # Queries always filter (referrer_id, deleted_at) together —
        # e.g. referrer list_families, family_limit check, build_referrer_detail.
        Index("ix_family_referrer_id_deleted_at", "referrer_id", "deleted_at"),
        # Explicitly name the FK back to users so SQLAlchemy can resolve the
        # circular dependency (users.family_id → family.id ↔ family.delivery_user_id → users.id)
        # during DROP ALL at test teardown.
        ForeignKeyConstraint(
            ["delivery_user_id"],
            ["users.id"],
            name="fk_family_delivery_user_id",
            ondelete="SET NULL",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    referrer_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("referrer.id", ondelete="SET NULL"),
        nullable=True,
    )
    family_name: Mapped[str] = mapped_column(String(40), nullable=False)
    bio: Mapped[str | None] = mapped_column(String(400), nullable=True)
    address: Mapped[str] = mapped_column(String(200), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False, server_default="")
    family_wish: Mapped[str] = mapped_column(String(400), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(40), nullable=False)
    verification_status: Mapped[FamilyVerificationStatus] = mapped_column(
        SAEnum(FamilyVerificationStatus, name="family_verification_status", create_constraint=True),
        server_default="pending",
        nullable=False,
    )
    pickup_window: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    # Wish approval workflow fields
    wish_lock_level: Mapped[WishLockLevel] = mapped_column(
        SAEnum(WishLockLevel, name="wish_lock_level", create_constraint=True),
        server_default="family",
        nullable=False,
    )
    wish_review_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    wish_rejection_reason: Mapped[str | None] = mapped_column(String(400), nullable=True, default=None)

    # Internal notes visible only to referrers and admins
    referrer_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    referrer: Mapped["Referrer | None"] = relationship("Referrer", back_populates="families")
    persons: Mapped[list["Person"]] = relationship("Person", back_populates="family", cascade="all, delete-orphan")

    # Delivery assignment — many families can share one delivery person
    delivery_user_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    delivery_user: Mapped["User | None"] = relationship("User", foreign_keys=[delivery_user_id])


class Person(Base):
    __tablename__ = "person"
    __table_args__ = (
        # Queries always filter (family_id, deleted_at) together —
        # e.g. build_family_detail, list_family_people, list_people.
        Index("ix_person_family_id_deleted_at", "family_id", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    family_id: Mapped[int] = mapped_column(Integer, ForeignKey("family.id"), nullable=False)
    given_name: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str | None] = mapped_column(String(40), nullable=True)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(String(400), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    family: Mapped["Family"] = relationship("Family", back_populates="persons")
    wishes: Mapped[list["Wish"]] = relationship("Wish", back_populates="person")

    @validates("given_name", "title")
    def _capitalize_name_fields(self, key: str, value: str | None) -> str | None:
        """Always store given_name and title with the first letter capitalized."""
        if value:
            return value[:1].upper() + value[1:]
        return value


class WishType(str, enum.Enum):
    """Wish type determined by person age.

    Adults (18+) get one ``adult`` wish.
    Children (under 18) get one ``practical`` and one ``fun`` wish.
    """

    adult = "adult"
    practical = "practical"
    fun = "fun"


class Wish(Base):
    __tablename__ = "wish"
    __table_args__ = (
        # Partial unique index: only one active wish per (person_id, type).
        # Soft-deleted wishes (deleted_at IS NOT NULL) are excluded so new
        # wishes can reuse the same (person_id, type) combination.
        Index(
            "uq_wish_person_type_active",
            "person_id",
            "type",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_wish_person_id_deleted_at", "person_id", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    person_id: Mapped[int] = mapped_column(Integer, ForeignKey("person.id"), nullable=False)
    type: Mapped[WishType] = mapped_column(SAEnum(WishType, name="wish_type", create_constraint=True), nullable=False)
    description: Mapped[str] = mapped_column(String(60), nullable=False)
    size: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchased_where: Mapped[str | None] = mapped_column(String(200), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchaser_note: Mapped[str | None] = mapped_column(String(400), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    person: Mapped["Person"] = relationship("Person", back_populates="wishes")
    assigned_to: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to_id])


class RefreshToken(Base):
    """Server-side refresh token tracking for security.

    Each issued refresh token is recorded here.  On rotation (the /refresh
    endpoint) the old row is deleted and a new row is inserted.
    Logout and password-change also delete rows, preventing replay.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", backref="refresh_tokens")


class EmailKind(str, enum.Enum):
    """Type of email the application sends (log category)."""

    family_invite = "family_invite"
    referrer_invite = "referrer_invite"
    password_reset = "password_reset"
    family_pending = "family_pending"
    family_verified = "family_verified"
    referrer_approved = "referrer_approved"
    referrer_rejected = "referrer_rejected"
    claim_confirmation = "claim_confirmation"
    admin_failure_notice = "admin_failure_notice"


class EmailStatus(str, enum.Enum):
    """Outcome of an email send attempt.

    * ``sent`` — the SMTP send succeeded.
    * ``failed`` — the send was blocked or errored (``failure_reason`` set).
    * ``reset`` — an admin cleared the record via reset-sent-emails so the
      send no longer counts toward rate limits.
    """

    sent = "sent"
    failed = "failed"
    reset = "reset"


class SentEmail(Base):
    """Log of every email send attempt made by the application.

    ``user_id`` is the *actor* whose action triggered the send (e.g. a
    referrer sending a family invite, an admin approving a referrer) —
    NULL for unauthenticated requests (e.g. password reset).

    Referrer invite rate limits only count rows with
    ``kind == family_invite AND status == 'sent'``.
    """

    __tablename__ = "sent_emails"
    __table_args__ = (
        Index("ix_sent_emails_user_sent", "user_id", "sent_at"),
        Index("ix_sent_emails_recipient_sent", "recipient_email", "sent_at"),
        Index("ix_sent_emails_kind_sent", "kind", "sent_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recipient_email: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[EmailKind] = mapped_column(SAEnum(EmailKind, name="email_kind", create_constraint=True), nullable=False)
    status: Mapped[EmailStatus] = mapped_column(SAEnum(EmailStatus, name="email_status", create_constraint=True), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    @validates("recipient_email")
    def _normalize_email(self, _key: str, value: str) -> str:
        return value.strip().lower()


class EmailPreference(Base):
    """Unsubscribe blocklist — rows created when a user clicks an unsubscribe link."""

    __tablename__ = "email_preferences"

    email: Mapped[str] = mapped_column(String(120), primary_key=True, index=True)
    unsubscribed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ---------------------------------------------------------------------------
# Donor claims
# ---------------------------------------------------------------------------


class CommitmentType(str, enum.Enum):
    """Type of commitment a donor makes to a family."""

    gifts = "gifts"
    cash = "cash"


class FamilyClaim(Base):
    """A donor's claim on a family (gift promise or cash commitment).

    Any claim-capable role (admin, referrer, purchaser, donor) can create
    and manage claims.  Only admins can mark a claim as fulfilled.
    """

    __tablename__ = "family_claims"
    __table_args__ = (
        # One non-deleted claim per family at a time.
        Index(
            "uq_family_claims_family_active",
            "family_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Index for the gift-cap query (count active non-deleted gift claims per donor).
        Index("ix_family_claims_donor_deleted", "donor_user_id", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    donor_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    family_id: Mapped[int] = mapped_column(Integer, ForeignKey("family.id"), nullable=False)
    commitment_type: Mapped[CommitmentType] = mapped_column(
        SAEnum(CommitmentType, name="commitment_type", create_constraint=True),
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    donor_user: Mapped["User"] = relationship("User")
    family: Mapped["Family"] = relationship("Family")
