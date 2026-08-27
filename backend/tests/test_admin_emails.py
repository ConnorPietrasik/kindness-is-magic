"""Tests for the admin sent-email log: GET /api/admin/emails."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _make_user(db: Session, email: str, role: str, display_name: str | None = None, deleted: bool = False):
    """Create a user (optionally soft-deleted) and return it."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email=email,
        hashed_password=get_password_hash("Passw0rd!123"),
        role=UserRole[role],
        display_name=display_name,
    )
    if deleted:
        user.deleted_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed(
    db: Session,
    user,
    recipient: str,
    kind: str,
    status: str = "sent",
    reason: str | None = None,
    sent_at: datetime | None = None,
):
    """Insert a SentEmail row (user=None → NULL actor) and return it."""
    from app.models import EmailKind, EmailStatus, SentEmail

    row = SentEmail(
        user_id=user.id if user else None,
        recipient_email=recipient,
        kind=EmailKind[kind],
        status=EmailStatus[status],
        failure_reason=reason,
    )
    if sent_at is not None:
        row.sent_at = sent_at
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestAdminEmailsAuth:
    """GET /api/admin/emails — access control."""

    def test_401_unauthenticated(self, test_client: TestClient, admin_user):
        resp = test_client.get("/api/admin/emails")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, admin_user, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/admin/emails")
        assert resp.status_code == 403


