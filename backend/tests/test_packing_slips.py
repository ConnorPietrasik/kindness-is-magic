"""Tests for the admin packing-slips endpoint."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _referrer_login(client: TestClient) -> dict:
    return login_as(client, "referrer@test.com", "RefPass1234!")


def _family_login(client: TestClient) -> dict:
    return login_as(client, "family@test.com", "FamPass1234!")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def packing_slip_families(db: Session, referrer_record):
    """Create two verified families with admin-locked wishes, people, and wishes.

    Family 1: wish_lock_level=admin (should appear in default query)
    Family 2: wish_lock_level=admin (should appear in default query)
    Family 3: wish_lock_level=referrer (should NOT appear in default query)
    """
    from app.models import Family, FamilyVerificationStatus, Person, Wish, WishLockLevel, WishType

    # Family 1 — admin locked
    fam1 = Family(
        referrer_id=referrer_record.id,
        family_name="Packing Family One",
        family_wish="Winter coats for everyone",
        contact_name="Contact One",
        phone_number="555-001-0001",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam1)
    db.commit()
    db.refresh(fam1)

    # Family 2 — admin locked
    fam2 = Family(
        referrer_id=referrer_record.id,
        family_name="Packing Family Two",
        family_wish="School supplies",
        contact_name="Contact Two",
        phone_number="555-001-0002",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)

    # Family 3 — referrer locked (should NOT appear in default)
    fam3 = Family(
        referrer_id=referrer_record.id,
        family_name="Packing Family Three",
        family_wish="Not ready yet",
        contact_name="Contact Three",
        phone_number="555-001-0003",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.referrer,
    )
    db.add(fam3)
    db.commit()
    db.refresh(fam3)

    # People for family 1
    p1a = Person(family_id=fam1.id, given_name="Alice", age=8, title="Ms.", note="Allergic to peanuts")
    p1b = Person(family_id=fam1.id, given_name="Bob", age=10)
    db.add_all([p1a, p1b])
    db.flush()

    # Wishes for p1a
    db.add_all(
        [
            Wish(person_id=p1a.id, type=WishType.practical, description="A backpack", size="M"),
            Wish(person_id=p1a.id, type=WishType.fun, description="A doll", size=None),
        ]
    )

    # Wishes for p1b
    db.add_all(
        [
            Wish(person_id=p1b.id, type=WishType.practical, description="New shoes", size="3Y"),
            Wish(person_id=p1b.id, type=WishType.fun, description="A football", size=None),
        ]
    )

    # People for family 2
    p2a = Person(family_id=fam2.id, given_name="Carol", age=35)
    db.add(p2a)
    db.flush()

    # Wishes for p2a (adult — one wish)
    db.add(Wish(person_id=p2a.id, type=WishType.adult, description="A coffee maker", size=None))

    db.commit()
    db.refresh(p1a)
    db.refresh(p1b)
    db.refresh(p2a)

    return {
        "families": [fam1, fam2, fam3],
        "people": {"fam1": [p1a, p1b], "fam2": [p2a]},
    }


# =========================================================================
# Tests
# =========================================================================


class TestPackingSlipsAuth:
    """Authentication and authorization checks."""

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 401

    def test_403_referrer(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 403

    def test_403_family(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 403

    def test_200_admin(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200


class TestPackingSlipsDefaultFilter:
    """Default (no family_ids) returns only admin-locked families."""

    def test_returns_only_admin_locked(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        # Should have 2 families (fam1 and fam2, not fam3)
        assert len(body) == 2
        ids = {item["id"] for item in body}
        assert packing_slip_families["families"][0].id in ids  # fam1
        assert packing_slip_families["families"][1].id in ids  # fam2
        assert packing_slip_families["families"][2].id not in ids  # fam3 (referrer locked)

    def test_empty_when_no_admin_locked(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_excludes_deleted_families(self, test_client: TestClient, admin_user, packing_slip_families, db: Session):
        _admin_login(test_client)
        fam1 = packing_slip_families["families"][0]
        fam1_id = fam1.id
        # Soft-delete fam1
        fam1.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()
        ids = {item["id"] for item in body}
        assert fam1_id not in ids

    def test_excludes_pending_families(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        from app.models import Family, FamilyVerificationStatus, WishLockLevel

        pending_fam = Family(
            referrer_id=referrer_record.id,
            family_name="Pending Family",
            family_wish="Something",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(pending_fam)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()
        ids = {item["id"] for item in body}
        assert pending_fam.id not in ids


class TestPackingSlipsFamilyIdsFilter:
    """family_ids query param returns only requested families."""

    def test_returns_specific_families(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        fam1_id = packing_slip_families["families"][0].id
        fam2_id = packing_slip_families["families"][1].id

        resp = test_client.get(f"/api/admin/families/packing-slips?family_ids={fam1_id},{fam2_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        ids = {item["id"] for item in body}
        assert ids == {fam1_id, fam2_id}

    def test_single_family(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        fam1_id = packing_slip_families["families"][0].id

        resp = test_client.get(f"/api/admin/families/packing-slips?family_ids={fam1_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == fam1_id

    def test_404_deleted_family_in_filter(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Family, FamilyVerificationStatus, WishLockLevel

        # Create and delete a family
        fam = Family(
            family_name="Deleted Family",
            family_wish="Something",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/packing-slips?family_ids={fam.id}")
        assert resp.status_code == 404

    def test_404_nonexistent_family(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips?family_ids=99999")
        assert resp.status_code == 404

    def test_filters_to_approved_when_family_ids_given(self, test_client: TestClient, admin_user, db: Session, referrer_record):
        from app.models import Family, FamilyVerificationStatus, WishLockLevel

        # Create a pending family with admin lock
        pending = Family(
            referrer_id=referrer_record.id,
            family_name="Pending Filtered",
            family_wish="Something",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/packing-slips?family_ids={pending.id}")
        assert resp.status_code == 200
        body = resp.json()
        # Pending family is found (no 404) but excluded from results
        assert len(body) == 0


class TestPackingSlipsResponseShape:
    """Response contains correct fields and excludes PII."""

    def test_response_shape(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        for item in body:
            # Family-level fields
            assert "id" in item
            assert "display_id" in item
            assert "family_wish" in item
            assert "people" in item

            # PII should NOT be present
            assert "family_name" not in item
            assert "contact_name" not in item
            assert "bio" not in item

            # Person-level fields
            for person in item["people"]:
                assert "display_id" in person
                assert "given_name" in person
                assert "age" in person
                assert "wishes" in person
                # title and note may be present (nullable)
                assert "title" in person
                assert "note" in person

                for wish in person["wishes"]:
                    assert "type" in wish
                    assert "description" in wish
                    assert "size" in wish

    def test_display_ids_present(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        for item in body:
            assert isinstance(item["display_id"], str)
            assert item["display_id"] != ""
            for person in item["people"]:
                assert isinstance(person["display_id"], str)
                assert person["display_id"] != ""

    def test_only_nondeleted_people(self, test_client: TestClient, admin_user, packing_slip_families, db: Session):
        # Soft-delete one person
        p = packing_slip_families["people"]["fam1"][1]  # Bob
        p.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        # Find family 1 in results
        fam1_data = next(item for item in body if item["id"] == packing_slip_families["families"][0].id)
        # Should only have 1 person (Alice), not Bob
        assert len(fam1_data["people"]) == 1
        assert fam1_data["people"][0]["given_name"] == "Alice"

    def test_only_nondeleted_wishes(self, test_client: TestClient, admin_user, packing_slip_families, db: Session):
        from app.models import Wish

        # Soft-delete one wish
        p = packing_slip_families["people"]["fam1"][0]  # Alice
        wish = db.query(Wish).filter(Wish.person_id == p.id).first()
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        fam1_data = next(item for item in body if item["id"] == packing_slip_families["families"][0].id)
        alice = next(p for p in fam1_data["people"] if p["given_name"] == "Alice")
        # Should have 1 wish, not 2
        assert len(alice["wishes"]) == 1

    def test_people_ordered_by_id(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        fam1_data = next(item for item in body if item["id"] == packing_slip_families["families"][0].id)
        people = fam1_data["people"]
        assert len(people) == 2
        # Alice (p1a) was created before Bob (p1b), so Alice should come first
        assert people[0]["given_name"] == "Alice"
        assert people[1]["given_name"] == "Bob"

    def test_null_fields_present(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        # Carol (adult) has no title
        for item in body:
            for person in item["people"]:
                if person["given_name"] == "Carol":
                    assert person["title"] is None
                    assert person["note"] is None


class TestPackingSlipsEdgeCases:
    """Edge cases and boundary conditions."""

    def test_empty_family_ids_param(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips?family_ids=")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_invalid_family_ids_param(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips?family_ids=abc")
        assert resp.status_code == 400

    def test_family_with_no_people(self, test_client: TestClient, admin_user, db: Session, referrer_record):
        from app.models import Family, FamilyVerificationStatus, WishLockLevel

        fam = Family(
            referrer_id=referrer_record.id,
            family_name="Empty Family",
            family_wish="Nothing yet",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        fam_data = next(item for item in body if item["id"] == fam.id)
        assert fam_data["people"] == []


# =========================================================================
# Display IDs — exact values
# =========================================================================


class TestPackingSlipsDisplayIds:
    """Packing-slip display_ids use exact hierarchical values.

    Family display_ids are flat ({referrer_id}-{fam_pos}); person
    display_ids reset to 1 in each family — they are the person's
    position within their own family, not a global counter.
    """

    def test_family_display_ids_flat_format(self, test_client: TestClient, admin_user, packing_slip_families, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        by_id = {item["id"]: item for item in body}
        fam1 = packing_slip_families["families"][0]
        fam2 = packing_slip_families["families"][1]
        assert by_id[fam1.id]["display_id"] == f"{referrer_record.id}-1"
        assert by_id[fam2.id]["display_id"] == f"{referrer_record.id}-2"

    def test_person_display_ids_reset_per_family(self, test_client: TestClient, admin_user, packing_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        by_id = {item["id"]: item for item in body}
        fam1 = packing_slip_families["families"][0]
        fam2 = packing_slip_families["families"][1]

        fam1_people = {p["given_name"]: p["display_id"] for p in by_id[fam1.id]["people"]}
        fam2_people = {p["given_name"]: p["display_id"] for p in by_id[fam2.id]["people"]}
        assert fam1_people == {"Alice": "1", "Bob": "2"}
        # Carol restarts at 1 in her own family, not a global "3"
        assert fam2_people == {"Carol": "1"}

    def test_deleted_person_does_not_consume_number(self, test_client: TestClient, admin_user, packing_slip_families, db: Session):
        from app.models import Person

        fam1 = packing_slip_families["families"][0]
        bob = packing_slip_families["people"]["fam1"][1]  # 2nd person by id
        dave = Person(family_id=fam1.id, given_name="Dave", age=11)
        db.add(dave)
        db.commit()
        # Soft-delete the middle person
        bob.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        fam1_data = next(item for item in body if item["id"] == fam1.id)
        fam1_people = {p["given_name"]: p["display_id"] for p in fam1_data["people"]}
        # Alice stays 1; Dave is 2nd active person (deleted Bob doesn't consume a number)
        assert fam1_people == {"Alice": "1", "Dave": "2"}

    def test_display_ids_stable_with_family_ids_filter(self, test_client: TestClient, admin_user, packing_slip_families, referrer_record):
        """Filtering to a subset must not renumber families or people."""
        _admin_login(test_client)
        fam2 = packing_slip_families["families"][1]
        resp = test_client.get(f"/api/admin/families/packing-slips?family_ids={fam2.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        # fam2 keeps its position 2 in the referrer's enumeration (not renumbered to 1)
        assert body[0]["display_id"] == f"{referrer_record.id}-2"
        assert body[0]["people"][0]["display_id"] == "1"

    def test_pending_family_does_not_shift_family_numbering(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """A pending family by id doesn't consume a family position."""
        from app.models import Family, FamilyVerificationStatus, Person, WishLockLevel

        fam_a = Family(
            referrer_id=referrer_record.id,
            family_name="Shift A",
            family_wish="Wish",
            contact_name="Contact A",
            phone_number="555-005-0001",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.admin,
        )
        fam_b = Family(
            referrer_id=referrer_record.id,
            family_name="Shift B (pending)",
            family_wish="Wish",
            contact_name="Contact B",
            phone_number="555-005-0002",
            verification_status=FamilyVerificationStatus.pending,
            wish_lock_level=WishLockLevel.admin,
        )
        fam_c = Family(
            referrer_id=referrer_record.id,
            family_name="Shift C",
            family_wish="Wish",
            contact_name="Contact C",
            phone_number="555-005-0003",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add_all([fam_a, fam_b, fam_c])
        db.commit()
        db.refresh(fam_a)
        db.refresh(fam_c)

        pa = Person(family_id=fam_a.id, given_name="Pasha", age=8)
        pc = Person(family_id=fam_c.id, given_name="Cleo", age=9)
        db.add_all([pa, pc])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        body = resp.json()

        by_id = {item["id"]: item for item in body}
        assert len(body) == 2  # pending fam_b is not included
        assert by_id[fam_a.id]["display_id"] == f"{referrer_record.id}-1"
        # fam_c is family 2, not 3 — the pending family doesn't consume a position
        assert by_id[fam_c.id]["display_id"] == f"{referrer_record.id}-2"
        assert by_id[fam_a.id]["people"][0]["display_id"] == "1"
        assert by_id[fam_c.id]["people"][0]["display_id"] == "1"
