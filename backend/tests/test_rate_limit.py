"""Tests for the rate-limit key function (app.rate_limit._rate_limit_key).

The limiter keys on the client IP. Behind Traefik the TCP peer is the proxy,
so the key must come from the LAST entry of X-Forwarded-For: the edge proxy
appends the real client, and clients can only prepend, never append — only
Traefik can reach the backend.
"""

import pytest
from starlette.requests import Request

from app.rate_limit import _rate_limit_key


def _make_request(headers: dict[str, str] | None = None, client: str = "10.0.0.5") -> Request:
    scope = {
        "type": "http",
        "client": (client, 54321),
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    return Request(scope)


class TestRateLimitKey:
    def test_falls_back_to_tcp_peer_without_xff(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DEBUG", "false")
        assert _rate_limit_key(_make_request()) == "10.0.0.5"

    def test_uses_last_xff_entry(self, monkeypatch: pytest.MonkeyPatch):
        # Client-spoofed entries come first; Traefik appends the real client.
        monkeypatch.setenv("DEBUG", "false")
        headers = {"X-Forwarded-For": "1.1.1.1, 2.2.2.2, 3.3.3.3"}
        assert _rate_limit_key(_make_request(headers)) == "3.3.3.3"

    def test_single_xff_entry_is_stripped(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DEBUG", "false")
        assert _rate_limit_key(_make_request({"X-Forwarded-For": " 4.4.4.4 "})) == "4.4.4.4"

    def test_empty_xff_falls_back_to_tcp_peer(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DEBUG", "false")
        assert _rate_limit_key(_make_request({"X-Forwarded-For": ""})) == "10.0.0.5"

    def test_distinct_clients_get_distinct_keys(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DEBUG", "false")
        a = _rate_limit_key(_make_request({"X-Forwarded-For": "6.6.6.6"}))
        b = _rate_limit_key(_make_request({"X-Forwarded-For": "7.7.7.7"}))
        assert a == "6.6.6.6"
        assert b == "7.7.7.7"

    def test_skipped_for_testclient(self):
        assert _rate_limit_key(_make_request(client="testclient")) is None

    def test_skipped_when_debug_is_true(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("DEBUG", "true")
        assert _rate_limit_key(_make_request({"X-Forwarded-For": "5.5.5.5"})) is None
