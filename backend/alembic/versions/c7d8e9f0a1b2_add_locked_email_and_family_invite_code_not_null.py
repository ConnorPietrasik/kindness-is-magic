"""add_locked_email_and_family_invite_code_not_null

Add locked_email column to referrer_invite_tokens and make
referrer.family_invite_code non-nullable.

Revision ID: c7d8e9f0a1b2
Revises: b1c2d3e4f5a6
Create Date: 2026-07-26 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add locked_email column to referrer_invite_tokens
    op.add_column(
        "referrer_invite_tokens",
        sa.Column("locked_email", sa.String(length=120), nullable=True),
    )

    # Make family_invite_code non-nullable
    op.alter_column("referrer", "family_invite_code", nullable=False)


def downgrade() -> None:
    # Revert family_invite_code to nullable
    op.alter_column("referrer", "family_invite_code", nullable=True)

    # Drop locked_email column
    op.drop_column("referrer_invite_tokens", "locked_email")
