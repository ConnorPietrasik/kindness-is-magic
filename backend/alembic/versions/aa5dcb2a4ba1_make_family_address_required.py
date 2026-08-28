"""make family address required

Revision ID: aa5dcb2a4ba1
Revises: 23dbaf52bb4c
Create Date: 2026-08-28 09:25:16.137257

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "aa5dcb2a4ba1"
down_revision: Union[str, None] = "23dbaf52bb4c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Address is mandatory from now on. The server default 'none' is the
    # conventional value for families without a street address; the DB is
    # wiped regularly, so no backfill is needed.
    op.alter_column("family", "address", type_=sa.String(200), nullable=False, server_default="none")


def downgrade() -> None:
    op.alter_column("family", "address", type_=sa.String(200), nullable=True, server_default=None)
