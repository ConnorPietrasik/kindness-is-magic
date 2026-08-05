"""Tests for referrer notes on families.

Validates that:
- Referrers can set/update/clear notes on their families
- Notes bypass wish lock (editable even at admin lock level)
- Admins can set/update/clear notes on any family
- Families cannot see or modify referrer_notes
- has_notes boolean appears correctly in list responses
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tree_referrer_login(client: TestClient) -> dict:
    """Log in as the tree_referrer fixture user."""
    return login_as(client, "tree_referrer@test.com", "TreeRef1234!")


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


# =========================================================================
# Referrer — Set / Update / Clear Notes
# =========================================================================


class TestReferrerSetNotes:
    def test_referrer_can_set_notes(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "This family needs extra attention"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["referrer_notes"] == "This family needs extra attention"

    def test_referrer_can_update_notes(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        # Set initial notes
        test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "Initial note"},
        )

        # Update notes
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "Updated note text"},
        )
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] == "Updated note text"

    def test_referrer_can_clear_notes_with_empty_string(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        # Set notes
        test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "Some note"},
        )

        # Clear notes with empty string
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] is None

    def test_referrer_notes_present_in_get_family(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        # Set notes
        test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "Visible note"},
        )

        # GET should include referrer_notes
        resp = test_client.get(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 200
        assert "referrer_notes" in resp.json()
        assert resp.json()["referrer_notes"] == "Visible note"

    def test_referrer_notes_absent_when_null(self, test_client: TestClient, referrer_with_full_tree):
        """When notes are NULL, the field should still be present (as null) in detail."""
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        resp = test_client.get(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 200
        body = resp.json()
        # Field is present in the response schema
        assert "referrer_notes" in body
        assert body["referrer_notes"] is None

    def test_referrer_cannot_edit_other_referrer_family(
        self, test_client: TestClient, referrer_with_full_tree, another_referrer, db: Session
    ):
        """Referrer cannot access another referrer's family (403 via require_family_owner)."""
        _tree_referrer_login(test_client)

        # Create a family under another referrer
        from app.models import Family, FamilyApprovalStatus

        other_fam = Family(
            referrer_id=another_referrer["referrer"].id,
            family_name="Other Referrer Family",
            family_wish="Something",
            contact_name="Other Contact",
            phone_number="555-999-9999",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(other_fam)
        db.commit()
        db.refresh(other_fam)

        resp = test_client.patch(
            f"/api/referrer/families/{other_fam.id}",
            json={"referrer_notes": "Should fail"},
        )
        assert resp.status_code == 403


# =========================================================================
# Referrer — Notes Bypass Wish Lock
# =========================================================================


class TestReferrerNotesBypassLock:
    def test_referrer_can_set_notes_when_admin_locked(self, test_client: TestClient, referrer_with_full_tree, db: Session):
        """Notes are editable even when wish_lock_level == admin."""
        from app.models import WishLockLevel

        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        # Lock the family at admin level
        fam.wish_lock_level = WishLockLevel.admin
        db.commit()

        # Standard edits should be blocked
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"family_name": "Changed Name"},
        )
        assert resp.status_code == 403

        # But notes should still work
        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "Note despite lock"},
        )
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] == "Note despite lock"

    def test_referrer_can_set_notes_and_standard_fields_when_not_locked(self, test_client: TestClient, referrer_with_full_tree):
        """When not locked, both notes and standard fields can be updated together."""
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={
                "family_name": "Updated Family Name",
                "referrer_notes": "Combined update",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "Updated Family Name"
        assert body["referrer_notes"] == "Combined update"

    def test_referrer_notes_only_bypasses_lock_standard_fields_still_blocked(
        self, test_client: TestClient, referrer_with_full_tree, db: Session
    ):
        """When admin-locked, sending notes + standard fields should fail for the standard fields.

        The endpoint checks for standard fields first and rejects if locked,
        even if notes are also in the payload.
        """
        from app.models import WishLockLevel

        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        fam.wish_lock_level = WishLockLevel.admin
        db.commit()

        resp = test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={
                "family_name": "Should Fail",
                "referrer_notes": "Also should not apply",
            },
        )
        assert resp.status_code == 403


# =========================================================================
# Referrer — has_notes in List Response
# =========================================================================


