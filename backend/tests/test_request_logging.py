"""Tests for the request logging middleware in main.py.

Covers:
- X-Request-ID response header (16 hex chars, unique per request, present on
  error responses too)
- the structured JSON access log line (request_id, user_id, user_email,
  user_role, method, path, status_code, duration_ms)
- JWT-derived user fields in the access log for authenticated requests
- log level by status class (INFO / WARNING / ERROR)
- _RequestContextFilter auto-injection of request_id/user_id into business
  log records made during request handling
"""

import json
import logging
import re

import pytest
import sqlalchemy.exc
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import database
from app.main import JsonFormatter, app
from tests.conftest import login_as

# A logger that emits "business" log lines (no explicit request context) —
# what route handlers and other modules do when they call logger.info(...).
biz_logger = logging.getLogger("test.request_context")


@pytest.fixture(autouse=True)
def _capture_info(caplog: pytest.LogCaptureFixture):
    """Lower the root logger to INFO for these tests.

    Under pytest the root logger is already configured (pytest attaches its
    own handlers before app.main imports), so main.py's basicConfig call is a
    no-op and the root stays at WARNING — INFO-level access log lines and
    business logs would be dropped before reaching caplog.
    """
    caplog.set_level(logging.INFO)


def _access_log_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Middleware access-log records (msg == "Request" on the app.main logger)."""
    return [r for r in caplog.records if r.name == "app.main" and r.msg == "Request"]


@pytest.fixture()
def client_with_logging_override(db: Session, test_client: TestClient):
    """Replace the get_db override with one that emits business log lines.

    The dependency runs inside the request, so any context injected by the
    middleware (request_id / user_id) must be visible to these records.
    """
    emit: list[tuple[str, dict]] = [
        ("business event", {}),
        ("business event with explicit id", {"request_id": "explicit-12345"}),
    ]

    def _override():
        for msg, extra in emit:
            biz_logger.info(msg, extra=extra)
        yield db

    app.dependency_overrides[database.get_db] = _override
    yield test_client


def _assert_json_line(record: logging.LogRecord) -> dict:
    """The formatted stdout line must be a single JSON object with the
    documented fields (Docker's logging driver consumes these lines)."""
    payload = json.loads(JsonFormatter().format(record))
    for key in (
        "ts",
        "level",
        "logger",
        "msg",
        "request_id",
        "user_id",
        "user_email",
        "user_role",
        "method",
        "path",
        "status_code",
        "duration_ms",
    ):
        assert key in payload, f"missing {key} in {payload}"
    return payload


class TestRequestIdHeader:
    def test_header_present_and_16_hex_chars(self, test_client: TestClient):
        resp = test_client.get("/api/health")
        assert resp.status_code == 200
        assert re.fullmatch(r"[0-9a-f]{16}", resp.headers["X-Request-ID"])

    def test_header_unique_per_request(self, test_client: TestClient):
        ids = {test_client.get("/api/health").headers["X-Request-ID"] for _ in range(2)}
        assert len(ids) == 2

    def test_header_matches_access_log_request_id(self, test_client: TestClient, caplog: pytest.LogCaptureFixture):
        resp = test_client.get("/api/health")
        records = _access_log_records(caplog)
        assert len(records) == 1
        assert records[0].request_id == resp.headers["X-Request-ID"]


class TestAccessLogLine:
    def test_unauthenticated_request_fields(self, test_client: TestClient, caplog: pytest.LogCaptureFixture):
        resp = test_client.get("/api/health")
        record = _access_log_records(caplog)[0]

        assert resp.status_code == 200
        assert record.levelno == logging.INFO
        assert record.getMessage() == "Request"
        assert record.user_id == "-"
        assert record.user_email == "-"
        assert record.user_role == "-"
        assert record.method == "GET"
        assert record.path == "/api/health"
        assert record.status_code == 200
        assert isinstance(record.duration_ms, float)
        assert record.duration_ms >= 0
        assert _assert_json_line(record)["request_id"] == resp.headers["X-Request-ID"]

    def test_authenticated_request_includes_user_from_jwt(self, test_client: TestClient, admin_user, caplog: pytest.LogCaptureFixture):
        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 200

        # The login request itself was anonymous; the /me request is authenticated.
        record = next(r for r in _access_log_records(caplog) if r.path == "/api/auth/me")
        assert record.levelno == logging.INFO
        assert record.user_id == str(admin_user.id)
        assert record.user_email == "admin@test.com"
        assert record.user_role == "admin"
        assert _assert_json_line(record)["user_email"] == "admin@test.com"

    def test_invalid_token_logged_as_anonymous(self, test_client: TestClient, caplog: pytest.LogCaptureFixture):
        test_client.cookies.set("access_token", "not-a-valid-jwt")
        resp = test_client.get("/api/health")
        assert resp.status_code == 200

        record = _access_log_records(caplog)[0]
        assert record.user_id == "-"
        assert record.user_email == "-"
        assert record.user_role == "-"

    def test_level_warning_on_404(self, test_client: TestClient, caplog: pytest.LogCaptureFixture):
        resp = test_client.get("/api/no-such-route")
        assert resp.status_code == 404

        record = _access_log_records(caplog)[0]
        assert record.levelno == logging.WARNING
        assert record.status_code == 404
        assert record.path == "/api/no-such-route"

    def test_level_error_on_500(self, test_client: TestClient, db: Session, caplog: pytest.LogCaptureFixture):
        def _boom():
            raise sqlalchemy.exc.OperationalError("SELECT 1", {}, Exception("db down"))
            yield  # pragma: no cover

        saved = app.dependency_overrides[database.get_db]
        app.dependency_overrides[database.get_db] = _boom
        try:
            resp = test_client.get("/api/families")
        finally:
            app.dependency_overrides[database.get_db] = saved

        # The global SQLAlchemy handler converts the error to a 500 response.
        assert resp.status_code == 500
        assert resp.headers["X-Request-ID"]

        record = _access_log_records(caplog)[0]
        assert record.levelno == logging.ERROR
        assert record.status_code == 500


@pytest.fixture()
def context_capture():
    """Capture handler mirroring main.py's stdout wiring.

    The _RequestContextFilter lives on the stdout handler (not on loggers),
    so reproducing that wiring is what exercises the production behaviour:
    filter enriches the record at emit time, JsonFormatter serializes it.
    """
    from app.main import JsonFormatter, _RequestContextFilter

    class _CaptureHandler(logging.Handler):
        def __init__(self):
            super().__init__(level=logging.INFO)
            self.records: list[logging.LogRecord] = []
            self.lines: list[str] = []

        def emit(self, record: logging.LogRecord) -> None:
            self.records.append(record)
            self.lines.append(self.format(record))

    handler = _CaptureHandler()
    handler.addFilter(_RequestContextFilter())
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        yield handler
    finally:
        root.removeHandler(handler)


class TestRequestContextFilter:
    def test_business_log_gets_request_context_injected(
        self, client_with_logging_override: TestClient, admin_user, context_capture: logging.Handler
    ):
        login_as(client_with_logging_override, "admin@test.com", "AdminPass123!")
        resp = client_with_logging_override.get("/api/families")
        assert resp.status_code == 200

        # The login request logged too; keep the records of the /families request.
        by_msg = {r.getMessage(): r for r in context_capture.records if r.name == "test.request_context"}
        bare = by_msg["business event"]
        explicit = by_msg["business event with explicit id"]

        # Auto-injected from the middleware's context vars.
        assert bare.request_id == resp.headers["X-Request-ID"]
        assert bare.user_id == str(admin_user.id)

        # An explicitly-set request_id is preserved, not overwritten.
        assert explicit.request_id == "explicit-12345"
        assert explicit.user_id == str(admin_user.id)

        # The enriched values end up in the JSON line on "stdout" (last match
        # = the /families request, not the earlier login request).
        matching = [line for line in context_capture.lines if json.loads(line)["msg"] == "business event"]
        payload = json.loads(matching[-1])
        assert payload["request_id"] == resp.headers["X-Request-ID"]
        assert payload["user_id"] == str(admin_user.id)

    def test_business_log_anonymous_defaults(self, client_with_logging_override: TestClient, context_capture: logging.Handler):
        resp = client_with_logging_override.get("/api/families")
        assert resp.status_code == 200

        bare = next(r for r in context_capture.records if r.name == "test.request_context" and r.getMessage() == "business event")
        assert bare.request_id == resp.headers["X-Request-ID"]
        assert bare.user_id == "-"
