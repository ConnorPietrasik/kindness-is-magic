"""Tests for enumerated display_id computation in list endpoints.

Covers:
- Admin families: flat, scoped, orphan families, deleted endpoint
- Admin people: flat, scoped, deleted endpoint
- Referrer families: sequential enumeration
- Referrer family people: sequential enumeration
- Family people: sequential enumeration
- Pagination continuity across pages
- Display ID stability: admin scoped view matches referrer's own view
- compute_position_maps: batched multi-scope call matches per-scope calls
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as, make_family

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
        from app.models import FamilyVerificationStatus

        for i in range(3):
            f = make_family(
                db,
                family_name=f"Orphan {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                verification_status=FamilyVerificationStatus.verified,
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
        from app.models import FamilyVerificationStatus

        for i in range(3):
            f = make_family(
                db,
                referrer_id=referrer_record.id,
                family_name=f"Ref Family {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                verification_status=FamilyVerificationStatus.verified,
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
        from app.models import FamilyVerificationStatus

        # Orphan first (lower id)
        f1 = make_family(
            db,
            family_name="Orphan First",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(f1)
        db.commit()
        db.refresh(f1)

        # Referrer family (higher id)
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Ref Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
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
        from app.models import FamilyVerificationStatus, Referrer, ReferrerApprovalStatus

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
        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Ref1 Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=ref2.id,
            family_name="Ref2 Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
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
        from app.models import FamilyVerificationStatus

        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add_all([f1, f2])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        # Both verified and pending appear in flat view
        assert len(body["families"]) == 2
        names = {f["family_name"] for f in body["families"]}
        assert "Verified Family" in names
        assert "Pending Family" in names

    def test_pending_does_not_disrupt_verified_numbering(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Pending families interleaved between verified ones don't shift verified numbering."""
        from app.models import FamilyVerificationStatus

        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified First",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Pending Middle",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.pending,
        )
        f3 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified Second",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add_all([f1, f2, f3])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 3

        verified = [f for f in body["families"] if f["verification_status"] == "verified"]
        pending = [f for f in body["families"] if f["verification_status"] == "pending"]
        # Verified families keep sequential numbering (1, 2) despite pending in between
        assert verified[0]["display_id"] == f"{referrer_record.id}-1"
        assert verified[1]["display_id"] == f"{referrer_record.id}-2"
        # Pending family gets a status label, not a numeric ID
        assert pending[0]["display_id"] == "PENDING"

    def test_rejected_does_not_disrupt_verified_numbering(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Rejected families interleaved between verified ones don't shift verified numbering."""
        from app.models import FamilyVerificationStatus

        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified First",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Rejected Middle",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.rejected,
        )
        f3 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified Second",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add_all([f1, f2, f3])
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["families"]) == 3

        verified = [f for f in body["families"] if f["verification_status"] == "verified"]
        rejected = [f for f in body["families"] if f["verification_status"] == "rejected"]
        # Verified families keep sequential numbering (1, 2) despite rejected in between
        assert verified[0]["display_id"] == f"{referrer_record.id}-1"
        assert verified[1]["display_id"] == f"{referrer_record.id}-2"
        # Rejected family gets a status label, not a numeric ID
        assert rejected[0]["display_id"] == "REJECTED"

    def test_flat_verified_display_id_matches_scoped(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Verified family display_id is consistent between flat and scoped views (minus prefix)."""
        from app.models import FamilyVerificationStatus

        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="First",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Second",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add_all([f1, f2])
        db.commit()

        _admin_login(test_client)
        # Flat view
        flat_resp = test_client.get("/api/admin/families")
        flat_body = flat_resp.json()
        # Scoped view
        scoped_resp = test_client.get(f"/api/admin/families?referrer_id={referrer_record.id}")
        scoped_body = scoped_resp.json()

        # Same families, same core IDs (flat just has referrer prefix)
        assert len(flat_body["families"]) == 2
        assert len(scoped_body["families"]) == 2
        for flat_f, scoped_f in zip(flat_body["families"], scoped_body["families"]):
            assert flat_f["id"] == scoped_f["id"]
            # Flat: "{ref_id}-{n}", Scoped: "{n}"
            assert flat_f["display_id"] == f"{referrer_record.id}-{scoped_f['display_id']}"


class TestAdminFamilyDisplayIdScoped:
    """Admin family list scoped to a single referrer."""

    def test_scoped_uses_simple_enumeration(self, test_client: TestClient, admin_user, referrer_with_families):
        """Scoped list uses simple {n} enumeration (verified only)."""
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

        Verified families keep their sequential numbering; pending families
        are interleaved but don't disrupt the numbering.
        """
        from app.models import FamilyVerificationStatus

        ref = referrer_with_families["referrer"]
        # Add a pending family between the two verified ones by ID
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0099",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families?referrer_id={ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        # All three families appear (2 verified + 1 pending)
        assert len(body["families"]) == 3
        # Pending family has PENDING display_id
        pending_f = next(f for f in body["families"] if f["family_name"] == "Pending Family")
        assert pending_f["display_id"] == "PENDING"
        # Verified families still have sequential numbering (1, 2)
        verified = [f for f in body["families"] if f["verification_status"] == "verified"]
        assert len(verified) == 2
        assert verified[0]["display_id"] == "1"
        assert verified[1]["display_id"] == "2"

    def test_scoped_includes_rejected_with_label(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Scoped admin view includes rejected families with 'REJECTED' display_id."""
        from app.models import FamilyVerificationStatus

        ref = referrer_with_families["referrer"]
        rejected = make_family(
            db,
            referrer_id=ref.id,
            family_name="Rejected Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0088",
            verification_status=FamilyVerificationStatus.rejected,
        )
        db.add(rejected)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families?referrer_id={ref.id}")
        assert resp.status_code == 200
        body = resp.json()
        # All three families appear (2 verified + 1 rejected)
        assert len(body["families"]) == 3
        # Rejected family has REJECTED display_id
        rejected_f = next(f for f in body["families"] if f["family_name"] == "Rejected Family")
        assert rejected_f["display_id"] == "REJECTED"
        # Verified families still have sequential numbering (1, 2)
        verified = [f for f in body["families"] if f["verification_status"] == "verified"]
        assert len(verified) == 2
        assert verified[0]["display_id"] == "1"
        assert verified[1]["display_id"] == "2"

    def test_scoped_verified_matches_referrer_view(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Verified families in admin scoped view have same display_ids as referrer's view."""
        from app.models import FamilyVerificationStatus, User, UserRole
        from app.auth import get_password_hash

        ref = referrer_with_families["referrer"]
        # Add a pending family
        pending = make_family(
            db,
            referrer_id=ref.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0099",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending)
        db.commit()

        # Create a referrer user so we can log in as the referrer
        ref_user = User(
            email="scoped_referrer@test.com",
            hashed_password=get_password_hash("RefPass1234!"),
            role=UserRole.referrer,
            display_name=None,
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

        # Admin's verified families match referrer's view (same display_ids)
        admin_verified = [f for f in admin_body["families"] if f["verification_status"] == "verified"]
        assert len(admin_verified) == len(ref_body["families"])
        for admin_f, ref_f in zip(admin_verified, ref_body["families"]):
            assert admin_f["display_id"] == ref_f["display_id"]
            assert admin_f["family_name"] == ref_f["family_name"]


class TestAdminFamilyDisplayIdDeleted:
    """Soft-deleted families via the /deleted endpoint."""

    def test_deleted_endpoint_shows_deleted(self, test_client: TestClient, admin_user, referrer_with_families, db: Session):
        """Deleted families appear in /deleted endpoint with 'DELETED' display_id."""

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
        from app.models import FamilyVerificationStatus

        # Create 3 families
        f1 = make_family(
            db,
            family_name="First",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            family_name="Second",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
        )
        f3 = make_family(
            db,
            family_name="Third",
            family_wish="W",
            contact_name="C",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
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
        from app.models import FamilyVerificationStatus

        for i in range(5):
            f = make_family(
                db,
                family_name=f"Family {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-000-0000",
                verification_status=FamilyVerificationStatus.verified,
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
        from app.models import Person, PersonRole, Wish, WishType

        for i in range(3):
            p = Person(family_id=family_record.id, given_name=f"Child {i}", age=10, role=PersonRole.son)
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
        from app.models import FamilyVerificationStatus, Person, PersonRole, Wish, WishType

        fam = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Ref Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        for i in range(2):
            p = Person(family_id=fam.id, given_name=f"Child {i}", age=8, role=PersonRole.son)
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
        from app.models import FamilyVerificationStatus, Person, PersonRole, Wish, WishType

        # Two families under same referrer
        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Family A",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Family B",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add_all([f1, f2])
        db.commit()
        db.refresh(f1)
        db.refresh(f2)

        # 2 people in f1, 1 person in f2
        p1 = Person(family_id=f1.id, given_name="Alice", age=8, role=PersonRole.son)
        p2 = Person(family_id=f1.id, given_name="Bob", age=10, role=PersonRole.son)
        p3 = Person(family_id=f2.id, given_name="Charlie", age=12, role=PersonRole.son)
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

    def test_people_in_pending_family_skipped_in_enumeration(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """People in pending/rejected families don't appear in the active people list.

        When a pending family is verified, its people get family positions based on
        the verified-family enumeration (pending families are skipped).
        """
        from app.models import Family, FamilyVerificationStatus, Person, PersonRole, Wish, WishType

        # Verified family (first by id)
        f1 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        # Pending family (second by id)
        f2 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Pending Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.pending,
        )
        # Another verified family (third by id)
        f3 = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Verified Family 2",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add_all([f1, f2, f3])
        db.commit()
        db.refresh(f1)
        db.refresh(f2)
        db.refresh(f3)

        # People in each family
        p1 = Person(family_id=f1.id, given_name="Alice", age=8, role=PersonRole.son)
        p2 = Person(family_id=f2.id, given_name="Bob", age=10, role=PersonRole.son)
        p3 = Person(family_id=f3.id, given_name="Charlie", age=12, role=PersonRole.son)
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

        # Only people from verified families appear in the active list
        assert len(body["people"]) == 2
        # f1 is verified family 1, f3 is verified family 2 (f2 skipped)
        assert body["people"][0]["display_id"] == f"{referrer_record.id}-1-1"  # Alice in verified family 1
        assert body["people"][1]["display_id"] == f"{referrer_record.id}-2-1"  # Charlie in verified family 2

        # Now verify the pending family — its people get family position 2
        # (f2.id < f3.id so f2 slots in between f1 and f3 by id order)
        db.query(Family).filter(Family.id == f2.id).update(
            {Family.verification_status: FamilyVerificationStatus.verified}, synchronize_session=False
        )
        db.commit()

        resp = test_client.get("/api/admin/people")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["people"]) == 3
        # f1→pos 1, f2→pos 2 (id between f1 and f3), f3→pos 3
        assert body["people"][0]["display_id"] == f"{referrer_record.id}-1-1"  # Alice
        assert body["people"][1]["display_id"] == f"{referrer_record.id}-2-1"  # Bob (family 2)
        assert body["people"][2]["display_id"] == f"{referrer_record.id}-3-1"  # Charlie (family 3)


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

        people = family_with_people["people"]
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
        from app.models import Person, PersonRole, Wish, WishType

        p1 = Person(family_id=family_record.id, given_name="First", age=8, role=PersonRole.son)
        p2 = Person(family_id=family_record.id, given_name="Second", age=10, role=PersonRole.son)
        p3 = Person(family_id=family_record.id, given_name="Third", age=12, role=PersonRole.son)
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
        from app.models import Person, PersonRole, Wish, WishType

        for i in range(5):
            p = Person(family_id=family_record.id, given_name=f"Child {i}", age=10, role=PersonRole.son)
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
        from app.models import FamilyVerificationStatus

        ref = referrer_with_full_tree["referrer"]
        # Create additional families
        f2 = make_family(
            db,
            referrer_id=ref.id,
            family_name="Second Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        f3 = make_family(
            db,
            referrer_id=ref.id,
            family_name="Third Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
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
        from app.models import Person, PersonRole, Wish, WishType

        fam = referrer_with_full_tree["family"]
        # Add more people
        p2 = Person(family_id=fam.id, given_name="Second Person", age=6, role=PersonRole.son)
        p3 = Person(family_id=fam.id, given_name="Third Person", age=8, role=PersonRole.son)
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
        from app.models import Person, PersonRole, Wish, WishType

        fam = family_with_people["family"]
        # Add another person
        p3 = Person(family_id=fam.id, given_name="Third Child", age=4, role=PersonRole.son)
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


# =========================================================================
# compute_position_maps — batching invariant
# =========================================================================


class TestComputePositionMapsBatching:
    """Batched (scope=None) position maps must match per-scope results.

    Multi-scope endpoints (packing slips) call compute_position_maps() once
    over people spanning many families; the per-family positions it returns
    must be identical to calling it per family with scope=<family_id>.
    """

    def test_batched_matches_per_family_scoped(self, referrer_record, db: Session):
        from app.models import FamilyVerificationStatus, Person, PersonRole
        from app.response_builders import compute_position_maps

        fams = []
        for i in range(3):
            f = make_family(
                db,
                referrer_id=referrer_record.id,
                family_name=f"Batch Fam {i}",
                family_wish="Wish",
                contact_name="Contact",
                phone_number=f"555-006-000{i}",
                verification_status=FamilyVerificationStatus.verified,
            )
            db.add(f)
            db.commit()
            db.refresh(f)
            fams.append(f)

        # 1, 2, 3 people per family (uneven, to catch off-by-one numbering)
        for i, f in enumerate(fams):
            for j in range(i + 1):
                p = Person(family_id=f.id, given_name=f"P{i}-{j}", age=8, role=PersonRole.son)
                db.add(p)
        db.commit()

        all_people = db.query(Person).filter(Person.family_id.in_([f.id for f in fams])).order_by(Person.id).all()

        # One batched call over all families (what packing slips do)
        fam_pos_batch, _, per_pos_batch = compute_position_maps(db, "person", all_people, scope=None)
        assert len(per_pos_batch) == 6

        # Per-family scoped calls (what pre-batching code did) must agree
        for f in fams:
            fam_people = [p for p in all_people if p.family_id == f.id]
            fam_pos_scoped, _, per_pos_scoped = compute_position_maps(db, "person", fam_people, scope=f.id)
            assert fam_pos_scoped == fam_pos_batch
            for p in fam_people:
                assert per_pos_scoped[p.id] == per_pos_batch[p.id], f"position mismatch for person {p.id}"

        # Positions within each family are 1..n by id order
        for i, f in enumerate(fams):
            positions = sorted(per_pos_batch[p.id] for p in all_people if p.family_id == f.id)
            assert positions == list(range(1, i + 2))


# =========================================================================
# Wish display_id
# =========================================================================


@pytest.fixture()
def wish_display_tree(db: Session):
    """One referrer + one verified, admin-locked family with a child
    (practical + fun wishes), an adult (adult wish), and the family wish.

    Flat display ids: family ``{ref}-1``, child ``{ref}-1-1``,
    adult ``{ref}-1-2``.  Scoped positions: child ``1``, adult ``2``.
    """
    from app.models import (
        FamilyVerificationStatus,
        Person,
        PersonRole,
        Referrer,
        ReferrerApprovalStatus,
        Wish,
        WishLockLevel,
        WishType,
    )

    ref = Referrer(
        name="Wish Display Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-WISH01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = make_family(
        db,
        referrer_id=ref.id,
        family_name="Wish Display Family",
        family_wish="A new sofa",
        contact_name="Wish Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    child = Person(family_id=fam.id, given_name="WishChild", age=8, role=PersonRole.son)
    db.add(child)
    db.flush()
    child_a = Wish(person_id=child.id, type=WishType.practical, description="A backpack")
    child_b = Wish(person_id=child.id, type=WishType.fun, description="A doll")
    db.add_all([child_a, child_b])

    adult = Person(family_id=fam.id, given_name="WishAdult", age=25, role=PersonRole.mother)
    db.add(adult)
    db.flush()
    adult_x = Wish(person_id=adult.id, type=WishType.adult, description="Groceries")
    db.add(adult_x)

    db.commit()
    for obj in (child, adult, child_a, child_b, adult_x):
        db.refresh(obj)

    family_wish = db.query(Wish).filter(Wish.family_id == fam.id, Wish.type == WishType.family).first()

    return {
        "referrer": ref,
        "family": fam,
        "child": child,
        "adult": adult,
        "child_a": child_a,
        "child_b": child_b,
        "adult_x": adult_x,
        "family_wish": family_wish,
    }


def _wishes_by_type(wishes: list[dict]) -> dict[str, dict]:
    return {w["type"]: w for w in wishes}


class TestAdminWishListDisplayId:
    """Flat admin wish list: exact flat wish display ids."""

    def test_flat_wish_display_ids(self, test_client: TestClient, admin_user, wish_display_tree):
        """Person wishes get {ref}-{fam}-{per}{A/B/X}; the family wish gets {ref}-{fam}-F."""
        _admin_login(test_client)
        tree = wish_display_tree
        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["wishes"]) == 4
        by_id = {w["id"]: w for w in body["wishes"]}
        assert by_id[tree["child_a"].id]["display_id"] == f"{tree['referrer'].id}-1-1A"
        assert by_id[tree["child_b"].id]["display_id"] == f"{tree['referrer'].id}-1-1B"
        assert by_id[tree["adult_x"].id]["display_id"] == f"{tree['referrer'].id}-1-2X"
        assert by_id[tree["family_wish"].id]["display_id"] == f"{tree['referrer'].id}-1-F"

    def test_columns_filter_accepts_display_id(self, test_client: TestClient, admin_user, wish_display_tree):
        """display_id is a valid column name for the admin wish list."""
        _admin_login(test_client)
        tree = wish_display_tree
        resp = test_client.get("/api/admin/wishes?columns=id,display_id")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["wishes"]) == 4
        ids = {w["display_id"] for w in body["wishes"]}
        assert f"{tree['referrer'].id}-1-F" in ids
        assert all("id" in w and "display_id" in w for w in body["wishes"])


class TestPurchaserWishDisplayId:
    """Purchaser wish list + detail: exact flat wish display ids."""

    @pytest.fixture()
    def tree_with_purchaser(self, db: Session, wish_display_tree):
        """Assign 3 of the tree's wishes to a purchaser user."""
        from app.auth import get_password_hash
        from app.models import User, UserRole

        purchaser = User(
            email="wish_purchaser@test.com",
            hashed_password=get_password_hash("WishPur1234!"),
            role=UserRole.purchaser,
            display_name=None,
        )
        db.add(purchaser)
        db.commit()
        db.refresh(purchaser)
        for w in (wish_display_tree["child_a"], wish_display_tree["adult_x"], wish_display_tree["family_wish"]):
            w.assigned_to_id = purchaser.id
        db.commit()
        return {**wish_display_tree, "purchaser": purchaser}

    def test_list_flat_ids(self, test_client: TestClient, tree_with_purchaser):
        login_as(test_client, "wish_purchaser@test.com", "WishPur1234!")
        tree = tree_with_purchaser
        resp = test_client.get("/api/purchaser/wishes")
        assert resp.status_code == 200
        body = resp.json()
        # Only the assigned wishes appear
        assert len(body["wishes"]) == 3
        by_id = {w["id"]: w for w in body["wishes"]}
        assert by_id[tree["child_a"].id]["display_id"] == f"{tree['referrer'].id}-1-1A"
        assert by_id[tree["adult_x"].id]["display_id"] == f"{tree['referrer'].id}-1-2X"
        assert by_id[tree["family_wish"].id]["display_id"] == f"{tree['referrer'].id}-1-F"

    def test_detail_flat_ids(self, test_client: TestClient, tree_with_purchaser):
        login_as(test_client, "wish_purchaser@test.com", "WishPur1234!")
        tree = tree_with_purchaser
        # Person wish
        resp = test_client.get(f"/api/purchaser/wishes/{tree['child_a'].id}")
        assert resp.status_code == 200
        assert resp.json()["display_id"] == f"{tree['referrer'].id}-1-1A"
        # Family wish (owner is the family, not a person)
        resp = test_client.get(f"/api/purchaser/wishes/{tree['family_wish'].id}")
        assert resp.status_code == 200
        assert resp.json()["display_id"] == f"{tree['referrer'].id}-1-F"


class TestPersonNestedWishDisplayId:
    """Person detail/list responses: nested wishes use {pos}{A/B/X}."""

    @pytest.fixture()
    def family_user(self, db: Session, wish_display_tree):
        from app.auth import get_password_hash
        from app.models import User, UserRole

        user = User(
            email="wish_family@test.com",
            hashed_password=get_password_hash("WishFam1234!"),
            role=UserRole.family,
            family_id=wish_display_tree["family"].id,
            display_name=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def test_family_people_list_scoped(self, test_client: TestClient, wish_display_tree, family_user):
        """Family self-service people list: nested wishes {pos}A/B/X."""
        login_as(test_client, "wish_family@test.com", "WishFam1234!")
        resp = test_client.get("/api/family/people")
        assert resp.status_code == 200
        body = resp.json()
        by_name = {p["given_name"]: p for p in body["people"]}
        child, adult = by_name["WishChild"], by_name["WishAdult"]
        assert child["display_id"] == "1"
        assert adult["display_id"] == "2"
        assert _wishes_by_type(child["wishes"])["practical"]["display_id"] == "1A"
        assert _wishes_by_type(child["wishes"])["fun"]["display_id"] == "1B"
        assert _wishes_by_type(adult["wishes"])["adult"]["display_id"] == "2X"

    def test_admin_person_detail_scoped(self, test_client: TestClient, admin_user, wish_display_tree):
        """Admin person detail: nested wishes {pos}A/B/X (family-scoped person id)."""
        _admin_login(test_client)
        tree = wish_display_tree
        resp = test_client.get(f"/api/admin/people/{tree['child'].id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["display_id"] == "1"
        assert _wishes_by_type(body["wishes"])["practical"]["display_id"] == "1A"
        assert _wishes_by_type(body["wishes"])["fun"]["display_id"] == "1B"

    def test_admin_person_wish_list_scoped(self, test_client: TestClient, admin_user, wish_display_tree):
        """Admin person wish list endpoint: same {pos}A/B/X ids as the person detail."""
        _admin_login(test_client)
        tree = wish_display_tree
        resp = test_client.get(f"/api/admin/people/{tree['child'].id}/wishes")
        assert resp.status_code == 200
        wishes = _wishes_by_type(resp.json())
        assert wishes["practical"]["display_id"] == "1A"
        assert wishes["fun"]["display_id"] == "1B"


class TestPackingSlipWishDisplayId:
    """Packing slips (admin + delivery): person wishes {pos}A/B/X, flat family header."""

    def test_admin_packing_slip(self, test_client: TestClient, admin_user, wish_display_tree):
        _admin_login(test_client)
        tree = wish_display_tree
        resp = test_client.get("/api/admin/families/packing-slips")
        assert resp.status_code == 200
        slips = [s for s in resp.json() if s["id"] == tree["family"].id]
        assert len(slips) == 1
        slip = slips[0]
        assert slip["display_id"] == f"{tree['referrer'].id}-1"
        by_name = {p["given_name"]: p for p in slip["people"]}
        assert _wishes_by_type(by_name["WishChild"]["wishes"])["practical"]["display_id"] == "1A"
        assert _wishes_by_type(by_name["WishChild"]["wishes"])["fun"]["display_id"] == "1B"
        assert _wishes_by_type(by_name["WishAdult"]["wishes"])["adult"]["display_id"] == "2X"

    def test_delivery_packing_slip(self, test_client: TestClient, db: Session, wish_display_tree):
        from app.auth import get_password_hash
        from app.models import User, UserRole

        delivery = User(
            email="wish_delivery@test.com",
            hashed_password=get_password_hash("WishDel1234!"),
            role=UserRole.delivery,
            display_name=None,
        )
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        wish_display_tree["family"].delivery_user_id = delivery.id
        db.commit()

        login_as(test_client, "wish_delivery@test.com", "WishDel1234!")
        resp = test_client.get("/api/delivery/packing-slips")
        assert resp.status_code == 200
        slips = [s for s in resp.json() if s["id"] == wish_display_tree["family"].id]
        assert len(slips) == 1
        slip = slips[0]
        assert slip["display_id"] == f"{wish_display_tree['referrer'].id}-1"
        by_name = {p["given_name"]: p for p in slip["people"]}
        assert _wishes_by_type(by_name["WishChild"]["wishes"])["practical"]["display_id"] == "1A"
        assert _wishes_by_type(by_name["WishChild"]["wishes"])["fun"]["display_id"] == "1B"
        assert _wishes_by_type(by_name["WishAdult"]["wishes"])["adult"]["display_id"] == "2X"


class TestWishDisplayIdNonStaffBoundary:
    """Public family wish list + donor claim detail keep display_id null.

    These two non-staff endpoints are out of scope for wish display ids —
    this guards the boundary.
    """

    def test_public_wish_list_display_id_null(self, test_client: TestClient, wish_display_tree):
        tree = wish_display_tree
        resp = test_client.get(f"/api/families/{tree['family'].id}/wish-list")
        assert resp.status_code == 200
        body = resp.json()
        # The family heading keeps its flat display id
        assert body["display_id"] == f"{tree['referrer'].id}-1"
        assert any(p["given_name"] == "WishChild" for p in body["people"])
        for person in body["people"]:
            for w in person["wishes"]:
                assert w["display_id"] is None

    def test_donor_claim_detail_display_id_null(self, test_client: TestClient, wish_display_tree):
        tree = wish_display_tree
        # Register a donor (auto-login) and claim the family
        resp = test_client.post(
            "/api/auth/register-donor",
            json={"display_name": "Wish Donor", "email": "wish_donor@test.com", "password": "DonorPass1!"},
        )
        assert resp.status_code == 201
        resp = test_client.post(f"/api/families/{tree['family'].id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201
        claim_id = resp.json()["id"]

        resp = test_client.get(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_wish"] is not None
        assert body["family_wish"]["display_id"] is None
        for person in body["people"]:
            for w in person["wishes"]:
                assert w["display_id"] is None
