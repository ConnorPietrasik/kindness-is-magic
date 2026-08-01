"""add wish approval fields to family

Revision ID: a1b2c3d4e5f6
Revises: 973400430110
Create Date: 2026-08-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "973400430110"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the enum type first (PostgreSQL)
    wish_lock_level = sa.Enum("family", "referrer", "admin", name="wish_lock_level", create_type=True)
    wish_lock_level.create(op.get_bind())

    op.add_column(
        "family",
        sa.Column(
            "wish_lock_level",
            wish_lock_level,
            server_default="family",
            nullable=False,
        ),
    )
    op.add_column(
        "family",
        sa.Column("wish_review_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "family",
        sa.Column("wish_rejection_reason", sa.String(400), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("family", "wish_rejection_reason")
    op.drop_column("family", "wish_review_requested_at")
    op.drop_column("family", "wish_lock_level")

    # Drop the enum type
    wish_lock_level = sa.Enum("family", "referrer", "admin", name="wish_lock_level", create_type=False)
    wish_lock_level.drop(op.get_bind())
