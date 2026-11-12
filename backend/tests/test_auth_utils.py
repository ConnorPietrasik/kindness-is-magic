"""Tests for auth utility functions (hashing, JWT, cookies)."""

from datetime import timedelta

import jwt
import pytest

from app.auth import (
    _DEFAULT_REFRESH_SECRET_KEY,
    _DEFAULT_SECRET_KEY,
    ALGORITHM,
    REFRESH_SECRET_KEY,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    get_password_hash,
    set_auth_cookies,
    verify_password,
)

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    def test_hash_and_verify(self):
        password = "MySecret1234!"
        hashed = get_password_hash(password)
        assert verify_password(password, hashed) is True

    def test_wrong_password_fails(self):
        hashed = get_password_hash("Correct1234!")
        assert verify_password("Wrong12345!", hashed) is False

    def test_hash_is_different_each_time(self):
        """bcrypt includes a random salt, so two hashes of the same
        password should differ."""
        h1 = get_password_hash("SamePass12!")
        h2 = get_password_hash("SamePass12!")
        assert h1 != h2

    def test_both_verify(self):
        h1 = get_password_hash("SamePass12!")
        h2 = get_password_hash("SamePass12!")
        assert verify_password("SamePass12!", h1)
        assert verify_password("SamePass12!", h2)

    def test_unicode_password(self):
        password = "Pässwörd123!🔐"
        hashed = get_password_hash(password)
        assert verify_password(password, hashed) is True

    def test_72_byte_boundary(self):
        """72 bytes hashes fine; 73 bytes raises (bcrypt limit)."""
        assert verify_password("a" * 72, get_password_hash("a" * 72)) is True
        with pytest.raises(ValueError, match="72 characters"):
            get_password_hash("a" * 73)

    def test_multibyte_over_limit_rejected(self):
        """24 CJK chars = 72 bytes (ok); 25 = 75 bytes (rejected)."""
        assert verify_password("中" * 24, get_password_hash("中" * 24)) is True
        with pytest.raises(ValueError, match="72 characters"):
            get_password_hash("中" * 25)

    def test_verify_over_long_candidate_returns_false(self):
        """A >72-byte candidate must return False, not raise bcrypt's ValueError.

        No stored password can exceed 72 bytes, so over-long input can only
        be a wrong password — login and change-password rely on this.
        """
        hashed = get_password_hash("a" * 72)
        assert verify_password("a" * 73, hashed) is False
        assert verify_password("中" * 25, hashed) is False


# ---------------------------------------------------------------------------
# Access token
# ---------------------------------------------------------------------------


class TestAccessToken:
    def test_create_and_decode(self):
        data = {"sub": "42", "role": "admin"}
        token = create_access_token(data)
        payload = decode_access_token(token)
        assert payload["sub"] == "42"
        assert payload["role"] == "admin"
        assert "exp" in payload

    def test_expired_token_raises_401(self):
        token = create_access_token(
            {"sub": "1"},
            expires_delta=timedelta(seconds=-1),  # already expired
        )
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(token)
        assert exc_info.value.status_code == 401

    def test_tampered_token_raises_401(self):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            decode_access_token("eyJhbGciOiJIUzI1NiJ9.tampered.bad")
        assert exc_info.value.status_code == 401

    @pytest.mark.filterwarnings("ignore:The HMAC key is \\d+ bytes long")
    def test_token_signed_with_wrong_key_raises(self):
        from fastapi import HTTPException

        # Sign with a different key
        bad_token = jwt.encode({"sub": "1"}, "wrong-key", algorithm=ALGORITHM)
        with pytest.raises(HTTPException):
            decode_access_token(bad_token)


# ---------------------------------------------------------------------------
# Refresh token
# ---------------------------------------------------------------------------


