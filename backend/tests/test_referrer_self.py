"""Tests for referrer self-service endpoints: /api/referrer/me, /api/referrer/families, /api/referrer/families/{fid}/people."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

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
        assert body["phone_number"] == "555-1000"
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
            phone_number="555-3000",
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="orphan_ref@test.com",
            hashed_password=get_password_hash("OrphanRef1234!"),
            role=UserRole.referrer,
            referrer_id=ref.id,
            is_active=True,
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
            json={"name": "Updated Tree Referrer", "phone_number": "555-9999"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Updated Tree Referrer"
        assert body["phone_number"] == "555-9999"
        assert body["family_limit"] == 5  # unchanged

    def test_404_missing_referrer_record(self, test_client: TestClient, db: Session):
        """A referrer-role User whose linked Referrer row is gone should 404
        on update as well."""
        from app.models import Referrer, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Temp Referrer",
            family_limit=5,
            phone_number="555-3001",
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        user = User(
            email="orphan_ref2@test.com",
            hashed_password=get_password_hash("OrphanRef21234!"),
            role=UserRole.referrer,
            referrer_id=ref.id,
            is_active=True,
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
        from app.models import Family

        # Create a family under another_referrer
        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Ref Family",
            family_wish="Something else",
            contact_name="Other Contact",
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
                "phone_number": "555-3333",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["bio"] == "We need a car"
        assert body["address"] == "456 Oak Ave"
        assert body["phone_number"] == "555-3333"

    def test_family_limit_enforced(self, test_client: TestClient, another_referrer, db: Session):
        from app.models import Family, FamilyApprovalStatus, Referrer

        ref = another_referrer["referrer"]
        # Set limit to 1 and create 1 approved family
        db.query(Referrer).filter(Referrer.id == ref.id).update({"family_limit": 1}, synchronize_session=False)
        existing = Family(
            referrer_id=ref.id,
            family_name="Limit Family",
            family_wish="A roof",
            contact_name="Limit Contact",
            approval_status=FamilyApprovalStatus.approved,
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
        from app.models import Family

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
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
        from app.models import Family

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
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
        from app.models import Family

        _tree_referrer_login(test_client)
        ref = referrer_with_full_tree["referrer"]
        empty_fam = Family(
            referrer_id=ref.id,
            family_name="Empty Family",
            family_wish="Nothing",
            contact_name="Empty",
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
        from app.models import Family

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
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
                "age": 6,
                "practical_wish": "A coat",
                "fun_wish": "A toy",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["given_name"] == "New Person"
        assert body["family_id"] == fam.id
        assert body["age"] == 6

    def test_201_with_optional_fields(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(
            f"/api/referrer/families/{fam.id}/people",
            json={
                "given_name": "New Person",
                "age": 6,
                "practical_wish": "A coat",
                "fun_wish": "A toy",
                "title": "Ms.",
                "note": "Allergic to nuts",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["title"] == "Ms."
        assert body["note"] == "Allergic to nuts"

    def test_403_other_referrers_family(
        self,
        test_client: TestClient,
        referrer_with_full_tree,
        another_referrer,
        db: Session,
    ):
        from app.models import Family

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Family",
            family_wish="Something",
            contact_name="Other",
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
                "practical_wish": "Nope",
                "fun_wish": "Nope",
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
                "practical_wish": "Nope",
                "fun_wish": "Nope",
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
                "practical_wish": "A coat",
                "fun_wish": "A toy",
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
                "practical_wish": "Nope",
                "fun_wish": "Nope",
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
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        # Create a pending family
        pending = Family(
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="A roof",
            contact_name="Pending Contact",
            approval_status=FamilyApprovalStatus.pending,
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
        assert body[0]["approval_status"] == "pending"
        assert body[0]["person_count"] == 0

    def test_excludes_approved_families(self, test_client: TestClient, referrer_with_full_tree):
        # The tree family is already approved — should not appear
        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/pending-families")
        assert resp.status_code == 200
        body = resp.json()
        assert all(f["family_name"] != "Tree Family" for f in body)

    def test_excludes_other_referrer_families(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import Family, FamilyApprovalStatus

        other_ref = another_referrer["referrer"]
        pending = Family(
            referrer_id=other_ref.id,
            family_name="Other Pending",
            family_wish="A car",
            contact_name="Other Contact",
            approval_status=FamilyApprovalStatus.pending,
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


class TestReferrerApproveFamily:
    def test_200_approve_pending(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="To Approve",
            family_wish="A roof",
            contact_name="Approve Contact",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/approve")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == pending.id
        assert body["approval_status"] == "approved"

    def test_approve_increases_family_count(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="Count Me",
            family_wish="A roof",
            contact_name="Count Contact",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()

        _tree_referrer_login(test_client)
        # Before: 1 approved family (Tree Family)
        resp = test_client.get("/api/referrer/me")
        assert resp.json()["family_count"] == 1

        # Approve the pending family
        resp = test_client.post(f"/api/referrer/families/{pending.id}/approve")
        assert resp.status_code == 200

        # After: 2 approved families
        resp = test_client.get("/api/referrer/me")
        assert resp.json()["family_count"] == 2

    def test_400_cannot_approve_already_approved(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(f"/api/referrer/families/{fam.id}/approve")
        assert resp.status_code == 400

    def test_400_cannot_approve_rejected(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        rejected = Family(
            referrer_id=ref.id,
            family_name="Rejected Family",
            family_wish="A roof",
            contact_name="Rejected Contact",
            approval_status=FamilyApprovalStatus.rejected,
        )
        db.add(rejected)
        db.commit()
        db.refresh(rejected)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{rejected.id}/approve")
        assert resp.status_code == 400

    def test_400_limit_exceeded_on_approve(self, test_client: TestClient, another_referrer, db: Session):
        from app.models import Family, FamilyApprovalStatus, Referrer

        ref = another_referrer["referrer"]
        db.query(Referrer).filter(Referrer.id == ref.id).update({"family_limit": 1}, synchronize_session=False)
        # Create 1 approved family (at limit)
        approved = Family(
            referrer_id=ref.id,
            family_name="At Limit",
            family_wish="A roof",
            contact_name="Limit Contact",
            approval_status=FamilyApprovalStatus.approved,
        )
        # Create 1 pending family
        pending = Family(
            referrer_id=ref.id,
            family_name="Over Limit",
            family_wish="A car",
            contact_name="Over Contact",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add_all([approved, pending])
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/approve")
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

    def test_403_wrong_referrer(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="Not Yours",
            family_wish="A roof",
            contact_name="Not Yours",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/approve")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="No Auth",
            family_wish="A roof",
            contact_name="No Auth",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        resp = test_client.post(f"/api/referrer/families/{pending.id}/approve")
        assert resp.status_code == 401


class TestReferrerRejectFamily:
    def test_200_reject_pending(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="To Reject",
            family_wish="A roof",
            contact_name="Reject Contact",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == pending.id
        assert body["approval_status"] == "rejected"

    def test_400_cannot_reject_already_approved(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]
        resp = test_client.post(f"/api/referrer/families/{fam.id}/reject")
        assert resp.status_code == 400

    def test_400_cannot_reject_already_rejected(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        rejected = Family(
            referrer_id=ref.id,
            family_name="Already Rejected",
            family_wish="A roof",
            contact_name="Rejected Contact",
            approval_status=FamilyApprovalStatus.rejected,
        )
        db.add(rejected)
        db.commit()
        db.refresh(rejected)

        _tree_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{rejected.id}/reject")
        assert resp.status_code == 400

    def test_403_wrong_referrer(self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="Not Yours",
            family_wish="A roof",
            contact_name="Not Yours",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        _another_referrer_login(test_client)
        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 403

    def test_401_unauthenticated(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        pending = Family(
            referrer_id=ref.id,
            family_name="No Auth",
            family_wish="A roof",
            contact_name="No Auth",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)

        resp = test_client.post(f"/api/referrer/families/{pending.id}/reject")
        assert resp.status_code == 401
