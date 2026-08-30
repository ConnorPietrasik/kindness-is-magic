"""Tests for referrer self-service endpoints: /api/referrer/me, /api/referrer/families, /api/referrer/families/{fid}/people."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as, make_family

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tree_referrer_login(client: TestClient) -> dict:
    """Log in as the tree_referrer fixture user."""
    return login_as(client, "tree_referrer@test.com", "TreeRef1234!")


def _another_referrer_login(client: TestClient) -> dict:
    """Log in as the another_referrer fixture user."""
    return login_as(client, "another_referrer@test.com", "AnotherRef1234!")


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


# =========================================================================
# Referrer — Self
# =========================================================================


class TestReferrerGetSelf:
    def test_200_detail(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        ref = referrer_with_full_tree["referrer"]
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == ref.id
        assert body["name"] == "Tree Referrer"
        assert body["family_limit"] == 5
        assert body["phone_number"] == "555-100-1000"
        assert body["family_count"] == 1

    def test_404_missing_referrer_record(self, test_client: TestClient, db: Session):
        """A referrer-role User whose linked Referrer row has been deleted
        (FK ondelete="SET NULL" nulls user.referrer_id) should get 404."""
        from app.models import Referrer, User, UserRole
        from app.auth import get_password_hash

        # Create a referrer and a user linked to it
        ref = Referrer(
            name="Temp Referrer",
            family_limit=5,
            phone_number="555-300-3000",
            family_invite_code="KFI-TEMP01",
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="orphan_ref@test.com",
            hashed_password=get_password_hash("OrphanRef1234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Delete the Referrer row — FK ondelete="SET NULL" nulls user.referrer_id
        db.delete(ref)
        db.commit()
        db.refresh(user)
        assert user.referrer_id is None

        login_as(test_client, "orphan_ref@test.com", "OrphanRef1234!")
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 401

    def test_403_non_referrer(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 403


class TestReferrerUpdateSelf:
    def test_200_own_info(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.patch(
            "/api/referrer/me",
            json={"name": "Updated Tree Referrer", "phone_number": "555-999-9999"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Updated Tree Referrer"
        assert body["phone_number"] == "555-999-9999"
        assert body["family_limit"] == 5  # unchanged

    def test_404_missing_referrer_record(self, test_client: TestClient, db: Session):
        """A referrer-role User whose linked Referrer row is gone should 404
        on update as well."""
        from app.models import Referrer, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Temp Referrer",
            family_limit=5,
            phone_number="555-300-3001",
            family_invite_code="KFI-TEMP02",
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="orphan_ref2@test.com",
            hashed_password=get_password_hash("OrphanRef21234!"),
            role=UserRole.referrer,
            display_name=None,
            referrer_id=ref.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        db.delete(ref)
        db.commit()
        db.refresh(user)
        assert user.referrer_id is None

        login_as(test_client, "orphan_ref2@test.com", "OrphanRef21234!")
        resp = test_client.patch("/api/referrer/me", json={"name": "Nope"})
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.patch("/api/referrer/me", json={"name": "Nope"})
        assert resp.status_code == 401

    def test_403_non_referrer(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.patch("/api/referrer/me", json={"name": "Nope"})
        assert resp.status_code == 403


# =========================================================================
# Referrer — Families
# =========================================================================


class TestReferrerListFamilies:
    def test_200_own_families(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["family_name"] == "Tree Family"
        assert body["families"][0]["family_wish"] == "A new home"
        assert body["families"][0]["person_count"] == 1

    def test_200_empty(self, test_client: TestClient, another_referrer):
        _another_referrer_login(test_client)
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        assert len(resp.json()["families"]) == 0

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 401

    def test_403_non_referrer(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 403


class TestReferrerGetFamily:
    def test_200_detail_with_person_count(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.get(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == fam.id
        assert body["family_name"] == "Tree Family"
        assert body["person_count"] == 1

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/families/99999")
        assert resp.status_code == 404

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):

        # Create a family under another_referrer
        other_fam = make_family(
            db,
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Ref Family",
            family_wish="Something else",
            contact_name="Other Contact",
            phone_number="555-000-0000",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        # Login as tree_referrer and try to access another_referrer's family
        _tree_referrer_login(test_client)
        resp = test_client.get(f"/api/referrer/families/{other_fam.id}")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        fam = referrer_with_full_tree["family"]
        resp = test_client.get(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 401


class TestReferrerCreateFamily:
    def test_201_success(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "New Ref Family",
                "family_wish": "A house",
                "contact_name": "New Contact",
                "address": "none",
                "phone_number": "555-000-0000",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["family_name"] == "New Ref Family"
        assert body["referrer_id"] == referrer_with_full_tree["referrer"].id
        assert body["person_count"] == 0

    def test_201_with_optional_fields(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "Full Family",
                "family_wish": "A car",
                "contact_name": "Full Contact",
                "bio": "We need a car",
                "address": "456 Oak Ave",
                "phone_number": "555-333-3333",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["bio"] == "We need a car"
        assert body["address"] == "456 Oak Ave"
        assert body["phone_number"] == "555-333-3333"

    def test_family_limit_enforced(self, test_client: TestClient, another_referrer, db: Session):
        from app.models import FamilyVerificationStatus, Referrer

        ref = another_referrer["referrer"]
        # Set limit to 1 and create 1 verified family
        db.query(Referrer).filter(Referrer.id == ref.id).update({"family_limit": 1}, synchronize_session=False)
        existing = make_family(
            db,
            referrer_id=ref.id,
            family_name="Limit Family",
            family_wish="A roof",
            contact_name="Limit Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(existing)
        db.commit()

        _another_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "Over Limit",
                "family_wish": "Too many",
                "contact_name": "Nope",
                "address": "none",
                "phone_number": "555-000-0000",
            },
        )
        assert resp.status_code == 400

    def test_422_missing_required(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/families",
            json={"family_name": "Incomplete"},
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "Nope",
                "family_wish": "Nope",
                "contact_name": "Nope",
            },
        )
        assert resp.status_code == 401

    def test_403_non_referrer(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.post(
            "/api/referrer/families",
            json={
                "family_name": "Nope",
                "family_wish": "Nope",
                "contact_name": "Nope",
            },
        )
        assert resp.status_code == 403


class TestReferrerUpdateFamily:
    def test_200_partial_update(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"family_name": "Updated Tree Family"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "Updated Tree Family"
        assert body["contact_name"] == "Tree Contact"  # unchanged

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):

        other_fam = make_family(
            db,
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
            phone_number="555-000-0000",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        _tree_referrer_login(test_client)
        resp = test_client.patch(
            f"/api/referrer/families/{other_fam.id}",
            json={"family_name": "Hacked"},
        )
        assert resp.status_code == 403

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.patch(
            "/api/referrer/families/99999",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        fam = referrer_with_full_tree["family"]
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"family_name": "Nope"},
        )
        assert resp.status_code == 401


class TestReferrerDeleteFamily:
    def test_204_success(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.delete(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 204

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):

        other_fam = make_family(
            db,
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
            phone_number="555-000-0000",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        _tree_referrer_login(test_client)
        resp = test_client.delete(f"/api/referrer/families/{other_fam.id}")
        assert resp.status_code == 403

    def test_404_not_found(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.delete("/api/referrer/families/99999")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.delete("/api/referrer/families/1")
        assert resp.status_code == 401

    def test_delete_cascade_soft_deletes_persons(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Deleting a family must soft-delete all its persons."""
        from app.models import Person

        family = referrer_with_full_tree["family"]
        person = referrer_with_full_tree["person"]
        assert person.deleted_at is None

        _tree_referrer_login(test_client)
        resp = test_client.delete(f"/api/referrer/families/{family.id}")
        assert resp.status_code == 204

        # Person in that family is now soft-deleted
        pid = person.id
        db.expunge(person)
        refreshed = db.get(Person, pid)
        assert refreshed.deleted_at is not None


