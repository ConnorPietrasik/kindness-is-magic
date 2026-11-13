"""add zeffy_payments mirror table (admin unmatched-payments banner)

Revision ID: 9b4d2c7f1e3a
Revises: 137f0fd6e20c
Create Date: 2026-02-22 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9b4d2c7f1e3a"
down_revision: Union[str, None] = "137f0fd6e20c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "zeffy_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("payment_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("buyer_email", sa.String(length=120), nullable=True),
        sa.Column("buyer_name", sa.String(length=200), nullable=True),
        sa.Column("campaign_id", sa.String(length=64), nullable=True),
        sa.Column("receipt_url", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("refund_status", sa.String(length=20), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["seen_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_zeffy_payments_id"), "zeffy_payments", ["id"], unique=False)
    op.create_index(op.f("uq_zeffy_payments_payment_id"), "zeffy_payments", ["payment_id"], unique=True)
    op.create_index(op.f("ix_zeffy_payments_created_at"), "zeffy_payments", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_zeffy_payments_created_at"), table_name="zeffy_payments")
    op.drop_index(op.f("uq_zeffy_payments_payment_id"), table_name="zeffy_payments")
    op.drop_index(op.f("ix_zeffy_payments_id"), table_name="zeffy_payments")
    op.drop_table("zeffy_payments")
