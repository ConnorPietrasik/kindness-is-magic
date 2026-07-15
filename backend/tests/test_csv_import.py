"""Tests for the admin CSV import endpoint and csv_import module."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import login_as


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


def _post_csv(client: TestClient, csv_text: str):
    """POST csv_text as raw body."""
    return client.post(
        "/api/admin/import-csv",
        content=csv_text.encode("utf-8"),
    )


# ---------------------------------------------------------------------------
# CSV content fixtures
# ---------------------------------------------------------------------------

CSV_MINIMAL = """# referrers
name,family_limit,phone_number
Test Ref,5,555-0001

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Test Ref,Test Fam,A wish,Contact,,,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
Test Fam,Alice,8,Backpack,Doll,,

# users
email,password,role,referrer_name_or_id,family_name_or_id
user@example.com,Password123!,referrer,Test Ref,
"""

CSV_FULL_OPTIONALS = """# referrers
name,family_limit,phone_number
Ref One,10,555-1001
Ref Two,20,555-1002

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Ref One,Family Alpha,Wish A,Mom Alpha,Bio A,123 Main St,555-2001
Ref One,Family Beta,Wish B,Dad Beta,,456 Oak Ave,
Ref Two,Family Gamma,Wish C,Sis Gamma,,,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
Family Alpha,Kid One,5,Coat,Puzzle,,
Family Alpha,Kid Two,10,Shoes,Game,,Allergic to peanuts
Family Beta,Baby One,2,Bottles,Blocks,Mrs.,
Family Gamma,Tween,13,Bike,Soccer,,

# users
email,password,role,referrer_name_or_id,family_name_or_id
ref1@test.com,Password123!,referrer,Ref One,
ref2@test.com,Password123!,referrer,Ref Two,
alpha@test.com,Password123!,family,,Family Alpha
beta@test.com,Password123!,family,,Family Beta
gamma@test.com,Password123!,family,,Family Gamma
admin2@test.com,Password123!,admin,,
"""

CSV_USERS_BY_ID = """# referrers
name,family_limit,phone_number
ID Ref,5,555-9999

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
ID Ref,ID Fam,Wish,Contact,,,

