"""Tests for /api/auth/* endpoints."""

from datetime import datetime, timezone

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
        from datetime import datetime, timezone

        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="disabled@test.com",
            hashed_password=get_password_hash("Pass12345!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
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

    def test_change_password_new_too_short(self, test_client: TestClient, admin_user):
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

    def test_change_password_invalidates_reset_tokens(self, test_client: TestClient, admin_user, db: Session):
        """A password change should invalidate any pending reset tokens."""
        from app.models import PasswordResetToken

        # Create a pending reset token for the user
        reset = PasswordResetToken(
            user_id=admin_user.id,
            token="test-reset-token-xyz",
            expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59),
        )
        db.add(reset)
        db.commit()

        # Change the password
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.put(
            "/api/auth/me/password",
            json={
                "old_password": "AdminPass123!",
                "new_password": "NewAdminPass1!",
            },
        )
        assert resp.status_code == 200

        # The old reset token should no longer work
        resp = test_client.post(
            "/api/auth/reset-password",
            json={
                "token": "test-reset-token-xyz",
                "new_password": "AnotherPass1!",
            },
        )
        assert resp.status_code == 400
        assert "Invalid or expired" in resp.json()["detail"]

    def test_change_password_invalidates_refresh_tokens(self, test_client: TestClient, admin_user):
        """A password change should invalidate all active refresh tokens,
        forcing re-login on every device."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        refresh_before = test_client.cookies.get("refresh_token")

        # Change the password
        resp = test_client.put(
            "/api/auth/me/password",
            json={
                "old_password": "AdminPass123!",
                "new_password": "NewAdminPass1!",
            },
        )
        assert resp.status_code == 200

        # Old refresh token should no longer work
        test_client.cookies.set("refresh_token", refresh_before)
        resp = test_client.post("/api/auth/refresh")
        assert resp.status_code == 401
        assert "revoked" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Forgot / Reset password
# ---------------------------------------------------------------------------


class TestForgotPassword:
    def test_forgot_password_existing_user(self, test_client: TestClient, admin_user):
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

    def test_forgot_password_sends_email(self, test_client: TestClient, admin_user):
        """Password reset email is sent for a valid user (suppressed in tests)."""
        from unittest.mock import patch

        captured = {}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            captured["called"] = True
            captured["to"] = _kw.get("to") or _args[0]
            captured["exempt"] = _kw.get("exempt_unsubscribe", False)
            captured["include_unsub_link"] = _kw.get("include_unsubscribe_link", True)
            return {"sent": True, "reason": None}

        with patch("app.auth_routes.send_email", side_effect=fake_send_email):
            resp = test_client.post(
                "/api/auth/forgot-password",
                json={"email": "admin@test.com"},
            )
        assert resp.status_code == 200
        assert captured.get("called") is True
        assert captured["to"] == "admin@test.com"
        assert captured["exempt"] is True
        assert captured["include_unsub_link"] is False

    def test_forgot_password_no_email_for_unknown_user(self, test_client: TestClient):
        """No email is sent for unknown users (endpoint still returns 200)."""
        from unittest.mock import patch

        send_email_mock = patch("app.auth_routes.send_email", return_value={"sent": True, "reason": None})
        with send_email_mock as mock_fn:
            resp = test_client.post(
                "/api/auth/forgot-password",
                json={"email": "nobody@example.com"},
            )
        assert resp.status_code == 200
        mock_fn.assert_not_called()

    def test_forgot_password_unsubscribe_exempt(self, test_client: TestClient, admin_user, db: Session):
        """Unsubscribed users still receive password reset emails."""
        from unittest.mock import patch
        from app.models import EmailPreference
        from datetime import datetime as dt, timezone as tz

        # Mark the user as unsubscribed
        pref = EmailPreference(
            email="admin@test.com",
            unsubscribed_at=dt.now(tz.utc),
        )
        db.add(pref)
        db.commit()

        captured = {}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            captured["called"] = True
            return {"sent": True, "reason": None}

        with patch("app.auth_routes.send_email", side_effect=fake_send_email):
            resp = test_client.post(
                "/api/auth/forgot-password",
                json={"email": "admin@test.com"},
            )
        assert resp.status_code == 200
        assert captured.get("called") is True

    def test_forgot_password_mail_failure_does_not_break_endpoint(self, test_client: TestClient, admin_user):
        """SMTP failure does not break the endpoint; still returns 200."""
        from unittest.mock import patch

        with patch("app.auth_routes.send_email", return_value={"sent": False, "reason": "smtp_error"}):
            resp = test_client.post(
                "/api/auth/forgot-password",
                json={"email": "admin@test.com"},
            )
        assert resp.status_code == 200


class TestResetPassword:
    def test_reset_password_success(self, test_client: TestClient, admin_user, db: Session):
        from app.models import PasswordResetToken

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

    def test_reset_password_expired_token(self, test_client: TestClient, admin_user, db: Session):
        from app.models import PasswordResetToken

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

    def test_reset_password_new_too_short(self, test_client: TestClient, admin_user, db: Session):
        from app.models import PasswordResetToken

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

    def test_reset_token_only_affects_its_owner(self, test_client: TestClient, admin_user, db: Session):
        """A reset token only changes the password of its associated user,
        not someone else's."""
        from app.models import User, PasswordResetToken, UserRole
        from app.auth import get_password_hash

        # Create a second user
        user_b = User(
            email="userb@test.com",
            hashed_password=get_password_hash("UserBPass1234!"),
            role=UserRole.admin,
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

    def test_refresh_rotates_token_cannot_reuse_old(self, test_client: TestClient, admin_user):
        """After a successful refresh, the old refresh token is marked used
        and cannot be presented again."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        old_refresh = test_client.cookies.get("refresh_token")

        # First rotation — succeeds
        resp1 = test_client.post("/api/auth/refresh")
        assert resp1.status_code == 200
        new_refresh = test_client.cookies.get("refresh_token")
        assert new_refresh != old_refresh

        # Replay the old token — should fail
        test_client.cookies.set("refresh_token", old_refresh)
        resp2 = test_client.post("/api/auth/refresh")
        assert resp2.status_code == 401
        assert "revoked" in resp2.json()["detail"].lower()

    def test_refresh_after_logout_fails(self, test_client: TestClient, admin_user):
        """A refresh token extracted before logout cannot be used after logout."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        refresh_before_logout = test_client.cookies.get("refresh_token")

        test_client.post("/api/auth/logout")

        # Try to refresh with the pre-logout token
        test_client.cookies.set("refresh_token", refresh_before_logout)
        resp = test_client.post("/api/auth/refresh")
        assert resp.status_code == 401
        assert "revoked" in resp.json()["detail"].lower()


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


# ---------------------------------------------------------------------------
# PATCH /api/auth/me (update profile)
# ---------------------------------------------------------------------------


class TestUpdateProfile:
    def test_patch_display_name_success(self, test_client: TestClient, admin_user, db: Session):
        """Authenticated user can update their display_name."""
        from app.models import User

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": "My New Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "My New Name"

        db.expire_all()
        user = db.query(User).filter(User.email == "admin@test.com").first()
        assert user.display_name == "My New Name"

    def test_patch_display_name_empty_string_sets_null(self, test_client: TestClient, admin_user, db: Session):
        """Sending an empty string for display_name sets it to null."""
        from app.models import User

        # First set a name
        admin_user.display_name = "Existing Name"
        db.commit()

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] is None

        db.expire_all()
        user = db.query(User).filter(User.email == "admin@test.com").first()
        assert user.display_name is None

    def test_patch_display_name_null_means_no_op(self, test_client: TestClient, admin_user, db: Session):
        """Sending null for display_name is a no-op (field stays unchanged)."""
        from app.models import User

        admin_user.display_name = "Existing Name"
        db.commit()

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": None},
        )
        assert resp.status_code == 200

        db.expire_all()
        user = db.query(User).filter(User.email == "admin@test.com").first()
        assert user.display_name == "Existing Name"

    def test_patch_display_name_omit_field_no_change(self, test_client: TestClient, admin_user, db: Session):
        """Omitting display_name entirely leaves it unchanged."""
        from app.models import User

        admin_user.display_name = "Existing Name"
        db.commit()

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.patch(
            "/api/auth/me",
            json={},
        )
        assert resp.status_code == 200

        db.expire_all()
        user = db.query(User).filter(User.email == "admin@test.com").first()
        assert user.display_name == "Existing Name"

    def test_patch_requires_auth(self, test_client: TestClient):
        """Unauthenticated requests are rejected."""
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": "Hacker"},
        )
        assert resp.status_code == 401

    def test_patch_display_name_too_long(self, test_client: TestClient, admin_user):
        """Display name exceeding 40 chars is rejected."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": "A" * 41},
        )
        assert resp.status_code == 422

    def test_patch_referrer_can_update(self, test_client: TestClient, referrer_user, db: Session):
        """Referrer users can also update their display_name."""
        from app.models import User

        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": "Referrer New Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Referrer New Name"

        db.expire_all()
        user = db.query(User).filter(User.email == "referrer@test.com").first()
        assert user.display_name == "Referrer New Name"

    def test_patch_family_can_update(self, test_client: TestClient, family_user, db: Session):
        """Family users can also update their display_name."""
        from app.models import User

        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.patch(
            "/api/auth/me",
            json={"display_name": "Family New Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Family New Name"

        db.expire_all()
        user = db.query(User).filter(User.email == "family@test.com").first()
        assert user.display_name == "Family New Name"
