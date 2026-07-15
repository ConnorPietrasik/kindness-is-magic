"""Tests for invite-referrer flow: admin creates invites, public redeems them."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# TestInviteReferrerCreate — POST /api/auth/invite-referrer
# ---------------------------------------------------------------------------


class TestInviteReferrerCreate:
    """Admin endpoint: create an invite token."""

    def test_admin_creates_invite(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 10},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["code"].startswith("KMG-")
        assert body["family_limit"] == 10
        assert "expires_at" in body
        assert "created_at" in body

    def test_unauthenticated_rejected(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 5},
        )
        assert resp.status_code == 401

    def test_non_admin_referrer_rejected(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 5},
        )
        assert resp.status_code == 403

    def test_non_admin_family_rejected(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 5},
        )
        assert resp.status_code == 403

    def test_family_limit_too_small(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 0},
        )
        assert resp.status_code == 422

    def test_family_limit_too_large(self, test_client: TestClient, admin_user):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 1000},
        )
        assert resp.status_code == 422

    def test_code_format(self, test_client: TestClient, admin_user):
        """Code should be KMG-<6 uppercase alphanumeric chars>."""
        import re

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 3},
        )
        assert resp.status_code == 201
        code = resp.json()["code"]
        assert re.match(r"^KMG-[A-Z0-9_-]{6}$", code)


# ---------------------------------------------------------------------------
# TestReferrerSelfRegister — POST /api/auth/register-referrer
# ---------------------------------------------------------------------------


class TestReferrerSelfRegister:
    """Public endpoint: redeem an invite code to register."""

    def _create_invite(self, test_client: TestClient, admin_user, family_limit: int = 10):
        """Helper: login as admin, create an invite, return the code."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": family_limit},
        )
        assert resp.status_code == 201
        return resp.json()["code"]

    def test_valid_code_registers_successfully(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_invite(test_client, admin_user, family_limit=5)

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "New Referrer",
                "email": "newref@test.com",
                "phone_number": "555-1234",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()

        # User created
        assert body["user"]["email"] == "newref@test.com"
        assert body["user"]["role"] == "referrer"
        assert body["user"]["is_active"] is True
        assert "hashed_password" not in body["user"]

        # Referrer created with correct family_limit from invite
        assert body["referrer"]["name"] == "New Referrer"
        assert body["referrer"]["family_limit"] == 5

        # Auth cookies set (auto-login)
        assert "access_token" in resp.cookies
        assert "refresh_token" in resp.cookies

        # Token marked as used
        from app.models import ReferrerInviteToken

        token = db.query(ReferrerInviteToken).filter_by(code=code).first()
        assert token is not None
        assert token.used is True
        assert token.redeemed_by_user_id is not None
        assert token.redeemed_by_referrer_id is not None

    def test_invalid_code(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": "KMG-INVALID",
                "name": "Nobody",
                "email": "nobody@test.com",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 400
        assert "invite code" in resp.json()["detail"].lower()

    def test_expired_code(self, test_client: TestClient, db: Session):
        from app.models import ReferrerInviteToken

        invite = ReferrerInviteToken(
            code="KMG-EXPIRED",
            family_limit=10,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
            used=False,
        )
        db.add(invite)
        db.commit()

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": "KMG-EXPIRED",
                "name": "Late Bird",
                "email": "late@test.com",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()

    def test_already_used_code(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_invite(test_client, admin_user, family_limit=5)

        # First redemption succeeds
        resp1 = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "First",
                "email": "first@test.com",
                "phone_number": "555-0001",
                "password": "GoodPass1234!",
            },
        )
        assert resp1.status_code == 201

        # Second redemption with same code fails
        resp2 = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Second",
                "email": "second@test.com",
                "phone_number": "555-0002",
                "password": "GoodPass1234!",
            },
        )
        assert resp2.status_code == 400
        assert "already-used" in resp2.json()["detail"].lower() or "invalid" in resp2.json()["detail"].lower()

    def test_duplicate_email(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_invite(test_client, admin_user, family_limit=5)

        # Register with email
        resp1 = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "First",
                "email": "dup@test.com",
                "phone_number": "555-0001",
                "password": "GoodPass1234!",
            },
        )
        assert resp1.status_code == 201

        # Create a second invite to try again
        code2 = self._create_invite(test_client, admin_user, family_limit=5)

        resp2 = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code2,
                "name": "Second",
                "email": "dup@test.com",
                "phone_number": "555-0002",
                "password": "GoodPass1234!",
            },
        )
        assert resp2.status_code == 409
        assert "already registered" in resp2.json()["detail"].lower()

    def test_password_too_short(self, test_client: TestClient, admin_user):
        code = self._create_invite(test_client, admin_user)
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Short Pass",
                "email": "short@test.com",
                "phone_number": "555-0000",
                "password": "Short",
            },
        )
        assert resp.status_code == 422

    def test_invalid_email_format(self, test_client: TestClient, admin_user):
        code = self._create_invite(test_client, admin_user)
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Bad Email",
                "email": "not-an-email",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 422

    def test_name_too_long(self, test_client: TestClient, admin_user):
        code = self._create_invite(test_client, admin_user)
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "A" * 61,
                "email": "longname@test.com",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 422

    def test_email_normalised(self, test_client: TestClient, admin_user, db: Session):
        """Email should be stored in lowercase."""
        code = self._create_invite(test_client, admin_user, family_limit=5)

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Case Test",
                "email": "UPPERCASE@TEST.COM",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["user"]["email"] == "uppercase@test.com"


# ---------------------------------------------------------------------------
# TestInviteRedemptionAtomicity
# ---------------------------------------------------------------------------


class TestInviteRedemptionAtomicity:
    """Ensure failed redemptions don't leave partial data."""

    def test_duplicate_email_rolls_back(self, test_client: TestClient, admin_user, db: Session):
        """If email already exists, no partial Referrer or User should be created."""
        from app.models import Referrer, User

        # Seed an existing user with the target email
        from app.auth import get_password_hash

        existing = User(
            email="existing@test.com",
            hashed_password=get_password_hash("ExistingPass1!"),
            role="admin",
            is_active=True,
        )
        db.add(existing)
        db.commit()

        code = self._create_invite(test_client, admin_user, family_limit=5)

        # Count rows before
        referrer_count = db.query(Referrer).count()
        user_count = (
            db.query(User)
            .filter(
                User.email == "existing@test.com",
                User.role == "referrer",
            )
            .count()
        )

        # Try to redeem with existing email
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Duplicate",
                "email": "existing@test.com",
                "phone_number": "555-0000",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 409

        # No new referrer or user row was created
        assert db.query(Referrer).count() == referrer_count
        assert (
            db.query(User)
            .filter(
                User.email == "existing@test.com",
                User.role == "referrer",
            )
            .count()
            == user_count
        )

    def _create_invite(self, test_client: TestClient, admin_user, family_limit: int = 10):
        """Helper: login as admin, create an invite, return the code."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": family_limit},
        )
        assert resp.status_code == 201
        return resp.json()["code"]
