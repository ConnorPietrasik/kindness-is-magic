"""add email campaign scheduling and drafts

Revision ID: b3e7a91c4d2f
Revises: 9b4d2c7f1e3a
Create Date: 2026-10-12 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b3e7a91c4d2f"
down_revision: Union[str, None] = "9b4d2c7f1e3a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
    # Alembic wraps Postgres migrations in one — run it in an autocommit
    # block (the new value is not used until a later statement, which is
    # allowed).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE email_campaign_status ADD VALUE 'draft'")
    op.add_column("email_campaigns", sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "email_campaigns",
        sa.Column("extra_emails", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("email_campaigns", "extra_emails")
    op.drop_column("email_campaigns", "scheduled_for")
    # Postgres cannot remove enum values — no-op.
