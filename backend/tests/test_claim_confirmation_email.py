"""Tests for donor claim confirmation email (sent on gift claims)."""

from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "AdminPass123!"

DONOR_EMAIL = "donor@test.com"
DONOR_PASSWORD = "DonorPass1234!"
DONOR_DISPLAY_NAME = "Test Donor"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, ADMIN_EMAIL, ADMIN_PASSWORD)


def _create_donor(client: TestClient) -> dict:
    resp = client.post(
        "/api/auth/register-donor",
        json={
            "display_name": DONOR_DISPLAY_NAME,
            "email": DONOR_EMAIL,
            "password": DONOR_PASSWORD,
        },
    )
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"
    return resp.json()


def _create_claimed_family(db: Session) -> dict:
    """Create a verified, admin-locked family with people and wishes."""
    from app.models import Family, FamilyVerificationStatus, Person, Wish, WishLockLevel, WishType

    fam = Family(
        family_name="Claimed Family",
        family_wish="Warm clothes",
        contact_name="Claim Contact",
        phone_number="555-000-0000",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
        bio="A family in need of warm clothes.",
    )
    db.add(fam)
    db.flush()

    person = Person(
        family_id=fam.id,
        given_name="Alice",
        age=8,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A coat", size="Medium")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(fam)
    db.refresh(person)
    db.refresh(w1)
    db.refresh(w2)

    return {"family": fam, "person": person, "wishes": [w1, w2]}


def _create_family_with_adult(db: Session) -> dict:
    """Create a family with an adult person."""
    from app.models import Family, FamilyVerificationStatus, Person, Wish, WishLockLevel, WishType

    fam = Family(
        family_name="Adult Family",
        family_wish="Food",
        contact_name="Adult Contact",
        phone_number="555-000-0000",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
        bio="An adult needing help.",
    )
    db.add(fam)
    db.flush()

    person = Person(
        family_id=fam.id,
        given_name="Bob",
        age=25,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.adult, description="Winter jacket", size="Large")
    db.add(w1)
    db.commit()
    db.refresh(fam)
    db.refresh(person)
    db.refresh(w1)

    return {"family": fam, "person": person, "wishes": [w1]}


def _create_empty_family(db: Session) -> dict:
    """Create a verified family with no people."""
    from app.models import Family, FamilyVerificationStatus, WishLockLevel

    fam = Family(
        family_name="Empty Family",
        family_wish="Support",
        contact_name="Empty Contact",
        phone_number="555-000-0000",
        verification_status=FamilyVerificationStatus.verified,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    return {"family": fam}


# =========================================================================
# Email template unit tests
# =========================================================================


class TestClaimConfirmationEmailTemplate:
    def test_email_includes_donor_name(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane Doe",
            family_display_id="1-3",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Jane Doe" in html

    def test_email_includes_family_wish(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="School supplies and winter gear",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "School supplies and winter gear" in html
        assert "Family wish:" in html

    def test_email_includes_family_display_id(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="2-5",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Family 2-5" in html

    def test_email_includes_bio_when_present(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio="We need warm clothes.",
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "We need warm clothes." in html

    def test_email_omits_bio_when_none(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        # Should not have a standalone empty <p> tag
        assert "<p></p>" not in html

    def test_email_includes_wishlist_for_children(self):
        from app.mail import build_claim_confirmation_email

        people = [
            {
                "given_name": "Alice",
                "age": 8,
                "wishes": [
                    {"type": "practical", "description": "A coat", "size": "Medium"},
                    {"type": "fun", "description": "A doll", "size": None},
                ],
            }
        ]
        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=people,
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Alice (age 8)" in html
        assert "A coat" in html
        assert "Medium" in html
        assert "A doll" in html
        assert "Practical Wish" in html
        assert "Fun Wish" in html

    def test_email_includes_wishlist_for_adults(self):
        from app.mail import build_claim_confirmation_email

        people = [
            {
                "given_name": "Bob",
                "age": 25,
                "wishes": [
                    {"type": "adult", "description": "Winter jacket", "size": "Large"},
                ],
            }
        ]
        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=people,
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Bob (age 25)" in html
        assert "Winter jacket" in html
        assert "Large" in html

    def test_email_handles_empty_people_list(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "No family members" in html

    def test_email_includes_cta_button(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://example.com/donor/claims/42",
        )
        assert "View Your Claim" in html
        assert "http://example.com/donor/claims/42" in html

    def test_email_includes_branding(self):
        from app.mail import build_claim_confirmation_email

        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=[],
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Kindness Is Magic" in html

    def test_email_includes_size_in_parens(self):
        """Wish sizes appear in parentheses next to the description."""
        from app.mail import build_claim_confirmation_email

        people = [
            {
                "given_name": "Child",
                "age": 6,
                "wishes": [
                    {"type": "practical", "description": "Shoes", "size": "Size 24"},
                    {"type": "fun", "description": "Lego set", "size": None},
                ],
            }
        ]
        html = build_claim_confirmation_email(
            donor_name="Jane",
            family_display_id="1-1",
            family_wish="Warm clothes",
            family_bio=None,
            people=people,
            claim_detail_url="http://localhost/donor/claims/1",
        )
        assert "Shoes (Size 24)" in html
        # Lego set should not have empty parens
        assert "Lego set ()" not in html


# =========================================================================
# Admin notification template tests
# =========================================================================


class TestAdminEmailFailureNotice:
    def test_includes_donor_email(self):
        from app.mail import build_admin_email_failure_notice

        html = build_admin_email_failure_notice(
            donor_email="donor@example.com",
            family_display_id="1-3",
            claim_id=42,
            error_summary="smtp_error",
        )
        assert "donor@example.com" in html

    def test_includes_family_display_id(self):
        from app.mail import build_admin_email_failure_notice

        html = build_admin_email_failure_notice(
            donor_email="donor@example.com",
            family_display_id="2-7",
            claim_id=99,
            error_summary="smtp_error",
        )
        assert "2-7" in html

    def test_includes_claim_id(self):
        from app.mail import build_admin_email_failure_notice

        html = build_admin_email_failure_notice(
            donor_email="donor@example.com",
            family_display_id="1-1",
            claim_id=123,
            error_summary="smtp_error",
        )
        assert "123" in html

    def test_includes_error_summary(self):
        from app.mail import build_admin_email_failure_notice

        html = build_admin_email_failure_notice(
            donor_email="donor@example.com",
            family_display_id="1-1",
            claim_id=1,
            error_summary="Connection refused",
        )
        assert "Connection refused" in html


# =========================================================================
# send_admin_notification helper tests
# =========================================================================


class TestSendAdminNotification:
    async def test_skips_when_no_admin_email(self, monkeypatch):
        from app import mail as mail_mod

        monkeypatch.setattr(mail_mod, "ADMIN_EMAIL", "")
        mock_db = MagicMock()

        from app.models import EmailKind

        result = await mail_mod.send_admin_notification("Test Subject", "<p>Body</p>", mock_db, kind=EmailKind.admin_failure_notice)
        assert result == {"sent": False, "reason": "no_admin_email"}

    async def test_sends_to_admin_email_when_configured(self, monkeypatch):
        from app import mail as mail_mod

        monkeypatch.setattr(mail_mod, "ADMIN_EMAIL", "admin@example.com")

        async def _fake_send(*args, **kwargs):
            return {"sent": True, "reason": None}

        from app.models import EmailKind

        mock_db = MagicMock()
        with patch.object(mail_mod, "send_email", new=_fake_send):
            result = await mail_mod.send_admin_notification("Test Subject", "<p>Body</p>", mock_db, kind=EmailKind.admin_failure_notice)

        assert result == {"sent": True, "reason": None}

    async def test_subject_prefixed_with_org_name(self, monkeypatch):
        from app import mail as mail_mod

        monkeypatch.setattr(mail_mod, "ADMIN_EMAIL", "admin@example.com")

        captured = {}

        async def _capture(to, subject, html_body, db, **kwargs):
            captured["to"] = to
            captured["subject"] = subject
            captured["html_body"] = html_body
            return {"sent": True, "reason": None}

        from app.models import EmailKind

        mock_db = MagicMock()
        with patch.object(mail_mod, "send_email", new=_capture):
            await mail_mod.send_admin_notification("Something Failed", "<p>Body</p>", mock_db, kind=EmailKind.admin_failure_notice)

        assert captured["subject"] == "[Kindness Is Magic] Something Failed"
        assert captured["to"] == "admin@example.com"


# =========================================================================
# Integration tests: claim creation triggers email
# =========================================================================


class TestClaimConfirmationEmailOnCreation:
    def test_gifts_claim_sends_confirmation_email(self, test_client: TestClient, db: Session):
        """Gifts claim → confirmation email is attempted, email_error absent."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append({"to": to, "subject": subject, "body": html_body})
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        body = resp.json()
        assert "email_error" not in body
        assert len(sent_emails) == 1
        assert sent_emails[0]["to"] == DONOR_EMAIL
        assert "Claim Confirmation" in sent_emails[0]["subject"]

    def test_cash_claim_does_not_send_email(self, test_client: TestClient, db: Session):
        """Cash claim → no email sent."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append({"to": to})
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "cash"},
            )

        assert resp.status_code == 201
        body = resp.json()
        assert "email_error" not in body
        assert len(sent_emails) == 0

    def test_smtp_failure_sets_email_error(self, test_client: TestClient, db: Session):
        """Gifts claim + SMTP failure → claim created, email_error set."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        async def _fail_send(to, subject, html_body, db=None, **kwargs):
            return {"sent": False, "reason": "smtp_error"}

        admin_notifications = []

        async def _capture_admin(subject, body_html, db=None, **kwargs):
            admin_notifications.append({"subject": subject, "body": body_html})
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_fail_send):
            with patch("app.families_routes.send_admin_notification", new=_capture_admin):
                resp = test_client.post(
                    f"/api/families/{fam.id}/claim",
                    json={"commitment_type": "gifts"},
                )

        # Claim is still created
        assert resp.status_code == 201
        body = resp.json()
        assert body["email_error"] is not None
        assert "email" in body["email_error"].lower() or "failed" in body["email_error"].lower()

        # Admin notification was attempted
        assert len(admin_notifications) == 1
        assert "Failed" in admin_notifications[0]["subject"]

    def test_unsubscribed_donor_no_error(self, test_client: TestClient, db: Session):
        """Unsubscribed donor → email suppressed, no error returned."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        async def _unsubscribed_send(to, subject, html_body, db=None, **kwargs):
            return {"sent": False, "reason": "unsubscribed"}

        with patch("app.families_routes.send_email", new=_unsubscribed_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        body = resp.json()
        assert "email_error" not in body

    def test_email_contains_wishlist_data(self, test_client: TestClient, db: Session):
        """Email body includes person names, ages, wish descriptions, and sizes."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append(html_body)
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        assert len(sent_emails) == 1
        html = sent_emails[0]
        assert "Alice" in html
        assert "age 8" in html
        assert "A coat" in html
        assert "Medium" in html
        assert "A doll" in html

    def test_email_contains_adult_wish_data(self, test_client: TestClient, db: Session):
        """Email body correctly renders adult wish (single column)."""
        _create_donor(test_client)
        data = _create_family_with_adult(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append(html_body)
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        assert len(sent_emails) == 1
        html = sent_emails[0]
        assert "Bob" in html
        assert "age 25" in html
        assert "Winter jacket" in html
        assert "Large" in html

    def test_empty_family_shows_graceful_message(self, test_client: TestClient, db: Session):
        """Family with no people shows 'No family members' message."""
        _create_donor(test_client)
        data = _create_empty_family(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append(html_body)
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        assert len(sent_emails) == 1
        assert "No family members" in sent_emails[0]

    def test_claim_detail_url_in_email(self, test_client: TestClient, db: Session):
        """Email includes the claim detail page URL in the CTA button."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        sent_emails = []

        async def _capture_send(to, subject, html_body, db=None, **kwargs):
            sent_emails.append(html_body)
            return {"sent": True, "reason": None}

        with patch("app.families_routes.send_email", new=_capture_send):
            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )

        assert resp.status_code == 201
        claim_id = resp.json()["id"]
        assert f"/donor/claims/{claim_id}" in sent_emails[0]

    def test_admin_notification_failure_does_not_cascade(self, test_client: TestClient, db: Session):
        """If both email and admin notification fail, claim still succeeds with email_error."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        async def _fail_send(to, subject, html_body, db=None, **kwargs):
            return {"sent": False, "reason": "smtp_error"}

        async def _fail_admin(subject, body_html, db=None, **kwargs):
            raise Exception("Admin SMTP also broken")

        with patch("app.families_routes.send_email", new=_fail_send):
            with patch("app.families_routes.send_admin_notification", new=_fail_admin):
                resp = test_client.post(
                    f"/api/families/{fam.id}/claim",
                    json={"commitment_type": "gifts"},
                )

        # Claim still succeeds
        assert resp.status_code == 201
        body = resp.json()
        assert body["email_error"] is not None
