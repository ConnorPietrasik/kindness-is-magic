"""Tests for donor claims: self-registration, claim CRUD, mark-purchased, fulfill."""

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

DONOR2_EMAIL = "donor2@test.com"
DONOR2_PASSWORD = "DonorPass1234!"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, ADMIN_EMAIL, ADMIN_PASSWORD)


def _donor_login(client: TestClient) -> dict:
    return login_as(client, DONOR_EMAIL, DONOR_PASSWORD)


def _create_donor(client: TestClient) -> dict:
    """Register a new donor and return the response body."""
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
    """Create an approved, admin-locked family with people and wishes."""
    from app.models import Family, FamilyApprovalStatus, Person, Wish, WishLockLevel, WishType

    fam = Family(
        family_name="Claimed Family",
        family_wish="Warm clothes",
        contact_name="Claim Contact",
        phone_number="555-000-0000",
        approval_status=FamilyApprovalStatus.approved,
        wish_lock_level=WishLockLevel.admin,
    )
    db.add(fam)
    db.flush()

    person = Person(
        family_id=fam.id,
        given_name="Child",
        age=8,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A coat")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A toy")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(fam)
    db.refresh(person)
    db.refresh(w1)
    db.refresh(w2)

    return {"family": fam, "person": person, "wishes": [w1, w2]}


# =========================================================================
# Donor Self-Registration
# =========================================================================


class TestDonorSelfRegister:
    def test_register_donor_valid(self, test_client: TestClient):
        """Register donor with valid data → 201, user created, cookies set."""
        resp = test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "New Donor",
                "email": "newdonor@test.com",
                "password": "StrongPass1!",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["user"]["role"] == "donor"
        assert body["user"]["email"] == "newdonor@test.com"
        assert body["user"]["display_name"] == "New Donor"

    def test_register_donor_duplicate_email(self, test_client: TestClient, admin_user):
        """Register donor with duplicate email → 409."""
        # admin_user already exists with admin@test.com
        resp = test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Duplicate",
                "email": "admin@test.com",
                "password": "StrongPass1!",
            },
        )
        assert resp.status_code == 409

    def test_register_donor_invalid_email(self, test_client: TestClient):
        """Register donor with invalid email → 422."""
        resp = test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Bad Email",
                "email": "not-an-email",
                "password": "StrongPass1!",
            },
        )
        assert resp.status_code == 422

    def test_register_donor_short_password(self, test_client: TestClient):
        """Register donor with short password → 422."""
        resp = test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Short Pass",
                "email": "short@test.com",
                "password": "Short1!",
            },
        )
        assert resp.status_code == 422

    def test_register_donor_auto_login(self, test_client: TestClient):
        """After registration, user can access /api/donor/me."""
        _create_donor(test_client)
        resp = test_client.get("/api/donor/me")
        assert resp.status_code == 200
        assert resp.json()["role"] == "donor"


# =========================================================================
# Claim Creation
# =========================================================================


