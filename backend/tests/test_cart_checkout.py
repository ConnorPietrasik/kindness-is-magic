"""Cart, checkout, confirm, and webhook tests for the Zeffy cash sponsorship flow.

Zeffy HTTP is mocked via httpx.MockTransport (injected through
``zeffy._transport_override``); config values are monkeypatched on the
``app.zeffy`` / ``app.donor_routes`` module attributes. Emails are verified
through the ``SentEmail`` log (SUPPRESS_SEND is on — rows are still recorded).
"""

import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.zeffy as zeffy
from app.config import CASH_CLAIM_PAYMENT_HOURS
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    EmailKind,
    EmailStatus,
    FamilyClaim,
    Family,
    FamilyVerificationStatus,
    SentEmail,
    WishLockLevel,
)
from app.payments import apply_payment_to_claims
from tests.conftest import login_as, make_family

DONOR_EMAIL = "cartdonor@test.com"
DONOR_PASSWORD = "DonorPass1234!"
OTHER_EMAIL = "otherdonor@test.com"
CAMPAIGN_ID = "c-dedicated"
FORM_URL = "https://zeffy.com/f/kindness-sponsorship"


@pytest.fixture(autouse=True)
def _zeffy_env(monkeypatch: pytest.MonkeyPatch):
    """Unconfigured Zeffy (the dev/e2e default) + fresh campaign cache."""
    monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "")
    monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "")
    monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "")
    monkeypatch.setattr(zeffy, "_transport_override", None)
    zeffy.clear_campaign_cache()
    yield
    zeffy.clear_campaign_cache()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_donor(client: TestClient, email: str = DONOR_EMAIL, password: str = DONOR_PASSWORD) -> None:
    client.post(
        "/api/auth/register-donor",
        json={"display_name": "Cart Donor", "email": email, "password": password},
    )
    login_as(client, email, password)


def _create_admin(client: TestClient) -> None:
    login_as(client, "admin@test.com", "AdminPass123!")


def _eligible_family(db: Session, name: str, lock_level: str = "admin") -> Family:
    fam = make_family(
        db,
        family_name=name,
        family_wish="Warm clothes",
        contact_name="Contact",
        phone_number="555-000-0001",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel[lock_level],
    )
    db.add(fam)
    db.commit()
    return fam


def _pending_cash_claim(
    db: Session, donor_user_id: int, family_id: int, *, groceries: bool = False, created_at: datetime | None = None
) -> FamilyClaim:
    claim = FamilyClaim(
        donor_user_id=donor_user_id,
        family_id=family_id,
        commitment_type=CommitmentType.cash,
        payment_status=ClaimPaymentStatus.pending,
        includes_groceries=groceries,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    if created_at is not None:
        claim.created_at = created_at
        db.commit()
        db.refresh(claim)
    return claim


def _payment_raw(
    id: str = "pay-1",
    created: int = 1_768_521_600,
    amount: int = 600_000,
    currency: str = "usd",
    email: str | None = DONOR_EMAIL,
    **overrides,
) -> dict:
    raw = {
        "id": id,
        "object": "payment",
        "created": created,
        "amount": amount,
        "eligible_amount": amount,
        "currency": currency,
        "status": "succeeded",
        "type": "online",
        "refund_status": "none",
        "refunds": [],
        "dispute": None,
        "description": "Sponsorship",
        "contact": None,
        "payment_method": {},
        "buyer": {"email": email, "first_name": "Don", "last_name": "Or", "is_corporate": False, "company_name": None, "address": None},
        "discount": None,
        "campaign_type": "donation_form",
        "campaign_id": CAMPAIGN_ID,
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


def _configure_zeffy(
    monkeypatch: pytest.MonkeyPatch, payments: list[dict] | None = None, campaign_status: int = 200
) -> list[httpx.Request]:
    """Point zeffy at a MockTransport serving a dedicated campaign + payment list.

    Also enables the donor payment-confirmed email (off by default — Zeffy
    sends its own receipt) so this file's email assertions test the send path.
    """
    monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
    monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
    monkeypatch.setattr("app.donor_routes.ZEFFY_FORM_URL", FORM_URL)
    monkeypatch.setattr("app.payments.SEND_PAYMENT_CONFIRMED_EMAIL", True)
    payments = payments or []
    requests: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        if req.url.path.startswith("/api/v1/campaigns/"):
            if campaign_status == 404:
                return httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})
            return httpx.Response(
                200,
                json={
                    "id": CAMPAIGN_ID,
                    "title": "Sponsor a family",
                    "url": FORM_URL,
                    "status": "active",
                    "type": "donation_form",
                    "currency": "usd",
                },
            )
        if req.url.path == "/api/v1/payments":
            # Emulate the real API's server-side created[gte] filter
            gte = req.url.params.get("created[gte]")
            filtered = payments
            if gte is not None:
                filtered = [p for p in payments if p["created"] >= int(gte)]
            return httpx.Response(200, json=_envelope(filtered))
        return httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})

    monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
    return requests


