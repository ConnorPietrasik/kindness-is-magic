"""Tests for delivery person self-service routes."""

import pytest
from tests.conftest import login_as


@pytest.fixture()
def delivery_user(db):
    """Create a delivery-role User."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="delivery@test.com",
        hashed_password=get_password_hash("DelPass1234!"),
        role=UserRole.delivery,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def delivery_assigned_families(db, delivery_user, referrer_record):
    """Create families assigned to a delivery person."""
    from app.models import Family, FamilyApprovalStatus, Person, Wish, WishType

    fam1 = Family(
        referrer_id=referrer_record.id,
        family_name="Delivery Family A",
        family_wish="Warm blankets",
        contact_name="Contact A",
        phone_number="555-300-0001",
        address="100 Elm St",
        approval_status=FamilyApprovalStatus.approved,
        delivery_user_id=delivery_user.id,
    )
    fam2 = Family(
        referrer_id=referrer_record.id,
        family_name="Delivery Family B",
        family_wish="New shoes",
        contact_name="Contact B",
        phone_number="555-300-0002",
        address="200 Pine St",
        approval_status=FamilyApprovalStatus.approved,
        delivery_user_id=delivery_user.id,
    )
    # Family not assigned to this delivery person
    fam3 = Family(
        referrer_id=referrer_record.id,
        family_name="Other Family",
        family_wish="A toy",
        contact_name="Contact C",
        phone_number="555-300-0003",
        approval_status=FamilyApprovalStatus.approved,
        delivery_user_id=None,
    )
    db.add_all([fam1, fam2, fam3])
    db.commit()
    db.refresh(fam1)
    db.refresh(fam2)
    db.refresh(fam3)

    # Add people to fam1
    p1 = Person(family_id=fam1.id, given_name="Alice", age=8)
    db.add(p1)
    db.flush()
    db.add_all(
        [
            Wish(person_id=p1.id, type=WishType.practical, description="Backpack"),
            Wish(person_id=p1.id, type=WishType.fun, description="Doll"),
        ]
    )
    db.commit()

    # Add people to fam2
    p2 = Person(family_id=fam2.id, given_name="Bob", age=12)
    db.add(p2)
    db.flush()
    db.add_all(
        [
            Wish(person_id=p2.id, type=WishType.practical, description="Tennis shoes"),
            Wish(person_id=p2.id, type=WishType.fun, description="Board game"),
        ]
    )
    db.commit()

    return {"fam1": fam1, "fam2": fam2, "fam3": fam3}


# ---------------------------------------------------------------------------
# GET /api/delivery/families
# ---------------------------------------------------------------------------


def test_delivery_list_families_returns_assigned_only(test_client, delivery_user, delivery_assigned_families):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/families")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {f["family_name"] for f in data}
    assert "Delivery Family A" in names
    assert "Delivery Family B" in names
    assert "Other Family" not in names


def test_delivery_list_families_returns_empty_when_none_assigned(test_client, delivery_user):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/families")
    assert resp.status_code == 200
    assert resp.json() == []


def test_delivery_list_families_excludes_soft_deleted(test_client, delivery_user, delivery_assigned_families, db):
    from datetime import datetime, timezone

    fam1 = delivery_assigned_families["fam1"]
    fam1.deleted_at = datetime.now(timezone.utc)
    db.commit()

    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/families")
    assert resp.status_code == 200
    data = resp.json()
    names = {f["family_name"] for f in data}
    assert "Delivery Family A" not in names


def test_delivery_list_families_returns_403_for_non_delivery(test_client, admin_user):
    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get("/api/delivery/families")
    assert resp.status_code == 403


def test_delivery_list_families_includes_person_count(test_client, delivery_user, delivery_assigned_families):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/families")
    assert resp.status_code == 200
    data = resp.json()
    for fam in data:
        assert "person_count" in fam
        assert isinstance(fam["person_count"], int)
        assert "display_id" in fam
        assert "address" in fam
        assert "phone_number" in fam
        assert "contact_name" in fam


# ---------------------------------------------------------------------------
# GET /api/delivery/packing-slips
# ---------------------------------------------------------------------------


def test_delivery_packing_slips_returns_assigned_families(test_client, delivery_user, delivery_assigned_families):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    ids = {s["id"] for s in data}
    assert delivery_assigned_families["fam1"].id in ids
    assert delivery_assigned_families["fam2"].id in ids


def test_delivery_packing_slips_returns_empty_when_none_assigned(test_client, delivery_user):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 200
    assert resp.json() == []


def test_delivery_packing_slips_excludes_soft_deleted(test_client, delivery_user, delivery_assigned_families, db):
    from datetime import datetime, timezone

    fam1 = delivery_assigned_families["fam1"]
    fam1.deleted_at = datetime.now(timezone.utc)
    db.commit()

    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 200
    data = resp.json()
    ids = {s["id"] for s in data}
    assert delivery_assigned_families["fam1"].id not in ids


def test_delivery_packing_slips_returns_403_for_non_delivery(test_client, admin_user):
    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 403


def test_delivery_packing_slips_includes_people_and_wishes(test_client, delivery_user, delivery_assigned_families):
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 200
    data = resp.json()
    for slip in data:
        assert "display_id" in slip
        assert "family_wish" in slip
        assert "people" in slip
        for person in slip["people"]:
            assert "given_name" in person
            assert "age" in person
            assert "wishes" in person


def test_delivery_packing_slips_no_family_pii(test_client, delivery_user, delivery_assigned_families):
    """Packing slips should not expose family_name or contact_name."""
    login_as(test_client, "delivery@test.com", "DelPass1234!")
    resp = test_client.get("/api/delivery/packing-slips")
    assert resp.status_code == 200
    data = resp.json()
    for slip in data:
        assert "family_name" not in slip
        assert "contact_name" not in slip
        assert "address" not in slip
