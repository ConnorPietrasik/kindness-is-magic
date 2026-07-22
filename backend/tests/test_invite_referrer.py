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
        assert body["code"].startswith("KRI-")
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
        """Code should be KRI-<6 uppercase alphanumeric chars>."""
        import re

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 3},
        )
        assert resp.status_code == 201
        code = resp.json()["code"]
        assert re.match(r"^KRI-[A-Z0-9_-]{6}$", code)

    def test_invite_with_email(self, test_client: TestClient, admin_user):
        """Invite with email sends (suppressed) and returns email_sent=true."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 10, "email": "newref@example.com"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["code"].startswith("KRI-")
        assert body["email_sent"] is True
        assert body["email_send_reason"] is None

    def test_invite_without_email(self, test_client: TestClient, admin_user):
        """Invite without email skips send; email_sent and reason are null."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 10},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email_sent"] is None
        assert body["email_send_reason"] is None

    def test_invite_email_invalid_format(self, test_client: TestClient, admin_user):
        """Invalid email format in request body returns 422."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/auth/invite-referrer",
            json={"family_limit": 10, "email": "not-an-email"},
        )
        assert resp.status_code == 422

    def test_invite_email_failure_still_returns_201(self, test_client: TestClient, admin_user):
        """SMTP failure does not break the endpoint; email_sent=false."""
        from unittest.mock import patch

        login_as(test_client, "admin@test.com", "AdminPass123!")

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            return {"sent": False, "reason": "smtp_error"}

        with patch("app.auth_routes.send_email", side_effect=fake_send_email):
            resp = test_client.post(
                "/api/auth/invite-referrer",
                json={"family_limit": 10, "email": "fail@example.com"},
            )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email_sent"] is False
        assert body["email_send_reason"] == "smtp_error"

    def test_invite_email_uses_inviter_name(self, test_client: TestClient, admin_user, db):
        """Invite email is built with the inviter's name."""
        from unittest.mock import patch

        admin_user.display_name = "Jane Admin"
        db.commit()

        login_as(test_client, "admin@test.com", "AdminPass123!")

        captured_from_name = {}

        def fake_build_invite(*_args, **_kw):  # noqa: ANN002, ANN003
            captured_from_name["value"] = _kw.get("from_name")
            return "<html></html>"

        with patch("app.auth_routes.build_invite_email", side_effect=fake_build_invite):
            resp = test_client.post(
                "/api/auth/invite-referrer",
                json={"family_limit": 10, "email": "newref@example.com"},
            )
        assert resp.status_code == 201
        assert captured_from_name["value"] == "Jane Admin"

    def test_invite_email_defaults_to_kindness_fairy(self, test_client: TestClient, admin_user):
        """Admin with no display_name defaults to 'Kindness Fairy' in invite."""
        from unittest.mock import patch

        assert admin_user.display_name is None
        login_as(test_client, "admin@test.com", "AdminPass123!")

        captured_from_name = {}

        def fake_build_invite(*_args, **_kw):  # noqa: ANN002, ANN003
            captured_from_name["value"] = _kw.get("from_name")
            return "<html></html>"

        with patch("app.auth_routes.build_invite_email", side_effect=fake_build_invite):
            resp = test_client.post(
                "/api/auth/invite-referrer",
                json={"family_limit": 10, "email": "newref@example.com"},
            )
        assert resp.status_code == 201
        assert captured_from_name["value"] == "Kindness Fairy"


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
                "code": "KRI-INVALID",
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
            code="KRI-EXPIR",  # 10 chars max (KRI- + 5)
            family_limit=10,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
            used=False,
        )
        db.add(invite)
        db.commit()

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": "KRI-EXPIR",
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


# ---------------------------------------------------------------------------
# TestFamilySelfRegister — POST /api/auth/register-family
# ---------------------------------------------------------------------------


