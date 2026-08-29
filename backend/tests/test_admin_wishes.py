"""Tests for admin wish CRUD endpoints."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Family,
    FamilyVerificationStatus,
    Person,
    PersonRole,
    Referrer,
    ReferrerApprovalStatus,
    User,
    UserRole,
    Wish,
    WishType,
)


@pytest.fixture()
def wish_tree(db: Session):
    """Create a referrer → family → person → wishes tree for testing."""
    from app.auth import get_password_hash

    ref = Referrer(
        name="Wish Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-WISH01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Wish Family",
        family_wish="Warm clothes",
        contact_name="Wish Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(
        family_id=fam.id,
        given_name="WishChild",
        age=10,
        role=PersonRole.son,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A backpack", size="Medium")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(w1)
    db.refresh(w2)

    admin = User(
        email="wish_admin@test.com",
        hashed_password=get_password_hash("AdminPass123!"),
        role=UserRole.admin,
        display_name=None,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    return {
        "referrer": ref,
        "family": fam,
        "person": person,
        "wishes": [w1, w2],
        "admin": admin,
    }


@pytest.fixture()
def second_family_with_wishes(db: Session, wish_tree):
    """Second family with wishes for filter tests."""
    fam2 = Family(
        referrer_id=wish_tree["referrer"].id,
        family_name="Second Family",
        family_wish="Food",
        contact_name="Second Contact",
        phone_number="555-000-0003",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)

    person2 = Person(
        family_id=fam2.id,
        given_name="SecondChild",
        age=12,
        role=PersonRole.son,
    )
    db.add(person2)
    db.flush()

    w3 = Wish(person_id=person2.id, type=WishType.practical, description="New shoes", size="3Y")
    w4 = Wish(person_id=person2.id, type=WishType.fun, description="A football")
    db.add_all([w3, w4])
    db.commit()
    db.refresh(w3)
    db.refresh(w4)

    return {"family": fam2, "person": person2, "wishes": [w3, w4]}


@pytest.fixture()
def logged_in_admin(test_client, admin_user):
    """Login as admin_user and return the test_client (cookies auto-handled)."""
    resp = test_client.post(
        "/api/auth/login",
        json={"email": admin_user.email, "password": "AdminPass123!"},
    )
    assert resp.status_code == 200
    return test_client


@pytest.fixture()
def logged_in_referrer(test_client, referrer_user):
    """Login as referrer_user for 403 tests."""
    resp = test_client.post(
        "/api/auth/login",
        json={"email": referrer_user.email, "password": "RefPass1234!"},
    )
    assert resp.status_code == 200
    return test_client


# ---------------------------------------------------------------------------
# List endpoint tests
# ---------------------------------------------------------------------------


class TestListWishes:
    def test_default_list(self, test_client, admin_user, wish_tree):
        """Default list returns all active wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["wishes"]) == 2
        assert data["page"] == 1
        assert data["page_size"] == 50

    def test_pagination(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Pagination works correctly."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?page=1&page_size=2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 4
        assert len(data["wishes"]) == 2
        assert data["total_pages"] == 2

        resp2 = test_client.get("/api/admin/wishes?page=2&page_size=2")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2["wishes"]) == 2

    def test_filter_by_family_id(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Filter by family_id returns only wishes for that family."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?family_id={wish_tree['family'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        for w in data["wishes"]:
            assert w["family_id"] == wish_tree["family"].id

    def test_filter_by_person_id(self, test_client, admin_user, wish_tree):
        """Filter by person_id returns only wishes for that person."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?person_id={wish_tree['person'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        for w in data["wishes"]:
            assert w["person_id"] == wish_tree["person"].id

    def test_filter_by_assigned_to_id(self, test_client, admin_user, wish_tree, db):
        """Filter by assigned_to_id returns only assigned wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Assign one wish
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.get(f"/api/admin/wishes?assigned_to_id={admin_user.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["assigned_to_id"] == admin_user.id

    def test_filter_by_assigned_to_id_zero(self, test_client, admin_user, wish_tree, db):
        """Filter by assigned_to_id=0 returns only unassigned wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Assign one wish
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.get("/api/admin/wishes?assigned_to_id=0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["assigned_to_id"] is None

    def test_filter_by_purchased_true(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=true returns only purchased wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_filter_by_purchased_false(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=false returns only unpurchased wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=false")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_filter_by_purchased_all(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=all returns all wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=all")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_filter_search(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Search filters by wish description and person/family name."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?search=backpack")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["description"] == "A backpack"

        resp2 = test_client.get("/api/admin/wishes?search=WishChild")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["total"] == 2

        resp3 = test_client.get("/api/admin/wishes?search=Second+Family")
        assert resp3.status_code == 200
        data3 = resp3.json()
        assert data3["total"] == 2

    def test_combined_filters(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Multiple filters can be combined."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?family_id={wish_tree['family'].id}&person_id={wish_tree['person'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_empty_results(self, test_client, admin_user, wish_tree):
        """Non-matching filter returns empty list."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?search=nonexistentxyz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["wishes"] == []
        assert data["total_pages"] == 0


# ---------------------------------------------------------------------------
# Get endpoint tests
# ---------------------------------------------------------------------------


class TestGetWish:
    def test_get_valid_wish(self, test_client, admin_user, wish_tree):
        """Get a valid wish returns detail with person context."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes/{wish_tree['wishes'][0].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == wish_tree["wishes"][0].id
        assert data["person_given_name"] == "WishChild"
        assert data["person_family_name"] == "Wish Family"

    def test_get_nonexistent_wish(self, test_client, admin_user):
        """Non-existent wish returns 404."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes/99999")
        assert resp.status_code == 404

    def test_get_soft_deleted_wish(self, test_client, admin_user, wish_tree, db):
        """Soft-deleted wish returns 404."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_tree["wishes"][0].deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.get(f"/api/admin/wishes/{wish_tree['wishes'][0].id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Patch endpoint tests
# ---------------------------------------------------------------------------


class TestPatchWish:
    def test_update_description(self, test_client, admin_user, wish_tree):
        """Update description only."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"description": "Updated backpack"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated backpack"

    def test_update_size(self, test_client, admin_user, wish_tree):
        """Update size."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"size": "Large"},
        )
        assert resp.status_code == 200
        assert resp.json()["size"] == "Large"

    def test_change_type_valid(self, test_client, admin_user, wish_tree, db):
        """Change type to another valid type for person's age (after removing conflict)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Child (age 10) can have practical or fun
        # Soft-delete the existing fun wish to avoid unique constraint conflict
        fun_wish = [w for w in wish_tree["wishes"] if w.type == WishType.fun][0]
        fun_wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        wish = wish_tree["wishes"][0]  # practical
        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"type": "fun"},
        )
        assert resp.status_code == 200
        assert resp.json()["type"] == "fun"

    def test_change_type_invalid(self, test_client, admin_user, wish_tree):
        """Change type to invalid type for person's age returns 400."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Child (age 10) cannot have adult type
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"type": "adult"},
        )
        assert resp.status_code == 400

    def test_set_assigned_to_id(self, test_client, admin_user, wish_tree):
        """Set assigned_to_id to a valid user."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_clear_assigned_to_id(self, test_client, admin_user, wish_tree, db):
        """Clear assigned_to_id via 0 sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"assigned_to_id": 0},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] is None

    def test_set_purchased_at(self, test_client, admin_user, wish_tree):
        """Set purchased_at."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-01-15T10:30:00Z"
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchased_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is not None

    def test_set_purchased_where(self, test_client, admin_user, wish_tree):
        """Set purchased_where."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_where"] == "Target"

    def test_set_received_at(self, test_client, admin_user, wish_tree):
        """Set received_at."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-02-01T12:00:00Z"
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"received_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is not None

    def test_set_purchaser_note(self, test_client, admin_user, wish_tree):
        """Set purchaser_note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchaser_note": "Got it on sale"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Got it on sale"

    def test_clear_purchaser_note(self, test_client, admin_user, wish_tree, db):
        """Clear purchaser_note via empty string sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"purchaser_note": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] is None


