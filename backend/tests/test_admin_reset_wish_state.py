"""Tests for admin reset-wish-state endpoint.

POST /api/admin/families/{fam_id}/reset-wish-state resets a family's wish
state back to family-editable, clearing review metadata.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

from app.models import (
    Family,
    FamilyApprovalStatus,
    Referrer,
    ReferrerApprovalStatus,
    WishLockLevel,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def locked_family(db: Session):
    """Create a family at various lock levels for reset testing."""
    ref = Referrer(
        name="Reset Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-RSET01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Reset Family",
        family_wish="Toys",
        contact_name="Reset Contact",
        phone_number="555-000-0002",
        approval_status=FamilyApprovalStatus.approved,
        wish_lock_level=WishLockLevel.family,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    return {"referrer": ref, "family": fam}


@pytest.fixture()
def referrer_locked_family_with_review(db: Session):
    """Family at referrer lock with a pending review request."""
    ref = Referrer(
        name="Review Referrer",
        family_limit=10,
        phone_number="555-000-0011",
        family_invite_code="KFI-RVW01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Review Family",
        family_wish="Clothes",
        contact_name="Review Contact",
        phone_number="555-000-0012",
        approval_status=FamilyApprovalStatus.approved,
        wish_lock_level=WishLockLevel.referrer,
        wish_review_requested_at=datetime.now(timezone.utc),
        wish_rejection_reason=None,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    return {"referrer": ref, "family": fam}


@pytest.fixture()
def admin_locked_family(db: Session):
    """Family at admin lock (fully approved)."""
    ref = Referrer(
        name="AdminLock Referrer",
        family_limit=10,
        phone_number="555-000-0021",
        family_invite_code="KFI-ADML01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="AdminLock Family",
        family_wish="Books",
        contact_name="AdminLock Contact",
        phone_number="555-000-0022",
        approval_status=FamilyApprovalStatus.approved,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    return {"referrer": ref, "family": fam}


# =========================================================================
# Reset wish state — POST /api/admin/families/{fam_id}/reset-wish-state
# =========================================================================


class TestAdminResetWishState:
    def test_200_resets_referrer_locked_family(self, test_client: TestClient, admin_user, referrer_locked_family_with_review):
        """Reset clears lock level and review metadata on a referrer-locked family."""
        fam = referrer_locked_family_with_review["family"]
        assert fam.wish_lock_level == WishLockLevel.referrer
        assert fam.wish_review_requested_at is not None

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{fam.id}/reset-wish-state")
        assert resp.status_code == 200
        body = resp.json()
        assert body["wish_lock_level"] == WishLockLevel.family
        assert body["wish_review_requested_at"] is None
        assert body["wish_rejection_reason"] is None

    def test_200_resets_admin_locked_family(self, test_client: TestClient, admin_user, admin_locked_family):
        """Reset clears admin lock back to family-editable."""
        fam = admin_locked_family["family"]
        assert fam.wish_lock_level == WishLockLevel.admin

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{fam.id}/reset-wish-state")
        assert resp.status_code == 200
        body = resp.json()
        assert body["wish_lock_level"] == WishLockLevel.family

    def test_200_resets_already_family_locked(self, test_client: TestClient, admin_user, locked_family):
        """Reset on an already family-locked family is a no-op (still succeeds)."""
        fam = locked_family["family"]
        assert fam.wish_lock_level == WishLockLevel.family

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{fam.id}/reset-wish-state")
        assert resp.status_code == 200
        body = resp.json()
        assert body["wish_lock_level"] == WishLockLevel.family

    def test_clears_rejection_reason(self, test_client: TestClient, admin_user, referrer_locked_family_with_review, db: Session):
        """Reset clears any existing rejection reason."""
        fam = referrer_locked_family_with_review["family"]
        fam.wish_rejection_reason = "Needs more details"
        db.commit()

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{fam.id}/reset-wish-state")
        assert resp.status_code == 200
        body = resp.json()
        assert body["wish_rejection_reason"] is None

    def test_db_state_updated(self, test_client: TestClient, admin_user, referrer_locked_family_with_review, db: Session):
        """Verify the DB row is actually updated (not just the response)."""
        fam = referrer_locked_family_with_review["family"]

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{fam.id}/reset-wish-state")
        assert resp.status_code == 200

        db.expire_all()
        db.refresh(fam)
        assert fam.wish_lock_level == WishLockLevel.family
        assert fam.wish_review_requested_at is None
        assert fam.wish_rejection_reason is None

    def test_404_family_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post("/api/admin/families/99999/reset-wish-state")
        assert resp.status_code == 404

    def test_404_soft_deleted_family(self, test_client: TestClient, admin_user, locked_family, db: Session):
        """Soft-deleted family returns 404."""
        locked_family["family"].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/families/{locked_family['family'].id}/reset-wish-state")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, locked_family):
        resp = test_client.post(f"/api/admin/families/{locked_family['family'].id}/reset-wish-state")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user, locked_family):
        """Non-admin users cannot reset wish state."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(f"/api/admin/families/{locked_family['family'].id}/reset-wish-state")
        assert resp.status_code == 403
