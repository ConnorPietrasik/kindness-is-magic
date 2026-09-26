"""Claim payment lifecycle tests: commitment toggles, cash guards, admin
mark-paid / restore, and the hourly expiry sweep.

The sweep is exercised via ``run_claim_expiry`` directly (the background
loop is disabled in tests via DISABLE_BACKGROUND_TASKS).
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    Deadline,
    DeadlineMode,
    DeadlineType,
    EmailKind,
    Family,
    FamilyClaim,
    FamilyVerificationStatus,
    Person,
    PersonRole,
    SentEmail,
    User,
    UserRole,
    Wish,
    WishLockLevel,
    WishType,
)
from app.payments import run_claim_expiry
from tests.conftest import login_as, make_family

DONOR_EMAIL = "lifedonor@test.com"
DONOR_PASSWORD = "DonorPass1234!"
PAST_DUE = "2020-01-01"


def _donor_id(db: Session) -> int:
    return db.query(User).filter(User.email == DONOR_EMAIL).first().id


def _eligible_family(db: Session, name: str) -> Family:
    fam = make_family(
        db,
        family_name=name,
        family_wish="Warm clothes",
        contact_name="Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    return fam


def _claim(db: Session, donor_id: int, family: Family, **kwargs) -> FamilyClaim:
    claim = FamilyClaim(donor_user_id=donor_id, family_id=family.id, **kwargs)
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def _gift_claim(db: Session, family: Family, **kwargs) -> FamilyClaim:
    return _claim(db, _donor_id(db), family, commitment_type=CommitmentType.gifts, **kwargs)


def _pending_cash_claim(db: Session, family: Family, **kwargs) -> FamilyClaim:
    return _claim(
        db,
        _donor_id(db),
        family,
        commitment_type=CommitmentType.cash,
        payment_status=ClaimPaymentStatus.pending,
        **kwargs,
    )


def _arm_gift_dropoff(db: Session) -> None:
    db.add(
        Deadline(
            type=DeadlineType.gift_dropoff,
            label="Gift drop-off",
            due_date=datetime.fromisoformat(PAST_DUE).date(),
            mode=DeadlineMode.enforced,
        )
    )
    db.commit()


def _sent_rows(db: Session, kind: EmailKind) -> list[SentEmail]:
    return db.query(SentEmail).filter(SentEmail.kind == kind, SentEmail.recipient_email == DONOR_EMAIL).order_by(SentEmail.sent_at).all()


# ---------------------------------------------------------------------------
# Commitment toggle (PATCH /api/donor/claims/{id})
# ---------------------------------------------------------------------------


class TestCommitmentToggle:
    def test_gifts_to_cash(self, test_client: TestClient, db: Session, admin_user):
        """gifts→cash: pending + fresh 48h window + "please pay" nudge."""
        _login_donor(test_client)
        fam = _eligible_family(db, "Toggle Family")
        claim = _gift_claim(db, fam)
        before = datetime.now(timezone.utc)

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "cash"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["commitment_type"] == "cash"
        assert body["payment_status"] == "pending"
        assert body["paid_at"] is None

        db.refresh(claim)
        assert claim.payment_status == ClaimPaymentStatus.pending
        assert claim.created_at >= before - timedelta(seconds=1)  # window restarted

        # The nudge went out (a one-item checkout)
        assert len(_sent_rows(db, EmailKind.payment_request)) == 1
        assert body.get("email_error") is None

    def test_cash_to_gifts(self, test_client: TestClient, db: Session, admin_user):
        """cash→gifts (pending): released (paid) + gift confirmation email."""
        _login_donor(test_client)
        fam = _eligible_family(db, "Release Family")
        claim = _pending_cash_claim(db, fam, includes_groceries=True)

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["commitment_type"] == "gifts"
        assert body["payment_status"] == "paid"
        assert body["includes_groceries"] is False

        db.refresh(claim)
        assert claim.paid_at is None
        assert claim.zeffy_payment_id is None

        # The donor never got a gift confirmation — one goes out now
        assert len(_sent_rows(db, EmailKind.claim_confirmation)) == 1

    def test_paid_cash_toggle_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Paid Family")
        claim = _claim(
            db,
            _donor_id(db),
            fam,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
            zeffy_payment_id="pay-x",
        )
        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert "unpaid" in resp.json()["detail"]

    def test_fulfilled_toggle_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Fulfilled Family")
        claim = _gift_claim(db, fam, fulfilled_at=datetime.now(timezone.utc))
        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "cash"})
        assert resp.status_code == 400

    def test_same_type_resend_is_noop(self, test_client: TestClient, db: Session, admin_user):
        """Re-sending the same type is a plain no-op — no email, no window restart."""
        _login_donor(test_client)
        fam = _eligible_family(db, "Same Type Family")
        claim = _pending_cash_claim(db, fam)
        original_created = claim.created_at

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "cash"})
        assert resp.status_code == 200

        db.refresh(claim)
        assert claim.created_at == original_created
        assert len(_sent_rows(db, EmailKind.payment_request)) == 0

    def test_toggle_also_applies_notes(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Notes Family")
        claim = _gift_claim(db, fam)

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "cash", "notes": "left at the door"})
        assert resp.status_code == 200
        assert resp.json()["notes"] == "left at the door"
        assert resp.json()["commitment_type"] == "cash"

    def test_cash_to_gifts_at_cap_rejected(self, test_client: TestClient, db: Session, admin_user):
        """A conversion is a new gift claim — the cap applies."""
        _login_donor(test_client)
        for i in range(5):
            _gift_claim(db, _eligible_family(db, f"Cap Family {i}"))
        cash_fam = _eligible_family(db, "Convert Family")
        claim = _pending_cash_claim(db, cash_fam)

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

        db.refresh(claim)
        assert claim.commitment_type == CommitmentType.cash  # unchanged

    def test_cash_to_gifts_deadline_armed_rejected(self, test_client: TestClient, db: Session, admin_user):
        """An armed gift_dropoff deadline blocks the conversion (same 400 as the claim endpoint)."""
        from app.deadlines import GIFT_CLAIM_BLOCKED_DETAIL

        _login_donor(test_client)
        _arm_gift_dropoff(db)
        fam = _eligible_family(db, "Armed Family")
        claim = _pending_cash_claim(db, fam)

        resp = test_client.patch(f"/api/donor/claims/{claim.id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == GIFT_CLAIM_BLOCKED_DETAIL


def _login_donor(test_client: TestClient) -> TestClient:
    test_client.post(
        "/api/auth/register-donor",
        json={"display_name": "Lifecycle Donor", "email": DONOR_EMAIL, "password": DONOR_PASSWORD},
    )
    login_as(test_client, DONOR_EMAIL, DONOR_PASSWORD)
    return test_client


# ---------------------------------------------------------------------------
# Cash claim guards
# ---------------------------------------------------------------------------


class TestCashGuards:
    def _family_with_wish(self, db: Session) -> Family:
        fam = _eligible_family(db, "Wish Family")
        person = Person(family_id=fam.id, given_name="Child", age=6, role=PersonRole.son)
        db.add(person)
        db.flush()
        wish = Wish(person_id=person.id, type=WishType.fun, description="A kite")
        db.add(wish)
        db.commit()
        return fam

    def test_mark_wish_purchased_cash_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = self._family_with_wish(db)
        claim = _pending_cash_claim(db, fam)
        wish = db.query(Wish).filter(Wish.family_id == fam.id).first()

        resp = test_client.post(f"/api/donor/claims/{claim.id}/wishes/{wish.id}/mark-purchased", json={"purchased_where": "Shop"})
        assert resp.status_code == 400
        assert "cash" in resp.json()["detail"].lower()

    def test_fulfill_unpaid_cash_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Unfulfillable Family")
        claim = _pending_cash_claim(db, fam)

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(f"/api/donor/claims/{claim.id}/fulfill")
        assert resp.status_code == 400
        assert "paid" in resp.json()["detail"].lower()

    def test_fulfill_paid_cash_ok(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Payable Family")
        claim = _claim(
            db,
            _donor_id(db),
            fam,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )

        login_as(test_client, "admin@test.com", "AdminPass123!")
        resp = test_client.post(f"/api/donor/claims/{claim.id}/fulfill")
        assert resp.status_code == 200
        assert resp.json()["fulfilled_at"] is not None


# ---------------------------------------------------------------------------
# Admin mark-paid
# ---------------------------------------------------------------------------


class TestAdminMarkPaid:
    def _admin(self, test_client: TestClient) -> None:
        login_as(test_client, "admin@test.com", "AdminPass123!")

    def test_mark_paid_default_no_confirmation_email(self, test_client: TestClient, db: Session, admin_user):
        """Flag off (default — Zeffy sends its own receipt): mark-paid pays the
        claim but sends no app confirmation email."""
        _login_donor(test_client)
        fam = _eligible_family(db, "No Email Family")
        claim = _pending_cash_claim(db, fam)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid")
        assert resp.status_code == 200

        db.refresh(claim)
        assert claim.payment_status == ClaimPaymentStatus.paid
        assert claim.paid_at is not None
        assert len(_sent_rows(db, EmailKind.payment_confirmed)) == 0

    def test_mark_paid_sends_confirmation(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.payments.SEND_PAYMENT_CONFIRMED_EMAIL", True)
        _login_donor(test_client)
        fam = _eligible_family(db, "Offline Family")
        claim = _pending_cash_claim(db, fam)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid")
        assert resp.status_code == 200
        body = resp.json()
        assert body["payment_status"] == "paid"
        assert body["paid_at"] is not None

        db.refresh(claim)
        assert claim.payment_status == ClaimPaymentStatus.paid
        assert claim.paid_at is not None
        assert len(_sent_rows(db, EmailKind.payment_confirmed)) == 1

    def test_mark_paid_stores_zeffy_payment_id(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Linked Family")
        claim = _pending_cash_claim(db, fam)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid", json={"zeffy_payment_id": "off-42"})
        assert resp.status_code == 200
        db.refresh(claim)
        assert claim.zeffy_payment_id == "off-42"

    def test_double_mark_paid_rejected_no_reemail(self, test_client: TestClient, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.payments.SEND_PAYMENT_CONFIRMED_EMAIL", True)
        _login_donor(test_client)
        fam = _eligible_family(db, "Double Family")
        claim = _pending_cash_claim(db, fam)

        self._admin(test_client)
        assert test_client.post(f"/api/donor/claims/{claim.id}/mark-paid").status_code == 200
        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid")
        assert resp.status_code == 400
        assert len(_sent_rows(db, EmailKind.payment_confirmed)) == 1

    def test_mark_paid_gift_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Gift Only Family")
        claim = _gift_claim(db, fam)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid")
        assert resp.status_code == 400
        assert "cash" in resp.json()["detail"].lower()

    def test_mark_paid_forbidden_for_donor(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Donor Scope Family")
        claim = _pending_cash_claim(db, fam)

        resp = test_client.post(f"/api/donor/claims/{claim.id}/mark-paid")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Admin restore (revive a soft-deleted unpaid cash claim)
# ---------------------------------------------------------------------------


class TestAdminRestore:
    def _admin(self, test_client: TestClient) -> None:
        login_as(test_client, "admin@test.com", "AdminPass123!")

    def test_restore_expired_claim(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Expired Family")
        lapsed = datetime.now(timezone.utc) - timedelta(hours=73)
        claim = _pending_cash_claim(db, fam)
        claim.deleted_at = lapsed
        claim.created_at = lapsed
        db.commit()

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/restore")
        assert resp.status_code == 200
        body = resp.json()
        assert body["payment_status"] == "pending"

        db.refresh(claim)
        assert claim.deleted_at is None
        assert claim.created_at >= datetime.now(timezone.utc) - timedelta(seconds=5)  # fresh window

        # The family is hidden from the public list again (the reservation is back)
        data = test_client.get("/api/families").json()
        assert all(f["id"] != fam.id for f in data["families"])

    def test_restore_reclaimed_family_conflict(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Reclaimed Family")
        claim = _pending_cash_claim(db, fam)
        claim.deleted_at = datetime.now(timezone.utc)
        db.commit()

        # Someone else claimed the family in the meantime
        from app.auth import get_password_hash
        from app.models import UserRole

        other = User(email="late@test.com", hashed_password=get_password_hash("LatePass1234!"), role=UserRole.donor, display_name=None)
        db.add(other)
        db.commit()
        _claim(db, other.id, fam, commitment_type=CommitmentType.gifts)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/restore")
        assert resp.status_code == 409

        db.refresh(claim)
        assert claim.deleted_at is not None  # still soft-deleted

    def test_restore_non_cash_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Gift Deleted Family")
        claim = _gift_claim(db, fam)
        claim.deleted_at = datetime.now(timezone.utc)
        db.commit()

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/restore")
        assert resp.status_code == 400

    def test_restore_paid_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Paid Deleted Family")
        claim = _claim(
            db,
            _donor_id(db),
            fam,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )
        claim.deleted_at = datetime.now(timezone.utc)
        db.commit()

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/restore")
        assert resp.status_code == 400

    def test_restore_active_claim_rejected(self, test_client: TestClient, db: Session, admin_user):
        _login_donor(test_client)
        fam = _eligible_family(db, "Active Family")
        claim = _pending_cash_claim(db, fam)

        self._admin(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim.id}/restore")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Expiry sweep (run_claim_expiry — the hourly cycle, exercised directly)
# ---------------------------------------------------------------------------


class TestExpirySweep:
    async def test_lapsed_pending_cash_swept_and_emailed(self, db: Session):
        """A lapsed pending cash claim is soft-deleted + its donor emailed;
        the family is free again in the public list."""
        from app.auth import get_password_hash

        # A donor with no login needed — the sweep emails directly
        donor = User(email="swept@test.com", hashed_password=get_password_hash("SweptPass1234!"), role=UserRole.donor, display_name="Swept")
        db.add(donor)
        db.flush()
        fam = _eligible_family(db, "Sweep Family")
        lapsed = datetime.now(timezone.utc) - timedelta(hours=73)
        claim = FamilyClaim(
            donor_user_id=donor.id, family_id=fam.id, commitment_type=CommitmentType.cash, payment_status=ClaimPaymentStatus.pending
        )
        db.add(claim)
        db.commit()
        claim.created_at = lapsed
        db.commit()
        db.refresh(claim)

        swept = await run_claim_expiry(db)

        assert swept == 1
        db.refresh(claim)
        assert claim.deleted_at is not None

        # The expiry email went out with the reassurance line
        rows = db.query(SentEmail).filter(SentEmail.recipient_email == "swept@test.com", SentEmail.kind == EmailKind.payment_expired).all()
        assert len(rows) == 1
        assert rows[0].status.value == "sent"

    async def test_within_window_not_swept(self, db: Session):
        from app.auth import get_password_hash

        donor = User(
            email="window@test.com", hashed_password=get_password_hash("WindowPass1234!"), role=UserRole.donor, display_name="Window"
        )
        db.add(donor)
        db.flush()
        fam = _eligible_family(db, "Window Family")
        claim = FamilyClaim(
            donor_user_id=donor.id, family_id=fam.id, commitment_type=CommitmentType.cash, payment_status=ClaimPaymentStatus.pending
        )
        db.add(claim)
        db.commit()
        claim.created_at = datetime.now(timezone.utc) - timedelta(hours=1)  # inside 48h
        db.commit()

        assert await run_claim_expiry(db) == 0
        db.refresh(claim)
        assert claim.deleted_at is None

    async def test_gift_and_paid_claims_never_swept(self, db: Session):
        from app.auth import get_password_hash

        donor = User(email="mixed@test.com", hashed_password=get_password_hash("MixedPass1234!"), role=UserRole.donor, display_name="Mixed")
        db.add(donor)
        db.flush()
        lapsed = datetime.now(timezone.utc) - timedelta(hours=100)

        fam1 = _eligible_family(db, "Gift Family")
        fam2 = _eligible_family(db, "Paid Family")
        gift = FamilyClaim(donor_user_id=donor.id, family_id=fam1.id, commitment_type=CommitmentType.gifts)
        paid = FamilyClaim(
            donor_user_id=donor.id,
            family_id=fam2.id,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.paid,
            paid_at=datetime.now(timezone.utc),
        )
        db.add_all([gift, paid])
        db.commit()
        gift.created_at = lapsed
        paid.created_at = lapsed
        db.commit()

        assert await run_claim_expiry(db) == 0
        db.refresh(gift)
        db.refresh(paid)
        assert gift.deleted_at is None
        assert paid.deleted_at is None

    async def test_just_paid_claim_not_swept(self, db: Session):
        """The conditional UPDATE re-checks the WHERE: a claim paid in the
        same instant is never swept (no select-then-delete race)."""
        from app.auth import get_password_hash

        donor = User(email="race@test.com", hashed_password=get_password_hash("RacePass1234!"), role=UserRole.donor, display_name="Race")
        db.add(donor)
        db.flush()
        fam = _eligible_family(db, "Race Family")
        lapsed = datetime.now(timezone.utc) - timedelta(hours=100)
        claim = FamilyClaim(
            donor_user_id=donor.id, family_id=fam.id, commitment_type=CommitmentType.cash, payment_status=ClaimPaymentStatus.pending
        )
        db.add(claim)
        db.commit()
        claim.created_at = lapsed
        db.commit()

        # "Payment lands" before the sweep's UPDATE runs
        claim.payment_status = ClaimPaymentStatus.paid
        claim.paid_at = datetime.now(timezone.utc)
        claim.zeffy_payment_id = "pay-race"
        db.commit()

        assert await run_claim_expiry(db) == 0
        db.refresh(claim)
        assert claim.deleted_at is None
