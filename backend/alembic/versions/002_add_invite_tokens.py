"""add invite tokens

Revision ID: 002_add_invite_tokens
Revises: c8e3bc3e477e
Create Date: 2026-06-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_add_invite_tokens'
down_revision: Union[str, None] = 'c8e3bc3e477e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create referrer_invite_tokens table
    op.create_table(
        "referrer_invite_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("code", sa.String(length=20), nullable=False, unique=True, index=True),
        sa.Column("family_limit", sa.SmallInteger(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("redeemed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("redeemed_by_referrer_id", sa.Integer(), sa.ForeignKey("referrer.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("referrer_invite_tokens")
