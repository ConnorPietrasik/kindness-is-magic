"""Tests for the public family wish-list endpoint (GET /api/families/{id}/wish-list)."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.models import Person


# ---------------------------------------------------------------------------
# 200 — valid family, correct fields returned
# ---------------------------------------------------------------------------


def test_wish_list_returns_200_with_valid_family(test_client: TestClient, family_with_people):
    """A valid family ID returns 200 with the expected fields."""
    family = family_with_people["family"]
    resp = test_client.get(f"/api/families/{family.id}/wish-list")
    assert resp.status_code == 200

    data = resp.json()
    assert "display_id" in data
    assert data["display_id"] != "0"  # valid position assigned
    assert "family_name" not in data  # intentionally excluded for privacy
    assert data["family_wish"] == family.family_wish
    assert data["bio"] == family.bio
    assert len(data["people"]) == len(family_with_people["people"])

    # Check person fields
    people = family_with_people["people"]
    for i, person in enumerate(people):
        assert data["people"][i]["given_name"] == person.given_name
        assert data["people"][i]["age"] == person.age
        assert data["people"][i]["title"] == person.title
        assert data["people"][i]["note"] == person.note
        # Wishes are now returned as an array
        assert len(data["people"][i]["wishes"]) == 2
        wish_types = {w["type"] for w in data["people"][i]["wishes"]}
        assert {"practical", "fun"} == wish_types


def test_wish_list_includes_optional_fields(db, test_client: TestClient, family_record):
    """Person title and note are included when set."""
    from app.models import Wish, WishType

    person = Person(
        family_id=family_record.id,
        given_name="Bella",
        age=5,
        title="Miss",
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
    assert data["people"][0]["title"] == "Miss"
    assert data["people"][0]["note"] == "Allergic to peanuts"
    assert len(data["people"][0]["wishes"]) == 2


def test_wish_list_people_ordered_by_id(db, test_client: TestClient, family_record):
    """People are returned ordered by id (oldest first)."""
    from app.models import Wish, WishType

    p1 = Person(
        family_id=family_record.id,
        given_name="Zebra",
        age=10,
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

    active = Person(
        family_id=family_record.id,
        given_name="Active",
        age=6,
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


def test_wish_list_empty_people_list(test_client: TestClient, family_record):
    """A family with no people returns an empty people list (200)."""
    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert data["people"] == []
