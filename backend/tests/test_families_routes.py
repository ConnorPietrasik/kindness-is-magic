"""Tests for the public family endpoints (GET /api/families and GET /api/families/{id}/wish-list)."""

import math
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.models import Person, PersonRole, Wish, WishType
from tests.conftest import make_family

# ---------------------------------------------------------------------------
# 200 — valid family, correct fields returned
# ---------------------------------------------------------------------------


def test_wish_list_returns_200_with_valid_family(db, test_client: TestClient, family_with_people):
    """A valid family ID returns 200 with the expected fields."""
    family = family_with_people["family"]
    family.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get(f"/api/families/{family.id}/wish-list")
    assert resp.status_code == 200

    data = resp.json()
    assert "display_id" in data
    assert data["display_id"] != "0"  # valid position assigned
    assert "family_name" not in data  # intentionally excluded for privacy
    assert data["family_wish"] == "World peace"  # family wish wish row (family_record fixture)
    assert data["bio"] == family.bio
    assert len(data["people"]) == len(family_with_people["people"])

    # Check person fields
    people = family_with_people["people"]
    for i, person in enumerate(people):
        assert data["people"][i]["given_name"] == person.given_name
        assert data["people"][i]["age"] == person.age
        assert data["people"][i]["role"] == person.role.value
        assert data["people"][i]["note"] == person.note
        # Wishes are now returned as an array
        assert len(data["people"][i]["wishes"]) == 2
        wish_types = {w["type"] for w in data["people"][i]["wishes"]}
        assert {"practical", "fun"} == wish_types


def test_wish_list_includes_optional_fields(db, test_client: TestClient, family_record):
    """Person role and note are included."""
    from app.models import Wish, WishType

    family_record.wish_lock_level = "admin"
    person = Person(
        family_id=family_record.id,
        given_name="Bella",
        role=PersonRole.daughter,
        age=5,
        note="Allergic to peanuts",
    )
    db.add(person)
    db.flush()
    w1 = Wish(person_id=person.id, type=WishType.practical, description="A coat")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A teddy")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(person)

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["people"]) == 1
    assert data["people"][0]["role"] == "daughter"
    assert data["people"][0]["note"] == "Allergic to peanuts"
    assert len(data["people"][0]["wishes"]) == 2


def test_wish_list_includes_color(db, test_client: TestClient, family_record):
    """Wishes in the public wish list include the color field."""
    family_record.wish_lock_level = "admin"
    person = Person(
        family_id=family_record.id,
        given_name="Colorful",
        role=PersonRole.daughter,
        age=6,
    )
    db.add(person)
    db.flush()
    w1 = Wish(person_id=person.id, type=WishType.practical, description="A coat", size="S", color="Blue")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A teddy")
    db.add_all([w1, w2])
    db.commit()

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["people"]) == 1
    colors = {w["type"]: w["color"] for w in data["people"][0]["wishes"]}
    assert colors["practical"] == "Blue"
    assert colors["fun"] is None


def test_wish_list_people_ordered_by_id(db, test_client: TestClient, family_record):
    """People are returned ordered by id (oldest first)."""
    from app.models import Wish, WishType

    family_record.wish_lock_level = "admin"
    p1 = Person(
        family_id=family_record.id,
        given_name="Zebra",
        age=10,
        role=PersonRole.son,
    )
    db.add(p1)
    db.flush()
    w1a = Wish(person_id=p1.id, type=WishType.practical, description="Shoes")
    w1b = Wish(person_id=p1.id, type=WishType.fun, description="Ball")
    db.add_all([w1a, w1b])
    db.commit()
    db.refresh(p1)

    p2 = Person(
        family_id=family_record.id,
        given_name="Alice",
        age=8,
        role=PersonRole.son,
    )
    db.add(p2)
    db.flush()
    w2a = Wish(person_id=p2.id, type=WishType.practical, description="Backpack")
    w2b = Wish(person_id=p2.id, type=WishType.fun, description="Doll")
    db.add_all([w2a, w2b])
    db.commit()
    db.refresh(p2)

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert [p["given_name"] for p in data["people"]] == ["Zebra", "Alice"]


# ---------------------------------------------------------------------------
# 404 — non-existent family
# ---------------------------------------------------------------------------


def test_wish_list_returns_404_for_nonexistent_family(test_client: TestClient):
    """A family ID that doesn't exist returns 404."""
    resp = test_client.get("/api/families/99999/wish-list")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 403 — family not fully approved yet
