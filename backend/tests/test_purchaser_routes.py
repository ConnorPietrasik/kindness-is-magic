"""Tests for purchaser self-service wish endpoints."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Family,
    FamilyApprovalStatus,
    Person,
    Referrer,
    ReferrerApprovalStatus,
    User,
    UserRole,
    Wish,
    WishType,
)


@pytest.fixture()
def purchaser_wish_tree(db: Session):
    """Create a referrer → family → person → wishes tree + purchaser user."""
    from app.auth import get_password_hash

    ref = Referrer(
        name="Purchaser Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-PUR001",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Purchaser Family",
        family_wish="Warm clothes",
        contact_name="Purchaser Contact",
        phone_number="555-000-0002",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(
        family_id=fam.id,
        given_name="PurchaserChild",
        age=10,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A backpack", size="Medium")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(w1)
    db.refresh(w2)

    purchaser = User(
        email="purchaser@test.com",
        hashed_password=get_password_hash("PurchPass123!"),
        role=UserRole.purchaser,
    )
    db.add(purchaser)
    db.commit()
    db.refresh(purchaser)

    # Assign both wishes to the purchaser
    w1.assigned_to_id = purchaser.id
    w2.assigned_to_id = purchaser.id
    db.commit()

    return {
        "referrer": ref,
        "family": fam,
        "person": person,
        "wishes": [w1, w2],
        "purchaser": purchaser,
    }


@pytest.fixture()
def second_purchaser(db: Session):
    """A second purchaser for cross-user 403 tests."""
    from app.auth import get_password_hash

    purchaser2 = User(
        email="purchaser2@test.com",
        hashed_password=get_password_hash("Purch2Pass123!"),
        role=UserRole.purchaser,
    )
    db.add(purchaser2)
    db.commit()
    db.refresh(purchaser2)
    return purchaser2


@pytest.fixture()
def logged_in_purchaser(test_client, purchaser_wish_tree):
    """Login as the purchaser and return the test_client."""
    resp = test_client.post(
        "/api/auth/login",
        json={"email": purchaser_wish_tree["purchaser"].email, "password": "PurchPass123!"},
    )
    assert resp.status_code == 200
    return test_client


# ---------------------------------------------------------------------------
# List endpoint tests
# ---------------------------------------------------------------------------


class TestPurchaserListWishes:
    def test_list_assigned_wishes(self, logged_in_purchaser, purchaser_wish_tree):
        """Purchaser sees only their assigned wishes."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["wishes"]) == 2
        for w in data["wishes"]:
            assert w["assigned_to_id"] == purchaser_wish_tree["purchaser"].id
            # No PII fields
            assert "family_name" not in w
            assert "contact_name" not in w
            assert "phone_number" not in w
            # Has family_id for wishlist linking
            assert "family_id" in w
            assert w["family_id"] == purchaser_wish_tree["family"].id

    def test_list_excludes_unassigned_wishes(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Unassigned wishes are not shown to the purchaser."""
        # Unassign one wish
        purchaser_wish_tree["wishes"][1].assigned_to_id = None
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_list_excludes_other_purchaser_wishes(self, logged_in_purchaser, purchaser_wish_tree, second_purchaser, db):
        """Wishes assigned to another purchaser are not shown."""
        # Reassign one wish to the second purchaser
        purchaser_wish_tree["wishes"][1].assigned_to_id = second_purchaser.id
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == purchaser_wish_tree["wishes"][0].id

    def test_filter_purchased_true(self, logged_in_purchaser, purchaser_wish_tree, db):
        """purchased=true returns only purchased wishes."""
        now = datetime.now(timezone.utc)
        purchaser_wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes?purchased=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["purchased_at"] is not None

    def test_filter_purchased_false(self, logged_in_purchaser, purchaser_wish_tree, db):
        """purchased=false returns only unpurchased wishes."""
        now = datetime.now(timezone.utc)
        purchaser_wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes?purchased=false")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["purchased_at"] is None

    def test_filter_purchased_all(self, logged_in_purchaser, purchaser_wish_tree, db):
        """purchased=all returns all wishes regardless of purchase status."""
        now = datetime.now(timezone.utc)
        purchaser_wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes?purchased=all")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_empty_list(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Returns empty list when purchaser has no assigned wishes."""
        for w in purchaser_wish_tree["wishes"]:
            w.assigned_to_id = None
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["wishes"] == []


# ---------------------------------------------------------------------------
# Get endpoint tests
# ---------------------------------------------------------------------------


class TestPurchaserGetWish:
    def test_get_assigned_wish(self, logged_in_purchaser, purchaser_wish_tree):
        """Purchaser can get detail of an assigned wish."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.get(f"/api/purchaser/wishes/{wish.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == wish.id
        assert data["person_given_name"] == "PurchaserChild"

    def test_get_unassigned_wish_returns_403(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Purchaser cannot get detail of a wish not assigned to them."""
        purchaser_wish_tree["wishes"][1].assigned_to_id = None
        db.commit()

        resp = logged_in_purchaser.get(f"/api/purchaser/wishes/{purchaser_wish_tree['wishes'][1].id}")
        assert resp.status_code == 403

    def test_get_other_purchaser_wish_returns_403(self, logged_in_purchaser, purchaser_wish_tree, second_purchaser, db):
        """Purchaser cannot get detail of a wish assigned to another purchaser."""
        purchaser_wish_tree["wishes"][1].assigned_to_id = second_purchaser.id
        db.commit()

        resp = logged_in_purchaser.get(f"/api/purchaser/wishes/{purchaser_wish_tree['wishes'][1].id}")
        assert resp.status_code == 403

    def test_get_nonexistent_wish_returns_404(self, logged_in_purchaser):
        """Non-existent wish returns 404."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes/99999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Mark-purchased endpoint tests
# ---------------------------------------------------------------------------


class TestPurchaserMarkPurchased:
    def test_mark_purchased_sets_fields(self, logged_in_purchaser, purchaser_wish_tree):
        """Mark purchased sets purchased_at, purchased_where, purchaser_note, received_at."""
        wish = purchaser_wish_tree["wishes"][0]
        received_dt = "2026-02-15T10:00:00Z"
        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={
                "purchased_where": "Target",
                "purchaser_note": "Got on sale",
                "received_at": received_dt,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["purchased_at"] is not None
        assert data["purchased_where"] == "Target"
        assert data["purchaser_note"] == "Got on sale"
        assert data["received_at"] is not None

    def test_mark_purchased_does_not_change_assigned_to_id(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Mark purchased does NOT change assigned_to_id (unlike admin endpoint)."""
        wish = purchaser_wish_tree["wishes"][0]
        original_assigned_to = wish.assigned_to_id

        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Walmart"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assigned_to_id"] == original_assigned_to

    def test_mark_purchased_unassigned_wish(self, logged_in_purchaser, purchaser_wish_tree, second_purchaser, db):
        """Mark purchased on a wish assigned to another purchaser returns 403."""
        purchaser_wish_tree["wishes"][1].assigned_to_id = second_purchaser.id
        db.commit()

        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{purchaser_wish_tree['wishes'][1].id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 403

    def test_mark_purchased_note_clear(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Empty string clears purchaser_note."""
        wish = purchaser_wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target", "purchaser_note": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] is None

    def test_mark_purchased_note_omit_preserves(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Omitting purchaser_note keeps existing note."""
        wish = purchaser_wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Existing note"


# ---------------------------------------------------------------------------
# Patch endpoint tests
# ---------------------------------------------------------------------------


class TestPurchaserUpdateWish:
    def test_update_purchaser_note(self, logged_in_purchaser, purchaser_wish_tree):
        """Purchaser can update purchaser_note."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"purchaser_note": "Updated note"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Updated note"

    def test_update_received_at(self, logged_in_purchaser, purchaser_wish_tree):
        """Purchaser can update received_at."""
        wish = purchaser_wish_tree["wishes"][0]
        dt = "2026-03-01T14:00:00Z"
        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"received_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is not None

    def test_cannot_update_wish_definition(self, logged_in_purchaser, purchaser_wish_tree):
        """Purchaser cannot update wish definition fields (type, description, size)."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"description": "Hacked description", "type": "adult"},
        )
        # These fields are not in PurchaserWishUpdate, so they should be ignored or cause validation error
        assert resp.status_code in (200, 422)
        if resp.status_code == 200:
            # Fields should be unchanged
            assert resp.json()["description"] == wish.description
            assert resp.json()["type"] == wish.type.value

    def test_cannot_update_other_purchaser_wish(self, logged_in_purchaser, purchaser_wish_tree, second_purchaser, db):
        """Purchaser cannot update a wish assigned to another purchaser."""
        purchaser_wish_tree["wishes"][1].assigned_to_id = second_purchaser.id
        db.commit()

        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{purchaser_wish_tree['wishes'][1].id}",
            json={"purchaser_note": "Hacked note"},
        )
        assert resp.status_code == 403

    def test_clear_purchaser_note(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Empty string clears purchaser_note via partial update."""
        wish = purchaser_wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"purchaser_note": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] is None

    def test_clear_received_at(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Empty string clears received_at via partial update."""
        wish = purchaser_wish_tree["wishes"][0]
        wish.received_at = datetime.now(timezone.utc)
        db.commit()

        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"received_at": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is None


# ---------------------------------------------------------------------------
# Authorization tests
# ---------------------------------------------------------------------------


class TestPurchaserAuthorization:
    def test_family_cannot_access_purchaser_routes(self, test_client, family_user):
        """Family user gets 403 on purchaser routes."""
        test_client.post(
            "/api/auth/login",
            json={"email": family_user.email, "password": "FamPass1234!"},
        )
        assert test_client.get("/api/purchaser/wishes").status_code == 403
        assert test_client.get("/api/purchaser/wishes/1").status_code == 403

    def test_referrer_cannot_access_purchaser_routes(self, test_client, referrer_user):
        """Referrer user gets 403 on purchaser routes."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        assert test_client.get("/api/purchaser/wishes").status_code == 403
        assert test_client.get("/api/purchaser/wishes/1").status_code == 403

    def test_admin_cannot_access_purchaser_routes(self, test_client, admin_user):
        """Admin user gets 403 on purchaser routes (they have their own admin routes)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        assert test_client.get("/api/purchaser/wishes").status_code == 403


# ---------------------------------------------------------------------------
# Admin mark_purchased skip-redundant-write test
# ---------------------------------------------------------------------------


class TestAdminMarkPurchasedSkipRedundantWrite:
    def test_admin_mark_purchased_skips_redundant_assignment(self, test_client, admin_user, purchaser_wish_tree, db):
        """Admin mark-purchased skips assigned_to_id write if already assigned to that admin."""
        from app.auth import get_password_hash

        # Create an admin and assign a wish to them
        admin2 = User(
            email="admin2_mark@test.com",
            hashed_password=get_password_hash("Admin2Pass123!"),
            role=UserRole.admin,
        )
        db.add(admin2)
        db.commit()
        db.refresh(admin2)

        # Create a separate family/person so we don't hit the unique wish-type constraint
        fam2 = Family(
            referrer_id=purchaser_wish_tree["referrer"].id,
            family_name="Admin Mark Family",
            family_wish="Test wish",
            contact_name="Admin Mark Contact",
            phone_number="555-000-0099",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(fam2)
        db.commit()
        db.refresh(fam2)

        person2 = Person(
            family_id=fam2.id,
            given_name="AdminMarkChild",
            age=10,
        )
        db.add(person2)
        db.flush()

        wish = Wish(
            person_id=person2.id,
            type=WishType.practical,
            description="A test wish for admin mark",
        )
        wish.assigned_to_id = admin2.id
        db.add(wish)
        db.commit()
        db.refresh(wish)

        # Login as admin2
        test_client.post(
            "/api/auth/login",
            json={"email": admin2.email, "password": "Admin2Pass123!"},
        )

        # Mark purchased — assigned_to_id should stay the same (admin2)
        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assigned_to_id"] == admin2.id
        assert data["purchased_at"] is not None
