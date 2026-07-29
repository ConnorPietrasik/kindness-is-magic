"""Tests for admin CRUD endpoints: users."""

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
#  Admin — List Users
# =========================================================================


class TestAdminListUsers:
    def test_200_empty(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users")
        assert resp.status_code == 200
        body = resp.json()
        # admin_user fixture creates one user, so list has at least that
        assert body["total"] >= 1
        assert body["page"] == 1
        assert body["page_size"] == 50

    def test_200_with_data(self, test_client: TestClient, admin_user, referrer_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 2  # admin + referrer
        emails = [u["email"] for u in body["users"]]
        assert "admin@test.com" in emails
        assert "referrer@test.com" in emails

    def test_pagination(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        for i in range(4):
            u = User(
                email=f"page{i}@test.com",
                hashed_password=get_password_hash("PagePass123!"),
                role=UserRole.admin,
            )
            db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users?page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["users"]) == 2
        assert body["total"] >= 5  # admin + 4 new
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert body["total_pages"] >= 3

    def test_filter_by_role(self, test_client: TestClient, admin_user, referrer_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users?role=admin")
        assert resp.status_code == 200
        body = resp.json()
        assert all(u["role"] == "admin" for u in body["users"])

        resp = test_client.get("/api/admin/users?role=referrer")
        assert resp.status_code == 200
        body = resp.json()
        assert all(u["role"] == "referrer" for u in body["users"])

    def test_search_by_email(self, test_client: TestClient, admin_user, referrer_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users?search=admin@test")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["users"]) >= 1
        assert body["users"][0]["email"] == "admin@test.com"

    def test_search_by_display_name(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="searchable@test.com",
            hashed_password=get_password_hash("SearchPass123!"),
            role=UserRole.admin,
            display_name="Searchable User",
        )
        db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users?search=Searchable")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["users"]) == 1
        assert body["users"][0]["display_name"] == "Searchable User"

    def test_excludes_soft_deleted_by_default(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="deleted@test.com",
            hashed_password=get_password_hash("DeletedPass123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users")
        assert resp.status_code == 200
        body = resp.json()
        emails = [u["email"] for u in body["users"]]
        assert "deleted@test.com" not in emails

    def test_include_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="deleted2@test.com",
            hashed_password=get_password_hash("DeletedPass123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(u)
        db.commit()

        resp = test_client.get("/api/admin/users?include_deleted=true")
        assert resp.status_code == 200
        body = resp.json()
        emails = [u["email"] for u in body["users"]]
        assert "deleted2@test.com" in emails

    def test_summary_has_joined_names(self, test_client: TestClient, admin_user, referrer_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users?role=referrer")
        assert resp.status_code == 200
        body = resp.json()
        referrer_entry = [u for u in body["users"] if u["email"] == "referrer@test.com"][0]
        assert referrer_entry["referrer_name"] == "Test Referrer"
        assert referrer_entry["family_name"] is None


# =========================================================================
#  Admin — Get User Detail
# =========================================================================


class TestAdminGetUser:
    def test_200_detail(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/users/{admin_user.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == admin_user.id
        assert body["email"] == "admin@test.com"
        assert body["role"] == "admin"
        assert body["deleted_at"] is None

    def test_200_detail_with_joined_names(self, test_client: TestClient, admin_user, referrer_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/users/{referrer_user.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["referrer_name"] == "Test Referrer"
        assert body["family_name"] is None

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users/99999")
        assert resp.status_code == 404

    def test_404_soft_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="gone@test.com",
            hashed_password=get_password_hash("GonePass123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        resp = test_client.get(f"/api/admin/users/{u.id}")
        assert resp.status_code == 404


# =========================================================================
#  Admin — Create User
# =========================================================================


class TestAdminCreateUser:
    def test_201_create_admin(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "newadmin@test.com",
                "password": "AdminPass123!",
                "role": "admin",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "newadmin@test.com"
        assert body["role"] == "admin"
        assert body["referrer_id"] is None
        assert body["family_id"] is None
        assert body["deleted_at"] is None

    def test_201_create_referrer(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "newref@test.com",
                "password": "RefPass1234!",
                "role": "referrer",
                "referrer_id": referrer_record.id,
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "newref@test.com"
        assert body["role"] == "referrer"
        assert body["referrer_id"] == referrer_record.id
        assert body["referrer_name"] == "Test Referrer"

    def test_201_create_family(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "newfam@test.com",
                "password": "FamPass1234!",
                "role": "family",
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "newfam@test.com"
        assert body["role"] == "family"
        assert body["family_id"] == family_record.id
        assert body["family_name"] == "TestFamily"

    def test_201_create_with_display_name(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "named@test.com",
                "password": "NamedPass123!",
                "role": "admin",
                "display_name": "Named User",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["display_name"] == "Named User"

    def test_422_admin_with_referrer_id(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badadmin@test.com",
                "password": "BadAdmin123!",
                "role": "admin",
                "referrer_id": referrer_record.id,
            },
        )
        assert resp.status_code == 422

    def test_422_admin_with_family_id(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badadmin2@test.com",
                "password": "BadAdmin123!",
                "role": "admin",
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 422

    def test_422_referrer_missing_referrer_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badref@test.com",
                "password": "BadRef1234!",
                "role": "referrer",
            },
        )
        assert resp.status_code == 422

    def test_422_referrer_with_family_id(self, test_client: TestClient, admin_user, referrer_record, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badref2@test.com",
                "password": "BadRef1234!",
                "role": "referrer",
                "referrer_id": referrer_record.id,
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 422

    def test_422_family_missing_family_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badfam@test.com",
                "password": "BadFam1234!",
                "role": "family",
            },
        )
        assert resp.status_code == 422

    def test_422_family_with_referrer_id(self, test_client: TestClient, admin_user, referrer_record, family_record):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badfam2@test.com",
                "password": "BadFam1234!",
                "role": "family",
                "referrer_id": referrer_record.id,
                "family_id": family_record.id,
            },
        )
        assert resp.status_code == 422

    def test_409_duplicate_email(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        # First creation succeeds
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "dupemail@test.com",
                "password": "DupPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 201
        # Second creation with same email fails
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "dupemail@test.com",
                "password": "DupPass1234!",
                "role": "admin",
            },
        )
        assert resp.status_code == 409

    def test_422_referrer_fk_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badfk@test.com",
                "password": "BadFkPass123!",
                "role": "referrer",
                "referrer_id": 99999,
            },
        )
        assert resp.status_code in (404, 422)

    def test_422_referrer_fk_soft_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Referrer

        _admin_login(test_client)
        ref = Referrer(name="Deleted Ref", family_limit=5, phone_number="555-999-9999", family_invite_code="KFI-DELT01")
        ref.deleted_at = datetime.now(timezone.utc)
        db.add(ref)
        db.commit()
        db.refresh(ref)

        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badfkdel@test.com",
                "password": "BadFkDel123!",
                "role": "referrer",
                "referrer_id": ref.id,
            },
        )
        assert resp.status_code == 422

    def test_422_family_fk_soft_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Family, FamilyApprovalStatus

        _admin_login(test_client)
        fam = Family(
            family_name="Deleted Fam",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-999-9999",
            approval_status=FamilyApprovalStatus.approved,
        )
        fam.deleted_at = datetime.now(timezone.utc)
        db.add(fam)
        db.commit()
        db.refresh(fam)

        resp = test_client.post(
            "/api/admin/users",
            json={
                "email": "badfkdel2@test.com",
                "password": "BadFkDel123!",
                "role": "family",
                "family_id": fam.id,
            },
        )
        assert resp.status_code == 422


# =========================================================================
#  Admin — Update User
# =========================================================================


class TestAdminUpdateUser:
    def test_200_update_display_name(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"display_name": "Updated Name"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["display_name"] == "Updated Name"

    def test_200_update_to_referrer(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"role": "referrer", "referrer_id": referrer_record.id},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["role"] == "referrer"
        assert body["referrer_id"] == referrer_record.id

    def test_200_update_to_family(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"role": "family", "family_id": family_record.id},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["role"] == "family"
        assert body["family_id"] == family_record.id

    def test_200_update_soft_deleted_user(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        target = User(
            email="softdel_update@test.com",
            hashed_password=get_password_hash("SoftDelPass123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(target)
        db.commit()
        db.refresh(target)

        resp = test_client.patch(
            f"/api/admin/users/{target.id}",
            json={"display_name": "Updated While Deleted"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["display_name"] == "Updated While Deleted"

    def test_422_role_change_to_referrer_without_fk(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"role": "referrer"},
        )
        assert resp.status_code == 422

    def test_422_role_change_to_family_without_fk(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"role": "family"},
        )
        assert resp.status_code == 422

    def test_200_referrer_to_admin_clears_fk_with_zero_sentinel(self, test_client: TestClient, admin_user, referrer_user, referrer_record):
        """Frontend sends referrer_id=0 as a 'clear' sentinel when role changes to admin."""
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/admin/users/{referrer_user.id}",
            json={"role": "admin", "referrer_id": 0, "family_id": 0},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["role"] == "admin"
        assert body["referrer_id"] is None
        assert body["family_id"] is None

    def test_200_family_to_admin_clears_fk_with_zero_sentinel(self, test_client: TestClient, admin_user, family_record, db: Session):
        """Frontend sends family_id=0 as a 'clear' sentinel when role changes to admin."""
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        target = User(
            email="fam_to_admin@test.com",
            hashed_password=get_password_hash("FamPass1234!"),
            role=UserRole.family,
            family_id=family_record.id,
        )
        db.add(target)
        db.commit()
        db.refresh(target)

        resp = test_client.patch(
            f"/api/admin/users/{target.id}",
            json={"role": "admin", "referrer_id": 0, "family_id": 0},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["role"] == "admin"
        assert body["referrer_id"] is None
        assert body["family_id"] is None

    def test_422_fk_to_soft_deleted_referrer(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Referrer

        _admin_login(test_client)
        ref = Referrer(name="Deleted Ref 2", family_limit=5, phone_number="555-888-8888", family_invite_code="KFI-DELT02")
        ref.deleted_at = datetime.now(timezone.utc)
        db.add(ref)
        db.commit()
        db.refresh(ref)

        resp = test_client.patch(
            f"/api/admin/users/{admin_user.id}",
            json={"role": "referrer", "referrer_id": ref.id},
        )
        assert resp.status_code == 422

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch(
            "/api/admin/users/99999",
            json={"display_name": "Nope"},
        )
        assert resp.status_code == 404


# =========================================================================
#  Admin — Restore User
# =========================================================================


class TestAdminRestoreUser:
    def test_200_restore_soft_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        target = User(
            email="softdel_restore@test.com",
            hashed_password=get_password_hash("SoftDelPass123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(target)
        db.commit()
        db.refresh(target)

        resp = test_client.post(f"/api/admin/users/{target.id}/restore")
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted_at"] is None

    def test_400_restore_not_deleted(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(f"/api/admin/users/{admin_user.id}/restore")
        assert resp.status_code == 400

    def test_404_restore_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post("/api/admin/users/99999/restore")
        assert resp.status_code == 404


# =========================================================================
#  Admin — Reset Password
# =========================================================================


class TestAdminResetPassword:
    def test_200_reset_password(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/admin/users/{admin_user.id}/reset-password",
            json={"password": "NewPassword123!"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == admin_user.email

    def test_200_reset_then_login(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        # Create a separate user to reset password on
        u = User(
            email="resetme@test.com",
            hashed_password=get_password_hash("OldPass1234!"),
            role=UserRole.admin,
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        # Reset password
        resp = test_client.post(
            f"/api/admin/users/{u.id}/reset-password",
            json={"password": "NewPass1234!"},
        )
        assert resp.status_code == 200

        # Log out (clear cookies) and log in with new password
        test_client.cookies.clear()
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "resetme@test.com", "password": "NewPass1234!"},
        )
        assert resp.status_code == 200

    def test_404_reset_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/users/99999/reset-password",
            json={"password": "NewPassword123!"},
        )
        assert resp.status_code == 404


# =========================================================================
#  Admin — Delete User
# =========================================================================


class TestAdminDeleteUser:
    def test_204_success(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        # Create a disposable user (don't delete the admin fixture)
        u = User(
            email="deleteme@test.com",
            hashed_password=get_password_hash("DeletePass123!"),
            role=UserRole.admin,
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        resp = test_client.delete(f"/api/admin/users/{u.id}")
        assert resp.status_code == 204

        # Verify soft-deleted
        db.refresh(u)
        assert u.deleted_at is not None

    def test_soft_delete_excluded_from_list(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="excluded@test.com",
            hashed_password=get_password_hash("Excluded123!"),
            role=UserRole.admin,
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        resp = test_client.delete(f"/api/admin/users/{u.id}")
        assert resp.status_code == 204

        resp = test_client.get("/api/admin/users")
        assert resp.status_code == 200
        body = resp.json()
        emails = [u["email"] for u in body["users"]]
        assert "excluded@test.com" not in emails

    def test_soft_delete_reappears_with_include_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="reappear@test.com",
            hashed_password=get_password_hash("Reappear123!"),
            role=UserRole.admin,
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        resp = test_client.delete(f"/api/admin/users/{u.id}")
        assert resp.status_code == 204

        resp = test_client.get("/api/admin/users?include_deleted=true")
        assert resp.status_code == 200
        body = resp.json()
        emails = [u["email"] for u in body["users"]]
        assert "reappear@test.com" in emails

    def test_404_not_found(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/users/99999")
        assert resp.status_code == 404

    def test_404_already_deleted(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, UserRole
        from app.auth import get_password_hash

        _admin_login(test_client)
        u = User(
            email="alreadygone@test.com",
            hashed_password=get_password_hash("AlreadyGone123!"),
            role=UserRole.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        resp = test_client.delete(f"/api/admin/users/{u.id}")
        assert resp.status_code == 404


# =========================================================================
#  Auth guards
# =========================================================================


ADMIN_USER_ENDPOINTS = [
    ("GET", "/api/admin/users", {}),
    ("GET", "/api/admin/users/1", {}),
    ("POST", "/api/admin/users", {"email": "new@test.com", "password": "NewPass123!", "role": "admin"}),
    ("PATCH", "/api/admin/users/1", {"display_name": "Updated"}),
    ("POST", "/api/admin/users/1/restore", {}),
    ("POST", "/api/admin/users/1/reset-password", {"password": "NewPass123!"}),
    ("DELETE", "/api/admin/users/1", {}),
]


class TestAdminUserAuthGuards:
    @pytest.mark.parametrize("method,route,body", ADMIN_USER_ENDPOINTS)
    def test_401_unauthenticated(self, test_client: TestClient, method: str, route: str, body: dict):
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 401

    @pytest.mark.parametrize("method,route,body", ADMIN_USER_ENDPOINTS)
    def test_403_non_admin(self, test_client: TestClient, referrer_user, method: str, route: str, body: dict):
        _referrer_login(test_client)
        if body:
            resp = test_client.request(method, route, json=body)
        else:
            resp = test_client.request(method, route)
        assert resp.status_code == 403