class TestRefreshToken:
    def test_create_and_decode(self):
        data = {"sub": "99"}
        token = create_refresh_token(data)
        payload = decode_refresh_token(token)
        assert payload["sub"] == "99"
        assert payload["type"] == "refresh"
        assert "exp" in payload

    def test_access_token_rejected_as_refresh(self):
        from fastapi import HTTPException

        access = create_access_token({"sub": "1"})
        with pytest.raises(HTTPException) as exc_info:
            decode_refresh_token(access)
        assert exc_info.value.status_code == 401
        assert "session" in exc_info.value.detail.lower()

    def test_expired_refresh_token_raises_401(self):
        from fastapi import HTTPException
        import jwt

        # Build a refresh token with past expiry
        payload = jwt.encode(
            {"sub": "1", "type": "refresh", "exp": 0},
            REFRESH_SECRET_KEY,
            algorithm=ALGORITHM,
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_refresh_token(payload)
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------


class TestCookieHelpers:
    def test_set_auth_cookies(self):
        from fastapi.responses import Response

        response = Response()
        set_auth_cookies(response, "access-123", "refresh-456")
        headers = response.headers
        assert "set-cookie" in headers

    def test_clear_auth_cookies(self):
        from fastapi.responses import Response

        response = Response()
        clear_auth_cookies(response)
        headers = response.headers
        assert "set-cookie" in headers


# ---------------------------------------------------------------------------
# Production secret validation (startup fail-closed guard)
# ---------------------------------------------------------------------------


class TestValidateProductionSecrets:
    """A non-DEBUG process must not sign with the repo-published dev keys or empty ones."""

    def test_raises_when_debug_false_and_default_secret_key(self, monkeypatch):
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setattr(auth, "SECRET_KEY", _DEFAULT_SECRET_KEY)
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", "real-refresh-key-0123456789abcdef")
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            auth.validate_production_secrets()

    def test_raises_when_debug_false_and_default_refresh_key(self, monkeypatch):
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setattr(auth, "SECRET_KEY", "real-access-key-0123456789abcdef")
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", _DEFAULT_REFRESH_SECRET_KEY)
        with pytest.raises(RuntimeError, match="REFRESH_SECRET_KEY"):
            auth.validate_production_secrets()

    def test_raises_when_debug_false_and_empty_secret_key(self, monkeypatch):
        """An explicitly empty SECRET_KEY (e.g. `SECRET_KEY=` in .env) is as forgeable as the default."""
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setattr(auth, "SECRET_KEY", "")
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", "real-refresh-key-0123456789abcdef")
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            auth.validate_production_secrets()

    def test_raises_when_debug_false_and_empty_refresh_key(self, monkeypatch):
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setattr(auth, "SECRET_KEY", "real-access-key-0123456789abcdef")
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", "")
        with pytest.raises(RuntimeError, match="REFRESH_SECRET_KEY"):
            auth.validate_production_secrets()

    def test_raises_when_debug_unset_and_default_keys(self, monkeypatch):
        """Unset DEBUG is treated as production (same convention as the Secure cookie flag)."""
        import app.auth as auth

        monkeypatch.delenv("DEBUG", raising=False)
        monkeypatch.setattr(auth, "SECRET_KEY", _DEFAULT_SECRET_KEY)
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", _DEFAULT_REFRESH_SECRET_KEY)
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            auth.validate_production_secrets()

    def test_passes_when_debug_true(self, monkeypatch):
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "true")
        monkeypatch.setattr(auth, "SECRET_KEY", _DEFAULT_SECRET_KEY)
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", _DEFAULT_REFRESH_SECRET_KEY)
        auth.validate_production_secrets()  # must not raise

    def test_passes_when_debug_false_and_real_keys(self, monkeypatch):
        import app.auth as auth

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setattr(auth, "SECRET_KEY", "real-access-key-0123456789abcdef")
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", "real-refresh-key-0123456789abcdef")
        auth.validate_production_secrets()  # must not raise

    def test_lifespan_refuses_production_defaults(self, monkeypatch, tmp_path):
        """Wiring check: the app lifespan actually calls the guard and fails to start."""
        import app.auth as auth
        from fastapi.testclient import TestClient

        from app.main import app

        monkeypatch.setenv("DEBUG", "false")
        monkeypatch.setenv("LIFESPAN_LOCK_PATH", str(tmp_path / "leader.lock"))
        monkeypatch.setenv("DISABLE_BACKGROUND_TASKS", "1")
        monkeypatch.setattr(auth, "SECRET_KEY", _DEFAULT_SECRET_KEY)
        monkeypatch.setattr(auth, "REFRESH_SECRET_KEY", _DEFAULT_REFRESH_SECRET_KEY)
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            with TestClient(app):
                pass