# =========================================================================
# Referrer — People within a family
# =========================================================================


class TestReferrerListFamilyPeople:
    def test_200_people_in_own_family(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.get(f"/api/referrer/families/{fam.id}/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 1
        assert body["people"][0]["given_name"] == "Tree Person"

    def test_200_empty(self, test_client: TestClient, referrer_with_full_tree, db: Session):

        _tree_referrer_login(test_client)
        ref = referrer_with_full_tree["referrer"]
        empty_fam = make_family(
            db,
            referrer_id=ref.id,
            family_name="Empty Family",
            family_wish="Nothing",
            contact_name="Empty",
            phone_number="555-000-0000",
        )
        db.add(empty_fam)
        db.commit()
        db.refresh(empty_fam)

        resp = test_client.get(f"/api/referrer/families/{empty_fam.id}/people")
        assert resp.status_code == 200
        assert len(resp.json()["people"]) == 0

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):

        other_fam = make_family(
            db,
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
            phone_number="555-000-0000",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        _tree_referrer_login(test_client)
        resp = test_client.get(f"/api/referrer/families/{other_fam.id}/people")
        assert resp.status_code == 403

    def test_404_missing_family(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/families/99999/people")
        assert resp.status_code == 404

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        fam = referrer_with_full_tree["family"]
        resp = test_client.get(f"/api/referrer/families/{fam.id}/people")
        assert resp.status_code == 401


class TestReferrerCreateFamilyPerson:
    def test_201_success(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={
                "given_name": "New Person",
                "role": "daughter",
                "age": 6,
                "wishes": [
                    {"type": "practical", "description": "A coat"},
                    {"type": "fun", "description": "A toy"},
                ],
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["given_name"] == "New Person"
        assert body["family_id"] == fam.id
        assert body["age"] == 6
        assert len(body["wishes"]) == 2

    def test_201_with_optional_fields(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={
                "given_name": "New Person",
                "age": 6,
                "wishes": [
                    {"type": "practical", "description": "A coat", "size": "Small"},
                    {"type": "fun", "description": "A toy"},
                ],
                "role": "daughter",
                "note": "Allergic to nuts",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["role"] == "daughter"
        assert body["note"] == "Allergic to nuts"
        assert len(body["wishes"]) == 2

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):

        other_fam = make_family(
            db,
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
            phone_number="555-000-0000",
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        _tree_referrer_login(test_client)
        resp = test_client.post(
            f"/api/referrer/families/{other_fam.id}/people",
            json={
                "given_name": "Nope",
                "age": 5,
                "wishes": [
                    {"type": "practical", "description": "Nope"},
                    {"type": "fun", "description": "Nope"},
                ],
            },
        )
        assert resp.status_code == 403

    def test_404_missing_family(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/families/99999/people",
            json={
                "given_name": "Nope",
                "age": 5,
                "wishes": [
                    {"type": "practical", "description": "Nope"},
                    {"type": "fun", "description": "Nope"},
                ],
            },
        )
        assert resp.status_code == 404

    def test_422_bad_data(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={
                "given_name": "",
                "age": -1,
                "wishes": [
                    {"type": "practical", "description": "A coat"},
                    {"type": "fun", "description": "A toy"},
                ],
            },
        )
        assert resp.status_code == 422

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={
                "given_name": "Nope",
                "age": 5,
                "wishes": [
                    {"type": "practical", "description": "Nope"},
                    {"type": "fun", "description": "Nope"},
                ],
            },
        )
        assert resp.status_code == 401


# =========================================================================
# Referrer — Pending Families (approval queue)
# =========================================================================


class TestReferrerPendingFamilies:
    def test_200_empty_list(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert body == []

    def test_200_list_pending_only(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        # Create a pending family
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="A roof",
            contact_name="Pending Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == pending.id
        assert body[0]["family_name"] == "Pending Family"
        assert body[0]["verification_status"] == "pending"
        assert body[0]["person_count"] == 0

    def test_excludes_unverified_families(self, test_client: TestClient, referrer_with_full_tree):
        # The tree family is already verified — should not appear
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert all(f["family_name"] != "Tree Family" for f in body)

    def test_excludes_other_referrer_families(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import FamilyVerificationStatus

        other_ref = another_referrer["referrer"]
        pending = make_family(
            db,
            referrer_id=other_ref.id,
            family_name="Other Pending",
            family_wish="A car",
            contact_name="Other Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert all(f["family_name"] != "Other Pending" for f in body)

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 401

    def test_403_family_user_rejected(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 403


class TestReferrerVerifyFamily:
    def test_200_verify_pending(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="To Verify",
            family_wish="A roof",
            contact_name="Verify Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/verify")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == pending.id
        assert body["verification_status"] == "verified"

    def test_verify_increases_family_count(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Count Me",
            family_wish="A roof",
            contact_name="Count Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()

        _tree_referrer_login(test_client)
        # Before: 1 verified family (Tree Family)
        resp = test_client.get("/api/referrer/me")
        assert resp.json()["family_count"] == 1

        # Verify the pending family
        resp = test_client.post(f"/api/referrer/families/{pending.id}/verify")
        assert resp.status_code == 200

        # After: 2 verified families
        resp = test_client.get("/api/referrer/me")
        assert resp.json()["family_count"] == 2

    def test_400_cannot_verify_already_verified(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(f"/api/referrer/families/{fam.id}/verify")
        assert resp.status_code == 400

    def test_400_cannot_verify_rejected(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        rejected = make_family(
            db,
            referrer_id=ref.id,
            family_name="Rejected Family",
            family_wish="A roof",
            contact_name="Rejected Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.rejected,
        )
        db.add(rejected)
        db.commit()
        db.refresh(rejected)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{rejected.id}/verify")
        assert resp.status_code == 400

    def test_400_limit_exceeded_on_verify(self, test_client: TestClient, another_referrer, db: Session):
        from app.models import FamilyVerificationStatus, Referrer

        ref = another_referrer["referrer"]
        db.query(Referrer).filter(Referrer.id == ref.id).update({"family_limit": 1}, synchronize_session=False)
        # Create 1 verified family (at limit)
        verified = make_family(
            db,
            referrer_id=ref.id,
            family_name="At Limit",
            family_wish="A roof",
            contact_name="Limit Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        # Create 1 pending family
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Over Limit",
            family_wish="A car",
            contact_name="Over Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add_all([verified, pending])
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/verify")
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

    def test_403_wrong_referrer(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Not Yours",
            family_wish="A roof",
            contact_name="Not Yours",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/verify")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="No Auth",
            family_wish="A roof",
            contact_name="No Auth",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        resp = test_client.post(f"/api/referrer/families/{pending.id}/verify")
        assert resp.status_code == 401


class TestReferrerRejectFamily:
    def test_200_reject_pending(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="To Reject",
            family_wish="A roof",
            contact_name="Reject Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == pending.id
        assert body["verification_status"] == "rejected"

    def test_reject_sends_email_to_family_contact(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Rejecting a pending family notifies the family contact (mocked)."""
        from unittest.mock import patch

        from app.auth import get_password_hash
        from app.models import EmailKind, FamilyVerificationStatus, User, UserRole

        ref = referrer_with_full_tree["referrer"]
        ref_user = referrer_with_full_tree["user"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Reject Email Family",
            family_wish="A roof",
            contact_name="Reject Email Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        fam_user = User(
            email="fam_reject@test.com",
            hashed_password=get_password_hash("FamPass1234!"),
            role=UserRole.family,
            family_id=pending.id,
            display_name=None,
        )
        db.add(fam_user)
        db.commit()

        captured = {}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            captured.update(_kw)
            return {"sent": True, "reason": None}

        _tree_referrer_login(test_client)
        with patch("app.mail.send_email", side_effect=fake_send_email):
            resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 200
        assert captured["to"] == "fam_reject@test.com"
        assert captured["kind"] == EmailKind.family_rejected
        assert captured["user_id"] == ref_user.id
        body_html = captured["html_body"]
        assert "Reject Email Family" in body_html
        assert ref_user.display_name in body_html
        assert "did not recognize you" in body_html

    def test_reject_without_family_user_skips_email(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """No family user on the family → no email, reject still succeeds."""
        from unittest.mock import patch

        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="No Contact",
            family_wish="A roof",
            contact_name="No Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        with patch("app.mail.send_email") as mock_send:
            resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 200
        assert resp.json()["verification_status"] == "rejected"
        mock_send.assert_not_called()

    def test_400_cannot_reject_already_verified(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(f"/api/referrer/families/{fam.id}/reject")
        assert resp.status_code == 400

    def test_400_cannot_reject_already_rejected(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        rejected = make_family(
            db,
            referrer_id=ref.id,
            family_name="Already Rejected",
            family_wish="A roof",
            contact_name="Rejected Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.rejected,
        )
        db.add(rejected)
        db.commit()
        db.refresh(rejected)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{rejected.id}/reject")
        assert resp.status_code == 400

    def test_403_wrong_referrer(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Not Yours",
            family_wish="A roof",
            contact_name="Not Yours",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="No Auth",
            family_wish="A roof",
            contact_name="No Auth",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 401


# =========================================================================
# Referrer — Send Family Invite Email
# =========================================================================


class TestSendFamilyInvite:
    """POST /api/referrer/send-family-invite"""

    def test_unauthenticated_rejected(self, test_client: TestClient):
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 401

    def test_non_referrer_rejected(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 403

    def test_valid_email_sends_success(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "newfamily@example.com"},
        )
        assert resp.status_code == 200

    def test_invalid_email_format(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "not-an-email"},
        )
        assert resp.status_code == 422

    def test_unsubscribed_email_returns_403(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import EmailPreference
        from datetime import datetime, timezone

        # Subscribe the target email
        pref = EmailPreference(
            email="unsub@example.com",
            unsubscribed_at=datetime.now(timezone.utc),
        )
        db.add(pref)
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "unsub@example.com"},
        )
        assert resp.status_code == 403
        assert "unsubscribed" in resp.json()["detail"].lower()

    def test_email_in_body_is_used(self, test_client: TestClient, referrer_with_full_tree):
        """The email in the request body is passed to send_email."""
        from unittest.mock import patch

        captured_to = {}

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            captured_to["value"] = _kw.get("to")
            return {"sent": True, "reason": None}

        _tree_referrer_login(test_client)
        with patch("app.mail.send_email", side_effect=fake_send_email):
            resp = test_client.post(
                "/api/referrer/send-family-invite",
                json={"email": "target@example.com"},
            )
        assert resp.status_code == 200
        assert captured_to["value"] == "target@example.com"

    def test_build_family_invite_email_called_with_referrer_data(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """build_family_invite_email is called with the referrer's code and name."""
        from unittest.mock import patch

        ref = referrer_with_full_tree["referrer"]
        captured_kwargs = {}

        def fake_build(*_args, **_kw):  # noqa: ANN002, ANN003
            captured_kwargs["value"] = _kw
            return "<html></html>"

        def fake_send_email(*_args, **_kw):  # noqa: ANN002, ANN003
            return {"sent": True, "reason": None}

        _tree_referrer_login(test_client)
        with patch("app.mail.build_family_invite_email", side_effect=fake_build):
            with patch("app.mail.send_email", side_effect=fake_send_email):
                resp = test_client.post(
                    "/api/referrer/send-family-invite",
                    json={"email": "family@example.com"},
                )
        assert resp.status_code == 200
        assert captured_kwargs["value"]["code"] == ref.family_invite_code
        assert captured_kwargs["value"]["referrer_name"] == ref.name

    def test_global_per_recipient_block(self, test_client: TestClient, referrer_with_full_tree, another_referrer):
        """A second referrer cannot send to an address that already received an invite."""
        # First referrer sends to the address (send_email records the log row;
        # SMTP is suppressed in tests)
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 200

        # Second referrer tries the same address — 429
        _another_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 429
        assert "already been sent" in resp.json()["detail"]

    def test_same_referrer_resend_to_same_address_blocked(self, test_client: TestClient, referrer_with_full_tree):
        """The same referrer re-sending to the same address is also blocked."""
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 200

        # Same referrer, same address — 429
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "family@example.com"},
        )
        assert resp.status_code == 429
        assert "already been sent" in resp.json()["detail"]

    def test_lifetime_limit_blocks_after_family_limit(self, test_client: TestClient, referrer_with_full_tree):
        """After sending family_limit invites, further sends return 429."""
        ref = referrer_with_full_tree["referrer"]
        limit = ref.family_limit  # 5

        _tree_referrer_login(test_client)
        # Send up to the limit (send_email records the log rows; SMTP suppressed)
        for i in range(limit):
            resp = test_client.post(
                "/api/referrer/send-family-invite",
                json={"email": f"user{i}@example.com"},
            )
            assert resp.status_code == 200, f"Request {i} should succeed"

        # One past the limit — 429
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "user_past_limit@example.com"},
        )
        assert resp.status_code == 429

    def test_lifetime_limit_counts_records_older_than_24h(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """The cap is lifetime — records older than 24h still count."""
        from datetime import datetime, timedelta, timezone
        from app.models import EmailKind, EmailStatus, SentEmail

        ref = referrer_with_full_tree["referrer"]
        user = referrer_with_full_tree["user"]
        limit = ref.family_limit

        # Seed old records (25 hours ago) — they still count toward the lifetime cap
        old_time = datetime.now(timezone.utc) - timedelta(hours=25)
        for i in range(limit):
            db.add(
                SentEmail(
                    user_id=user.id,
                    recipient_email=f"old{i}@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.sent,
                    sent_at=old_time,
                )
            )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "fresh@example.com"},
        )
        assert resp.status_code == 429
        assert "reached the limit" in resp.json()["detail"]

    def test_seven_day_window_allows_resend(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """After 7 days, the global per-recipient block expires."""
        from datetime import datetime, timedelta, timezone
        from app.models import EmailKind, EmailStatus, SentEmail

        # Seed an old record (8 days ago — should not block)
        old_time = datetime.now(timezone.utc) - timedelta(days=8)
        db.add(
            SentEmail(
                user_id=referrer_with_full_tree["user"].id,
                recipient_email="stale@example.com",
                kind=EmailKind.family_invite,
                status=EmailStatus.sent,
                sent_at=old_time,
            )
        )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "stale@example.com"},
        )
        assert resp.status_code == 200

    # --- Rate limits only count sent family_invite rows ---

    def test_dedup_ignores_other_kinds(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """A non-invite email to the same address (e.g. claim confirmation)
        does not block a family invite."""
        from app.models import EmailKind, EmailStatus, SentEmail, User, UserRole
        from app.auth import get_password_hash

        donor = User(
            email="cap_donor@example.com",
            hashed_password=get_password_hash("DonorPass123!"),
            role=UserRole.donor,
            display_name="Cap Donor",
        )
        db.add(donor)
        db.commit()
        db.refresh(donor)

        db.add(
            SentEmail(
                user_id=donor.id,
                recipient_email="sameaddress@example.com",
                kind=EmailKind.claim_confirmation,
                status=EmailStatus.sent,
            )
        )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "sameaddress@example.com"},
        )
        assert resp.status_code == 200

    def test_dedup_ignores_failed_and_reset_rows(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Failed and admin-reset family invites do not block a resend."""
        from app.models import EmailKind, EmailStatus, SentEmail

        user = referrer_with_full_tree["user"]
        db.add_all(
            [
                SentEmail(
                    user_id=user.id,
                    recipient_email="failed@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.failed,
                    failure_reason="smtp_error",
                ),
                SentEmail(
                    user_id=user.id,
                    recipient_email="reset@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.reset,
                ),
            ]
        )
        db.commit()

        _tree_referrer_login(test_client)
        for addr in ("failed@example.com", "reset@example.com"):
            resp = test_client.post(
                "/api/referrer/send-family-invite",
                json={"email": addr},
            )
            assert resp.status_code == 200, addr

    def test_lifetime_cap_ignores_other_kinds_and_statuses(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Rows that are not sent family invites don't count toward the cap."""
        from app.models import EmailKind, EmailStatus, SentEmail, User, UserRole
        from app.auth import get_password_hash

        ref = referrer_with_full_tree["referrer"]
        user = referrer_with_full_tree["user"]
        limit = ref.family_limit  # 5

        donor = User(
            email="cap2_donor@example.com",
            hashed_password=get_password_hash("DonorPass123!"),
            role=UserRole.donor,
            display_name="Cap2 Donor",
        )
        db.add(donor)
        db.commit()
        db.refresh(donor)

        # Fill the cap with rows that must NOT count:
        # - limit rows of a different kind (sent)
        # - limit rows of the right kind but failed
        # - limit rows of the right kind but reset
        for i in range(limit):
            db.add(
                SentEmail(
                    user_id=donor.id,
                    recipient_email=f"otherkind{i}@example.com",
                    kind=EmailKind.claim_confirmation,
                    status=EmailStatus.sent,
                )
            )
            db.add(
                SentEmail(
                    user_id=user.id,
                    recipient_email=f"capfailed{i}@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.failed,
                    failure_reason="smtp_error",
                )
            )
            db.add(
                SentEmail(
                    user_id=user.id,
                    recipient_email=f"capreset{i}@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.reset,
                )
            )
        db.commit()

        # Cap not reached — the referrer can still send
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "fresh@example.com"},
        )
        assert resp.status_code == 200

    def test_invite_count_in_me_reflects_filters(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """/me invite_count counts only sent family_invite rows for this referrer."""
        from app.models import EmailKind, EmailStatus, SentEmail

        user = referrer_with_full_tree["user"]
        from app.models import User, UserRole
        from app.auth import get_password_hash

        other = User(
            email="count_other@example.com",
            hashed_password=get_password_hash("OtherPass123!"),
            role=UserRole.referrer,
            display_name="Count Other",
        )
        db.add(other)
        db.commit()
        db.refresh(other)

        db.add_all(
            [
                # counts
                SentEmail(user_id=user.id, recipient_email="a@example.com", kind=EmailKind.family_invite, status=EmailStatus.sent),
                # other referrer's sent invite — excluded
                SentEmail(user_id=other.id, recipient_email="b@example.com", kind=EmailKind.family_invite, status=EmailStatus.sent),
                # own row, other kind — excluded
                SentEmail(user_id=user.id, recipient_email="c@example.com", kind=EmailKind.family_verified, status=EmailStatus.sent),
                # own row, failed — excluded
                SentEmail(
                    user_id=user.id,
                    recipient_email="d@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.failed,
                    failure_reason="smtp_error",
                ),
            ]
        )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 200
        assert resp.json()["invite_count"] == 1


# =========================================================================
# Referrer — Invite Email History
# =========================================================================


class TestReferrerInviteEmails:
    """GET /api/referrer/invite-emails"""

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree):
        resp = test_client.get("/api/referrer/invite-emails")
        assert resp.status_code == 401

    def test_403_non_referrer(self, test_client: TestClient, family_user):
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/referrer/invite-emails")
        assert resp.status_code == 403

    def test_empty_list(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/invite-emails")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_only_own_family_invite_rows_all_statuses(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Only this referrer's family_invite rows are returned, all statuses,
        newest first, with the documented item fields."""
        from datetime import datetime, timedelta, timezone
        from app.models import EmailKind, EmailStatus, SentEmail, User, UserRole
        from app.auth import get_password_hash

        user = referrer_with_full_tree["user"]
        other = User(
            email="hist_other@example.com",
            hashed_password=get_password_hash("OtherPass123!"),
            role=UserRole.referrer,
            display_name="Hist Other",
        )
        db.add(other)
        db.commit()
        db.refresh(other)

        now = datetime.now(timezone.utc)
        db.add_all(
            [
                SentEmail(
                    user_id=user.id,
                    recipient_email="newest@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.sent,
                    sent_at=now,
                ),
                SentEmail(
                    user_id=user.id,
                    recipient_email="failed@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.failed,
                    failure_reason="unsubscribed",
                    sent_at=now - timedelta(days=1),
                ),
                SentEmail(
                    user_id=user.id,
                    recipient_email="reset@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.reset,
                    sent_at=now - timedelta(days=2),
                ),
                # Excluded: other user's family invite
                SentEmail(
                    user_id=other.id,
                    recipient_email="other@example.com",
                    kind=EmailKind.family_invite,
                    status=EmailStatus.sent,
                    sent_at=now,
                ),
                # Excluded: own row but other kind
                SentEmail(
                    user_id=user.id,
                    recipient_email="verified@example.com",
                    kind=EmailKind.family_verified,
                    status=EmailStatus.sent,
                    sent_at=now,
                ),
            ]
        )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/invite-emails")
        assert resp.status_code == 200
        items = resp.json()
        assert [i["recipient_email"] for i in items] == [
            "newest@example.com",
            "failed@example.com",
            "reset@example.com",
        ]
        # Item fields
        assert set(items[0].keys()) == {"id", "recipient_email", "status", "failure_reason", "sent_at"}
        assert items[0]["status"] == "sent"
        assert items[0]["failure_reason"] is None
        assert items[1]["status"] == "failed"
        assert items[1]["failure_reason"] == "unsubscribed"
        assert items[2]["status"] == "reset"

    def test_rows_appear_after_sending(self, test_client: TestClient, referrer_with_full_tree):
        """A send via /send-family-invite shows up in the history immediately."""
        _tree_referrer_login(test_client)
        resp = test_client.post(
            "/api/referrer/send-family-invite",
            json={"email": "justsent@example.com"},
        )
        assert resp.status_code == 200

        resp = test_client.get("/api/referrer/invite-emails")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["recipient_email"] == "justsent@example.com"
        assert items[0]["status"] == "sent"
