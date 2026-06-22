"""initial tables

Revision ID: 0001
Revises:
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### Referrer ###
    op.create_table(
        "referrer",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("limit", sa.SmallInteger(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone_number", sa.String(length=50), nullable=False),
    )
    op.create_index(op.f("ix_referrer_id"), "referrer", ["id"], unique=False)

    # Insert the orphan referrer (id=1)
    op.execute(
        "INSERT INTO referrer (id, \"limit\", email, phone_number) "
        "VALUES (1, 0, 'orphan@kindness.is-magic', '000-000-0000')"
    )

    # ### Family ###
    op.create_table(
        "family",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "referrer_id",
            sa.Integer(),
            sa.ForeignKey("referrer.id", ondelete="SET DEFAULT"),
            server_default="1",
            nullable=False,
        ),
        sa.Column("family_name", sa.String(length=255), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=False),
        sa.Column("phone_number", sa.String(length=50), nullable=False),
        sa.Column("family_wish", sa.String(length=500), nullable=False),
    )
    op.create_index(op.f("ix_family_id"), "family", ["id"], unique=False)

    # ### Person ###
    op.create_table(
        "person",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("family_id", sa.Integer(), nullable=False),
        sa.Column("given_name", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=50), nullable=True),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("practical_wish", sa.String(length=500), nullable=False),
        sa.Column("fun_wish", sa.String(length=500), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["family.id"]),
    )
    op.create_index(op.f("ix_person_id"), "person", ["id"], unique=False)


def downgrade() -> None:
    op.drop_table("person")
    op.drop_table("family")
    op.drop_table("referrer")
