"""add family invite and approval

Revision ID: 20260720_000001
Revises: e3a800d03bb5
Create Date: 2026-07-20 00:00:01.000000

"""

from typing import Sequence, Union

import secrets
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260720_000001"
down_revision: Union[str, None] = "e3a800d03bb5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _generate_code() -> str:
    """Generate a KFI-XXXXXX code (same logic as app.auth.generate_invite_code)."""
    raw = secrets.token_urlsafe(6).upper()[:6]
    return f"KFI-{raw}"


def upgrade() -> None:
    # 1. Add family_approval_status enum type
    family_approval_status = sa.Enum(
        "pending",
        "approved",
        "rejected",
        name="family_approval_status",
        create_type=True,
    )
    family_approval_status.create(op.get_bind())

    # 2. Add family_invite_code column on referrer table
    op.add_column(
        "referrer",
        sa.Column("family_invite_code", sa.String(10), nullable=True),
    )
    op.create_unique_constraint(
        "uq_referrer_family_invite_code",
        "referrer",
        ["family_invite_code"],
    )
    op.create_index(
        "ix_referrer_family_invite_code",
        "referrer",
        ["family_invite_code"],
        unique=False,
    )

    # 3. Add approval_status column on family table with server default 'pending'
    op.add_column(
        "family",
        sa.Column(
            "approval_status",
            family_approval_status,
            server_default="pending",
            nullable=False,
        ),
    )

    # 4. Populate family_invite_code for existing referrers
    conn = op.get_bind()
    referrers = conn.execute(sa.text("SELECT id FROM referrer WHERE family_invite_code IS NULL")).fetchall()
    for (ref_id,) in referrers:
        code = _generate_code()
        conn.execute(
            sa.text("UPDATE referrer SET family_invite_code = :code WHERE id = :id"),
            {"code": code, "id": ref_id},
        )

    # 5. Set all existing families to 'approved'
    conn.execute(sa.text("UPDATE family SET approval_status = 'approved' WHERE approval_status IS NULL"))

    # 6. Alter referrer_invite_tokens.code from String(20) to String(10)
    # Postgres allows this in-place if all values fit
    op.alter_column(
        "referrer_invite_tokens",
        "code",
        type_=sa.String(10),
        existing_type=sa.String(20),
    )

    # 7. Update existing codes from KMG- prefix to KRI- prefix
    conn.execute(sa.text("UPDATE referrer_invite_tokens SET code = 'KRI-' || SUBSTRING(code FROM 5) WHERE code LIKE 'KMG-%'"))


def downgrade() -> None:
    # Reverse the code prefix change
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE referrer_invite_tokens SET code = 'KMG-' || SUBSTRING(code FROM 5) WHERE code LIKE 'KRI-%'"))

    # Revert code column size
    op.alter_column(
        "referrer_invite_tokens",
        "code",
        type_=sa.String(20),
        existing_type=sa.String(10),
    )

    # Drop approval_status column
    op.drop_column("family", "approval_status")

    # Drop family_invite_code index, constraint, and column
    op.drop_index("ix_referrer_family_invite_code", table_name="referrer")
    op.drop_constraint("uq_referrer_family_invite_code", "referrer", type_="unique")
    op.drop_column("referrer", "family_invite_code")

    # Drop enum type
    family_approval_status = sa.Enum(name="family_approval_status")
    family_approval_status.drop(op.get_bind())
