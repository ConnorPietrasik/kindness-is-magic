"""Tests for /api/auth/* endpoints."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

class TestLogin:
    def test_login_success(self, test_client: TestClient, admin_user):
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "AdminPass123!"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["message"] == "Login successful"
        assert body["user"]["email"] == "admin@test.com"
        assert body["user"]["role"] == "admin"
        # Cookies should be set
        assert "access_token" in resp.cookies
        assert "refresh_token" in resp.cookies

    def test_login_wrong_password(self, test_client: TestClient, admin_user):
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "wrong"},
        )
        assert resp.status_code == 401
        assert "Incorrect email or password" in resp.json()["detail"]

    def test_login_nonexistent_user(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "whatever"},
        )
        assert resp.status_code == 401

    def test_login_inactive_user(self, test_client: TestClient, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="disabled@test.com",
            hashed_password=get_password_hash("Pass12345!"),
            role=UserRole.admin,
            is_active=False,
        )
        db.add(user)
        db.commit()

        resp = test_client.post(
            "/api/auth/login",
            json={"email": "disabled@test.com", "password": "Pass12345!"},
        )
        assert resp.status_code == 403
        assert "disabled" in resp.json()["detail"].lower()

    def test_login_email_normalised(self, test_client: TestClient, admin_user):
        """Email should be case-insensitive on login."""
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "ADMIN@TEST.COM", "password": "AdminPass123!"},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_success(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.json()["message"] == "Logged out"

    def test_logout_requires_auth(self, test_client: TestClient):
        resp = test_client.post("/api/auth/logout")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Register (admin-only)
# ---------------------------------------------------------------------------

class TestRegister:
    def test_register_admin_user(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "newadmin@test.com",
                "password": "NewAdminPass1!",
                "role": "admin",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "newadmin@test.com"
        assert body["role"] == "admin"
        assert "hashed_password" not in body

    def test_register_referrer_user(
        self, test_client: TestClient, admin_user, referrer_record
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "newref@test.com",
                "password": "NewRefPass1!",
                "role": "referrer",
                "referrer_id": referrer_record.id,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "referrer"

    def test_register_family_user(
        self, test_client: TestClient, admin_user, family_record
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "newfam@test.com",
                "password": "NewFamPass1!",
                "role": "family",
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "family"

    def test_register_non_admin_forbidden(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "hacker@test.com",
                "password": "HackPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 403

    def test_register_unauthenticated(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "nobody@test.com",
                "password": "Pass12345!",
                "role": "admin",
            },
        )
        assert resp.status_code == 401

    def test_register_duplicate_email(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        # First creation succeeds
        resp1 = test_client.post(
            "/api/auth/register",
            json={
                "email": "dup@test.com",
                "password": "DupPass1234!",
                "role": "admin",
            },
        )
        assert resp1.status_code == 201
        # Second creation with same email fails
        resp2 = test_client.post(
            "/api/auth/register",
            json={
                "email": "dup@test.com",
                "password": "DupPass1234!",
                "role": "admin",
            },
        )
        assert resp2.status_code == 409

    def test_register_admin_with_referrer_id_rejected(
        self, test_client: TestClient, admin_user, referrer_record
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "badadmin@test.com",
                "password": "BadPass1234!",
                "role": "admin",
                "referrer_id": referrer_record.id,
            },
        )
        assert resp.status_code == 400
        assert "must not have" in resp.json()["detail"]

    def test_register_referrer_missing_referrer_id(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "badref@test.com",
                "password": "BadPass1234!",
                "role": "referrer",
            },
        )
        assert resp.status_code == 400
        assert "must have a referrer_id" in resp.json()["detail"]

    def test_register_family_missing_family_id(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "badfam@test.com",
                "password": "BadPass1234!",
                "role": "family",
            },
        )
        assert resp.status_code == 400
        assert "must have a family_id" in resp.json()["detail"]

    def test_register_family_with_referrer_id_rejected(
        self, test_client: TestClient, admin_user, family_record, referrer_record
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "badfam2@test.com",
                "password": "BadPass1234!",
                "role": "family",
                "family_id": family_record.id,
                "referrer_id": referrer_record.id,
            },
        )
        assert resp.status_code == 400
        assert "must not have a referrer_id" in resp.json()["detail"]

    def test_register_referrer_with_family_id_rejected(
        self, test_client: TestClient, admin_user, referrer_record, family_record
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "badref2@test.com",
                "password": "BadPass1234!",
                "role": "referrer",
                "referrer_id": referrer_record.id,
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 400
        assert "must not have a family_id" in resp.json()["detail"]

    def test_register_referrer_id_not_found(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "orphan@test.com",
                "password": "OrphanPass1!",
                "role": "referrer",
                "referrer_id": 99999,
            },
        )
        assert resp.status_code == 404

    def test_register_family_id_not_found(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "orphan2@test.com",
                "password": "OrphanPass1!",
                "role": "family",
                "family_id": 99999,
            },
        )
        assert resp.status_code == 404

    def test_register_password_too_short(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "short@test.com",
                "password": "Short",
                "role": "admin",
            },
        )
        assert resp.status_code == 422  # validation error

    def test_register_invalid_email(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "not-an-email",
                "password": "GoodPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /api/auth/me
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_returns_profile(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "admin@test.com"
        assert body["role"] == "admin"
        assert body["is_active"] is True
        assert "hashed_password" not in body

    def test_me_requires_auth(self, test_client: TestClient):
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/auth/me/password (change own password)
# ---------------------------------------------------------------------------

class TestChangePassword:
    def test_change_password_success(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.put(
            "/api/auth/me/password",
            json={
                "old_password": "AdminPass123!",
                "new_password": "NewAdminPass1!",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "Password changed"

        # Old password should no longer work
        resp2 = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "AdminPass123!"},
        )
        assert resp2.status_code == 401

        # New password should work
        resp3 = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "NewAdminPass1!"},
        )
        assert resp3.status_code == 200

    def test_change_password_wrong_old(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.put(
            "/api/auth/me/password",
            json={
                "old_password": "WrongPass12!",
                "new_password": "NewAdminPass1!",
            },
        )
        assert resp.status_code == 400
        assert "Incorrect old password" in resp.json()["detail"]

    def test_change_password_new_too_short(
        self, test_client: TestClient, admin_user
    ):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.put(
            "/api/auth/me/password",
            json={
                "old_password": "AdminPass123!",
                "new_password": "Short",
            },
        )
        assert resp.status_code == 422

    def test_change_password_requires_auth(self, test_client: TestClient):
        resp = test_client.put(
            "/api/auth/me/password",
            json={"old_password": "x", "new_password": "y"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Forgot / Reset password
# ---------------------------------------------------------------------------

class TestForgotPassword:
    def test_forgot_password_existing_user(
        self, test_client: TestClient, admin_user
    ):
        resp = test_client.post(
            "/api/auth/forgot-password",
            json={"email": "admin@test.com"},
        )
        # Always 200 to prevent enumeration
        assert resp.status_code == 200
        assert "reset" in resp.json()["message"].lower() or "exists" in resp.json()["message"].lower()

    def test_forgot_password_nonexistent_user(self, test_client: TestClient):
        """Should still return 200 to avoid email enumeration."""
        resp = test_client.post(
            "/api/auth/forgot-password",
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 200

    def test_forgot_password_invalid_email(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/forgot-password",
            json={"email": "not-an-email"},
        )
        assert resp.status_code == 422


class TestResetPassword:
    def test_reset_password_success(
        self, test_client: TestClient, admin_user, db: Session
    ):
        from app.models import PasswordResetToken
        from app.auth import get_password_hash

        # Create a reset token (simulating forgot-password flow)
        raw_token = "test-reset-token-12345"
        reset = PasswordResetToken(
            user_id=admin_user.id,
            token=raw_token,
            expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59),
        )
        db.add(reset)
        db.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={
                "token": raw_token,
                "new_password": "ResetPass1234!",
            },
        )
        assert resp.status_code == 200
        assert "reset" in resp.json()["message"].lower()

        # New password should work
        login_resp = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "ResetPass1234!"},
        )
        assert login_resp.status_code == 200

    def test_reset_password_invalid_token(self, test_client: TestClient, admin_user):
        resp = test_client.post(
            "/api/auth/reset-password",
            json={
                "token": "totally-bad-token",
                "new_password": "NewPass12345!",
            },
        )
        assert resp.status_code == 400
        assert "Invalid or expired" in resp.json()["detail"]

    def test_reset_password_expired_token(
        self, test_client: TestClient, admin_user, db: Session
    ):
        from app.models import PasswordResetToken
        from app.auth import get_password_hash

        raw_token = "expired-token"
        reset = PasswordResetToken(
            user_id=admin_user.id,
            token=raw_token,
            expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc),  # long past
        )
        db.add(reset)
        db.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={
                "token": raw_token,
                "new_password": "NewPass12345!",
            },
        )
        assert resp.status_code == 400

    def test_reset_password_new_too_short(
        self, test_client: TestClient, admin_user, db: Session
    ):
        from app.models import PasswordResetToken
        from app.auth import get_password_hash

        raw_token = "short-pass-token"
        reset = PasswordResetToken(
            user_id=admin_user.id,
            token=raw_token,
            expires_at=datetime.now(timezone.utc).replace(hour=23),
        )
        db.add(reset)
        db.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={"token": raw_token, "new_password": "Short"},
        )
        assert resp.status_code == 422

    def test_reset_token_only_affects_its_owner(
        self, test_client: TestClient, admin_user, db: Session
    ):
        """A reset token only changes the password of its associated user,
        not someone else's."""
        from app.models import User, PasswordResetToken, UserRole
        from app.auth import get_password_hash

        # Create a second user
        user_b = User(
            email="userb@test.com",
            hashed_password=get_password_hash("UserBPass1234!"),
            role=UserRole.admin,
            is_active=True,
        )
        db.add(user_b)
        db.commit()
        db.refresh(user_b)

        # Create an unused reset token for user A (inserted first)
        raw_token_a = "token-for-user-a"
        reset_a = PasswordResetToken(
            user_id=admin_user.id,
            token=raw_token_a,
            expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59),
        )
        db.add(reset_a)
        db.commit()

        # Create an unused reset token for user B (inserted second)
        raw_token_b = "token-for-user-b"
        reset_b = PasswordResetToken(
            user_id=user_b.id,
            token=raw_token_b,
            expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59),
        )
        db.add(reset_b)
        db.commit()

        # Redeeming user B's token should only reset user B's password
        resp = test_client.post(
            "/api/auth/reset-password",
            json={
                "token": raw_token_b,
                "new_password": "BNewPass1234!",
            },
        )
        assert resp.status_code == 200

        # Verify user A's password was NOT changed
        login_a = test_client.post(
            "/api/auth/login",
            json={"email": "admin@test.com", "password": "AdminPass123!"},
        )
        assert login_a.status_code == 200, "User A's password should be unchanged"

        # Verify user B's password WAS changed
        login_b = test_client.post(
            "/api/auth/login",
            json={"email": "userb@test.com", "password": "BNewPass1234!"},
        )
        assert login_b.status_code == 200, "User B's password should have been reset"

        # Verify user B's old password no longer works
        login_b_old = test_client.post(
            "/api/auth/login",
            json={"email": "userb@test.com", "password": "UserBPass1234!"},
        )
        assert login_b_old.status_code == 401


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------

class TestRefresh:
    def test_refresh_success(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post("/api/auth/refresh")
        assert resp.status_code == 200
        body = resp.json()
        assert body["message"] == "Token refreshed"
        assert body["user"]["email"] == "admin@test.com"

    def test_refresh_no_cookie(self, test_client: TestClient):
        resp = test_client.post("/api/auth/refresh")
        assert resp.status_code == 401

    def test_refresh_invalid_token(self, test_client: TestClient):
        test_client.cookies.set("refresh_token", "garbage-token-value")
        resp = test_client.post("/api/auth/refresh")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Post-logout session invalidation
# ---------------------------------------------------------------------------

class TestAuthCookies:
    def test_logout_invalidates_session(self, test_client: TestClient, admin_user):
        """After logout, authenticated endpoints should reject the user.

        Cookie presence after login is already verified in
        TestLogin.test_login_success; this test focuses only on post-logout state.
        """
        login_as(test_client, "admin@test.com", "AdminPass123!")
        test_client.post("/api/auth/logout")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401
