"""Tests for mail infrastructure (Phase 1): mail helpers, unsubscribe endpoint, EmailPreference model."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import SECRET_KEY, ALGORITHM
from app.models import EmailKind

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

    def test_token_is_purpose_scoped_and_expiring(self):
        """Tokens carry type=unsubscribe and an exp ~30 days out."""
        from app.mail import _unsubscribe_url

        url = _unsubscribe_url("test@example.com")
        token = url.split("token=")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["type"] == "unsubscribe"
        assert payload["exp"] > datetime.now(timezone.utc).timestamp()
        ttl_days = (payload["exp"] - datetime.now(timezone.utc).timestamp()) / 86400
        assert 29 < ttl_days <= 30

    def test_url_uses_app_base_url(self, monkeypatch):
        from app import mail as mail_mod

        # mail.py imports APP_BASE_URL at module level, so we patch the binding on mail_mod directly
        monkeypatch.setattr(mail_mod, "APP_BASE_URL", "http://custom.example.com")
        url = mail_mod._unsubscribe_url("test@example.com")
        assert url.startswith("http://custom.example.com/api/auth/unsubscribe?token=")


class TestCheckUnsubscribed:
    def test_not_unsubscribed(self, db: Session):
        from app.mail import check_unsubscribed

        result = check_unsubscribed("nobody@example.com", db)
        assert result is False

    def test_is_unsubscribed(self, db: Session):
        from app.models import EmailPreference
        from app.mail import check_unsubscribed

        pref = EmailPreference(email="unsub@example.com", unsubscribed_at=datetime.now(timezone.utc))
        db.add(pref)
        db.commit()

        result = check_unsubscribed("unsub@example.com", db)
        assert result is True

    def test_case_insensitive(self, db: Session):
        from app.models import EmailPreference
        from app.mail import check_unsubscribed

        pref = EmailPreference(email="lower@example.com", unsubscribed_at=datetime.now(timezone.utc))
        db.add(pref)
        db.commit()

        result = check_unsubscribed("LOWER@EXAMPLE.COM", db)
        assert result is True


class TestSendEmail:
    async def test_returns_sent_true_on_success(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        mock_db = MagicMock()
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                result = await send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    mock_db,
                    kind=EmailKind.password_reset,
                )

        assert result == {"sent": True, "reason": None}

    async def test_returns_unsubscribed_when_blocked(self, monkeypatch):
        from app.mail import send_email

        mock_db = MagicMock()
        with patch("app.mail.check_unsubscribed", return_value=True):
            result = await send_email(
                "test@example.com",
                "Test Subject",
                "<p>Body</p>",
                mock_db,
                kind=EmailKind.password_reset,
            )

        assert result == {"sent": False, "reason": "unsubscribed"}

    async def test_exempt_bypasses_unsubscribe_check(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        mock_db = MagicMock()
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=True):
                result = await send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    mock_db,
                    kind=EmailKind.password_reset,
                    exempt_unsubscribe=True,
                )

        assert result == {"sent": True, "reason": None}

    async def test_smtp_error_returns_failure(self, monkeypatch):
        from app.mail import send_email

        async def _raise(*args, **kwargs):
            raise Exception("Connection refused")

        mock_db = MagicMock()
        with patch("app.mail.mail_manager.send_message", side_effect=_raise):
            with patch("app.mail.check_unsubscribed", return_value=False):
                result = await send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    mock_db,
                    kind=EmailKind.password_reset,
                )

        assert result == {"sent": False, "reason": "smtp_error"}

    async def test_wraps_body_with_branding(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        mock_db = MagicMock()
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                await send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Custom Body</p>",
                    mock_db,
                    kind=EmailKind.family_invite,
                )

        # Verify the HTML passed to send_message includes branding
        call_args = mock_send.call_args
        html = call_args[0][0].body
        assert "Kindness Is Magic" in html
        assert "Custom Body" in html
        assert "unsubscribe" in html.lower()

    async def test_exempt_omits_unsubscribe_link(self, monkeypatch):
        from app.mail import send_email

        async def _no_op(*args, **kwargs):
            return None

        mock_send = MagicMock(side_effect=_no_op)
        mock_db = MagicMock()
        with patch("app.mail.mail_manager.send_message", mock_send):
            with patch("app.mail.check_unsubscribed", return_value=False):
                await send_email(
                    "test@example.com",
                    "Test Subject",
                    "<p>Body</p>",
                    mock_db,
                    kind=EmailKind.admin_failure_notice,
                    user_id=1,
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

    def test_invite_email_with_email_param_contains_link(self):
        """When email param is provided, the Get Started link includes code+email."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-ABC123",
            family_limit=10,
            expires_at=datetime(2026, 12, 25, 12, 0, tzinfo=timezone.utc),
            email="test@example.com",
        )
        assert "register-referrer?code=KMG-ABC123&email=test%40example.com" in html

    def test_invite_email_without_email_param_has_plain_link(self):
        """When email param is not provided, the Get Started link is plain."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-ABC123",
            family_limit=10,
            expires_at=datetime(2026, 12, 25, 12, 0, tzinfo=timezone.utc),
        )
        assert '/register-referrer"' in html or "/register-referrer>" in html
        assert "?code=" not in html

    def test_invite_email_custom_message_rendered_escaped(self):
        """Custom message is plain text — HTML in it renders as escaped text."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-CUST",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            email="newref@example.com",
            email_message="Please watch <script>alert('x')</script> before registering",
        )
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "alert(&#x27;x&#x27;)" in html

    def test_invite_email_custom_message_keeps_paragraph_and_line_structure(self):
        """Blank lines split paragraphs; single newlines within a paragraph become <br/>."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-TIME",
            family_limit=3,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            email_message="Hi there!\n\nTimeline:\n- Monday: intro call\n- Tuesday: site visit\n\nWarm regards,\nJane",
        )
        assert "<p>Hi there!</p>" in html
        assert "<p>Timeline:<br/>- Monday: intro call<br/>- Tuesday: site visit</p>" in html
        assert "<p>Warm regards,<br/>Jane</p>" in html

    def test_invite_email_custom_message_normalizes_crlf(self):
        """Windows line endings split paragraphs the same way."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-CRLF",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            email_message="Line one\r\n\r\nLine two",
        )
        assert "<p>Line one</p>" in html
        assert "<p>Line two</p>" in html

    def test_invite_email_custom_message_keeps_functional_block(self):
        """Code, locked-email note, expiry, and CTA still render with a custom message."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-FUNC",
            family_limit=2,
            expires_at=datetime(2026, 12, 25, 12, 0, tzinfo=timezone.utc),
            email="locked@example.com",
            email_message="Custom prose here.",
        )
        assert "Custom prose here." in html
        assert "KMG-FUNC" in html
        assert "locked to <strong>locked@example.com</strong>" in html
        assert "December 25, 2026" in html
        assert "Get Started" in html

    def test_invite_email_custom_message_replaces_default_prose(self):
        """Greeting, intro, family-limit line, and closing are gone when custom is set."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-CUST2",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            from_name="Jane Smith",
            email="newref@example.com",
            email_message="Custom prose here.",
        )
        assert "Custom prose here." in html
        assert "invited by" not in html
        assert "We'd love your help" not in html
        assert "connect up to" not in html
        assert "Thank you for being part of something wonderful" not in html

    def test_invite_email_custom_message_no_blank_line_without_limit_line(self):
        """The custom variant has no family-limit line — it must not leave a blank line in the block."""
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-BLANK",
            family_limit=2,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            email="locked@example.com",
            email_message="Custom prose here.",
        )
        assert "\n\n" not in html

    def test_family_invite_email_contains_code_and_name(self):
        from app.mail import build_family_invite_email

        html = build_family_invite_email(code="KFI-ABC123", referrer_name="Jane Smith", email="family@example.com")
        assert "KFI-ABC123" in html
        assert "Jane Smith" in html
        assert "register-family?code=KFI-ABC123&email=family%40example.com" in html

    def test_family_invite_email_url_encodes_special_chars(self):
        """A + in the address must stay %2B (raw + would decode to a space)."""
        from app.mail import build_family_invite_email

        html = build_family_invite_email(code="KFI-ABC123", referrer_name="Jane Smith", email="jane+gift@example.com")
        assert "email=jane%2Bgift%40example.com" in html

    def test_family_invite_email_has_get_started_button(self):
        from app.mail import build_family_invite_email

        html = build_family_invite_email(code="KFI-XYZ789", referrer_name="John Doe", email="family@example.com")
        assert "Get Started" in html

    def test_family_invite_email_links_wish_list_guide(self, monkeypatch):
        """The slimmed email points at the public wish list guide off APP_BASE_URL."""
        from app import mail as mail_mod
        from app.mail import build_family_invite_email

        monkeypatch.setattr(mail_mod, "APP_BASE_URL", "http://custom.example.com")
        html = build_family_invite_email(code="KFI-ABC123", referrer_name="Jane Smith", email="family@example.com")
        assert 'href="http://custom.example.com/wish-list-guide"' in html
        assert "wish list guide" in html

    # --- HTML escaping ---
    # Names/text reach the builders from self-registration through a rejector
    # that only catches *terminated* tags, so unterminated payloads pass
    # validation — the builders must escape before interpolating into HTML.

    IMG_PAYLOAD = "<img src=x onerror=alert(1)"

    def test_invite_email_escapes_from_name(self):
        from app.mail import build_invite_email

        html = build_invite_email(
            code="KMG-ESC",
            family_limit=5,
            expires_at=datetime(2026, 6, 15, 9, 30, tzinfo=timezone.utc),
            from_name=self.IMG_PAYLOAD,
        )
        assert "<img" not in html
        assert "&lt;img src=x onerror=alert(1)" in html

    def test_family_invite_email_escapes_referrer_name(self):
        from app.mail import build_family_invite_email

        html = build_family_invite_email(code="KFI-ESC", referrer_name=self.IMG_PAYLOAD, email="family@example.com")
        assert "<img" not in html
        assert "&lt;img src=x onerror=alert(1)" in html

    def test_family_pending_email_escapes_names(self):
        from app.mail import build_family_pending_email

        html = build_family_pending_email(self.IMG_PAYLOAD, "Ref <svg/onload=alert(2)")
        assert "<img" not in html
        assert "<svg" not in html
        assert "&lt;img src=x onerror=alert(1)" in html
        assert "&lt;svg/onload=alert(2)" in html

    def test_family_verified_email_escapes_names(self):
        from app.mail import build_family_verified_email

        html = build_family_verified_email(self.IMG_PAYLOAD, "Ref <svg/onload=alert(2)")
        assert "<img" not in html
        assert "<svg" not in html
        assert "&lt;img src=x onerror=alert(1)" in html
        assert "&lt;svg/onload=alert(2)" in html

    def test_family_rejected_email_escapes_names(self):
        from app.mail import build_family_rejected_email

        html = build_family_rejected_email(self.IMG_PAYLOAD, "Ref <svg/onload=alert(2)")
        assert "<img" not in html
        assert "<svg" not in html
        assert html.count("&lt;svg/onload=alert(2)") == 2  # referrer name appears twice

    def test_referrer_approved_email_escapes_name(self):
        from app.mail import build_referrer_approved_email

        html = build_referrer_approved_email(self.IMG_PAYLOAD)
        assert "<img" not in html
        assert "&lt;img src=x onerror=alert(1)" in html

    def test_referrer_rejected_email_escapes_name(self):
        from app.mail import build_referrer_rejected_email

        html = build_referrer_rejected_email(self.IMG_PAYLOAD)
        assert "<img" not in html
        assert "&lt;img src=x onerror=alert(1)" in html

    def test_payment_request_email_escapes_donor_name(self):
        from app.mail import build_payment_request_email

        html = build_payment_request_email(
            donor_name=self.IMG_PAYLOAD,
            lines=[{"display_id": "1-1", "includes_groceries": False, "line_total_usd": 100}],
            total_usd=100,
            expires_at=datetime(2026, 12, 25, tzinfo=timezone.utc),
            cart_url="http://localhost/donor/cart",
        )
        assert self.IMG_PAYLOAD not in html
        assert "&lt;img src=x onerror=alert(1)" in html