class TestFamilySelfRegister:
    """Public endpoint: family registers via a referrer's family invite code."""

    def _create_referrer_with_code(self, test_client: TestClient, admin_user, db: Session):
        """Helper: login as admin, create a referrer, return the family invite code."""
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(
            "/api/admin/referrers",
            json={"name": "Test Ref", "family_limit": 10, "phone_number": "555-0001"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["family_invite_code"] is not None
        assert body["family_invite_code"].startswith("KFI-")
        return body["family_invite_code"]

    def test_valid_code_registers_successfully(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)

        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "The Smiths",
                "family_wish": "A warm blanket",
                "contact_name": "Mom Smith",
                "email": "smith@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()

        # User created with family role
        assert body["user"]["email"] == "smith@test.com"
        assert body["user"]["role"] == "family"
        assert body["user"]["is_active"] is True

        # Family created with pending status
        assert body["family"]["family_name"] == "The Smiths"
        assert body["family"]["family_wish"] == "A warm blanket"
        assert body["family"]["contact_name"] == "Mom Smith"
        assert body["family"]["approval_status"] == "pending"
        assert body["family"]["person_count"] == 0

        # Auth cookies set (auto-login)
        assert "access_token" in resp.cookies
        assert "refresh_token" in resp.cookies

    def test_valid_code_with_optional_fields(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)

        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "The Joneses",
                "family_wish": "New shoes",
                "contact_name": "Dad Jones",
                "email": "jones@test.com",
                "password": "GoodPass1234!",
                "bio": "We have 3 kids",
                "address": "123 Main St",
                "phone_number": "555-9999",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["family"]["family_name"] == "The Joneses"

    def test_invalid_code(self, test_client: TestClient):
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": "KFI-BADCODE",
                "family_name": "Nobody",
                "family_wish": "Nothing",
                "contact_name": "Nobody",
                "email": "nobody@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 400
        assert "invite code" in resp.json()["detail"].lower()

    def test_duplicate_email(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)

        # First registration succeeds
        resp1 = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "First",
                "family_wish": "A roof",
                "contact_name": "First",
                "email": "dup@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp1.status_code == 201

        # Create another referrer with a different code
        code2 = self._create_referrer_with_code(test_client, admin_user, db)

        # Second registration with same email fails
        resp2 = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code2,
                "family_name": "Second",
                "family_wish": "A car",
                "contact_name": "Second",
                "email": "dup@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp2.status_code == 409
        assert "already registered" in resp2.json()["detail"].lower()

    def test_password_too_short(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "Short Pass",
                "family_wish": "A roof",
                "contact_name": "Short",
                "email": "short@test.com",
                "password": "Short",
            },
        )
        assert resp.status_code == 422

    def test_invalid_email_format(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "Bad Email",
                "family_wish": "A roof",
                "contact_name": "Bad",
                "email": "not-an-email",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 422

    def test_missing_required_fields(self, test_client: TestClient, admin_user, db: Session):
        code = self._create_referrer_with_code(test_client, admin_user, db)
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "",
                "family_wish": "",
                "contact_name": "",
                "email": "",
                "password": "",
            },
        )
        assert resp.status_code == 422

    def test_email_normalised(self, test_client: TestClient, admin_user, db: Session):
        """Email should be stored in lowercase."""
        code = self._create_referrer_with_code(test_client, admin_user, db)

        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "Case Test",
                "family_wish": "A roof",
                "contact_name": "Case",
                "email": "UPPERCASE@TEST.COM",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["user"]["email"] == "uppercase@test.com"

    def test_pending_family_not_in_referrer_family_list(self, test_client: TestClient, admin_user, db: Session):
        """Pending families should not appear in the referrer's family list."""
        from app.models import Referrer, User, UserRole
        from app.auth import get_password_hash

        code = self._create_referrer_with_code(test_client, admin_user, db)

        # Register a family
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "Pending Smiths",
                "family_wish": "A roof",
                "contact_name": "Mom Smith",
                "email": "pending@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        # Create a referrer user so we can log in as the referrer
        referrer = db.query(Referrer).filter(Referrer.family_invite_code == code).first()
        assert referrer is not None
        user = User(
            email="ref_user@test.com",
            hashed_password=get_password_hash("RefPass1234!"),
            role=UserRole.referrer,
            referrer_id=referrer.id,
            display_name=referrer.name,
            is_active=True,
        )
        db.add(user)
        db.commit()

        # Login as referrer and check family list
        login_as(test_client, "ref_user@test.com", "RefPass1234!")
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        body = resp.json()
        families = body.get("families", body) if isinstance(body, dict) else body
        assert all(f["family_name"] != "Pending Smiths" for f in families)

    def test_pending_family_appears_in_pending_list(self, test_client: TestClient, admin_user, db: Session):
        """Pending families should appear in the pending families list."""
        from app.models import Referrer, User, UserRole
        from app.auth import get_password_hash

        code = self._create_referrer_with_code(test_client, admin_user, db)

        # Register a family
        resp = test_client.post(
            "/api/auth/register-family",
            json={
                "code": code,
                "family_name": "Pending Joneses",
                "family_wish": "A car",
                "contact_name": "Dad Jones",
                "email": "pending2@test.com",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        # Create a referrer user
        referrer = db.query(Referrer).filter(Referrer.family_invite_code == code).first()
        assert referrer is not None
        user = User(
            email="ref_user2@test.com",
            hashed_password=get_password_hash("RefPass1234!"),
            role=UserRole.referrer,
            referrer_id=referrer.id,
            display_name=referrer.name,
            is_active=True,
        )
        db.add(user)
        db.commit()

        # Login as referrer and check pending list
        login_as(test_client, "ref_user2@test.com", "RefPass1234!")
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["family_name"] == "Pending Joneses"
        assert body[0]["approval_status"] == "pending"
