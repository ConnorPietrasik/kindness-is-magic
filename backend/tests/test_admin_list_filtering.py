"""Tests for admin list endpoint filtering, searching, and sorting.

Covers the new query params added across all admin list endpoints:
- search, approval_status (referrers), verification_status (families), wish_lock_level, wish_type, sort
- deleted endpoints sort by deleted_at DESC
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as, make_family

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _make_referrers(db: Session, names: list[str], statuses: list[str] | None = None):
    """Create multiple referrers with given names and optional statuses."""
    from app.models import Referrer, ReferrerApprovalStatus

    referrers = []
    for i, name in enumerate(names):
        r = Referrer(
            name=name,
            family_limit=10,
            phone_number=f"555-000-{i:04d}",
            family_invite_code=f"KFI-R{i:04d}",
            approval_status=statuses[i] if statuses else ReferrerApprovalStatus.approved,
        )
        db.add(r)
        referrers.append(r)
    db.commit()
    return [db.refresh(r) or r for r in referrers]


def _make_families(db: Session, names: list[str], statuses: list[str] | None = None, lock_levels: list[str] | None = None):
    """Create multiple families with given names and optional statuses."""
    from app.models import FamilyVerificationStatus, WishLockLevel

    families = []
    for i, name in enumerate(names):
        f = make_family(
            db,
            family_name=name,
            family_wish="A wish",
            contact_name=f"Contact {i}",
            phone_number=f"555-111-{i:04d}",
            verification_status=statuses[i] if statuses else FamilyVerificationStatus.verified,
            wish_lock_level=lock_levels[i] if lock_levels else WishLockLevel.family,
        )
        db.add(f)
        families.append(f)
    db.commit()
    return [db.refresh(f) or f for f in families]


def _make_users(db: Session, emails: list[str], display_names: list[str], roles: list[str] | None = None):
    """Create multiple users."""
    from app.auth import get_password_hash
    from app.models import User, UserRole

    users = []
    for i, email in enumerate(emails):
        u = User(
            email=email,
            hashed_password=get_password_hash("TestPass123!"),
            role=roles[i] if roles else UserRole.purchaser,
            display_name=display_names[i],
        )
        db.add(u)
        users.append(u)
    db.commit()
    return [db.refresh(u) or u for u in users]


# =========================================================================
# Referrers — search, approval_status, sort
# =========================================================================


class TestReferrersSearch:
    def test_search_by_name(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Alpha Org", "Beta Org", "Gamma Org"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"search": "Beta"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["referrers"][0]["name"] == "Beta Org"

    def test_search_case_insensitive(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Alpha Org", "Beta Org"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"search": "beta"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_no_match(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Alpha Org"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"search": "zzzzz"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


class TestReferrersApprovalStatus:
    def test_filter_approved_only(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["A", "B", "C"], ["approved", "pending", "approved"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"approval_status": "approved"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2

    def test_filter_pending_only(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["A", "B", "C"], ["approved", "pending", "rejected"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"approval_status": "pending"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_filter_rejected_only(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["A", "B"], ["approved", "rejected"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"approval_status": "rejected"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestReferrersSort:
    def test_sort_name_asc(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Charlie", "Alice", "Bob"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"sort": "name"})
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()["referrers"]]
        assert names == ["Alice", "Bob", "Charlie"]

    def test_sort_name_desc(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Charlie", "Alice", "Bob"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"sort": "-name"})
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()["referrers"]]
        assert names == ["Charlie", "Bob", "Alice"]

    def test_sort_created_at_desc(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Referrer, ReferrerApprovalStatus

        # Create referrers with explicit timestamps to avoid same-second collision
        now = datetime.now(timezone.utc)
        for i, name in enumerate(["First", "Second", "Third"]):
            r = Referrer(
                name=name,
                family_limit=10,
                phone_number=f"555-000-{i:04d}",
                family_invite_code=f"KFI-R{i:04d}",
                approval_status=ReferrerApprovalStatus.approved,
                created_at=now + timedelta(seconds=i),
            )
            db.add(r)
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"sort": "-created_at"})
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()["referrers"]]
        # Most recently created first
        assert names == ["Third", "Second", "First"]

    def test_sort_invalid_field_uses_default(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["A", "B"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"sort": "nonexistent_field"})
        assert resp.status_code == 200
        # Should still work (falls back to default id ASC)
        assert resp.json()["total"] == 2


# =========================================================================
# Families — search, verification_status, wish_lock_level, sort
# =========================================================================


class TestFamiliesSearch:
    def test_search_name(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Smith Family", "Jones Family", "Brown Family"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"search_name": "Jones"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["families"][0]["family_name"] == "Jones Family"

    def test_search_contact(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Smith Family", "Jones Family"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"search_contact": "Contact 1"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_phone(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Smith Family", "Jones Family"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"search_phone": "111-0001"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_by_wish(self, test_client: TestClient, admin_user, db: Session):
        from app.models import FamilyVerificationStatus, WishLockLevel

        f1 = make_family(
            db,
            family_name="Alpha",
            family_wish="Bicycle for the kids",
            contact_name="C1",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.family,
        )
        f2 = make_family(
            db,
            family_name="Beta",
            family_wish="Winter coats please",
            contact_name="C2",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.family,
        )
        db.add_all([f1, f2])
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"search_wish": "Bicycle"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["families"][0]["family_name"] == "Alpha"

    def test_search_all_fields(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Family
        from app.response_builders import attach_family_wish

        _make_families(db, ["Smith Family", "Jones Family"])
        # Also set distinct family wish values (on the wish rows)
        for f in db.query(Family).all():
            if f.family_name == "Smith Family":
                attach_family_wish(db, f, "Toys and games")
            else:
                attach_family_wish(db, f, "School supplies")
        db.commit()
        _admin_login(test_client)

        # search across name
        resp = test_client.get("/api/admin/families", params={"search": "Jones"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across contact
        resp = test_client.get("/api/admin/families", params={"search": "Contact 1"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across phone
        resp = test_client.get("/api/admin/families", params={"search": "111-0001"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across wish
        resp = test_client.get("/api/admin/families", params={"search": "Toys"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_targeted_filters_combine_with_and(self, test_client: TestClient, admin_user, db: Session):
        from app.models import FamilyVerificationStatus, WishLockLevel

        f1 = make_family(
            db,
            family_name="Smith Family",
            family_wish="Bicycle",
            contact_name="John Smith",
            phone_number="555-000-0001",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.family,
        )
        f2 = make_family(
            db,
            family_name="Smith Family",
            family_wish="Coats",
            contact_name="Jane Doe",
            phone_number="555-000-0002",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.family,
        )
        f3 = make_family(
            db,
            family_name="Jones Family",
            family_wish="Bicycle",
            contact_name="Bob Jones",
            phone_number="555-000-0003",
            verification_status=FamilyVerificationStatus.verified,
            wish_lock_level=WishLockLevel.family,
        )
        db.add_all([f1, f2, f3])
        db.commit()
        _admin_login(test_client)

        # search_name="Smith" + search_wish="Bicycle" → only f1
        resp = test_client.get(
            "/api/admin/families",
            params={"search_name": "Smith", "search_wish": "Bicycle"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["families"][0]["contact_name"] == "John Smith"


class TestFamiliesVerificationStatus:
    def test_filter_verified(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["A", "B", "C"], ["verified", "pending", "verified"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"verification_status": "verified"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 2

    def test_filter_pending(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["A", "B"], ["verified", "pending"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"verification_status": "pending"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestFamiliesWishLockLevel:
    def test_filter_family_lock(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["A", "B", "C"], lock_levels=["family", "referrer", "admin"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"wish_lock_level": "family"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_filter_referrer_lock(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["A", "B", "C"], lock_levels=["family", "referrer", "admin"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"wish_lock_level": "referrer"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_filter_admin_lock(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["A", "B", "C"], lock_levels=["family", "referrer", "admin"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"wish_lock_level": "admin"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestFamiliesSort:
    def test_sort_family_name_asc(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Charlie", "Alice", "Bob"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"sort": "family_name"})
        assert resp.status_code == 200
        names = [f["family_name"] for f in resp.json()["families"]]
        assert names == ["Alice", "Bob", "Charlie"]

    def test_sort_family_name_desc(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Charlie", "Alice", "Bob"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"sort": "-family_name"})
        assert resp.status_code == 200
        names = [f["family_name"] for f in resp.json()["families"]]
        assert names == ["Charlie", "Bob", "Alice"]


# =========================================================================
# People — search, sort
# =========================================================================


class TestPeopleSearch:
    def test_search_name(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        for name in ["Alice", "Bob", "Charlie"]:
            db.add(Person(family_id=family_record.id, given_name=name, age=10, role=PersonRole.son))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"search_name": "Bob"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["people"][0]["given_name"] == "Bob"

    def test_search_role(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        db.add(Person(family_id=family_record.id, given_name="Alice", age=10, role=PersonRole.son))
        db.add(Person(family_id=family_record.id, given_name="Bob", age=10, role=PersonRole.mother))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"search_role": "Son"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_note(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        db.add(Person(family_id=family_record.id, given_name="Alice", age=10, note="Allergic to peanuts", role=PersonRole.son))
        db.add(Person(family_id=family_record.id, given_name="Bob", age=10, note="", role=PersonRole.son))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"search_note": "peanuts"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_by_wish(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole, Wish, WishType

        p1 = Person(family_id=family_record.id, given_name="Alice", age=10, role=PersonRole.son)
        db.add(p1)
        db.flush()
        db.add(Wish(person_id=p1.id, type=WishType.practical, description="Warm jacket size M"))
        db.add(Wish(person_id=p1.id, type=WishType.fun, description="Lego set"))

        p2 = Person(family_id=family_record.id, given_name="Bob", age=10, role=PersonRole.son)
        db.add(p2)
        db.flush()
        db.add(Wish(person_id=p2.id, type=WishType.practical, description="Backpack"))
        db.add(Wish(person_id=p2.id, type=WishType.fun, description="Art supplies"))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"search_wish": "Lego"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["people"][0]["given_name"] == "Alice"

    def test_search_all_fields(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole, Wish, WishType

        p1 = Person(family_id=family_record.id, given_name="Alice", age=10, role=PersonRole.daughter, note="Tall kid")
        db.add(p1)
        db.flush()
        db.add(Wish(person_id=p1.id, type=WishType.practical, description="Science kit"))
        db.add(Wish(person_id=p1.id, type=WishType.fun, description="Board game"))

        p2 = Person(family_id=family_record.id, given_name="Bob", age=10, role=PersonRole.son, note="Quiet")
        db.add(p2)
        db.flush()
        db.add(Wish(person_id=p2.id, type=WishType.practical, description="Jacket"))
        db.commit()
        _admin_login(test_client)

        # search across name
        resp = test_client.get("/api/admin/people", params={"search": "Alice"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across role
        resp = test_client.get("/api/admin/people", params={"search": "Daughter"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across note
        resp = test_client.get("/api/admin/people", params={"search": "Tall"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

        # search across wish description
        resp = test_client.get("/api/admin/people", params={"search": "Science"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_targeted_filters_combine_with_and(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole, Wish, WishType

        # Alice: role="Daughter", wish="Lego"
        p1 = Person(family_id=family_record.id, given_name="Alice", age=10, role=PersonRole.daughter)
        db.add(p1)
        db.flush()
        db.add(Wish(person_id=p1.id, type=WishType.fun, description="Lego set"))

        # Bob: role="Daughter", wish="Art"
        p2 = Person(family_id=family_record.id, given_name="Bob", age=10, role=PersonRole.daughter)
        db.add(p2)
        db.flush()
        db.add(Wish(person_id=p2.id, type=WishType.fun, description="Art supplies"))

        # Charlie: role="Son", wish="Lego"
        p3 = Person(family_id=family_record.id, given_name="Charlie", age=10, role=PersonRole.son)
        db.add(p3)
        db.flush()
        db.add(Wish(person_id=p3.id, type=WishType.fun, description="Lego truck"))
        db.commit()
        _admin_login(test_client)

        # search_role="Daughter" + search_wish="Lego" → only Alice
        resp = test_client.get(
            "/api/admin/people",
            params={"search_role": "Daughter", "search_wish": "Lego"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["people"][0]["given_name"] == "Alice"


class TestPeopleSort:
    def test_sort_given_name_asc(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        for name in ["Charlie", "Alice", "Bob"]:
            db.add(Person(family_id=family_record.id, given_name=name, age=10, role=PersonRole.son))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"sort": "given_name"})
        assert resp.status_code == 200
        names = [p["given_name"] for p in resp.json()["people"]]
        assert names == ["Alice", "Bob", "Charlie"]

    def test_sort_age_desc(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        db.add(Person(family_id=family_record.id, given_name="A", age=5, role=PersonRole.son))
        db.add(Person(family_id=family_record.id, given_name="B", age=15, role=PersonRole.son))
        db.add(Person(family_id=family_record.id, given_name="C", age=10, role=PersonRole.son))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people", params={"sort": "-age"})
        assert resp.status_code == 200
        ages = [p["age"] for p in resp.json()["people"]]
        assert ages == [15, 10, 5]


# =========================================================================
# Users — sort
# =========================================================================


class TestUsersSort:
    def test_sort_display_name_asc(self, test_client: TestClient, admin_user, db: Session):
        _make_users(db, ["a@test.com", "b@test.com", "c@test.com"], ["Charlie", "Alice", "Bob"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/users", params={"sort": "display_name"})
        assert resp.status_code == 200
        names = [u["display_name"] for u in resp.json()["users"]]
        # Filter out admin user from conftest fixture
        non_admin = [n for n in names if n not in ("admin@test.com",)]
        # Should include Alice, Bob, Charlie in order
        assert "Alice" in non_admin
        assert non_admin.index("Alice") < non_admin.index("Bob") < non_admin.index("Charlie")

    def test_sort_email_desc(self, test_client: TestClient, admin_user, db: Session):
        _make_users(db, ["a@test.com", "b@test.com", "c@test.com"], ["A", "B", "C"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/users", params={"sort": "-email"})
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()["users"]]
        # All emails should be present
        assert "c@test.com" in emails
        assert "a@test.com" in emails

    def test_sort_role_asc(self, test_client: TestClient, admin_user, db: Session):
        _make_users(
            db,
            ["a@test.com", "b@test.com", "c@test.com"],
            ["A", "B", "C"],
            ["delivery", "admin", "purchaser"],
        )
        _admin_login(test_client)

        resp = test_client.get("/api/admin/users", params={"sort": "role"})
        assert resp.status_code == 200
        assert resp.json()["total"] >= 3


# =========================================================================
# Wishes — wish_type filter, sort
# =========================================================================


class TestWishesWishType:
    def test_filter_adult(self, test_client: TestClient, admin_user, family_with_people, db: Session):
        from app.models import Person, PersonRole, Wish, WishType

        # Create an adult person with an adult wish
        adult = Person(family_id=family_with_people["family"].id, given_name="Adult", age=25, role=PersonRole.son)
        db.add(adult)
        db.flush()
        db.add(Wish(person_id=adult.id, type=WishType.adult, description="Laptop"))
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/wishes", params={"wish_type": "adult"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["wishes"][0]["type"] == "adult"

    def test_filter_practical(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)

        resp = test_client.get("/api/admin/wishes", params={"wish_type": "practical"})
        assert resp.status_code == 200
        body = resp.json()
        # family_with_people has 2 children, each with 1 practical wish
        assert body["total"] == 2
        assert all(w["type"] == "practical" for w in body["wishes"])

    def test_filter_fun(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)

        resp = test_client.get("/api/admin/wishes", params={"wish_type": "fun"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert all(w["type"] == "fun" for w in body["wishes"])


class TestWishesSort:
    def test_sort_description_asc(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)

        # Filter to a specific person to get predictable results
        person_id = family_with_people["people"][0].id
        resp = test_client.get("/api/admin/wishes", params={"sort": "description", "person_id": person_id})
        assert resp.status_code == 200
        descs = [w["description"] for w in resp.json()["wishes"]]
        assert descs == sorted(descs)

    def test_sort_type_asc(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)

        # Filter to a specific person for predictable results
        person_id = family_with_people["people"][0].id
        resp = test_client.get("/api/admin/wishes", params={"sort": "type", "person_id": person_id})
        assert resp.status_code == 200
        types = [w["type"] for w in resp.json()["wishes"]]
        # PostgreSQL sorts enums by their DB definition order: adult < practical < fun
        assert types == ["practical", "fun"]

    def test_sort_id_desc(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)

        resp = test_client.get("/api/admin/wishes", params={"sort": "-id"})
        assert resp.status_code == 200
        ids = [w["id"] for w in resp.json()["wishes"]]
        assert ids == sorted(ids, reverse=True)


# =========================================================================
# Invites — search, sort
# =========================================================================


class TestInvitesSearch:
    def test_search_by_code(self, test_client: TestClient, admin_user, db: Session):
        from app.models import ReferrerInviteToken

        now = datetime.now(timezone.utc)
        t1 = ReferrerInviteToken(
            code="KRI-ABC123",
            family_limit=10,
            expires_at=now + timedelta(days=30),
            created_by_admin_id=admin_user.id,
        )
        t2 = ReferrerInviteToken(
            code="KRI-XYZ987",
            family_limit=5,
            expires_at=now + timedelta(days=30),
            created_by_admin_id=admin_user.id,
        )
        db.add_all([t1, t2])
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/invites", params={"search": "ABC"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["invites"][0]["code"] == "KRI-ABC123"

    def test_search_by_locked_email(self, test_client: TestClient, admin_user, db: Session):
        from app.models import ReferrerInviteToken

        now = datetime.now(timezone.utc)
        t1 = ReferrerInviteToken(
            code="KRI-LK0001",
            family_limit=10,
            locked_email="test@example.com",
            expires_at=now + timedelta(days=30),
            created_by_admin_id=admin_user.id,
        )
        t2 = ReferrerInviteToken(
            code="KRI-LK0002",
            family_limit=5,
            locked_email="other@example.com",
            expires_at=now + timedelta(days=30),
            created_by_admin_id=admin_user.id,
        )
        db.add_all([t1, t2])
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/invites", params={"search": "test@"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestInvitesSort:
    def test_sort_code_asc(self, test_client: TestClient, admin_user, db: Session):
        from app.models import ReferrerInviteToken

        now = datetime.now(timezone.utc)
        for code in ["KRI-ZZZ000", "KRI-AAA000", "KRI-MMM000"]:
            db.add(
                ReferrerInviteToken(
                    code=code,
                    family_limit=10,
                    expires_at=now + timedelta(days=30),
                    created_by_admin_id=admin_user.id,
                )
            )
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/invites", params={"sort": "code"})
        assert resp.status_code == 200
        codes = [i["code"] for i in resp.json()["invites"]]
        assert codes == sorted(codes)

    def test_sort_created_at_desc(self, test_client: TestClient, admin_user, db: Session):
        from app.models import ReferrerInviteToken

        now = datetime.now(timezone.utc)
        for i, code in enumerate(["KRI-FIRST0", "KRI-SECO00", "KRI-THIRD0"]):
            db.add(
                ReferrerInviteToken(
                    code=code,
                    family_limit=10,
                    expires_at=now + timedelta(days=30),
                    created_by_admin_id=admin_user.id,
                    created_at=now + timedelta(seconds=i),
                )
            )
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/invites", params={"sort": "-created_at"})
        assert resp.status_code == 200
        codes = [i["code"] for i in resp.json()["invites"]]
        assert codes == ["KRI-THIRD0", "KRI-SECO00", "KRI-FIRST0"]


# =========================================================================
# Deleted endpoints — sort by deleted_at DESC
# =========================================================================


class TestDeletedReferrersSort:
    def test_deleted_sorted_by_deleted_at_desc(self, test_client: TestClient, admin_user, db: Session):
        from app.models import Referrer

        r1 = Referrer(name="First", family_limit=10, phone_number="555", family_invite_code="KFI-DEL001")
        r2 = Referrer(name="Second", family_limit=10, phone_number="555", family_invite_code="KFI-DEL002")
        db.add_all([r1, r2])
        db.commit()

        # Delete r2 first, then r1 (so r1 has later deleted_at)
        now1 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        now2 = datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc)
        r2.deleted_at = now1
        r1.deleted_at = now2
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers/deleted")
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()["referrers"]]
        # r1 (deleted later) should come first
        assert names == ["First", "Second"]


class TestDeletedFamiliesSort:
    def test_deleted_sorted_by_deleted_at_desc(self, test_client: TestClient, admin_user, db: Session):
        from app.models import FamilyVerificationStatus

        f1 = make_family(db, family_name="First", family_wish="W", contact_name="C", verification_status=FamilyVerificationStatus.verified)
        f2 = make_family(db, family_name="Second", family_wish="W", contact_name="C", verification_status=FamilyVerificationStatus.verified)
        db.add_all([f1, f2])
        db.commit()

        now1 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        now2 = datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc)
        f2.deleted_at = now1
        f1.deleted_at = now2
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families/deleted")
        assert resp.status_code == 200
        names = [f["family_name"] for f in resp.json()["families"]]
        assert names == ["First", "Second"]


class TestDeletedPeopleSort:
    def test_deleted_sorted_by_deleted_at_desc(self, test_client: TestClient, admin_user, family_record, db: Session):
        from app.models import Person, PersonRole

        p1 = Person(family_id=family_record.id, given_name="First", age=10, role=PersonRole.son)
        p2 = Person(family_id=family_record.id, given_name="Second", age=10, role=PersonRole.son)
        db.add_all([p1, p2])
        db.commit()

        now1 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        now2 = datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc)
        p2.deleted_at = now1
        p1.deleted_at = now2
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/people/deleted")
        assert resp.status_code == 200
        names = [p["given_name"] for p in resp.json()["people"]]
        assert names == ["First", "Second"]


class TestDeletedUsersSort:
    def test_deleted_sorted_by_deleted_at_desc(self, test_client: TestClient, admin_user, db: Session):
        from app.auth import get_password_hash
        from app.models import User, UserRole

        u1 = User(email="first@test.com", hashed_password=get_password_hash("Pass123!"), role=UserRole.purchaser, display_name="First")
        u2 = User(email="second@test.com", hashed_password=get_password_hash("Pass123!"), role=UserRole.purchaser, display_name="Second")
        db.add_all([u1, u2])
        db.commit()

        now1 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        now2 = datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc)
        u2.deleted_at = now1
        u1.deleted_at = now2
        db.commit()
        _admin_login(test_client)

        resp = test_client.get("/api/admin/users/deleted")
        assert resp.status_code == 200
        names = [u["display_name"] for u in resp.json()["users"]]
        assert names == ["First", "Second"]


# =========================================================================
# Combined filters
# =========================================================================


class TestCombinedFilters:
    def test_referrers_search_and_status(self, test_client: TestClient, admin_user, db: Session):
        _make_referrers(db, ["Alpha Approved", "Alpha Pending", "Beta Approved"], ["approved", "pending", "approved"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/referrers", params={"search": "Alpha", "approval_status": "approved"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["referrers"][0]["name"] == "Alpha Approved"

    def test_families_search_and_lock_level(self, test_client: TestClient, admin_user, db: Session):
        _make_families(db, ["Smith A", "Smith B"], lock_levels=["family", "admin"])
        _admin_login(test_client)

        resp = test_client.get("/api/admin/families", params={"search": "Smith", "wish_lock_level": "admin"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["families"][0]["family_name"] == "Smith B"
