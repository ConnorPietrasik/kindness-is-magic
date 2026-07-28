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
    assert data["family_name"] == family.family_name
    assert data["family_wish"] == family.family_wish
    assert data["bio"] == family.bio
    assert len(data["people"]) == len(family_with_people["people"])

    # Check person fields
    people = family_with_people["people"]
    for i, person in enumerate(people):
        assert data["people"][i]["given_name"] == person.given_name
        assert data["people"][i]["age"] == person.age
        assert data["people"][i]["practical_wish"] == person.practical_wish
        assert data["people"][i]["fun_wish"] == person.fun_wish
        assert data["people"][i]["title"] == person.title
        assert data["people"][i]["note"] == person.note


def test_wish_list_includes_optional_fields(db, test_client: TestClient, family_record):
    """Person title and note are included when set."""
    person = Person(
        family_id=family_record.id,
        given_name="Bella",
        age=5,
        practical_wish="A coat",
        fun_wish="A teddy",
        title="Miss",
        note="Allergic to peanuts",
    )
    db.add(person)
    db.commit()
    db.refresh(person)

    resp = test_client.get(f"/api/families/{family_record.id}/wish-list")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["people"]) == 1
    assert data["people"][0]["title"] == "Miss"
    assert data["people"][0]["note"] == "Allergic to peanuts"


def test_wish_list_people_ordered_by_id(db, test_client: TestClient, family_record):
    """People are returned ordered by id (oldest first)."""
    p1 = Person(
        family_id=family_record.id,
        given_name="Zebra",
        age=10,
        practical_wish="Shoes",
        fun_wish="Ball",
    )
    db.add(p1)
    db.commit()
    db.refresh(p1)

    p2 = Person(
        family_id=family_record.id,
        given_name="Alice",
        age=8,
        practical_wish="Backpack",
        fun_wish="Doll",
    )
    db.add(p2)
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
    active = Person(
        family_id=family_record.id,
        given_name="Active",
        age=6,
        practical_wish="Shoes",
        fun_wish="Toy",
    )
    deleted = Person(
        family_id=family_record.id,
        given_name="Deleted",
        age=7,
        practical_wish="Hat",
        fun_wish="Book",
        deleted_at=datetime.now(timezone.utc),
    )
    db.add_all([active, deleted])
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
