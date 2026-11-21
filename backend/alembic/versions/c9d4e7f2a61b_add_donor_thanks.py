"""add donor_thanks table (admin thank-you-emails tracker)

Revision ID: c9d4e7f2a61b
Revises: f6b8c2d4e1a7
Create Date: 2026-11-20 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c9d4e7f2a61b"
down_revision: Union[str, None] = "f6b8c2d4e1a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "donor_thanks",
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("thanked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("thanked_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["thanked_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("email"),
    )
    op.create_index(op.f("ix_donor_thanks_thanked_at"), "donor_thanks", ["thanked_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_donor_thanks_thanked_at"), table_name="donor_thanks")
    op.drop_table("donor_thanks")
