import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
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


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)

    @validates("email")
    def _normalize_email(self, _key: str, value: str) -> str:
        """Always store email in lowercase for consistent lookups."""
        return value.strip().lower()

    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role", create_constraint=True), nullable=False
    )
    referrer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("referrer.id", ondelete="SET NULL"), nullable=True
    )
    family_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("family.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships to existing domain models
    referrer_obj: Mapped["Referrer | None"] = relationship(
        "Referrer", foreign_keys=[referrer_id], backref="users"
    )
    family_obj: Mapped["Family | None"] = relationship(
        "Family", foreign_keys=[family_id], backref="users"
    )


class ReferrerInviteToken(Base):
    """One-time invite codes that admins generate for referrer self-registration."""

    __tablename__ = "referrer_invite_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    family_limit: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    redeemed_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    redeemed_by_referrer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("referrer.id"), nullable=True
    )


class PasswordResetToken(Base):
    """One-time tokens for password-reset flow."""

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        # Invalidation query filters (user_id, used) together.
        Index("ix_password_reset_tokens_user_id_used", "user_id", "used"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", backref="reset_tokens")


class Referrer(Base):
    __tablename__ = "referrer"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    family_limit: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)

    families: Mapped[list["Family"]] = relationship(
        "Family", back_populates="referrer"
    )


class Family(Base):
    __tablename__ = "family"
    __table_args__ = (
        # Queries always filter (referrer_id, is_deleted) together —
        # e.g. referrer list_families, family_limit check, build_referrer_detail.
        Index("ix_family_referrer_id_is_deleted", "referrer_id", "is_deleted"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ORPHAN_REFERRER_ID = 0

    referrer_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("referrer.id", ondelete="SET DEFAULT"),
        server_default=str(ORPHAN_REFERRER_ID),
        nullable=False,
    )
    family_name: Mapped[str] = mapped_column(String(40), nullable=False)
    bio: Mapped[str | None] = mapped_column(String(400), nullable=True)
    address: Mapped[str] = mapped_column(String(200), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=True)
    family_wish: Mapped[str] = mapped_column(String(400), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(40), nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    referrer: Mapped["Referrer"] = relationship("Referrer", back_populates="families")
    persons: Mapped[list["Person"]] = relationship(
        "Person", back_populates="family", cascade="all, delete-orphan"
    )


class Person(Base):
    __tablename__ = "person"
    __table_args__ = (
        # Queries always filter (family_id, is_deleted) together —
        # e.g. build_family_detail, list_family_people, list_people.
        Index("ix_person_family_id_is_deleted", "family_id", "is_deleted"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    family_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("family.id"), nullable=False
    )
    given_name: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str | None] = mapped_column(String(40), nullable=True)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    practical_wish: Mapped[str] = mapped_column(String(400), nullable=False)
    fun_wish: Mapped[str] = mapped_column(String(400), nullable=False)
    note: Mapped[str] = mapped_column(String(400), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    family: Mapped["Family"] = relationship("Family", back_populates="persons")