# ---------------------------------------------------------------------------
# Unsubscribe endpoint tests
# ---------------------------------------------------------------------------


class TestUnsubscribeEndpoint:
    def _make_token(
        self,
        email: str,
        token_type: str | None = "unsubscribe",
        exp_delta: timedelta = timedelta(days=30),
    ) -> str:
        """Create an unsubscribe JWT token for a given email (default: valid)."""
        claims: dict = {"email": email, "exp": datetime.now(timezone.utc) + exp_delta}
        if token_type is not None:
            claims["type"] = token_type
        return jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM)

    # -- GET /unsubscribe: confirmation page, no mutation -------------------

    def test_get_returns_confirm_page(self, test_client: TestClient, db: Session):
        token = self._make_token("user@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert resp.headers["cache-control"] == "no-store"  # credential + PII page, never cache
        assert "user@example.com" in resp.text
        # The page posts to the confirm endpoint carrying the token
        assert f"/api/auth/unsubscribe/confirm?token={token}" in resp.text

    def test_get_does_not_write_preference(self, test_client: TestClient, db: Session):
        """A bare GET (prefetcher / scanner) must never unsubscribe anyone."""
        from app.models import EmailPreference

        token = self._make_token("prefetched@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200
        assert db.query(EmailPreference).count() == 0

    def test_get_no_auth_required(self, test_client: TestClient):
        """The confirm page should render without authentication."""
        token = self._make_token("noauth@example.com")
        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 200

    # -- POST /unsubscribe/confirm: performs the unsubscribe ----------------

    def test_confirm_creates_preference(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference

        token = self._make_token("new@example.com")
        resp = test_client.post(f"/api/auth/unsubscribe/confirm?token={token}")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert resp.headers["cache-control"] == "no-store"  # credential + PII page, never cache
        assert "new@example.com" in resp.text

        pref = db.query(EmailPreference).filter(EmailPreference.email == "new@example.com").first()
        assert pref is not None
        assert pref.unsubscribed_at is not None

    def test_confirm_updates_existing(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference
        import time

        # Pre-create preference
        old_time = datetime(2020, 1, 1, tzinfo=timezone.utc)
        pref = EmailPreference(email="existing@example.com", unsubscribed_at=old_time)
        db.add(pref)
        db.commit()

        time.sleep(0.1)  # Ensure different timestamp

        token = self._make_token("existing@example.com")
        resp = test_client.post(f"/api/auth/unsubscribe/confirm?token={token}")
        assert resp.status_code == 200

        db.refresh(pref)
        assert pref.unsubscribed_at > old_time

    def test_confirm_no_auth_required(self, test_client: TestClient, db: Session):
        """Unsubscribe should work without authentication."""
        token = self._make_token("noauth2@example.com")
        resp = test_client.post(f"/api/auth/unsubscribe/confirm?token={token}")
        assert resp.status_code == 200

    def test_confirm_email_normalised(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference

        token = self._make_token("UPPER@EXAMPLE.COM")
        resp = test_client.post(f"/api/auth/unsubscribe/confirm?token={token}")
        assert resp.status_code == 200

        pref = db.query(EmailPreference).filter(EmailPreference.email == "upper@example.com").first()
        assert pref is not None

    # -- Token validation ----------------------------------------------------

    def test_get_invalid_token(self, test_client: TestClient):
        resp = test_client.get("/api/auth/unsubscribe?token=invalid-token-value")
        assert resp.status_code == 400
        assert "invalid" in resp.json()["detail"].lower() or "malformed" in resp.json()["detail"].lower()

    def test_get_missing_token(self, test_client: TestClient):
        resp = test_client.get("/api/auth/unsubscribe")
        assert resp.status_code in (400, 422)

    def test_confirm_invalid_token(self, test_client: TestClient, db: Session):
        from app.models import EmailPreference

        resp = test_client.post("/api/auth/unsubscribe/confirm?token=invalid-token-value")
        assert resp.status_code == 400
        assert db.query(EmailPreference).count() == 0

    def test_confirm_missing_token(self, test_client: TestClient):
        resp = test_client.post("/api/auth/unsubscribe/confirm")
        assert resp.status_code in (400, 422)

    def test_expired_token_rejected(self, test_client: TestClient):
        """Expired tokens are rejected with a distinct message on both steps."""
        token = self._make_token("old@example.com", exp_delta=timedelta(hours=-1))

        resp = test_client.get(f"/api/auth/unsubscribe?token={token}")
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()

        resp = test_client.post(f"/api/auth/unsubscribe/confirm?token={token}")
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()

    def test_token_without_type_rejected(self, test_client: TestClient):
        """A valid session-style token (sub claim, no type) is not an unsubscribe token."""
        token = jwt.encode({"sub": "123", "role": "donor"}, SECRET_KEY, algorithm=ALGORITHM)
        assert test_client.get(f"/api/auth/unsubscribe?token={token}").status_code == 400
        assert test_client.post(f"/api/auth/unsubscribe/confirm?token={token}").status_code == 400

    def test_token_without_email_rejected(self, test_client: TestClient):
        """A valid unsubscribe-typed JWT but without the email claim should be rejected."""
        token = jwt.encode({"type": "unsubscribe", "exp": datetime.now(timezone.utc) + timedelta(days=1)}, SECRET_KEY, algorithm=ALGORITHM)
        assert test_client.get(f"/api/auth/unsubscribe?token={token}").status_code == 400
        assert test_client.post(f"/api/auth/unsubscribe/confirm?token={token}").status_code == 400

    @pytest.mark.filterwarnings("ignore:The HMAC key is \\d+ bytes long")
    def test_tampered_token_rejected(self, test_client: TestClient):
        """A token signed with a different key should be rejected."""
        bad_token = jwt.encode({"email": "hacker@example.com", "type": "unsubscribe"}, "wrong-secret", algorithm=ALGORITHM)
        assert test_client.get(f"/api/auth/unsubscribe?token={bad_token}").status_code == 400
        assert test_client.post(f"/api/auth/unsubscribe/confirm?token={bad_token}").status_code == 400


class TestSendEmailLogging:
    """send_email records one SentEmail row per attempt."""

    def _make_actor(self, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="actor@example.com",
            hashed_password=get_password_hash("ActorPass123!"),
            role=UserRole.referrer,
            display_name="Actor",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    async def test_records_sent_row(self, db: Session):
        from app.mail import send_email
        from app.models import EmailKind, EmailStatus, SentEmail

        actor = self._make_actor(db)

        async def _no_op(*args, **kwargs):
            return None

        with patch("app.mail.mail_manager.send_message", MagicMock(side_effect=_no_op)):
            result = await send_email(
                "Log@Example.com",
                "Subject",
                "<p>Body</p>",
                db,
                kind=EmailKind.family_invite,
                user_id=actor.id,
            )
        assert result == {"sent": True, "reason": None}

        rows = db.query(SentEmail).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.recipient_email == "log@example.com"  # lowercased
        assert row.kind == EmailKind.family_invite
        assert row.status == EmailStatus.sent
        assert row.user_id == actor.id
        assert row.failure_reason is None
        assert row.sent_at is not None

    async def test_records_failed_row_on_unsubscribe(self, db: Session):
        from app.mail import send_email
        from app.models import EmailKind, EmailPreference, EmailStatus, SentEmail

        db.add(EmailPreference(email="nope@example.com", unsubscribed_at=datetime.now(timezone.utc)))
        db.commit()

        result = await send_email(
            "nope@example.com",
            "Subject",
            "<p>Body</p>",
            db,
            kind=EmailKind.claim_confirmation,
        )
        assert result == {"sent": False, "reason": "unsubscribed"}

        rows = db.query(SentEmail).all()
        assert len(rows) == 1
        assert rows[0].kind == EmailKind.claim_confirmation
        assert rows[0].status == EmailStatus.failed
        assert rows[0].failure_reason == "unsubscribed"
        assert rows[0].user_id is None  # not provided

    async def test_records_failed_row_on_smtp_error(self, db: Session):
        from app.mail import send_email
        from app.models import EmailKind, EmailStatus, SentEmail

        actor = self._make_actor(db)

        async def _raise(*args, **kwargs):
            raise Exception("Connection refused")

        with patch("app.mail.mail_manager.send_message", side_effect=_raise):
            result = await send_email(
                "broken@example.com",
                "Subject",
                "<p>Body</p>",
                db,
                kind=EmailKind.admin_failure_notice,
                user_id=actor.id,
            )
        assert result == {"sent": False, "reason": "smtp_error"}

        rows = db.query(SentEmail).all()
        assert len(rows) == 1
        assert rows[0].kind == EmailKind.admin_failure_notice
        assert rows[0].status == EmailStatus.failed
        assert rows[0].failure_reason == "smtp_error"
        assert rows[0].user_id == actor.id

    async def test_one_row_per_attempt(self, db: Session):
        """Two consecutive attempts produce two rows."""
        from app.mail import send_email
        from app.models import EmailKind, EmailStatus, SentEmail

        async def _no_op(*args, **kwargs):
            return None

        with patch("app.mail.mail_manager.send_message", MagicMock(side_effect=_no_op)):
            await send_email("twice@example.com", "S", "<p>B</p>", db, kind=EmailKind.password_reset)
            await send_email("twice@example.com", "S", "<p>B</p>", db, kind=EmailKind.password_reset)

        rows = db.query(SentEmail).order_by(SentEmail.id).all()
        assert len(rows) == 2
        assert all(r.status == EmailStatus.sent for r in rows)
