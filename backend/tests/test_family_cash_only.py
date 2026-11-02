"""Tests for the admin cash-only family lock ("already shopping").

Covers the admin write path (set/clear/no-op), self-service ignoring the
field, the gift-claim gate (every claim-capable role), the cash→gifts
conversion gate, the unaffected cash paths, and the public reads.
"""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.deadlines import CASH_ONLY_GIFT_BLOCKED_DETAIL, GIFT_CLAIM_BLOCKED_DETAIL
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    Deadline,
    DeadlineMode,
    DeadlineType,
    Family,
    FamilyClaim,
    FamilyVerificationStatus,
    Referrer,
    ReferrerApprovalStatus,
    User,
    WishLockLevel,
)
from tests.conftest import login_as, make_family

ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "AdminPass123!"
ROLE_PASSWORD = "RolePass1234!"
PAST_DUE = "2020-01-01"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, ADMIN_EMAIL, ADMIN_PASSWORD)


def _create_user(client: TestClient, email: str, role: str) -> None:
    resp = client.post("/api/admin/users", json={"email": email, "password": ROLE_PASSWORD, "role": role})
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"


def _claimable_family(db: Session, name: str = "Claimable Family") -> Family:
    """Verified, admin-locked family — fully claimable."""
    fam = make_family(
        db,
        family_name=name,
        family_wish="A warm coat",
        contact_name="Claim Contact",
        phone_number="555-000-0003",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)
    return fam


def _set_cash_only(client: TestClient, fam: Family, value: bool) -> None:
    resp = client.patch(f"/api/admin/families/{fam.id}", json={"cash_only": value})
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.json()}"
    assert resp.json()["cash_only"] is value


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


# =========================================================================
# Admin write path
# =========================================================================


class TestAdminWrite:
    def test_admin_sets_and_clears_cash_only(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _claimable_family(db, "Toggle Family")

        assert fam.cash_only is False
        _set_cash_only(test_client, fam, True)
        db.refresh(fam)
        assert fam.cash_only is True

        # The detail endpoint reflects the flag
        resp = test_client.get(f"/api/admin/families/{fam.id}")
        assert resp.status_code == 200
        assert resp.json()["cash_only"] is True

        _set_cash_only(test_client, fam, False)
        db.refresh(fam)
        assert fam.cash_only is False

    def test_omitted_cash_only_is_noop(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _claimable_family(db, "Noop Family")
        _set_cash_only(test_client, fam, True)

        # An update of other fields without cash_only leaves it untouched
        resp = test_client.patch(f"/api/admin/families/{fam.id}", json={"bio": "Updated bio"})
        assert resp.status_code == 200
        db.refresh(fam)
        assert fam.cash_only is True
        assert fam.bio == "Updated bio"

    def test_admin_list_includes_cash_only(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _claimable_family(db, "Listed Cash Family")
        _set_cash_only(test_client, fam, True)

        resp = test_client.get("/api/admin/families", params={"columns": "id,cash_only", "search_name": "Listed Cash Family"})
        assert resp.status_code == 200
        items = resp.json()["families"]
        assert len(items) == 1
        assert items[0]["cash_only"] is True

        # Not requested → the column filter trims it (FamilyDetail defaults the field)
        resp = test_client.get("/api/admin/families", params={"columns": "id", "search_name": "Listed Cash Family"})
        assert resp.status_code == 200
        assert "cash_only" not in resp.json()["families"][0]

    def test_admin_create_with_cash_only(self, test_client: TestClient, db: Session, admin_user):
        """The admin create form's "Cash only" checkbox must stick."""
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "family_name": "Created Cash Family",
                "family_wish": "A warm coat",
                "contact_name": "Create Contact",
                "address": "1 Create Lane",
                "phone_number": "555-000-0010",
                "cash_only": True,
            },
        )
        assert resp.status_code == 201, resp.json()
        assert resp.json()["cash_only"] is True
        fam = db.query(Family).filter(Family.family_name == "Created Cash Family").first()
        assert fam.cash_only is True

    def test_admin_create_without_cash_only_defaults_false(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "family_name": "Created Open Family",
                "family_wish": "A warm coat",
                "contact_name": "Create Contact",
                "address": "2 Create Lane",
                "phone_number": "555-000-0011",
            },
        )
        assert resp.status_code == 201, resp.json()
        assert resp.json()["cash_only"] is False


# =========================================================================
# Create paths ignore the field (admin-write only)
# =========================================================================


