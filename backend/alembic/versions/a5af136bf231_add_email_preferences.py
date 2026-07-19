"""add_email_preferences

Revision ID: a5af136bf231
Revises: 11399bf6f215
Create Date: 2026-07-19 05:59:55.006705

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a5af136bf231"
down_revision: Union[str, None] = "11399bf6f215"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_preferences",
        sa.Column("email", sa.String(length=120), primary_key=True, nullable=False),
        sa.Column(
            "unsubscribed_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )
    op.create_index(op.f("ix_email_preferences_email"), "email_preferences", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_email_preferences_email"), table_name="email_preferences")
    op.drop_table("email_preferences")
