"""Tests for the three-tier wish approval workflow."""

import pytest
from datetime import datetime, timezone

from app.models import Family, FamilyApprovalStatus, Person, Referrer, ReferrerApprovalStatus, User, UserRole, Wish, WishType
from app.auth import get_password_hash


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def admin(db):
    user = User(
        email="admin@test.com",
        hashed_password=get_password_hash("AdminPass123!"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def referrer(db):
    r = Referrer(
        name="Test Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-TEST01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture()
def referrer_user(db, referrer):
    user = User(
        email="referrer@test.com",
        hashed_password=get_password_hash("RefPass1234!"),
        role=UserRole.referrer,
        referrer_id=referrer.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def family(db, referrer):
    f = Family(
        referrer_id=referrer.id,
        family_name="Test Family",
        family_wish="World peace",
        contact_name="Contact Person",
        phone_number="555-000-0000",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@pytest.fixture()
def family_user(db, family):
    user = User(
        email="family@test.com",
        hashed_password=get_password_hash("FamPass1234!"),
        role=UserRole.family,
        family_id=family.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def person_in_family(db, family):
    p = Person(
        family_id=family.id,
        given_name="Alice",
        age=10,
    )
    db.add(p)
    db.flush()
    w1 = Wish(person_id=p.id, type=WishType.practical, description="A backpack")
    w2 = Wish(person_id=p.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture()
def second_family(db, referrer):
    f = Family(
        referrer_id=referrer.id,
        family_name="Second Family",
        family_wish="Warm clothes",
        contact_name="Second Contact",
        phone_number="555-000-0002",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@pytest.fixture()
def another_referrer(db):
    r = Referrer(
        name="Another Referrer",
        family_limit=10,
        phone_number="555-100-1000",
        family_invite_code="KFI-ANOT01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture()
def another_referrer_user(db, another_referrer):
    user = User(
        email="another_referrer@test.com",
        hashed_password=get_password_hash("AnotherRef1234!"),
        role=UserRole.referrer,
        referrer_id=another_referrer.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def family_for_another_referrer(db, another_referrer):
    f = Family(
        referrer_id=another_referrer.id,
        family_name="Another Family",
        family_wish="A computer",
        contact_name="Another Contact",
        phone_number="555-200-2000",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


# ---------------------------------------------------------------------------
# 1. Family request/cancel review
# ---------------------------------------------------------------------------


class TestFamilyRequestCancelReview:
    def test_family_can_request_review(self, test_client, family_user, family):
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.post("/api/family/me/request-review")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "family"
        assert data["wish_review_requested_at"] is not None
        assert data["wish_rejection_reason"] is None

    def test_family_cannot_request_review_twice(self, test_client, family_user, family):
        _login(test_client, family_user.email, "FamPass1234!")
        test_client.post("/api/family/me/request-review")
        resp = test_client.post("/api/family/me/request-review")
        assert resp.status_code == 400

    def test_family_can_cancel_review(self, test_client, family_user, family):
        _login(test_client, family_user.email, "FamPass1234!")
        test_client.post("/api/family/me/request-review")
        resp = test_client.post("/api/family/me/cancel-review")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_review_requested_at"] is None

    def test_family_cannot_cancel_without_pending_request(self, test_client, family_user, family):
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.post("/api/family/me/cancel-review")
        assert resp.status_code == 400

    def test_request_review_clears_stale_rejection(self, test_client, family_user, family, db):
        family.wish_rejection_reason = "Old reason"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.post("/api/family/me/request-review")
        assert resp.status_code == 200
        assert resp.json()["wish_rejection_reason"] is None


# ---------------------------------------------------------------------------
# 2. Lock enforcement on family edits
# ---------------------------------------------------------------------------


class TestFamilyLockEnforcement:
    def test_family_can_edit_when_unlocked(self, test_client, family_user, family):
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.patch("/api/family/me", json={"family_name": "Updated Family"})
        assert resp.status_code == 200
        assert resp.json()["family_name"] == "Updated Family"

    def test_family_cannot_edit_at_referrer_lock(self, test_client, family_user, family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.patch("/api/family/me", json={"family_name": "Updated Family"})
        assert resp.status_code == 403

    def test_family_cannot_edit_at_admin_lock(self, test_client, family_user, family, db):
        family.wish_lock_level = "admin"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.patch("/api/family/me", json={"family_name": "Updated Family"})
        assert resp.status_code == 403

    def test_family_cannot_create_person_when_locked(self, test_client, family_user, family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "Bob",
                "age": 5,
                "wishes": [{"type": "practical", "description": "Shoes"}, {"type": "fun", "description": "Ball"}],
            },
        )
        assert resp.status_code == 403

    def test_family_cannot_update_person_when_locked(self, test_client, family_user, family, person_in_family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.patch(f"/api/people/{person_in_family.id}", json={"given_name": "Bob"})
        assert resp.status_code == 403

    def test_family_cannot_delete_person_when_locked(self, test_client, family_user, family, person_in_family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        _login(test_client, family_user.email, "FamPass1234!")
        resp = test_client.delete(f"/api/people/{person_in_family.id}")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 3. Referrer approve/reject
# ---------------------------------------------------------------------------


class TestReferrerApproveReject:
    def test_referrer_can_approve_wishes(self, test_client, referrer_user, family, db):
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.post(f"/api/referrer/families/{family.id}/approve-wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "referrer"
        assert data["wish_review_requested_at"] is not None

    def test_referrer_can_reject_wishes(self, test_client, referrer_user, family, db):
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.post(
            f"/api/referrer/families/{family.id}/reject-wishes",
            json={"reason": "Wishes need more detail"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "family"
        assert data["wish_review_requested_at"] is None
        assert data["wish_rejection_reason"] == "Wishes need more detail"

    def test_referrer_cannot_act_on_another_referrer_family(self, test_client, another_referrer_user, family):
        _login(test_client, another_referrer_user.email, "AnotherRef1234!")
        resp = test_client.post(f"/api/referrer/families/{family.id}/approve-wishes")
        assert resp.status_code in (403, 404)

    def test_referrer_approve_without_request(self, test_client, referrer_user, family, db):
        """Referrer can approve wishes on any family at lock=family (no requested_at needed)."""
        family.wish_review_requested_at = None
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.post(f"/api/referrer/families/{family.id}/approve-wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "referrer"
        assert data["wish_review_requested_at"] is not None


# ---------------------------------------------------------------------------
# 4. Admin approve/reject
# ---------------------------------------------------------------------------


class TestAdminApproveReject:
    def test_admin_can_approve_wishes(self, test_client, admin, family, db):
        family.wish_lock_level = "referrer"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.post(f"/api/admin/families/{family.id}/approve-wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "admin"
        assert data["wish_review_requested_at"] is None

    def test_admin_can_reject_wishes(self, test_client, admin, family, db):
        family.wish_lock_level = "referrer"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.post(
            f"/api/admin/families/{family.id}/reject-wishes",
            json={"reason": "Please add more details"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "referrer"
        assert data["wish_review_requested_at"] is None
        assert data["wish_rejection_reason"] == "Please add more details"

    def test_admin_cannot_approve_at_wrong_lock(self, test_client, admin, family, db):
        family.wish_lock_level = "family"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.post(f"/api/admin/families/{family.id}/approve-wishes")
        assert resp.status_code == 400

    def test_admin_cannot_reject_at_wrong_lock(self, test_client, admin, family, db):
        family.wish_lock_level = "family"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.post(
            f"/api/admin/families/{family.id}/reject-wishes",
            json={"reason": "No"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 5. Referrer approve without prior family request (covered above)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 6. Referrer re-submit after admin rejection
# ---------------------------------------------------------------------------


class TestReferrerResubmitAfterAdminRejection:
    def test_referrer_can_resubmit_after_admin_rejection(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "referrer"
        family.wish_rejection_reason = "Admin said no"
        family.wish_review_requested_at = None
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.post(f"/api/referrer/families/{family.id}/approve-wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wish_lock_level"] == "referrer"
        assert data["wish_review_requested_at"] is not None
        assert data["wish_rejection_reason"] is None


# ---------------------------------------------------------------------------
# 7. Lock enforcement on referrer edits
# ---------------------------------------------------------------------------


class TestReferrerLockEnforcement:
    def test_referrer_can_edit_at_family_lock(self, test_client, referrer_user, family):
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.patch(f"/api/referrer/families/{family.id}", json={"family_name": "Updated"})
        assert resp.status_code == 200

    def test_referrer_can_edit_at_referrer_lock(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.patch(f"/api/referrer/families/{family.id}", json={"family_name": "Updated"})
        assert resp.status_code == 200

    def test_referrer_cannot_edit_at_admin_lock(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "admin"
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.patch(f"/api/referrer/families/{family.id}", json={"family_name": "Updated"})
        assert resp.status_code == 403

    def test_referrer_cannot_delete_at_admin_lock(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "admin"
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.delete(f"/api/referrer/families/{family.id}")
        assert resp.status_code == 403

    def test_referrer_cannot_create_person_at_admin_lock(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "admin"
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.post(
            f"/api/referrer/families/{family.id}/people",
            json={
                "given_name": "Bob",
                "age": 5,
                "wishes": [{"type": "practical", "description": "Shoes"}, {"type": "fun", "description": "Ball"}],
            },
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 8. Lock enforcement on admin edits (no backend restriction)
# ---------------------------------------------------------------------------


class TestAdminLockEnforcement:
    def test_admin_can_edit_at_all_lock_levels(self, test_client, admin, family, db):
        _login(test_client, admin.email, "AdminPass123!")
        for lock_level in ("family", "referrer", "admin"):
            family.wish_lock_level = lock_level
            db.commit()
            resp = test_client.patch(f"/api/admin/families/{family.id}", json={"family_name": f"Updated at {lock_level}"})
            assert resp.status_code == 200, f"Admin should be able to edit at lock_level={lock_level}"


# ---------------------------------------------------------------------------
# 9. Review queue endpoints
# ---------------------------------------------------------------------------


class TestReviewQueues:
    def test_referrer_queue_shows_only_their_families(self, test_client, referrer_user, family, second_family, db):
        family.wish_review_requested_at = datetime.now(timezone.utc)
        second_family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.get("/api/referrer/review-queue")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        ids = {item["id"] for item in data}
        assert ids == {family.id, second_family.id}

    def test_referrer_queue_empty_when_no_requests(self, test_client, referrer_user, family):
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.get("/api/referrer/review-queue")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_referrer_queue_excludes_non_family_lock(self, test_client, referrer_user, family, db):
        family.wish_lock_level = "referrer"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, referrer_user.email, "RefPass1234!")
        resp = test_client.get("/api/referrer/review-queue")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_admin_queue_shows_referrer_locked_families(self, test_client, admin, family, db):
        family.wish_lock_level = "referrer"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.get("/api/admin/families/review-queue")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == family.id

    def test_admin_queue_excludes_family_lock(self, test_client, admin, family, db):
        family.wish_lock_level = "family"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.get("/api/admin/families/review-queue")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_admin_queue_empty_when_no_requests(self, test_client, admin, family):
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.get("/api/admin/families/review-queue")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_review_queue_includes_referrer_name(self, test_client, admin, family, db):
        family.wish_lock_level = "referrer"
        family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        _login(test_client, admin.email, "AdminPass123!")
        resp = test_client.get("/api/admin/families/review-queue")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["referrer_name"] == "Test Referrer"


# ---------------------------------------------------------------------------
# 10. Public wish list filtering
# ---------------------------------------------------------------------------


class TestPublicWishListFiltering:
    def test_only_admin_locked_families_appear(self, test_client, family):
        resp = test_client.get(f"/api/families/{family.id}/wish-list")
        assert resp.status_code == 404

    def test_admin_locked_family_is_visible(self, test_client, family, db):
        family.wish_lock_level = "admin"
        db.commit()
        resp = test_client.get(f"/api/families/{family.id}/wish-list")
        assert resp.status_code == 200

    def test_referrer_locked_family_is_hidden(self, test_client, family, db):
        family.wish_lock_level = "referrer"
        db.commit()
        resp = test_client.get(f"/api/families/{family.id}/wish-list")
        assert resp.status_code == 404
