"""Unit tests for the Zeffy read-only client and cart reconciliation.

All HTTP is mocked via ``httpx.MockTransport`` (injected through
``zeffy._transport_override``) — no network, no DB.
"""

from datetime import datetime, timezone
from typing import Any, Callable

import httpx
import pytest

import app.zeffy as zeffy

NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _zeffy_env(monkeypatch: pytest.MonkeyPatch):
    """No throttle, empty config, fresh campaign cache around each test."""
    monkeypatch.setenv("ZEFFY_MIN_INTERVAL_SECONDS", "0")
    monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "")
    monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "")
    monkeypatch.setattr(zeffy, "_transport_override", None)
    zeffy.clear_campaign_cache()
    yield
    zeffy.clear_campaign_cache()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _payment_raw(
    id: str = "p-1",
    created: int = 1_768_521_600,
    amount: int = 600_000,
    currency: str = "usd",
    status: str = "succeeded",
    email: str | None = "donor@test.com",
    **overrides: Any,
) -> dict:
    """A raw Zeffy Payment JSON object (only the fields the client reads, plus the spec-required keys)."""
    raw: dict = {
        "id": id,
        "object": "payment",
        "created": created,
        "amount": amount,
        "eligible_amount": amount,
        "currency": currency,
        "status": status,
        "type": "online",
        "refund_status": "none",
        "refunds": [],
        "dispute": None,
        "description": "Sponsorship",
        "contact": None,
        "payment_method": {},
        "buyer": {
            "email": email,
            "first_name": "Don",
            "last_name": "Or",
            "is_corporate": False,
            "company_name": None,
            "address": None,
        },
        "discount": None,
        "campaign_type": "donation_form",
        "campaign_id": "c-dedicated",
        "campaign_category": "donation",
        "buyer_questions": [],
        "items": [],
        "occurrence_id": None,
        "receipt_url": "https://zeffy.com/receipts/abc",
        "recurring": None,
        "fund": None,
        "metadata": {},
    }
    raw.update(overrides)
    return raw


def _envelope(payments: list[dict], has_more: bool = False, next_cursor: str | None = None) -> dict:
    return {"object": "list", "data": payments, "has_more": has_more, "next_cursor": next_cursor}


def _install_transport(monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
    """Install a MockTransport and return the requests it receives."""
    requests: list[httpx.Request] = []

    def _wrapped(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(_wrapped))
    return requests


# ---------------------------------------------------------------------------
# list_payments — request shape + envelope parsing
# ---------------------------------------------------------------------------


class TestListPayments:
    def test_auth_header_user_agent_and_params(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        requests = _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_envelope([])))

        page = zeffy.list_payments(campaign_id="c-1", status="succeeded", created_gte=NOW, starting_after="p-0", limit=50)

        assert page.data == []
        assert page.has_more is False
        assert page.next_cursor is None
        assert len(requests) == 1
        req = requests[0]
        assert req.url.path == "/api/v1/payments"
        assert req.headers["authorization"] == "Bearer test-key"
        assert req.headers["user-agent"] == "kindness-is-magic/1.0"
        assert req.url.params["campaign"] == "c-1"
        assert req.url.params["status"] == "succeeded"
        assert int(req.url.params["created[gte]"]) == int(NOW.timestamp())
        assert req.url.params["starting_after"] == "p-0"
        assert req.url.params["limit"] == "50"

    def test_parses_payment_fields(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_envelope([_payment_raw()], has_more=True, next_cursor="p-1")))

        page = zeffy.list_payments()

        assert len(page.data) == 1
        p = page.data[0]
        assert p.id == "p-1"
        assert p.created == 1_768_521_600
        assert p.amount == 600_000
        assert p.currency == "usd"
        assert p.status == "succeeded"
        assert p.type == "online"
        assert p.campaign_id == "c-dedicated"
        assert p.buyer is not None and p.buyer.email == "donor@test.com"
        assert p.receipt_url == "https://zeffy.com/receipts/abc"
        assert page.has_more is True
        assert page.next_cursor == "p-1"


# ---------------------------------------------------------------------------
# Error handling: 429 retry, 401, 404, unconfigured
# ---------------------------------------------------------------------------


