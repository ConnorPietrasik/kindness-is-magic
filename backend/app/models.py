import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


class PasswordResetToken(Base):
    """One-time tokens for password-reset flow."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
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
    email: Mapped[str] = mapped_column(String(40), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)

    families: Mapped[list["Family"]] = relationship(
        "Family", back_populates="referrer"
    )


class Family(Base):
    __tablename__ = "family"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ORPHAN_REFERRER_ID = 1

    referrer_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("referrer.id", ondelete="SET DEFAULT"),
        server_default=str(ORPHAN_REFERRER_ID),
        nullable=False,
    )
    family_name: Mapped[str] = mapped_column(String(40), nullable=False)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str] = mapped_column(String(200), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=True)
    family_wish: Mapped[str] = mapped_column(String(400), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(40), nullable=False)

    referrer: Mapped["Referrer"] = relationship("Referrer", back_populates="families")
    persons: Mapped[list["Person"]] = relationship(
        "Person", back_populates="family", cascade="all, delete-orphan"
    )


class Person(Base):
    __tablename__ = "person"

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

    family: Mapped["Family"] = relationship("Family", back_populates="persons")
