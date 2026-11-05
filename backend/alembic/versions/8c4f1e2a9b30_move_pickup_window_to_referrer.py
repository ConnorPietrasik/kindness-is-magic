"""move pickup window from family to referrer

The pickup window is a referrer-level setting: the referrer picks up the
gifts and handles the last leg. No data is copied — no family carried a
non-NULL window in production when this shipped (any local dev values are
disposable).

Revision ID: 8c4f1e2a9b30
Revises: 2f2d3daa79a1
Create Date: 2026-11-05 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8c4f1e2a9b30"
down_revision: Union[str, None] = "2f2d3daa79a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("referrer", sa.Column("pickup_window", sa.DateTime(timezone=True), nullable=True))
    op.drop_column("family", "pickup_window")


def downgrade() -> None:
    op.add_column("family", sa.Column("pickup_window", sa.DateTime(timezone=True), nullable=True))
    op.drop_column("referrer", "pickup_window")
