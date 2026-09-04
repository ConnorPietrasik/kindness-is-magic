"""refresh_token_rotation_grace

Revision ID: 7f3c9b21e5a4
Revises: a96b2724cd3c, 9acdc9634c64
Create Date: 2026-09-04 07:38:01.000000

Merge revision: a96b2724cd3c (add_wish_color) and 9acdc9634c64
(family_wish_as_wish_row) both descend from e22a093e59ad, leaving two heads.
``alembic upgrade head`` (run on backend container start) fails with
"multiple head revisions" on a fresh database, so this revision closes the
branch. Both branches' DDL is already present in the deployed schema; the
merge itself adds no schema changes beyond the column below.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "7f3c9b21e5a4"
down_revision: Union[str, Sequence[str], None] = ("a96b2724cd3c", "9acdc9634c64")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Token rotation no longer deletes the old row: it stamps rotated_at so
    # a concurrent client (shared cookie jar across tabs) presenting the same
    # token within the grace window still succeeds.
    op.add_column("refresh_tokens", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # No downgrade needed in practice (dev DB is wiped regularly); provided
    # for completeness.
    op.drop_column("refresh_tokens", "rotated_at")
