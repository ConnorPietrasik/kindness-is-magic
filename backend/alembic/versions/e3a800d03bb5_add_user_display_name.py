"""add_user_display_name

Revision ID: e3a800d03bb5
Revises: a5af136bf231
Create Date: 2026-07-19 08:52:08.803022

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e3a800d03bb5"
down_revision: Union[str, None] = "a5af136bf231"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "display_name")