class TestClaimCreation:
    def test_claim_family_gifts(self, test_client: TestClient, db: Session):
        """Claim family with gifts → 201, claim created."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["commitment_type"] == "gifts"
        assert body["fulfilled_at"] is None
        assert body["family"]["id"] == fam.id

    def test_claim_family_cash(self, test_client: TestClient, db: Session):
        """Claim family with cash → 201."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "cash"},
        )
        assert resp.status_code == 201
        assert resp.json()["commitment_type"] == "cash"

    def test_claim_already_claimed(self, test_client: TestClient, db: Session):
        """Claim already-claimed family → 409."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 201

        # Second claim attempt
        resp2 = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "cash"},
        )
        assert resp2.status_code == 409

    def test_claim_gift_cap_enforced(self, test_client: TestClient, db: Session):
        """Claim 6th family with gifts → 400 (cap at 5)."""
        _create_donor(test_client)

        for i in range(5):
            from app.models import Family, FamilyApprovalStatus, Person, Wish, WishLockLevel, WishType

            fam = Family(
                family_name=f"Cap Family {i}",
                family_wish="A wish",
                contact_name=f"Contact {i}",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
                wish_lock_level=WishLockLevel.admin,
            )
            db.add(fam)
            db.flush()

            person = Person(family_id=fam.id, given_name=f"Child {i}", age=5)
            db.add(person)
            db.flush()

            db.add(Wish(person_id=person.id, type=WishType.practical, description="A coat"))
            db.add(Wish(person_id=person.id, type=WishType.fun, description="A toy"))
            db.commit()
            db.refresh(fam)

            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )
            assert resp.status_code == 201, f"Claim {i + 1} should succeed"

        # 6th should fail
        fam6 = Family(
            family_name="Cap Family 6",
            family_wish="A wish",
            contact_name="Contact 6",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(fam6)
        db.flush()
        person6 = Person(family_id=fam6.id, given_name="Child 6", age=5)
        db.add(person6)
        db.flush()
        db.add(Wish(person_id=person6.id, type=WishType.practical, description="A coat"))
        db.add(Wish(person_id=person6.id, type=WishType.fun, description="A toy"))
        db.commit()
        db.refresh(fam6)

        resp = test_client.post(
            f"/api/families/{fam6.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 400
        assert "limit" in resp.json()["detail"].lower()

    def test_claim_cash_no_cap(self, test_client: TestClient, db: Session):
        """6th family with cash (no cap) → 201."""
        _create_donor(test_client)

        for i in range(6):
            from app.models import Family, FamilyApprovalStatus, Person, Wish, WishLockLevel, WishType

            fam = Family(
                family_name=f"Cash Family {i}",
                family_wish="A wish",
                contact_name=f"Contact {i}",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
                wish_lock_level=WishLockLevel.admin,
            )
            db.add(fam)
            db.flush()
            person = Person(family_id=fam.id, given_name=f"Child {i}", age=5)
            db.add(person)
            db.flush()
            db.add(Wish(person_id=person.id, type=WishType.practical, description="A coat"))
            db.add(Wish(person_id=person.id, type=WishType.fun, description="A toy"))
            db.commit()
            db.refresh(fam)

            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "cash"},
            )
            assert resp.status_code == 201, f"Cash claim {i + 1} should succeed"

    def test_claim_non_claim_capable_role(self, test_client: TestClient, family_user, db: Session):
        """Family role attempts claim → 403."""
        login_as(test_client, "family@test.com", "FamPass1234!")
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 403

    def test_claim_unauthenticated(self, test_client: TestClient, db: Session):
        """Unauthenticated claim attempt → 401."""
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 401

    def test_claim_deleted_family(self, test_client: TestClient, db: Session):
        """Claim soft-deleted family → 404."""
        _create_donor(test_client)
        from app.models import Family, FamilyApprovalStatus, WishLockLevel
        from datetime import datetime, timezone

        fam = Family(
            family_name="Deleted Family",
            family_wish="A wish",
            contact_name="Deleted Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
            wish_lock_level=WishLockLevel.admin,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 404

    def test_claim_not_fully_approved_family(self, test_client: TestClient, db: Session):
        """Claim a family that hasn't been fully reviewed → 403."""
        _create_donor(test_client)
        from app.models import Family, FamilyApprovalStatus, WishLockLevel

        fam = Family(
            family_name="Unapproved Family",
            family_wish="A wish",
            contact_name="Pending Contact",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
            wish_lock_level=WishLockLevel.family,
        )
        db.add(fam)
        db.commit()
        db.refresh(fam)

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "This family hasn't been fully approved yet."


# =========================================================================
# Claim CRUD
# =========================================================================


