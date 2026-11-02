"""add family.cash_only lock

Revision ID: 2f2d3daa79a1
Revises: 305d96232fe2
Create Date: 2026-02-14 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "2f2d3daa79a1"
down_revision: Union[str, None] = "305d96232fe2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("family", sa.Column("cash_only", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    op.drop_column("family", "cash_only")