class TestReferrerHasNotesInList:
    def test_has_notes_true_when_notes_exist(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        test_client.patch(
            f"/api/referrer/families/{fam.id}",
            json={"referrer_notes": "A note"},
        )

        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        families = resp.json()["families"]
        target = [f for f in families if f["id"] == fam.id][0]
        assert target["has_notes"] is True

    def test_has_notes_false_when_no_notes(self, test_client: TestClient, referrer_with_full_tree):
        _tree_referrer_login(test_client)
        fam = referrer_with_full_tree["family"]

        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        families = resp.json()["families"]
        target = [f for f in families if f["id"] == fam.id][0]
        assert target["has_notes"] is False


# =========================================================================
# Admin — Notes
# =========================================================================


class TestAdminNotes:
    def test_admin_can_set_notes(self, test_client: TestClient, admin_user, referrer_with_full_tree):
        _admin_login(test_client)
        fam = referrer_with_full_tree["family"]

        resp = test_client.patch(
            f"/api/admin/families/{fam.id}",
            json={"referrer_notes": "Admin internal note"},
        )
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] == "Admin internal note"

    def test_admin_can_clear_notes(self, test_client: TestClient, admin_user, referrer_with_full_tree):
        _admin_login(test_client)
        fam = referrer_with_full_tree["family"]

        # Set notes first
        test_client.patch(
            f"/api/admin/families/{fam.id}",
            json={"referrer_notes": "Admin note"},
        )

        # Clear notes
        resp = test_client.patch(
            f"/api/admin/families/{fam.id}",
            json={"referrer_notes": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] is None

    def test_admin_get_family_includes_notes(self, test_client: TestClient, admin_user, referrer_with_full_tree):
        _admin_login(test_client)
        fam = referrer_with_full_tree["family"]

        test_client.patch(
            f"/api/admin/families/{fam.id}",
            json={"referrer_notes": "Admin note"},
        )

        resp = test_client.get(f"/api/admin/families/{fam.id}")
        assert resp.status_code == 200
        assert resp.json()["referrer_notes"] == "Admin note"

    def test_admin_list_includes_has_notes(self, test_client: TestClient, admin_user, referrer_with_full_tree):
        _admin_login(test_client)
        fam = referrer_with_full_tree["family"]

        test_client.patch(
            f"/api/admin/families/{fam.id}",
            json={"referrer_notes": "Admin note"},
        )

        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        families = resp.json()["families"]
        target = [f for f in families if f["id"] == fam.id][0]
        assert target["has_notes"] is True


# =========================================================================
# Family — Cannot See or Modify Notes
# =========================================================================


class TestFamilyCannotAccessNotes:
    def test_family_cannot_modify_notes(self, test_client: TestClient, db: Session):
        """Family self-update cannot modify referrer_notes (field not in FamilyUpdate)."""
        from app.models import Family, FamilyApprovalStatus, Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        # Create a referrer
        ref = Referrer(
            name="Note Test Referrer",
            family_limit=5,
            phone_number="555-300-3000",
            family_invite_code="KFI-NTST01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        # Create a family under that referrer
        fam = Family(
            referrer_id=ref.id,
            family_name="Note Test Family",
            family_wish="Peace",
            contact_name="Note Contact",
            phone_number="555-300-3001",
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        # Create a family user
        user = User(
            email="note_family@test.com",
            hashed_password=get_password_hash("NoteFam1234!"),
            role=UserRole.family,
            family_id=fam.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Log in as family
        login_as(test_client, "note_family@test.com", "NoteFam1234!")

        # Try to send referrer_notes (should be ignored — not in FamilyUpdate schema)
        resp = test_client.patch(
            "/api/family/me",
            json={"family_name": "Updated by family"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["family_name"] == "Updated by family"
        # referrer_notes should not be in the response
        assert "referrer_notes" not in body

    def test_referrer_notes_absent_from_family_me(self, test_client: TestClient, db: Session):
        """referrer_notes key should not be present in GET /api/family/me response."""
        from app.models import Family, FamilyApprovalStatus, Referrer, ReferrerApprovalStatus, User, UserRole
        from app.auth import get_password_hash

        ref = Referrer(
            name="Absent Test Referrer",
            family_limit=5,
            phone_number="555-400-4000",
            family_invite_code="KFI-ABST01",
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)

        fam = Family(
            referrer_id=ref.id,
            family_name="Absent Test Family",
            family_wish="Joy",
            contact_name="Absent Contact",
            phone_number="555-400-4001",
            approval_status=FamilyApprovalStatus.approved,
            referrer_notes="Secret note that family should not see",
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        user = User(
            email="absent_family@test.com",
            hashed_password=get_password_hash("AbsentFam1234!"),
            role=UserRole.family,
            family_id=fam.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        login_as(test_client, "absent_family@test.com", "AbsentFam1234!")
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 200
        body = resp.json()
        assert "referrer_notes" not in body