# users
email,password,role,referrer_name_or_id,family_name_or_id
byid_ref@test.com,Password123!,referrer,ID Ref,
byid_fam@test.com,Password123!,family,,ID Fam
"""


# =========================================================================
#  CSV sample template endpoint
# =========================================================================

class TestCsvSample:
    def test_200_returns_template(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/csv-sample")
        assert resp.status_code == 200
        body = resp.json()
        assert "csv_template" in body
        assert "# referrers" in body["csv_template"]
        assert "# families" in body["csv_template"]
        assert "# people" in body["csv_template"]
        assert "# users" in body["csv_template"]

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.get("/api/admin/csv-sample")
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.get("/api/admin/csv-sample")
        assert resp.status_code == 403


# =========================================================================
#  CSV import - happy path
# =========================================================================

class TestCsvImportMinimal:
    def test_200_creates_all_entities(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, Referrer, Family, Person

        _admin_login(test_client)
        resp = _post_csv(test_client, CSV_MINIMAL)
        assert resp.status_code == 200
        body = resp.json()

        # Summary checks
        s = body["summary"]
        assert s["referrers"]["created"] == 1
        assert s["families"]["created"] == 1
        assert s["people"]["created"] == 1
        assert s["users"]["created"] == 1

        # Verify in DB
        db.expire_all()
        ref = db.query(Referrer).filter(Referrer.name == "Test Ref").first()
        assert ref is not None
        assert ref.family_limit == 5

        fam = db.query(Family).filter(Family.family_name == "Test Fam").first()
        assert fam is not None
        assert fam.referrer_id == ref.id

        person = db.query(Person).filter(Person.given_name == "Alice").first()
        assert person is not None
        assert person.family_id == fam.id
        assert person.age == 8

        user = db.query(User).filter(User.email == "user@example.com").first()
        assert user is not None
        assert user.role.value == "referrer"
        assert user.referrer_id == ref.id

    def test_409_duplicate_skip(self, test_client: TestClient, admin_user):
        _admin_login(test_client)

        # First import
        resp1 = _post_csv(test_client, CSV_MINIMAL)
        assert resp1.status_code == 200
        assert resp1.json()["summary"]["referrers"]["created"] == 1

        # Second import - should skip existing records
        resp2 = _post_csv(test_client, CSV_MINIMAL)
        assert resp2.status_code == 200
        body = resp2.json()
        assert body["summary"]["referrers"]["skipped"] == 1
        assert body["summary"]["referrers"]["created"] == 0
        assert body["summary"]["families"]["skipped"] == 1
        assert body["summary"]["families"]["created"] == 0
        assert body["summary"]["people"]["skipped"] == 1
        assert body["summary"]["people"]["created"] == 0
        assert body["summary"]["users"]["skipped"] == 1
        assert body["summary"]["users"]["created"] == 0


# =========================================================================
#  CSV import - full optionals
# =========================================================================

class TestCsvImportFull:
    def test_creates_multiple_entities(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User, Family, Person

        _admin_login(test_client)
        resp = _post_csv(test_client, CSV_FULL_OPTIONALS)
        assert resp.status_code == 200
        body = resp.json()
        s = body["summary"]
        assert s["referrers"]["created"] == 2
        assert s["families"]["created"] == 3
        assert s["people"]["created"] == 4
        assert s["users"]["created"] == 6

        db.expire_all()
        # Verify optional fields
        fam = db.query(Family).filter(Family.family_name == "Family Alpha").first()
        assert fam.bio == "Bio A"
        assert fam.address == "123 Main St"
        assert fam.phone_number == "555-2001"

        fam2 = db.query(Family).filter(Family.family_name =="Family Beta").first()
        assert fam2.bio is None

        person = db.query(Person).filter(Person.given_name == "Baby One").first()
        assert person.title == "Mrs."
        assert person.note is None

        person2 = db.query(Person).filter(Person.given_name == "Kid Two").first()
        assert person2.note == "Allergic to peanuts"

        # Admin user
        admin = db.query(User).filter(User.email == "admin2@test.com").first()
        assert admin is not None
        assert admin.role.value == "admin"
        assert admin.referrer_id is None
        assert admin.family_id is None


# =========================================================================
#  CSV import - users by ID reference
# =========================================================================

class TestCsvImportUsersById:
    def test_users_resolve_by_name(self, test_client: TestClient, admin_user, db: Session):
        from app.models import User

        _admin_login(test_client)
        resp = _post_csv(test_client, CSV_USERS_BY_ID)
        assert resp.status_code == 200

        db.expire_all()
        ref_user = db.query(User).filter(User.email == "byid_ref@test.com").first()
        assert ref_user is not None
        assert ref_user.role.value == "referrer"
        assert ref_user.referrer_id is not None

        fam_user = db.query(User).filter(User.email == "byid_fam@test.com").first()
        assert fam_user is not None
        assert fam_user.role.value == "family"
        assert fam_user.family_id is not None


# =========================================================================
#  CSV import - error handling
# =========================================================================

class TestCsvImportErrors:
    def test_missing_required_fields(self, test_client: TestClient, admin_user):
        csv_data = """# referrers
name,family_limit,phone_number

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Missing Ref,Orphan Fam,A wish,Contact,,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["referrers"]["created"] == 0
        assert body["summary"]["families"]["errors"] == 1
        # The error row should say the referrer was not found
        rows = body["rows"]
        error_rows = [r for r in rows if r["entity_type"] == "family" and r["action"] == "error"]
        assert len(error_rows) == 1
        assert "not found" in error_rows[0]["message"].lower()

    def test_bad_referrer_id_for_family(self, test_client: TestClient, admin_user):
        csv_data = """# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Does Not Exist,No Ref Fam,Wish,Contact,,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["families"]["errors"] == 1

    def test_bad_family_id_for_person(self, test_client: TestClient, admin_user):
        csv_data = """# people
family_name,given_name,age,practical_wish,fun_wish,title,note
No Family,Kid,5,Coat,Game,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["people"]["errors"] == 1

    def test_bad_role_for_user(self, test_client: TestClient, admin_user):
        csv_data = """# users
email,password,role,referrer_name_or_id,family_name_or_id
bad@test.com,Password123!,superadmin,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["users"]["errors"] == 1

    def test_referrer_user_missing_referrer_id(self, test_client: TestClient, admin_user):
        csv_data = """# users
