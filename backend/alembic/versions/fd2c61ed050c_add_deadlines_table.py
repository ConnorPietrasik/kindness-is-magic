"""add deadlines table

Revision ID: fd2c61ed050c
Revises: 3e2c9f9beae9
Create Date: 2026-09-10 13:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "fd2c61ed050c"
down_revision: Union[str, None] = "3e2c9f9beae9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deadlines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            sa.Enum("family_info", "referrer_review", "gift_dropoff", name="deadline_type", create_constraint=True),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column(
            "mode",
            sa.Enum("display", "remind", "enforced", name="deadline_mode", create_constraint=True),
            server_default="display",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_deadlines_id"), "deadlines", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_deadlines_id"), table_name="deadlines")
    op.drop_table("deadlines")
