"""Tests for purchaser self-service wish endpoints."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    FamilyVerificationStatus,
    Person,
    PersonRole,
    Referrer,
    ReferrerApprovalStatus,
    User,
    UserRole,
    Wish,
    WishLockLevel,
    WishType,
)
from tests.conftest import make_family


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

    fam = make_family(
        db,
        referrer_id=ref.id,
        family_name="Purchaser Family",
        family_wish="Warm clothes",
        contact_name="Purchaser Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(
        family_id=fam.id,
        given_name="PurchaserChild",
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

    purchaser = User(
        email="purchaser@test.com",
        hashed_password=get_password_hash("PurchPass123!"),
        role=UserRole.purchaser,
        display_name=None,
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
        display_name=None,
    )
    db.add(purchaser2)
    db.commit()
    db.refresh(purchaser2)
    return purchaser2


def assign_family_wish(db: Session, tree) -> Wish:
    """Assign the tree family's family wish row to the tree purchaser."""
    w = db.query(Wish).filter(Wish.family_id == tree["family"].id, Wish.type == WishType.family).first()
    assert w is not None
    w.assigned_to_id = tree["purchaser"].id
    db.commit()
    return w


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
            # Display ID — unscoped flat format {referrer_id}-{position}; the
            # fixture family is the only active one, so position is 1
            ref_id = purchaser_wish_tree["referrer"].id
            assert w["family_display_id"] == f"{ref_id}-1"
            # Family is created at default lock level — reported for link gating
            assert w["wish_lock_level"] == WishLockLevel.family.value

    def test_list_includes_color(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Purchaser wish summaries include the color field."""
        practical = purchaser_wish_tree["wishes"][0]
        practical.color = "Blue"
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        colors = {w["id"]: w["color"] for w in resp.json()["wishes"]}
        assert colors[practical.id] == "Blue"
        assert colors[purchaser_wish_tree["wishes"][1].id] is None

    def test_list_display_id_zero_for_unenumerated_family(self, logged_in_purchaser, purchaser_wish_tree, db):
        """A wish under a pending (unenumerated) family shows display_id '0'."""
        fam2 = make_family(
            db,
            referrer_id=purchaser_wish_tree["referrer"].id,
            family_name="Pending Family",
            family_wish="Something",
            contact_name="Pending Contact",
            phone_number="555-000-0003",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(fam2)
        db.flush()

        person2 = Person(family_id=fam2.id, given_name="PendingChild", age=10, role=PersonRole.son)
        db.add(person2)
        db.flush()

        w = Wish(person_id=person2.id, type=WishType.practical, description="A ball")
        db.add(w)
        db.flush()
        w.assigned_to_id = purchaser_wish_tree["purchaser"].id
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3

        by_family = {item["family_id"]: item for item in data["wishes"]}
        ref_id = purchaser_wish_tree["referrer"].id
        assert by_family[purchaser_wish_tree["family"].id]["family_display_id"] == f"{ref_id}-1"
        assert by_family[fam2.id]["family_display_id"] == "0"

    def test_list_wish_lock_level_reflects_admin_lock(self, logged_in_purchaser, purchaser_wish_tree, db):
        """wish_lock_level in list items tracks the family's current lock level."""
        purchaser_wish_tree["family"].wish_lock_level = WishLockLevel.admin
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["wishes"]) == 2
        for w in data["wishes"]:
            assert w["wish_lock_level"] == WishLockLevel.admin.value

    def test_list_includes_family_wish(self, logged_in_purchaser, purchaser_wish_tree, db):
        """An assigned family wish appears with null person fields and family context."""
        assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3

        fam_item = [w for w in data["wishes"] if w["type"] == "family"][0]
        assert fam_item["person_id"] is None
        assert fam_item["person_given_name"] is None
        assert fam_item["family_id"] == purchaser_wish_tree["family"].id
        ref_id = purchaser_wish_tree["referrer"].id
        assert fam_item["family_display_id"] == f"{ref_id}-1"
        assert fam_item["wish_lock_level"] == WishLockLevel.family.value

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

    def test_filter_search_description(self, logged_in_purchaser, purchaser_wish_tree):
        """search matches wish description (case-insensitive)."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=backpack")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == purchaser_wish_tree["wishes"][0].id

    def test_filter_search_person_given_name_case_insensitive(self, logged_in_purchaser, purchaser_wish_tree):
        """search matches the person's given name, case-insensitively."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=PURCHAS")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert {w["id"] for w in data["wishes"]} == {w.id for w in purchaser_wish_tree["wishes"]}

    def test_filter_search_does_not_match_family_name(self, logged_in_purchaser, purchaser_wish_tree):
        """Family names are never matched (purchaser responses exclude family PII)."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=Purchaser%20Family")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_filter_search_ignores_family_wish_rows(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Person-name search does not pull in family wish rows (null person)."""
        fam_wish = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=PurchaserChild")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert fam_wish.id not in {w["id"] for w in data["wishes"]}

    def test_filter_search_coexists_with_purchased(self, logged_in_purchaser, purchaser_wish_tree, db):
        """search combines with the purchased filter."""
        purchaser_wish_tree["wishes"][0].purchased_at = datetime.now(timezone.utc)
        db.commit()

        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=backpack&purchased=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == purchaser_wish_tree["wishes"][0].id

        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=backpack&purchased=false")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_filter_wish_type(self, logged_in_purchaser, purchaser_wish_tree):
        """wish_type filters to the matching type."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes?wish_type=fun")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == purchaser_wish_tree["wishes"][1].id

    def test_filter_wish_type_family(self, logged_in_purchaser, purchaser_wish_tree, db):
        """An assigned family wish is returned by wish_type=family."""
        fam_wish = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.get("/api/purchaser/wishes?wish_type=family")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == fam_wish.id

    def test_filter_wish_type_invalid_422(self, logged_in_purchaser):
        """An invalid wish_type value is rejected with 422, not a 500 from the DB."""
        resp = logged_in_purchaser.get("/api/purchaser/wishes?wish_type=banana")
        assert resp.status_code == 422

    def test_filter_search_wildcards_match_literally(self, logged_in_purchaser, purchaser_wish_tree, db):
        """LIKE wildcards typed by the user match literally, not as pattern syntax."""
        wishes = purchaser_wish_tree["wishes"]
        wishes[0].description = "Save 50% today"
        wishes[1].description = "Save 50 dollars"
        db.commit()

        # "50%" must not degenerate into a "contains 50" pattern
        resp = logged_in_purchaser.get("/api/purchaser/wishes?search=50%25")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == wishes[0].id


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

    def test_get_family_wish(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Family wish detail has null person fields."""
        w = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.get(f"/api/purchaser/wishes/{w.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "family"
        assert data["person_id"] is None
        assert data["person_given_name"] is None
        assert data["person_family_name"] is None

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

    def test_mark_purchased_purchased_at_explicit(self, logged_in_purchaser, purchaser_wish_tree):
        """An explicit purchased_at is used as-is."""
        wish = purchaser_wish_tree["wishes"][0]
        dt = "2026-02-14T09:30:00Z"
        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target", "purchased_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] == dt

    def test_mark_purchased_purchased_at_clear(self, logged_in_purchaser, purchaser_wish_tree, db):
        """'' clears purchased_at (null/omitted default to now)."""
        wish = purchaser_wish_tree["wishes"][0]
        wish.purchased_at = datetime.now(timezone.utc)
        db.commit()
        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_at": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is None

    def test_mark_purchased_purchased_at_invalid_422(self, logged_in_purchaser, purchaser_wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{wish.id}/mark-purchased",
            json={"purchased_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_mark_purchased_family_wish(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Purchaser can mark an assigned family wish purchased (no reassign)."""
        w = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.post(
            f"/api/purchaser/wishes/{w.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["purchased_at"] is not None
        assert data["purchased_where"] == "Target"
        assert data["assigned_to_id"] == purchaser_wish_tree["purchaser"].id
        assert data["person_id"] is None

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
# Batch mark-purchased endpoint tests
# ---------------------------------------------------------------------------


class TestPurchaserBatchMarkPurchased:
    def test_batch_mark_success(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Batch mark sets purchase fields on all selected wishes."""
        wishes = purchaser_wish_tree["wishes"]
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={
                "wish_ids": [w.id for w in wishes],
                "purchased_where": "Target",
                "received_at": "2026-02-15T10:00:00Z",
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 2}

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_where == "Target"
            assert fresh[w.id].received_at is not None

    def test_batch_mark_purchased_at_explicit(self, logged_in_purchaser, purchaser_wish_tree, db):
        """An explicit purchased_at is applied to every wish in the batch."""
        wishes = purchaser_wish_tree["wishes"]
        dt = "2026-02-14T09:30:00Z"
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": dt},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_at.isoformat().replace("+00:00", "Z") == dt

    def test_batch_mark_purchased_at_clear(self, logged_in_purchaser, purchaser_wish_tree, db):
        """'' clears purchased_at on every wish in the batch."""
        wishes = purchaser_wish_tree["wishes"]
        for w in wishes:
            w.purchased_at = datetime.now(timezone.utc)
        db.commit()
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": ""},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is None

    def test_batch_mark_purchased_at_invalid_422(self, logged_in_purchaser, purchaser_wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        wishes = purchaser_wish_tree["wishes"]
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_batch_mark_duplicate_ids_counted_once(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Duplicate wish IDs are deduplicated — marked_count counts unique wishes."""
        wishes = purchaser_wish_tree["wishes"]
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [wishes[0].id, wishes[0].id, wishes[1].id], "purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 2}

        fresh = db.query(Wish).filter(Wish.id == wishes[0].id).first()
        assert fresh.purchased_where == "Target"

    def test_batch_mark_does_not_change_assigned_to_id(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Purchaser batch mark does not change assigned_to_id."""
        wishes = purchaser_wish_tree["wishes"]
        original = {w.id: w.assigned_to_id for w in wishes}

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Walmart"},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].assigned_to_id == original[w.id] == purchaser_wish_tree["purchaser"].id

    def test_batch_mark_family_wish(self, logged_in_purchaser, purchaser_wish_tree, db):
        """An assigned family wish can be batch marked (no person required)."""
        fam_wish = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [fam_wish.id], "purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 1}

        fresh = db.query(Wish).filter(Wish.id == fam_wish.id).first()
        assert fresh.purchased_at is not None
        assert fresh.purchased_where == "Target"
        assert fresh.assigned_to_id == purchaser_wish_tree["purchaser"].id

    def test_batch_mark_null_purchased_where_clears(self, logged_in_purchaser, purchaser_wish_tree, db):
        """purchased_where=null clears any existing value."""
        wishes = purchaser_wish_tree["wishes"]
        for w in wishes:
            w.purchased_where = "Old store"
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": None},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 2}

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_where is None

    def test_batch_mark_received_at_clear(self, logged_in_purchaser, purchaser_wish_tree, db):
        """received_at='' clears any existing value (partial-update sentinel)."""
        wishes = purchaser_wish_tree["wishes"]
        existing = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        for w in wishes:
            w.received_at = existing
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "received_at": ""},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].received_at is None

    def test_batch_mark_received_at_omit_preserves(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Omitting received_at keeps the existing value."""
        wishes = purchaser_wish_tree["wishes"]
        existing = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        for w in wishes:
            w.received_at = existing
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].received_at == existing

    def test_batch_mark_does_not_touch_purchaser_note(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Batch mark leaves per-item purchaser notes untouched."""
        wishes = purchaser_wish_tree["wishes"]
        wishes[0].purchaser_note = "Note one"
        wishes[1].purchaser_note = "Note two"
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        assert fresh[wishes[0].id].purchaser_note == "Note one"
        assert fresh[wishes[1].id].purchaser_note == "Note two"

    def test_batch_mark_empty_wish_ids_422(self, logged_in_purchaser):
        """Empty wish_ids list is rejected."""
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [], "purchased_where": "Target"},
        )
        assert resp.status_code == 422

    def test_batch_mark_nonexistent_wish_404_fail_fast(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Missing wish ID → 404 and nothing is mutated."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [wish.id, 99999], "purchased_where": "Target"},
        )
        assert resp.status_code == 404

        fresh = db.query(Wish).filter(Wish.id == wish.id).first()
        assert fresh.purchased_at is None
        assert fresh.purchased_where is None

    def test_batch_mark_soft_deleted_wish_404_fail_fast(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Soft-deleted wish ID → 404 and nothing is mutated."""
        wishes = purchaser_wish_tree["wishes"]
        wishes[1].deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 404

        fresh = db.query(Wish).filter(Wish.id == wishes[0].id).first()
        assert fresh.purchased_at is None

    def test_batch_mark_other_purchasers_wish_403_fail_fast(self, logged_in_purchaser, purchaser_wish_tree, second_purchaser, db):
        """A wish assigned to another purchaser → 403 and nothing is mutated."""
        wishes = purchaser_wish_tree["wishes"]
        wishes[1].assigned_to_id = second_purchaser.id
        db.commit()

        resp = logged_in_purchaser.post(
            "/api/purchaser/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 403

        fresh = db.query(Wish).filter(Wish.id == wishes[0].id).first()
        assert fresh.purchased_at is None


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

    def test_update_family_wish_note(self, logged_in_purchaser, purchaser_wish_tree, db):
        """Purchaser can update purchaser_note on an assigned family wish."""
        w = assign_family_wish(db, purchaser_wish_tree)

        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{w.id}",
            json={"purchaser_note": "Gift wrapped"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Gift wrapped"

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

    def test_update_received_at_invalid_422(self, logged_in_purchaser, purchaser_wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        wish = purchaser_wish_tree["wishes"][0]
        resp = logged_in_purchaser.patch(
            f"/api/purchaser/wishes/{wish.id}",
            json={"received_at": "not-a-date"},
        )
        assert resp.status_code == 422

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
            display_name=None,
        )
        db.add(admin2)
        db.commit()
        db.refresh(admin2)

        # Create a separate family/person so we don't hit the unique wish-type constraint
        fam2 = make_family(
            db,
            referrer_id=purchaser_wish_tree["referrer"].id,
            family_name="Admin Mark Family",
            family_wish="Test wish",
            contact_name="Admin Mark Contact",
            phone_number="555-000-0099",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam2)
        db.commit()
        db.refresh(fam2)

        person2 = Person(
            family_id=fam2.id,
            given_name="AdminMarkChild",
            age=10,
            role=PersonRole.son,
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
