"""add email campaign state segments

Revision ID: c7d4a1e9f2b3
Revises: b13c4344f1a6
Create Date: 2026-02-20 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c7d4a1e9f2b3"
down_revision: Union[str, None] = "b13c4344f1a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
    # Alembic wraps Postgres migrations in one — run it in an autocommit
    # block (the new value is not used until later statements, which is
    # allowed). The existence check makes the upgrade re-runnable after a
    # downgrade: Postgres cannot remove enum values (see downgrade), so a
    # downgraded-then-re-upgraded database already has the value and the
    # unconditional ADD VALUE would fail with a duplicate enum label.
    with op.get_context().autocommit_block():
        value_exists = (
            op.get_bind()
            .exec_driver_sql(
                "SELECT 1 FROM pg_enum e "
                "JOIN pg_type t ON t.oid = e.enumtypid "
                "WHERE t.typname = 'email_campaign_recipient_source' "
                "AND e.enumlabel = 'segment'"
            )
            .first()
        )
        if value_exists is None:
            op.execute("ALTER TYPE email_campaign_recipient_source ADD VALUE 'segment'")
    op.add_column(
        "email_campaigns",
        sa.Column("segments", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("email_campaigns", "segments")
    # Postgres cannot remove enum values — no-op.
