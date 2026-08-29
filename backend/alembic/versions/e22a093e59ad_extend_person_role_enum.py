"""extend_person_role_enum

Revision ID: e22a093e59ad
Revises: 44cc0fedb656
Create Date: 2026-08-29 05:57:19.597525

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e22a093e59ad"
down_revision: Union[str, None] = "44cc0fedb656"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres enums have no ADD VALUE via op; use raw SQL (PG 12+ allows
    # this inside a transaction). AFTER keeps the type's value order in
    # sync with the PersonRole enum in models.py.
    op.execute("ALTER TYPE person_role ADD VALUE 'aunt' AFTER 'grandmother'")
    op.execute("ALTER TYPE person_role ADD VALUE 'uncle' AFTER 'aunt'")
    op.execute("ALTER TYPE person_role ADD VALUE 'cousin' AFTER 'uncle'")
    op.execute("ALTER TYPE person_role ADD VALUE 'nephew' AFTER 'cousin'")
    op.execute("ALTER TYPE person_role ADD VALUE 'niece' AFTER 'nephew'")
    op.execute("ALTER TYPE person_role ADD VALUE 'cat' AFTER 'niece'")
    op.execute("ALTER TYPE person_role ADD VALUE 'dog' AFTER 'cat'")


def downgrade() -> None:
    # Postgres has no DROP VALUE: rebuild the type with the original values.
    # Destructive for rows holding the new values — acceptable, the dev DB
    # is wiped regularly (same style as 44cc0fedb656's downgrade).
    original = ("son", "daughter", "grandson", "granddaughter", "mother", "father", "grandfather", "grandmother")
    op.execute("ALTER TABLE person ALTER COLUMN role TYPE VARCHAR(40) USING role::text")
    op.execute("DROP TYPE person_role")
    op.execute(f"CREATE TYPE person_role AS ENUM ({', '.join(repr(v) for v in original)})")
    op.execute("ALTER TABLE person ALTER COLUMN role TYPE person_role USING role::person_role")
