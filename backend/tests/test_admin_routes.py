"""Tests for admin CRUD endpoints: referrers, families, people."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    """Log in as admin and return cookies (sets them on the client)."""
    return login_as(client, "admin@test.com", "AdminPass123!")


def _referrer_login(client: TestClient) -> dict:
    """Log in as a referrer user."""
    return login_as(client, "referrer@test.com", "RefPass1234!")


def _family_login(client: TestClient) -> dict:
    """Log in as a family user."""
    return login_as(client, "family@test.com", "FamPass1234!")


# =========================================================================
#  Admin — Referrers
# =========================================================================


class TestAdminListReferrers:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 200
        body = resp.json()
        assert "referrers" in body
        assert len(body["referrers"]) == 0
        assert body["total"] == 0
        assert body["page"] == 1
        assert body["page_size"] == 50
        assert body["total_pages"] == 0

    def test_200_with_data(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["referrers"]) == 1
        assert body["referrers"][0]["name"] == "Test Referrer"
        assert body["total"] == 1
        assert body["total_pages"] == 1

    def test_pagination(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Referrer

        _admin_login(test_client)
        # Create 5 referrers
        for i in range(5):
            r = Referrer(name=f"Referrer {i}", family_limit=10, phone_number="555-0000")
            db.add(r)
        db.commit()

        # Page 1, page_size=2
        resp = test_client.get("/api/admin/referrers?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["referrers"]) == 2
        assert body["total"] == 5
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total_pages"] == 3

        # Page 3 (last page)
        resp = test_client.get("/api/admin/referrers?page=3&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["referrers"]) == 1

        # Page beyond range returns empty
        resp = test_client.get("/api/admin/referrers?page=10&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["referrers"]) == 0


class TestAdminGetReferrer:
    def test_200_detail_with_family_count(self, test_client: TestClient, admin_user, referrer_with_families):
        _admin_login(test_client)
        ref = referrer_with_families["referrer"]
        resp = test_client.get(f"/api/admin/referrers/{ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == ref.id
        assert body["name"] == "Test Referrer"
        assert body["family_count"] == 2

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers/99999")
        assert resp.status_code == 404


class TestAdminCreateReferrer:
    def test_201_success(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 5,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "New Referrer"
        assert body["family_limit"] == 5
        assert body["phone_number"] == "555-1234"
        assert body["family_count"] == 0


class TestAdminUpdateReferrer:
    def test_200_partial_update(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={"name": "Updated Name"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Updated Name"
        assert body["phone_number"] == "555-0001"  # unchanged

    def test_200_full_update(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={
                "name": "Fully Updated",
                "family_limit": 20,
                "phone_number": "999-0000",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Fully Updated"
        assert body["family_limit"] == 20
        assert body["phone_number"] == "999-0000"

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            "/api/admin/referrers/99999",
            json={"name": "Nope"},
        )
        assert resp.status_code == 404


class TestAdminDeleteReferrer:
    def test_204_success(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.delete(f"/api/admin/referrers/{referrer_record.id}")
        assert resp.status_code == 204

    def test_cascade_families_to_orphan(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        from app.models import Family

        _admin_login(test_client)
        ref = referrer_with_families["referrer"]
        families = referrer_with_families["families"]

        # Before delete, families point to the referrer
        for f in families:
            db.refresh(f)
            assert f.referrer_id == ref.id

        resp = test_client.delete(f"/api/admin/referrers/{ref.id}")
        assert resp.status_code == 204

        # After delete, families should point to orphan (id=1)
        db.commit()  # flush any pending
        for fid in [f.id for f in families]:
            f = db.get(Family, fid)
            assert f.referrer_id == Family.ORPHAN_REFERRER_ID

    def test_cascade_null_user_referrer_id(self, test_client: TestClient, admin_user, referrer_user, db: Session):

        _admin_login(test_client)
        ref_id = referrer_user.referrer_id

        # Before delete
        db.refresh(referrer_user)
        assert referrer_user.referrer_id == ref_id

        resp = test_client.delete(f"/api/admin/referrers/{ref_id}")
        assert resp.status_code == 204

        # After delete, user.referrer_id should be NULL
        db.commit()
        db.refresh(referrer_user)
        assert referrer_user.referrer_id is None

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/referrers/99999")
        assert resp.status_code == 404


# =========================================================================
#  Admin — Families
# =========================================================================


class TestAdminListFamilies:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 0
        assert body["total"] == 0
        assert body["total_pages"] == 0

    def test_200_with_data(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["family_name"] == "TestFamily"
        assert body["families"][0]["family_wish"] == "World peace"
        assert body["families"][0]["person_count"] == 0
        assert body["total"] == 1
        assert body["total_pages"] == 1

    def test_pagination(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Family

        _admin_login(test_client)
        # Create 4 families
        for i in range(4):
            f = Family(
                referrer_id=Family.ORPHAN_REFERRER_ID,
                family_name=f"Family {i}",
                family_wish="Wish",
                contact_name="Contact",
            )
            db.add(f)
        db.commit()

        # Page 1, page_size=2
        resp = test_client.get("/api/admin/families?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2
        assert body["total"] == 4
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total_pages"] == 2

        # Page 2
        resp = test_client.get("/api/admin/families?page=2&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2


class TestAdminGetFamily:
    def test_200_detail_with_person_count(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        fam = family_with_people["family"]
        resp = test_client.get(f"/api/admin/families/{fam.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == fam.id
        assert body["family_name"] == "TestFamily"
        assert body["person_count"] == 2

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/99999")
        assert resp.status_code == 404


class TestAdminCreateFamily:
    def test_201_success(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": referrer_record.id,
                "family_name": "New Family",
                "family_wish": "A bicycle",
                "contact_name": "New Contact",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["family_name"] == "New Family"
        assert body["referrer_id"] == referrer_record.id
        assert body["person_count"] == 0

    def test_201_with_optional_fields(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": referrer_record.id,
                "family_name": "New Family",
                "family_wish": "A bicycle",
                "contact_name": "New Contact",
                "bio": "We love bikes",
                "address": "123 Main St",
                "phone_number": "555-9999",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["bio"] == "We love bikes"
        assert body["address"] == "123 Main St"
        assert body["phone_number"] == "555-9999"

    def test_404_bad_referrer_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": 99999,
                "family_name": "New Family",
                "family_wish": "A bicycle",
                "contact_name": "New Contact",
            },
        )
        assert resp.status_code == 404

    def test_422_missing_required(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": referrer_record.id,
                "family_name": "New Family",
                # missing family_wish and contact_name
            },
        )
        assert resp.status_code == 422


class TestAdminUpdateFamily:
    def test_200_partial_update(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/families/{family_record.id}",
            json={"family_name": "Updated Family"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "Updated Family"
        assert body["contact_name"] == "Contact Person"  # unchanged

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            "/api/admin/families/99999",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 404


class TestAdminDeleteFamily:
    def test_204_success(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.delete(f"/api/admin/families/{family_record.id}")
        assert resp.status_code == 204

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/families/99999")
        assert resp.status_code == 404

    def test_delete_cascade_soft_deletes_persons(self, test_client: TestClient, admin_user, family_with_people, db: Session):
        """Deleting a family must soft-delete all its persons."""
        from app.models import Person

        family = family_with_people["family"]
        people = family_with_people["people"]
        assert len(people) >= 1

        # Persons start live
        for p in people:
            assert p.is_deleted is False

        _admin_login(test_client)
        resp = test_client.delete(f"/api/admin/families/{family.id}")
        assert resp.status_code == 204

        # Family is soft-deleted
        assert family.is_deleted is True

        # All persons in that family are also soft-deleted
        for p in people:
            pid = p.id
            db.expunge(p)
            refreshed = db.get(Person, pid)
            assert refreshed.is_deleted is True


# =========================================================================
#  Admin — People
# =========================================================================


class TestAdminListPeople:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 0
        assert body["total"] == 0
        assert body["total_pages"] == 0

    def test_200_with_data(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["given_name"] == "Alice"
        assert body["total"] == 2
        assert body["total_pages"] == 1

    def test_pagination(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person

        _admin_login(test_client)
        # Create 5 people in the family
        for i in range(5):
            p = Person(
                family_id=family_record.id,
                given_name=f"Person {i}",
                age=10,
                practical_wish="Wish",
                fun_wish="Fun",
            )
            db.add(p)
        db.commit()

        # Page 1, page_size=2
        resp = test_client.get("/api/admin/people?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["total"] == 5
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total_pages"] == 3

        # Page 3 (last page, 1 item)
        resp = test_client.get("/api/admin/people?page=3&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 1


class TestAdminGetPerson:
    def test_200_detail(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.get(f"/api/admin/people/{person.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == person.id
        assert body["given_name"] == "Alice"
        assert body["age"] == 8
        assert body["practical_wish"] == "A backpack"
        assert body["fun_wish"] == "A doll"

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people/99999")
        assert resp.status_code == 404


class TestAdminCreatePerson:
    def test_201_success(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "Diana",
                "age": 5,
                "practical_wish": "A coat",
                "fun_wish": "A puzzle",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["given_name"] == "Diana"
        assert body["age"] == 5
        assert body["family_id"] == family_record.id
        assert body["note"] is None

    def test_201_with_optional_fields(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "Diana",
                "age": 5,
                "practical_wish": "A coat",
                "fun_wish": "A puzzle",
                "title": "Ms.",
                "note": "Allergic to peanuts",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["title"] == "Ms."
        assert body["note"] == "Allergic to peanuts"

    def test_404_bad_family_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": 99999,
                "given_name": "Diana",
                "age": 5,
                "practical_wish": "A coat",
                "fun_wish": "A puzzle",
            },
        )
        assert resp.status_code == 404


class TestAdminUpdatePerson:
    def test_200_partial_update(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={"given_name": "Alice Updated"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["given_name"] == "Alice Updated"
        assert body["age"] == 8  # unchanged

    def test_200_full_update(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={
                "given_name": "Alicia",
                "age": 9,
                "practical_wish": "A new coat",
                "fun_wish": "A board game",
                "title": "Miss",
                "note": "Updated note",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["given_name"] == "Alicia"
        assert body["age"] == 9
        assert body["practical_wish"] == "A new coat"
        assert body["fun_wish"] == "A board game"
        assert body["title"] == "Miss"
        assert body["note"] == "Updated note"

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            "/api/admin/people/99999",
            json={"given_name": "Nope"},
        )
        assert resp.status_code == 404


class TestAdminDeletePerson:
    def test_204_success(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.delete(f"/api/admin/people/{person.id}")
        assert resp.status_code == 204

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/people/99999")
        assert resp.status_code == 404


# =========================================================================
#  Auth guards (parameterized — replaces per-endpoint 401/403 tests)
# =========================================================================

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/referrers", {}),
    ("GET", "/api/admin/referrers/1", {}),
    ("POST", "/api/admin/referrers", {"name": "R", "family_limit": 1, "phone_number": "555"}),
    ("PATCH", "/api/admin/referrers/1", {"name": "Updated"}),
    ("DELETE", "/api/admin/referrers/1", {}),
    ("GET", "/api/admin/families", {}),
    ("GET", "/api/admin/families/1", {}),
    ("POST", "/api/admin/families", {"referrer_id": 1, "family_name": "F", "family_wish": "W", "contact_name": "C"}),
    ("PATCH", "/api/admin/families/1", {"family_name": "Updated"}),
    ("DELETE", "/api/admin/families/1", {}),
    ("GET", "/api/admin/people", {}),
    ("GET", "/api/admin/people/1", {}),
    ("POST", "/api/admin/people", {"family_id": 1, "given_name": "P", "age": 5, "practical_wish": "W", "fun_wish": "W"}),
    ("PATCH", "/api/admin/people/1", {"given_name": "Updated"}),
    ("DELETE", "/api/admin/people/1", {}),
]


class TestAdminAuthGuards:
    """Parameterized auth guard tests for all admin endpoints.

    Replaces the 15× test_401_unauthenticated + 14× test_403_non_admin
    tests that were previously duplicated across every CRUD class above.
    """

    @pytest.mark.parametrize("method,route,body", ADMIN_ENDPOINTS)
    def test_401_unauthenticated(self, test_client: TestClient, method: str, route: str, body: dict):
        """Unauthenticated requests to any admin endpoint return 401."""
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 401

    @pytest.mark.parametrize("method,route,body", ADMIN_ENDPOINTS)
    def test_403_non_admin(self, test_client: TestClient, referrer_user, method: str, route: str, body: dict):
        """Non-admin users get 403 on any admin endpoint."""
        _referrer_login(test_client)
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 403
