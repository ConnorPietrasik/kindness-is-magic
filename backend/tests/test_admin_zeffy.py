"""Admin Zeffy reconciliation tests: the local mirror list (unmatched-first +
sync), pending-claims grouping, the unmatched summary, seen, manual match,
unmatch.

The Zeffy client is mocked via ``_transport_override`` (the same pattern as
``test_cart_checkout.py``); throttle is disabled via ZEFFY_MIN_INTERVAL_SECONDS.
"""

import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.zeffy as zeffy
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    EmailKind,
    EmailStatus,
    Family,
    FamilyClaim,
    FamilyVerificationStatus,
    SentEmail,
    User,
    UserRole,
    WishLockLevel,
    ZeffyPaymentRecord,
)
from app.auth import get_password_hash
from app.payments import apply_payment_to_claims, upsert_zeffy_payment
from app.response_builders import batch_build_family_info
from tests.conftest import login_as, make_family

CAMPAIGN_ID = "campaign-123"
DONOR1_EMAIL = "zdonor1@test.com"
DONOR2_EMAIL = "zdonor2@test.com"
DONOR1_PASSWORD = "ZDonorPass1!"
DONOR2_PASSWORD = "ZDonorPass2!"


@pytest.fixture(autouse=True)
def _zeffy_env(monkeypatch: pytest.MonkeyPatch):
    """Unconfigured Zeffy (the default) + zero throttle + fresh campaign cache."""
    monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "")
    monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", "")
    monkeypatch.setattr(zeffy, "_transport_override", None)
    monkeypatch.setenv("ZEFFY_MIN_INTERVAL_SECONDS", "0")
    zeffy.clear_campaign_cache()
    yield
    zeffy.clear_campaign_cache()


def _payment_raw(
    id="pay-1",
    created=None,
    amount=60_000,
    currency="usd",
    status="succeeded",
    campaign_id=CAMPAIGN_ID,
    email=None,
    first="Ada",
    last="Lovelace",
):
    raw = {
        "id": id,
        "created": created if created is not None else int(time.time()),
        "amount": amount,
        "currency": currency,
        "status": status,
        "type": "online",
        "campaign_id": campaign_id,
        "description": "Sponsor a family",
        "contact": None,
        "receipt_url": f"https://zeffy.com/receipt/{id}",
        "refund_status": "none",
        "buyer": None,
    }
    if email is not None or first is not None:
        raw["buyer"] = {"email": email, "first_name": first, "last_name": last, "is_corporate": False, "company_name": None}
    return raw


def _envelope(payments, has_more=False, next_cursor=None):
    return {"object": "list", "data": payments, "has_more": has_more, "next_cursor": next_cursor}


def _mock_handler(payments, *, campaign_found=True, auth_ok=True):
    """Mock transport for the Zeffy read API (campaign + payments)."""

    def handler(request: httpx.Request) -> httpx.Response:
        if not auth_ok:
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "invalid API key"}})
        if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
            if not campaign_found:
                return httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})
            return httpx.Response(
                200,
                json={
                    "id": CAMPAIGN_ID,
                    "title": "Sponsor a family",
                    "url": "https://zeffy.com/f/x",
                    "status": "active",
                    "type": "donation_form",
                    "currency": "usd",
                },
            )
        if request.url.path == "/api/v1/payments":
            return httpx.Response(200, json=_envelope(payments))
        if request.url.path.startswith("/api/v1/payments/"):
            pid = request.url.path.rsplit("/", 1)[1]
            match = next((p for p in payments if p["id"] == pid), None)
            if match is None:
                return httpx.Response(404, json={"error": {"code": "resource_not_found", "message": "nope"}})
            return httpx.Response(200, json=match)
        return httpx.Response(404, json={"error": {"code": "resource_not_found", "message": f"unexpected {request.url.path}"}})

    return handler


def _configure_zeffy(monkeypatch: pytest.MonkeyPatch, payments=None, *, campaign_found=True, auth_ok=True):
    """Configure the client: test key + campaign + a mock transport serving
    *payments* for both the list and the get-by-id endpoints.

    ``auth_ok=False`` makes the mock reject every request with 401 (a bad
    API key). Also enables the donor payment-confirmed email (off by default
    — Zeffy sends its own receipt) so this file's email assertions test the
    send path.
    """
    monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
    monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
    monkeypatch.setattr(
        zeffy, "_transport_override", httpx.MockTransport(_mock_handler(payments or [], campaign_found=campaign_found, auth_ok=auth_ok))
    )
    monkeypatch.setattr("app.payments.SEND_PAYMENT_CONFIRMED_EMAIL", True)
    zeffy.clear_campaign_cache()


