"""Tests for role-based permissions (permissions.py guards).

Focuses on scenarios NOT already covered by test_auth.py:
  - family role being denied admin-only endpoints
  - tampered (structurally invalid) JWTs
  - inactive users with otherwise valid tokens
"""

from fastapi.testclient import TestClient

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Family-specific admin access (test_auth.py only checks referrer)
# ---------------------------------------------------------------------------


class TestRequireAdmin:
    """require_admin guard — family-role user denied admin endpoints."""

    def test_family_cannot_register(self, test_client: TestClient, family_user):
        """Family user is rejected from admin-only /register."""
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "hacker@test.com",
                "password": "HackPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tampered JWTs (test_auth_utils.py tests expired tokens,
# test_auth.py tests valid-token flows)
# ---------------------------------------------------------------------------


class TestTamperedToken:
    def test_tampered_token_returns_401(self, test_client: TestClient, admin_user):
        test_client.cookies.set("access_token", "eyJhbGciOiJIUzI1NiJ9.tampered.signature")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Inactive user with valid token
# ---------------------------------------------------------------------------


class TestInactiveUserAuth:
    def test_inactive_user_rejected_with_valid_token(self, test_client: TestClient, db):
        """Even a correctly signed JWT must be rejected for an inactive user."""
        from app.auth import create_access_token
        from app.models import User, UserRole

        user = User(
            email="inactive@test.com",
            hashed_password="dummy",
            role=UserRole.admin,
            is_active=False,
        )
        db.add(user)
        db.commit()

        token = create_access_token({"sub": str(user.id), "role": "admin"})
        test_client.cookies.set("access_token", token)
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401
