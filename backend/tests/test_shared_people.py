"""Tests for shared person endpoints: GET/PATCH/DELETE /api/people/{id}.

These endpoints are used by both referrers and family users with ownership checks.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _tree_referrer_login(client: TestClient) -> dict:
    return login_as(client, "tree_referrer@test.com", "TreeRef1234!")


def _another_referrer_login(client: TestClient) -> dict:
    return login_as(client, "another_referrer@test.com", "AnotherRef1234!")


def _family_login(client: TestClient) -> dict:
    return login_as(client, "family@test.com", "FamPass1234!")


def _another_family_login(client: TestClient) -> dict:
    return login_as(client, "another_family@test.com", "AnotherFam1234!")


# =========================================================================
# Shared Person — GET
# =========================================================================


class TestPersonGetShared:
    def test_200_referrer_gets_own_person(
        self, test_client: TestClient, referrer_with_full_tree
    ):
        _tree_referrer_login(test_client)
        person = referrer_with_full_tree["person"]
        resp = test_client.get(f"/api/people/{person.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == person.id
        assert body["given_name"] == "Tree Person"

    def test_200_family_gets_own_person(
        self, test_client: TestClient, family_user, family_with_people
    ):
        _family_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.get(f"/api/people/{person.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["given_name"] == "Alice"

    def test_200_admin_gets_any(
        self, test_client: TestClient, admin_user, family_with_people
    ):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.get(f"/api/people/{person.id}")
        assert resp.status_code == 200

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/people/99999")
        assert resp.status_code == 404

    def test_403_other_referrers_person(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):
        from app.models import Family, Person

        # Create a family and person under another_referrer
        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        other_person = Person(
            family_id=other_fam.id,
            given_name="Other Person",
            age=5,
            practical_wish="A coat",
            fun_wish="A toy",
        )
        db.add(other_person)
        db.commit()
        db.refresh(other_person)

        # Login as tree_referrer, try to access another_referrer's person
        _tree_referrer_login(test_client)
        resp = test_client.get(f"/api/people/{other_person.id}")
        assert resp.status_code == 403

    def test_403_other_family_person(
        self,
        test_client: TestClient,
        family_user,
        another_family,
        person_in_another_family,
    ):
        other_person = person_in_another_family["person"]

        _family_login(test_client)
        resp = test_client.get(f"/api/people/{other_person.id}")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        person = referrer_with_full_tree["person"]
        resp = test_client.get(f"/api/people/{person.id}")
        assert resp.status_code == 401


# =========================================================================
# Shared Person — PATCH
# =========================================================================


class TestPersonUpdateShared:
    def test_200_referrer_updates_own(
        self, test_client: TestClient, referrer_with_full_tree
    ):
        _tree_referrer_login(test_client)
        person = referrer_with_full_tree["person"]
        resp = test_client.patch(
            f"/api/people/{person.id}",
            json={"given_name": "Updated Tree Person"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["given_name"] == "Updated Tree Person"
        assert body["age"] == 10  # unchanged

    def test_200_family_updates_own(
        self, test_client: TestClient, family_user, family_with_people
    ):
        _family_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/people/{person.id}",
            json={"age": 9},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["age"] == 9
        assert body["given_name"] == "Alice"  # unchanged

    def test_200_admin_updates_any(
        self, test_client: TestClient, admin_user, family_with_people
    ):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.patch(
            f"/api/people/{person.id}",
            json={"given_name": "Admin Updated Alice"},
        )
        assert resp.status_code == 200
        assert resp.json()["given_name"] == "Admin Updated Alice"

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.patch(
            "/api/people/99999",
            json={"given_name": "Nope"},
        )
        assert resp.status_code == 404

    def test_403_referrer_other_referrers_person(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):
        from app.models import Family, Person

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        other_person = Person(
            family_id=other_fam.id,
            given_name="Other Person",
            age=5,
            practical_wish="A coat",
            fun_wish="A toy",
        )
        db.add(other_person)
        db.commit()
        db.refresh(other_person)

        _tree_referrer_login(test_client)
        resp = test_client.patch(
            f"/api/people/{other_person.id}",
            json={"given_name": "Hacked"},
        )
        assert resp.status_code == 403

    def test_403_family_other_family_person(
        self,
        test_client: TestClient,
        family_user,
        another_family,
        person_in_another_family,
    ):
        other_person = person_in_another_family["person"]
        _family_login(test_client)
        resp = test_client.patch(
            f"/api/people/{other_person.id}",
            json={"given_name": "Hacked"},
        )
        assert resp.status_code == 403

    def test_422_bad_data(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        person = referrer_with_full_tree["person"]
        resp = test_client.patch(
            f"/api/people/{person.id}",
            json={"given_name": ""},
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        person = referrer_with_full_tree["person"]
        resp = test_client.patch(
            f"/api/people/{person.id}",
            json={"given_name": "Nope"},
        )
        assert resp.status_code == 401


# =========================================================================
# Shared Person — DELETE
# =========================================================================


class TestPersonDeleteShared:
    def test_204_referrer_deletes_own(
        self, test_client: TestClient, referrer_with_full_tree
    ):
        _tree_referrer_login(test_client)
        person = referrer_with_full_tree["person"]
        resp = test_client.delete(f"/api/people/{person.id}")
        assert resp.status_code == 204

    def test_204_family_deletes_own(
        self, test_client: TestClient, family_user, family_with_people
    ):
        _family_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.delete(f"/api/people/{person.id}")
        assert resp.status_code == 204

    def test_204_admin_deletes_any(
        self, test_client: TestClient, admin_user, family_with_people
    ):
        _admin_login(test_client)
        person = family_with_people["people"][0]
        resp = test_client.delete(f"/api/people/{person.id}")
        assert resp.status_code == 204

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.delete("/api/people/99999")
        assert resp.status_code == 404

    def test_403_referrer_other_referrers_person(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):
        from app.models import Family, Person

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        other_person = Person(
            family_id=other_fam.id,
            given_name="Other Person",
            age=5,
            practical_wish="A coat",
            fun_wish="A toy",
        )
        db.add(other_person)
        db.commit()
        db.refresh(other_person)

        _tree_referrer_login(test_client)
        resp = test_client.delete(f"/api/people/{other_person.id}")
        assert resp.status_code == 403

    def test_403_family_other_family_person(
        self,
        test_client: TestClient,
        family_user,
        another_family,
        person_in_another_family,
    ):
        other_person = person_in_another_family["person"]
        _family_login(test_client)
        resp = test_client.delete(f"/api/people/{other_person.id}")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        person = referrer_with_full_tree["person"]
        resp = test_client.delete(f"/api/people/{person.id}")
        assert resp.status_code == 401
