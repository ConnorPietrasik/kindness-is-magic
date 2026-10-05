"""Tests for admin recipient-prefill fields: ``contact_email`` on families
and ``email`` on referrers.

The prefill values are admin-only data: populated by the admin detail and
admin *active* list endpoints only. Everywhere else they are ``null`` —
including referrer self-service, which shares the ``FamilyDetail``/
``ReferrerDetail`` schemas and must never see the actual address. Family
self-service uses the separate ``FamilySelfServiceDetail`` schema and stays
byte-identical (no ``contact_email`` key at all).
"""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as, make_family


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


class TestFamilyContactEmailPrefill:
    """contact_email on FamilyDetail — admin prefill for family sends."""

    def test_admin_detail_carries_contact_email(self, test_client: TestClient, admin_user, db: Session, family_record, family_user):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/{family_record.id}")
        assert resp.status_code == 200
        assert resp.json()["contact_email"] == family_user.email

    def test_admin_detail_null_without_linked_user(self, test_client: TestClient, admin_user, db: Session):
        fam = make_family(db, family_name="NoUser", family_wish="Wishes", contact_name="C", phone_number="555-010-0000")
        db.commit()
        db.refresh(fam)

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/{fam.id}")
        assert resp.status_code == 200
        assert resp.json()["contact_email"] is None

    def test_admin_detail_null_when_user_soft_deleted(self, test_client: TestClient, admin_user, db: Session, family_record, family_user):
        family_user.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/families/{family_record.id}")
        assert resp.status_code == 200
        assert resp.json()["contact_email"] is None

    def test_admin_active_list_carries_contact_email(self, test_client: TestClient, admin_user, db: Session, family_record, family_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        rows = {f["id"]: f for f in resp.json()["families"]}
        assert rows[family_record.id]["contact_email"] == family_user.email

    def test_admin_active_list_null_when_user_soft_deleted(
        self, test_client: TestClient, admin_user, db: Session, family_record, family_user
    ):
        family_user.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        rows = {f["id"]: f for f in resp.json()["families"]}
        assert rows[family_record.id]["contact_email"] is None

    def test_admin_active_list_contact_email_survives_column_selection(
        self, test_client: TestClient, admin_user, db: Session, family_record, family_user
    ):
        """contact_email is guaranteed in the output (always_include)
        regardless of the client's columns selection."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families", params={"columns": "id,family_name"})
        assert resp.status_code == 200
        item = resp.json()["families"][0]
        assert item["contact_email"] == family_user.email

    def test_admin_deleted_list_contact_email_null(self, test_client: TestClient, admin_user, db: Session, family_record, family_user):
        """The deleted list does not opt in — its rows offer no send action."""
        family_record.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/families/deleted")
        assert resp.status_code == 200
        assert resp.json()["families"][0]["contact_email"] is None

    def test_family_self_service_has_no_contact_email_key(self, test_client: TestClient, db: Session, family_record, family_user):
        """Family self-service is byte-identical: the key is absent, not null."""
        login_as(test_client, "family@test.com", "FamPass1234!")
        resp = test_client.get("/api/family/me")
        assert resp.status_code == 200
        assert "contact_email" not in resp.json()

    def test_referrer_self_never_sees_contact_email(self, test_client: TestClient, db: Session, referrer_user, referrer_record):
        """Even with a linked family user, referrer self-service (shared
        FamilyDetail schema) carries the key with a null value — the email
        itself never leaves the admin endpoints."""
        from app.models import FamilyVerificationStatus, User, UserRole
        from app.auth import get_password_hash

        fam = make_family(
            db,
            referrer_id=referrer_record.id,
            family_name="Prefill",
            family_wish="Wishes",
            contact_name="C",
            phone_number="555-010-0000",
            verification_status=FamilyVerificationStatus.verified,
        )
        contact = User(
            email="prefill_family@test.com",
            hashed_password=get_password_hash("FamPass1234!"),
            role=UserRole.family,
            family_id=fam.id,
            display_name=None,
        )
        db.add(contact)
        db.commit()
        db.refresh(fam)

        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get(f"/api/referrer/families/{fam.id}")
        assert resp.status_code == 200
        assert "contact_email" in resp.json()
        assert resp.json()["contact_email"] is None

        resp = test_client.get("/api/referrer/families")
        assert resp.status_code == 200
        assert [f["contact_email"] for f in resp.json()["families"]] == [None]


class TestReferrerEmailPrefill:
    """email on ReferrerDetail — admin prefill for referrer sends."""

    def test_admin_detail_carries_email(self, test_client: TestClient, admin_user, db: Session, referrer_record, referrer_user):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/referrers/{referrer_record.id}")
        assert resp.status_code == 200
        assert resp.json()["email"] == referrer_user.email

    def test_admin_detail_null_without_linked_user(self, test_client: TestClient, admin_user, db: Session, referrer_record):
        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/referrers/{referrer_record.id}")
        assert resp.status_code == 200
        assert resp.json()["email"] is None

    def test_admin_detail_null_when_user_soft_deleted(
        self, test_client: TestClient, admin_user, db: Session, referrer_record, referrer_user
    ):
        referrer_user.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get(f"/api/admin/referrers/{referrer_record.id}")
        assert resp.status_code == 200
        assert resp.json()["email"] is None

    def test_admin_active_list_carries_email(self, test_client: TestClient, admin_user, db: Session, referrer_record, referrer_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers")
        assert resp.status_code == 200
        rows = {r["id"]: r for r in resp.json()["referrers"]}
        assert rows[referrer_record.id]["email"] == referrer_user.email

    def test_admin_active_list_email_survives_column_selection(
        self, test_client: TestClient, admin_user, db: Session, referrer_record, referrer_user
    ):
        """email is guaranteed in the output (always_include) regardless of
        the client's columns selection."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers", params={"columns": "id,name"})
        assert resp.status_code == 200
        item = resp.json()["referrers"][0]
        assert item["email"] == referrer_user.email

    def test_admin_deleted_list_email_null(self, test_client: TestClient, admin_user, db: Session, referrer_record, referrer_user):
        """The deleted list does not opt in — its rows offer no send action."""
        referrer_record.deleted_at = datetime.now(timezone.utc)
        db.commit()

        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers/deleted")
        assert resp.status_code == 200
        assert resp.json()["referrers"][0]["email"] is None

    def test_referrer_self_me_email_null(self, test_client: TestClient, db: Session, referrer_user, referrer_record):
        """Referrer self-service (shared ReferrerDetail schema) carries the
        key with a null value — never its own email."""
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/referrer/me")
        assert resp.status_code == 200
        assert "email" in resp.json()
        assert resp.json()["email"] is None
