"""add_referrer_invite_emails

Revision ID: 973400430110
Revises: 2146c29b3122
Create Date: 2026-07-31 10:18:26.307520

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "973400430110"
down_revision: Union[str, None] = "2146c29b3122"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "referrer_invite_emails",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "referrer_id",
            sa.Integer(),
            sa.ForeignKey("referrer.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("recipient_email", sa.String(120), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_referrer_invite_emails_referrer_sent",
        "referrer_invite_emails",
        ["referrer_id", "sent_at"],
    )
    op.create_index(
        "ix_referrer_invite_emails_recipient_sent",
        "referrer_invite_emails",
        ["recipient_email", "sent_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_referrer_invite_emails_recipient_sent", "referrer_invite_emails")
    op.drop_index("ix_referrer_invite_emails_referrer_sent", "referrer_invite_emails")
    op.drop_table("referrer_invite_emails")