# ---------------------------------------------------------------------------
# Mark-purchased endpoint tests
# ---------------------------------------------------------------------------


class TestMarkPurchased:
    def test_normal_case(self, test_client, admin_user, wish_tree):
        """Normal mark-purchased sets purchased_at, purchased_where, and assigns to admin."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_where": "Walmart"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["purchased_at"] is not None
        assert data["purchased_where"] == "Walmart"
        assert data["assigned_to_id"] == admin_user.id

    def test_auto_reassign(self, test_client, admin_user, wish_tree, db):
        """Mark-purchased reassigns wish to calling admin even if assigned to someone else."""
        from app.auth import get_password_hash

        # Create another user and assign the wish to them
        other_user = User(
            email="other_admin@test.com",
            hashed_password=get_password_hash("OtherPass123!"),
            role=UserRole.admin,
            display_name=None,
        )
        db.add(other_user)
        db.commit()
        db.refresh(other_user)

        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = other_user.id
        db.commit()

        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_auto_assign_unassigned(self, test_client, admin_user, wish_tree):
        """Mark-purchased assigns to admin when wish is unassigned."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        assert wish.assigned_to_id is None

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": None},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_note_preservation_omit(self, test_client, admin_user, wish_tree, db):
        """Omitting purchaser_note keeps existing note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Existing note"

    def test_note_overwrite(self, test_client, admin_user, wish_tree, db):
        """Providing purchaser_note overwrites existing note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Old note"
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target", "purchaser_note": "New note"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "New note"

    def test_received_at_set(self, test_client, admin_user, wish_tree):
        """Providing received_at sets it."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-02-15T10:00:00Z"
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_where": "Target", "received_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is not None

    def test_received_at_preservation_omit(self, test_client, admin_user, wish_tree, db):
        """Omitting received_at keeps existing value."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        existing_dt = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        wish.received_at = existing_dt
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["received_at"] == existing_dt.isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Batch-assign endpoint tests
# ---------------------------------------------------------------------------


