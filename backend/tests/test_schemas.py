"""Tests for Pydantic schemas."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import (
    ChangePassword,
    FamilyCreate,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    FamilyUpdate,
    ForgotPassword,
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
    ReferrerCreate,
    ReferrerDetail,
    ReferrerListResponse,
    ReferrerSummary,
    ReferrerUpdate,
    ResetPassword,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.models import UserRole


class TestUserCreate:
    def test_valid_admin(self):
        data = UserCreate(
            email="admin@test.com",
            password="Pass12345!",
            role=UserRole.admin,
        )
        assert data.email == "admin@test.com"
        assert data.role == UserRole.admin

    def test_email_normalized(self):
        data = UserCreate(
            email="Admin@Test.COM",
            password="Pass12345!",
            role=UserRole.admin,
        )
        assert data.email == "admin@test.com"

    def test_password_too_short(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="test@test.com",
                password="Short",
                role=UserRole.admin,
            )

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="not-an-email",
                password="Pass12345!",
                role=UserRole.admin,
            )

    def test_referrer_with_referrer_id(self):
        data = UserCreate(
            email="ref@test.com",
            password="Pass12345!",
            role=UserRole.referrer,
            referrer_id=42,
        )
        assert data.referrer_id == 42

    def test_family_with_family_id(self):
        data = UserCreate(
            email="fam@test.com",
            password="Pass12345!",
            role=UserRole.family,
            family_id=7,
        )
        assert data.family_id == 7


class TestUserLogin:
    def test_valid_login(self):
        data = UserLogin(email="test@test.com", password="Pass12345!")
        assert data.email == "test@test.com"

    def test_email_normalized(self):
        data = UserLogin(email="Test@Test.COM", password="Pass12345!")
        assert data.email == "test@test.com"

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            UserLogin(email="bad", password="Pass12345!")


class TestChangePassword:
    def test_valid(self):
        data = ChangePassword(old_password="Old1234!", new_password="New12345!")
        assert data.old_password == "Old1234!"
        assert data.new_password == "New12345!"

    def test_new_password_too_short(self):
        with pytest.raises(ValidationError):
            ChangePassword(old_password="Old1234!", new_password="Short")


class TestForgotPassword:
    def test_valid(self):
        data = ForgotPassword(email="test@test.com")
        assert data.email == "test@test.com"

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            ForgotPassword(email="bad")


class TestResetPassword:
    def test_valid(self):
        data = ResetPassword(token="abc123", new_password="New12345!")
        assert data.token == "abc123"

    def test_new_password_too_short(self):
        with pytest.raises(ValidationError):
            ResetPassword(token="abc123", new_password="Short")


class TestUserResponse:
    def test_from_orm(self):
        from app.models import User

        user = User(
            id=1,
            email="test@test.com",
            hashed_password="$2b$12$fakehash",
            role=UserRole.admin,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        resp = UserResponse.model_validate(user)
        assert resp.email == "test@test.com"
        assert resp.role == UserRole.admin
        assert resp.is_active is True
        assert not hasattr(resp, "hashed_password")


# ---------------------------------------------------------------------------
# Referrer schemas
# ---------------------------------------------------------------------------


class TestReferrerCreate:
    def test_valid(self):
        data = ReferrerCreate(
            name="Test Referrer",
            family_limit=10,
            phone_number="555-0001",
        )
        assert data.name == "Test Referrer"
        assert data.family_limit == 10
        assert data.phone_number == "555-0001"

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(
                name="",
                family_limit=10,
                phone_number="555-0001",
            )

    def test_name_too_long_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(
                name="x" * 61,
                family_limit=10,
                phone_number="555-0001",
            )

    def test_family_limit_zero_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(
                name="Test",
                family_limit=0,
                phone_number="555-0001",
            )

    def test_family_limit_too_high_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(
                name="Test",
                family_limit=1000,
                phone_number="555-0001",
            )

    def test_empty_phone_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(
                name="Test",
                family_limit=10,
                phone_number="",
            )


class TestReferrerUpdate:
    def test_all_optional(self):
        data = ReferrerUpdate()
        assert data.name is None
        assert data.family_limit is None
        assert data.phone_number is None

    def test_partial(self):
        data = ReferrerUpdate(name="New Name")
        assert data.name == "New Name"
        assert data.family_limit is None

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerUpdate(name="")

    def test_family_limit_zero_rejected(self):
        with pytest.raises(ValidationError):
            ReferrerUpdate(family_limit=0)


class TestReferrerDetail:
    def test_has_family_count(self):
        d = ReferrerDetail(
            id=1,
            name="Test",
            family_limit=10,
            phone_number="555-0001",
            family_count=3,
        )
        assert d.family_count == 3


class TestReferrerListResponse:
    def test_with_referrers(self):
        summary = ReferrerSummary(id=1, name="Test", family_limit=10)
        resp = ReferrerListResponse(referrers=[summary])
        assert len(resp.referrers) == 1
        assert resp.referrers[0].name == "Test"


# ---------------------------------------------------------------------------
# Family schemas
# ---------------------------------------------------------------------------


class TestFamilyCreate:
    def test_valid_required_only(self):
        data = FamilyCreate(
            referrer_id=1,
            family_name="Test Family",
            family_wish="World peace",
            contact_name="Jane Doe",
        )
        assert data.referrer_id == 1
        assert data.bio is None
        assert data.address is None
        assert data.phone_number is None

    def test_valid_all_fields(self):
        data = FamilyCreate(
            referrer_id=1,
            family_name="Test Family",
            family_wish="World peace",
            contact_name="Jane Doe",
            bio="We love peace",
            address="123 Main St",
            phone_number="555-0001",
        )
        assert data.bio == "We love peace"
        assert data.address == "123 Main St"

    def test_empty_family_name_rejected(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="",
                family_wish="Peace",
                contact_name="Jane",
            )

    def test_empty_family_wish_rejected(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="Test",
                family_wish="",
                contact_name="Jane",
            )

    def test_empty_contact_name_rejected(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="Test",
                family_wish="Peace",
                contact_name="",
            )


class TestFamilyUpdate:
    def test_all_optional(self):
        data = FamilyUpdate()
        assert data.family_name is None

    def test_partial(self):
        data = FamilyUpdate(family_name="Updated Family")
        assert data.family_name == "Updated Family"

    def test_empty_family_name_rejected(self):
        with pytest.raises(ValidationError):
            FamilyUpdate(family_name="")


class TestFamilyDetail:
    def test_has_person_count(self):
        d = FamilyDetail(
            id=1,
            referrer_id=2,
            family_name="Test",
            bio=None,
            address=None,
            phone_number=None,
            family_wish="Peace",
            contact_name="Jane",
            person_count=5,
        )
        assert d.person_count == 5


class TestFamilySummary:
    def test_minimal(self):
        s = FamilySummary(id=1, family_name="Test", family_wish="Peace", contact_name="Jane", referrer_id=2)
        assert s.id == 1
        assert s.family_name == "Test"
        assert s.family_wish == "Peace"
        assert s.contact_name == "Jane"
        assert s.referrer_id == 2
        assert s.person_count == 0


class TestFamilyListResponse:
    def test_with_families(self):
        summary = FamilySummary(id=1, family_name="Test", family_wish="Peace", contact_name="Jane", referrer_id=1)
        resp = FamilyListResponse(families=[summary])
        assert len(resp.families) == 1


# ---------------------------------------------------------------------------
# Person schemas
# ---------------------------------------------------------------------------


class TestPersonCreate:
    def test_valid_required_only(self):
        data = PersonCreate(
            family_id=1,
            given_name="Alice",
            age=8,
            practical_wish="A backpack",
            fun_wish="A doll",
        )
        assert data.family_id == 1
        assert data.title is None
        assert data.note is None

    def test_valid_all_fields(self):
        data = PersonCreate(
            family_id=1,
            given_name="Alice",
            age=8,
            practical_wish="A backpack",
            fun_wish="A doll",
            title="Miss",
            note="Allergic to peanuts",
        )
        assert data.title == "Miss"
        assert data.note == "Allergic to peanuts"

    def test_empty_given_name_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="",
                age=8,
                practical_wish="A backpack",
                fun_wish="A doll",
            )

    def test_age_negative_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=-1,
                practical_wish="A backpack",
                fun_wish="A doll",
            )

    def test_age_over_200_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=201,
                practical_wish="A backpack",
                fun_wish="A doll",
            )

    def test_age_zero_allowed(self):
        data = PersonCreate(
            family_id=1,
            given_name="Alice",
            age=0,
            practical_wish="A backpack",
            fun_wish="A doll",
        )
        assert data.age == 0

    def test_empty_practical_wish_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=8,
                practical_wish="",
                fun_wish="A doll",
            )

    def test_empty_fun_wish_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=8,
                practical_wish="A backpack",
                fun_wish="",
            )


class TestPersonUpdate:
    def test_all_optional(self):
        data = PersonUpdate()
        assert data.given_name is None
        assert data.age is None

    def test_partial(self):
        data = PersonUpdate(given_name="Alicia", age=9)
        assert data.given_name == "Alicia"
        assert data.age == 9

    def test_empty_given_name_rejected(self):
        with pytest.raises(ValidationError):
            PersonUpdate(given_name="")

    def test_age_negative_rejected(self):
        with pytest.raises(ValidationError):
            PersonUpdate(age=-1)


class TestPersonDetail:
    def test_has_all_fields(self):
        d = PersonDetail(
            id=1,
            family_id=2,
            given_name="Alice",
            title="Miss",
            age=8,
            practical_wish="A backpack",
            fun_wish="A doll",
            note=None,
        )
        assert d.given_name == "Alice"
        assert d.title == "Miss"
        assert d.note is None


class TestPersonSummary:
    def test_minimal(self):
        s = PersonSummary(id=1, family_id=2, given_name="Alice", age=8)
        assert s.id == 1
        assert s.family_id == 2
        assert s.given_name == "Alice"
        assert s.age == 8


class TestPersonListResponse:
    def test_with_people(self):
        summary = PersonSummary(id=1, family_id=2, given_name="Alice", age=8)
        resp = PersonListResponse(people=[summary])
        assert len(resp.people) == 1
        assert resp.people[0].given_name == "Alice"
