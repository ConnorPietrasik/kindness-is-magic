"""Tests for the admin delivery-slips endpoint."""

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


def _referrer_login(client: TestClient) -> dict:
    return login_as(client, "referrer@test.com", "RefPass1234!")


def _family_login(client: TestClient) -> dict:
    return login_as(client, "family@test.com", "FamPass1234!")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def delivery_user(db: Session):
    """Create a delivery-role User."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="delivery@test.com",
        hashed_password=get_password_hash("DelPass1234!"),
        role=UserRole.delivery,
        display_name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def delivery_user2(db: Session):
    """Create a second delivery-role User."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="delivery2@test.com",
        hashed_password=get_password_hash("DelPass1234!"),
        role=UserRole.delivery,
        display_name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def delivery_slip_families(db: Session, referrer_record, delivery_user, delivery_user2):
    """Create verified families covering assigned/unassigned, plus pending and deleted.

    Family 1: verified, assigned to delivery_user
    Family 2: verified, assigned to delivery_user2
    Family 3: verified, unassigned
    pending:  pending, unassigned (should NOT appear in any result)
    deleted:  verified, assigned to delivery_user, soft-deleted (never appears)
    """
    from app.models import FamilyVerificationStatus

    fam1 = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Slip Family One",
        family_wish="Winter coats",
        contact_name="Contact One",
        phone_number="555-400-0001",
        address="1 Main St",
        verification_status=FamilyVerificationStatus.verified,
        delivery_user_id=delivery_user.id,
    )
    fam2 = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Slip Family Two",
        family_wish="School supplies",
        contact_name="Contact Two",
        phone_number="555-400-0002",
        address="2 Side St",
        verification_status=FamilyVerificationStatus.verified,
        delivery_user_id=delivery_user2.id,
    )
    fam3 = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Slip Family Three",
        family_wish="Board games",
        contact_name="Contact Three",
        phone_number="555-400-0003",
        address="3 Hill Rd",
        verification_status=FamilyVerificationStatus.verified,
        delivery_user_id=None,
    )
    pending = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Slip Family Pending",
        family_wish="Something",
        contact_name="Contact Pending",
        phone_number="555-400-0004",
        address="4 Nowhere Way",
        verification_status=FamilyVerificationStatus.pending,
        delivery_user_id=None,
    )
    deleted = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Slip Family Deleted",
        family_wish="Gone",
        contact_name="Contact Deleted",
        phone_number="555-400-0005",
        address="5 Gone Ave",
        verification_status=FamilyVerificationStatus.verified,
        delivery_user_id=delivery_user.id,
        deleted_at=datetime.now(timezone.utc),
    )

    db.commit()
    db.refresh(fam1)
    db.refresh(fam2)
    db.refresh(fam3)
    db.refresh(pending)
    db.refresh(deleted)

    return {
        "fam1": fam1,
        "fam2": fam2,
        "fam3": fam3,
        "pending": pending,
        "deleted": deleted,
    }


# =========================================================================
# Tests
# =========================================================================