# ---------------------------------------------------------------------------


def test_wish_list_returns_403_for_non_admin_locked_family(test_client: TestClient, family_record):
    """An active family with wish_lock_level != admin returns 403 with an approval note."""
    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 403
    assert "fully approved" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 404 — soft-deleted family
# ---------------------------------------------------------------------------


def test_wish_list_returns_404_for_soft_deleted_family(test_client: TestClient, family_record):
    """A soft-deleted family returns 404."""
    family_record.deleted_at = datetime.now(timezone.utc)
    family_record.id  # noqa: B018 — force flush
    from app.database import SessionLocal

    SessionLocal().commit()

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# People — soft-deleted persons excluded
# ---------------------------------------------------------------------------


def test_wish_list_excludes_soft_deleted_people(db, test_client: TestClient, family_record):
    """Soft-deleted people do not appear in the wish list."""
    from app.models import Wish, WishType

    family_record.wish_lock_level = "admin"
    active = Person(
        family_id=family_record.id,
        given_name="Active",
        age=6,
        role=PersonRole.son,
    )
    db.add(active)
    db.flush()
    wa1 = Wish(person_id=active.id, type=WishType.practical, description="Shoes")
    wa2 = Wish(person_id=active.id, type=WishType.fun, description="Toy")
    db.add_all([wa1, wa2])

    deleted = Person(
        family_id=family_record.id,
        given_name="Deleted",
        age=7,
        deleted_at=datetime.now(timezone.utc),
        role=PersonRole.son,
    )
    db.add(deleted)
    db.flush()
    wd1 = Wish(person_id=deleted.id, type=WishType.practical, description="Hat")
    wd2 = Wish(person_id=deleted.id, type=WishType.fun, description="Book")
    db.add_all([wd1, wd2])
    db.commit()

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["people"]) == 1
    assert data["people"][0]["given_name"] == "Active"


# ---------------------------------------------------------------------------
# Edge case — empty people list
# ---------------------------------------------------------------------------


def test_wish_list_empty_people_list(db, test_client: TestClient, family_record):
    """A family with no people returns an empty people list (200)."""
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert data["people"] == []


# ===========================================================================
# Public families list — GET /api/families
# ===========================================================================


def _make_person(db, family_id, given_name, age):
    """Helper: create a person with wishes for a family."""
    p = Person(family_id=family_id, given_name=given_name, age=age, role=PersonRole.son)
    db.add(p)
    db.flush()
    db.add_all(
        [
            Wish(person_id=p.id, type=WishType.practical, description="Shoes"),
            Wish(person_id=p.id, type=WishType.fun, description="Toy"),
        ]
    )
    db.commit()
    db.refresh(p)
    return p


# ---------------------------------------------------------------------------
# 200 — unauthenticated access
# ---------------------------------------------------------------------------


def test_list_families_no_auth_required(db, test_client: TestClient, family_record):
    """Unauthenticated requests return 200."""
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert "families" in data
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "total_pages" in data


# ---------------------------------------------------------------------------
# Filters out non-eligible families
# ---------------------------------------------------------------------------


def test_list_families_excludes_soft_deleted(db, test_client: TestClient, family_record):
    """Soft-deleted families are excluded from the list."""
    family_record.wish_lock_level = "admin"
    family_record.deleted_at = datetime.now(timezone.utc)
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["families"] == []


def test_list_families_excludes_pending(db, test_client: TestClient, family_record):
    """Pending families are excluded from the list."""
    family_record.verification_status = "pending"
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0


def test_list_families_excludes_rejected(db, test_client: TestClient, family_record):
    """Rejected families are excluded from the list."""
    family_record.verification_status = "rejected"
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0


def test_list_families_excludes_non_admin_lock(db, test_client: TestClient, family_record):
    """Families with wish_lock_level != admin are excluded."""
    family_record.verification_status = "verified"
    family_record.wish_lock_level = "family"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0


def test_list_families_includes_eligible(db, test_client: TestClient, family_record):
    """Verified, non-deleted, admin-locked families appear in the list."""
    family_record.verification_status = "verified"
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["families"]) == 1
    assert data["families"][0]["id"] == family_record.id


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


