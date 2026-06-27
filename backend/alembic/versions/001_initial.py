"""initial state + orphan referrer seed

Revision ID: 001_initial
Revises:
Create Date: 2026-06-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str]] = None
depends_on: Union[str, Sequence[str]] = None


def upgrade() -> None:
    # Create tables
    op.create_table('referrer',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('family_limit', sa.SmallInteger(), nullable=False),
    sa.Column('phone_number', sa.String(length=20), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_referrer_id'), 'referrer', ['id'], unique=False)

    # Seed the orphan referrer (id=0) BEFORE the family table is created,
    # so the FK default constraint is satisfied from the start.
    op.execute("INSERT INTO referrer (id, name, family_limit, phone_number) VALUES (0, 'Orphan', 999, '')")

    op.create_table('family',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('referrer_id', sa.Integer(), server_default='0', nullable=False),
    sa.Column('family_name', sa.String(length=40), nullable=False),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('address', sa.String(length=200), nullable=True),
    sa.Column('phone_number', sa.String(length=20), nullable=True),
    sa.Column('family_wish', sa.String(length=400), nullable=False),
    sa.Column('contact_name', sa.String(length=40), nullable=False),
    sa.ForeignKeyConstraint(['referrer_id'], ['referrer.id'], ondelete='SET DEFAULT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_family_id'), 'family', ['id'], unique=False)

    op.create_table('person',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('family_id', sa.Integer(), nullable=False),
    sa.Column('given_name', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=40), nullable=True),
    sa.Column('age', sa.Integer(), nullable=False),
    sa.Column('practical_wish', sa.String(length=400), nullable=False),
    sa.Column('fun_wish', sa.String(length=400), nullable=False),
    sa.Column('note', sa.String(length=400), nullable=True),
    sa.ForeignKeyConstraint(['family_id'], ['family.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_person_id'), 'person', ['id'], unique=False)

    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=120), nullable=False),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('admin', 'referrer', 'family', name='user_role', create_constraint=True), nullable=False),
    sa.Column('referrer_id', sa.Integer(), nullable=True),
    sa.Column('family_id', sa.Integer(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['family_id'], ['family.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['referrer_id'], ['referrer.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    op.create_table('referrer_invite_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('family_limit', sa.SmallInteger(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('redeemed_by_user_id', sa.Integer(), nullable=True),
    sa.Column('redeemed_by_referrer_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['redeemed_by_referrer_id'], ['referrer.id'], ),
    sa.ForeignKeyConstraint(['redeemed_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_referrer_invite_tokens_code'), 'referrer_invite_tokens', ['code'], unique=True)
    op.create_index(op.f('ix_referrer_invite_tokens_id'), 'referrer_invite_tokens', ['id'], unique=False)

    op.create_table('password_reset_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token', sa.String(length=255), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_password_reset_tokens_id'), 'password_reset_tokens', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_password_reset_tokens_id'), table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
    op.drop_index(op.f('ix_referrer_invite_tokens_id'), table_name='referrer_invite_tokens')
    op.drop_index(op.f('ix_referrer_invite_tokens_code'), table_name='referrer_invite_tokens')
    op.drop_table('referrer_invite_tokens')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_person_id'), table_name='person')
    op.drop_table('person')
    op.drop_index(op.f('ix_family_id'), table_name='family')
    op.drop_table('family')
    op.drop_index(op.f('ix_referrer_id'), table_name='referrer')
    op.drop_table('referrer')
