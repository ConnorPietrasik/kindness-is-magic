"""add purchaser role to user_role enum

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-08-03 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'purchaser' value to the user_role Postgres enum.
    # Must be placed AFTER an existing value (Postgres requirement).
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'purchaser' AFTER 'family'")


def downgrade() -> None:
    # Postgres does not support removing enum values directly.
    # Full rollback requires recreating the enum type and casting the column.
    # This is a destructive operation that is not automated here.
    # To fully revert, manually:
    #   1. Drop the user_role enum
    #   2. Recreate it without 'purchaser'
    #   3. Cast the users.role column to the new type
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum WHERE enumlabel = 'purchaser' AND enumtypid = 'user_role'::regtype
            ) THEN
                -- Recreate enum without 'purchaser'
                ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);
                ALTER TYPE user_role RENAME TO user_role_old;
                CREATE TYPE user_role AS ENUM ('admin', 'referrer', 'family');
                ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role;
                DROP TYPE user_role_old;
            END IF;
        END $$;
        """
    )
