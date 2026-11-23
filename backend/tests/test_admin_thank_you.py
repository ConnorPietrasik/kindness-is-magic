"""Admin thank-you-emails tests: the merged candidate list (fulfilled
sponsors + general-donation donors), filters/search/sort/columns, and the
mark/unmark-thanked endpoints.

All data is local (claims + the Zeffy mirror + the thanks table) — no Zeffy
client or SMTP involved.
"""

import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    FamilyVerificationStatus,
    FamilyClaim,
    User,
    UserRole,
    WishLockLevel,
    ZeffyPaymentRecord,
)
from app import zeffy
from app.auth import get_password_hash
from tests.conftest import login_as, make_family

NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _donor(db: Session, email: str, display_name: str | None = None, *, deleted: bool = False) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash("x"),
        role=UserRole.donor,
        display_name=display_name,
        deleted_at=NOW if deleted else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _family(db: Session, name: str):
    fam = make_family(
        db,
        family_name=name,
        family_wish="Warm clothes",
        contact_name="Contact",
        phone_number="555-000-0010",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    return fam


def _claim(
    db: Session,
    donor: User,
    family,
    *,
    commitment: CommitmentType = CommitmentType.gifts,
    fulfilled: datetime | None = None,
    pending: bool = False,
) -> FamilyClaim:
    """A claim row. Gift claims are always paid; cash claims are paid
    unless *pending* (the unpaid checkout state)."""
    claim = FamilyClaim(
        donor_user_id=donor.id,
        family_id=family.id,
        commitment_type=commitment,
        payment_status=ClaimPaymentStatus.pending if pending else ClaimPaymentStatus.paid,
        paid_at=None if (pending or commitment == CommitmentType.gifts) else NOW,
        fulfilled_at=fulfilled,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def _payment(
    db: Session,
    payment_id: str,
    email: str | None,
    name: str | None = None,
    amount_cents: int = 100_000,
    created: datetime | None = None,
    refund_status: str = "none",
    **overrides,
) -> ZeffyPaymentRecord:
    record = ZeffyPaymentRecord(
        payment_id=payment_id,
        created_at=created or NOW,
        amount_cents=amount_cents,
        currency="usd",
        buyer_email=email,
        buyer_name=name,
        status="succeeded",
        refund_status=refund_status,
        **overrides,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _login_admin(test_client: TestClient) -> None:
    login_as(test_client, "admin@test.com", "AdminPass123!")


# ---------------------------------------------------------------------------
# List — auth
# ---------------------------------------------------------------------------


class TestListAuth:
    def test_401_unauthenticated(self, test_client: TestClient, admin_user):
        resp = test_client.get("/api/admin/thank-you")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, admin_user, referrer_user):
        _login_admin(test_client)
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/admin/thank-you")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# List — candidate derivation
# ---------------------------------------------------------------------------


class TestListCandidates:
    def test_empty(self, test_client: TestClient, admin_user):
        _login_admin(test_client)
        resp = test_client.get("/api/admin/thank-you")
        assert resp.status_code == 200
        body = resp.json()
        assert body["donors"] == []
        assert body["total"] == 0

    def test_fulfilled_gift_claim_included(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "gift@test.com", "Gift Donor")
        fam = _family(db, "The Adams")
        _claim(db, donor, fam, fulfilled=NOW - timedelta(days=1))
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        donor_item = body["donors"][0]
        assert donor_item["email"] == "gift@test.com"
        assert donor_item["display_name"] == "Gift Donor"
        assert donor_item["source"] == "claims"
        assert donor_item["claim_count"] == 1
        assert donor_item["claim_family_names"] == ["The Adams"]
        assert donor_item["general_payment_count"] == 0

    def test_fulfilled_cash_claim_included_when_paid(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "cash@test.com")
        fam = _family(db, "The Bells")
        _claim(db, donor, fam, commitment=CommitmentType.cash, fulfilled=NOW)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        assert body["donors"][0]["source"] == "claims"

    def test_unfulfilled_claims_excluded(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "active@test.com")
        _claim(db, donor, _family(db, "The Calms"))  # active gift
        _claim(db, donor, _family(db, "The Pends"), commitment=CommitmentType.cash, pending=True)  # pending cash
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 0

    def test_cancelled_fulfilled_claim_excluded(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "cancelled@test.com")
        fam = _family(db, "The Dones")
        claim = _claim(db, donor, fam, fulfilled=NOW)
        claim.deleted_at = NOW
        db.commit()
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 0

    def test_soft_deleted_donor_account_still_candidate(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "deleted-acct@test.com", "Deleted Donor", deleted=True)
        fam = _family(db, "The Exes")
        _claim(db, donor, fam, fulfilled=NOW)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        assert body["donors"][0]["email"] == "deleted-acct@test.com"
        assert body["donors"][0]["display_name"] == "Deleted Donor"

    def test_general_donation_included(self, test_client: TestClient, admin_user, db: Session):
        _payment(db, "gen-1", "general@test.com", name="General Giver", amount_cents=50_000)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        item = body["donors"][0]
        assert item["email"] == "general@test.com"
        assert item["display_name"] == "General Giver"
        assert item["source"] == "general"
        assert item["general_payment_count"] == 1
        assert item["general_total_cents"] == 50_000
        assert item["claim_count"] == 0

    def test_seen_general_payment_still_included(self, test_client: TestClient, admin_user, db: Session):
        """Seen is the admin's general-donation acknowledgment — unlike the
        Zeffy banner, it must not suppress the row."""
        _payment(db, "gen-seen", "seen@test.com", seen_at=NOW)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1

    def test_matched_payment_excluded(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "matched@test.com")
        fam = _family(db, "The Matcheds")
        claim = _claim(db, donor, fam, commitment=CommitmentType.cash, fulfilled=NOW)
        claim.zeffy_payment_id = "pay-matched"
        db.commit()
        _payment(db, "pay-matched", "matched@test.com", amount_cents=60_000)
        _login_admin(test_client)

        # One merged row — the claim side only (the payment is matched).
        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        assert body["donors"][0]["source"] == "claims"
        assert body["donors"][0]["general_payment_count"] == 0

    def test_payment_matched_to_cancelled_claim_stays_general(self, test_client: TestClient, admin_user, db: Session):
        """A soft-deleted claim does not count as a match (same semantics as
        the Zeffy reconciliation)."""
        donor = _donor(db, "stale@test.com")
        fam = _family(db, "The Stales")
        claim = _claim(db, donor, fam, commitment=CommitmentType.cash, fulfilled=NOW)
        claim.zeffy_payment_id = "pay-stale"
        claim.deleted_at = NOW
        db.commit()
        _payment(db, "pay-stale", "stale@test.com", amount_cents=60_000)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        assert body["donors"][0]["source"] == "general"

    def test_anonymous_and_refunded_payments_excluded(self, test_client: TestClient, admin_user, db: Session):
        _payment(db, "anon", None)
        _payment(db, "refunded", "refunded@test.com", refund_status="full")
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 0

    def test_partially_refunded_payment_included(self, test_client: TestClient, admin_user, db: Session):
        _payment(db, "partial", "partial@test.com", refund_status="partial")
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1

    def test_general_campaign_payment_included(self, test_client: TestClient, admin_user, db: Session):
        """The mirror also holds general-donation-campaign rows (webhook/sync
        from the general donation form's campaign) — they are direct
        candidates."""
        _payment(db, "gc-1", "gencamp@test.com", name="Gen Camp", campaign_id="c-general")
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        item = body["donors"][0]
        assert item["email"] == "gencamp@test.com"
        assert item["source"] == "general"
        assert item["general_payment_count"] == 1

    def test_unmatched_dedicated_payment_still_candidate_when_general_configured(
        self, test_client: TestClient, admin_user, db: Session, monkeypatch
    ):
        """The wrong-form case: a donor who paid on the sponsorship form
        without a cart to match is still a general candidate, even with a
        separate general-donation campaign configured. The candidate query is
        deliberately campaign-agnostic — what matters is that no live claim
        stores the payment."""
        monkeypatch.setattr(zeffy, "ZEFFY_GENERAL_CAMPAIGN_ID", "c-general")
        _payment(db, "ded-wrong", "wrongform@test.com", name="Wrong Form", campaign_id="c-dedicated")
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        assert body["donors"][0]["email"] == "wrongform@test.com"
        assert body["donors"][0]["source"] == "general"

    def test_refunded_general_campaign_payment_excluded(self, test_client: TestClient, admin_user, db: Session):
        _payment(db, "gc-ref", "gc-ref@test.com", name="GC Ref", campaign_id="c-general", refund_status="full")
        _login_admin(test_client)

        assert test_client.get("/api/admin/thank-you").json()["total"] == 0

    def test_multiple_general_payments_merged_per_email(self, test_client: TestClient, admin_user, db: Session):
        _payment(db, "g-1", "multi@test.com", name="First Name", amount_cents=10_000, created=NOW - timedelta(days=2))
        _payment(db, "g-2", "MULTI@test.com", name="Second Name", amount_cents=25_000, created=NOW - timedelta(days=1))
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        item = body["donors"][0]
        assert item["email"] == "multi@test.com"  # merged case-insensitively
        assert item["general_payment_count"] == 2
        assert item["general_total_cents"] == 35_000
        assert item["display_name"] == "Second Name"  # newest buyer name

    def test_claim_and_general_merged_into_both(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "both@test.com", "Both Donor")
        fam = _family(db, "The Boths")
        _claim(db, donor, fam, fulfilled=NOW - timedelta(days=3))
        _payment(db, "both-1", "BOTH@test.com", name="Buyer Name", amount_cents=40_000)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        assert body["total"] == 1
        item = body["donors"][0]
        assert item["source"] == "both"
        assert item["display_name"] == "Both Donor"  # account name beats buyer name
        assert item["claim_count"] == 1
        assert item["general_payment_count"] == 1

    def test_multiple_fulfilled_claims_aggregate(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "multi-claim@test.com")
        fam1 = _family(db, "The Firsts")
        fam2 = _family(db, "The Seconds")
        _claim(db, donor, fam1, fulfilled=NOW - timedelta(days=5))
        _claim(db, donor, fam2, fulfilled=NOW - timedelta(days=1))
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you").json()
        item = body["donors"][0]
        assert item["claim_count"] == 2
        assert item["claim_family_names"] == ["The Firsts", "The Seconds"]  # fulfillment order
        assert item["latest_fulfilled_at"] is not None


# ---------------------------------------------------------------------------
# List — filters, search, sort, columns
# ---------------------------------------------------------------------------


class TestListFiltering:
    def _seed(self, db: Session):
        """Two claim donors, one general donor, one both."""
        c1 = _donor(db, "claims1@test.com", "Carol")
        _claim(db, c1, _family(db, "The Carols"), fulfilled=NOW - timedelta(days=2))
        c2 = _donor(db, "claims2@test.com", "Dan")
        _claim(db, c2, _family(db, "The Dans"), fulfilled=NOW - timedelta(days=1))
        _payment(db, "gen-only", "general-only@test.com", name="Gil", amount_cents=15_000)
        b = _donor(db, "both@test.com", "Beth")
        _claim(db, b, _family(db, "The Beths"), fulfilled=NOW)
        _payment(db, "both-1", "both@test.com", name="Buyer Beth", amount_cents=9_000)

    def test_source_filter(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        def emails() -> set[str]:
            return {d["email"] for d in test_client.get("/api/admin/thank-you").json()["donors"]}

        assert emails() == {"claims1@test.com", "claims2@test.com", "general-only@test.com", "both@test.com"}
        claims = {d["email"] for d in test_client.get("/api/admin/thank-you", params={"source": "claims"}).json()["donors"]}
        assert claims == {"claims1@test.com", "claims2@test.com", "both@test.com"}
        general = {d["email"] for d in test_client.get("/api/admin/thank-you", params={"source": "general"}).json()["donors"]}
        assert general == {"general-only@test.com", "both@test.com"}
        both = {d["email"] for d in test_client.get("/api/admin/thank-you", params={"source": "both"}).json()["donors"]}
        assert both == {"both@test.com"}

    def test_invalid_source_422(self, test_client: TestClient, admin_user):
        _login_admin(test_client)
        assert test_client.get("/api/admin/thank-you", params={"source": "nope"}).status_code == 422

    def test_search_email_name_family(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        assert test_client.get("/api/admin/thank-you", params={"search": "carol"}).json()["total"] == 1
        assert test_client.get("/api/admin/thank-you", params={"search": "the dans"}).json()["total"] == 1
        assert test_client.get("/api/admin/thank-you", params={"search": "gIl"}).json()["total"] == 1
        assert test_client.get("/api/admin/thank-you", params={"search": "nobody"}).json()["total"] == 0

    def test_sort_default_email_asc_and_desc(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        default = [d["email"] for d in test_client.get("/api/admin/thank-you").json()["donors"]]
        assert default == sorted(default)
        desc = [d["email"] for d in test_client.get("/api/admin/thank-you", params={"sort": "-email"}).json()["donors"]]
        assert desc == sorted(desc, reverse=True)

    def test_sort_by_general_total_and_unknown_field(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        by_total = [d["email"] for d in test_client.get("/api/admin/thank-you", params={"sort": "-general_total_cents"}).json()["donors"]]
        assert by_total[0] == "general-only@test.com"  # 15000 > 9000 > 0
        unknown = test_client.get("/api/admin/thank-you", params={"sort": "nope"}).json()["donors"]
        assert [d["email"] for d in unknown] == sorted(d["email"] for d in unknown)  # default email asc

    def test_columns_subset_and_always_include(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        body = test_client.get("/api/admin/thank-you", params={"columns": "email,claim_count"}).json()
        keys = set(body["donors"][0].keys())
        # always_include drives the row's actions/filters client-side, and
        # carries the draft dialog's inputs — hiding a table column must not
        # hollow out the draft
        assert {
            "email",
            "source",
            "thanked_at",
            "display_name",
            "claim_count",
            "claim_family_names",
            "general_payment_count",
            "general_total_cents",
            "latest_donation_at",
        } <= keys
        # Other fields follow the column selection
        assert "latest_fulfilled_at" not in keys
        assert "thanked_by_name" not in keys

    def test_columns_unknown_field_422(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)
        assert test_client.get("/api/admin/thank-you", params={"columns": "bogus"}).status_code == 422

    def test_pagination(self, test_client: TestClient, admin_user, db: Session):
        self._seed(db)
        _login_admin(test_client)

        page1 = test_client.get("/api/admin/thank-you", params={"page_size": 2}).json()
        assert page1["total"] == 4
        assert page1["total_pages"] == 2
        assert len(page1["donors"]) == 2
        page2 = test_client.get("/api/admin/thank-you", params={"page_size": 2, "page": 2}).json()
        assert len(page2["donors"]) == 2
        assert [d["email"] for d in page1["donors"]] != [d["email"] for d in page2["donors"]]


# ---------------------------------------------------------------------------
# Mark / unmark thanked
# ---------------------------------------------------------------------------


class TestMarkThanked:
    def _candidate(self, db: Session, email: str = "mark@test.com") -> None:
        donor = _donor(db, email, "Mark Donor")
        _claim(db, donor, _family(db, "The Marks"), fulfilled=NOW)

    def test_mark_creates_row_and_shows_in_list(self, test_client: TestClient, admin_user, db: Session):
        self._candidate(db)
        _login_admin(test_client)

        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "mark@test.com"
        assert body["thanked_at"] is not None

        item = test_client.get("/api/admin/thank-you").json()["donors"][0]
        assert item["thanked_at"] is not None
        assert item["thanked_by_name"] is not None

    def test_mark_idempotent_refreshes_actor(self, test_client: TestClient, admin_user, db: Session):
        self._candidate(db)
        _login_admin(test_client)

        first = test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"}).json()
        time.sleep(0.01)
        second = test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"}).json()
        assert second["thanked_at"] >= first["thanked_at"]
        assert test_client.get("/api/admin/thank-you").json()["total"] == 1

    def test_mark_normalizes_email_case(self, test_client: TestClient, admin_user, db: Session):
        self._candidate(db, "Case@Test.com")
        _login_admin(test_client)

        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": " CASE@test.com "})
        assert resp.status_code == 200
        assert resp.json()["email"] == "case@test.com"
        item = test_client.get("/api/admin/thank-you").json()["donors"][0]
        assert item["thanked_at"] is not None

    def test_mark_404_for_unknown_email(self, test_client: TestClient, admin_user, db: Session):
        _login_admin(test_client)
        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": "ghost@test.com"})
        assert resp.status_code == 404

    def test_mark_general_only_candidate(self, test_client: TestClient, admin_user, db: Session):
        """The mark works for general-donation candidates (the list's other side)."""
        _payment(db, "gen-mark", "genmark@test.com", name="Gen Mark")
        _login_admin(test_client)

        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": "genmark@test.com"})
        assert resp.status_code == 200
        item = test_client.get("/api/admin/thank-you").json()["donors"][0]
        assert item["thanked_at"] is not None

    def test_mark_404_when_only_payment_matched(self, test_client: TestClient, admin_user, db: Session):
        """A payment matched to a live claim is not a general candidate —
        the mark's membership check matches the list's semantics."""
        donor = _donor(db, "matchedmark@test.com")
        fam = _family(db, "The Matchmarkeds")
        claim = _claim(db, donor, fam, commitment=CommitmentType.cash, fulfilled=NOW)
        claim.zeffy_payment_id = "pay-mmark"
        db.commit()
        _payment(db, "pay-mmark", "matched-buyer@test.com", amount_cents=60_000)
        _login_admin(test_client)

        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": "matched-buyer@test.com"})
        assert resp.status_code == 404

    def test_thanked_filter_roundtrip(self, test_client: TestClient, admin_user, db: Session):
        donor = _donor(db, "filter@test.com")
        _claim(db, donor, _family(db, "The Filters"), fulfilled=NOW)
        other = _donor(db, "other@test.com")
        _claim(db, other, _family(db, "The Others"), fulfilled=NOW)
        _login_admin(test_client)

        test_client.post("/api/admin/thank-you/thanked", json={"email": "filter@test.com"})

        thanked = test_client.get("/api/admin/thank-you", params={"thanked": "true"}).json()
        assert [d["email"] for d in thanked["donors"]] == ["filter@test.com"]
        unthanked = test_client.get("/api/admin/thank-you", params={"thanked": "false"}).json()
        assert [d["email"] for d in unthanked["donors"]] == ["other@test.com"]

    def test_sort_by_thanked_at(self, test_client: TestClient, admin_user, db: Session):
        self._candidate(db)
        other = _donor(db, "aaa@test.com")
        _claim(db, other, _family(db, "The Aaas"), fulfilled=NOW)
        _login_admin(test_client)

        test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"})
        desc = test_client.get("/api/admin/thank-you", params={"sort": "-thanked_at"}).json()["donors"]
        assert desc[0]["email"] == "mark@test.com"  # thanked first; unthanked (None) sorts last

    def test_unmark_clears_row(self, test_client: TestClient, admin_user, db: Session):
        self._candidate(db)
        _login_admin(test_client)

        test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"})
        resp = test_client.post("/api/admin/thank-you/unthanked", json={"email": "mark@test.com"})
        assert resp.status_code == 200
        assert resp.json() == {"email": "mark@test.com", "thanked_at": None}
        assert test_client.get("/api/admin/thank-you").json()["donors"][0]["thanked_at"] is None

    def test_unmark_404_without_row(self, test_client: TestClient, admin_user, db: Session):
        _login_admin(test_client)
        resp = test_client.post("/api/admin/thank-you/unthanked", json={"email": "mark@test.com"})
        assert resp.status_code == 404

    def test_mark_403_non_admin(self, test_client: TestClient, admin_user, referrer_user, db: Session):
        self._candidate(db)
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post("/api/admin/thank-you/thanked", json={"email": "mark@test.com"})
        assert resp.status_code == 403
