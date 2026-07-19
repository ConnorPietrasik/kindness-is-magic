"""Tests for mail infrastructure (Phase 1): mail helpers, unsubscribe endpoint, EmailPreference model."""

from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import jwt
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import SECRET_KEY, ALGORITHM

# ---------------------------------------------------------------------------
# Mail module unit tests
# ---------------------------------------------------------------------------


class TestUnsubscribeUrl:
    def test_generates_valid_jwt_token(self):
        from app.mail import _unsubscribe_url

        url = _unsubscribe_url("test@example.com")
        assert "/api/auth/unsubscribe?token=" in url

        # Extract token and decode
        token = url.split("token=")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["email"] == "test@example.com"

    def test_token_has_no_expiry(self):
        from app.mail import _unsubscribe_url

        url = _unsubscribe_url("test@example.com")
        token = url.split("token=")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": False})
        assert "exp" not in payload

    def test_url_uses_app_base_url(self, monkeypatch):
        from app import mail as mail_mod

        monkeypatch.setenv("APP_BASE_URL", "http://custom.example.com")
        # Force re-read of env var by patching os.environ
        with patch.object(mail_mod.os, "environ", {"APP_BASE_URL": "http://custom.example.com"}):
            url = mail_mod._unsubscribe_url("test@example.com")
            assert url.startswith("http://custom.example.com/api/auth/unsubscribe?token=")


class TestCheckUnsubscribed:
    def test_not_unsubscribed(self, db: Session):
        from app.mail import check_unsubscribed

        with patch("app.mail.SessionLocal", return_value=db):
            result = check_unsubscribed("nobody@example.com")
        assert result is False

    def test_is_unsubscribed(self, db: Session):
        from app.models import EmailPreference
        from app.mail import check_unsubscribed

        pref = EmailPreference(email="unsub@example.com", unsubscribed_at=datetime.now(timezone.utc))
        db.add(pref)
        db.commit()

        with patch("app.mail.SessionLocal", return_value=db):
            result = check_unsubscribed("unsub@example.com")
        assert result is True

    def test_case_insensitive(self, db: Session):
        from app.models import EmailPreference
        from app.mail import check_unsubscribed

        pref = EmailPreference(email="lower@example.com", unsubscribed_at=datetime.now(timezone.utc))
        db.add(pref)
        db.commit()

        with patch("app.mail.SessionLocal", return_value=db):
            result = check_unsubscribed("LOWER@EXAMPLE.COM")
        assert result is True