def _register_donor(test_client: TestClient, email: str, password: str, name: str) -> None:
    test_client.post("/api/auth/register-donor", json={"display_name": name, "email": email, "password": password})
    login_as(test_client, email, password)


def _donor_row(db: Session, email: str) -> User:
    """A donor row directly (no login needed for enrichment/grouping tests)."""
    user = User(email=email, hashed_password=get_password_hash("x"), role=UserRole.donor, display_name="Z Donor")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _eligible_family(db: Session, name: str, **family_kwargs) -> Family:
    fam = make_family(
        db,
        family_name=name,
        family_wish="Warm clothes",
        contact_name="Contact",
        phone_number="555-000-0010",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
        **family_kwargs,
    )
    db.add(fam)
    db.commit()
    return fam


def _pending_cash_claim(db: Session, donor: User, family: Family, **kwargs) -> FamilyClaim:
    claim = FamilyClaim(
        donor_user_id=donor.id,
        family_id=family.id,
        commitment_type=CommitmentType.cash,
        payment_status=ClaimPaymentStatus.pending,
        **kwargs,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def _login_admin(test_client: TestClient) -> None:
    login_as(test_client, "admin@test.com", "AdminPass123!")


def _sent_rows(db: Session, kind: EmailKind, recipient: str) -> list[SentEmail]:
    return db.query(SentEmail).filter(SentEmail.kind == kind, SentEmail.recipient_email == recipient).order_by(SentEmail.sent_at).all()


def _seed_mirror(db: Session, raw: dict, **overrides) -> ZeffyPaymentRecord:
    """A mirror row straight from a raw Zeffy payment (the webhook's job in
    production), with optional post-insert field tweaks."""
    record = upsert_zeffy_payment(db, zeffy.parse_payment(raw))
    for field, value in overrides.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# GET /api/admin/zeffy/payments — the local mirror, unmatched-first
# ---------------------------------------------------------------------------


class TestPaymentsList:
    async def test_default_unmatched_only_and_show_matched(self, test_client: TestClient, db: Session, admin_user):
        d1 = _donor_row(db, DONOR1_EMAIL)
        _donor_row(db, DONOR2_EMAIL)
        fam1 = _eligible_family(db, "Matched Family 1")
        fam2 = _eligible_family(db, "Matched Family 2")
        c1 = _pending_cash_claim(db, d1, fam1)
        c2 = _pending_cash_claim(db, d1, fam2)

        raw_matched = _payment_raw(id="pay-matched", created=int(time.time()) - 60, amount=110_000, email=DONOR1_EMAIL)
        raw_unmatched = _payment_raw(id="pay-unmatched", created=int(time.time()), amount=50_000, email=DONOR2_EMAIL)
        _seed_mirror(db, raw_matched)
        _seed_mirror(db, raw_unmatched)
        # Match the first payment to both claims via the shared apply path
        # (email off in this fixture — Zeffy sends its own receipt)
        applied = await apply_payment_to_claims(db, [c1, c2], zeffy.parse_payment(raw_matched))
        assert applied is True

        _login_admin(test_client)
        # Default view: the banner's population — unmatched only
        resp = test_client.get("/api/admin/zeffy/payments")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["total_pages"] == 1
        unmatched = body["payments"][0]
        assert unmatched["id"] == "pay-unmatched"
        assert unmatched["matched"] is False
        assert unmatched["claim_ids"] == []
        assert unmatched["buyer_email"] == DONOR2_EMAIL
        assert unmatched["buyer_name"] == "Ada Lovelace"
        assert unmatched["amount_cents"] == 50_000
        assert unmatched["currency"] == "usd"
        assert unmatched["receipt_url"] == "https://zeffy.com/receipt/pay-unmatched"
        assert unmatched["created_at"] is not None
        assert unmatched["seen_at"] is None
        assert unmatched["refund_status"] == "none"

        # show_matched: the full history, matched rows enriched with claims
        resp = test_client.get("/api/admin/zeffy/payments", params={"show_matched": "true"})
        body = resp.json()
        assert body["total"] == 2
        by_id = {p["id"]: p for p in body["payments"]}
        # Newest first (the unmatched row was created later)
        assert [p["id"] for p in body["payments"]] == ["pay-unmatched", "pay-matched"]
        matched = by_id["pay-matched"]
        assert matched["matched"] is True
        assert matched["claim_ids"] == sorted([c1.id, c2.id])
        assert matched["buyer_email"] == DONOR1_EMAIL

    def test_columns_trimming(self, test_client: TestClient, db: Session, admin_user):
        _seed_mirror(db, _payment_raw(id="pay-c", email=DONOR1_EMAIL))
        _login_admin(test_client)

        resp = test_client.get("/api/admin/zeffy/payments", params={"columns": "id,matched,buyer_email"})
        assert resp.status_code == 200
        item = resp.json()["payments"][0]
        # Requested columns + always-include + required fields, nothing else
        assert "buyer_email" in item
        assert "buyer_name" not in item
        assert "receipt_url" not in item
        # The row's chips/actions aren't selectable columns — always present
        # (a missing seen_at/refund_status reads as a fresh, non-refunded row
        # client-side and breaks the Seen/Refunded UI)
        assert "seen_at" in item
        assert "refund_status" in item
        assert "claim_ids" in item

        # Unknown column → 400
        resp = test_client.get("/api/admin/zeffy/payments", params={"columns": "id,bogus"})
        assert resp.status_code == 400
        assert "bogus" in resp.json()["detail"]

    def test_pagination(self, test_client: TestClient, db: Session, admin_user):
        now = int(time.time())
        for i in range(3):
            _seed_mirror(db, _payment_raw(id=f"pay-page-{i}", created=now - i * 100, email=DONOR1_EMAIL))

        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/payments", params={"page": 1, "page_size": 2})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3
        assert body["total_pages"] == 2
        assert [p["id"] for p in body["payments"]] == ["pay-page-0", "pay-page-1"]  # newest first

        resp = test_client.get("/api/admin/zeffy/payments", params={"page": 2, "page_size": 2})
        assert [p["id"] for p in resp.json()["payments"]] == ["pay-page-2"]

    def test_works_unconfigured(self, test_client: TestClient, db: Session, admin_user):
        """The list and summary are local reads — no 503 in the default
        unconfigured state (empty table)."""
        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/payments")
        assert resp.status_code == 200
        assert resp.json() == {"payments": [], "total": 0, "page": 1, "page_size": 25, "total_pages": 0}

        resp = test_client.get("/api/admin/zeffy/unmatched-summary")
        assert resp.status_code == 200
        assert resp.json() == {"count": 0, "oldest_created_at": None}

    def test_forbidden_for_donor(self, test_client: TestClient, db: Session, admin_user):
        """require_admin rejects before any Zeffy call (works unconfigured)."""
        _register_donor(test_client, DONOR1_EMAIL, DONOR1_PASSWORD, "Z Donor 1")
        resp = test_client.get("/api/admin/zeffy/payments")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/admin/zeffy/sync — pull the campaign into the local mirror
# ---------------------------------------------------------------------------


class TestSync:
    def test_inserts_new_and_stops_at_first_known(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Steady-state sync: one API call (the walk stops at the first
        known row, even when the mock claims there is a next page)."""
        list_calls: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
                return httpx.Response(
                    200, json={"id": CAMPAIGN_ID, "title": "t", "url": "u", "status": "active", "type": "donation_form", "currency": "usd"}
                )
            list_calls.append(1)
            return httpx.Response(
                200,
                json=_envelope(
                    [_payment_raw(id="pay-new-1"), _payment_raw(id="pay-new-2"), _payment_raw(id="pay-known")],
                    has_more=True,
                    next_cursor="should-not-be-used",
                ),
            )

        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
        monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
        zeffy.clear_campaign_cache()
        _seed_mirror(db, _payment_raw(id="pay-known"))

        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 200
        assert resp.json() == {"new_count": 2, "updated_count": 1}
        assert len(list_calls) == 1  # stopped at pay-known; no second page
        ids = {r.payment_id for r in db.query(ZeffyPaymentRecord).all()}
        assert ids == {"pay-known", "pay-new-1", "pay-new-2"}

    def test_backfill_walks_all_pages(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """First run on an empty mirror: every page until exhausted."""
        pages = {
            None: _envelope([_payment_raw(id="pay-b1"), _payment_raw(id="pay-b2")], has_more=True, next_cursor="c2"),
            "c2": _envelope([_payment_raw(id="pay-b3")], has_more=False),
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
                return httpx.Response(
                    200, json={"id": CAMPAIGN_ID, "title": "t", "url": "u", "status": "active", "type": "donation_form", "currency": "usd"}
                )
            return httpx.Response(200, json=pages[request.url.params.get("starting_after")])

        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
        monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
        zeffy.clear_campaign_cache()

        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 200
        assert resp.json() == {"new_count": 3, "updated_count": 0}
        assert db.query(ZeffyPaymentRecord).count() == 3

    def test_refreshes_known_fields_and_preserves_seen(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A known row's snapshot is refreshed (e.g. a refund that landed
        after the webhook); the admin's seen acknowledgment survives."""
        raw = _payment_raw(id="pay-ref")
        record = _seed_mirror(db, raw, seen_at=datetime.now(timezone.utc))

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
                return httpx.Response(
                    200, json={"id": CAMPAIGN_ID, "title": "t", "url": "u", "status": "active", "type": "donation_form", "currency": "usd"}
                )
            raw_refunded = dict(raw)
            raw_refunded["refund_status"] = "refunded"
            raw_refunded["amount"] = 99_000
            return httpx.Response(200, json=_envelope([raw_refunded]))

        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
        monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
        zeffy.clear_campaign_cache()

        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 200
        assert resp.json() == {"new_count": 0, "updated_count": 1}

        db.refresh(record)
        assert record.refund_status == "refunded"
        assert record.amount_cents == 99_000
        assert record.seen_at is not None  # attention state untouched

    def test_unconfigured_503(self, test_client: TestClient, db: Session, admin_user):
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 503

    def test_bad_campaign_503(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch, payments=[], campaign_found=False)
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 503

    def test_bad_key_502(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A rejected API key (401) is a 502, not a 500 — same mapping as the donor confirm endpoint."""
        _configure_zeffy(monkeypatch, payments=[], auth_ok=False)
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 502

    def test_sync_lost_insert_race_409s(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A concurrent first insert (the webhook or a sibling sync committing
        the same payment first) loses to the mirror's unique index — the
        endpoint rolls the session back and reports the conflict instead of a
        500; the row already exists (the winner's) and the next sync
        converges."""
        from types import SimpleNamespace

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
                return httpx.Response(
                    200, json={"id": CAMPAIGN_ID, "title": "t", "url": "u", "status": "active", "type": "donation_form", "currency": "usd"}
                )
            return httpx.Response(200, json=_envelope([_payment_raw(id="pay-race")]))

        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
        monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
        zeffy.clear_campaign_cache()
        _login_admin(test_client)

        class _UniqueViolation(Exception):
            pgcode = "23505"  # SQLSTATE unique_violation

            def __init__(self):
                super().__init__('duplicate key value violates unique constraint "uq_zeffy_payments_payment_id"')
                self.diag = SimpleNamespace(constraint_name="uq_zeffy_payments_payment_id")

        def _commit_losing_race():
            # Flush like a real commit so the INSERT lands in the savepoint,
            # then fail the way Postgres would once the rival row commits.
            db.flush()
            raise IntegrityError(
                "INSERT INTO zeffy_payments (payment_id) VALUES (%(payment_id)s)",
                {"payment_id": "pay-race"},
                _UniqueViolation(),
            )

        monkeypatch.setattr(db, "commit", _commit_losing_race)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 409
        assert "try again" in resp.json()["detail"]

        # The flushed INSERT is gone — the handler rolled the session back.
        assert db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == "pay-race").first() is None

    def test_sync_unrelated_integrity_error_500s(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """A commit failure that isn't the mirror's payment_id unique index
        (e.g. an FK violation) must not be mislabelled as a lost race — the
        global SQLAlchemy handler turns it into a generic 500."""
        from types import SimpleNamespace

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == f"/api/v1/campaigns/{CAMPAIGN_ID}":
                return httpx.Response(
                    200, json={"id": CAMPAIGN_ID, "title": "t", "url": "u", "status": "active", "type": "donation_form", "currency": "usd"}
                )
            return httpx.Response(200, json=_envelope([_payment_raw(id="pay-race2")]))

        monkeypatch.setattr(zeffy, "ZEFFY_API_KEY", "test-key")
        monkeypatch.setattr(zeffy, "ZEFFY_CAMPAIGN_ID", CAMPAIGN_ID)
        monkeypatch.setattr(zeffy, "_transport_override", httpx.MockTransport(handler))
        zeffy.clear_campaign_cache()
        _login_admin(test_client)

        class _ForeignKeyViolation(Exception):
            pgcode = "23503"  # SQLSTATE foreign_key_violation

            def __init__(self):
                super().__init__('insert or update on table "zeffy_payments" violates foreign key constraint "fk_zeffy_payments_seen_by"')
                self.diag = SimpleNamespace(constraint_name="fk_zeffy_payments_seen_by")

        def _commit_fk_violation():
            raise IntegrityError(
                "INSERT INTO zeffy_payments (payment_id) VALUES (%(payment_id)s)",
                {"payment_id": "pay-race2"},
                _ForeignKeyViolation(),
            )

        monkeypatch.setattr(db, "commit", _commit_fk_violation)
        resp = test_client.post("/api/admin/zeffy/sync")
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# GET /api/admin/zeffy/unmatched-summary — the dashboard banner
# ---------------------------------------------------------------------------


class TestUnmatchedSummary:
    def test_counts_only_unmatched_unseen(self, test_client: TestClient, db: Session, admin_user):
        d1 = _donor_row(db, DONOR1_EMAIL)
        now = int(time.time())

        # Counted: unmatched, never seen
        _seed_mirror(db, _payment_raw(id="pay-count", created=now - 100, email=DONOR1_EMAIL))
        _seed_mirror(db, _payment_raw(id="pay-count-2", created=now - 50, email=DONOR1_EMAIL))

        # Not counted: matched (a live claim stores the id)
        fam = _eligible_family(db, "Summary Family")
        fam2 = _eligible_family(db, "Summary Family 2")
        claim_live = _pending_cash_claim(db, d1, fam)
        claim_live.zeffy_payment_id = "pay-matched"
        claim_live.payment_status = ClaimPaymentStatus.paid
        db.commit()
        _seed_mirror(db, _payment_raw(id="pay-matched", created=now - 40, email=DONOR1_EMAIL))

        # Not counted: seen
        _seed_mirror(db, _payment_raw(id="pay-seen", created=now - 30, email=DONOR1_EMAIL), seen_at=datetime.now(timezone.utc))

        # Counted: matched only by a soft-DELETED claim (a deleted match is
        # not a match — the payment is waiting again)
        claim_deleted = _pending_cash_claim(db, d1, fam2)
        claim_deleted.zeffy_payment_id = "pay-deleted-match"
        claim_deleted.payment_status = ClaimPaymentStatus.paid
        claim_deleted.deleted_at = datetime.now(timezone.utc)
        db.commit()
        _seed_mirror(db, _payment_raw(id="pay-deleted-match", created=now - 20, email=DONOR1_EMAIL))

        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/unmatched-summary")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 3  # pay-count, pay-count-2, pay-deleted-match
        # Oldest of the counted rows (pay-count, now - 100)
        assert body["oldest_created_at"] is not None

    def test_empty(self, test_client: TestClient, db: Session, admin_user):
        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/unmatched-summary")
        assert resp.status_code == 200
        assert resp.json() == {"count": 0, "oldest_created_at": None}


# ---------------------------------------------------------------------------
# POST/DELETE /api/admin/zeffy/payments/{id}/seen — the banner acknowledgment
# ---------------------------------------------------------------------------


class TestSeen:
    def test_mark_and_clear_roundtrip(self, test_client: TestClient, db: Session, admin_user):
        _seed_mirror(db, _payment_raw(id="pay-s", email=DONOR1_EMAIL))
        _login_admin(test_client)

        # Baseline: the banner counts it
        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 1

        resp = test_client.post("/api/admin/zeffy/payments/pay-s/seen")
        assert resp.status_code == 200
        assert resp.json()["seen_at"] is not None
        # Suppressed from the banner and the default list view
        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 0
        assert test_client.get("/api/admin/zeffy/payments").json()["total"] == 0
        # …but still visible with show_matched (the row, with seen_at set)
        item = test_client.get("/api/admin/zeffy/payments", params={"show_matched": "true"}).json()["payments"][0]
        assert item["seen_at"] is not None

        resp = test_client.delete("/api/admin/zeffy/payments/pay-s/seen")
        assert resp.status_code == 200
        assert resp.json()["seen_at"] is None
        # Re-enters the banner while still unmatched
        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 1

    def test_clear_is_idempotent(self, test_client: TestClient, db: Session, admin_user):
        _seed_mirror(db, _payment_raw(id="pay-s2", email=DONOR1_EMAIL))
        _login_admin(test_client)
        resp = test_client.delete("/api/admin/zeffy/payments/pay-s2/seen")
        assert resp.status_code == 200
        assert resp.json() == {"payment_id": "pay-s2", "seen_at": None}

    def test_unknown_payment_404(self, test_client: TestClient, db: Session, admin_user):
        _login_admin(test_client)
        assert test_client.post("/api/admin/zeffy/payments/nope/seen").status_code == 404
        assert test_client.delete("/api/admin/zeffy/payments/nope/seen").status_code == 404


# ---------------------------------------------------------------------------
# GET /api/admin/zeffy/pending-claims — grouping
# ---------------------------------------------------------------------------


class TestPendingClaims:
    def test_grouping_and_total_math(self, test_client: TestClient, db: Session, admin_user):
        # No Zeffy key at all — the endpoint is local-only
        d1 = _donor_row(db, DONOR1_EMAIL)
        d2 = _donor_row(db, DONOR2_EMAIL)
        f1 = _eligible_family(db, "Pend Family 1")
        f2 = _eligible_family(db, "Pend Family 2", bio="A small household.")
        f3 = _eligible_family(db, "Pend Family 3")
        _pending_cash_claim(db, d1, f1)
        _pending_cash_claim(db, d1, f2, includes_groceries=True)  # 500 + 100
        _pending_cash_claim(db, d2, f3)
        # A paid claim and a gift claim must not appear
        paid_fam = _eligible_family(db, "Paid Family")
        paid = FamilyClaim(
            donor_user_id=d1.id,
            family_id=paid_fam.id,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )
        db.add(paid)
        gift_fam = _eligible_family(db, "Gift Family")
        gift = FamilyClaim(donor_user_id=d2.id, family_id=gift_fam.id, commitment_type=CommitmentType.gifts)
        db.add(gift)
        db.commit()

        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/pending-claims")
        assert resp.status_code == 200
        body = resp.json()

        assert len(body["donors"]) == 2
        by_email = {g["donor_email"]: g for g in body["donors"]}

        g1 = by_email[DONOR1_EMAIL]
        assert g1["item_count"] == 2
        assert g1["total_usd"] == 1100  # 500 + 600
        assert g1["donor_display_name"] == "Z Donor"
        assert len(g1["claims"]) == 2
        groceries_claim = next(c for c in g1["claims"] if c["includes_groceries"])
        assert groceries_claim["line_total_usd"] == 600
        assert groceries_claim["payment_expires_at"] is not None
        assert groceries_claim["family"]["display_id"] is not None
        assert groceries_claim["family"]["bio"] is not None

        g2 = by_email[DONOR2_EMAIL]
        assert g2["item_count"] == 1
        assert g2["total_usd"] == 500

    def test_empty(self, test_client: TestClient, db: Session, admin_user):
        _login_admin(test_client)
        resp = test_client.get("/api/admin/zeffy/pending-claims")
        assert resp.status_code == 200
        assert resp.json() == {"donors": []}

    def test_forbidden_for_donor(self, test_client: TestClient, db: Session, admin_user):
        _register_donor(test_client, DONOR1_EMAIL, DONOR1_PASSWORD, "Z Donor 1")
        resp = test_client.get("/api/admin/zeffy/pending-claims")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/admin/zeffy/payments/{id}/match
# ---------------------------------------------------------------------------


class TestMatch:
    async def test_match_multi_claim_multi_donor_emails_each(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        d2 = _donor_row(db, DONOR2_EMAIL)
        f1 = _eligible_family(db, "Match Family 1")
        f2 = _eligible_family(db, "Match Family 2")
        c1 = _pending_cash_claim(db, d1, f1)
        c2 = _pending_cash_claim(db, d2, f2)

        raw = _payment_raw(id="pay-m", amount=100_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)

        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id, c2.id]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["payment_id"] == raw["id"]
        assert sorted(c["id"] for c in body["claims"]) == sorted([c1.id, c2.id])

        db.refresh(c1)
        db.refresh(c2)
        assert c1.payment_status == ClaimPaymentStatus.paid
        assert c2.payment_status == ClaimPaymentStatus.paid
        assert c1.zeffy_payment_id == raw["id"]
        assert c2.zeffy_payment_id == raw["id"]
        # paid_at = the payment's created timestamp
        expected_paid_at = datetime.fromtimestamp(raw["created"], tz=timezone.utc)
        assert c1.paid_at == expected_paid_at

        # One confirmation per affected donor
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR1_EMAIL)) == 1
        assert len(_sent_rows(db, EmailKind.payment_confirmed, DONOR2_EMAIL)) == 1

        # The payment now shows as matched in the list (behind the toggle —
        # the default view is the banner's unmatched population)
        resp = test_client.get("/api/admin/zeffy/payments", params={"show_matched": "true"})
        by_id = {p["id"]: p for p in resp.json()["payments"]}
        assert by_id[raw["id"]]["matched"] is True
        assert by_id[raw["id"]]["claim_ids"] == sorted([c1.id, c2.id])
        assert by_id[raw["id"]]["seen_at"] is None  # apply path cleared it

    def test_match_refreshes_mirror_and_persists_on_rejection(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """The fresh payment (succeeded, dedicated campaign) is mirrored (and
        committed) BEFORE the business checks — a rejected match still leaves
        the page with the fresh state (here: already matched, and the fresh
        fetch shows a refund that landed after the webhook)."""
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Fresh Mirror Family")
        f2 = _eligible_family(db, "Fresh Mirror Family 2")
        c1 = _pending_cash_claim(db, d1, f1)
        # The payment is already stored on another live claim
        c_other = _pending_cash_claim(db, d1, f2, zeffy_payment_id="pay-fresh")
        c_other.payment_status = ClaimPaymentStatus.paid
        db.commit()

        record = _seed_mirror(db, _payment_raw(id="pay-fresh", amount=50_000, email=DONOR1_EMAIL))

        fresh = _payment_raw(id="pay-fresh", amount=50_000, email=DONOR1_EMAIL)
        fresh["refund_status"] = "refunded"
        _configure_zeffy(monkeypatch, payments=[fresh])
        _login_admin(test_client)

        resp = test_client.post("/api/admin/zeffy/payments/pay-fresh/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 400
        assert "already matched" in resp.json()["detail"]

        db.refresh(record)
        assert record.refund_status == "refunded"  # fresh state persisted despite the rejection
        db.refresh(c1)
        assert c1.payment_status == ClaimPaymentStatus.pending  # nothing applied

    def test_match_clears_seen(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """Matching a payment the admin had marked seen clears the
        acknowledgment — a later unmatch re-surfaces it in the banner."""
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Seen Match Family")
        c1 = _pending_cash_claim(db, d1, f1)

        raw = _payment_raw(id="pay-seen-match", amount=50_000, email=DONOR1_EMAIL)
        _seed_mirror(db, raw, seen_at=datetime.now(timezone.utc))
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)

        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 0  # seen
        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 200

        db.expire_all()
        record = db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == raw["id"]).first()
        assert record.seen_at is None

        # Unmatch → unmatched + un-seen → banner re-surfaces
        assert test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/unmatch").status_code == 200
        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 1

    async def test_partial_match_emails_cover_just_that_claim(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        """An admin partial match (payment → 1 of 2 cart claims) sends a
        confirmation covering just that claim."""
        import app.payments as payments_mod

        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Partial Family 1")
        f2 = _eligible_family(db, "Partial Family 2")
        c1 = _pending_cash_claim(db, d1, f1)
        c2 = _pending_cash_claim(db, d1, f2)

        captured: list[dict] = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            captured.append({"to": to, "subject": subject, "body": html_body})
            db.add(SentEmail(recipient_email=to.lower(), kind=EmailKind.payment_confirmed, status=EmailStatus.sent))
            db.commit()
            return {"sent": True}

        monkeypatch.setattr(payments_mod, "send_email", _capture_send)

        raw = _payment_raw(id="pay-partial", amount=50_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)

        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 200
        assert [c["id"] for c in resp.json()["claims"]] == [c1.id]

        db.refresh(c1)
        db.refresh(c2)
        assert c1.payment_status == ClaimPaymentStatus.paid
        assert c2.payment_status == ClaimPaymentStatus.pending  # untouched

        # Exactly one email, and it covers the matched claim only
        assert len(captured) == 1
        assert captured[0]["to"] == DONOR1_EMAIL
        info = batch_build_family_info(db, [f1, f2])
        assert info[f1.id].display_id in captured[0]["body"]
        assert info[f2.id].display_id not in captured[0]["body"]

    def test_unknown_payment_404(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch, payments=[])
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/payments/does-not-exist/match", json={"claim_ids": [1]})
        assert resp.status_code == 404

    def test_already_matched_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Already Family")
        c1 = _pending_cash_claim(db, d1, f1, zeffy_payment_id="pay-old")

        raw = _payment_raw(id="pay-old", amount=50_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)
        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 400
        assert "already matched" in resp.json()["detail"]

    def test_non_cash_or_paid_claim_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Bad Claim Family")
        c_cash = _pending_cash_claim(db, d1, f1)
        f2 = _eligible_family(db, "Bad Claim Family 2")
        c_gift = FamilyClaim(donor_user_id=d1.id, family_id=f2.id, commitment_type=CommitmentType.gifts)
        db.add(c_gift)
        db.commit()
        db.refresh(c_gift)

        raw = _payment_raw(id="pay-bad", amount=100_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)

        # A gift claim in the mix → 400, nothing applied
        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c_cash.id, c_gift.id]})
        assert resp.status_code == 400
        db.refresh(c_cash)
        assert c_cash.payment_status == ClaimPaymentStatus.pending

    def test_empty_claim_ids_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch, payments=[])
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/payments/pay-x/match", json={"claim_ids": []})
        assert resp.status_code == 400

    def test_not_succeeded_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Pending Pay Family")
        c1 = _pending_cash_claim(db, d1, f1)
        raw = _payment_raw(id="pay-pending", amount=50_000, email=DONOR1_EMAIL, status="pending")
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)
        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 400
        assert "hasn't completed" in resp.json()["detail"]
        # Outside the mirror's population (succeeded only) — not mirrored
        assert db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == "pay-pending").first() is None

    def test_wrong_campaign_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Wrong Campaign Family")
        c1 = _pending_cash_claim(db, d1, f1)
        raw = _payment_raw(id="pay-other", amount=50_000, email=DONOR1_EMAIL, campaign_id="some-other-campaign")
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)
        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]})
        assert resp.status_code == 400
        assert "campaign" in resp.json()["detail"]
        # Outside the mirror's population (dedicated campaign only) — not mirrored
        assert db.query(ZeffyPaymentRecord).filter(ZeffyPaymentRecord.payment_id == "pay-other").first() is None

    def test_unconfigured_503(self, test_client: TestClient, db: Session, admin_user):
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/payments/pay-x/match", json={"claim_ids": [1]})
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /api/admin/zeffy/payments/{id}/unmatch
# ---------------------------------------------------------------------------