class TestCreatePathsAdminWriteOnly:
    def test_referrer_create_ignores_cash_only(self, test_client: TestClient, db: Session, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "Referrer Created Cash",
                "family_wish": "A warm coat",
                "contact_name": "Ref Create Contact",
                "address": "3 Create Lane",
                "phone_number": "555-000-0012",
                "cash_only": True,
            },
        )
        assert resp.status_code == 201, resp.json()  # extra field is ignored, not 422
        fam = db.query(Family).filter(Family.family_name == "Referrer Created Cash").first()
        assert fam.cash_only is False


# =========================================================================
# Self-service ignores the field (admin-write only)
# =========================================================================


class TestSelfServiceIgnored:
    def test_referrer_update_ignores_cash_only(self, test_client: TestClient, db: Session, referrer_user, referrer_with_families):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        fam = referrer_with_families["families"][0]

        resp = test_client.patch(f"/api/referrer/families/{fam.id}", json={"cash_only": True})
        assert resp.status_code == 200  # extra field is ignored, not 422
        db.refresh(fam)
        assert fam.cash_only is False

    def test_family_self_update_ignores_cash_only(self, test_client: TestClient, db: Session, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")

        resp = test_client.patch("/api/family/me", json={"cash_only": True})
        assert resp.status_code == 200
        fam = db.query(Family).filter(Family.id == family_user.family_id).first()
        assert fam.cash_only is False


# =========================================================================
# Gift-claim gate
# =========================================================================


class TestGiftClaimGate:
    @pytest.mark.parametrize("role", ["donor", "referrer", "purchaser", "admin"])
    def test_blocks_every_claim_capable_role(self, test_client: TestClient, db: Session, admin_user, role: str):
        """The gate is a business rule, not a permission — admin included."""
        _admin_login(test_client)
        fam = _claimable_family(db)
        _set_cash_only(test_client, fam, True)

        if role == "admin":
            pass  # already logged in as admin
        elif role == "referrer":
            ref = Referrer(
                name="CashOnly Referrer",
                family_limit=5,
                phone_number="555-400-4000",
                family_invite_code="KFI-CASH01",
                approval_status=ReferrerApprovalStatus.approved,
            )
            db.add(ref)
            db.commit()
            db.refresh(ref)
            resp = test_client.post(
                "/api/admin/users",
                json={"email": f"{role}@test.com", "password": ROLE_PASSWORD, "role": role, "referrer_id": ref.id},
            )
            assert resp.status_code == 201, resp.json()
        else:
            _create_user(test_client, f"{role}@test.com", role)

        if role != "admin":
            login_as(test_client, f"{role}@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == CASH_ONLY_GIFT_BLOCKED_DETAIL

        # No claim was created by the blocked attempt.
        claim = db.query(FamilyClaim).filter(FamilyClaim.family_id == fam.id).first()
        assert claim is None

    def test_gift_claim_allowed_on_non_cash_only_family(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _claimable_family(db, "Open Family")

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201

    def test_unlocking_reopens_gift_claims(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _claimable_family(db, "Unlock Family")
        _set_cash_only(test_client, fam, True)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400

        _set_cash_only(test_client, fam, False)
        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201

    def test_deadline_gate_message_wins_when_both_apply(self, test_client: TestClient, db: Session, admin_user):
        """Both the armed deadline and cash-only block gifts — the deadline
        message wins (its gate runs first)."""
        _admin_login(test_client)
        fam = _claimable_family(db, "Both Armed Family")
        _set_cash_only(test_client, fam, True)
        _arm_gift_dropoff(db)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == GIFT_CLAIM_BLOCKED_DETAIL


# =========================================================================
# Cash paths stay open
# =========================================================================


class TestCashPathsUnaffected:
    @pytest.mark.parametrize("role", ["admin", "referrer"])
    def test_recovery_cash_claim_allowed(self, test_client: TestClient, db: Session, admin_user, role: str):
        _admin_login(test_client)
        fam = _claimable_family(db, f"Recovery {role} Family")
        _set_cash_only(test_client, fam, True)

        if role == "referrer":
            login_as(test_client, "referrer@test.com", "RefPass1234!")
        # Admin recovery cash claim on a cash-only family succeeds.
        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "cash"})
        assert resp.status_code == 201
        assert resp.json()["commitment_type"] == "cash"

    def test_gifts_to_cash_toggle_allowed_after_lock(self, test_client: TestClient, db: Session, admin_user):
        """A gift claim made before the lock can still convert to cash."""
        fam = _claimable_family(db, "Convert Family")
        donor_email = "convertor@test.com"
        resp = test_client.post(
            "/api/auth/register-donor", json={"display_name": "Convertor", "email": donor_email, "password": ROLE_PASSWORD}
        )
        assert resp.status_code in (200, 201), resp.json()
        login_as(test_client, donor_email, ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201
        claim_id = resp.json()["id"]

        _admin_login(test_client)
        _set_cash_only(test_client, fam, True)

        login_as(test_client, donor_email, ROLE_PASSWORD)
        resp = test_client.patch(f"/api/donor/claims/{claim_id}", json={"commitment_type": "cash"})
        assert resp.status_code == 200
        assert resp.json()["commitment_type"] == "cash"
        assert resp.json()["payment_status"] == "pending"


# =========================================================================
# Cash→gifts conversion gate
# =========================================================================


class TestCashToGiftsGate:
    def _pending_cash_claim_for(self, db: Session, donor_email: str, fam: Family) -> int:
        """A pending cash claim owned by the donor (mirrors a cart checkout)."""
        donor_id = db.query(User).filter(User.email == donor_email).first().id
        claim = FamilyClaim(
            donor_user_id=donor_id,
            family_id=fam.id,
            commitment_type=CommitmentType.cash,
            payment_status=ClaimPaymentStatus.pending,
        )
        db.add(claim)
        db.commit()
        db.refresh(claim)
        return claim.id

    def test_cash_to_gifts_blocked_on_cash_only_family(self, test_client: TestClient, db: Session, admin_user):
        fam = _claimable_family(db, "Convert Blocked Family")
        donor_email = "cashconvert@test.com"
        resp = test_client.post(
            "/api/auth/register-donor", json={"display_name": "Cash Convert", "email": donor_email, "password": ROLE_PASSWORD}
        )
        assert resp.status_code in (200, 201), resp.json()

        claim_id = self._pending_cash_claim_for(db, donor_email, fam)
        _admin_login(test_client)
        _set_cash_only(test_client, fam, True)

        login_as(test_client, donor_email, ROLE_PASSWORD)
        resp = test_client.patch(f"/api/donor/claims/{claim_id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == CASH_ONLY_GIFT_BLOCKED_DETAIL

        # The claim is unchanged
        claim = db.query(FamilyClaim).filter(FamilyClaim.id == claim_id).first()
        db.refresh(claim)
        assert claim.commitment_type.value == "cash"
        assert claim.payment_status.value == "pending"

    def test_cash_to_gifts_allowed_on_non_cash_only_family(self, test_client: TestClient, db: Session, admin_user):
        """Control: the conversion still works on an unlocked family."""
        fam = _claimable_family(db, "Convert Open Family")
        donor_email = "cashconvert2@test.com"
        resp = test_client.post(
            "/api/auth/register-donor", json={"display_name": "Cash Convert 2", "email": donor_email, "password": ROLE_PASSWORD}
        )
        assert resp.status_code in (200, 201), resp.json()

        claim_id = self._pending_cash_claim_for(db, donor_email, fam)

        login_as(test_client, donor_email, ROLE_PASSWORD)
        resp = test_client.patch(f"/api/donor/claims/{claim_id}", json={"commitment_type": "gifts"})
        assert resp.status_code == 200
        assert resp.json()["commitment_type"] == "gifts"


# =========================================================================
# Public reads
# =========================================================================


class TestPublicReads:
    def test_public_list_carries_cash_only(self, test_client: TestClient, db: Session):
        locked = _claimable_family(db, "Public Locked Family")
        open_fam = _claimable_family(db, "Public Open Family")
        locked.cash_only = True
        db.commit()

        resp = test_client.get("/api/families")
        assert resp.status_code == 200
        by_id = {f["id"]: f for f in resp.json()["families"]}
        assert by_id[locked.id]["cash_only"] is True
        assert by_id[open_fam.id]["cash_only"] is False

    def test_wish_list_carries_cash_only(self, test_client: TestClient, db: Session):
        fam = _claimable_family(db, "WishList Locked Family")
        fam.cash_only = True
        db.commit()

        resp = test_client.get(f"/api/families/{fam.id}/wish-list")
        assert resp.status_code == 200
        assert resp.json()["cash_only"] is True