class TestBatchAssign:
    def test_success_multiple(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Successfully assign multiple wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_ids = [w.id for w in wish_tree["wishes"]] + [w.id for w in second_family_with_wishes["wishes"]]
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": wish_ids, "assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 4

    def test_fail_fast_invalid_wish_id(self, test_client, admin_user, wish_tree):
        """Fail-fast when one wish ID doesn't exist."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={
                "wish_ids": [wish_tree["wishes"][0].id, 99999],
                "assigned_to_id": admin_user.id,
            },
        )
        assert resp.status_code == 400

    def test_fail_fast_invalid_user(self, test_client, admin_user, wish_tree):
        """Fail-fast when assigned_to_id user doesn't exist."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [wish_tree["wishes"][0].id], "assigned_to_id": 99999},
        )
        assert resp.status_code == 400

    def test_single_wish(self, test_client, admin_user, wish_tree):
        """Batch assign with a single wish."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [wish_tree["wishes"][0].id], "assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 1

    def test_batch_unassign(self, test_client, admin_user, wish_tree, db):
        """Batch-unassign wishes via assigned_to_id=0 sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Pre-assign wishes
        for w in wish_tree["wishes"]:
            w.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [w.id for w in wish_tree["wishes"]], "assigned_to_id": 0},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 2

        # Verify wishes are unassigned
        for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wish_tree["wishes"]])).all():
            assert w.assigned_to_id is None


# ---------------------------------------------------------------------------
# Authorization tests
# ---------------------------------------------------------------------------


class TestAuthorization:
    def test_non_admin_list(self, test_client, referrer_user):
        """Non-admin gets 403 on list."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 403

    def test_non_admin_get(self, test_client, referrer_user):
        """Non-admin gets 403 on get."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.get("/api/admin/wishes/1")
        assert resp.status_code == 403

    def test_non_admin_patch(self, test_client, referrer_user):
        """Non-admin gets 403 on patch."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.patch("/api/admin/wishes/1", json={"description": "test"})
        assert resp.status_code == 403

    def test_non_admin_mark_purchased(self, test_client, referrer_user):
        """Non-admin gets 403 on mark-purchased."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.post("/api/admin/wishes/1/mark-purchased", json={"purchased_where": "test"})
        assert resp.status_code == 403

    def test_non_admin_batch_assign(self, test_client, referrer_user):
        """Non-admin gets 403 on batch-assign."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.post("/api/admin/wishes/batch-assign", json={"wish_ids": [1], "assigned_to_id": 1})
        assert resp.status_code == 403
