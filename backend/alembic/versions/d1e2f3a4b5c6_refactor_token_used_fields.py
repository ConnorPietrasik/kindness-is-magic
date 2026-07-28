"""refactor_token_used_fields

Drop redundant used bool from referrer_invite_tokens (redeemed_by_*
foreign keys already track redemption) and replace used bool on
password_reset_tokens with a used_at datetime for auditability.

Revision ID: d1e2f3a4b5c6
Revises: c7d8e9f0a1b2
Create Date: 2026-07-26 13:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop redundant used column from referrer_invite_tokens
    op.drop_column("referrer_invite_tokens", "used")

    # Replace used bool with used_at datetime on password_reset_tokens
    op.add_column(
        "password_reset_tokens",
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_index(
        "ix_password_reset_tokens_user_id_used",
        table_name="password_reset_tokens",
    )
    op.create_index(
        "ix_password_reset_tokens_user_id_used_at",
        "password_reset_tokens",
        ["user_id", "used_at"],
    )
    op.drop_column("password_reset_tokens", "used")


def downgrade() -> None:
    # Reverse password_reset_tokens changes
    op.add_column(
        "password_reset_tokens",
        sa.Column("used", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.drop_index(
        "ix_password_reset_tokens_user_id_used_at",
        table_name="password_reset_tokens",
    )
    op.create_index(
        "ix_password_reset_tokens_user_id_used",
        "password_reset_tokens",
        ["user_id", "used"],
    )
    op.drop_column("password_reset_tokens", "used_at")

    # Restore used column on referrer_invite_tokens
    op.add_column(
        "referrer_invite_tokens",
        sa.Column("used", sa.Boolean(), nullable=False, server_default="false"),
    )