def _sent_rows(db: Session, kind: EmailKind, recipient: str) -> list[SentEmail]:
    return db.query(SentEmail).filter(SentEmail.kind == kind, SentEmail.recipient_email == recipient).order_by(SentEmail.sent_at).all()


def _webhook_headers(body: bytes, secret: str = "whsec_test_secret", t: int | None = None) -> dict:
    t = t if t is not None else int(time.time())
    v1 = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return {"Zeffy-Signature": f"t={t},v1={v1}", "content-type": "application/json"}


def _completed_body(payment: dict, event_type: str = "payment.completed") -> bytes:
    return json.dumps({"type": event_type, "data": payment}).encode()


# ---------------------------------------------------------------------------
# GET /api/donor/cart
# ---------------------------------------------------------------------------


class TestGetCart:
    def test_empty_cart(self, test_client: TestClient, db: Session):
        _create_donor(test_client)
        resp = test_client.get("/api/donor/cart")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["item_count"] == 0
        assert body["total_usd"] == 0
        assert body["payment_expires_at"] is None
        assert body["email_error"] is None

    def test_committed_pending_claims_listed_with_prices_and_expiry(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        fam1 = _eligible_family(db, "Family One")
        fam2 = _eligible_family(db, "Family Two")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam1.id)
        _pending_cash_claim(db, user.id, fam2.id, groceries=True)

        body = test_client.get("/api/donor/cart").json()
        assert body["item_count"] == 2
        assert body["total_usd"] == 500 + 600
        line1 = next(i for i in body["items"] if i["family"]["id"] == fam1.id)
        line2 = next(i for i in body["items"] if i["family"]["id"] == fam2.id)
        assert line1["line_total_usd"] == 500
        assert line1["includes_groceries"] is False
        assert line2["line_total_usd"] == 600
        assert line2["includes_groceries"] is True
        assert line1["family"]["display_id"]
        # Earliest expiry = min(created_at) + 48h
        assert line1["payment_expires_at"] is not None
        assert body["payment_expires_at"] == min(line1["payment_expires_at"], line2["payment_expires_at"])

    def test_past_expiry_still_listed(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        fam = _eligible_family(db, "Old Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        lapsed = datetime.now(timezone.utc) - timedelta(hours=73)
        _pending_cash_claim(db, user.id, fam.id, created_at=lapsed)

        body = test_client.get("/api/donor/cart").json()
        assert body["item_count"] == 1
        assert body["items"][0]["payment_expires_at"] < datetime.now(timezone.utc).isoformat()

    def test_gift_and_paid_claims_not_in_cart(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        from app.models import FamilyClaim, User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam1 = _eligible_family(db, "Gift Family")
        fam2 = _eligible_family(db, "Paid Cash Family")
        gift = FamilyClaim(donor_user_id=user.id, family_id=fam1.id, commitment_type=CommitmentType.gifts)
        db.add(gift)
        paid = FamilyClaim(
            donor_user_id=user.id,
            family_id=fam2.id,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )
        db.add(paid)
        db.commit()

        body = test_client.get("/api/donor/cart").json()
        assert body["item_count"] == 0

    def test_email_error_when_nudge_failed_and_not_sent(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam = _eligible_family(db, "Nudge Family")
        _pending_cash_claim(db, user.id, fam.id)

        # A failed nudge after the window anchor, no successful one
        db.add(
            SentEmail(
                recipient_email=DONOR_EMAIL,
                kind=EmailKind.payment_request,
                status=EmailStatus.failed,
                failure_reason="smtp_error",
                sent_at=datetime.now(timezone.utc) + timedelta(seconds=1),
            )
        )
        db.commit()

        body = test_client.get("/api/donor/cart").json()
        assert body["email_error"] is not None

    def test_email_error_cleared_by_a_successful_send(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam = _eligible_family(db, "Nudge Family 2")
        _pending_cash_claim(db, user.id, fam.id)

        db.add(
            SentEmail(
                recipient_email=DONOR_EMAIL,
                kind=EmailKind.payment_request,
                status=EmailStatus.failed,
                failure_reason="smtp_error",
                sent_at=datetime.now(timezone.utc),
            )
        )
        db.add(
            SentEmail(
                recipient_email=DONOR_EMAIL,
                kind=EmailKind.payment_request,
                status=EmailStatus.sent,
                sent_at=datetime.now(timezone.utc) + timedelta(seconds=1),
            )
        )
        db.commit()

        body = test_client.get("/api/donor/cart").json()
        assert body["email_error"] is None


# ---------------------------------------------------------------------------
# PATCH /api/donor/cart/items/{claim_id}
# ---------------------------------------------------------------------------


class TestToggleGroceries:
    def _donor_with_pending_claim(self, test_client, db, admin_user, groceries=False):
        _create_donor(test_client)
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam = _eligible_family(db, "Groceries Family")
        claim = _pending_cash_claim(db, user.id, fam.id, groceries=groceries)
        return user, fam, claim

    def test_toggle_on(self, test_client: TestClient, db: Session, admin_user):
        _, _, claim = self._donor_with_pending_claim(test_client, db, admin_user)
        resp = test_client.patch(f"/api/donor/cart/items/{claim.id}", json={"includes_groceries": True})
        assert resp.status_code == 200
        body = resp.json()
        assert body["includes_groceries"] is True
        assert body["line_total_usd"] == 600

    def test_toggle_off(self, test_client: TestClient, db: Session, admin_user):
        _, _, claim = self._donor_with_pending_claim(test_client, db, admin_user, groceries=True)
        resp = test_client.patch(f"/api/donor/cart/items/{claim.id}", json={"includes_groceries": False})
        assert resp.status_code == 200
        assert resp.json()["line_total_usd"] == 500

    def test_gift_claim_rejected(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        from app.models import FamilyClaim, User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam = _eligible_family(db, "Gift Claim")
        claim = FamilyClaim(donor_user_id=user.id, family_id=fam.id, commitment_type=CommitmentType.gifts)
        db.add(claim)
        db.commit()
        db.refresh(claim)

        resp = test_client.patch(f"/api/donor/cart/items/{claim.id}", json={"includes_groceries": True})
        assert resp.status_code == 400

    def test_paid_cash_claim_rejected(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        fam = _eligible_family(db, "Paid Claim")
        claim = FamilyClaim(
            donor_user_id=user.id,
            family_id=fam.id,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )
        db.add(claim)
        db.commit()
        db.refresh(claim)

        resp = test_client.patch(f"/api/donor/cart/items/{claim.id}", json={"includes_groceries": True})
        assert resp.status_code == 400

    def test_other_users_claim_forbidden(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)  # donor (later the requester)
        _create_donor(test_client, OTHER_EMAIL)  # claim owner
        from app.models import User

        user = db.query(User).filter(User.email == OTHER_EMAIL).first()
        fam = _eligible_family(db, "Someone Else")
        claim = _pending_cash_claim(db, user.id, fam.id)

        login_as(test_client, DONOR_EMAIL, DONOR_PASSWORD)
        resp = test_client.patch(f"/api/donor/cart/items/{claim.id}", json={"includes_groceries": True})
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/donor/cart/checkout
# ---------------------------------------------------------------------------


class TestCheckout:
    def test_unconfigured_returns_503_before_validation(self, test_client: TestClient, db: Session, admin_user):
        """No form URL → 503 before any item validation (empty and non-empty bodies)."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Some Family", lock_level="family")  # not fully approved

        # Empty body: 503 (not 400 "empty cart")
        resp = test_client.post("/api/donor/cart/checkout", json={})
        assert resp.status_code == 503

        # Unapproved family: still 503 — the gate runs before item validation
        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 503

        # Nothing was created
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        assert db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).count() == 0

    def test_empty_cart_returns_400_when_configured(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        resp = test_client.post("/api/donor/cart/checkout", json={})
        assert resp.status_code == 400

    def test_campaign_validation_failure_returns_503(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A typo'd campaign ID fails loudly at checkout (404 from Zeffy)."""
        _create_donor(test_client)
        _configure_zeffy(monkeypatch, campaign_status=404)
        fam = _eligible_family(db, "Victim Family")

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 503

        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        assert db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).count() == 0

    def test_rejected_api_key_returns_502(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A 401 from Zeffy (bad key) maps to 502, same as the confirm endpoint."""
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(
            zeffy,
            "_transport_override",
            httpx.MockTransport(lambda req: httpx.Response(401, json={"error": {"code": "unauthorized", "message": "bad key"}})),
        )

        resp = test_client.post("/api/donor/cart/checkout", json={"items": []})
        assert resp.status_code == 502
        assert "misconfigured" in resp.json()["detail"]

    def test_checkout_creates_pending_claims_and_returns_zeffy_url(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam1 = _eligible_family(db, "Checkout Family 1")
        fam2 = _eligible_family(db, "Checkout Family 2")
        _configure_zeffy(monkeypatch)

        resp = test_client.post(
            "/api/donor/cart/checkout",
            json={"items": [{"family_id": fam1.id}, {"family_id": fam2.id, "includes_groceries": True}]},
        )
        assert resp.status_code == 200
        body = resp.json()
        # The URL carries only the donor email — Zeffy forms can't
        # pre-fill the amount, so the exact total ($500 + $600 = $1100) is
        # carried by the cart page and the nudge email instead.
        from urllib.parse import parse_qs, urlsplit

        split = urlsplit(body["zeffy_url"])
        assert split.scheme + "://" + split.netloc + split.path == FORM_URL
        params = parse_qs(split.query)
        assert "Amount" not in params
        assert params["email"] == [DONOR_EMAIL]
        assert len(body["claim_ids"]) == 2

        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        claims = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).all()
        assert len(claims) == 2
        assert all(c.payment_status == ClaimPaymentStatus.pending for c in claims)
        assert {c.family_id for c in claims} == {fam1.id, fam2.id}
        groceries = next(c for c in claims if c.family_id == fam2.id)
        assert groceries.includes_groceries is True

        # The cart now lists the committed claims
        cart = test_client.get("/api/donor/cart").json()
        assert cart["item_count"] == 2
        assert cart["total_usd"] == 1100

        # The "please pay" nudge went out
        assert len(_sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)) == 1

    def test_pure_recheckout_reuses_existing_total(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam1 = _eligible_family(db, "Existing 1")
        fam2 = _eligible_family(db, "Existing 2")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam1.id, groceries=True)
        _pending_cash_claim(db, user.id, fam2.id)

        _configure_zeffy(monkeypatch)
        resp = test_client.post("/api/donor/cart/checkout", json={})
        assert resp.status_code == 200
        body = resp.json()
        # The amount isn't pre-fillable — the reused $1100 total is the
        # cart's, and the URL still carries the donor email
        from urllib.parse import parse_qs, urlsplit

        params = parse_qs(urlsplit(body["zeffy_url"]).query)
        assert "Amount" not in params
        assert params["email"] == [DONOR_EMAIL]
        assert test_client.get("/api/donor/cart").json()["total_usd"] == 1100
        assert body["claim_ids"] == []  # nothing new committed

    def test_already_in_cart_conflict(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Already In Cart")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "is already in your cart" in detail
        assert f"(id {fam.id})" in detail

    def test_family_just_sponsored_conflict(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Taken Family")
        from app.auth import get_password_hash
        from app.models import User, UserRole

        other = db.query(User).filter(User.email == OTHER_EMAIL).first()
        if other is None:
            other = User(email=OTHER_EMAIL, hashed_password=get_password_hash("OtherPass1234!"), role=UserRole.donor, display_name=None)
            db.add(other)
            db.commit()
        _pending_cash_claim(db, other.id, fam.id)
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "was just sponsored" in detail
        assert f"(id {fam.id})" in detail

    def test_expired_unswept_claim_still_conflicts(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Accepted lag: a claim that expired but hasn't been swept yet (the
        sweep is hourly) still holds the family — 409, not a free claim."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Lag Family")
        from app.auth import get_password_hash
        from app.models import User, UserRole

        # Another donor's claim lapsed 73h ago — the hourly sweep hasn't run
        other = User(email=OTHER_EMAIL, hashed_password=get_password_hash("OtherPass1234!"), role=UserRole.donor, display_name=None)
        db.add(other)
        db.commit()
        claim = _pending_cash_claim(db, other.id, fam.id)
        claim.created_at = datetime.now(timezone.utc) - timedelta(hours=73)  # lapsed, unswept
        db.commit()
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 409
        assert "was just sponsored" in resp.json()["detail"]
        assert f"(id {fam.id})" in resp.json()["detail"]

        # The family's wish list still shows a claim (the sweep will free it)
        assert test_client.get(f"/api/families/{fam.id}/wish-list").json()["claim_status"] == "active"

    def test_unapproved_family_403(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Unapproved Family", lock_level="family")
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 403

    def test_missing_family_404(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": 999999}]})
        assert resp.status_code == 404

    def test_nudge_sent_at_most_once_per_window(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A second checkout in the same window does not re-nudge."""
        _create_donor(test_client)
        fam1 = _eligible_family(db, "Once 1")
        fam2 = _eligible_family(db, "Once 2")
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam1.id}]})
        assert resp.status_code == 200
        assert len(_sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)) == 1

        # Grow the cart mid-window: the email is stale, no re-nudge
        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam2.id}]})
        assert resp.status_code == 200
        assert test_client.get("/api/donor/cart").json()["total_usd"] == 1000
        assert len(_sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)) == 1

    async def test_fresh_nudge_after_window_anchor_moves(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Once the old window is gone (sweep), a new checkout starts a new
        window (new anchor) and the nudge goes out again — the old nudge row
        is before the new anchor and doesn't block it."""
        from app.payments import run_claim_expiry

        _create_donor(test_client)
        fam1 = _eligible_family(db, "Old Window Family")
        fam2 = _eligible_family(db, "New Window Family")
        _configure_zeffy(monkeypatch)

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam1.id}]})
        assert resp.status_code == 200
        assert len(_sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)) == 1

        # Age the claim past its window and sweep it (the anchor's claim is gone)
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        claim1 = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        claim1.created_at = datetime.now(timezone.utc) - timedelta(hours=73)
        db.commit()
        assert await run_claim_expiry(db) == 1

        # Backdate the old nudge row (long-transaction clock collapse) so it
        # is unambiguously before the new window anchor
        old_row = _sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)[0]
        old_row.sent_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()

        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam2.id}]})
        assert resp.status_code == 200
        # A fresh nudge for the new window
        assert len(_sent_rows(db, EmailKind.payment_request, DONOR_EMAIL)) == 2

    def test_smtp_failure_still_200(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Nudge SMTP failure never fails the checkout (best-effort)."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Smtp Family")
        _configure_zeffy(monkeypatch)

        async def _fail_send(to, subject, html_body, db=None, **kwargs):
            # Mirror the real send_email: record the failed attempt
            db.add(
                SentEmail(
                    recipient_email=to.lower(),
                    kind=EmailKind.payment_request,
                    status=EmailStatus.failed,
                    failure_reason="smtp_error",
                )
            )
            db.commit()
            return {"sent": False, "reason": "smtp_error"}

        import app.payments as payments

        monkeypatch.setattr(payments, "send_email", _fail_send)
        resp = test_client.post("/api/donor/cart/checkout", json={"items": [{"family_id": fam.id}]})
        assert resp.status_code == 200
        from urllib.parse import parse_qs, urlsplit

        params = parse_qs(urlsplit(resp.json()["zeffy_url"]).query)
        assert "Amount" not in params
        assert params["email"] == [DONOR_EMAIL]

        # The failed send was logged → the cart surfaces email_error
        failed = (
            db.query(SentEmail)
            .filter(
                SentEmail.kind == EmailKind.payment_request,
                SentEmail.recipient_email == DONOR_EMAIL,
                SentEmail.status == EmailStatus.failed,
            )
            .first()
        )
        assert failed is not None
        cart = test_client.get("/api/donor/cart").json()
        assert cart["email_error"] is not None


