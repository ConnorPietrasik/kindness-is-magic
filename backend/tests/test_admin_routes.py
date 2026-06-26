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

    def test_200_with_data(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["referrers"]) == 1
        assert body["referrers"][0]["name"] == "Test Referrer"

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 403


class TestAdminGetReferrer:
    def test_200_detail_with_family_count(
        self, test_client: TestClient, admin_user, referrer_with_families
    ):
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

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/referrers/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/referrers/1")
        assert resp.status_code == 403


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

    def test_422_bad_name_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "",
                "family_limit": 5,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 422

    def test_422_bad_family_limit_zero(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 0,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 422

    def test_422_bad_family_limit_over(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 1000,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 422

    def test_422_bad_phone_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 5,
                "phone_number": "",
            },
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 5,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.post(
            "/api/admin/referrers",
            json={
                "name": "New Referrer",
                "family_limit": 5,
                "phone_number": "555-1234",
            },
        )
        assert resp.status_code == 403


class TestAdminUpdateReferrer:
    def test_200_partial_update(
        self, test_client: TestClient, admin_user, referrer_record
    ):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={"name": "Updated Name"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Updated Name"
        assert body["phone_number"] == "555-0001"  # unchanged

    def test_200_full_update(
        self, test_client: TestClient, admin_user, referrer_record
    ):
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

    def test_422_bad_data(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={"name": ""},
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, referrer_record):
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={"name": "Nope"},
        )
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user, referrer_record):
        _referrer_login(test_client)
        resp = test_client.patch(
            f"/api/admin/referrers/{referrer_record.id}",
            json={"name": "Nope"},
        )
        assert resp.status_code == 403


class TestAdminDeleteReferrer:
    def test_204_success(
        self, test_client: TestClient, admin_user, referrer_record
    ):
        _admin_login(test_client)
        resp = test_client.delete(f"/api/admin/referrers/{referrer_record.id}")
        assert resp.status_code == 204

    def test_cascade_families_to_orphan(
        self, test_client: TestClient, admin_user, referrer_with_families, db: Session
    ):
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

    def test_cascade_null_user_referrer_id(
        self, test_client: TestClient, admin_user, referrer_user, db: Session
    ):
        from app.models import User

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

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.delete("/api/admin/referrers/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.delete("/api/admin/referrers/1")
        assert resp.status_code == 403


# =========================================================================
#  Admin — Families
# =========================================================================


class TestAdminListFamilies:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        assert len(resp.json()["families"]) == 0

    def test_200_with_data(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["family_name"] == "TestFamily"

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 403


class TestAdminGetFamily:
    def test_200_detail_with_person_count(
        self, test_client: TestClient, admin_user, family_with_people
    ):
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

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/families/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/families/1")
        assert resp.status_code == 403


class TestAdminCreateFamily:
    def test_201_success(
        self, test_client: TestClient, admin_user, referrer_record
    ):
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

    def test_201_with_optional_fields(
        self, test_client: TestClient, admin_user, referrer_record
    ):
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

    def test_401_unauthenticated(self, test_client: TestClient, referrer_record):
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": referrer_record.id,
                "family_name": "New Family",
                "family_wish": "A bicycle",
                "contact_name": "New Contact",
            },
        )
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user, referrer_record):
        _referrer_login(test_client)
        resp = test_client.post(
            "/api/admin/families",
            json={
                "referrer_id": referrer_record.id,
                "family_name": "New Family",
                "family_wish": "A bicycle",
                "contact_name": "New Contact",
            },
        )
        assert resp.status_code == 403


class TestAdminUpdateFamily:
    def test_200_partial_update(
        self, test_client: TestClient, admin_user, family_record
    ):
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

    def test_422_bad_data(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/families/{family_record.id}",
            json={"family_name": ""},
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, family_record):
        resp = test_client.patch(
            f"/api/admin/families/{family_record.id}",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user, family_record):
        _referrer_login(test_client)
        resp = test_client.patch(
            f"/api/admin/families/{family_record.id}",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 403


class TestAdminDeleteFamily:
    def test_204_success(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.delete(f"/api/admin/families/{family_record.id}")
        assert resp.status_code == 204

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/families/99999")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.delete("/api/admin/families/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.delete("/api/admin/families/1")
        assert resp.status_code == 403


# =========================================================================
#  Admin — People
# =========================================================================


class TestAdminListPeople:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        assert len(resp.json()["people"]) == 0

    def test_200_with_data(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["given_name"] == "Alice"

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 403


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

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/people/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/people/1")
        assert resp.status_code == 403


class TestAdminCreatePerson:
    def test_201_success(
        self, test_client: TestClient, admin_user, family_record
    ):
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

    def test_201_with_optional_fields(
        self, test_client: TestClient, admin_user, family_record
    ):
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

    def test_422_bad_age(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "Diana",
                "age": -1,
                "practical_wish": "A coat",
                "fun_wish": "A puzzle",
            },
        )
        assert resp.status_code == 422

    def test_422_bad_given_name(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "",
                "age": 5,
                "practical_wish": "A coat",
                "fun_wish": "A puzzle",
            },
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, family_record):
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
        assert resp.status_code == 401

    def test_403_non_admin(
        self, test_client: TestClient, referrer_user, family_record
    ):
        _referrer_login(test_client)
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
        assert resp.status_code == 403


class TestAdminUpdatePerson:
    def test_200_partial_update(
        self, test_client: TestClient, admin_user, family_with_people
    ):
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

    def test_200_full_update(
        self, test_client: TestClient, admin_user, family_with_people
    ):
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

    def test_422_bad_data(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={"given_name": ""},
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, family_with_people):
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={"given_name": "Nope"},
        )
        assert resp.status_code == 401

    def test_403_non_admin(
        self, test_client: TestClient, referrer_user, family_with_people
    ):
        _referrer_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={"given_name": "Nope"},
        )
        assert resp.status_code == 403


class TestAdminDeletePerson:
    def test_204_success(
        self, test_client: TestClient, admin_user, family_with_people
    ):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.delete(f"/api/admin/people/{person.id}")
        assert resp.status_code == 204

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/people/99999")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.delete("/api/admin/people/1")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.delete("/api/admin/people/1")
        assert resp.status_code == 403
