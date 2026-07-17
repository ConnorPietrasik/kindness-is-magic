"""Tests for family self-service endpoints: /api/family/me, /api/family/people."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _family_login(client: TestClient) -> dict:
    return login_as(client, "family@test.com", "FamPass1234!")


def _another_family_login(client: TestClient) -> dict:
    return login_as(client, "another_family@test.com", "AnotherFam1234!")


# =========================================================================
# Family — Self
# =========================================================================


class TestFamilyGetSelf:
    def test_200_detail(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "TestFamily"
        assert body["contact_name"] == "Contact Person"
        assert body["family_wish"] == "World peace"
        assert body["person_count"] == 0

    def test_404_missing_family_record(self, test_client: TestClient, db: Session):
        """Create a family user whose family_id points to a deleted/missing family."""
        from app.models import Family, User, UserRole
        from app.auth import get_password_hash

        fam = Family(
            family_name="Temp Family",
            family_wish="Temporary",
            contact_name="Temp",
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        user = User(
            email="orphan_family@test.com",
            hashed_password=get_password_hash("OrphanFam1234!"),
            role=UserRole.family,
            family_id=fam.id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Delete the family — FK ondelete="SET NULL" will null out user.family_id
        db.delete(fam)
        db.commit()
        db.refresh(user)
        assert user.family_id is None

        login_as(test_client, "orphan_family@test.com", "OrphanFam1234!")
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, family_user):
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 401

    def test_403_non_family(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 403


class TestFamilyUpdateSelf:
    def test_200_own_info(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.patch(
            "/api/family/me",
            json={
                "family_name": "Updated Family",
                "contact_name": "Updated Contact",
                "phone_number": "555-9999",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "Updated Family"
        assert body["contact_name"] == "Updated Contact"
        assert body["phone_number"] == "555-9999"
        assert body["family_wish"] == "World peace"  # unchanged

    def test_404_missing_family_record(self, test_client: TestClient, db: Session):
        from app.models import Family, User, UserRole
        from app.auth import get_password_hash

        fam = Family(
            family_name="Temp Family",
            family_wish="Temporary",
            contact_name="Temp",
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        user = User(
            email="orphan_update@test.com",
            hashed_password=get_password_hash("OrphanUp1234!"),
            role=UserRole.family,
            family_id=fam.id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Delete the family — FK ondelete="SET NULL" will null out user.family_id
        db.delete(fam)
        db.commit()
        db.refresh(user)
        assert user.family_id is None

        login_as(test_client, "orphan_update@test.com", "OrphanUp1234!")
        resp = test_client.patch(
            "/api/family/me",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 404

    def test_200_null_unchanges_nullable_field(self, test_client: TestClient, family_user, family_record):
        """Sending null for a nullable field should leave it unchanged."""
        family_record.bio = "Some bio"
        family_record.address = "123 Main St"
        family_record.phone_number = "555-1234"
        family_record._sa_instance_state.session.commit()

        _family_login(test_client)
        resp = test_client.patch(
            "/api/family/me",
            json={"bio": None},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["bio"] == "Some bio"  # unchanged
        assert body["address"] == "123 Main St"  # unchanged
        assert body["phone_number"] == "555-1234"  # unchanged

    def test_200_empty_string_clears_nullable_field(self, test_client: TestClient, family_user, family_record):
        """Sending '' for a nullable field should clear it to None."""
        family_record.bio = "Some bio"
        family_record.address = "123 Main St"
        family_record.phone_number = "555-1234"
        family_record._sa_instance_state.session.commit()

        _family_login(test_client)
        resp = test_client.patch(
            "/api/family/me",
            json={"bio": "", "address": "", "phone_number": ""},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["bio"] is None  # cleared
        assert body["address"] is None  # cleared
        assert body["phone_number"] is None  # cleared

    def test_401_unauthenticated(self, test_client: TestClient, family_user):
        resp = test_client.patch("/api/family/me", json={"family_name": "Nope"})
        assert resp.status_code == 401

    def test_403_non_family(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.patch("/api/family/me", json={"family_name": "Nope"})
        assert resp.status_code == 403


# =========================================================================
# Family — People
# =========================================================================


class TestFamilyListPeople:
    def test_200_own_people(self, test_client: TestClient, family_user, family_with_people):
        _family_login(test_client)
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["given_name"] == "Alice"

    def test_200_empty(self, test_client: TestClient, family_user):
        """family_user's family has no people by default."""
        _family_login(test_client)
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 200
        assert len(resp.json()["people"]) == 0

    def test_401_unauthenticated(self, test_client: TestClient, family_user):
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 401

    def test_403_non_family(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 403


class TestFamilyCreatePerson:
    def test_201_success(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "New Kid",
                "age": 4,
                "practical_wish": "A jacket",
                "fun_wish": "A balloon",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["given_name"] == "New Kid"
        assert body["age"] == 4
        assert body["note"] is None

    def test_201_with_optional_fields(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "New Kid",
                "age": 4,
                "practical_wish": "A jacket",
                "fun_wish": "A balloon",
                "title": "Mr.",
                "note": "Loves balloons",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["title"] == "Mr."
        assert body["note"] == "Loves balloons"

    def test_422_bad_data(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "",
                "age": -1,
                "practical_wish": "A jacket",
                "fun_wish": "A balloon",
            },
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, family_user):
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "Nope",
                "age": 5,
                "practical_wish": "Nope",
                "fun_wish": "Nope",
            },
        )
        assert resp.status_code == 401

    def test_403_non_family(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(
            "/api/family/people",
            json={
                "given_name": "Nope",
                "age": 5,
                "practical_wish": "Nope",
                "fun_wish": "Nope",
            },
        )
        assert resp.status_code == 403