def test_list_families_pagination(db, test_client: TestClient, referrer_with_families):
    """Pagination works correctly with multiple families."""
    from app.models import FamilyVerificationStatus

    families = referrer_with_families["families"]
    # Set all existing families as eligible
    for fam in families:
        fam.wish_lock_level = "admin"
        fam.verification_status = FamilyVerificationStatus.verified

    # Create more families to test pagination
    for i in range(5):
        fam = make_family(
            db,
            referrer_id=referrer_with_families["referrer"].id,
            family_name=f"Paginated Family {i}",
            family_wish="Something",
            contact_name=f"Contact {i}",
            phone_number=f"555-000-{9000 + i}",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level="admin",
        )
        db.add(fam)
    db.commit()

    total_families = len(families) + 5

    # Request page 1 with page_size=3
    resp = test_client.get("/api/families?page=1&page_size=3")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == total_families
    assert data["page"] == 1
    assert data["page_size"] == 3
    assert data["total_pages"] == math.ceil(total_families / 3)
    assert len(data["families"]) == 3

    # Request page 2
    resp = test_client.get("/api/families?page=2&page_size=3")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"] == 2
    assert len(data["families"]) <= 3

    # page_size max is 100
    resp = test_client.get("/api/families?page_size=101")
    # Should return 422 validation error since max is 100
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Person count filter
# ---------------------------------------------------------------------------