class TestUnmatch:
    def test_unmatch_reverts_to_pending_and_payment_unmatched(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Unmatch Family 1")
        f2 = _eligible_family(db, "Unmatch Family 2")
        c1 = _pending_cash_claim(db, d1, f1)
        c2 = _pending_cash_claim(db, d1, f2)

        raw = _payment_raw(id="pay-u", amount=100_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)

        # Match first
        assert test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id, c2.id]}).status_code == 200
        # Age one window so the unmatch's fresh-window matters
        db.refresh(c1)
        c1.created_at = datetime.now(timezone.utc) - timedelta(hours=100)
        db.commit()

        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/unmatch")
        assert resp.status_code == 200
        body = resp.json()
        assert body["payment_id"] == raw["id"]
        assert sorted(body["claim_ids"]) == sorted([c1.id, c2.id])

        db.refresh(c1)
        db.refresh(c2)
        for c in (c1, c2):
            assert c.payment_status == ClaimPaymentStatus.pending
            assert c.paid_at is None
            assert c.zeffy_payment_id is None
            # Fresh window: the lapsed claim is not immediately re-swept
            assert c.created_at >= datetime.now(timezone.utc) - timedelta(seconds=10)

        # The payment is unmatched in the list again (the default view is
        # the banner's population, so its mere presence is the assertion)
        resp = test_client.get("/api/admin/zeffy/payments")
        by_id = {p["id"]: p for p in resp.json()["payments"]}
        assert by_id[raw["id"]]["matched"] is False
        assert by_id[raw["id"]]["claim_ids"] == []
        # …and the banner counts it again
        assert test_client.get("/api/admin/zeffy/unmatched-summary").json()["count"] == 1

    def test_unmatch_fulfilled_target_400(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        d1 = _donor_row(db, DONOR1_EMAIL)
        f1 = _eligible_family(db, "Fulfilled Unmatch Family")
        c1 = _pending_cash_claim(db, d1, f1)

        raw = _payment_raw(id="pay-f", amount=50_000, email=DONOR1_EMAIL)
        _configure_zeffy(monkeypatch, payments=[raw])
        _login_admin(test_client)
        assert test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/match", json={"claim_ids": [c1.id]}).status_code == 200

        # Fulfill the (paid) claim
        db.refresh(c1)
        c1.fulfilled_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.post(f"/api/admin/zeffy/payments/{raw['id']}/unmatch")
        assert resp.status_code == 400
        assert "fulfilled" in resp.json()["detail"]

        # The claim is still paid + linked (the unmatch was refused)
        db.refresh(c1)
        assert c1.payment_status == ClaimPaymentStatus.paid
        assert c1.zeffy_payment_id == raw["id"]

    def test_unmatch_unknown_id_404(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        _configure_zeffy(monkeypatch, payments=[])
        _login_admin(test_client)
        resp = test_client.post("/api/admin/zeffy/payments/never-stored/unmatch")
        assert resp.status_code == 404