class TestClaimCRUD:
    def test_list_own_claims(self, test_client: TestClient, db: Session):
        """List own claims → returns only own claims."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )

        resp = test_client.get("/api/donor/claims")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["commitment_type"] == "gifts"

    def test_list_claims_status_filter(self, test_client: TestClient, db: Session):
        """List claims with status filter → filters correctly."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )

        resp = test_client.get("/api/donor/claims?fulfilled=false")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        resp = test_client.get("/api/donor/claims?fulfilled=true")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_get_claim_detail(self, test_client: TestClient, db: Session):
        """Get claim detail → returns wish list."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.get(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == claim_id
        assert len(body["people"]) == 1
        assert body["people"][0]["given_name"] == "Child"
        assert len(body["people"][0]["wishes"]) == 2

    def test_get_another_user_claim(self, test_client: TestClient, db: Session):
        """View another user's claim → 403."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Log in as another donor
        test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Donor 2",
                "email": DONOR2_EMAIL,
                "password": DONOR2_PASSWORD,
            },
        )
        login_as(test_client, DONOR2_EMAIL, DONOR2_PASSWORD)

        resp = test_client.get(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 403

    def test_admin_can_view_other_claims(self, test_client: TestClient, db: Session, admin_user):
        """Admin can view another user's claim → 200."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Admin logs in and views
        _admin_login(test_client)
        resp = test_client.get(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == claim_id

    def test_update_own_claim_notes(self, test_client: TestClient, db: Session):
        """Update own claim notes → 200."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.patch(
            f"/api/donor/claims/{claim_id}",
            json={"notes": "Updated notes"},
        )
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Updated notes"

    def test_update_own_claim_commitment_type(self, test_client: TestClient, db: Session):
        """Update own claim commitment_type → 200."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.patch(
            f"/api/donor/claims/{claim_id}",
            json={"commitment_type": "cash"},
        )
        assert resp.status_code == 200
        assert resp.json()["commitment_type"] == "cash"

    def test_update_another_user_claim(self, test_client: TestClient, db: Session):
        """Update another user's claim → 403."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Log in as another donor
        test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Donor 2",
                "email": DONOR2_EMAIL,
                "password": DONOR2_PASSWORD,
            },
        )
        login_as(test_client, DONOR2_EMAIL, DONOR2_PASSWORD)

        resp = test_client.patch(
            f"/api/donor/claims/{claim_id}",
            json={"notes": "Hacked"},
        )
        assert resp.status_code == 403

    def test_cancel_own_claim(self, test_client: TestClient, db: Session):
        """Cancel own claim (soft-delete) → 204, family becomes unclaimed."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.delete(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 204

        # Claim no longer appears in active list
        resp = test_client.get("/api/donor/claims")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

        # Family is now unclaimable again
        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 201

    def test_cancelled_claim_frees_gift_cap(self, test_client: TestClient, db: Session):
        """Cancelled claim frees up gift cap slot."""
        _create_donor(test_client)

        # Create 5 gift claims
        claim_ids = []
        for i in range(5):
            from app.models import Family, FamilyApprovalStatus, Person, Wish, WishLockLevel, WishType

            fam = Family(
                family_name=f"Cap Test {i}",
                family_wish="A wish",
                contact_name=f"Contact {i}",
                phone_number="555-000-0000",
                approval_status=FamilyApprovalStatus.approved,
                wish_lock_level=WishLockLevel.admin,
            )
            db.add(fam)
            db.flush()
            person = Person(family_id=fam.id, given_name=f"Child {i}", age=5)
            db.add(person)
            db.flush()
            db.add(Wish(person_id=person.id, type=WishType.practical, description="A coat"))
            db.add(Wish(person_id=person.id, type=WishType.fun, description="A toy"))
            db.commit()
            db.refresh(fam)

            resp = test_client.post(
                f"/api/families/{fam.id}/claim",
                json={"commitment_type": "gifts"},
            )
            assert resp.status_code == 201
            claim_ids.append(resp.json()["id"])

        # Cancel first claim
        test_client.delete(f"/api/donor/claims/{claim_ids[0]}")
        assert test_client.get(f"/api/donor/claims/{claim_ids[0]}").status_code == 404

        # Now can claim a 6th family with gifts
        fam6 = Family(
            family_name="Cap Test 6",
            family_wish="A wish",
            contact_name="Contact 6",
            phone_number="555-000-0000",
            approval_status=FamilyApprovalStatus.approved,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(fam6)
        db.flush()
        person6 = Person(family_id=fam6.id, given_name="Child 6", age=5)
        db.add(person6)
        db.flush()
        db.add(Wish(person_id=person6.id, type=WishType.practical, description="A coat"))
        db.add(Wish(person_id=person6.id, type=WishType.fun, description="A toy"))
        db.commit()
        db.refresh(fam6)

        resp = test_client.post(
            f"/api/families/{fam6.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 201


# =========================================================================
# Mark Purchased
# =========================================================================


class TestMarkPurchased:
    def test_mark_wish_purchased(self, test_client: TestClient, db: Session):
        """Mark wish purchased on own claim → sets purchased_at, etc."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]
        wish = data["wishes"][0]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.post(
            f"/api/donor/claims/{claim_id}/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target", "purchaser_note": "Got it!"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["purchased_at"] is not None
        assert body["purchased_where"] == "Target"
        assert body["purchaser_note"] == "Got it!"
        assert body["assigned_to_id"] is not None

    def test_mark_purchased_no_received_at(self, test_client: TestClient, db: Session):
        """Mark wish purchased does NOT set received_at."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]
        wish = data["wishes"][0]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.post(
            f"/api/donor/claims/{claim_id}/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200

        # Verify received_at is not set
        db.refresh(wish)
        assert wish.received_at is None

    def test_mark_purchased_another_user_claim(self, test_client: TestClient, db: Session):
        """Mark wish purchased on another user's claim → 403."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]
        wish = data["wishes"][0]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Log in as another donor
        test_client.post(
            "/api/auth/register-donor",
            json={
                "display_name": "Donor 2",
                "email": DONOR2_EMAIL,
                "password": DONOR2_PASSWORD,
            },
        )
        login_as(test_client, DONOR2_EMAIL, DONOR2_PASSWORD)

        resp = test_client.post(
            f"/api/donor/claims/{claim_id}/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 403

    def test_mark_purchased_wish_not_in_claim(self, test_client: TestClient, db: Session):
        """Mark wish not belonging to claimed family → 400."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        # Create another family with wishes
        from app.models import Family, FamilyApprovalStatus, Person, Wish, WishLockLevel, WishType

        other_fam = Family(
            family_name="Other Family",
            family_wish="A wish",
            contact_name="Other Contact",
            phone_number="555-000-0001",
            approval_status=FamilyApprovalStatus.approved,
            wish_lock_level=WishLockLevel.admin,
        )
        db.add(other_fam)
        db.flush()
        other_person = Person(family_id=other_fam.id, given_name="Other Child", age=5)
        db.add(other_person)
        db.flush()
        other_wish = Wish(person_id=other_person.id, type=WishType.practical, description="A coat")
        db.add(other_wish)
        db.commit()
        db.refresh(other_wish)

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.post(
            f"/api/donor/claims/{claim_id}/wishes/{other_wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 400


# =========================================================================
# Fulfill (Admin Only)
# =========================================================================


class TestFulfill:
    def test_admin_fulfill_claim(self, test_client: TestClient, db: Session, admin_user):
        """Admin fulfills claim → status=fulfilled, fulfilled_at set."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Admin fulfills
        _admin_login(test_client)
        resp = test_client.post(f"/api/donor/claims/{claim_id}/fulfill")
        assert resp.status_code == 200
        body = resp.json()
        assert body["fulfilled_at"] is not None

    def test_non_admin_fulfill(self, test_client: TestClient, db: Session):
        """Non-admin attempts fulfill → 403."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.post(f"/api/donor/claims/{claim_id}/fulfill")
        assert resp.status_code == 403

    def test_non_admin_patch_status_ignored(self, test_client: TestClient, db: Session):
        """Non-admin PATCH with status → status field not in schema, ignored (200)."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # FamilyClaimUpdate doesn't have a status field — Pydantic ignores extra fields
        resp = test_client.patch(
            f"/api/donor/claims/{claim_id}",
            json={"status": "fulfilled"},
        )
        assert resp.status_code == 200
        # fulfilled_at should still be None (not changed)
        assert resp.json()["fulfilled_at"] is None


# =========================================================================
# Public Families Claimed Flag
# =========================================================================


class TestPublicFamiliesClaimedFlag:
    def test_browse_as_donor_claimed_true(self, test_client: TestClient, db: Session):
        """Browse families as donor → claimed_by_current_user is true for own claims."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )

        resp = test_client.get("/api/families")
        assert resp.status_code == 200
        families = resp.json()["families"]
        claimed = [f for f in families if f["id"] == fam.id]
        assert len(claimed) == 1
        assert claimed[0]["claimed_by_current_user"] is True

    def test_browse_unauthenticated_claimed_false(self, test_client: TestClient, db: Session):
        """Browse families unauthenticated → claimed_by_current_user is false for all."""
        _create_claimed_family(db)

        resp = test_client.get("/api/families")
        assert resp.status_code == 200
        families = resp.json()["families"]
        for f in families:
            assert f["claimed_by_current_user"] is False

    def test_wish_list_returns_claim_info(self, test_client: TestClient, db: Session):
        """Wish-list endpoint returns claim_id and claim_status for claimed families."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        resp = test_client.get(f"/api/families/{fam.id}/wish-list")
        assert resp.status_code == 200
        body = resp.json()
        assert body["claimed_by_current_user"] is True
        assert body["claim_status"] == "active"
        assert body["claim_id"] == claim_id

    def test_wish_list_unauthenticated_no_claim(self, test_client: TestClient, db: Session):
        """Wish-list unauthenticated → no claim info (all false/null)."""
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.get(f"/api/families/{fam.id}/wish-list")
        assert resp.status_code == 200
        body = resp.json()
        assert body["claimed_by_current_user"] is False
        assert body["claim_status"] is None
        assert body["claim_id"] is None


# =========================================================================
# Multi-Role Claims (admin, purchaser, referrer can also claim)
# =========================================================================


class TestMultiRoleClaims:
    def test_admin_can_claim(self, test_client: TestClient, db: Session, admin_user):
        """Admin can claim a family."""
        _admin_login(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        assert resp.status_code == 201

    def test_admin_can_update_other_claims(self, test_client: TestClient, db: Session, admin_user):
        """Admin can update another user's claim."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Admin logs in and updates
        _admin_login(test_client)
        resp = test_client.patch(
            f"/api/donor/claims/{claim_id}",
            json={"notes": "Admin updated"},
        )
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Admin updated"

    def test_admin_can_cancel_other_claims(self, test_client: TestClient, db: Session, admin_user):
        """Admin can cancel another user's claim."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Admin logs in and cancels
        _admin_login(test_client)
        resp = test_client.delete(f"/api/donor/claims/{claim_id}")
        assert resp.status_code == 204

    def test_admin_can_mark_purchased_on_other_claims(self, test_client: TestClient, db: Session, admin_user):
        """Admin can mark wish purchased on another user's claim."""
        _create_donor(test_client)
        data = _create_claimed_family(db)
        fam = data["family"]
        wish = data["wishes"][0]

        resp = test_client.post(
            f"/api/families/{fam.id}/claim",
            json={"commitment_type": "gifts"},
        )
        claim_id = resp.json()["id"]

        # Admin logs in and marks purchased
        _admin_login(test_client)
        resp = test_client.post(
            f"/api/donor/claims/{claim_id}/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Admin purchase"},
        )
        assert resp.status_code == 200
