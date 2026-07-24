"""add deleted_at to user

Revision ID: 8ae5bf451dbe
Revises: 20260720_000001
Create Date: 2026-07-24 09:59:15.740761

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8ae5bf451dbe"
down_revision: Union[str, None] = "20260720_000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
