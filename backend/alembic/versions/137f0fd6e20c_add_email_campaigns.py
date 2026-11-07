"""add email campaigns (admin batch email)

Revision ID: 137f0fd6e20c
Revises: 8c4f1e2a9b30
Create Date: 2026-02-20 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "137f0fd6e20c"
down_revision: Union[str, None] = "8c4f1e2a9b30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_campaigns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("message", sa.String(length=5000), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "sending", "completed", "canceled", name="email_campaign_status", create_constraint=True),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.Column("total_recipients", sa.Integer(), nullable=False),
        sa.Column("sent_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_email_campaigns_id"), "email_campaigns", ["id"], unique=False)
    op.create_table(
        "email_campaign_recipients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column(
            "source",
            sa.Enum("role", "manual", name="email_campaign_recipient_source", create_constraint=True),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "sent", "failed", "canceled", name="email_campaign_recipient_status", create_constraint=True),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("failure_reason", sa.String(length=255), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["email_campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_email_campaign_recipients_id"), "email_campaign_recipients", ["id"], unique=False)
    op.create_index(
        "ix_email_campaign_recipients_campaign_status",
        "email_campaign_recipients",
        ["campaign_id", "status"],
        unique=False,
    )
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
    # Alembic wraps Postgres migrations in one — run it in an autocommit
    # block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE email_kind ADD VALUE 'campaign'")


def downgrade() -> None:
    op.drop_index("ix_email_campaign_recipients_campaign_status", table_name="email_campaign_recipients")
    op.drop_index(op.f("ix_email_campaign_recipients_id"), table_name="email_campaign_recipients")
    op.drop_table("email_campaign_recipients")
    op.drop_index(op.f("ix_email_campaigns_id"), table_name="email_campaigns")
    op.drop_table("email_campaigns")
    # Postgres cannot remove enum values — no-op for email_kind.
