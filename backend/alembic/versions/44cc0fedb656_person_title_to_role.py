"""person title to required role

Revision ID: 44cc0fedb656
Revises: aa5dcb2a4ba1
Create Date: 2026-08-29 00:18:00.265762

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "44cc0fedb656"
down_revision: Union[str, None] = "aa5dcb2a4ba1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # person.title (free text, nullable) is replaced by the required
    # person.role enum. The DB is wiped regularly, so no data migration.
    # The temporary server default lets the NOT NULL column be added on a
    # non-empty dev DB; it is dropped immediately after.
    op.drop_column("person", "title")
    # op.add_column does not emit CREATE TYPE for a Postgres native enum.
    op.execute(
        "CREATE TYPE person_role AS ENUM ('son', 'daughter', 'grandson', 'granddaughter', 'mother', 'father', 'grandfather', 'grandmother')"
    )
    op.add_column(
        "person",
        sa.Column(
            "role",
            sa.Enum(
                "son",
                "daughter",
                "grandson",
                "granddaughter",
                "mother",
                "father",
                "grandfather",
                "grandmother",
                name="person_role",
                create_constraint=True,
            ),
            server_default="son",
            nullable=False,
        ),
    )
    op.alter_column("person", "role", server_default=None)


def downgrade() -> None:
    op.add_column("person", sa.Column("title", sa.String(length=40), nullable=True))
    op.drop_column("person", "role")
    op.execute("DROP TYPE IF EXISTS person_role")
