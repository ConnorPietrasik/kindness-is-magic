"""Tests for SQLAlchemy models."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Family,
    Person,
    PasswordResetToken,
    Referrer,
    User,
    UserRole,
    Wish,
    WishType,
)


class TestUser:
    def test_create_user(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="test@example.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
            display_name=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        assert user.id is not None
        assert user.email == "test@example.com"
        assert user.role == UserRole.admin
        assert user.created_at is not None

    def test_user_email_unique(self, db: Session):
        from app.auth import get_password_hash

        db.add(
            User(
                email="unique@test.com",
                hashed_password=get_password_hash("Pass1234!"),
                role=UserRole.admin,
                display_name=None,
            )
        )
        db.commit()

        with pytest.raises(Exception):  # IntegrityError
            db.add(
                User(
                    email="unique@test.com",
                    hashed_password=get_password_hash("Pass1234!"),
                    role=UserRole.admin,
                    display_name=None,
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
                display_name=None,
            )
            db.add(user)
        db.commit()
        assert db.query(User).count() == len(UserRole)


class TestReferrer:
    def test_create_referrer(self, db: Session):
        r = Referrer(
            name="Alice Smith",
            family_limit=5,
            phone_number="555-123-1234",
            family_invite_code="KFI-ALICE",
        )
        db.add(r)
        db.commit()
        db.refresh(r)
        assert r.id is not None
        assert r.name == "Alice Smith"


class TestFamily:
    def test_create_family(self, db: Session):
        f = Family(
            family_name="The Smiths",
            family_wish="A new roof",
            contact_name="John Smith",
            phone_number="555-123-1234",
        )
        db.add(f)
        db.commit()
        db.refresh(f)
        assert f.id is not None
        assert f.family_name == "The Smiths"
        assert f.referrer_id is None


class TestPerson:
    def _create_family(self, db: Session) -> Family:
        family = Family(
            family_name="TestFamily",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
        )
        db.add(family)
        db.commit()
        db.refresh(family)
        return family

    def test_create_person(self, db: Session):
        family = self._create_family(db)

        person = Person(
            family_id=family.id,
            given_name="Bob",
            age=10,
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        assert person.id is not None
        assert person.given_name == "Bob"
        assert person.wishes == []

    def test_person_with_title(self, db: Session):
        family = self._create_family(db)

        person = Person(
            family_id=family.id,
            given_name="Alice",
            title="Miss",
            age=8,
            note="Loves reading",
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        assert person.title == "Miss"
        assert person.note == "Loves reading"

    def test_person_name_and_title_auto_capitalize(self, db: Session):
        family = self._create_family(db)

        # Lowercase inputs should be capitalized on create
        person = Person(
            family_id=family.id,
            given_name="emma",
            title="daughter",
            age=6,
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        assert person.given_name == "Emma"
        assert person.title == "Daughter"

        # Updating with lowercase should also capitalize
        person.given_name = "maria-elena"
        person.title = "granddaughter"
        db.commit()
        db.refresh(person)
        assert person.given_name == "Maria-elena"
        assert person.title == "Granddaughter"

        # None title should remain None
        person.title = None
        db.commit()
        db.refresh(person)
        assert person.title is None


class TestWish:
    def _create_person(self, db: Session) -> Person:
        family = Family(
            family_name="TestFamily",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
        )
        db.add(family)
        db.commit()
        db.refresh(family)

        person = Person(
            family_id=family.id,
            given_name="TestChild",
            age=10,
        )
        db.add(person)
        db.commit()
        db.refresh(person)
        return person

    def test_create_wish(self, db: Session):
        person = self._create_person(db)

        wish = Wish(
            person_id=person.id,
            type=WishType.practical,
            description="A backpack",
            size="Medium",
        )
        db.add(wish)
        db.commit()
        db.refresh(wish)

        assert wish.id is not None
        assert wish.type == WishType.practical
        assert wish.description == "A backpack"
        assert wish.size == "Medium"
        assert wish.assigned_to_id is None
        assert wish.purchased_at is None

    def test_wish_nullable_size(self, db: Session):
        person = self._create_person(db)

        wish = Wish(
            person_id=person.id,
            type=WishType.fun,
            description="A toy",
        )
        db.add(wish)
        db.commit()
        db.refresh(wish)

        assert wish.size is None

    def test_wish_unique_per_person_type(self, db: Session):
        person = self._create_person(db)

        wish1 = Wish(
            person_id=person.id,
            type=WishType.practical,
            description="A backpack",
        )
        db.add(wish1)
        db.commit()

        # Duplicate type for same person should fail
        with pytest.raises(Exception):  # IntegrityError
            wish2 = Wish(
                person_id=person.id,
                type=WishType.practical,
                description="Another backpack",
            )
            db.add(wish2)
            db.commit()

    def test_wish_soft_delete(self, db: Session):
        person = self._create_person(db)

        wish = Wish(
            person_id=person.id,
            type=WishType.fun,
            description="A toy",
        )
        db.add(wish)
        db.commit()

        # Soft delete
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(wish)
        assert wish.deleted_at is not None

        # Restore
        wish.deleted_at = None
        db.commit()
        db.refresh(wish)
        assert wish.deleted_at is None

    def test_wish_relationship_to_person(self, db: Session):
        person = self._create_person(db)

        wish1 = Wish(
            person_id=person.id,
            type=WishType.practical,
            description="A backpack",
        )
        wish2 = Wish(
            person_id=person.id,
            type=WishType.fun,
            description="A doll",
        )
        db.add_all([wish1, wish2])
        db.commit()

        # Reload person to test relationship
        person = db.query(Person).filter(Person.id == person.id).first()
        assert len(person.wishes) == 2
        types = {w.type for w in person.wishes}
        assert types == {WishType.practical, WishType.fun}

    def test_wish_assigned_to_relationship(self, db: Session):
        from app.auth import get_password_hash

        person = self._create_person(db)

        user = User(
            email="buyer@test.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
            display_name=None,
        )
        db.add(user)
        db.flush()

        wish = Wish(
            person_id=person.id,
            type=WishType.practical,
            description="A backpack",
            assigned_to_id=user.id,
        )
        db.add(wish)
        db.commit()
        db.refresh(wish)

        assert wish.assigned_to_id == user.id
        assert wish.assigned_to.email == "buyer@test.com"


class TestPasswordResetToken:
    def test_create_token(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="token@test.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
            display_name=None,
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
        assert token.used_at is None
        assert token.user_id == user.id

    def test_token_relationship(self, db: Session):
        from app.auth import get_password_hash

        user = User(
            email="rel@test.com",
            hashed_password=get_password_hash("Pass1234!"),
            role=UserRole.admin,
            display_name=None,
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
