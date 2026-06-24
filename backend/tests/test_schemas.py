"""Tests for Pydantic schemas."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import (
    ChangePassword,
    ForgotPassword,
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