class TestSendEmail:
    def test_returns_sent_true_on_success(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                result = send_email("test@example.com", "Test Subject", "<p>Body</p>")

        assert result == {"sent": True, "reason": None}

    def test_returns_unsubscribed_when_blocked(self, monkeypatch):
        from app.mail import send_email

        with patch("app.mail.check_unsubscribed", return_value=True):
            result = send_email("test@example.com", "Test Subject", "<p>Body</p>")

        assert result == {"sent": False, "reason": "unsubscribed"}

    def test_exempt_bypasses_unsubscribe_check(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=True):
                result = send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    exempt_unsubscribe=True,
                )

        assert result == {"sent": True, "reason": None}

    def test_smtp_error_returns_failure(self, monkeypatch):
        from app.mail import send_email

        async def _raise(*args, **kwargs):
            raise Exception("Connection refused")

        with patch("app.mail.mail_manager.send_message", side_effect=_raise):
            with patch("app.mail.check_unsubscribed", return_value=False):
                result = send_email("test@example.com", "Test Subject", "<p>Body</p>")

        assert result == {"sent": False, "reason": "smtp_error"}

    def test_wraps_body_with_branding(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                send_email("test@example.com", "Test Subject", "<p>Custom Body</p>")

        # Verify the HTML passed to send_message includes branding
        call_args = mock_send.call_args
        html = call_args[0][0].body
        assert "Kindness Is Magic" in html
        assert "Custom Body" in html
        assert "unsubscribe" in html.lower()

    def test_exempt_omits_unsubscribe_link(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    exempt_unsubscribe=True,
                    include_unsubscribe_link=False,
                )

        html = mock_send.call_args[0][0].body
        assert "unsubscribe" not in html.lower()


class TestEmailTemplates:
    def test_invite_email_contains_code(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-ABC123",
            family_limit=10,
            expires_at=datetime(2026, 12, 25, 12, 0, tzinfo=timezone.utc),
        )
        assert "KMG-ABC123" in html
        assert "10" in html

    def test_invite_email_contains_expiry(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-XYZ789",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
        )
        assert "June 15, 2026" in html

    def test_invite_email_singular_family(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-SING",
            family_limit=1,
            expires_at=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        )
        assert "family." in html
        assert "families" not in html

    def test_invite_email_with_from_name(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-NAMED",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            from_name="Jane Smith",
        )
        assert "Jane Smith" in html
        assert "invited by" in html

    def test_invite_email_without_from_name(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-GENERIC",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
        )
        assert "invited by" not in html
        assert "You're invited" in html

    def test_password_reset_email_contains_link(self):
        from app.mail import build_password_reset_email

        html = build_password_reset_email("http://localhost:3000/reset?token=abc123")
        assert "http://localhost:3000/reset?token=abc123" in html
        assert "Reset Password" in html

    def test_password_reset_email_no_unsubscribe(self):
        from app.mail import build_password_reset_email

        html = build_password_reset_email("http://localhost:3000/reset?token=abc123")
        assert "unsubscribe" not in html.lower()


# ---------------------------------------------------------------------------
# Unsubscribe endpoint tests
# ---------------------------------------------------------------------------


class TestUnsubscribeEndpoint:
    def _make_token(self, email: str) -> str:
        """Create a valid unsubscribe JWT token for a given email."""
        return jwt.encode({"email": email}, SECRET_KEY, algorithm=ALGORITHM)

    def test_unsubscribe_success(self, test_client: TestClient, db: Session):
        token = self._make_token("user@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200
        body = resp.json()
        assert "unsubscribed" in body["message"].lower()
        assert "user@example.com" in body["message"]

    def test_unsubscribe_creates_preference(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference

        token = self._make_token("new@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

        pref = db.query(EmailPreference).filter(EmailPreference.email == "new@example.com").first()
        assert pref is not None
        assert pref.unsubscribed_at is not None

    def test_unsubscribe_updates_existing(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference
        import time

        # Pre-create preference
        old_time = datetime(2020, 1, 1, tzinfo=timezone.utc)
        pref = EmailPreference(email="existing@example.com", unsubscribed_at=old_time)
        db.add(pref)
        db.commit()

        time.sleep(0.1)  # Ensure different timestamp

        token = self._make_token("existing@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

        db.refresh(pref)
        assert pref.unsubscribed_at > old_time

    def test_unsubscribe_invalid_token(self, test_client: TestClient):
        resp = test_client.get("/api/auth/unsubscribe?token=invalid-token-value")
        assert resp.status_code == 400
        assert "invalid" in resp.json()["detail"].lower() or "malformed" in resp.json()["detail"].lower()

    def test_unsubscribe_missing_token(self, test_client: TestClient):
        resp = test_client.get("/api/auth/unsubscribe")
        assert resp.status_code in (400, 422)

    def test_unsubscribe_email_normalised(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference

        token = self._make_token("UPPER@EXAMPLE.COM")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

        pref = db.query(EmailPreference).filter(EmailPreference.email == "upper@example.com").first()
        assert pref is not None

    def test_unsubscribe_no_auth_required(self, test_client: TestClient):
        """Unsubscribe should work without authentication."""
        token = self._make_token("noauth@example.com")
        # No login, no cookies
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

    def test_unsubscribe_token_expired_still_works(self, test_client: TestClient):
        """Unsubscribe tokens have no expiry, so even an 'expired' token should work
        as long as the signature is valid. Our tokens don't include exp, so this
        is inherently true, but let's verify by decoding with verify_exp=True."""
        token = self._make_token("noexp@example.com")
        # This should not raise ExpiredSignatureError since there's no exp claim
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert "exp" not in payload
        assert payload["email"] == "noexp@example.com"

        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

    def test_unsubscribe_tampered_token_rejected(self, test_client: TestClient):
        """A token signed with a different key should be rejected."""
        bad_token = jwt.encode({"email": "hacker@example.com"}, "wrong-secret", algorithm=ALGORITHM)
        resp = test_client.get(f"/api/auth/unsubscribe?token={bad_token}")
        assert resp.status_code == 400

    def test_unsubscribe_token_without_email_rejected(self, test_client: TestClient):
        """A valid JWT but without the email claim should be rejected."""
        token = jwt.encode({"sub": "123"}, SECRET_KEY, algorithm=ALGORITHM)
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 400
