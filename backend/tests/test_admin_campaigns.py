"""Tests for the admin email-campaign endpoints (create/preview/list/detail/cancel).

Tests run with SUPPRESS_SEND=1 — the background worker is disabled
(DISABLE_BACKGROUND_TASKS), so no campaign email is actually delivered here;
creation/resolution/cancel behavior is asserted directly. The 5/minute create
limiter is a no-op in tests (DEBUG skip) and intentionally not asserted.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    EmailCampaign,
    EmailCampaignRecipient,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    User,
    UserRole,
)
from tests.conftest import login_as

BASE = "/api/admin/email-campaigns"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _make_user(db: Session, email: str, role: UserRole) -> User:
    from app.auth import get_password_hash

    user = User(
        email=email,
        hashed_password=get_password_hash("Passw0rd!abc"),
        role=role,
        display_name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _campaigns(db: Session) -> list[EmailCampaign]:
    return db.query(EmailCampaign).order_by(EmailCampaign.id).all()


def _recipients(db: Session, campaign_id: int) -> list[EmailCampaignRecipient]:
    return (
        db.query(EmailCampaignRecipient).filter(EmailCampaignRecipient.campaign_id == campaign_id).order_by(EmailCampaignRecipient.id).all()
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TestCampaignAuth:
    def test_401_unauthenticated(self, test_client: TestClient, admin_user):
        assert test_client.get(BASE).status_code == 401
        assert test_client.get(f"{BASE}/1").status_code == 401
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]}).status_code == 401
        assert test_client.post(BASE + "/preview", json={"extra_emails": ["a@example.com"]}).status_code == 401
        assert test_client.post(f"{BASE}/1/cancel").status_code == 401

    def test_403_non_admin(self, test_client: TestClient, admin_user, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        assert test_client.get(BASE).status_code == 403
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]}).status_code == 403
        assert test_client.get(f"{BASE}/1").status_code == 403
        assert test_client.post(f"{BASE}/1/cancel").status_code == 403


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestCreateCampaign:
    def test_create_roles_plus_manual_201(self, test_client: TestClient, admin_user, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)
        _admin_login(test_client)

        resp = test_client.post(
            BASE,
            json={
                "roles": ["donor"],
                "extra_emails": [" Extra@Example.com "],
                "subject": "Drive results",
                "message": "Thank you all!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "pending"
        assert body["subject"] == "Drive results"
        assert body["roles"] == ["donor"]
        assert body["total_recipients"] == 2
        assert body["sent_count"] == 0
        assert body["failed_count"] == 0
        assert body["pending_count"] == 2
        assert body["canceled_count"] == 0
        assert body["sender_name"] == admin_user.display_name

        campaigns = _campaigns(db)
        assert len(campaigns) == 1
        campaign = campaigns[0]
        assert campaign.message == "Thank you all!"
        assert campaign.created_by == admin_user.id
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.user_id) for r in rows] == [
            ("donor1@example.com", EmailCampaignRecipientSource.role, donor.id),
            ("extra@example.com", EmailCampaignRecipientSource.manual, None),
        ]
        assert all(r.status == EmailCampaignRecipientStatus.pending for r in rows)

    def test_create_blank_subject_uses_default(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        resp = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        assert resp.status_code == 201
        assert resp.json()["subject"] == "A message from Kindness Is Magic ✨"

    def test_create_validation_422s(self, test_client: TestClient, admin_user):
        _admin_login(test_client)

        # Blank message
        assert test_client.post(BASE, json={"message": "   ", "extra_emails": ["a@example.com"]}).status_code == 422
        # Oversized message
        assert test_client.post(BASE, json={"message": "x" * 5001, "extra_emails": ["a@example.com"]}).status_code == 422
        # Invalid manual email
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["not-an-email"]}).status_code == 422
        # Over-long manual email (DB column is 120 — must 422, not a DB 500)
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a" * 109 + "@example.com"]}).status_code == 422
        # Oversized subject
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "subject": "x" * 201}).status_code == 422
        # No roles and no emails
        assert test_client.post(BASE, json={"message": "Hi"}).status_code == 422

    def test_create_over_cap_422(self, test_client: TestClient, admin_user, db: Session, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)
        _admin_login(test_client)
        resp = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"]})
        assert resp.status_code == 422
        assert "Too many recipients" in resp.json()["detail"]

    def test_create_resolved_empty_422(self, test_client: TestClient, admin_user):
        # Roles selected but no users have them → resolution is empty.
        _admin_login(test_client)
        resp = test_client.post(BASE, json={"message": "Hi", "roles": ["purchaser"]})
        assert resp.status_code == 422
        assert "No recipients" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


class TestPreviewCampaign:
    def test_preview_counts_without_creating(self, test_client: TestClient, admin_user, db: Session):
        _make_user(db, "donor1@example.com", UserRole.donor)
        _make_user(db, "donor2@example.com", UserRole.donor)
        _admin_login(test_client)

        resp = test_client.post(
            BASE + "/preview",
            json={"roles": ["donor"], "extra_emails": ["donor1@example.com", "other@example.com"]},
        )
        assert resp.status_code == 200
        # donor2 via role, donor1 deduped to manual, other manual.
        assert resp.json() == {"total": 3, "by_role": {"donor": 1}, "manual": 2}
        # No side effects.
        assert _campaigns(db) == []

    def test_preview_validation_422s(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        # No roles and no emails
        assert test_client.post(BASE + "/preview", json={}).status_code == 422
        # Invalid manual email
        assert test_client.post(BASE + "/preview", json={"extra_emails": ["bad"]}).status_code == 422
        # Over-long manual email (DB column is 120 — must 422, not a DB 500)
        assert test_client.post(BASE + "/preview", json={"extra_emails": ["a" * 109 + "@example.com"]}).status_code == 422


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------


class TestListAndDetail:
    def test_list_newest_first_with_sender_name(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        r1 = test_client.post(BASE, json={"message": "First", "extra_emails": ["a@example.com"]})
        r2 = test_client.post(BASE, json={"message": "Second", "extra_emails": ["b@example.com"]})
        assert r1.status_code == 201 and r2.status_code == 201

        resp = test_client.get(BASE)
        assert resp.status_code == 200
        items = resp.json()["campaigns"]
        assert [i["id"] for i in items] == [r2.json()["id"], r1.json()["id"]]
        assert all(i["sender_name"] == admin_user.display_name for i in items)

    def test_detail_recipients_paginated_with_search(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@x.com", "b@x.com", "c@x.com"]})
        campaign_id = created.json()["id"]

        resp = test_client.get(f"{BASE}/{campaign_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["campaign"]["id"] == campaign_id
        assert body["campaign"]["message"] == "Hi"
        assert body["total"] == 3
        assert len(body["recipients"]) == 3

        # Pagination
        page2 = test_client.get(f"{BASE}/{campaign_id}", params={"page": 2, "page_size": 2}).json()
        assert page2["total"] == 3
        assert page2["total_pages"] == 2
        assert len(page2["recipients"]) == 1
        assert page2["recipients"][0]["email"] == "c@x.com"

        # Search
        searched = test_client.get(f"{BASE}/{campaign_id}", params={"search": "b@"}).json()
        assert searched["total"] == 1
        assert searched["recipients"][0]["email"] == "b@x.com"

        # Columns filter trims the response (required fields — id, email,
        # source, status — are always included regardless of the filter).
        cols = test_client.get(f"{BASE}/{campaign_id}", params={"columns": "email,status"}).json()
        assert set(cols["recipients"][0].keys()) == {"id", "email", "source", "status"}

    def test_detail_404(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        assert test_client.get(f"{BASE}/99999").status_code == 404


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


class TestCancelCampaign:
    def test_cancel_flips_pending_rows(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"]})
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "canceled"
        assert resp.json()["canceled_count"] == 2
        assert resp.json()["pending_count"] == 0

        rows = _recipients(db, campaign_id)
        assert all(r.status == EmailCampaignRecipientStatus.canceled for r in rows)

    def test_cancel_keeps_sent_rows_sent(self, test_client: TestClient, admin_user, db: Session):
        import asyncio

        from app.email_campaigns import process_next_campaign_email

        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"]})
        campaign_id = created.json()["id"]

        # Deliver the first recipient (synchronous test — drive the async step
        # with a fresh event loop), then cancel the rest.
        asyncio.run(process_next_campaign_email(db))

        resp = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert resp.status_code == 200
        assert resp.json()["sent_count"] == 1
        assert resp.json()["canceled_count"] == 1

        rows = _recipients(db, campaign_id)
        assert rows[0].status == EmailCampaignRecipientStatus.sent
        assert rows[1].status == EmailCampaignRecipientStatus.canceled

    def test_cancel_idempotent_on_terminal(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        campaign_id = created.json()["id"]

        first = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert first.status_code == 200
        second = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert second.status_code == 200
        assert second.json()["status"] == "canceled"

    def test_cancel_response_identifies_creator_when_another_admin_cancels(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        campaign_id = created.json()["id"]

        # A second admin performs the cancel — the response still shows the
        # creating admin's name, not the acting one.
        other = _make_user(db, "admin2@test.com", UserRole.admin)
        assert other.display_name != admin_user.display_name
        login_as(test_client, "admin2@test.com", "Passw0rd!abc")

        resp = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "canceled"
        assert resp.json()["sender_name"] == admin_user.display_name

    def test_cancel_404(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        assert test_client.post(f"{BASE}/99999/cancel").status_code == 404