def test_list_families_filter_min_person_count(db, test_client: TestClient, family_record):
    """min_person_count filter works."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    # Create another family with 2 people
    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Big Family",
        family_wish="Lots of stuff",
        contact_name="Big Contact",
        phone_number="555-999-0002",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Bob", 5)
    _make_person(db, fam2.id, "Carol", 10)

    # min_person_count=2 should only return fam2
    resp = test_client.get("/api/families?min_person_count=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == fam2.id
    assert data["families"][0]["person_count"] == 2


def test_list_families_filter_max_person_count(db, test_client: TestClient, family_record):
    """max_person_count filter works."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    # Create another family with 2 people
    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Big Family",
        family_wish="Lots of stuff",
        contact_name="Big Contact",
        phone_number="555-999-0002",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Bob", 5)
    _make_person(db, fam2.id, "Carol", 10)

    # max_person_count=1 should only return family_record
    resp = test_client.get("/api/families?max_person_count=1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == family_record.id


def test_list_families_filter_person_count_range(db, test_client: TestClient, family_record):
    """min_person_count and max_person_count work together."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    from app.models import FamilyVerificationStatus

    # Family with 2 people
    fam2 = make_family(
        db,
        family_name="Med Family",
        family_wish="Stuff",
        contact_name="Med Contact",
        phone_number="555-999-0003",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Bob", 5)
    _make_person(db, fam2.id, "Carol", 10)

    # Family with 3 people
    fam3 = make_family(
        db,
        family_name="Big Family",
        family_wish="More stuff",
        contact_name="Big Contact",
        phone_number="555-999-0004",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam3)
    db.commit()
    db.refresh(fam3)
    _make_person(db, fam3.id, "Dave", 3)
    _make_person(db, fam3.id, "Eve", 7)
    _make_person(db, fam3.id, "Frank", 12)

    # min=2, max=2 should return only fam2
    resp = test_client.get("/api/families?min_person_count=2&max_person_count=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == fam2.id


# ---------------------------------------------------------------------------
# Age range filter
# ---------------------------------------------------------------------------


def test_list_families_filter_min_age(db, test_client: TestClient, family_record):
    """min_age filter works based on youngest person in family."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Young Family",
        family_wish="Stuff",
        contact_name="Young Contact",
        phone_number="555-999-0005",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Baby", 2)

    # min_age=5 should exclude fam2 (youngest is 2)
    resp = test_client.get("/api/families?min_age=5")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == family_record.id


def test_list_families_filter_max_age(db, test_client: TestClient, family_record):
    """max_age filter works based on oldest person in family."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Old Family",
        family_wish="Stuff",
        contact_name="Old Contact",
        phone_number="555-999-0006",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Teen", 16)

    # max_age=12 should exclude fam2 (oldest is 16)
    resp = test_client.get("/api/families?max_age=12")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == family_record.id


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------


def test_list_families_sort_person_count(db, test_client: TestClient, family_record):
    """Sort by person_count ascending and descending."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)

    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Big Family",
        family_wish="Stuff",
        contact_name="Big Contact",
        phone_number="555-999-0007",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Bob", 5)
    _make_person(db, fam2.id, "Carol", 10)

    # Ascending: family_record (1) before fam2 (2)
    resp = test_client.get("/api/families?sort=person_count")
    assert resp.status_code == 200
    data = resp.json()
    assert [f["id"] for f in data["families"]] == [family_record.id, fam2.id]

    # Descending: fam2 (2) before family_record (1)
    resp = test_client.get("/api/families?sort=-person_count")
    assert resp.status_code == 200
    data = resp.json()
    assert [f["id"] for f in data["families"]] == [fam2.id, family_record.id]


def test_list_families_sort_min_age(db, test_client: TestClient, family_record):
    """Sort by min_age ascending and descending."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 10)
    _make_person(db, family_record.id, "Bob", 14)

    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Young Family",
        family_wish="Stuff",
        contact_name="Young Contact",
        phone_number="555-999-0008",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Baby", 3)
    _make_person(db, fam2.id, "Toddler", 5)

    # Ascending: fam2 (min_age=3) before family_record (min_age=10)
    resp = test_client.get("/api/families?sort=min_age")
    assert resp.status_code == 200
    data = resp.json()
    assert data["families"][0]["id"] == fam2.id
    assert data["families"][0]["min_age"] == 3

    # Descending: family_record (min_age=10) before fam2 (min_age=3)
    resp = test_client.get("/api/families?sort=-min_age")
    assert resp.status_code == 200
    data = resp.json()
    assert data["families"][0]["id"] == family_record.id


def test_list_families_sort_max_age(db, test_client: TestClient, family_record):
    """Sort by max_age ascending and descending."""
    family_record.wish_lock_level = "admin"
    _make_person(db, family_record.id, "Alice", 8)
    _make_person(db, family_record.id, "Bob", 10)

    from app.models import FamilyVerificationStatus

    fam2 = make_family(
        db,
        family_name="Old Family",
        family_wish="Stuff",
        contact_name="Old Contact",
        phone_number="555-999-0009",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level="admin",
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)
    _make_person(db, fam2.id, "Teen", 16)

    # Ascending: family_record (max_age=10) before fam2 (max_age=16)
    resp = test_client.get("/api/families?sort=max_age")
    assert resp.status_code == 200
    data = resp.json()
    assert data["families"][0]["id"] == family_record.id

    # Descending: fam2 (max_age=16) before family_record (max_age=10)
    resp = test_client.get("/api/families?sort=-max_age")
    assert resp.status_code == 200
    data = resp.json()
    assert data["families"][0]["id"] == fam2.id


# ---------------------------------------------------------------------------
# Display ID — flat format
# ---------------------------------------------------------------------------


def test_list_families_display_id_flat_format(db, test_client: TestClient, family_record):
    """Display IDs use flat (unscoped) format via compute_display_ids."""
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["families"]) == 1
    display_id = data["families"][0]["display_id"]
    # Flat format: "{referrer_id_or_0}-{position}"
    assert "-" in display_id
    parts = display_id.split("-")
    assert len(parts) == 2
    assert parts[1] == "1"  # first position


# ---------------------------------------------------------------------------
# No PII leaked
# ---------------------------------------------------------------------------


def test_list_families_no_pii_leaked(db, test_client: TestClient, family_record):
    """Response contains only allowed fields, no PII."""
    family_record.wish_lock_level = "admin"
    family_record.bio = "We are a wonderful family"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["families"]) == 1
    family = data["families"][0]

    # Allowed fields
    assert "id" in family
    assert "display_id" in family
    assert "bio" in family
    assert "person_count" in family
    assert "min_age" in family
    assert "max_age" in family

    # PII should NOT be present
    assert "family_name" not in family
    assert "contact_name" not in family
    assert "phone_number" not in family
    assert "address" not in family
    assert "family_wish" not in family


# ---------------------------------------------------------------------------
# Edge case — empty result set
# ---------------------------------------------------------------------------


def test_list_families_empty_result(db, test_client: TestClient):
    """Empty database returns empty list with total=0."""
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert data["families"] == []
    assert data["total"] == 0
    assert data["page"] == 1
    assert data["page_size"] == 12
    assert data["total_pages"] == 0


# ---------------------------------------------------------------------------
# Person count / age for families with no people
# ---------------------------------------------------------------------------


def test_list_families_family_with_no_people(db, test_client: TestClient, family_record):
    """Families with no people show person_count=0 and null ages."""
    family_record.wish_lock_level = "admin"
    db.commit()
    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["families"]) == 1
    assert data["families"][0]["person_count"] == 0
    assert data["families"][0]["min_age"] is None
    assert data["families"][0]["max_age"] is None


# ---------------------------------------------------------------------------
# Sponsored visibility (hide others' sponsored families by default)
# ---------------------------------------------------------------------------


def _make_donor_user(db, email: str, password: str = "DonorPass1234!") -> int:
    """Create a donor user directly in the DB. Returns the user id."""
    from app.auth import get_password_hash
    from app.models import User, UserRole

    donor = User(email=email, hashed_password=get_password_hash(password), role=UserRole.donor, display_name=None)
    db.add(donor)
    db.flush()
    return donor.id


def _make_claim(db, donor_user_id: int, family_id: int, *, fulfilled: bool = False, deleted: bool = False) -> None:
    """Create a FamilyClaim row directly in the DB."""
    from app.models import CommitmentType, FamilyClaim

    claim = FamilyClaim(
        donor_user_id=donor_user_id,
        family_id=family_id,
        commitment_type=CommitmentType.gifts,
        fulfilled_at=datetime.now(timezone.utc) if fulfilled else None,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db.add(claim)
    db.commit()


def _eligible_family(db, family_name: str):
    """Create a verified, admin-locked family (public-list eligible)."""
    from app.models import FamilyVerificationStatus, WishLockLevel

    fam = make_family(
        db,
        family_name=family_name,
        family_wish="Warm clothes",
        contact_name="Contact",
        phone_number="555-000-0001",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    return fam


def test_list_families_hides_sponsored_by_default(db, test_client: TestClient, family_record, admin_user):
    """A family with an active claim is hidden from the default list but
    revealed (flagged sponsored) for admins via show_sponsored=true."""
    from app.models import FamilyVerificationStatus, WishLockLevel
    from tests.conftest import login_as

    family_record.verification_status = FamilyVerificationStatus.verified
    family_record.wish_lock_level = WishLockLevel.admin
    db.commit()
    donor_id = _make_donor_user(db, "sponsor@test.com")
    _make_claim(db, donor_id, family_record.id)

    resp = test_client.get("/api/families")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get("/api/families?show_sponsored=true")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == family_record.id
    assert data["families"][0]["sponsored"] is True
    assert data["families"][0]["claimed_by_current_user"] is False


def test_list_families_hides_fulfilled_claims_by_default(db, test_client: TestClient, family_record, admin_user):
    """A fulfilled (non-deleted) claim also hides the family by default;
    an admin can reveal it with show_sponsored=true."""
    from app.models import FamilyVerificationStatus, WishLockLevel
    from tests.conftest import login_as

    family_record.verification_status = FamilyVerificationStatus.verified
    family_record.wish_lock_level = WishLockLevel.admin
    db.commit()
    donor_id = _make_donor_user(db, "sponsor@test.com")
    _make_claim(db, donor_id, family_record.id, fulfilled=True)

    assert test_client.get("/api/families").json()["total"] == 0

    login_as(test_client, "admin@test.com", "AdminPass123!")
    data = test_client.get("/api/families?show_sponsored=true").json()
    assert data["total"] == 1
    assert data["families"][0]["sponsored"] is True


def test_list_families_soft_deleted_claim_keeps_family_visible(db, test_client: TestClient, family_record):
    """A soft-deleted claim frees the family: visible by default, not sponsored."""
    from app.models import FamilyVerificationStatus, WishLockLevel

    family_record.verification_status = FamilyVerificationStatus.verified
    family_record.wish_lock_level = WishLockLevel.admin
    db.commit()
    donor_id = _make_donor_user(db, "sponsor@test.com")
    _make_claim(db, donor_id, family_record.id, deleted=True)

    data = test_client.get("/api/families").json()
    assert data["total"] == 1
    assert data["families"][0]["sponsored"] is False


def test_list_families_sponsored_flags_mixed(db, test_client: TestClient, family_record, admin_user):
    """Admin (show_sponsored): sponsored flag distinguishes claimed vs open
    families."""
    from app.models import FamilyVerificationStatus, WishLockLevel
    from tests.conftest import login_as

    open_fam = _eligible_family(db, "Open Family")
    claimed_fam = _eligible_family(db, "Claimed Family")
    family_record.verification_status = FamilyVerificationStatus.verified
    family_record.wish_lock_level = WishLockLevel.admin
    db.commit()
    donor_id = _make_donor_user(db, "sponsor@test.com")
    _make_claim(db, donor_id, claimed_fam.id)

    login_as(test_client, "admin@test.com", "AdminPass123!")
    data = test_client.get("/api/families?show_sponsored=true").json()
    by_id = {fam["id"]: fam for fam in data["families"]}
    assert data["total"] == 3
    assert by_id[claimed_fam.id]["sponsored"] is True
    assert by_id[open_fam.id]["sponsored"] is False
    assert by_id[family_record.id]["sponsored"] is False
    # No one is logged in — nobody's claim belongs to the current user
    assert all(fam["claimed_by_current_user"] is False for fam in data["families"])


def test_list_families_claimed_by_current_user_flag(db, test_client: TestClient, family_record):
    """A logged-in donor sees claimed_by_current_user on their own claim."""
    from app.models import FamilyVerificationStatus, WishLockLevel
    from tests.conftest import login_as

    family_record.verification_status = FamilyVerificationStatus.verified
    family_record.wish_lock_level = WishLockLevel.admin
    db.commit()
    donor_id = _make_donor_user(db, "sponsor@test.com")
    _make_claim(db, donor_id, family_record.id)

    login_as(test_client, "sponsor@test.com", "DonorPass1234!")
    data = test_client.get("/api/families").json()
    assert data["total"] == 1
    assert data["families"][0]["sponsored"] is True
    assert data["families"][0]["claimed_by_current_user"] is True


def test_list_families_logged_in_user_sees_own_claim(db, test_client: TestClient, family_record, admin_user):
    """A logged-in donor sees their own sponsored family (badged) but not
    other people's sponsored families, without show_sponsored."""
    from tests.conftest import login_as

    own_fam = _eligible_family(db, "My Claimed Family")
    other_fam = _eligible_family(db, "Someone Else Family")
    donor_id = _make_donor_user(db, "me@test.com")
    other_donor_id = _make_donor_user(db, "other@test.com")
    _make_claim(db, donor_id, own_fam.id)
    _make_claim(db, other_donor_id, other_fam.id)

    # Anonymous: both sponsored families hidden
    data = test_client.get("/api/families").json()
    assert data["total"] == 0

    # Logged-in donor, default list: only their own claim is visible
    login_as(test_client, "me@test.com", "DonorPass1234!")
    data = test_client.get("/api/families").json()
    assert data["total"] == 1
    assert data["families"][0]["id"] == own_fam.id
    assert data["families"][0]["sponsored"] is True
    assert data["families"][0]["claimed_by_current_user"] is True

    # show_sponsored is admin-only: a donor passing it gets the same list
    data = test_client.get("/api/families?show_sponsored=true").json()
    assert data["total"] == 1

    # Admin: default list hides both (others' claims); show_sponsored reveals all
    login_as(test_client, "admin@test.com", "AdminPass123!")
    assert test_client.get("/api/families").json()["total"] == 0
    data = test_client.get("/api/families?show_sponsored=true").json()
    assert data["total"] == 2


def test_list_families_fulfilled_count_zero_without_claims(db, test_client: TestClient, family_record):
    """No fulfilled claims — fulfilled_count is 0."""
    assert test_client.get("/api/families").json()["fulfilled_count"] == 0


def test_list_families_fulfilled_count(db, test_client: TestClient, family_record):
    """fulfilled_count counts non-deleted fulfilled claims on non-deleted
    families only — active claims, soft-deleted claims, and soft-deleted
    families don't count. It ignores filters and show_sponsored."""
    active_fam = _eligible_family(db, "Active Claim Family")
    fulfilled_fam = _eligible_family(db, "Fulfilled Family")
    deleted_claim_fam = _eligible_family(db, "Deleted Claim Family")
    deleted_fam = _eligible_family(db, "Deleted Family")
    deleted_fam.deleted_at = datetime.now(timezone.utc)
    db.commit()

    donor_id = _make_donor_user(db, "count@test.com")
    _make_claim(db, donor_id, active_fam.id)  # active — doesn't count
    _make_claim(db, donor_id, fulfilled_fam.id, fulfilled=True)  # counts
    _make_claim(db, donor_id, deleted_claim_fam.id, fulfilled=True, deleted=True)  # soft-deleted claim
    _make_claim(db, donor_id, deleted_fam.id, fulfilled=True)  # family is soft-deleted — doesn't count

    assert test_client.get("/api/families").json()["fulfilled_count"] == 1
    assert test_client.get("/api/families?show_sponsored=true").json()["fulfilled_count"] == 1
