"""Tests for the family person cap (MAX_FAMILY_PERSONS = 10).

Verifies that:
- Family self-service is blocked at 10 people
- Referrer self-service is blocked at 10 people
- Admin can exceed the cap
- Soft-deleted people don't count toward the cap
"""

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


def _tree_referrer_login(client: TestClient) -> dict:
    return login_as(client, "tree_referrer@test.com", "TreeRef1234!")


def _child_wishes():
    """Return valid wishes for a child (under 18)."""
    return [
        {"type": "practical", "description": "A coat"},
        {"type": "fun", "description": "A toy"},
    ]


def _seed_people(db: Session, family_id: int, count: int) -> None:
    """Create *count* Person rows for the given family."""
    from app.models import Person, PersonRole, Wish, WishType

    for i in range(count):
        person = Person(
            family_id=family_id,
            given_name=f"Person {i}",
            age=8,
            role=PersonRole.son,
        )
        db.add(person)
        db.flush()

        db.add(Wish(person_id=person.id, type=WishType.practical, description="A coat"))
        db.add(Wish(person_id=person.id, type=WishType.fun, description="A toy"))

    db.commit()


# =========================================================================
# Family self-service — person cap
# =========================================================================


class TestFamilyPersonCapFamilySelfService:
    """Family user can create up to 10 people, blocked on the 11th."""

    def test_201_can_create_up_to_cap(self, test_client: TestClient, family_user, family_record, db: Session):
        """Family can create the 10th person (reaching the cap)."""
        _seed_people(db, family_record.id, 9)

        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={"given_name": "Tenth", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 201
        assert resp.json()["given_name"] == "Tenth"

    def test_400_blocked_at_cap(self, test_client: TestClient, family_user, family_record, db: Session):
        """Family cannot create an 11th person."""
        _seed_people(db, family_record.id, 10)

        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={"given_name": "Eleventh", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

    def test_soft_deleted_does_not_count(self, test_client: TestClient, family_user, family_record, db: Session):
        """Soft-deleted persons don't block the cap."""
        from app.models import Person
        from datetime import datetime, timezone

        _seed_people(db, family_record.id, 10)
        # Soft-delete one person
        oldest = db.query(Person).filter(Person.family_id == family_record.id).order_by(Person.id).first()
        oldest.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _family_login(test_client)
        resp = test_client.post(
            "/api/family/people",
            json={"given_name": "Replacement", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 201
        assert resp.json()["given_name"] == "Replacement"


# =========================================================================
# Referrer self-service — person cap
# =========================================================================


class TestFamilyPersonCapReferrerSelfService:
    """Referrer can create up to 10 people in a family, blocked on the 11th."""

    def test_201_can_create_up_to_cap(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Referrer can create the 10th person (reaching the cap)."""
        fam = referrer_with_full_tree["family"]
        # Tree family already has 1 person, seed 8 more
        _seed_people(db, fam.id, 8)

        _tree_referrer_login(test_client)
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={"given_name": "Tenth", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 201
        assert resp.json()["given_name"] == "Tenth"

    def test_400_blocked_at_cap(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Referrer cannot create an 11th person."""
        fam = referrer_with_full_tree["family"]
        # Tree family already has 1 person, seed 9 more = 10 total
        _seed_people(db, fam.id, 9)

        _tree_referrer_login(test_client)
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={"given_name": "Eleventh", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

    def test_soft_deleted_does_not_count(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Soft-deleted persons don't block the cap for referrers either."""
        from app.models import Person
        from datetime import datetime, timezone

        fam = referrer_with_full_tree["family"]
        _seed_people(db, fam.id, 9)  # 1 existing + 9 = 10
        # Soft-delete one
        oldest = db.query(Person).filter(Person.family_id == fam.id).order_by(Person.id).first()
        oldest.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={"given_name": "Replacement", "role": "son", "age": 5, "wishes": _child_wishes()},
        )
        assert resp.status_code == 201


# =========================================================================
# Admin — bypasses the cap
# =========================================================================


class TestFamilyPersonCapAdminBypass:
    """Admin can create people beyond the 10-person cap."""

    def test_admin_can_exceed_cap(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Admin can add an 11th person to a family already at 10."""
        _seed_people(db, family_record.id, 10)

        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "Admin Person",
                "role": "son",
                "age": 5,
                "wishes": _child_wishes(),
            },
        )
        assert resp.status_code == 201
        assert resp.json()["given_name"] == "Admin Person"

    def test_admin_can_add_many_beyond_cap(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Admin can add multiple people well past the cap."""
        _seed_people(db, family_record.id, 10)

        _admin_login(test_client)
        for i in range(5):
            resp = test_client.post(
                "/api/admin/people",
                json={
                    "family_id": family_record.id,
                    "given_name": f"Admin Extra {i}",
                    "role": "son",
                    "age": 5,
                    "wishes": _child_wishes(),
                },
            )
            assert resp.status_code == 201, f"Admin should be able to add person {i}"
