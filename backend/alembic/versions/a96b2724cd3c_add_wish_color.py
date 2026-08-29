"""add wish color

Revision ID: a96b2724cd3c
Revises: e22a093e59ad
Create Date: 2026-08-29 10:04:43.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a96b2724cd3c"
down_revision: Union[str, None] = "e22a093e59ad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wish", sa.Column("color", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("wish", "color")
