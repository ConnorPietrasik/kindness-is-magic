"""Tests for enumerated display_id computation in list endpoints.

Covers:
- Admin families: flat, scoped, orphan families, deleted endpoint
- Admin people: flat, scoped, deleted endpoint
- Referrer families: sequential enumeration
- Referrer family people: sequential enumeration
- Family people: sequential enumeration
- Pagination continuity across pages
- Display ID stability: admin scoped view matches referrer's own view
"""

from datetime import datetime, timezone

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


def _family_login(client: TestClient) -> dict:
    return login_as(client, "family@test.com", "FamPass1234!")


# =========================================================================
# Admin — Families display_id
# =========================================================================


class TestAdminFamilyDisplayIdFlat:
    """Flat admin family list (no referrer filter)."""

    def test_orphan_families_get_0_prefix(self, test_client: TestClient, admin_user, db: Session):
        """Orphan families (no referrer) get display_id 0-1, 0-2, ..."""
        from app.models import Family, FamilyApprovalStatus

        for i in range(3):
            f = Family(
                family_name=f"Orphan {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
            )
            db.add(f)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 3
        assert body["families"][0]["display_id"] == "0-1"
        assert body["families"][1]["display_id"] == "0-2"
        assert body["families"][2]["display_id"] == "0-3"

    def test_referrer_families_get_referrer_prefix(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Families with a referrer get display_id {referrer_id}-{n}."""
        from app.models import Family, FamilyApprovalStatus

        for i in range(3):
            f = Family(
                referrer_id=referrer_record.id,
                family_name=f"Ref Family {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
            )
            db.add(f)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 3
        expected_prefix = str(referrer_record.id)
        assert body["families"][0]["display_id"] == f"{expected_prefix}-1"
        assert body["families"][1]["display_id"] == f"{expected_prefix}-2"
        assert body["families"][2]["display_id"] == f"{expected_prefix}-3"

    def test_mixed_referrer_and_orphan(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Mixed orphan and referrer families are in separate enumeration groups."""
        from app.models import Family, FamilyApprovalStatus

        # Orphan first (lower id)
        f1 = Family(
            family_name="Orphan First",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(f1)
        db.commit()
        db.refresh(f1)

        # Referrer family (higher id)
        f2 = Family(
            referrer_id=referrer_record.id,
            family_name="Ref Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(f2)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2
        # Orphan gets 0-1 (1st in orphan group)
        assert body["families"][0]["display_id"] == "0-1"
        # Referrer family gets {ref_id}-1 (1st in its referrer group)
        assert body["families"][1]["display_id"] == f"{referrer_record.id}-1"

    def test_multiple_referrers_independent_enumeration(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Families from different referrers have independent counters (each starts at 1)."""
        from app.models import Family, FamilyApprovalStatus, Referrer, ReferrerApprovalStatus

        # Create a second referrer
        ref2 = Referrer(
            name="Second Referrer",
            family_limit=10,
            phone_number="555-000-0002",
            family_invite_code="KFI-TEST02",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref2)
        db.commit()
        db.refresh(ref2)

        # One family per referrer
        f1 = Family(
            referrer_id=referrer_record.id,
            family_name="Ref1 Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        f2 = Family(
            referrer_id=ref2.id,
            family_name="Ref2 Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add_all([f1, f2])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2
        # Each referrer's families are numbered independently from 1
        assert body["families"][0]["display_id"] == f"{referrer_record.id}-1"
        assert body["families"][1]["display_id"] == f"{ref2.id}-1"

    def test_pending_families_included_in_flat_view(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Flat admin view includes pending families (unlike referrer's view)."""
        from app.models import Family, FamilyApprovalStatus

        f1 = Family(
            referrer_id=referrer_record.id,
            family_name="Approved Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        f2 = Family(
            referrer_id=referrer_record.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add_all([f1, f2])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        # Both approved and pending appear in flat view
        assert len(body["families"]) == 2
        names = {f["family_name"] for f in body["families"]}
        assert "Approved Family" in names
        assert "Pending Family" in names


class TestAdminFamilyDisplayIdScoped:
    """Admin family list scoped to a single referrer."""

    def test_scoped_uses_simple_enumeration(self, test_client: TestClient, admin_user, referrer_with_families):
        """Scoped list uses simple {n} enumeration (approved only)."""
        _admin_login(test_client)
        ref = referrer_with_families["referrer"]
        resp = test_client.get(f"/api/admin/families?referrer_id={ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2
        assert body["families"][0]["display_id"] == "1"
        assert body["families"][1]["display_id"] == "2"

    def test_scoped_includes_pending_with_label(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Scoped admin view includes pending families with 'PENDING' display_id.

        Approved families keep their sequential numbering; pending families
        are interleaved but don't disrupt the numbering.
        """
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_families["referrer"]
        # Add a pending family between the two approved ones by ID
        pending = Family(
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0099",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families?referrer_id={ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        # All three families appear (2 approved + 1 pending)
        assert len(body["families"]) == 3
        # Pending family has PENDING display_id
        pending_f = next(f for f in body["families"] if f["family_name"] == "Pending Family")
        assert pending_f["display_id"] == "PENDING"
        # Approved families still have sequential numbering (1, 2)
        approved = [f for f in body["families"] if f["approval_status"] == "approved"]
        assert len(approved) == 2
        assert approved[0]["display_id"] == "1"
        assert approved[1]["display_id"] == "2"

    def test_scoped_approved_matches_referrer_view(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Approved families in admin scoped view have same display_ids as referrer's view."""
        from app.models import Family, FamilyApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = referrer_with_families["referrer"]
        # Add a pending family
        pending = Family(
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0099",
            approval_status=FamilyApprovalStatus.pending,
        )
        db.add(pending)
        db.commit()

        # Create a referrer user so we can log in as the referrer
        ref_user = User(
            email="scoped_referrer@test.com",
            hashed_password=get_password_hash("RefPass1234!"),
            role=UserRole.referrer,
            referrer_id=ref.id,
        )
        db.add(ref_user)
        db.commit()

        _admin_login(test_client)
        # Admin scoped view
        admin_resp = test_client.get(f"/api/admin/families?referrer_id={ref.id}")
        assert admin_resp.status_code == 200
        admin_body = admin_resp.json()

        # Referrer's own view
        login_as(test_client, "scoped_referrer@test.com", "RefPass1234!")
        ref_resp = test_client.get("/api/referrer/families")
        assert ref_resp.status_code == 200
        ref_body = ref_resp.json()

        # Admin's approved families match referrer's view (same display_ids)
        admin_approved = [f for f in admin_body["families"] if f["approval_status"] == "approved"]
        assert len(admin_approved) == len(ref_body["families"])
        for admin_f, ref_f in zip(admin_approved, ref_body["families"]):
            assert admin_f["display_id"] == ref_f["display_id"]
            assert admin_f["family_name"] == ref_f["family_name"]


class TestAdminFamilyDisplayIdDeleted:
    """Soft-deleted families via the /deleted endpoint."""

    def test_deleted_endpoint_shows_deleted(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Deleted families appear in /deleted endpoint with 'DELETED' display_id."""
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_families["referrer"]
        families = referrer_with_families["families"]
        # Soft-delete one family
        families[1].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        # Main list should not include deleted
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        assert len(resp.json()["families"]) == 1

        # Deleted endpoint should show it
        resp = test_client.get("/api/admin/families/deleted")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["display_id"] == "DELETED"
        assert body["families"][0]["id"] == families[1].id

    def test_deleted_skipped_in_counter(self, test_client: TestClient, admin_user, db: Session):
        """Deleted families don't consume enumeration numbers in the main list."""
        from app.models import Family, FamilyApprovalStatus

        # Create 3 families
        f1 = Family(
            family_name="First",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        f2 = Family(
            family_name="Second",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0001",
            approval_status=FamilyApprovalStatus.approved,
        )
        f3 = Family(
            family_name="Third",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0002",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add_all([f1, f2, f3])
        db.commit()
        db.refresh(f1)
        db.refresh(f2)
        db.refresh(f3)

        # Delete the middle one
        f2.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        # Main list: only active families, enumeration is among active only
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 2
        assert body["families"][0]["display_id"] == "0-1"  # First (1st active)
        assert body["families"][1]["display_id"] == "0-2"  # Third (2nd active)

        # Deleted endpoint
        resp = test_client.get("/api/admin/families/deleted")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["display_id"] == "DELETED"
        assert body["families"][0]["family_name"] == "Second"

    def test_deleted_endpoint_scoped_by_referrer(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Deleted endpoint supports referrer_id filter."""
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_families["referrer"]
        families = referrer_with_families["families"]
        families[0].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/deleted?referrer_id={ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 1
        assert body["families"][0]["id"] == families[0].id


class TestAdminFamilyDisplayIdPagination:
    """Display IDs are stable across pagination pages."""

    def test_continuity_across_pages(self, test_client: TestClient, admin_user, db: Session):
        """Display IDs continue across page boundaries."""
        from app.models import Family, FamilyApprovalStatus

        for i in range(5):
            f = Family(
                family_name=f"Family {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
            )
            db.add(f)
        db.commit()

        _admin_login(test_client)
        # Page 1: families 0-1, 0-2
        resp = test_client.get("/api/admin/families?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["families"][0]["display_id"] == "0-1"
        assert body["families"][1]["display_id"] == "0-2"

        # Page 2: families 0-3, 0-4 (continues from page 1)
        resp = test_client.get("/api/admin/families?page=2&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["families"][0]["display_id"] == "0-3"
        assert body["families"][1]["display_id"] == "0-4"

        # Page 3: family 0-5
        resp = test_client.get("/api/admin/families?page=3&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["families"][0]["display_id"] == "0-5"


# =========================================================================
# Admin — People display_id
# =========================================================================


class TestAdminPeopleDisplayIdFlat:
    """Flat admin people list (no family filter)."""

    def test_orphan_family_people_get_0_prefix(self, test_client: TestClient, admin_user, family_record, db: Session):
        """People in orphan families get 0-{fam_n}-{per_n}."""
        from app.models import Person, Wish, WishType

        for i in range(3):
            p = Person(family_id=family_record.id, given_name=f"Child {i}", age=10)
            db.add(p)
            db.flush()
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 3
        assert body["people"][0]["display_id"] == "0-1-1"
        assert body["people"][1]["display_id"] == "0-1-2"
        assert body["people"][2]["display_id"] == "0-1-3"

    def test_referrer_family_people(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """People in referrer families get {ref_id}-{fam_n}-{per_n}."""
        from app.models import Family, FamilyApprovalStatus, Person, Wish, WishType

        fam = Family(
            referrer_id=referrer_record.id,
            family_name="Ref Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        for i in range(2):
            p = Person(family_id=fam.id, given_name=f"Child {i}", age=8)
            db.add(p)
            db.flush()
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["display_id"] == f"{referrer_record.id}-1-1"
        assert body["people"][1]["display_id"] == f"{referrer_record.id}-1-2"

    def test_multiple_families_enumeration(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """People across multiple families get correct family and person enumeration."""
        from app.models import Family, FamilyApprovalStatus, Person, Wish, WishType

        # Two families under same referrer
        f1 = Family(
            referrer_id=referrer_record.id,
            family_name="Family A",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        f2 = Family(
            referrer_id=referrer_record.id,
            family_name="Family B",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add_all([f1, f2])
        db.commit()
        db.refresh(f1)
        db.refresh(f2)

        # 2 people in f1, 1 person in f2
        p1 = Person(family_id=f1.id, given_name="Alice", age=8)
        p2 = Person(family_id=f1.id, given_name="Bob", age=10)
        p3 = Person(family_id=f2.id, given_name="Charlie", age=12)
        db.add_all([p1, p2, p3])
        db.flush()
        for p in [p1, p2, p3]:
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 3
        # Family A is family 1, Family B is family 2
        assert body["people"][0]["display_id"] == f"{referrer_record.id}-1-1"  # Alice
        assert body["people"][1]["display_id"] == f"{referrer_record.id}-1-2"  # Bob
        assert body["people"][2]["display_id"] == f"{referrer_record.id}-2-1"  # Charlie


class TestAdminPeopleDisplayIdScoped:
    """Admin people list scoped to a single family."""

    def test_scoped_uses_simple_enumeration(self, test_client: TestClient, admin_user, family_with_people):
        """Scoped list uses simple {n} enumeration."""
        _admin_login(test_client)
        fam = family_with_people["family"]
        resp = test_client.get(f"/api/admin/people?family_id={fam.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["display_id"] == "1"
        assert body["people"][1]["display_id"] == "2"


class TestAdminPeopleDisplayIdDeleted:
    """Soft-deleted people via the /deleted endpoint."""

    def test_deleted_endpoint_shows_deleted(self, test_client: TestClient, admin_user, family_with_people, db: Session):
        """Soft-deleted people appear in /deleted endpoint with 'DELETED' display_id."""
        from app.models import Person

        people = family_with_people["people"]
        family = family_with_people["family"]
        # Soft-delete one person
        people[1].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        # Main list should not include deleted
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        assert len(resp.json()["people"]) == 1

        # Deleted endpoint should show it
        resp = test_client.get("/api/admin/people/deleted")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 1
        assert body["people"][0]["display_id"] == "DELETED"
        assert body["people"][0]["id"] == people[1].id

    def test_deleted_skipped_in_counter(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Deleted people don't consume enumeration numbers in the main list."""
        from app.models import Person, Wish, WishType

        p1 = Person(family_id=family_record.id, given_name="First", age=8)
        p2 = Person(family_id=family_record.id, given_name="Second", age=10)
        p3 = Person(family_id=family_record.id, given_name="Third", age=12)
        db.add_all([p1, p2, p3])
        db.flush()
        for p in [p1, p2, p3]:
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()
        db.refresh(p1)
        db.refresh(p2)
        db.refresh(p3)

        # Delete the middle one
        p2.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        # Main list: only active, enumeration is among active only
        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 2
        assert body["people"][0]["display_id"] == "0-1-1"  # First (1st active in family)
        assert body["people"][1]["display_id"] == "0-1-2"  # Third (2nd active in family)

        # Deleted endpoint
        resp = test_client.get("/api/admin/people/deleted")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 1
        assert body["people"][0]["display_id"] == "DELETED"
        assert body["people"][0]["given_name"] == "Second"

    def test_deleted_endpoint_scoped_by_family(self, test_client: TestClient, admin_user, family_with_people, db: Session):
        """Deleted endpoint supports family_id filter."""
        from app.models import Person

        people = family_with_people["people"]
        family = family_with_people["family"]
        people[0].deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/people/deleted?family_id={family.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 1
        assert body["people"][0]["id"] == people[0].id


class TestAdminPeopleDisplayIdPagination:
    """Display IDs are stable across pagination pages for people."""

    def test_continuity_across_pages(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Display IDs continue across page boundaries."""
        from app.models import Person, Wish, WishType

        for i in range(5):
            p = Person(family_id=family_record.id, given_name=f"Child {i}", age=10)
            db.add(p)
            db.flush()
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()

        _admin_login(test_client)
        # Page 1
        resp = test_client.get("/api/admin/people?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["people"][0]["display_id"] == "0-1-1"
        assert body["people"][1]["display_id"] == "0-1-2"

        # Page 2
        resp = test_client.get("/api/admin/people?page=2&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["people"][0]["display_id"] == "0-1-3"
        assert body["people"][1]["display_id"] == "0-1-4"

        # Page 3
        resp = test_client.get("/api/admin/people?page=3&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert body["people"][0]["display_id"] == "0-1-5"


# =========================================================================
# Referrer — Families display_id
# =========================================================================


class TestReferrerFamilyDisplayId:
    """Referrer's own families use sequential enumeration."""

    def test_sequential_enumeration(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Families are numbered 1, 2, 3... by DB id order."""
        from app.models import Family, FamilyApprovalStatus

        ref = referrer_with_full_tree["referrer"]
        # Create additional families
        f2 = Family(
            referrer_id=ref.id,
            family_name="Second Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
        )
        f3 = Family(
            referrer_id=ref.id,
            family_name="Third Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add_all([f2, f3])
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 3
        assert body["families"][0]["display_id"] == "1"
        assert body["families"][1]["display_id"] == "2"
        assert body["families"][2]["display_id"] == "3"

    def test_empty_list(self, test_client: TestClient, another_referrer):
        """Empty list returns no families."""
        login_as(test_client, "another_referrer@test.com", "AnotherRef1234!")
        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        assert resp.json()["families"] == []


# =========================================================================
# Referrer — Family People display_id
# =========================================================================


class TestReferrerFamilyPeopleDisplayId:
    """Referrer viewing people in a family uses sequential enumeration."""

    def test_sequential_enumeration(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """People are numbered 1, 2, 3... by DB id order."""
        from app.models import Person, Wish, WishType

        fam = referrer_with_full_tree["family"]
        # Add more people
        p2 = Person(family_id=fam.id, given_name="Second Person", age=6)
        p3 = Person(family_id=fam.id, given_name="Third Person", age=8)
        db.add_all([p2, p3])
        db.flush()
        for p in [p2, p3]:
            db.add_all(
                [
                    Wish(person_id=p.id, type=WishType.practical, description="W"),
                    Wish(person_id=p.id, type=WishType.fun, description="F"),
                ]
            )
        db.commit()

        _tree_referrer_login(test_client)
        resp = test_client.get(f"/api/referrer/families/{fam.id}/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 3
        assert body["people"][0]["display_id"] == "1"
        assert body["people"][1]["display_id"] == "2"
        assert body["people"][2]["display_id"] == "3"


# =========================================================================
# Family — People display_id
# =========================================================================


class TestFamilyPeopleDisplayId:
    """Family viewing their own people uses sequential enumeration."""

    def test_sequential_enumeration(self, test_client: TestClient, family_user, family_with_people, db: Session):
        """People are numbered 1, 2, 3... by DB id order."""
        from app.models import Person, Wish, WishType

        fam = family_with_people["family"]
        # Add another person
        p3 = Person(family_id=fam.id, given_name="Third Child", age=4)
        db.add(p3)
        db.flush()
        db.add_all(
            [
                Wish(person_id=p3.id, type=WishType.practical, description="W"),
                Wish(person_id=p3.id, type=WishType.fun, description="F"),
            ]
        )
        db.commit()

        _family_login(test_client)
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 3
        assert body["people"][0]["display_id"] == "1"
        assert body["people"][1]["display_id"] == "2"
        assert body["people"][2]["display_id"] == "3"
