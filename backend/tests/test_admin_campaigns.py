"""Tests for the admin email-campaign endpoints (create/draft/update/send/
preview/list/detail/cancel/delete).

Tests run with SUPPRESS_SEND=1 — the background worker is disabled
(DISABLE_BACKGROUND_TASKS), so no campaign email is actually delivered here;
creation/resolution/scheduling/cancel behavior is asserted directly. The
5/minute create+send limiter is a no-op in tests (DEBUG skip) and
intentionally not asserted.
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    EmailCampaign,
    EmailCampaignRecipient,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    EmailCampaignStatus,
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
        assert test_client.post(f"{BASE}/1/send").status_code == 401
        assert test_client.patch(f"{BASE}/1", json={"message": "Hi"}).status_code == 401
        assert test_client.delete(f"{BASE}/1").status_code == 401

    def test_403_non_admin(self, test_client: TestClient, admin_user, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        assert test_client.get(BASE).status_code == 403
        assert test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]}).status_code == 403
        assert test_client.get(f"{BASE}/1").status_code == 403
        assert test_client.post(f"{BASE}/1/cancel").status_code == 403
        assert test_client.post(f"{BASE}/1/send").status_code == 403
        assert test_client.patch(f"{BASE}/1", json={"message": "Hi"}).status_code == 403
        assert test_client.delete(f"{BASE}/1").status_code == 403


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

    def test_create_scheduled_201(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
        resp = test_client.post(
            BASE,
            json={"message": "Hi", "extra_emails": ["a@example.com"], "scheduled_for": scheduled.isoformat()},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "pending"
        assert body["total_recipients"] == 1
        assert datetime.fromisoformat(body["scheduled_for"]) == scheduled

        # Recipients are resolved at creation (the campaign is activated);
        # the schedule only delays the worker's pickup.
        campaign = _campaigns(db)[0]
        assert len(_recipients(db, campaign.id)) == 1
        assert campaign.scheduled_for == scheduled

    def test_create_past_scheduled_for_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        resp = test_client.post(
            BASE,
            json={"message": "Hi", "extra_emails": ["a@example.com"], "scheduled_for": past.isoformat()},
        )
        assert resp.status_code == 422
        assert "future" in resp.json()["detail"]

    def test_create_draft_201(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        scheduled = datetime.now(timezone.utc) + timedelta(days=2)
        resp = test_client.post(
            BASE,
            json={
                "message": "Draft body",
                "roles": ["donor"],
                "extra_emails": ["  A@Example.COM ", "a@example.com", "b@example.com"],
                "subject": "Draft subject",
                "save_as_draft": True,
                "scheduled_for": scheduled.isoformat(),
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "draft"
        assert body["subject"] == "Draft subject"
        assert body["total_recipients"] == 0
        assert body["sent_count"] == 0
        assert body["pending_count"] == 0
        assert body["canceled_count"] == 0
        assert datetime.fromisoformat(body["scheduled_for"]) == scheduled

        campaign = _campaigns(db)[0]
        assert campaign.total_recipients == 0
        assert campaign.sent_count == 0
        # No resolution: no recipient rows.
        assert _recipients(db, campaign.id) == []
        # The raw selection is stored (normalized + deduped) for later
        # activation and edit prefill.
        assert campaign.roles == ["donor"]
        assert campaign.extra_emails == ["a@example.com", "b@example.com"]

    def test_create_draft_blank_subject_uses_default(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        assert resp.status_code == 201
        assert resp.json()["status"] == "draft"
        assert resp.json()["subject"] == "A message from Kindness Is Magic ✨"

    def test_create_draft_unresolvable_selection_allowed(self, test_client: TestClient, admin_user):
        # No purchaser users exist — a draft may store a selection that
        # resolves to nothing (users may exist by send time); activation
        # is where the resolution is checked.
        _admin_login(test_client)
        resp = test_client.post(BASE, json={"message": "Hi", "roles": ["purchaser"], "save_as_draft": True})
        assert resp.status_code == 201
        assert resp.json()["status"] == "draft"


# ---------------------------------------------------------------------------
# Update (edit a not-yet-delivering campaign)
# ---------------------------------------------------------------------------


class TestUpdateCampaign:
    def test_update_draft_fields(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(
            BASE,
            json={
                "message": "Old body",
                "roles": ["donor"],
                "extra_emails": ["a@example.com"],
                "subject": "Old subject",
                "save_as_draft": True,
            },
        )
        campaign_id = created.json()["id"]

        scheduled = datetime.now(timezone.utc) + timedelta(days=3)
        resp = test_client.patch(
            f"{BASE}/{campaign_id}",
            json={
                "subject": "New subject",
                "message": "New body",
                "roles": [],
                "extra_emails": ["  B@Example.com "],
                "scheduled_for": scheduled.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft"
        assert body["subject"] == "New subject"
        assert datetime.fromisoformat(body["scheduled_for"]) == scheduled

        campaign = _campaigns(db)[0]
        assert campaign.message == "New body"
        # The selection was replaced (normalized) — still no rows.
        assert campaign.roles == []
        assert campaign.extra_emails == ["b@example.com"]
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    def test_update_draft_clears_scheduled_for(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"scheduled_for": ""})
        assert resp.status_code == 200
        assert resp.json()["scheduled_for"] is None

    def test_update_blank_subject_falls_back_to_default(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"subject": "   "})
        assert resp.status_code == 200
        assert resp.json()["subject"] == "A message from Kindness Is Magic ✨"

    def test_update_pending_campaign_reresolves_recipients(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
        created = test_client.post(
            BASE,
            json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"], "scheduled_for": scheduled.isoformat()},
        )
        campaign_id = created.json()["id"]

        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"extra_emails": ["c@example.com"]})
        assert resp.status_code == 200
        assert resp.json()["total_recipients"] == 1
        assert resp.json()["status"] == "pending"

        campaign = _campaigns(db)[0]
        # The pending rows were replaced; the schedule survived the edit.
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.status) for r in rows] == [("c@example.com", EmailCampaignRecipientStatus.pending)]
        assert campaign.total_recipients == 1
        assert campaign.scheduled_for == scheduled

    def test_update_past_scheduled_for_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"scheduled_for": past.isoformat()})
        assert resp.status_code == 422
        assert "future" in resp.json()["detail"]

    def test_update_empty_selection_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"roles": [], "extra_emails": []})
        assert resp.status_code == 422
        assert "No recipients" in resp.json()["detail"]

    def test_update_validation_422s(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        assert test_client.patch(f"{BASE}/{campaign_id}", json={"extra_emails": ["not-an-email"]}).status_code == 422
        assert test_client.patch(f"{BASE}/{campaign_id}", json={"message": "   "}).status_code == 422
        assert test_client.patch(f"{BASE}/{campaign_id}", json={"subject": "x" * 201}).status_code == 422
        # A malformed datetime 422s (the clearable-datetime validator), not a 500.
        assert test_client.patch(f"{BASE}/{campaign_id}", json={"scheduled_for": "not-a-time"}).status_code == 422

    def test_update_not_editable_once_sending_409(self, test_client: TestClient, admin_user, db: Session):
        import asyncio

        from app.email_campaigns import process_next_campaign_email

        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"]})
        campaign_id = created.json()["id"]

        # Deliver the first recipient — something has settled now.
        asyncio.run(process_next_campaign_email(db))

        resp = test_client.patch(f"{BASE}/{campaign_id}", json={"message": "Changed"})
        assert resp.status_code == 409

    def test_update_not_editable_on_terminal_409(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        campaign_id = created.json()["id"]
        assert test_client.post(f"{BASE}/{campaign_id}/cancel").status_code == 200

        assert test_client.patch(f"{BASE}/{campaign_id}", json={"message": "Changed"}).status_code == 409

    def test_update_404(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        assert test_client.patch(f"{BASE}/99999", json={"message": "Hi"}).status_code == 404


# ---------------------------------------------------------------------------
# Send (activate a draft)
# ---------------------------------------------------------------------------


class TestSendCampaign:
    def test_send_draft_activates(self, test_client: TestClient, admin_user, db: Session):
        _make_user(db, "donor1@example.com", UserRole.donor)
        _admin_login(test_client)
        created = test_client.post(
            BASE,
            json={"message": "Hi", "roles": ["donor"], "extra_emails": ["extra@example.com"], "save_as_draft": True},
        )
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/send")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "pending"
        assert body["total_recipients"] == 2
        assert body["pending_count"] == 2

        campaign = _campaigns(db)[0]
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.status) for r in rows] == [
            ("donor1@example.com", EmailCampaignRecipientSource.role, EmailCampaignRecipientStatus.pending),
            ("extra@example.com", EmailCampaignRecipientSource.manual, EmailCampaignRecipientStatus.pending),
        ]

    def test_send_draft_honors_stored_scheduled_for(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        scheduled = datetime.now(timezone.utc) + timedelta(days=2)
        created = test_client.post(
            BASE,
            json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True, "scheduled_for": scheduled.isoformat()},
        )
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/send")
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"
        assert datetime.fromisoformat(resp.json()["scheduled_for"]) == scheduled
        assert _campaigns(db)[0].scheduled_for == scheduled

    def test_send_non_draft_409(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        campaign_id = created.json()["id"]

        assert test_client.post(f"{BASE}/{campaign_id}/send").status_code == 409

    def test_send_racing_concurrent_activation_409s(self, test_client: TestClient, db: Session):
        # The send route locks the campaign row: a send that loses the race
        # to a concurrent activation (row lock held, not yet committed)
        # waits on the lock, re-checks the latest committed row, and 409s —
        # instead of building a second recipient snapshot (which would email
        # everyone twice).
        #
        # Two separate connections are needed for a real lock race: the
        # racer runs in its own session (a real commit — the db fixture's
        # session sits in a rolled-back outer transaction and would never
        # hold a lock another connection waits on), and the app request
        # gets its own short-lived session (production behavior): on the
        # shared fixture session the route's FOR UPDATE lock would persist
        # in that outer transaction until teardown, deadlocking the
        # cross-transaction cleanup below. The admin user is committed too
        # (the fixture's lives in the rolled-back transaction, invisible to
        # the fresh session) — and the JWT cookie is minted directly
        # instead of via /login: the login's refresh-token row takes a KEY
        # SHARE lock on the user row, held until the fixture's teardown,
        # which would block the user's cleanup delete.
        import threading
        import time

        from app import database
        from app.auth import create_access_token, get_password_hash
        from app.email_campaigns import activate_campaign
        from app.main import app
        from tests.conftest import TestingSessionLocal

        racer = TestingSessionLocal()
        racing_campaign = None
        racer_admin = None
        shared_get_db = app.dependency_overrides[database.get_db]
        try:
            racer_admin = User(
                email="racing-admin@test.com",
                hashed_password=get_password_hash("Passw0rd!abc"),
                role=UserRole.admin,
                display_name=None,
            )
            racing_campaign = EmailCampaign(
                created_by=None,
                subject="Racing draft",
                message="Hi",
                roles=[],
                extra_emails=["a@example.com"],
                status=EmailCampaignStatus.draft,
            )
            # Committed for real, so the app request — a different session —
            # can see both.
            racer.add_all([racer_admin, racing_campaign])
            racer.commit()

            # The "other admin's" in-flight send: locked, resolved, activated,
            # flushed — but not committed, so the campaign row lock is held.
            racing_campaign = racer.query(EmailCampaign).filter(EmailCampaign.id == racing_campaign.id).with_for_update().first()
            activate_campaign(racer, racing_campaign)
            racer.flush()

            def _fresh_get_db():
                fresh = TestingSessionLocal()
                try:
                    yield fresh
                finally:
                    fresh.close()

            app.dependency_overrides[database.get_db] = _fresh_get_db
            try:
                test_client.cookies.set("access_token", create_access_token({"sub": str(racer_admin.id), "role": UserRole.admin}))

                def release() -> None:
                    time.sleep(1.0)  # let the request reach the lock wait
                    racer.commit()

                release_thread = threading.Thread(target=release)
                release_thread.start()
                resp = test_client.post(f"{BASE}/{racing_campaign.id}/send")
                release_thread.join()
            finally:
                app.dependency_overrides[database.get_db] = shared_get_db
                test_client.cookies.clear()

            assert resp.status_code == 409
            # The first activation's snapshot stands — no duplicate rows.
            campaign = _campaigns(db)[0]
            assert campaign.status.value == "pending"
            assert campaign.total_recipients == 1
            assert len(_recipients(db, racing_campaign.id)) == 1
        finally:
            # The racer's commit is real (it unblocks the request) — the db
            # fixture's teardown rolls back only its own transaction.
            if racing_campaign is not None:
                racer.delete(racing_campaign)
            if racer_admin is not None:
                racer.delete(racer_admin)
            racer.commit()
            racer.close()

    def test_send_draft_resolution_failure_422(self, test_client: TestClient, admin_user):
        # No purchaser users exist — the draft's selection resolves to
        # nothing at send time.
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "roles": ["purchaser"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/send")
        assert resp.status_code == 422
        assert "No recipients" in resp.json()["detail"]

    def test_send_draft_over_cap_422(self, test_client: TestClient, admin_user, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)
        _admin_login(test_client)
        created = test_client.post(
            BASE,
            json={"message": "Hi", "extra_emails": ["a@example.com", "b@example.com"], "save_as_draft": True},
        )
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/send")
        assert resp.status_code == 422
        assert "Too many recipients" in resp.json()["detail"]

    def test_send_404(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        assert test_client.post(f"{BASE}/99999/send").status_code == 404


# ---------------------------------------------------------------------------
# Delete (drafts only)
# ---------------------------------------------------------------------------


class TestDeleteCampaign:
    def test_delete_draft_204(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.delete(f"{BASE}/{campaign_id}")
        assert resp.status_code == 204
        assert resp.content == b""
        assert _campaigns(db) == []
        assert test_client.get(f"{BASE}/{campaign_id}").status_code == 404

    def test_delete_activated_409(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"]})
        campaign_id = created.json()["id"]

        resp = test_client.delete(f"{BASE}/{campaign_id}")
        assert resp.status_code == 409
        # The activated campaign (an audit record) is untouched.
        assert len(_campaigns(db)) == 1
        assert len(_recipients(db, campaign_id)) == 1

    def test_delete_404(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        assert test_client.delete(f"{BASE}/99999").status_code == 404


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

    def test_list_includes_drafts_with_zero_counts(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        draft = test_client.post(BASE, json={"message": "Draft", "extra_emails": ["a@example.com"], "save_as_draft": True})
        assert draft.status_code == 201

        items = test_client.get(BASE).json()["campaigns"]
        row = next(i for i in items if i["id"] == draft.json()["id"])
        assert row["status"] == "draft"
        assert row["total_recipients"] == 0
        assert row["sent_count"] == 0
        assert row["failed_count"] == 0
        assert row["pending_count"] == 0
        assert row["canceled_count"] == 0
        assert row["scheduled_for"] is None

    def test_detail_includes_scheduled_for_and_extra_emails(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
        created = test_client.post(
            BASE,
            json={
                "message": "Hi",
                "roles": ["donor"],
                "extra_emails": ["A@Example.com", "b@example.com"],
                "save_as_draft": True,
                "scheduled_for": scheduled.isoformat(),
            },
        )
        campaign_id = created.json()["id"]

        body = test_client.get(f"{BASE}/{campaign_id}").json()
        campaign = body["campaign"]
        assert campaign["status"] == "draft"
        assert datetime.fromisoformat(campaign["scheduled_for"]) == scheduled
        assert campaign["roles"] == ["donor"]
        assert campaign["extra_emails"] == ["a@example.com", "b@example.com"]
        # A draft has no recipient audit yet.
        assert body["total"] == 0
        assert body["recipients"] == []

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

    def test_cancel_draft_409(self, test_client: TestClient, admin_user, db: Session):
        _admin_login(test_client)
        created = test_client.post(BASE, json={"message": "Hi", "extra_emails": ["a@example.com"], "save_as_draft": True})
        campaign_id = created.json()["id"]

        resp = test_client.post(f"{BASE}/{campaign_id}/cancel")
        assert resp.status_code == 409
        # The draft is untouched (delete it, don't cancel it).
        assert _campaigns(db)[0].status.value == "draft"
