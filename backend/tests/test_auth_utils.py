"""Tests for auth utility functions (hashing, JWT, cookies)."""

from datetime import timedelta

import jwt
import pytest

from app.auth import (
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
        assert "refresh" in exc_info.value.detail.lower()

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
