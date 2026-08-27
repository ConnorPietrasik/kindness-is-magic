"""Tests for referrer approval flow: self-reg approval status, admin approve/reject, invite CRUD."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _create_unlocked_invite(client: TestClient) -> str:
    """Create an unlocked invite and return the code."""
    _admin_login(client)
    resp = client.post(
        "/api/auth/invite-referrer",
        json={"family_limit": 5},
    )
    assert resp.status_code == 201
    return resp.json()["code"]


def _create_locked_invite(client: TestClient, email: str = "locked@test.com") -> str:
    """Create an email-locked invite and return the code."""
    _admin_login(client)
    resp = client.post(
        "/api/auth/invite-referrer",
        json={"family_limit": 5, "email": email},
    )
    assert resp.status_code == 201
    return resp.json()["code"]


# ---------------------------------------------------------------------------
# TestSelfRegApprovalStatus
# ---------------------------------------------------------------------------


class TestSelfRegApprovalStatus:
    """Self-registration sets correct approval status based on invite type."""

    def test_unlocked_code_creates_pending_referrer(self, test_client: TestClient, admin_user, db: Session):
        """Unlocked invite code → referrer approval_status = pending."""
        from app.models import Referrer, ReferrerApprovalStatus

        code = _create_unlocked_invite(test_client)

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Pending Referrer",
                "email": "pending_ref@test.com",
                "phone_number": "555-111-1111",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        # Check DB
        ref = db.query(Referrer).filter(Referrer.name == "Pending Referrer").first()
        assert ref is not None
        assert ref.approval_status == ReferrerApprovalStatus.pending
        assert ref.approved_by_admin_id is None
        assert ref.approved_at is None

    def test_locked_code_creates_approved_referrer(self, test_client: TestClient, admin_user, db: Session):
        """Email-locked invite code → referrer approval_status = approved."""
        from app.models import Referrer, ReferrerApprovalStatus

        code = _create_locked_invite(test_client, email="locked_ref@test.com")

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Approved Referrer",
                "email": "locked_ref@test.com",
                "phone_number": "555-222-2222",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        # Check DB
        ref = db.query(Referrer).filter(Referrer.name == "Approved Referrer").first()
        assert ref is not None
        assert ref.approval_status == ReferrerApprovalStatus.approved
        assert ref.approved_by_admin_id is not None
        assert ref.approved_at is not None

    def test_locked_code_sets_approved_by_to_invite_creator(self, test_client: TestClient, admin_user, db: Session):
        """approved_by_admin_id points to the admin who created the invite."""
        from app.models import Referrer

        code = _create_locked_invite(test_client, email="locked2@test.com")

        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Locked Referrer",
                "email": "locked2@test.com",
                "phone_number": "555-333-3333",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        ref = db.query(Referrer).filter(Referrer.name == "Locked Referrer").first()
        assert ref.approved_by_admin_id == admin_user.id

    def test_invite_has_created_by_admin_id(self, test_client: TestClient, admin_user, db: Session):
        """Invite tokens record which admin created them."""
        from app.models import ReferrerInviteToken

        code = _create_unlocked_invite(test_client)

        token = db.query(ReferrerInviteToken).filter_by(code=code).first()
        assert token is not None
        assert token.created_by_admin_id == admin_user.id


# ---------------------------------------------------------------------------
# TestRejectedReferrerAuth
# ---------------------------------------------------------------------------


class TestRejectedReferrerAuth:
    """Rejected referrers cannot log in or refresh tokens."""

    def _create_rejected_referrer(self, db: Session, admin_user):
        """Create a referrer with rejected status and a linked user."""
        from app.models import Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Rejected Ref",
            family_limit=5,
            phone_number="555-444-4444",
            family_invite_code="KFI-REJECT",
            approval_status=ReferrerApprovalStatus.rejected,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="rejected@test.com",
            hashed_password=get_password_hash("RejectPass1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return ref, user

    def test_rejected_referrer_cannot_login(self, test_client: TestClient, db: Session, admin_user):
        """Rejected referrer gets 401 on login."""
        self._create_rejected_referrer(db, admin_user)

        resp = test_client.post(
            "/api/auth/login",
            json={"email": "rejected@test.com", "password": "RejectPass1234!"},
        )
        assert resp.status_code == 401
        assert "rejected" in resp.json()["detail"].lower()

    def test_rejected_referrer_cannot_refresh(self, test_client: TestClient, db: Session, admin_user):
        """Rejected referrer gets 401 on token refresh."""
        from app.models import Referrer

        ref, user = self._create_rejected_referrer(db, admin_user)

        # Create a refresh token for the user (simulating a pre-existing session)
        from app.auth import create_refresh_token

        raw_refresh = create_refresh_token(data={"sub": str(user.id)}, db=db)

        # Now reject the referrer
        db.query(Referrer).filter(Referrer.id == ref.id).update({"approval_status": "rejected"}, synchronize_session=False)
        db.commit()

        # Try to refresh with the old token
        resp = test_client.post(
            "/api/auth/refresh",
            cookies={"refresh_token": raw_refresh},
        )
        assert resp.status_code == 401
        assert "rejected" in resp.json()["detail"].lower()

    def test_reapproved_referrer_can_login_again(self, test_client: TestClient, db: Session, admin_user):
        """A previously rejected referrer can log in after admin re-approves."""
        ref, user = self._create_rejected_referrer(db, admin_user)

        # Admin approves the referrer
        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/referrers/{ref.id}/approve")
        assert resp.status_code == 200
        body = resp.json()
        assert body["approval_status"] == "approved"

        # Now the referrer can log in
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "rejected@test.com", "password": "RejectPass1234!"},
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "Login successful"


# ---------------------------------------------------------------------------
# TestSendFamilyInviteApprovalGate
# ---------------------------------------------------------------------------


class TestSendFamilyInviteApprovalGate:
    """Pending referrers cannot send family invites; approved can."""

    def test_pending_referrer_gets_403_on_send_invite(self, test_client: TestClient, admin_user, db: Session):
        """Pending referrer gets 403 when trying to send family invites."""
        from app.models import Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Pending Ref",
            family_limit=5,
            phone_number="555-555-5555",
            family_invite_code="KFI-PEND01",
            approval_status=ReferrerApprovalStatus.pending,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="pending_send@test.com",
            hashed_password=get_password_hash("PendSend1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()

        login_as(test_client, "pending_send@test.com", "PendSend1234!")
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 403
        assert "approved" in resp.json()["detail"].lower()

    def test_approved_referrer_can_send_invite(self, test_client: TestClient, admin_user, db: Session):
        """Approved referrer can send family invites normally."""
        from app.models import Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Approved Ref",
            family_limit=5,
            phone_number="555-666-6666",
            family_invite_code="KFI-APPR01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="approved_send@test.com",
            hashed_password=get_password_hash("ApprSend1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()

        login_as(test_client, "approved_send@test.com", "ApprSend1234!")
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# TestAdminApproveReject
# ---------------------------------------------------------------------------


class TestAdminApproveReject:
    """Admin approve/reject endpoints."""

    def _create_pending_referrer(self, db: Session) -> "Referrer":  # noqa: F821
        from app.models import Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Approve Me",
            family_limit=5,
            phone_number="555-777-7777",
            family_invite_code="KFI-APME01",
            approval_status=ReferrerApprovalStatus.pending,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="approveme@test.com",
            hashed_password=get_password_hash("ApproveMe1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()
        return ref

    def test_admin_approve_sets_status_and_metadata(self, test_client: TestClient, admin_user, db: Session):
        """Approve sets status=approved, approved_by_admin_id, approved_at."""
        ref = self._create_pending_referrer(db)

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/referrers/{ref.id}/approve")
        assert resp.status_code == 200
        body = resp.json()
        assert body["approval_status"] == "approved"
        assert body["approved_by_admin_name"] is not None
        assert body["approved_at"] is not None

        # Verify in DB
        db.refresh(ref)
        assert ref.approval_status.value == "approved"
        assert ref.approved_by_admin_id == admin_user.id
        assert ref.approved_at is not None

    def test_admin_approve_sends_approval_email(self, test_client: TestClient, admin_user, db: Session):
        """Approve triggers an approval email (mocked)."""
        from unittest.mock import patch

        ref = self._create_pending_referrer(db)

        email_called = {"value": False}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            email_called["value"] = True
            return {"sent": True, "reason": None}

        _admin_login(test_client)
        with patch("app.mail.send_email", side_effect=fake_send_email):
            resp = test_client.post(f"/api/admin/referrers/{ref.id}/approve")
        assert resp.status_code == 200
        assert email_called["value"] is True

    def test_admin_reject_sets_status(self, test_client: TestClient, admin_user, db: Session):
        """Reject sets status=rejected."""
        ref = self._create_pending_referrer(db)

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/referrers/{ref.id}/reject")
        assert resp.status_code == 200
        body = resp.json()
        assert body["approval_status"] == "rejected"

        db.refresh(ref)
        assert ref.approval_status.value == "rejected"

    def test_admin_reject_sends_rejection_email(self, test_client: TestClient, admin_user, db: Session):
        """Reject triggers a rejection email (mocked)."""
        from unittest.mock import patch

        ref = self._create_pending_referrer(db)

        email_called = {"value": False}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            email_called["value"] = True
            return {"sent": True, "reason": None}

        _admin_login(test_client)
        with patch("app.mail.send_email", side_effect=fake_send_email):
            resp = test_client.post(f"/api/admin/referrers/{ref.id}/reject")
        assert resp.status_code == 200
        assert email_called["value"] is True

    def test_admin_approve_nonexistent_referrer(self, test_client: TestClient, admin_user):
        """Approve a non-existent referrer returns 404."""
        _admin_login(test_client)
        resp = test_client.post("/api/admin/referrers/99999/approve")
        assert resp.status_code == 404

    def test_admin_reject_nonexistent_referrer(self, test_client: TestClient, admin_user):
        """Reject a non-existent referrer returns 404."""
        _admin_login(test_client)
        resp = test_client.post("/api/admin/referrers/99999/reject")
        assert resp.status_code == 404

    def test_non_admin_cannot_approve(self, test_client: TestClient, referrer_user):
        """Non-admin gets 403 on approve."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post("/api/admin/referrers/1/approve")
        assert resp.status_code == 403

    def test_non_admin_cannot_reject(self, test_client: TestClient, referrer_user):
        """Non-admin gets 403 on reject."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post("/api/admin/referrers/1/reject")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TestAdminResetSentEmails
# ---------------------------------------------------------------------------


class TestAdminResetSentEmails:
    """Admin reset-sent-emails endpoint (hard-deletes invite email records)."""

    def _create_approved_referrer(self, db: Session, family_limit: int = 5) -> "Referrer":  # noqa: F821
        from app.models import Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Reset Ref",
            family_limit=family_limit,
            phone_number="555-888-8888",
            family_invite_code="KFI-RST001",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="resetref@test.com",
            hashed_password=get_password_hash("ResetRef1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()
        return ref

    def test_reset_allows_resending_to_dedup_blocked_recipient(self, test_client: TestClient, admin_user, db: Session):
        """After a reset, the referrer can send again, including to a
        previously 7-day-blocked recipient."""
        from app.models import ReferrerInviteEmail

        ref = self._create_approved_referrer(db)
        login_as(test_client, "resetref@test.com", "ResetRef1234!")

        # First send succeeds; immediate resend is 7-day dedup blocked
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "fam@example.com"})
        assert resp.status_code == 200
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "fam@example.com"})
        assert resp.status_code == 429
        assert "already been sent" in resp.json()["detail"]

        # Admin reset hard-deletes the records
        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/referrers/{ref.id}/reset-sent-emails")
        assert resp.status_code == 200
        assert resp.json()["id"] == ref.id
        assert db.query(ReferrerInviteEmail).filter(ReferrerInviteEmail.referrer_id == ref.id).count() == 0

        # Same recipient can be invited again right after the reset
        login_as(test_client, "resetref@test.com", "ResetRef1234!")
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "fam@example.com"})
        assert resp.status_code == 200

    def test_reset_allows_sending_again_at_lifetime_cap(self, test_client: TestClient, admin_user, db: Session):
        """A referrer at the lifetime cap can send again after a reset."""
        from app.models import ReferrerInviteEmail

        ref = self._create_approved_referrer(db, family_limit=1)
        login_as(test_client, "resetref@test.com", "ResetRef1234!")

        # Fill the lifetime cap, then get blocked
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "first@example.com"})
        assert resp.status_code == 200
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "second@example.com"})
        assert resp.status_code == 429
        assert "reached the limit" in resp.json()["detail"]

        # Reset clears the cap
        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/referrers/{ref.id}/reset-sent-emails")
        assert resp.status_code == 200
        assert db.query(ReferrerInviteEmail).filter(ReferrerInviteEmail.referrer_id == ref.id).count() == 0

        # Referrer can send again after the reset
        login_as(test_client, "resetref@test.com", "ResetRef1234!")
        resp = test_client.post("/api/referrer/send-family-invite", json={"email": "second@example.com"})
        assert resp.status_code == 200

    def test_reset_nonexistent_referrer(self, test_client: TestClient, admin_user):
        """Reset for a non-existent referrer returns 404."""
        _admin_login(test_client)
        resp = test_client.post("/api/admin/referrers/99999/reset-sent-emails")
        assert resp.status_code == 404

    def test_non_admin_cannot_reset(self, test_client: TestClient, referrer_user):
        """Non-admin gets 403 on reset-sent-emails."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post("/api/admin/referrers/1/reset-sent-emails")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TestAdminInviteCRUD
