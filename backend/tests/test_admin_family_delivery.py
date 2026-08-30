"""Tests for admin family delivery assignment."""

import pytest
from tests.conftest import login_as, make_family


@pytest.fixture()
def delivery_user(db):
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
def non_delivery_user(db):
    """Create a purchaser user (non-delivery) for 422 tests."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="purchaser@test.com",
        hashed_password=get_password_hash("PurPass1234!"),
        role=UserRole.purchaser,
        display_name=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def family_for_delivery(db, referrer_record):
    """Create a family with no delivery person assigned."""
    from app.models import FamilyVerificationStatus

    fam = make_family(
        db,
        referrer_id=referrer_record.id,
        family_name="Delivery Test Family",
        family_wish="A blanket",
        contact_name="Test Contact",
        phone_number="555-400-0001",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)
    return fam


# ---------------------------------------------------------------------------
# Admin assign / unassign delivery person
# ---------------------------------------------------------------------------


def test_admin_assign_delivery_user(test_client, admin_user, family_for_delivery, delivery_user, db):
    family_for_delivery.delivery_user_id = delivery_user.id
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    # Re-read to confirm it was persisted
    resp = test_client.get(f"/api/admin/families/{family_for_delivery.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_user_id"] == delivery_user.id
    assert data["delivery_user_name"] is not None


def test_admin_assign_delivery_via_patch(test_client, admin_user, family_for_delivery, delivery_user):
    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.patch(
        f"/api/admin/families/{family_for_delivery.id}",
        json={"delivery_user_id": delivery_user.id},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_user_id"] == delivery_user.id
    assert data["delivery_user_name"] is not None


def test_admin_unassign_delivery_user(test_client, admin_user, family_for_delivery, delivery_user, db):
    # First assign
    family_for_delivery.delivery_user_id = delivery_user.id
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.patch(
        f"/api/admin/families/{family_for_delivery.id}",
        json={"delivery_user_id": 0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_user_id"] is None
    assert data["delivery_user_name"] is None


def test_admin_assign_non_delivery_user_returns_422(test_client, admin_user, family_for_delivery, non_delivery_user):
    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.patch(
        f"/api/admin/families/{family_for_delivery.id}",
        json={"delivery_user_id": non_delivery_user.id},
    )
    assert resp.status_code == 422


def test_admin_assign_deleted_delivery_user_returns_422(test_client, admin_user, family_for_delivery, delivery_user, db):
    from datetime import datetime, timezone

    delivery_user.deleted_at = datetime.now(timezone.utc)
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.patch(
        f"/api/admin/families/{family_for_delivery.id}",
        json={"delivery_user_id": delivery_user.id},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Family detail / summary includes delivery fields
# ---------------------------------------------------------------------------


def test_family_detail_includes_delivery_fields(test_client, admin_user, family_for_delivery, delivery_user, db):
    family_for_delivery.delivery_user_id = delivery_user.id
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get(f"/api/admin/families/{family_for_delivery.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "delivery_user_id" in data
    assert data["delivery_user_id"] == delivery_user.id
    assert "delivery_user_name" in data
    assert data["delivery_user_name"] is not None


def test_family_list_includes_delivery_fields(test_client, admin_user, family_for_delivery, delivery_user, db):
    family_for_delivery.delivery_user_id = delivery_user.id
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get("/api/admin/families")
    assert resp.status_code == 200
    data = resp.json()
    families = data["families"]
    matched = [f for f in families if f["id"] == family_for_delivery.id]
    assert len(matched) == 1
    fam = matched[0]
    assert fam["delivery_user_id"] == delivery_user.id
    assert fam["delivery_user_name"] is not None


def test_family_detail_null_delivery_when_unassigned(test_client, admin_user, family_for_delivery):
    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.get(f"/api/admin/families/{family_for_delivery.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_user_id"] is None
    assert data["delivery_user_name"] is None


# ---------------------------------------------------------------------------
# Soft-delete delivery user unassigns families
# ---------------------------------------------------------------------------


def test_soft_delete_delivery_user_unassigns_families(test_client, admin_user, family_for_delivery, delivery_user, db):
    family_for_delivery.delivery_user_id = delivery_user.id
    db.commit()

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.delete(f"/api/admin/users/{delivery_user.id}")
    assert resp.status_code == 204

    # Verify family is unassigned
    resp = test_client.get(f"/api/admin/families/{family_for_delivery.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["delivery_user_id"] is None


# ---------------------------------------------------------------------------
# Soft-delete purchaser user unassigns wishes
# ---------------------------------------------------------------------------


def test_soft_delete_purchaser_unassigns_wishes(test_client, admin_user, family_for_delivery, non_delivery_user, db):
    from app.models import Person, PersonRole, Wish, WishType

    # Create a person with wishes
    person = Person(family_id=family_for_delivery.id, given_name="Test Person", age=8, role=PersonRole.son)
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="Backpack", assigned_to_id=non_delivery_user.id)
    w2 = Wish(person_id=person.id, type=WishType.fun, description="Doll", assigned_to_id=non_delivery_user.id)
    db.add_all([w1, w2])
    db.commit()
    db.refresh(w1)
    db.refresh(w2)

    login_as(test_client, "admin@test.com", "AdminPass123!")
    resp = test_client.delete(f"/api/admin/users/{non_delivery_user.id}")
    assert resp.status_code == 204

    # Verify wishes are unassigned
    w1_fresh = db.query(Wish).filter(Wish.id == w1.id).first()
    w2_fresh = db.query(Wish).filter(Wish.id == w2.id).first()
    assert w1_fresh.assigned_to_id is None
    assert w2_fresh.assigned_to_id is None
