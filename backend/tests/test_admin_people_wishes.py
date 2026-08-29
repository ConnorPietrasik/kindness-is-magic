"""Tests for admin person-scoped wish CRUD endpoints.

These test ``/api/admin/people/{per_id}/wishes/*`` which is distinct from
the global wish CRUD at ``/api/admin/wishes/*``.  The person-scoped
endpoints enforce person ownership, duplicate-type checks, and hard-delete
of soft-deleted wishes on re-create.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

from app.models import (
    Family,
    FamilyVerificationStatus,
    Person,
    PersonRole,
    Referrer,
    ReferrerApprovalStatus,
    Wish,
    WishType,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def person_with_wishes(db: Session):
    """Create a child person with practical + fun wishes."""
    ref = Referrer(
        name="Wish Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-PWIS01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Wish Family",
        family_wish="Warm clothes",
        contact_name="Wish Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(family_id=fam.id, given_name="WishChild", age=10, role=PersonRole.son)
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A backpack", size="Medium")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(w1)
    db.refresh(w2)

    return {"person": person, "wishes": [w1, w2]}


@pytest.fixture()
def adult_person_with_wish(db: Session):
    """Create an adult person (age 18+) with an adult wish."""
    ref = Referrer(
        name="Adult Referrer",
        family_limit=10,
        phone_number="555-000-0011",
        family_invite_code="KFI-ADLT01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Adult Family",
        family_wish="Books",
        contact_name="Adult Contact",
        phone_number="555-000-0012",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(family_id=fam.id, given_name="AdultPerson", age=20, role=PersonRole.son)
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.adult, description="A novel")
    db.add(w1)
    db.commit()
    db.refresh(w1)

    return {"person": person, "wishes": [w1]}


@pytest.fixture()
def adult_person_no_wishes(db: Session):
    """Create an adult person with no wishes yet."""
    ref = Referrer(
        name="Adult2 Referrer",
        family_limit=10,
        phone_number="555-000-0031",
        family_invite_code="KFI-ADLT02",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Adult2 Family",
        family_wish="Books",
        contact_name="Adult2 Contact",
        phone_number="555-000-0032",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(family_id=fam.id, given_name="AdultPerson2", age=25, role=PersonRole.son)
    db.add(person)
    db.commit()
    db.refresh(person)

    return {"person": person}


# =========================================================================
# List person wishes — GET /api/admin/people/{per_id}/wishes
# =========================================================================


class TestListPersonWishes:
    def test_200_returns_active_wishes(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        types = {w["type"] for w in body}
        assert types == {"practical", "fun"}

    def test_excludes_soft_deleted_wishes(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Soft-deleted wishes are excluded from the list."""
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1

    def test_200_empty_when_no_wishes(self, test_client: TestClient, admin_user, db: Session):
        """Returns empty list for a person with no wishes."""
        ref = Referrer(
            name="Empty Referrer",
            family_limit=10,
            phone_number="555-000-0021",
            family_invite_code="KFI-EMPT01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Empty Family",
            family_wish="Nothing",
            contact_name="Empty Contact",
            phone_number="555-000-0022",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        person = Person(family_id=fam.id, given_name="EmptyPerson", age=5, role=PersonRole.son)
        db.add(person)
        db.commit()
        db.refresh(person)

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/people/{person.id}/wishes")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_404_person_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people/99999/wishes")
        assert resp.status_code == 404

    def test_404_soft_deleted_person(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Soft-deleted person returns 404."""
        person_with_wishes["person"].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, person_with_wishes):
        resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert resp.status_code == 401


# =========================================================================
# Create person wish — POST /api/admin/people/{per_id}/wishes
# =========================================================================


class TestCreatePersonWish:
    def test_201_creates_adult_wish(self, test_client: TestClient, admin_user, adult_person_no_wishes):
        """Create an adult wish for an adult person (age >= 18)."""
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{adult_person_no_wishes['person'].id}/wishes",
            json={"type": "adult", "description": "A novel", "size": None},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["type"] == "adult"
        assert body["description"] == "A novel"
        assert body["size"] is None
        assert body["person_given_name"] == "AdultPerson2"

    def test_201_creates_with_size(self, test_client: TestClient, admin_user, db: Session):
        """Create an adult wish with a size value."""
        ref = Referrer(
            name="Size Referrer",
            family_limit=10,
            phone_number="555-000-0041",
            family_invite_code="KFI-SIZE01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Size Family",
            family_wish="Toys",
            contact_name="Size Contact",
            phone_number="555-000-0042",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        person = Person(family_id=fam.id, given_name="SizePerson", age=30, role=PersonRole.son)
        db.add(person)
        db.commit()
        db.refresh(person)

        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{person.id}/wishes",
            json={"type": "adult", "description": "A book", "size": "Large"},
        )
        assert resp.status_code == 201
        assert resp.json()["size"] == "Large"

    def test_422_child_cannot_create_single_wish(self, test_client: TestClient, admin_user, person_with_wishes):
        """Child (age < 18): single-wish creation fails validation.

        validate_wishes_for_age requires {practical, fun} but only one
        wish is submitted, so it can never satisfy the constraint.
        """
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes",
            json={"type": "practical", "description": "Another backpack"},
        )
        assert resp.status_code == 422
        assert "practical" in resp.json()["detail"].lower() or "fun" in resp.json()["detail"].lower()

    def test_422_adult_cannot_create_child_type(self, test_client: TestClient, admin_user, adult_person_no_wishes):
        """Adult (age >= 18) cannot create a practical/fun wish."""
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{adult_person_no_wishes['person'].id}/wishes",
            json={"type": "practical", "description": "A backpack"},
        )
        assert resp.status_code == 422
        assert "adult" in resp.json()["detail"].lower()

    def test_409_duplicate_adult_type(self, test_client: TestClient, admin_user, adult_person_with_wish):
        """Cannot create a second adult wish (duplicate type)."""
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{adult_person_with_wish['person'].id}/wishes",
            json={"type": "adult", "description": "Another novel"},
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    def test_201_replaces_soft_deleted_wish(self, test_client: TestClient, admin_user, adult_person_with_wish, db: Session):
        """Creating a wish of a type that was soft-deleted replaces the old row."""
        old_wish = adult_person_with_wish["wishes"][0]  # adult
        old_id = old_wish.id
        old_wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{adult_person_with_wish['person'].id}/wishes",
            json={"type": "adult", "description": "A new novel"},
        )
        assert resp.status_code == 201
        new_id = resp.json()["id"]
        assert new_id != old_id

        # Old row is hard-deleted (gone from DB entirely)
        remaining = db.query(Wish).filter(Wish.id == old_id).first()
        assert remaining is None

    def test_404_person_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people/99999/wishes",
            json={"type": "adult", "description": "A coat"},
        )
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, adult_person_no_wishes):
        resp = test_client.post(
            f"/api/admin/people/{adult_person_no_wishes['person'].id}/wishes",
            json={"type": "adult", "description": "A coat"},
        )
        assert resp.status_code == 401


# =========================================================================
# Update person wish — PATCH /api/admin/people/{per_id}/wishes/{wish_id}
# =========================================================================


class TestUpdatePersonWish:
    def test_200_updates_description(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"description": "Updated description"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated description"

    def test_200_updates_size(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][1]  # fun wish, no size
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"size": "Large"},
        )
        assert resp.status_code == 200
        assert resp.json()["size"] == "Large"

    def test_200_updates_description_and_size(self, test_client: TestClient, admin_user, person_with_wishes):
        """Update both description and size without touching type."""
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"description": "Brand new backpack", "size": "Small"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["description"] == "Brand new backpack"
        assert body["size"] == "Small"
        assert body["type"] == "practical"  # type unchanged

    def test_422_child_cannot_change_wish_type(self, test_client: TestClient, admin_user, person_with_wishes):
        """Changing type on a child's wish fails validation."""
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"type": "fun"},
        )
        assert resp.status_code == 422

    def test_422_adult_cannot_change_to_child_type(self, test_client: TestClient, admin_user, adult_person_with_wish):
        """Adult changing wish type to practical/fun fails validation."""
        _admin_login(test_client)
        wish = adult_person_with_wish["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{adult_person_with_wish['person'].id}/wishes/{wish.id}",
            json={"type": "practical"},
        )
        assert resp.status_code == 422

    def test_404_wish_not_found(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/99999",
            json={"description": "Nope"},
        )
        assert resp.status_code == 404

    def test_404_wish_belongs_to_different_person(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Wish scoped to a different person returns 404."""
        ref = Referrer(
            name="Other Ref",
            family_limit=10,
            phone_number="555-000-0051",
            family_invite_code="KFI-OTHR01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Other Family",
            family_wish="Other wish",
            contact_name="Other Contact",
            phone_number="555-000-0052",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        other_person = Person(family_id=fam.id, given_name="OtherPerson", age=6, role=PersonRole.son)
        db.add(other_person)
        db.flush()

        other_wish = Wish(person_id=other_person.id, type=WishType.practical, description="Other wish")
        db.add(other_wish)
        db.commit()
        db.refresh(other_wish)

        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{other_wish.id}",
            json={"description": "Should fail"},
        )
        assert resp.status_code == 404

    def test_404_person_not_found(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/99999/wishes/{wish.id}",
            json={"description": "Nope"},
        )
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, person_with_wishes):
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"description": "Nope"},
        )
        assert resp.status_code == 401


# =========================================================================
# Delete person wish — DELETE /api/admin/people/{per_id}/wishes/{wish_id}
# =========================================================================


class TestDeletePersonWish:
    def test_204_soft_deletes_wish(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
        )
        assert resp.status_code == 204

        db.expire_all()
        db.refresh(wish)
        assert wish.deleted_at is not None

    def test_excluded_from_list_after_delete(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Deleted wish no longer appears in the list."""
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
        )
        assert resp.status_code == 204

        list_resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 1

    def test_404_wish_not_found(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/99999",
        )
        assert resp.status_code == 404

    def test_404_wish_already_deleted(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Cannot delete an already soft-deleted wish."""
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
        )
        assert resp.status_code == 404

    def test_404_wish_belongs_to_different_person(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Wish scoped to a different person returns 404."""
        ref = Referrer(
            name="Other Ref 2",
            family_limit=10,
            phone_number="555-000-0061",
            family_invite_code="KFI-OTHR02",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Other Family 2",
            family_wish="Other wish",
            contact_name="Other Contact",
            phone_number="555-000-0062",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        other_person = Person(family_id=fam.id, given_name="OtherPerson2", age=6, role=PersonRole.son)
        db.add(other_person)
        db.flush()

        other_wish = Wish(person_id=other_person.id, type=WishType.practical, description="Other wish")
        db.add(other_wish)
        db.commit()
        db.refresh(other_wish)

        _admin_login(test_client)
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{other_wish.id}",
        )
        assert resp.status_code == 404

    def test_404_person_not_found(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.delete(
            f"/api/admin/people/99999/wishes/{wish.id}",
        )
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, person_with_wishes):
        wish = person_with_wishes["wishes"][0]
        resp = test_client.delete(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
        )
        assert resp.status_code == 401


# =========================================================================
# Restore person wish — POST /api/admin/people/{per_id}/wishes/{wish_id}/restore
# =========================================================================


class TestRestorePersonWish:
    def test_200_restores_soft_deleted_wish(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}/restore",
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == wish.id

        db.expire_all()
        db.refresh(wish)
        assert wish.deleted_at is None

    def test_restored_wish_appears_in_list(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Restored wish reappears in the list endpoint."""
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        list_resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert len(list_resp.json()) == 1

        test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}/restore",
        )

        list_resp = test_client.get(f"/api/admin/people/{person_with_wishes['person'].id}/wishes")
        assert len(list_resp.json()) == 2

    def test_400_wish_not_deleted(self, test_client: TestClient, admin_user, person_with_wishes):
        """Cannot restore a wish that is not deleted."""
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}/restore",
        )
        assert resp.status_code == 400
        assert "not deleted" in resp.json()["detail"]

    def test_404_wish_not_found(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/99999/restore",
        )
        assert resp.status_code == 404

    def test_404_wish_belongs_to_different_person(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        """Wish scoped to a different person returns 404."""
        ref = Referrer(
            name="Other Ref 3",
            family_limit=10,
            phone_number="555-000-0071",
            family_invite_code="KFI-OTHR03",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Other Family 3",
            family_wish="Other wish",
            contact_name="Other Contact",
            phone_number="555-000-0072",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        other_person = Person(family_id=fam.id, given_name="OtherPerson3", age=6, role=PersonRole.son)
        db.add(other_person)
        db.flush()

        other_wish = Wish(person_id=other_person.id, type=WishType.practical, description="Other wish")
        db.add(other_wish)
        db.commit()
        db.refresh(other_wish)

        other_wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{other_wish.id}/restore",
        )
        assert resp.status_code == 404

    def test_404_person_not_found(self, test_client: TestClient, admin_user, person_with_wishes, db: Session):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.post(
            f"/api/admin/people/99999/wishes/{wish.id}/restore",
        )
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, person_with_wishes, db: Session):
        wish = person_with_wishes["wishes"][0]
        wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.post(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}/restore",
        )
        assert resp.status_code == 401


# =========================================================================
# Wish color — create/update person sync + single-wish PATCH
# =========================================================================


class TestWishColor:
    def test_201_create_person_stores_wish_color(self, test_client: TestClient, admin_user, family_record):
        """Person creation stores color on each wish via create_person_with_wishes."""
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "ColorKid",
                "role": "daughter",
                "age": 9,
                "wishes": [
                    {"type": "practical", "description": "A coat", "size": "S", "color": "Blue"},
                    {"type": "fun", "description": "A doll", "color": "Red"},
                ],
            },
        )
        assert resp.status_code == 201
        colors = {w["type"]: w["color"] for w in resp.json()["wishes"]}
        assert colors == {"practical": "Blue", "fun": "Red"}

    def test_201_create_person_color_zero_becomes_null(self, test_client: TestClient, admin_user, family_record):
        """'0' color normalizes to NULL on creation (same as size)."""
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/people",
            json={
                "family_id": family_record.id,
                "given_name": "ZeroColor",
                "role": "son",
                "age": 30,
                "wishes": [{"type": "adult", "description": "A book", "color": "0"}],
            },
        )
        assert resp.status_code == 201
        assert resp.json()["wishes"][0]["color"] is None

    def test_200_update_person_syncs_wish_color(self, test_client: TestClient, admin_user, person_with_wishes):
        """Person update syncs color onto existing wishes in place."""
        _admin_login(test_client)
        person = person_with_wishes["person"]
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={
                "wishes": [
                    {"type": "practical", "description": "A backpack", "size": "Medium", "color": "Blue"},
                    {"type": "fun", "description": "A doll", "color": "Red"},
                ],
            },
        )
        assert resp.status_code == 200
        colors = {w["type"]: w["color"] for w in resp.json()["wishes"]}
        assert colors == {"practical": "Blue", "fun": "Red"}

    def test_200_update_person_clears_wish_color(self, test_client: TestClient, admin_user, person_with_wishes):
        """Sending ''/'0' in a wishes sync clears color to NULL (same as size)."""
        _admin_login(test_client)
        person = person_with_wishes["person"]
        # Set color first so the clear below is observable
        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={
                "wishes": [
                    {"type": "practical", "description": "A backpack", "size": "Medium", "color": "Blue"},
                    {"type": "fun", "description": "A doll", "color": "Red"},
                ],
            },
        )
        assert resp.status_code == 200

        resp = test_client.patch(
            f"/api/admin/people/{person.id}",
            json={
                "wishes": [
                    {"type": "practical", "description": "A backpack", "size": "Medium", "color": ""},
                    {"type": "fun", "description": "A doll", "color": "0"},
                ],
            },
        )
        assert resp.status_code == 200
        colors = {w["type"]: w["color"] for w in resp.json()["wishes"]}
        assert colors == {"practical": None, "fun": None}

    def test_200_patch_single_wish_sets_color(self, test_client: TestClient, admin_user, person_with_wishes):
        _admin_login(test_client)
        wish = person_with_wishes["wishes"][0]
        resp = test_client.patch(
            f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{wish.id}",
            json={"color": "Blue"},
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "Blue"

    def test_200_patch_single_wish_clears_color(self, test_client: TestClient, admin_user, person_with_wishes):
        """Sending '' clears color to NULL on the single-wish PATCH."""
        _admin_login(test_client)
        base = f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{person_with_wishes['wishes'][0].id}"
        resp = test_client.patch(base, json={"color": "Blue"})
        assert resp.status_code == 200

        resp = test_client.patch(base, json={"color": ""})
        assert resp.status_code == 200
        assert resp.json()["color"] is None

    def test_200_patch_single_wish_clears_size(self, test_client: TestClient, admin_user, person_with_wishes):
        """Sending '' clears size to NULL on the single-wish PATCH."""
        _admin_login(test_client)
        base = f"/api/admin/people/{person_with_wishes['person'].id}/wishes/{person_with_wishes['wishes'][0].id}"
        resp = test_client.patch(base, json={"size": ""})
        assert resp.status_code == 200
        assert resp.json()["size"] is None

    def test_200_type_change_with_empty_size(self, test_client: TestClient, admin_user, adult_person_with_wish):
        """Re-sending the type alongside size '' must not break type validation.

        '' arrives as the _CLEAR sentinel; the WishCreate validation must
        treat it as None rather than choking on the sentinel object.
        """
        _admin_login(test_client)
        base = f"/api/admin/people/{adult_person_with_wish['person'].id}/wishes/{adult_person_with_wish['wishes'][0].id}"
        resp = test_client.patch(base, json={"size": "Large"})
        assert resp.status_code == 200

        resp = test_client.patch(base, json={"type": "adult", "size": ""})
        assert resp.status_code == 200
        assert resp.json()["size"] is None
