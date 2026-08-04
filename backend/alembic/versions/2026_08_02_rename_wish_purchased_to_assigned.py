"""rename wish.purchased_by_id to assigned_to_id and add tracking fields

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old FK constraint (auto-named by initial migration — no explicit name given)
    op.drop_constraint("wish_purchased_by_id_fkey", "wish", type_="foreignkey")

    # Rename column
    op.alter_column("wish", "purchased_by_id", new_column_name="assigned_to_id")

    # Recreate FK with new name
    op.create_foreign_key(
        "fk_wish_assigned_to_id_users",
        "wish",
        "users",
        ["assigned_to_id"],
        ["id"],
    )

    # Add new columns
    op.add_column(
        "wish",
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "wish",
        sa.Column("purchaser_note", sa.String(400), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wish", "purchaser_note")
    op.drop_column("wish", "received_at")

    op.drop_constraint("fk_wish_assigned_to_id_users", "wish", type_="foreignkey")
    op.alter_column("wish", "assigned_to_id", new_column_name="purchased_by_id")
    op.create_foreign_key(
        "wish_purchased_by_id_fkey",
        "wish",
        "users",
        ["purchased_by_id"],
        ["id"],
    )