# ---------------------------------------------------------------------------


class TestAdminInviteCRUD:
    """Admin invite list/get/revoke endpoints."""

    def test_list_invites_empty(self, test_client: TestClient, admin_user):
        """Empty invite list returns empty array."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites")
        assert resp.status_code == 200
        body = resp.json()
        assert body["invites"] == []
        assert body["total"] == 0

    def test_list_invites_shows_created_invites(self, test_client: TestClient, admin_user, db: Session):
        """List includes created invites with admin name."""
        # Create an invite via the auth endpoint
        code = _create_unlocked_invite(test_client)

        resp = test_client.get("/api/admin/invites")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 1
        invites = body["invites"]
        found = [i for i in invites if i["code"] == code]
        assert len(found) == 1
        invite = found[0]
        assert invite["created_by_admin_name"] is not None
        assert invite["redeemed"] is False
        assert invite["family_limit"] == 5

    def test_get_invite_detail(self, test_client: TestClient, admin_user, db: Session):
        """Get single invite by id."""
        code = _create_unlocked_invite(test_client)

        from app.models import ReferrerInviteToken

        token = db.query(ReferrerInviteToken).filter_by(code=code).first()

        resp = test_client.get(f"/api/admin/invites/{token.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == code
        assert body["family_limit"] == 5
        assert body["redeemed"] is False

    def test_get_invite_not_found(self, test_client: TestClient, admin_user):
        """Get non-existent invite returns 404."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites/99999")
        assert resp.status_code == 404

    def test_revoke_unredeemed_invite(self, test_client: TestClient, admin_user, db: Session):
        """Revoke sets expires_at to now on unredeemed invite."""
        from app.models import ReferrerInviteToken

        code = _create_unlocked_invite(test_client)
        token = db.query(ReferrerInviteToken).filter_by(code=code).first()
        original_expiry = token.expires_at

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/invites/{token.id}/revoke")
        assert resp.status_code == 200

        db.refresh(token)
        # expires_at should now be in the past or present (not the original future date)
        assert token.expires_at < original_expiry

    def test_cannot_revoke_redeemed_invite(self, test_client: TestClient, admin_user, db: Session):
        """Cannot revoke an already-redeemed invite."""
        from app.models import ReferrerInviteToken

        code = _create_unlocked_invite(test_client)

        # Redeem the invite
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "Redeemed Ref",
                "email": "redeemed@test.com",
                "phone_number": "555-888-8888",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        token = db.query(ReferrerInviteToken).filter_by(code=code).first()
        assert token.redeemed_by_user_id is not None

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/invites/{token.id}/revoke")
        assert resp.status_code == 400
        assert "redeemed" in resp.json()["detail"].lower()

    def test_revoke_nonexistent_invite(self, test_client: TestClient, admin_user):
        """Revoke non-existent invite returns 404."""
        _admin_login(test_client)
        resp = test_client.post("/api/admin/invites/99999/revoke")
        assert resp.status_code == 404

    def test_non_admin_cannot_list_invites(self, test_client: TestClient, referrer_user):
        """Non-admin gets 403 on list invites."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/admin/invites")
        assert resp.status_code == 403

    def test_list_invites_filter_redeemed_true(self, test_client: TestClient, admin_user, db: Session):
        """Filter redeemed=true shows only redeemed invites."""
        # Create two invites
        code1 = _create_unlocked_invite(test_client)
        code2 = _create_unlocked_invite(test_client)

        # Redeem the first one
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code1,
                "name": "Redeemed Ref",
                "email": "redeemed_filter@test.com",
                "phone_number": "555-999-9999",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites?redeemed=true")
        assert resp.status_code == 200
        body = resp.json()
        assert all(i["redeemed"] is True for i in body["invites"])

        # Verify code1 is in the redeemed list
        codes = [i["code"] for i in body["invites"]]
        assert code1 in codes
        assert code2 not in codes

    def test_list_invites_filter_redeemed_false(self, test_client: TestClient, admin_user):
        """Filter redeemed=false shows only unredeemed invites."""
        _create_unlocked_invite(test_client)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites?redeemed=false")
        assert resp.status_code == 200
        body = resp.json()
        assert all(i["redeemed"] is False for i in body["invites"])

    def test_list_invites_filter_expired(self, test_client: TestClient, admin_user, db: Session):
        """Filter expired=true shows only expired invites."""
        from app.models import ReferrerInviteToken

        # Create an expired invite directly
        expired = ReferrerInviteToken(
            code="KRI-EXPIR2",
            family_limit=5,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
            created_by_admin_id=admin_user.id,
        )
        db.add(expired)
        db.commit()

        # Create a valid invite
        _create_unlocked_invite(test_client)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites?expired=true")
        assert resp.status_code == 200
        body = resp.json()
        assert all(datetime.fromisoformat(i["expires_at"]) < datetime.now(timezone.utc) for i in body["invites"])

    def test_invite_list_includes_referrer_info_after_redemption(self, test_client: TestClient, admin_user, db: Session):
        """After redemption, invite shows referrer name and approval status."""
        code = _create_unlocked_invite(test_client)

        # Redeem
        resp = test_client.post(
            "/api/auth/register-referrer",
            json={
                "code": code,
                "name": "List Ref",
                "email": "list_ref@test.com",
                "phone_number": "555-000-0001",
                "password": "GoodPass1234!",
            },
        )
        assert resp.status_code == 201

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites")
        assert resp.status_code == 200
        body = resp.json()
        found = [i for i in body["invites"] if i["code"] == code]
        assert len(found) == 1
        invite = found[0]
        assert invite["redeemed"] is True
        assert invite["redeemed_by_referrer_name"] == "List Ref"
        assert invite["referrer_approval_status"] == "pending"

    def test_list_invites_pagination(self, test_client: TestClient, admin_user, db: Session):
        """Invite list supports pagination."""
        # Create multiple invites
        for i in range(5):
            _create_unlocked_invite(test_client)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["invites"]) == 2
        assert body["total"] >= 5
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total_pages"] >= 3

    def test_list_invites_ordered_newest_first(self, test_client: TestClient, admin_user):
        """Invites are ordered newest first."""
        _create_unlocked_invite(test_client)
        import time

        time.sleep(0.05)  # Small delay for ordering
        _create_unlocked_invite(test_client)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/invites")
        assert resp.status_code == 200
        body = resp.json()
        invites = body["invites"]
        assert len(invites) >= 2
        # First item should have a later created_at
        assert invites[0]["created_at"] >= invites[1]["created_at"]
