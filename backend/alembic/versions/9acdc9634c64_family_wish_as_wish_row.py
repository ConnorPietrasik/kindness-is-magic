"""family wish as a wish row

Revision ID: 9acdc9634c64
Revises: a96b2724cd3c
Create Date: 2026-08-30 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9acdc9634c64"
down_revision: Union[str, None] = "a96b2724cd3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres enums have no ADD VALUE via op; use raw SQL outside the
    # migration transaction (autocommit block).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE wish_type ADD VALUE 'family'")

    # Wishes now belong to exactly one owner: a person or a family.
    op.add_column("wish", sa.Column("family_id", sa.Integer(), nullable=True))
    op.create_foreign_key("wish_family_id_fkey", "wish", "family", ["family_id"], ["id"])
    op.alter_column("wish", "person_id", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "ck_wish_exactly_one_owner",
        "wish",
        sa.text("((person_id IS NOT NULL) <> (family_id IS NOT NULL))"),
    )

    # Family wish descriptions share the (longer) wish description column.
    op.alter_column(
        "wish",
        "description",
        type_=sa.String(100),
        existing_type=sa.String(60),
        nullable=False,
    )

    # At most one active family wish per family (mirrors the person index).
    op.create_index(
        "uq_wish_family_type_active",
        "wish",
        ["family_id", "type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("ix_wish_family_id_deleted_at", "wish", ["family_id", "deleted_at"], unique=False)

    # The family wish is no longer a column on family.
    op.drop_column("family", "family_wish")


def downgrade() -> None:
    # No downgrade — the database is wiped regularly (no backfill).
    raise NotImplementedError("No downgrade for this migration")
