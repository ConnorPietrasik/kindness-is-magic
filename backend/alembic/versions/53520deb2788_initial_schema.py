"""initial schema

Revision ID: 53520deb2788
Revises:
Create Date: 2026-08-08 21:10:15.554181

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "53520deb2788"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enums (created inline by SQLAlchemy but listed here for clarity)

    # -----------------------------------------------------------------------
    # 1. Tables with no cross-deps among {users, referrer, family}
    # -----------------------------------------------------------------------
    op.create_table(
        "email_preferences",
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email"),
    )
    op.create_index(op.f("ix_email_preferences_email"), "email_preferences", ["email"], unique=False)

    # -----------------------------------------------------------------------
    # 2. Core trio — created WITHOUT the circular FKs first
    # -----------------------------------------------------------------------
    op.create_table(
        "referrer",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("family_limit", sa.SmallInteger(), nullable=False),
        sa.Column("phone_number", sa.String(length=20), nullable=False),
        sa.Column("family_invite_code", sa.String(length=10), nullable=False),
        sa.Column(
            "approval_status",
            sa.Enum("pending", "approved", "rejected", name="referrer_approval_status", create_constraint=True),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("approved_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_referrer_id"), "referrer", ["id"], unique=False)
    op.create_index(
        op.f("ix_referrer_family_invite_code"),
        "referrer",
        ["family_invite_code"],
        unique=True,
    )

    op.create_table(
        "family",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("referrer_id", sa.Integer(), nullable=True),
        sa.Column("family_name", sa.String(length=40), nullable=False),
        sa.Column("bio", sa.String(length=400), nullable=True),
        sa.Column("address", sa.String(length=200), nullable=True),
        sa.Column("phone_number", sa.String(length=20), server_default="", nullable=False),
        sa.Column("family_wish", sa.String(length=400), nullable=False),
        sa.Column("contact_name", sa.String(length=40), nullable=False),
        sa.Column(
            "approval_status",
            sa.Enum("pending", "approved", "rejected", name="family_approval_status", create_constraint=True),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("pickup_window", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "wish_lock_level",
            sa.Enum("family", "referrer", "admin", name="wish_lock_level", create_constraint=True),
            server_default="family",
            nullable=False,
        ),
        sa.Column("wish_review_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("wish_rejection_reason", sa.String(length=400), nullable=True),
        sa.Column("referrer_notes", sa.String(length=1000), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("delivery_user_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_family_id"), "family", ["id"], unique=False)
    op.create_index("ix_family_referrer_id_deleted_at", "family", ["referrer_id", "deleted_at"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=40), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "admin",
                "referrer",
                "family",
                "purchaser",
                "delivery",
                "donor",
                name="user_role",
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("referrer_id", sa.Integer(), nullable=True),
        sa.Column("family_id", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # -----------------------------------------------------------------------
    # 3. Add the circular FKs that could not be inlined
    # -----------------------------------------------------------------------
    op.create_foreign_key(
        "fk_referrer_approved_by_admin_id",
        "referrer",
        "users",
        ["approved_by_admin_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_family_referrer_id",
        "family",
        "referrer",
        ["referrer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_family_delivery_user_id",
        "family",
        "users",
        ["delivery_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_users_referrer_id",
        "users",
        "referrer",
        ["referrer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_users_family_id",
        "users",
        "family",
        ["family_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # -----------------------------------------------------------------------
    # 4. Remaining tables (deps on core trio are now satisfied)
    # -----------------------------------------------------------------------
    op.create_table(
        "family_claims",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("donor_user_id", sa.Integer(), nullable=False),
        sa.Column("family_id", sa.Integer(), nullable=False),
        sa.Column(
            "commitment_type",
            sa.Enum("gifts", "cash", name="commitment_type", create_constraint=True),
            nullable=False,
        ),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["donor_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["family.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_family_claims_donor_deleted",
        "family_claims",
        ["donor_user_id", "deleted_at"],
        unique=False,
    )
    op.create_index(op.f("ix_family_claims_id"), "family_claims", ["id"], unique=False)
    op.create_index(
        "uq_family_claims_family_active",
        "family_claims",
        ["family_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(op.f("ix_password_reset_tokens_id"), "password_reset_tokens", ["id"], unique=False)
    op.create_index(
        "ix_password_reset_tokens_user_id_used_at",
        "password_reset_tokens",
        ["user_id", "used_at"],
        unique=False,
    )

    op.create_table(
        "person",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("family_id", sa.Integer(), nullable=False),
        sa.Column("given_name", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=40), nullable=True),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=400), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["family_id"], ["family.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_person_family_id_deleted_at", "person", ["family_id", "deleted_at"], unique=False)
    op.create_index(op.f("ix_person_id"), "person", ["id"], unique=False)

    op.create_table(
        "referrer_invite_emails",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("referrer_id", sa.Integer(), nullable=False),
        sa.Column("recipient_email", sa.String(length=120), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["referrer_id"], ["referrer.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_referrer_invite_emails_id"), "referrer_invite_emails", ["id"], unique=False)
    op.create_index(
        "ix_referrer_invite_emails_recipient_sent",
        "referrer_invite_emails",
        ["recipient_email", "sent_at"],
        unique=False,
    )
    op.create_index(
        "ix_referrer_invite_emails_referrer_sent",
        "referrer_invite_emails",
        ["referrer_id", "sent_at"],
        unique=False,
    )

    op.create_table(
        "referrer_invite_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=10), nullable=False),
        sa.Column("family_limit", sa.SmallInteger(), nullable=False),
        sa.Column("locked_email", sa.String(length=120), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("redeemed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("redeemed_by_referrer_id", sa.Integer(), nullable=True),
        sa.Column("created_by_admin_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_admin_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["redeemed_by_referrer_id"], ["referrer.id"]),
        sa.ForeignKeyConstraint(["redeemed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_referrer_invite_tokens_code"),
        "referrer_invite_tokens",
        ["code"],
        unique=True,
    )
    op.create_index(op.f("ix_referrer_invite_tokens_id"), "referrer_invite_tokens", ["id"], unique=False)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_refresh_tokens_id"), "refresh_tokens", ["id"], unique=False)
    op.create_index(op.f("ix_refresh_tokens_token"), "refresh_tokens", ["token"], unique=False)

    op.create_table(
        "wish",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            sa.Enum("adult", "practical", "fun", name="wish_type", create_constraint=True),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=60), nullable=False),
        sa.Column("size", sa.String(length=20), nullable=True),
        sa.Column("assigned_to_id", sa.Integer(), nullable=True),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purchased_where", sa.String(length=200), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purchaser_note", sa.String(length=400), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["person_id"], ["person.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wish_id"), "wish", ["id"], unique=False)
    op.create_index("ix_wish_person_id_deleted_at", "wish", ["person_id", "deleted_at"], unique=False)
    op.create_index(
        "uq_wish_person_type_active",
        "wish",
        ["person_id", "type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_wish_person_type_active",
        table_name="wish",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index("ix_wish_person_id_deleted_at", table_name="wish")
    op.drop_index(op.f("ix_wish_id"), table_name="wish")
    op.drop_table("wish")

    op.drop_index(op.f("ix_refresh_tokens_token"), table_name="refresh_tokens")
    op.drop_index(op.f("ix_refresh_tokens_id"), table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index(op.f("ix_referrer_invite_tokens_id"), table_name="referrer_invite_tokens")
    op.drop_index(op.f("ix_referrer_invite_tokens_code"), table_name="referrer_invite_tokens")
    op.drop_table("referrer_invite_tokens")

    op.drop_index("ix_referrer_invite_emails_referrer_sent", table_name="referrer_invite_emails")
    op.drop_index("ix_referrer_invite_emails_recipient_sent", table_name="referrer_invite_emails")
    op.drop_index(op.f("ix_referrer_invite_emails_id"), table_name="referrer_invite_emails")
    op.drop_table("referrer_invite_emails")

    op.drop_index(op.f("ix_person_id"), table_name="person")
    op.drop_index("ix_person_family_id_deleted_at", table_name="person")
    op.drop_table("person")

    op.drop_index("ix_password_reset_tokens_user_id_used_at", table_name="password_reset_tokens")
    op.drop_index(op.f("ix_password_reset_tokens_id"), table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")

    op.drop_index(
        "uq_family_claims_family_active",
        table_name="family_claims",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(op.f("ix_family_claims_id"), table_name="family_claims")
    op.drop_index("ix_family_claims_donor_deleted", table_name="family_claims")
    op.drop_table("family_claims")

    # Drop circular FKs first
    op.drop_constraint("fk_users_family_id", "users", type_="foreignkey")
    op.drop_constraint("fk_users_referrer_id", "users", type_="foreignkey")
    op.drop_constraint("fk_family_delivery_user_id", "family", type_="foreignkey")
    op.drop_constraint("fk_family_referrer_id", "family", type_="foreignkey")
    op.drop_constraint("fk_referrer_approved_by_admin_id", "referrer", type_="foreignkey")

    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    op.drop_index(op.f("ix_referrer_id"), table_name="referrer")
    op.drop_index(op.f("ix_referrer_family_invite_code"), table_name="referrer")
    op.drop_table("referrer")

    op.drop_index("ix_family_referrer_id_deleted_at", table_name="family")
    op.drop_index(op.f("ix_family_id"), table_name="family")
    op.drop_table("family")

    op.drop_index(op.f("ix_email_preferences_email"), table_name="email_preferences")
    op.drop_table("email_preferences")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS commitment_type")
    op.execute("DROP TYPE IF EXISTS user_role")
    op.execute("DROP TYPE IF EXISTS wish_lock_level")
    op.execute("DROP TYPE IF EXISTS family_approval_status")
    op.execute("DROP TYPE IF EXISTS referrer_approval_status")
    op.execute("DROP TYPE IF EXISTS wish_type")