class TestAdminEmailsList:
    """GET /api/admin/emails — list behaviour."""

    def test_empty_list(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"emails": [], "total": 0, "page": 1, "page_size": 50, "total_pages": 0}

    def test_rows_and_default_sort_newest_first(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        now = datetime.now(timezone.utc)
        _seed(db, actor, "old@example.com", "family_invite", sent_at=now - timedelta(hours=2))
        _seed(db, actor, "new@example.com", "claim_confirmation", sent_at=now, reason=None)
        _seed(db, actor, "mid@example.com", "password_reset", status="failed", reason="smtp_error", sent_at=now - timedelta(hours=1))

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3
        assert [e["recipient_email"] for e in body["emails"]] == ["new@example.com", "mid@example.com", "old@example.com"]
        # Item fields
        assert set(body["emails"][0].keys()) == {
            "id",
            "recipient_email",
            "kind",
            "status",
            "failure_reason",
            "sent_at",
            "sender_name",
        }
        assert body["emails"][1]["status"] == "failed"
        assert body["emails"][1]["failure_reason"] == "smtp_error"
        assert body["emails"][1]["kind"] == "password_reset"

    def test_pagination(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        for i in range(5):
            _seed(db, actor, f"page{i}@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"page": 2, "page_size": 2})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 5
        assert body["page"] == 2
        assert body["page_size"] == 2
        assert body["total_pages"] == 3
        assert len(body["emails"]) == 2

    def test_page_size_capped_at_200(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"page_size": 500})
        assert resp.status_code == 422

    def test_search_recipient_ilike(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "alice@family.org", "family_invite")
        _seed(db, actor, "bob@family.org", "family_invite")
        _seed(db, actor, "carol@other.org", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"search": "FAMILY"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert {e["recipient_email"] for e in body["emails"]} == {"alice@family.org", "bob@family.org"}

    def test_search_no_match(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "alice@family.org", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"search": "zzz"})
        assert resp.status_code == 200
        assert resp.json() == {"emails": [], "total": 0, "page": 1, "page_size": 50, "total_pages": 0}

    def test_kind_filter(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@example.com", "family_invite")
        _seed(db, actor, "b@example.com", "claim_confirmation")
        _seed(db, actor, "c@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"kind": "claim_confirmation"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["emails"][0]["recipient_email"] == "b@example.com"

    def test_status_filter(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@example.com", "family_invite", status="sent")
        _seed(db, actor, "b@example.com", "family_invite", status="failed", reason="smtp_error")
        _seed(db, actor, "c@example.com", "family_invite", status="reset")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"status": "reset"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["emails"][0]["recipient_email"] == "c@example.com"

    def test_filters_combine(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@x.org", "family_invite", status="sent")
        _seed(db, actor, "b@x.org", "family_invite", status="failed")
        _seed(db, actor, "c@y.org", "family_invite", status="sent")
        _seed(db, actor, "d@x.org", "claim_confirmation", status="sent")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"kind": "family_invite", "status": "sent", "search": "x.org"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["emails"][0]["recipient_email"] == "a@x.org"

    def test_sort_recipient_asc(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        for name in ("charlie", "alice", "bob"):
            _seed(db, actor, f"{name}@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"sort": "recipient_email"})
        assert resp.status_code == 200
        assert [e["recipient_email"] for e in resp.json()["emails"]] == [
            "alice@example.com",
            "bob@example.com",
            "charlie@example.com",
        ]

    def test_sort_kind_desc(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@example.com", "admin_failure_notice")
        _seed(db, actor, "b@example.com", "referrer_invite")
        _seed(db, actor, "c@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"sort": "-kind"})
        assert resp.status_code == 200
        # Postgres sorts enum columns by type-definition order (descending here)
        assert [e["kind"] for e in resp.json()["emails"]] == ["admin_failure_notice", "referrer_invite", "family_invite"]

    def test_sort_invalid_field_uses_default(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        now = datetime.now(timezone.utc)
        _seed(db, actor, "b@example.com", "family_invite", sent_at=now)
        _seed(db, actor, "a@example.com", "family_invite", sent_at=now - timedelta(hours=1))

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"sort": "bogus"})
        assert resp.status_code == 200
        # Default: sent_at desc
        assert [e["recipient_email"] for e in resp.json()["emails"]] == ["b@example.com", "a@example.com"]

    def test_columns_filters_response_fields(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"columns": "id,sender_name"})
        assert resp.status_code == 200
        item = resp.json()["emails"][0]
        # Requested column + always-include id + required fields; failure_reason trimmed
        assert set(item.keys()) == {"id", "recipient_email", "kind", "status", "sent_at", "sender_name"}
        assert "failure_reason" not in item

    def test_columns_unknown_field_400(self, test_client: TestClient, admin_user, db: Session):
        actor = _make_user(db, "actor_ref@test.com", "referrer", "Actor Ref")
        _seed(db, actor, "a@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"columns": "nope"})
        assert resp.status_code == 400
        assert "nope" in resp.json()["detail"]

    def test_sender_name_variants(self, test_client: TestClient, admin_user, db: Session):
        """sender_name: active actor → display name; NULL actor or
        soft-deleted actor → None."""
        active = _make_user(db, "active@example.com", "referrer", "Active Referrer")
        deleted = _make_user(db, "deleted@example.com", "referrer", "Deleted Referrer", deleted=True)

        _seed(db, active, "to-active@example.com", "family_invite")
        _seed(db, None, "to-anon@example.com", "password_reset")
        _seed(db, deleted, "to-deleted@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails")
        assert resp.status_code == 200
        by_recipient = {e["recipient_email"]: e for e in resp.json()["emails"]}
        assert by_recipient["to-active@example.com"]["sender_name"] == "Active Referrer"
        assert by_recipient["to-anon@example.com"]["sender_name"] is None
        assert by_recipient["to-deleted@example.com"]["sender_name"] is None

    def test_sender_name_skipped_when_column_not_requested(self, test_client: TestClient, admin_user, db: Session):
        """When sender_name isn't in the columns selection, the users lookup
        is skipped and sender_name is omitted from the items."""
        active = _make_user(db, "active2@example.com", "referrer", "Active Referrer")
        _seed(db, active, "x@example.com", "family_invite")

        _admin_login(test_client)
        resp = test_client.get("/api/admin/emails", params={"columns": "id,recipient_email"})
        assert resp.status_code == 200
        item = resp.json()["emails"][0]
        assert "sender_name" not in item
        assert item["recipient_email"] == "x@example.com"
