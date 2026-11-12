"""Tests for role-based permissions (permissions.py guards).

Focuses on scenarios NOT already covered by test_auth.py:
  - family role being denied admin-only endpoints
  - tampered (structurally invalid) JWTs
  - inactive users with otherwise valid tokens
  - require_family_owner NULL-ownership regression (F1)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as, make_family


def _make_user(db: Session, email: str, password: str, role, **kwargs):
    """Create and commit a user, returning the instance."""
    from app.auth import get_password_hash
    from app.models import User

    user = User(
        email=email,
        hashed_password=get_password_hash(password),
        role=role,
        display_name=None,
        **kwargs,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Family-specific admin access (test_auth.py only checks referrer)
# ---------------------------------------------------------------------------


class TestRequireAdmin:
    """require_admin guard — family-role user denied admin endpoints."""

    def test_family_cannot_access_admin_users(self, test_client: TestClient, family_user):
        """Family user is rejected from admin-only /api/admin/users."""
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/admin/users")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tampered JWTs (test_auth_utils.py tests expired tokens,
# test_auth.py tests valid-token flows)
# ---------------------------------------------------------------------------


class TestTamperedToken:
    def test_tampered_token_returns_401(self, test_client: TestClient, admin_user):
        test_client.cookies.set("access_token", "eyJhbGciOiJIUzI1NiJ9.tampered.signature")
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Inactive user with valid token
# ---------------------------------------------------------------------------


class TestInactiveUserAuth:
    def test_inactive_user_rejected_with_valid_token(self, test_client: TestClient, db):
        """Even a correctly signed JWT must be rejected for a deleted user."""
        from datetime import datetime, timezone

        from app.auth import create_access_token
        from app.models import User, UserRole

        user = User(
            email="inactive@test.com",
            hashed_password="dummy",
            role=UserRole.admin,
            display_name=None,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()

        token = create_access_token({"sub": str(user.id), "role": "admin"})
        test_client.cookies.set("access_token", token)
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# require_family_owner — NULL-ownership regression (F1)
# ---------------------------------------------------------------------------


class TestReferrerFamilyOwnership:
    """Only the referrer assigned to a family may access it via /api/referrer/families/*.

    Regression for the NULL-ownership IDOR: both Family.referrer_id and
    User.referrer_id are nullable, and the old comparison
    ``fam.referrer_id != user.referrer_id`` treated ``None != None`` as
    "owns", so any authenticated user without a referrer (family, donor,
    purchaser, delivery) could read, edit and soft-delete any family with
    no referrer assigned — including the internal referrer_notes.
    """

    @pytest.fixture()
    def unassigned_family(self, db: Session):
        """Family with no referrer — creatable via the admin UI (Unassign referrer)."""
        from app.models import FamilyVerificationStatus

        fam = make_family(
            db,
            family_name="Orphan Family",
            family_wish="A new start",
            contact_name="Orphan Contact",
            phone_number="555-900-0001",
            verification_status=FamilyVerificationStatus.verified,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)
        return fam

    @pytest.fixture()
    def orphan_referrer(self, db: Session):
        """Referrer-role user with no referrer record (NULL referrer_id).

        The admin user API and CSV import both reject a referrer role
        without a referrer_id (validate_user_role_consistency), so this
        state can only arise from legacy or manually edited data. The
        user can still log in (the rejected-referrer check skips NULL
        referrer_id), so the guards must not rely on role alone.
        """
        from app.models import UserRole

        return _make_user(db, "perm_orphan_referrer@test.com", "PermPass1234!", UserRole.referrer)

    @pytest.fixture()
    def non_referrer_users(self, db: Session, family_record):
        """One user per non-referrer role (family, donor, purchaser, delivery, admin)."""
        from app.models import UserRole

        users = {}
        for role in (UserRole.family, UserRole.donor, UserRole.purchaser, UserRole.delivery, UserRole.admin):
            kwargs = {"family_id": family_record.id} if role == UserRole.family else {}
            users[role.value] = _make_user(db, f"perm_{role.value}@test.com", "PermPass1234!", role, **kwargs)
        return users

    def test_owning_referrer_still_accesses_family(self, test_client: TestClient, referrer_with_full_tree):
        """Positive control: legitimate referrer access is unaffected by the guard."""
        login_as(test_client, "tree_referrer@test.com", "TreeRef1234!")
        resp = test_client.get(f"/api/referrer/families/{referrer_with_full_tree['family'].id}")
        assert resp.status_code == 200

    @pytest.mark.parametrize("role", ["family", "donor", "purchaser", "delivery", "admin"])
    def test_non_referrer_role_cannot_read_family_detail(
        self, test_client: TestClient, role, non_referrer_users, referrer_with_full_tree, unassigned_family
    ):
        """Every non-referrer role gets 403 — for assigned AND unassigned families."""
        user = non_referrer_users[role]
        login_as(test_client, user.email, "PermPass1234!")
        for fam in (referrer_with_full_tree["family"], unassigned_family):
            resp = test_client.get(f"/api/referrer/families/{fam.id}")
            assert resp.status_code == 403, f"role={role} family_id={fam.id}"

    def test_donor_cannot_edit_unassigned_family(self, test_client: TestClient, db: Session, non_referrer_users, unassigned_family):
        """The reported PATCH probe: donor rename attempt must 403 and leave the row intact."""
        user = non_referrer_users["donor"]
        login_as(test_client, user.email, "PermPass1234!")
        resp = test_client.patch(f"/api/referrer/families/{unassigned_family.id}", json={"family_name": "Hacked"})
        assert resp.status_code == 403
        db.refresh(unassigned_family)
        assert unassigned_family.family_name == "Orphan Family"

    def test_family_role_cannot_delete_unassigned_family(self, test_client: TestClient, db: Session, non_referrer_users, unassigned_family):
        """The reported DELETE probe: soft-delete must be blocked, deleted_at stays None."""
        user = non_referrer_users["family"]
        login_as(test_client, user.email, "PermPass1234!")
        resp = test_client.delete(f"/api/referrer/families/{unassigned_family.id}")
        assert resp.status_code == 403
        db.refresh(unassigned_family)
        assert unassigned_family.deleted_at is None

    def test_referrer_without_referrer_record_cannot_access_unassigned_family(
        self, test_client: TestClient, unassigned_family, orphan_referrer
    ):
        """Ownership requires a set referrer_id — a NULL referrer_id is not "owner" of NULL families."""
        login_as(test_client, orphan_referrer.email, "PermPass1234!")
        resp = test_client.get(f"/api/referrer/families/{unassigned_family.id}")
        assert resp.status_code == 403

    @pytest.mark.parametrize("path", ["/api/referrer/families", "/api/referrer/pending-families", "/api/referrer/review-queue"])
    def test_referrer_without_referrer_record_gets_empty_lists(
        self, test_client: TestClient, db: Session, unassigned_family, orphan_referrer, path
    ):
        """A referrer user with a NULL referrer_id sees no families in any list endpoint.

        Regression: `Family.referrer_id == user.referrer_id` renders as
        `referrer_id IS NULL` in SQLAlchemy, which matched every unassigned
        family in the list endpoints.
        """
        from datetime import datetime, timezone

        from app.models import FamilyVerificationStatus, WishLockLevel

        # Put the unassigned family in a state each endpoint lists, so the
        # regression is exercised rather than passing vacuously.
        if path == "/api/referrer/pending-families":
            unassigned_family.verification_status = FamilyVerificationStatus.pending
        elif path == "/api/referrer/review-queue":
            unassigned_family.wish_lock_level = WishLockLevel.family
            unassigned_family.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()

        login_as(test_client, orphan_referrer.email, "PermPass1234!")
        resp = test_client.get(path)
        assert resp.status_code == 200
        body = resp.json()
        families = body if isinstance(body, list) else body.get("families", [])
        assert families == [], f"{path} leaked unassigned families: {families}"


# ---------------------------------------------------------------------------
# require_family_owner / require_person_owner — non-numeric path ids (F2)
# ---------------------------------------------------------------------------


class TestNonNumericPathId:
    """Non-numeric ids in guarded routes must yield 422, not 500.

    Regression for F2: the guards read the raw path param and called ``int()``
    inside the dependency, which FastAPI resolves *before* validating the
    endpoint's own path params — so an authenticated referrer hitting
    ``/api/referrer/families/abc/people`` raised ValueError and the catch-all
    handler turned it into a 500.
    """

    @pytest.mark.parametrize(
        "path",
        [
            "/api/referrer/families/abc",  # fam_id variant (require_family_owner)
            "/api/referrer/families/abc/people",  # fid variant (require_family_owner)
            "/api/people/abc",  # per_id (require_person_owner, family branch)
        ],
    )
    def test_non_numeric_id_returns_422_not_500(self, test_client: TestClient, referrer_user, family_user, path):
        """A typo'd id is a client error — users get 422 instead of a server error."""
        if path.startswith("/api/referrer/"):
            login_as(test_client, "referrer@test.com", "RefPass1234!")
        else:
            login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get(path)
        assert resp.status_code == 422