class TestErrors:
    def test_no_key_raises_without_http(self, monkeypatch: pytest.MonkeyPatch):
        requests = _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_envelope([])))
        with pytest.raises(zeffy.ZeffyNotConfiguredError):
            zeffy.list_payments()
        assert requests == []

    def test_429_retried_once_using_retry_after(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        calls = {"n": 0}
        sleeps: list[float] = []

        def handler(req: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(
                    429,
                    json={"error": {"type": "rate_limit_error", "code": "rate_limit_exceeded", "message": "slow down"}},
                    headers={"Retry-After": "1"},
                )
            return httpx.Response(200, json=_envelope([_payment_raw()]))

        monkeypatch.setattr(zeffy.time, "sleep", lambda s: sleeps.append(s))
        _install_transport(monkeypatch, handler)

        page = zeffy.list_payments()

        assert calls["n"] == 2
        assert len(page.data) == 1
        assert sleeps == [1.0]

    def test_second_429_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        calls = {"n": 0}

        def handler(req: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(
                429,
                json={"error": {"type": "rate_limit_error", "code": "rate_limit_exceeded", "message": "slow down"}},
                headers={"Retry-After": "0"},
            )

        _install_transport(monkeypatch, handler)

        with pytest.raises(zeffy.ZeffyAPIError) as exc:
            zeffy.list_payments()
        assert calls["n"] == 2
        assert exc.value.status_code == 429

    def test_401_raises_auth_error(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "bad-key")
        _install_transport(
            monkeypatch,
            lambda req: httpx.Response(
                401, json={"error": {"type": "authentication_error", "code": "invalid_api_key", "message": "The API key is invalid"}}
            ),
        )
        with pytest.raises(zeffy.ZeffyAuthError):
            zeffy.list_payments()

    def test_404_get_payment_returns_none(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        requests = _install_transport(
            monkeypatch,
            lambda req: httpx.Response(
                404, json={"error": {"type": "invalid_request_error", "code": "resource_not_found", "message": "nope"}}
            ),
        )
        assert zeffy.get_payment("p-missing") is None
        assert requests[0].url.path == "/api/v1/payments/p-missing"

    def test_get_payment_found(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_payment_raw()))
        payment = zeffy.get_payment("p-1")
        assert payment is not None and payment.id == "p-1"

    def test_get_campaign_404_returns_none(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        requests = _install_transport(
            monkeypatch, lambda req: httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})
        )
        assert zeffy.get_campaign("c-missing") is None
        assert requests[0].url.path == "/api/v1/campaigns/c-missing"


# ---------------------------------------------------------------------------
# One-time campaign validation
# ---------------------------------------------------------------------------


class TestValidateConfiguredCampaign:
    def test_no_key_raises(self, monkeypatch: pytest.MonkeyPatch):
        requests = _install_transport(monkeypatch, lambda req: httpx.Response(200, json={}))
        with pytest.raises(zeffy.ZeffyNotConfiguredError):
            zeffy.validate_configured_campaign()
        assert requests == []

    def test_no_campaign_id_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        requests = _install_transport(monkeypatch, lambda req: httpx.Response(200, json={}))
        with pytest.raises(zeffy.ZeffyNotConfiguredError):
            zeffy.validate_configured_campaign()
        assert requests == []

    def test_success_is_cached_per_process(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "c-dedicated")
        requests = _install_transport(
            monkeypatch,
            lambda req: httpx.Response(
                200,
                json={
                    "id": "c-dedicated",
                    "title": "Sponsor a family",
                    "url": "https://zeffy.com/f",
                    "status": "active",
                    "type": "donation_form",
                    "currency": "usd",
                },
            ),
        )

        first = zeffy.validate_configured_campaign()
        second = zeffy.validate_configured_campaign()

        assert first.id == "c-dedicated" and first.title == "Sponsor a family"
        assert second is first
        assert len(requests) == 1  # second call served from the cache
        assert requests[0].url.path == "/api/v1/campaigns/c-dedicated"

    def test_failure_is_never_cached(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "c-typo")
        requests = _install_transport(
            monkeypatch, lambda req: httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})
        )

        with pytest.raises(zeffy.ZeffyCampaignNotFoundError):
            zeffy.validate_configured_campaign()
        with pytest.raises(zeffy.ZeffyCampaignNotFoundError):
            zeffy.validate_configured_campaign()
        assert len(requests) == 2  # each call retried the lookup


# ---------------------------------------------------------------------------
# find_cart_payment — reconciliation rule
# ---------------------------------------------------------------------------


class TestFindCartPayment:
    def _transport(self, monkeypatch: pytest.MonkeyPatch, payments: list[dict]) -> list[httpx.Request]:
        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "k")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "c-dedicated")
        return _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_envelope(payments)))

    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch):
        requests = self._transport(monkeypatch, [])
        zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        req = requests[0]
        assert req.url.params["campaign"] == "c-dedicated"
        assert req.url.params["status"] == "succeeded"
        assert req.url.params["limit"] == "100"
        assert int(req.url.params["created[gte]"]) == int(NOW.timestamp())

    def test_exact_match(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(id="p-1", amount=600_000)])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is not None and result.payment.id == "p-1"
        assert result.other_payments == []

    def test_newest_exact_match_wins(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(
            monkeypatch,
            [_payment_raw(id="p-old", created=1_768_500_000), _payment_raw(id="p-new", created=1_768_530_000)],
        )
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is not None and result.payment.id == "p-new"

    def test_different_amount_is_other_payment(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(id="p-1", amount=500_000)])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is None
        assert [p.id for p in result.other_payments] == ["p-1"]

    def test_wrong_email_not_matched(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(email="someone-else@test.com")])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is None
        assert result.other_payments == []

    def test_email_match_is_case_insensitive(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(email="Donor@Test.COM")])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is not None

    def test_no_buyer_email_skipped(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(email=None)])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is None
        assert result.other_payments == []

    def test_non_usd_same_amount_is_other_payment(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [_payment_raw(currency="cad")])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is None
        assert [p.id for p in result.other_payments] == ["p-1"]

    def test_no_payments(self, monkeypatch: pytest.MonkeyPatch):
        self._transport(monkeypatch, [])
        result = zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert result.payment is None
        assert result.other_payments == []

    def test_not_configured_raises(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "")
        requests = _install_transport(monkeypatch, lambda req: httpx.Response(200, json=_envelope([])))
        with pytest.raises(zeffy.ZeffyNotConfiguredError):
            zeffy.find_cart_payment("donor@test.com", 600_000, NOW)
        assert requests == []
