"""family approval -> verification

Revision ID: 23dbaf52bb4c
Revises: 1795ea426c7b
Create Date: 2026-08-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "23dbaf52bb4c"
down_revision: Union[str, None] = "1795ea426c7b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The family approval status is renamed to a verification status:
    # the referrer confirms that a referred family is one they intended
    # to refer. Rename the Postgres enum type, its 'approved' value, the
    # family column, and the email_kind 'family_approved' value.
    #
    # (The referrer_approval_status enum and the wish-approval flow are
    # separate concepts and are untouched.)
    op.execute("ALTER TYPE family_approval_status RENAME TO family_verification_status")
    op.execute("ALTER TYPE family_verification_status RENAME VALUE 'approved' TO 'verified'")
    op.execute("ALTER TABLE family RENAME COLUMN approval_status TO verification_status")
    op.execute("ALTER TYPE email_kind RENAME VALUE 'family_approved' TO 'family_verified'")


def downgrade() -> None:
    op.execute("ALTER TYPE email_kind RENAME VALUE 'family_verified' TO 'family_approved'")
    op.execute("ALTER TABLE family RENAME COLUMN verification_status TO approval_status")
    op.execute("ALTER TYPE family_verification_status RENAME VALUE 'verified' TO 'approved'")
    op.execute("ALTER TYPE family_verification_status RENAME TO family_approval_status")
