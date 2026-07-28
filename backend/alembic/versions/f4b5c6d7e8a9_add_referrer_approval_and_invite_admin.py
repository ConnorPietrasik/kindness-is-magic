"""add_referrer_approval_and_invite_admin

Add referrer approval status fields and created_by_admin_id on invite tokens.

Revision ID: f4b5c6d7e8a9
Revises: e3a800d03bb5
Create Date: 2026-07-28 06:57:21.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4b5c6d7e8a9"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the enum type first (PostgreSQL)
    op.execute("CREATE TYPE referrer_approval_status AS ENUM ('pending', 'approved', 'rejected')")

    # Add approval fields to referrer table
    op.add_column(
        "referrer",
        sa.Column(
            "approval_status",
            sa.Enum("pending", "approved", "rejected", name="referrer_approval_status", create_type=False),
            server_default="pending",
            nullable=False,
        ),
    )
    op.add_column(
        "referrer",
        sa.Column("approved_by_admin_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "referrer",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    # FK for approved_by_admin_id (named so SQLAlchemy can resolve the cycle during drop_all)
    op.create_foreign_key(
        "fk_referrer_approved_by_admin_id",
        "referrer",
        "users",
        ["approved_by_admin_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Add created_by_admin_id to referrer_invite_tokens
    # Per plan: drop existing rows since no data needs to be preserved
    op.execute("DELETE FROM referrer_invite_tokens")
    op.add_column(
        "referrer_invite_tokens",
        sa.Column("created_by_admin_id", sa.Integer(), nullable=False),
    )
    op.create_foreign_key(
        "fk_referrer_invite_tokens_created_by_admin_id_users",
        "referrer_invite_tokens",
        "users",
        ["created_by_admin_id"],
        ["id"],
    )


def downgrade() -> None:
    # Drop FKs first
    op.drop_constraint(
        "fk_referrer_invite_tokens_created_by_admin_id_users",
        "referrer_invite_tokens",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_referrer_approved_by_admin_id",
        "referrer",
        type_="foreignkey",
    )

    # Drop columns
    op.drop_column("referrer_invite_tokens", "created_by_admin_id")
    op.drop_column("referrer", "approved_at")
    op.drop_column("referrer", "approved_by_admin_id")
    op.drop_column("referrer", "approval_status")

    # Drop the enum type
    op.execute("DROP TYPE IF EXISTS referrer_approval_status")
