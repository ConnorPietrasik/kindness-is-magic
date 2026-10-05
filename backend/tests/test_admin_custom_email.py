"""Tests for admin custom emails: POST /api/admin/emails/send.

Tests run with SUPPRESS_SEND=1, so a "sent" outcome means the SMTP layer
was skipped, not that a message went out. Failure paths are monkeypatched
per the test_mail.py pattern; the rate limiter is a no-op in tests
(DEBUG skip) and is intentionally not asserted here.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

DEFAULT_SUBJECT = "A message from Kindness Is Magic ✨"

SEND_URL = "/api/admin/emails/send"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _sent_rows(db: Session):
    from app.models import EmailKind, SentEmail

    return db.query(SentEmail).filter(SentEmail.kind == EmailKind.custom_message).all()


class TestSendCustomEmail:
    """POST /api/admin/emails/send — send behaviour."""

    def test_admin_send_success(self, test_client: TestClient, admin_user, db: Session):
        """sent=true, one SentEmail row (kind custom_message, status sent,
        actor = admin, recipient trimmed + lowercased)."""
        _admin_login(test_client)
        resp = test_client.post(
            SEND_URL,
            json={"recipient_email": "  Locked@Example.COM ", "subject": "Hi there", "message": "Hello!"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"sent": True, "reason": None}

        rows = _sent_rows(db)
        assert len(rows) == 1
        row = rows[0]
        from app.models import EmailStatus

        assert row.status == EmailStatus.sent
        assert row.failure_reason is None
        assert row.recipient_email == "locked@example.com"
        assert row.user_id == admin_user.id

    def test_blank_subject_uses_default_and_branded_wrap(self, test_client: TestClient, admin_user):
        """Blank (or missing) subject → default; body is escaped, paragraph-
        and line-break-rendered, wrapped with the branded header and the
        unsubscribe footer."""
        _admin_login(test_client)
        captured: list = []

        async def _capture(message):
            captured.append(message)

        with patch("app.mail.mail_manager.send_message", new=MagicMock(side_effect=_capture)):
            resp = test_client.post(
                SEND_URL,
                json={"recipient_email": "a@example.com", "subject": "   ", "message": "Para one\n\nPara two\nwith break <b>bold</b>"},
            )
        assert resp.status_code == 200
        assert resp.json() == {"sent": True, "reason": None}

        message = captured[0]
        assert message.subject == DEFAULT_SUBJECT
        # fastapi-mail normalizes recipients to NameEmail objects
        assert [r.email for r in message.recipients] == ["a@example.com"]
        # Plain text is escaped, blank line → new paragraph, single newline → <br/>
        assert "<p>Para one</p>" in message.body
        assert "<p>Para two<br/>with break &lt;b&gt;bold&lt;/b&gt;</p>" in message.body
        assert "<b>bold</b>" not in message.body
        # Branded wrap + unsubscribe footer
        assert "Kindness Is Magic" in message.body
        assert "click here to unsubscribe" in message.body

    def test_missing_subject_uses_default(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        captured: list = []

        async def _capture(message):
            captured.append(message)

        with patch("app.mail.mail_manager.send_message", new=MagicMock(side_effect=_capture)):
            resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi"})
        assert resp.status_code == 200
        assert captured[0].subject == DEFAULT_SUBJECT

    def test_unsubscribed_recipient_blocked(self, test_client: TestClient, admin_user, db: Session):
        """Unsubscribed recipients are blocked and reported (not exempt):
        sent=false, reason=unsubscribed, and a failed log row."""
        from app.models import EmailPreference

        db.add(EmailPreference(email="gone@example.com", unsubscribed_at=datetime.now(timezone.utc)))
        db.commit()

        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "Gone@Example.com", "message": "Hi"})
        assert resp.status_code == 200
        assert resp.json() == {"sent": False, "reason": "unsubscribed"}

        rows = _sent_rows(db)
        assert len(rows) == 1
        from app.models import EmailStatus

        assert rows[0].status == EmailStatus.failed
        assert rows[0].failure_reason == "unsubscribed"
        assert rows[0].recipient_email == "gone@example.com"
        assert rows[0].user_id == admin_user.id

    def test_smtp_error_reported(self, test_client: TestClient, admin_user, db: Session):
        """SMTP failure (monkeypatched, never real SMTP): sent=false,
        reason=smtp_error, and a failed log row."""

        async def _raise(message):
            raise Exception("Connection refused")

        _admin_login(test_client)
        with patch("app.mail.mail_manager.send_message", new=MagicMock(side_effect=_raise)):
            resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi"})
        assert resp.status_code == 200
        assert resp.json() == {"sent": False, "reason": "smtp_error"}

        rows = _sent_rows(db)
        assert len(rows) == 1
        from app.models import EmailStatus

        assert rows[0].status == EmailStatus.failed
        assert rows[0].failure_reason == "smtp_error"
        assert rows[0].user_id == admin_user.id


class TestSendCustomEmailAuth:
    """POST /api/admin/emails/send — access control."""

    def test_401_unauthenticated(self, test_client: TestClient, admin_user):
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi"})
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, admin_user, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi"})
        assert resp.status_code == 403


class TestSendCustomEmailValidation:
    """POST /api/admin/emails/send — request validation (422s)."""

    def test_missing_recipient_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"message": "Hi"})
        assert resp.status_code == 422

    def test_invalid_recipient_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "not-an-email", "message": "Hi"})
        assert resp.status_code == 422

    def test_blank_message_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        for message in ("", "   \n  "):
            resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": message})
            assert resp.status_code == 422, message

    def test_oversized_message_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "x" * 5001})
        assert resp.status_code == 422

    def test_message_at_limit_ok(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "x" * 5000})
        assert resp.status_code == 200

    def test_oversized_recipient_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a" * 109 + "@example.com", "message": "Hi"})
        assert resp.status_code == 422

    def test_recipient_at_limit_ok(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a" * 108 + "@example.com", "message": "Hi"})
        assert resp.status_code == 200

    def test_oversized_subject_422(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi", "subject": "s" * 201})
        assert resp.status_code == 422

    def test_subject_at_limit_ok(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(SEND_URL, json={"recipient_email": "a@example.com", "message": "Hi", "subject": "s" * 200})
        assert resp.status_code == 200
