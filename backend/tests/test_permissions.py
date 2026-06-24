"""Tests for role-based permissions (permissions.py guards)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# We exercise permissions via the /api/auth/register endpoint which
# requires admin role.  We also test /api/auth/me which requires any auth.
# ---------------------------------------------------------------------------


class TestRequireAdmin:
    """require_admin guard — tested through /api/auth/register."""

    def test_admin_can_register(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "newuser@test.com",
                "password": "NewPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 201

    def test_referrer_cannot_register(self, test_client: TestClient, referrer_user):
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
        assert "admin" in resp.json()["detail"].lower()

    def test_family_cannot_register(self, test_client: TestClient, family_user):
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

    def test_anonymous_cannot_register(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/register",
            json={
                "email": "hacker@test.com",
                "password": "HackPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 401


class TestRequireAuth:
    """Any authenticated user can access /me."""

    def test_admin_can_access_me(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 200

    def test_referrer_can_access_me(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 200
        assert resp.json()["role"] == "referrer"

    def test_family_can_access_me(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 200
        assert resp.json()["role"] == "family"

    def test_anonymous_cannot_access_me(self, test_client: TestClient):
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


class TestExpiredToken:
    def test_expired_access_token_returns_401(self, test_client: TestClient, admin_user):
        import jwt
        from datetime import timedelta
        from app.auth import ALGORITHM, SECRET_KEY

        # Create an expired token manually
        expired = jwt.encode(
            {"sub": str(admin_user.id), "role": "admin", "exp": 0},
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        test_client.cookies.set("access_token", expired)
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_tampered_token_returns_401(self, test_client: TestClient, admin_user):
        test_client.cookies.set("access_token", "eyJhbGciOiJIUzI1NiJ9.tampered.signature")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


class TestInactiveUserAuth:
    def test_inactive_user_cannot_authenticate(self, test_client: TestClient, db):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="inactive@test.com",
            hashed_password=get_password_hash("Pass12345!"),
            role=UserRole.admin,
            is_active=False,
        )
        db.add(user)
        db.commit()

        import jwt
        from app.auth import create_access_token

        # Even with a valid token, inactive users should be rejected
        token = create_access_token({"sub": str(user.id), "role": user.role})
        test_client.cookies.set("access_token", token)
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401
