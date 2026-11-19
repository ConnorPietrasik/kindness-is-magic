"""add referrer_invite_reminder email kind

Revision ID: f6b8c2d4e1a7
Revises: c7d4a1e9f2b3
Create Date: 2026-11-18 22:59:56.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f6b8c2d4e1a7"
down_revision: Union[str, None] = "c7d4a1e9f2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
    # Alembic wraps Postgres migrations in one — run it in an autocommit
    # block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE email_kind ADD VALUE 'referrer_invite_reminder'")


def downgrade() -> None:
    # Postgres cannot remove enum values — no-op.
    pass
