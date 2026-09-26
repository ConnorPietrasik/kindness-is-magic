"""add claim payment fields

Revision ID: f72f95b4f804
Revises: 817034db462e
Create Date: 2026-09-22 14:10:15.750221

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f72f95b4f804"
down_revision: Union[str, None] = "817034db462e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres enum types are not auto-created by add_column — create it first.
    sa.Enum("pending", "paid", name="claim_payment_status", create_constraint=True).create(op.get_bind(), checkfirst=True)
    # Existing rows are gift or pre-Zeffy claims — the server default marks
    # them all "paid" (cash-only "pending" is introduced with the cart flow).
    op.add_column(
        "family_claims",
        sa.Column(
            "payment_status",
            sa.Enum("pending", "paid", name="claim_payment_status", create_constraint=True),
            server_default="paid",
            nullable=False,
        ),
    )
    op.add_column("family_claims", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    # One payment covers every claim in the cart at once — indexed, not unique.
    op.add_column("family_claims", sa.Column("zeffy_payment_id", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_family_claims_zeffy_payment_id"), "family_claims", ["zeffy_payment_id"], unique=False)
    op.add_column(
        "family_claims",
        sa.Column("includes_groceries", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    # The SentEmail.kind column maps to the native email_kind enum type, which
    # an earlier migration created without the payment-flow kinds — extend it.
    # (ADD VALUE cannot run inside a migration transaction: use an autocommit
    # block; the values are unused in this migration, so it is safe.)
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE email_kind ADD VALUE IF NOT EXISTS 'payment_request'")
        op.execute("ALTER TYPE email_kind ADD VALUE IF NOT EXISTS 'payment_confirmed'")
        op.execute("ALTER TYPE email_kind ADD VALUE IF NOT EXISTS 'payment_expired'")


def downgrade() -> None:
    op.drop_column("family_claims", "includes_groceries")
    op.drop_index(op.f("ix_family_claims_zeffy_payment_id"), table_name="family_claims")
    op.drop_column("family_claims", "zeffy_payment_id")
    op.drop_column("family_claims", "paid_at")
    # The column must go before the enum type — the type cannot be dropped
    # while payment_status still depends on it.
    op.drop_column("family_claims", "payment_status")
    sa.Enum("pending", "paid", name="claim_payment_status", create_constraint=True).drop(op.get_bind())
