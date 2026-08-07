"""Tests for global exception handlers in main.py.

Covers:
- RateLimitExceeded handler (429)
- SQLAlchemyError handler (500)
- RequestValidationError handler (422)
- Generic Exception handler (500)
"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


@pytest.fixture()
def test_client_no_raise(db):
    """TestClient with raise_server_exceptions=False so server errors
    return HTTP responses instead of raising in the test process."""
    from app.main import app
    from app import database

    def _override_get_db():
        yield db

    app.dependency_overrides[database.get_db] = _override_get_db
    _original_session_local = database.SessionLocal
    database.SessionLocal = lambda **kw: db  # type: ignore[assignment]

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client

    app.dependency_overrides.clear()
    database.SessionLocal = _original_session_local  # type: ignore[assignment]


# =========================================================================
# RequestValidationError handler — 422
# =========================================================================


class TestValidationExceptionHandler:
    def test_422_structured_errors_on_invalid_body(self, test_client: TestClient, admin_user):
        """Validation errors return structured detail with error list."""
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={"family_name": "Test"},  # missing required fields
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body
        assert isinstance(body["detail"], list)

    def test_422_structured_errors_on_type_mismatch(self, test_client: TestClient, admin_user):
        """Type mismatches in request body produce structured 422."""
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "family_name": "Test",
                "family_wish": "Wish",
                "contact_name": "Contact",
                "phone_number": "555-000-0000",
                "referrer_id": "not-an-int",
            },
        )
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body

    def test_422_on_invalid_json(self, test_client: TestClient):
        """Malformed JSON body returns 422."""
        resp = test_client.post(
            "/api/auth/login",
            content=b"not json at all {{{",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 422


# =========================================================================
# SQLAlchemyError handler — 500
# =========================================================================


class TestSQLAlchemyExceptionHandler:
    def test_500_on_database_error(self, test_client: TestClient):
        """Database errors return generic 500 without leaking internals."""
        from app.main import sqlalchemy_exception_handler
        from sqlalchemy import exc as sa_exc
        from starlette.requests import Request

        async def _call_handler():
            fake_request = Request({"method": "GET", "type": "http", "path": "/test"})
            fake_exc = sa_exc.IntegrityError(
                statement="INSERT INTO test",
                params=None,
                orig=Exception("unique constraint violation"),
            )
            return await sqlalchemy_exception_handler(fake_request, fake_exc)

        response = _run_async(_call_handler())
        assert response.status_code == 500
        body = response.body.decode()
        assert "internal database error" in body.lower()
        assert "unique constraint" not in body.lower()
        assert "IntegrityError" not in body

    def test_500_operational_error_shape(self, test_client: TestClient):
        """OperationalError also produces the correct generic response."""
        from app.main import sqlalchemy_exception_handler
        from sqlalchemy import exc as sa_exc
        from starlette.requests import Request

        async def _call_handler():
            fake_request = Request({"method": "POST", "type": "http", "path": "/test"})
            fake_exc = sa_exc.OperationalError(
                statement="SELECT * FROM nonexistent",
                params=None,
                orig=Exception("relation does not exist"),
            )
            return await sqlalchemy_exception_handler(fake_request, fake_exc)

        response = _run_async(_call_handler())
        assert response.status_code == 500
        body = response.body.decode()
        assert "internal database error" in body.lower()
        assert "relation does not exist" not in body


# =========================================================================
# Generic Exception handler — 500
# =========================================================================


class TestGenericExceptionHandler:
    def test_500_generic_error_shape(self, test_client: TestClient):
        """Unhandled exceptions return generic 500 without stack traces."""
        from app.main import generic_exception_handler
        from starlette.requests import Request

        async def _call_handler():
            fake_request = Request({"method": "GET", "type": "http", "path": "/test"})
            fake_exc = RuntimeError("Something unexpected happened")
            return await generic_exception_handler(fake_request, fake_exc)

        response = _run_async(_call_handler())
        assert response.status_code == 500
        body = response.body.decode()
        assert "unexpected error" in body.lower()
        assert "RuntimeError" not in body
        assert "Something unexpected" not in body

    def test_500_via_dependency_mock(self, test_client_no_raise, admin_user):
        """Trigger the generic handler by mocking a dependency to raise."""
        from app.permissions import require_admin

        _admin_login(test_client_no_raise)

        def _faulty_require_admin():
            raise ValueError("Injected test error")

        test_client_no_raise.app.dependency_overrides[require_admin] = _faulty_require_admin

        try:
            resp = test_client_no_raise.get("/api/admin/families")
            assert resp.status_code == 500
            body = resp.json()
            assert "detail" in body
            assert "unexpected error" in body["detail"].lower()
            assert "Injected test error" not in body["detail"]
        finally:
            test_client_no_raise.app.dependency_overrides.clear()


# =========================================================================
# RateLimitExceeded handler — 429
# =========================================================================


class TestRateLimitExceptionHandler:
    def test_429_rate_limit_response_shape(self, test_client: TestClient):
        """RateLimitExceeded returns structured 429 with detail."""
        from limits import parse as parse_rate_limit
        from slowapi.errors import RateLimitExceeded
        from slowapi.wrappers import Limit
        from app.main import rate_limit_handler
        from starlette.requests import Request

        async def _call_handler():
            fake_request = Request({"method": "POST", "type": "http", "path": "/api/auth/login"})
            fake_request.state.view_rate_limit = {"limit": "5", "remaining": "0", "reset": "60"}
            _limit = Limit(
                parse_rate_limit("5 per minute"),
                lambda: "test",
                "test",
                True,
                None,
                None,
                None,
                1,
                False,
            )
            fake_exc = RateLimitExceeded(_limit)
            return await rate_limit_handler(fake_request, fake_exc)

        response = _run_async(_call_handler())
        assert response.status_code == 429
        body = response.body.decode()
        assert "rate limit exceeded" in body.lower()

    def test_429_rate_limit_injected_via_dependency(self, test_client_no_raise):
        """Trigger the rate limit handler by injecting a RateLimitExceeded."""
        from limits import parse as parse_rate_limit
        from slowapi.errors import RateLimitExceeded
        from slowapi.wrappers import Limit
        from app.permissions import require_admin

        _limit = Limit(
            parse_rate_limit("5 per minute"),
            lambda: "test",
            "test",
            True,
            None,
            None,
            None,
            1,
            False,
        )

        def _rate_limited_require_admin():
            raise RateLimitExceeded(_limit)

        test_client_no_raise.app.dependency_overrides[require_admin] = _rate_limited_require_admin

        try:
            resp = test_client_no_raise.get("/api/admin/families")
            assert resp.status_code == 429
            body = resp.json()
            assert "detail" in body
            assert "rate limit exceeded" in body["detail"].lower()
        finally:
            test_client_no_raise.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers for running async handlers in sync tests
# ---------------------------------------------------------------------------


def _run_async(coro):
    """Run an async coroutine in a synchronous context."""
    import asyncio

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
