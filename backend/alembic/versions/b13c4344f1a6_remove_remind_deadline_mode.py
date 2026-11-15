"""remove the remind deadline mode

Revision ID: b13c4344f1a6
Revises: b3e7a91c4d2f
Create Date: 2026-02-14 09:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b13c4344f1a6"
down_revision: Union[str, None] = "b3e7a91c4d2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres cannot remove a value from an existing enum type — recreate
    # the type without 'remind'. The USING cast aborts the migration (and
    # rolls back) if any row still holds 'remind', so a stale row can never
    # be silently lost. Reminder emails are scheduled email campaigns, not
    # deadline rows. The column's server default is typed to the old enum,
    # so it must be dropped before the retyping and re-added after.
    op.execute("CREATE TYPE deadline_mode_new AS ENUM ('display', 'enforced')")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode DROP DEFAULT")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode TYPE deadline_mode_new USING mode::text::deadline_mode_new")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode SET DEFAULT 'display'")
    op.execute("DROP TYPE deadline_mode")
    op.execute("ALTER TYPE deadline_mode_new RENAME TO deadline_mode")


def downgrade() -> None:
    op.execute("CREATE TYPE deadline_mode_new AS ENUM ('display', 'remind', 'enforced')")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode DROP DEFAULT")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode TYPE deadline_mode_new USING mode::text::deadline_mode_new")
    op.execute("ALTER TABLE deadlines ALTER COLUMN mode SET DEFAULT 'display'")
    op.execute("DROP TYPE deadline_mode")
    op.execute("ALTER TYPE deadline_mode_new RENAME TO deadline_mode")
