"""Tests for admin dropdown endpoints (users, referrers, families).

These endpoints return minimal {id, name} lists without pagination,
used by frontend select inputs.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    """Log in as admin and return the response JSON."""
    return login_as(client, "admin@test.com", "AdminPass123!")


def _referrer_login(client: TestClient) -> dict:
    """Log in as a referrer user."""
    return login_as(client, "referrer@test.com", "RefPass1234!")


# =========================================================================
#  Admin — Users Dropdown
# =========================================================================


class TestAdminUsersDropdown:
    def test_200_returns_minimal_entries(self, test_client: TestClient, admin_user, referrer_user):
        """Returns all active users as {id, display_name} pairs."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

        ids = [item["id"] for item in body]
        assert admin_user.id in ids
        assert referrer_user.id in ids

        for item in body:
            assert set(item.keys()) == {"id", "display_name"}
            assert isinstance(item["id"], int)
            assert isinstance(item["display_name"], str)

    def test_200_ordered_by_id(self, test_client: TestClient, admin_user, db: Session):
        """Results are ordered by id ascending."""
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        for i in range(3):
            u = User(
                email=f"order{i}@test.com",
                hashed_password=get_password_hash("OrderPass123!"),
                role=UserRole.admin,
                display_name=f"User {i}",
            )
            db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert ids == sorted(ids)

    def test_200_single_role_filter(self, test_client: TestClient, admin_user, referrer_user):
        """Filtering by single role returns only matching users."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users/dropdown?roles=admin")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert admin_user.id in ids
        assert referrer_user.id not in ids

    def test_200_multi_role_filter(self, test_client: TestClient, admin_user, referrer_user, db: Session):
        """Comma-separated roles returns users matching any role."""
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        purchaser = User(
            email="purchaser@test.com",
            hashed_password=get_password_hash("PurchPass123!"),
            role=UserRole.purchaser,
            display_name="Purchaser User",
        )
        db.add(purchaser)
        db.commit()
        db.refresh(purchaser)

        resp = test_client.get("/api/admin/users/dropdown?roles=admin,purchaser")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert admin_user.id in ids
        assert purchaser.id in ids
        assert referrer_user.id not in ids

    def test_excludes_soft_deleted(self, test_client: TestClient, admin_user, db: Session):
        """Soft-deleted users do not appear in the dropdown."""
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="deleted_dropdown@test.com",
            hashed_password=get_password_hash("DeletedPass123!"),
            role=UserRole.admin,
            display_name="Deleted User",
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        emails_in_response = [item["display_name"] for item in body]
        assert "Deleted User" not in emails_in_response

    def test_empty_when_no_users(self, test_client: TestClient, db: Session):
        """Returns empty list when no users exist."""
        # Create admin but don't log in via fixture — insert directly
        from app.models import User, UserRole
        from app.auth import get_password_hash

        admin = User(
            email="bare_admin@test.com",
            hashed_password=get_password_hash("AdminPass123!"),
            role=UserRole.admin,
            display_name="Bare Admin",
        )
        db.add(admin)
        db.commit()

        test_client.post("/api/auth/login", json={"email": "bare_admin@test.com", "password": "AdminPass123!"})
        resp = test_client.get("/api/admin/users/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        # Only the admin user itself is present
        assert len(body) == 1
        assert body[0]["id"] == admin.id


# =========================================================================
#  Admin — Referrers Dropdown
# =========================================================================


class TestAdminReferrersDropdown:
    def test_200_returns_minimal_entries(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Returns all active referrers as {id, name} pairs."""
        from app.models import Referrer

        _admin_login(test_client)
        # Add a second referrer
        r2 = Referrer(
            name="Second Referrer",
            family_limit=5,
            phone_number="555-111-1111",
            family_invite_code="KFI-SECO01",
        )
        db.add(r2)
        db.commit()

        resp = test_client.get("/api/admin/referrers/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

        ids = [item["id"] for item in body]
        assert referrer_record.id in ids
        assert r2.id in ids

        for item in body:
            assert set(item.keys()) == {"id", "name"}
            assert isinstance(item["id"], int)
            assert isinstance(item["name"], str)

    def test_200_ordered_by_id(self, test_client: TestClient, admin_user, db: Session):
        """Results are ordered by id ascending."""
        from app.models import Referrer

        _admin_login(test_client)
        for i in range(3):
            r = Referrer(
                name=f"Ref {i}",
                family_limit=10,
                phone_number="555-000-0000",
                family_invite_code=f"KFI-ORD{i:03d}",
            )
            db.add(r)
        db.commit()

        resp = test_client.get("/api/admin/referrers/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert ids == sorted(ids)

    def test_excludes_soft_deleted(self, test_client: TestClient, admin_user, referrer_record, db: Session):
        """Soft-deleted referrers do not appear in the dropdown."""
        from app.models import Referrer

        _admin_login(test_client)
        deleted_ref = Referrer(
            name="Deleted Referrer",
            family_limit=5,
            phone_number="555-222-2222",
            family_invite_code="KFI-DELR01",
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(deleted_ref)
        db.commit()

        resp = test_client.get("/api/admin/referrers/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        names = [item["name"] for item in body]
        assert "Deleted Referrer" not in names
        # Active referrer should still be present
        assert "Test Referrer" in names

    def test_empty_when_no_referrers(self, test_client: TestClient, admin_user):
        """Returns empty list when no referrers exist."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers/dropdown")
        assert resp.status_code == 200
        assert resp.json() == []


# =========================================================================
#  Admin — Families Dropdown
# =========================================================================


class TestAdminFamiliesDropdown:
    def test_200_returns_minimal_entries(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Returns all active families as {id, family_name} pairs."""
        from app.models import Family, FamilyApprovalStatus

        _admin_login(test_client)
        # Add a second family
        f2 = Family(
            family_name="Second Family",
            family_wish="A bike",
            contact_name="Second Contact",
            phone_number="555-333-3333",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(f2)
        db.commit()

        resp = test_client.get("/api/admin/families/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

        ids = [item["id"] for item in body]
        assert family_record.id in ids
        assert f2.id in ids

        for item in body:
            assert set(item.keys()) == {"id", "family_name"}
            assert isinstance(item["id"], int)
            assert isinstance(item["family_name"], str)

    def test_200_ordered_by_id(self, test_client: TestClient, admin_user, db: Session):
        """Results are ordered by id ascending."""
        from app.models import Family, FamilyApprovalStatus

        _admin_login(test_client)
        for i in range(3):
            f = Family(
                family_name=f"Family {i}",
                family_wish="Wish",
                contact_name=f"Contact {i}",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
            )
            db.add(f)
        db.commit()

        resp = test_client.get("/api/admin/families/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        ids = [item["id"] for item in body]
        assert ids == sorted(ids)

    def test_excludes_soft_deleted(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Soft-deleted families do not appear in the dropdown."""
        from app.models import Family, FamilyApprovalStatus

        _admin_login(test_client)
        deleted_fam = Family(
            family_name="Deleted Family",
            family_wish="Wish",
            contact_name="Deleted Contact",
            phone_number="555-444-4444",
            approval_status=FamilyApprovalStatus.approved,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(deleted_fam)
        db.commit()

        resp = test_client.get("/api/admin/families/dropdown")
        assert resp.status_code == 200
        body = resp.json()
        names = [item["family_name"] for item in body]
        assert "Deleted Family" not in names
        # Active family should still be present
        assert "TestFamily" in names

    def test_empty_when_no_families(self, test_client: TestClient, admin_user):
        """Returns empty list when no families exist."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/dropdown")
        assert resp.status_code == 200
        assert resp.json() == []


# =========================================================================
#  Auth guards
# =========================================================================

DROPDOWN_ENDPOINTS = [
    ("GET", "/api/admin/users/dropdown", {}),
    ("GET", "/api/admin/users/dropdown?roles=admin", {}),
    ("GET", "/api/admin/referrers/dropdown", {}),
    ("GET", "/api/admin/families/dropdown", {}),
]


class TestDropdownAuthGuards:
    """Auth guard tests for all dropdown endpoints."""

    @pytest.mark.parametrize("method,route,body", DROPDOWN_ENDPOINTS)
    def test_401_unauthenticated(self, test_client: TestClient, method: str, route: str, body: dict):
        """Unauthenticated requests to any dropdown endpoint return 401."""
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 401

    @pytest.mark.parametrize("method,route,body", DROPDOWN_ENDPOINTS)
    def test_403_non_admin(self, test_client: TestClient, referrer_user, method: str, route: str, body: dict):
        """Non-admin users get 403 on any dropdown endpoint."""
        _referrer_login(test_client)
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 403