email,password,role,referrer_name_or_id,family_name_or_id
noreffam@test.com,Password123!,referrer,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["users"]["errors"] == 1

    def test_family_user_missing_family_id(self, test_client: TestClient, admin_user):
        csv_data = """# users
email,password,role,referrer_name_or_id,family_name_or_id
noreffam@test.com,Password123!,family,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["users"]["errors"] == 1

    def test_admin_user_with_refs_rejected(self, test_client: TestClient, admin_user):
        csv_data = """# referrers
name,family_limit,phone_number
AdminRef,5,555-0001

# users
email,password,role,referrer_name_or_id,family_name_or_id
adminbad@test.com,Password123!,admin,AdminRef,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        assert resp.json()["summary"]["users"]["errors"] == 1

    def test_empty_body_rejected(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/import-csv",
            content=b"",
        )
        assert resp.status_code == 400

    def test_401_unauthenticated(self, test_client: TestClient):
        resp = test_client.post(
            "/api/admin/import-csv",
            content=b"name,limit",
        )
        assert resp.status_code == 401

    def test_403_non_admin(self, test_client: TestClient, referrer_user):
        login_as(test_client, "referrer@test.com", "RefPass1234!")
        resp = test_client.post(
            "/api/admin/import-csv",
            content=b"name,limit",
        )
        assert resp.status_code == 403


# =========================================================================
#  CSV import - row-level detail
# =========================================================================

class TestCsvImportRowDetail:
    def test_rows_contain_expected_fields(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = _post_csv(test_client, CSV_MINIMAL)
        assert resp.status_code == 200
        body = resp.json()
        rows = body["rows"]

        # Should have 4 rows: 1 referrer, 1 family, 1 person, 1 user
        assert len(rows) == 4

        for row in rows:
            assert "row_number" in row
            assert "entity_type" in row
            assert "action" in row
            assert "message" in row
            assert row["action"] in ("created", "skipped", "error")

        # First row should be referrer
        assert rows[0]["entity_type"] == "referrer"
        assert rows[0]["action"] == "created"
        assert rows[0].get("db_id") is not None


class TestCsvImportPeopleDedup:
    def test_duplicate_person_same_family_name_age_skipped(
        self, test_client: TestClient, admin_user
    ):
        """A person with the same family, given_name, and age is skipped."""
        csv_data = """# referrers
name,family_limit,phone_number
Dedup Ref,5,555-0001

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Dedup Ref,Dedup Fam,Wish,Contact,,,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
Dedup Fam,Alice,8,Backpack,Doll,,
Dedup Fam,Alice,8,Backpack,Doll,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["people"]["created"] == 1
        assert body["summary"]["people"]["skipped"] == 1

    def test_same_name_different_family_not_duplicate(
        self, test_client: TestClient, admin_user
    ):
        """Same name+age in a different family is NOT a duplicate."""
        csv_data = """# referrers
name,family_limit,phone_number
Dedup Ref2,5,555-0002

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Dedup Ref2,Fam A,Wish A,Contact A,,,
Dedup Ref2,Fam B,Wish B,Contact B,,,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
Fam A,Alice,8,Backpack,Doll,,
Fam B,Alice,8,Coat,Game,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["people"]["created"] == 2
        assert body["summary"]["people"]["skipped"] == 0

    def test_same_name_different_age_same_family_not_duplicate(
        self, test_client: TestClient, admin_user
    ):
        """Same name but different age in the same family is NOT a duplicate."""
        csv_data = """# referrers
name,family_limit,phone_number
Dedup Ref3,5,555-0003

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
Dedup Ref3,Dedup Fam3,Wish,Contact,,,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
Dedup Fam3,Alice,8,Backpack,Doll,,
Dedup Fam3,Alice,12,Coat,Game,,
"""
        _admin_login(test_client)
        resp = _post_csv(test_client, csv_data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["people"]["created"] == 2
        assert body["summary"]["people"]["skipped"] == 0