class TestDeliverySlipsAuth:
    """Authentication and authorization checks."""

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 401

    def test_403_referrer(self, test_client: TestClient, referrer_user):
        _referrer_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 403

    def test_403_family(self, test_client: TestClient, family_user):
        _family_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 403

    def test_200_admin(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200


class TestDeliverySlipsBasePopulation:
    """Default (no family_ids) returns all verified, non-deleted families."""

    def test_default_returns_all_verified(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        body = resp.json()

        ids = {item["id"] for item in body}
        assert ids == {
            delivery_slip_families["fam1"].id,
            delivery_slip_families["fam2"].id,
            delivery_slip_families["fam3"].id,
        }

    def test_empty_when_no_families(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_excludes_deleted_families(self, test_client: TestClient, admin_user, delivery_slip_families, db: Session):
        _admin_login(test_client)
        fam1 = delivery_slip_families["fam1"]
        fam1.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert fam1.id not in ids

    def test_excludes_pending_families(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        from app.models import FamilyVerificationStatus

        pending_fam = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Pending Family",
            family_wish="Something",
            contact_name="Contact",
            phone_number="555-000-0000",
            verification_status=FamilyVerificationStatus.pending,
        )
        db.add(pending_fam)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert pending_fam.id not in ids

    def test_ordered_by_family_id(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert ids == sorted(ids)


class TestDeliverySlipsScope:
    """scope query param narrows the population (only without family_ids)."""

    def test_scope_all_includes_assigned_and_unassigned(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?scope=all")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {
            delivery_slip_families["fam1"].id,
            delivery_slip_families["fam2"].id,
            delivery_slip_families["fam3"].id,
        }

    def test_scope_assigned_excludes_unassigned(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?scope=assigned")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {delivery_slip_families["fam1"].id, delivery_slip_families["fam2"].id}
        assert delivery_slip_families["fam3"].id not in ids

    def test_scope_unassigned_excludes_assigned(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?scope=unassigned")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {delivery_slip_families["fam3"].id}

    def test_invalid_scope_400(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?scope=everyone")
        assert resp.status_code == 400


class TestDeliverySlipsDeliveryUserId:
    """delivery_user_id adds an equality filter on top of scope."""

    def test_only_that_users_families(self, test_client: TestClient, admin_user, delivery_slip_families, delivery_user):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/delivery-slips?delivery_user_id={delivery_user.id}")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {delivery_slip_families["fam1"].id}

    def test_404_unknown_user_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?delivery_user_id=99999")
        assert resp.status_code == 404

    def test_404_deleted_user_id(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="delivery-deleted@test.com",
            hashed_password=get_password_hash("DelPass1234!"),
            role=UserRole.delivery,
            display_name=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        user.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/delivery-slips?delivery_user_id={user.id}")
        assert resp.status_code == 404

    def test_combines_with_scope_as_intersection(self, test_client: TestClient, admin_user, delivery_slip_families, delivery_user2):
        _admin_login(test_client)
        # scope=assigned ∧ delivery_user_id=delivery_user2 → only fam2
        resp = test_client.get(f"/api/admin/families/delivery-slips?scope=assigned&delivery_user_id={delivery_user2.id}")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {delivery_slip_families["fam2"].id}

    def test_user_with_no_families_returns_empty(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        user = User(
            email="delivery-empty@test.com",
            hashed_password=get_password_hash("DelPass1234!"),
            role=UserRole.delivery,
            display_name=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/delivery-slips?delivery_user_id={user.id}")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_empty_delivery_user_id_param_treated_as_absent(self, test_client: TestClient, admin_user, delivery_slip_families):
        """A present-but-empty delivery_user_id behaves like the default (no filter)."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?delivery_user_id=")
        assert resp.status_code == 200
        ids = {item["id"] for item in resp.json()}
        assert ids == {
            delivery_slip_families["fam1"].id,
            delivery_slip_families["fam2"].id,
            delivery_slip_families["fam3"].id,
        }

    def test_invalid_delivery_user_id_400(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?delivery_user_id=abc")
        assert resp.status_code == 400


class TestDeliverySlipsFamilyIdsFilter:
    """family_ids query param returns only requested families (takes precedence)."""

    def test_returns_specific_families(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        fam1_id = delivery_slip_families["fam1"].id
        fam3_id = delivery_slip_families["fam3"].id

        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam1_id},{fam3_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert {item["id"] for item in body} == {fam1_id, fam3_id}

    def test_single_family(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        fam2_id = delivery_slip_families["fam2"].id

        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam2_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == fam2_id

    def test_requested_order_preserved(self, test_client: TestClient, admin_user, delivery_slip_families):
        """Items come back in the order requested (also the packing-slip contract — shared resolver)."""
        _admin_login(test_client)
        fam1_id = delivery_slip_families["fam1"].id
        fam3_id = delivery_slip_families["fam3"].id

        # Reverse of ID order, so renumbering/sorting would be visible
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam3_id},{fam1_id}")
        assert resp.status_code == 200
        assert [item["id"] for item in resp.json()] == [fam3_id, fam1_id]

    def test_404_deleted_family_in_filter(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        deleted_id = delivery_slip_families["deleted"].id
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={deleted_id}")
        assert resp.status_code == 404

    def test_404_nonexistent_family(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?family_ids=99999")
        assert resp.status_code == 404

    def test_400_invalid_family_ids(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?family_ids=abc")
        assert resp.status_code == 400

    def test_filters_to_verified_only(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        pending_id = delivery_slip_families["pending"].id
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={pending_id}")
        assert resp.status_code == 200
        # Pending family is found (no 404) but excluded from results
        assert resp.json() == []

    def test_works_for_families_without_delivery_person(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        fam3_id = delivery_slip_families["fam3"].id
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam3_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == fam3_id

    def test_family_ids_takes_precedence_over_scope(self, test_client: TestClient, admin_user, delivery_slip_families):
        """scope is ignored while family_ids is present."""
        _admin_login(test_client)
        fam3_id = delivery_slip_families["fam3"].id  # unassigned
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam3_id}&scope=assigned")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == fam3_id


class TestDeliverySlipsResponseShape:
    """Response contains the slip fields, including family PII."""

    def test_response_shape(self, test_client: TestClient, admin_user, delivery_slip_families):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 3

        for item in body:
            assert set(item.keys()) == {
                "id",
                "display_id",
                "family_name",
                "address",
                "contact_name",
                "phone_number",
            }

    def test_fields_rendered_as_is(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """The 'none' address placeholder and empty phone pass through unmodified."""
        from app.models import FamilyVerificationStatus

        fam = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="No Details Family",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="",
            address="none",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.commit()
        db.refresh(fam)

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        item = next(i for i in resp.json() if i["id"] == fam.id)
        assert item["address"] == "none"
        assert item["phone_number"] == ""
        assert item["contact_name"] == "Contact"


# =========================================================================
# Display IDs — exact values
# =========================================================================


class TestDeliverySlipsDisplayIds:
    """Delivery-slip display_ids use the flat unscoped format.

    They must match the packing-slip numbering: {referrer_id}-{fam_pos}.
    """

    def test_family_display_ids_flat_format(self, test_client: TestClient, admin_user, delivery_slip_families, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        body = resp.json()

        by_id = {item["id"]: item for item in body}
        ref_id = referrer_record.id
        assert by_id[delivery_slip_families["fam1"].id]["display_id"] == f"{ref_id}-1"
        assert by_id[delivery_slip_families["fam2"].id]["display_id"] == f"{ref_id}-2"
        assert by_id[delivery_slip_families["fam3"].id]["display_id"] == f"{ref_id}-3"

    def test_display_ids_stable_with_family_ids_filter(self, test_client: TestClient, admin_user, delivery_slip_families, referrer_record):
        """Filtering to a subset must not renumber families."""
        _admin_login(test_client)
        fam3 = delivery_slip_families["fam3"]
        resp = test_client.get(f"/api/admin/families/delivery-slips?family_ids={fam3.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        # fam3 keeps its position 3 (not renumbered to 1)
        assert body[0]["display_id"] == f"{referrer_record.id}-3"

    def test_pending_and_deleted_families_do_not_shift_numbering(
        self, test_client: TestClient, admin_user, delivery_slip_families, referrer_record
    ):
        """The pending and deleted families in the fixture consume no positions."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips")
        assert resp.status_code == 200
        body = resp.json()

        by_id = {item["id"]: item for item in body}
        # fam3 is 3rd active verified family — pending/deleted don't count
        assert by_id[delivery_slip_families["fam3"].id]["display_id"] == f"{referrer_record.id}-3"


# =========================================================================
# Edge cases
# =========================================================================


class TestDeliverySlipsEdgeCases:
    """Edge cases and boundary conditions."""

    def test_empty_family_ids_param(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/delivery-slips?family_ids=")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_scope_and_user_ignored_with_family_ids(self, test_client: TestClient, admin_user, delivery_slip_families, delivery_user2):
        """While family_ids is present, scope and delivery_user_id have no effect."""
        _admin_login(test_client)
        fam3_id = delivery_slip_families["fam3"].id  # unassigned — scope=assigned would exclude it
        resp = test_client.get(
            f"/api/admin/families/delivery-slips?family_ids={fam3_id}&scope=assigned&delivery_user_id={delivery_user2.id}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["id"] == fam3_id
