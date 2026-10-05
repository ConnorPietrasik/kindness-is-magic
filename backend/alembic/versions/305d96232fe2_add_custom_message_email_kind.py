"""add custom_message email kind

Revision ID: 305d96232fe2
Revises: 611834b4d826
Create Date: 2026-10-05 03:23:55.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "305d96232fe2"
down_revision: Union[str, None] = "611834b4d826"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
    # Alembic wraps Postgres migrations in one — run it in an autocommit
    # block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE email_kind ADD VALUE 'custom_message'")


def downgrade() -> None:
    # Postgres cannot remove enum values — no-op.
    pass
