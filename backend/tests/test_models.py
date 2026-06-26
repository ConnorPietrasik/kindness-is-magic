"""Tests for SQLAlchemy models."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Base,
    Family,
    Person,
    PasswordResetToken,
    Referrer,
    User,
    UserRole,
)


class TestUser:
    def test_create_user(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="test@example.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        assert user.id is not None
        assert user.email == "test@example.com"
        assert user.role == UserRole.admin
        assert user.is_active is True
        assert user.created_at is not None

    def test_user_email_unique(self, db: Session):
        from app.auth import get_password_hash

        db.add(
            User(
                email="unique@test.com",
                hashed_password=get_password_hash("Pass1234!"),
                role=UserRole.admin,
            )
        )
        db.commit()

        with pytest.raises(Exception):  # IntegrityError
            db.add(
                User(
                    email="unique@test.com",
                    hashed_password=get_password_hash("Pass1234!"),
                    role=UserRole.admin,
                )
            )
            db.commit()

    def test_user_roles(self, db: Session):
        from app.auth import get_password_hash

        for role in UserRole:
            user = User(
                email=f"{role.value}@test.com",
                hashed_password=get_password_hash("Pass1234!"),
                role=role,
            )
            db.add(user)
        db.commit()
        assert db.query(User).count() == len(UserRole)


class TestReferrer:
    def test_create_referrer(self, db: Session):
        r = Referrer(
            name="Alice Smith",
            family_limit=5,
            phone_number="555-1234",
        )
        db.add(r)
        db.commit()
        db.refresh(r)
        assert r.id is not None
        assert r.name == "Alice Smith"


class TestFamily:
    def test_create_family(self, db: Session):
        f = Family(
            referrer_id=Family.ORPHAN_REFERRER_ID,
            family_name="The Smiths",
            family_wish="A new roof",
            contact_name="John Smith",
        )
        db.add(f)
        db.commit()
        db.refresh(f)
        assert f.id is not None
        assert f.family_name == "The Smiths"

    def test_family_orphan_default_referrer(self, db: Session):
        f = Family(
            family_name="DefaultFamily",
            family_wish="Peace",
            contact_name="Contact",
        )
        db.add(f)
        db.commit()
        db.refresh(f)
        assert f.referrer_id == Family.ORPHAN_REFERRER_ID


class TestPerson:
    def test_create_person(self, db: Session):
        family = Family(
            family_name="TestFamily",
            family_wish="Wish",
            contact_name="Contact",
        )
        db.add(family)
        db.commit()
        db.refresh(family)

        person = Person(
            family_id=family.id,
            given_name="Bob",
            age=10,
            practical_wish="Bicycle",
            fun_wish="Rollercoaster",
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        assert person.id is not None
        assert person.given_name == "Bob"

    def test_person_with_title(self, db: Session):
        family = Family(
            family_name="TestFamily",
            family_wish="Wish",
            contact_name="Contact",
        )
        db.add(family)
        db.commit()
        db.refresh(family)

        person = Person(
            family_id=family.id,
            given_name="Alice",
            title="Miss",
            age=8,
            practical_wish="Books",
            fun_wish="Cinema",
            note="Loves reading",
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        assert person.title == "Miss"
        assert person.note == "Loves reading"


class TestPasswordResetToken:
    def test_create_token(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="token@test.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        token = PasswordResetToken(
            user_id=user.id,
            token="raw-token",
            expires_at=datetime.now(timezone.utc).replace(hour=23),
        )
        db.add(token)
        db.commit()
        db.refresh(token)

        assert token.id is not None
        assert token.used is False
        assert token.user_id == user.id

    def test_token_relationship(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="rel@test.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        token = PasswordResetToken(
            user_id=user.id,
            token="raw",
            expires_at=datetime.now(timezone.utc).replace(hour=23),
        )
        db.add(token)
        db.commit()

        # Reload to test relationship
        user = db.query(User).filter(User.id == user.id).first()
        assert len(user.reset_tokens) == 1