# ---------------------------------------------------------------------------
# POST /api/donor/cart/confirm
# ---------------------------------------------------------------------------


class TestConfirm:
    def test_no_pending_claims_returns_pending(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        assert resp.json() == {"status": "pending", "expected_usd": None, "found_usd": None, "claims": []}

    def test_no_matching_payment_returns_pending(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Waiting Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-x", amount=250_000, email="someone-else@test.com")])

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"

        # Claim still pending
        claim = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        assert claim.payment_status == ClaimPaymentStatus.pending

    def test_payment_without_buyer_email_not_matched(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Ghost Buyer Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-ghost", amount=50_000, email=None, created=int(time.time()))])

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"
        # not an exact match, not another donor's payment — nothing reported
        assert resp.json()["found_usd"] is None

    def test_exact_match_applies_payment(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam1 = _eligible_family(db, "Paid Family 1")
        fam2 = _eligible_family(db, "Paid Family 2")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        created_epoch = int(time.time())
        _pending_cash_claim(db, user.id, fam1.id)
        _pending_cash_claim(db, user.id, fam2.id, groceries=True)
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-77", created=created_epoch, amount=110_000)])

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "paid"
        assert len(body["claims"]) == 2
        assert all(c["payment_status"] == "paid" for c in body["claims"])
        assert all(c["zeffy_payment_id"] == "pay-77" for c in body["claims"])

        # DB state: single-commit apply, paid_at = payment.created
        claims = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).all()
        expected_paid_at = datetime.fromtimestamp(created_epoch, tz=timezone.utc)
        for c in claims:
            assert c.payment_status == ClaimPaymentStatus.paid
            assert c.paid_at == expected_paid_at
            assert c.zeffy_payment_id == "pay-77"

        # The cart is now empty
        assert test_client.get("/api/donor/cart").json()["item_count"] == 0

        # Exactly one confirmation email
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR_EMAIL)) == 1

    def test_double_apply_is_noop(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A second apply/confirm for the same payment id is a no-op — no re-email."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Double Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-88", amount=50_000, created=int(time.time()))])

        assert test_client.post("/api/donor/cart/confirm").json()["status"] == "paid"

        # New pending claim with the same total; the same payment is "found"
        # again but the id is already stored → no-op, no re-email
        fam2 = _eligible_family(db, "Second Family")
        _pending_cash_claim(db, user.id, fam2.id)
        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR_EMAIL)) == 1

    async def test_rival_apply_paid_cart_reports_paid(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A rival apply (webhook) paid the whole cart first — confirm reports
        "paid" from the DB (with the now-paid claims) and does not re-email."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Rival Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        claim = _pending_cash_claim(db, user.id, fam.id)
        raw = _payment_raw(id="pay-rival", amount=50_000, created=int(time.time()))
        _configure_zeffy(monkeypatch, payments=[raw])

        # The rival apply lands first (the webhook path)
        applied = await apply_payment_to_claims(db, [claim], zeffy.parse_payment(raw))
        assert applied is True

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "paid"
        assert [c["id"] for c in body["claims"]] == [claim.id]
        assert body["claims"][0]["payment_status"] == "paid"
        assert body["claims"][0]["zeffy_payment_id"] == "pay-rival"

        # No re-email (the rival apply already sent the confirmation)
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR_EMAIL)) == 1

    def test_empty_cart_with_stale_paid_claim_stays_pending(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """No pending cart and only an OLD paid claim (outside one payment
        window + sweep-lag margin) → "pending" — a swept expired cart must
        not flash "paid" just because the donor sponsored before."""
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        fam = _eligible_family(db, "Stale Paid Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        claim = _pending_cash_claim(db, user.id, fam.id)
        claim.payment_status = ClaimPaymentStatus.paid
        claim.paid_at = datetime.now(timezone.utc) - timedelta(hours=CASH_CLAIM_PAYMENT_HOURS + 2)
        db.commit()

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"

    def test_mismatch_reports_expected_and_found(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Mismatch Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)  # cart total $500
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-99", amount=60_000, created=int(time.time()))])

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "mismatch"
        assert body["expected_usd"] == 500
        assert body["found_usd"] == 600

        # Nothing applied
        claim = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        assert claim.payment_status == ClaimPaymentStatus.pending

    def test_stale_payment_before_window_anchor_not_matched(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A payment created before the window anchor is not matched."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Stale Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)  # created now
        stale_epoch = int(time.time()) - 10 * 24 * 3600  # 10 days ago
        _configure_zeffy(monkeypatch, payments=[_payment_raw(id="pay-old", created=stale_epoch, amount=50_000)])

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.json()["status"] == "pending"

    def test_unconfigured_returns_503(self, test_client: TestClient, db: Session, admin_user):
        _create_donor(test_client)
        fam = _eligible_family(db, "Unconfigured Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)

        resp = test_client.post("/api/donor/cart/confirm")
        assert resp.status_code == 503

    def test_rate_limited_per_ip_with_friendly_hint(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """1/30s per IP — a scripted hammer is blocked with a hint.

        Rate limiting is skipped for the test client by default (DEBUG=true /
        'testclient' peer); X-Forwarded-For + DEBUG=false re-arms the real key.
        """
        _create_donor(test_client)
        monkeypatch.setenv("DEBUG", "false")
        headers = {"x-forwarded-for": "203.0.113.77"}

        first = test_client.post("/api/donor/cart/confirm", headers=headers)
        assert first.status_code == 200
        second = test_client.post("/api/donor/cart/confirm", headers=headers)
        assert second.status_code == 429
        assert "try again in a moment" in second.json()["detail"]


# ---------------------------------------------------------------------------
# POST /api/zeffy/webhook
# ---------------------------------------------------------------------------


class TestWebhook:
    def test_unconfigured_returns_503(self, test_client: TestClient, db: Session):
        body = _completed_body(_payment_raw())
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 503

    def test_missing_signature_header_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        body = _completed_body(_payment_raw())
        resp = test_client.post("/api/zeffy/webhook", content=body)
        assert resp.status_code == 400

    def test_malformed_signature_header_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        body = _completed_body(_payment_raw())
        resp = test_client.post("/api/zeffy/webhook", content=body, headers={"Zeffy-Signature": "garbage"})
        assert resp.status_code == 400

    def test_bad_signature_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        body = _completed_body(_payment_raw())
        headers = _webhook_headers(body, secret="whsec_WRONG")
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=headers)
        assert resp.status_code == 400

    def test_stale_timestamp_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        body = _completed_body(_payment_raw())
        stale_t = int(time.time()) - 10 * 60  # 10 minutes ago
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body, t=stale_t))
        assert resp.status_code == 400

    def test_wrong_event_type_ignored(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        body = _completed_body(_payment_raw(), event_type="campaign.deleted")
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    def test_other_campaign_ignored(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Other Campaign Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")

        payment = _payment_raw(campaign_id="c-someone-elses")
        body = _completed_body(payment)
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

        claim = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        assert claim.payment_status == ClaimPaymentStatus.pending

    def test_known_donor_with_matching_payment_applies(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Webhook Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")

        payment = _payment_raw(id="pay-wh", amount=50_000, created=int(time.time()))
        body = _completed_body(payment)
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "applied"

        claim = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        assert claim.payment_status == ClaimPaymentStatus.paid
        assert claim.zeffy_payment_id == "pay-wh"
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR_EMAIL)) == 1

    def test_duplicate_delivery_is_noop(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Zeffy retries non-2xx up to 5 times — a duplicate delivery of the
        same payment must not re-apply or re-email."""
        _create_donor(test_client)
        fam = _eligible_family(db, "Dup Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")

        payment = _payment_raw(id="pay-dup", amount=50_000, created=int(time.time()))
        body = _completed_body(payment)
        first = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert first.json()["status"] == "applied"

        # Same payload, re-signed (a fresh t) — Zeffy re-signs each retry
        second = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert second.status_code == 200
        assert second.json()["status"] == "already-applied"
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR_EMAIL)) == 1

    def test_unknown_donor_ignored(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        payment = _payment_raw(email="ghost@test.com")
        body = _completed_body(payment)
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    def test_no_pending_cart_ignored(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        payment = _payment_raw(amount=500_000)
        body = _completed_body(payment)
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    def test_amount_mismatch_ignored(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _create_donor(test_client)
        fam = _eligible_family(db, "Wrong Amount Family")
        from app.models import User

        user = db.query(User).filter(User.email == DONOR_EMAIL).first()
        _pending_cash_claim(db, user.id, fam.id)  # $500
        _configure_zeffy(monkeypatch)
        monkeypatch.setattr(zeffy, "ZEFFY_WEBHOOK_SECRET", "whsec_test_secret")
        payment = _payment_raw(amount=700_000)
        body = _completed_body(payment)
        resp = test_client.post("/api/zeffy/webhook", content=body, headers=_webhook_headers(body))
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

        claim = db.query(FamilyClaim).filter(FamilyClaim.donor_user_id == user.id).first()
        assert claim.payment_status == ClaimPaymentStatus.pending
