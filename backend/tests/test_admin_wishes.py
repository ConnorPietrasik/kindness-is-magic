"""Tests for admin wish CRUD endpoints."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import (
    FamilyVerificationStatus,
    Person,
    PersonRole,
    Referrer,
    ReferrerApprovalStatus,
    User,
    UserRole,
    Wish,
    WishType,
)
from tests.conftest import make_family


@pytest.fixture()
def wish_tree(db: Session):
    """Create a referrer → family → person → wishes tree for testing."""
    from app.auth import get_password_hash

    ref = Referrer(
        name="Wish Referrer",
        family_limit=10,
        phone_number="555-000-0001",
        family_invite_code="KFI-WISH01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = make_family(
        db,
        referrer_id=ref.id,
        family_name="Wish Family",
        family_wish="Warm clothes",
        contact_name="Wish Contact",
        phone_number="555-000-0002",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(
        family_id=fam.id,
        given_name="WishChild",
        age=10,
        role=PersonRole.son,
    )
    db.add(person)
    db.flush()

    w1 = Wish(person_id=person.id, type=WishType.practical, description="A backpack", size="Medium")
    w2 = Wish(person_id=person.id, type=WishType.fun, description="A doll")
    db.add_all([w1, w2])
    db.commit()
    db.refresh(w1)
    db.refresh(w2)

    admin = User(
        email="wish_admin@test.com",
        hashed_password=get_password_hash("AdminPass123!"),
        role=UserRole.admin,
        display_name=None,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    return {
        "referrer": ref,
        "family": fam,
        "person": person,
        "wishes": [w1, w2],
        "admin": admin,
    }


@pytest.fixture()
def second_family_with_wishes(db: Session, wish_tree):
    """Second family with wishes for filter tests."""
    fam2 = make_family(
        db,
        referrer_id=wish_tree["referrer"].id,
        family_name="Second Family",
        family_wish="Food",
        contact_name="Second Contact",
        phone_number="555-000-0003",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam2)
    db.commit()
    db.refresh(fam2)

    person2 = Person(
        family_id=fam2.id,
        given_name="SecondChild",
        age=12,
        role=PersonRole.son,
    )
    db.add(person2)
    db.flush()

    w3 = Wish(person_id=person2.id, type=WishType.practical, description="New shoes", size="3Y")
    w4 = Wish(person_id=person2.id, type=WishType.fun, description="A football")
    db.add_all([w3, w4])
    db.commit()
    db.refresh(w3)
    db.refresh(w4)

    return {"family": fam2, "person": person2, "wishes": [w3, w4]}


@pytest.fixture()
def sort_tree(db: Session):
    """Three families under two referrers with interleaved wish ids.

    ``fam_c`` (under ``ref2``) is created first so it has the lowest
    family id, while the referrer group must still sort it last. Person
    wishes are inserted interleaved across families so plain wish-id
    order differs from the grouped default.
    """
    ref1 = Referrer(
        name="Sort Ref 1",
        family_limit=10,
        phone_number="555-3000-0001",
        family_invite_code="KFI-SORT01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    ref2 = Referrer(
        name="Sort Ref 2",
        family_limit=10,
        phone_number="555-3000-0002",
        family_invite_code="KFI-SORT02",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add_all([ref1, ref2])
    db.flush()

    def new_family(name, referrer_id, phone):
        fam = make_family(
            db,
            family_wish=f"{name} family wish",
            referrer_id=referrer_id,
            family_name=name,
            contact_name=f"{name} Contact",
            phone_number=phone,
            verification_status=FamilyVerificationStatus.verified,
        )
        db.flush()
        return fam

    fam_c = new_family("Sort Family C", ref2.id, "555-3000-0003")
    fam_a = new_family("Sort Family A", ref1.id, "555-3000-0004")
    fam_b = new_family("Sort Family B", ref1.id, "555-3000-0005")

    def new_person(family, name):
        p = Person(family_id=family.id, given_name=name, age=10, role=PersonRole.son)
        db.add(p)
        db.flush()
        return p

    a1, a2 = new_person(fam_a, "Sort A One"), new_person(fam_a, "Sort A Two")
    c1, c2 = new_person(fam_c, "Sort C One"), new_person(fam_c, "Sort C Two")
    b1, b2 = new_person(fam_b, "Sort B One"), new_person(fam_b, "Sort B Two")

    def new_wish(person, wtype, label):
        w = Wish(person_id=person.id, type=wtype, description=f"Sort {label}")
        db.add(w)
        db.flush()
        return w

    # Interleaved inserts so wish ids alternate across families
    wishes = {
        "a1_practical": new_wish(a1, WishType.practical, "A1 practical"),
        "c1_practical": new_wish(c1, WishType.practical, "C1 practical"),
        "b1_practical": new_wish(b1, WishType.practical, "B1 practical"),
        "a1_fun": new_wish(a1, WishType.fun, "A1 fun"),
        "c1_fun": new_wish(c1, WishType.fun, "C1 fun"),
        "b1_fun": new_wish(b1, WishType.fun, "B1 fun"),
        "a2_practical": new_wish(a2, WishType.practical, "A2 practical"),
        "c2_practical": new_wish(c2, WishType.practical, "C2 practical"),
        "b2_practical": new_wish(b2, WishType.practical, "B2 practical"),
        "a2_fun": new_wish(a2, WishType.fun, "A2 fun"),
        "c2_fun": new_wish(c2, WishType.fun, "C2 fun"),
        "b2_fun": new_wish(b2, WishType.fun, "B2 fun"),
    }

    family_wishes = {}
    for label, family in (("a", fam_a), ("b", fam_b), ("c", fam_c)):
        w = db.query(Wish).filter(Wish.family_id == family.id, Wish.type == WishType.family).first()
        assert w is not None
        family_wishes[label] = w

    return {
        "ref1": ref1,
        "ref2": ref2,
        "fam_a": fam_a,
        "fam_b": fam_b,
        "fam_c": fam_c,
        "family_wishes": family_wishes,
        "wishes": wishes,
    }


@pytest.fixture()
def unassigned_tree(db: Session):
    """One assigned and one unassigned family, each with only its family wish.

    The unassigned family is created last so it has the higher family id,
    while the grouped order must still place it first.
    """
    ref = Referrer(
        name="Unassigned Sort Referrer",
        family_limit=10,
        phone_number="555-5000-0001",
        family_invite_code="KFI-UNAS01",
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.flush()

    assigned = make_family(
        db,
        family_wish="Unassigned Sort: assigned family wish",
        referrer_id=ref.id,
        family_name="Unassigned Sort Assigned",
        contact_name="Unassigned Sort Assigned Contact",
        phone_number="555-5000-0002",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.flush()
    unassigned = make_family(
        db,
        family_wish="Unassigned Sort: unassigned family wish",
        family_name="Unassigned Sort Unassigned",
        contact_name="Unassigned Sort Unassigned Contact",
        phone_number="555-5000-0003",
        verification_status=FamilyVerificationStatus.verified,
    )
    db.flush()

    return {"assigned": assigned, "unassigned": unassigned}


def family_wish(db: Session, tree) -> Wish:
    """The tree family's family wish row (created by make_family)."""
    w = db.query(Wish).filter(Wish.family_id == tree["family"].id, Wish.type == WishType.family).first()
    assert w is not None
    return w


@pytest.fixture()
def logged_in_admin(test_client, admin_user):
    """Login as admin_user and return the test_client (cookies auto-handled)."""
    resp = test_client.post(
        "/api/auth/login",
        json={"email": admin_user.email, "password": "AdminPass123!"},
    )
    assert resp.status_code == 200
    return test_client


@pytest.fixture()
def logged_in_referrer(test_client, referrer_user):
    """Login as referrer_user for 403 tests."""
    resp = test_client.post(
        "/api/auth/login",
        json={"email": referrer_user.email, "password": "RefPass1234!"},
    )
    assert resp.status_code == 200
    return test_client


# ---------------------------------------------------------------------------
# List endpoint tests
# ---------------------------------------------------------------------------


class TestListWishes:
    def test_default_list(self, test_client, admin_user, wish_tree):
        """Default list returns all active wishes (person wishes + family wish)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert len(data["wishes"]) == 3
        assert data["page"] == 1
        assert data["page_size"] == 50

        # The family wish appears as a wish row with no person
        fam_wish = [w for w in data["wishes"] if w["type"] == "family"]
        assert len(fam_wish) == 1
        assert fam_wish[0]["description"] == "Warm clothes"
        assert fam_wish[0]["person_id"] is None
        assert fam_wish[0]["person_given_name"] is None
        assert fam_wish[0]["family_id"] == wish_tree["family"].id

    def test_list_includes_color(self, test_client, admin_user, wish_tree, db):
        """List items include the color field (None when unset)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_tree["wishes"][0].color = "Blue"
        db.commit()

        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 200
        colors = {w["id"]: w["color"] for w in resp.json()["wishes"]}
        assert colors[wish_tree["wishes"][0].id] == "Blue"
        assert colors[wish_tree["wishes"][1].id] is None

    def test_pagination(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Pagination works correctly."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?page=1&page_size=2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 6
        assert len(data["wishes"]) == 2
        assert data["total_pages"] == 3

        resp2 = test_client.get("/api/admin/wishes?page=2&page_size=2")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2["wishes"]) == 2

    def test_filter_by_family_id(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Filter by family_id returns only wishes for that family."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?family_id={wish_tree['family'].id}")
        assert resp.status_code == 200
        data = resp.json()
        # 2 person wishes + the family wish (bound to the family directly)
        assert data["total"] == 3
        for w in data["wishes"]:
            assert w["family_id"] == wish_tree["family"].id

    def test_filter_by_person_id(self, test_client, admin_user, wish_tree):
        """Filter by person_id returns only wishes for that person."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?person_id={wish_tree['person'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        for w in data["wishes"]:
            assert w["person_id"] == wish_tree["person"].id

    def test_filter_by_assigned_to_id(self, test_client, admin_user, wish_tree, db):
        """Filter by assigned_to_id returns only assigned wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Assign one wish
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.get(f"/api/admin/wishes?assigned_to_id={admin_user.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["assigned_to_id"] == admin_user.id

    def test_filter_by_assigned_to_id_zero(self, test_client, admin_user, wish_tree, db):
        """Filter by assigned_to_id=0 returns only unassigned wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Assign one wish
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.get("/api/admin/wishes?assigned_to_id=0")
        assert resp.status_code == 200
        data = resp.json()
        # The other person wish + the family wish are unassigned
        assert data["total"] == 2
        for w in data["wishes"]:
            assert w["assigned_to_id"] is None

    def test_filter_by_purchased_true(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=true returns only purchased wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_filter_by_purchased_false(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=false returns only unpurchased wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=false")
        assert resp.status_code == 200
        data = resp.json()
        # The other person wish + the family wish are unpurchased
        assert data["total"] == 2

    def test_filter_by_purchased_all(self, test_client, admin_user, wish_tree, db):
        """Filter by purchased=all returns all wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        now = datetime.now(timezone.utc)
        wish_tree["wishes"][0].purchased_at = now
        db.commit()

        resp = test_client.get("/api/admin/wishes?purchased=all")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3

    def test_filter_search(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Search filters by wish description and person/family name."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?search=backpack")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["description"] == "A backpack"

        resp2 = test_client.get("/api/admin/wishes?search=WishChild")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["total"] == 2

        resp3 = test_client.get("/api/admin/wishes?search=Second+Family")
        assert resp3.status_code == 200
        data3 = resp3.json()
        # 2 person wishes (family via person) + the family wish (family directly)
        assert data3["total"] == 3

    def test_filter_search_wildcards_match_literally(self, test_client, admin_user, wish_tree, second_family_with_wishes, db):
        """LIKE wildcards typed by the user match literally, not as pattern syntax."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"] + second_family_with_wishes["wishes"]
        wishes[0].description = "Get 50% off"
        wishes[1].description = "Get 50 off"
        wishes[2].description = "a_b toy"
        wishes[3].description = "aXb toy"
        db.commit()

        # "50%" must not degenerate into a "contains 50" pattern
        resp = test_client.get("/api/admin/wishes?search=50%25")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == wishes[0].id

        # "_" must not match any single character
        resp = test_client.get("/api/admin/wishes?search=a_b")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["wishes"][0]["id"] == wishes[2].id

    def test_filter_wish_type_invalid_422(self, test_client, admin_user):
        """An invalid wish_type value is rejected with 422, not a 500 from the DB."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?wish_type=banana")
        assert resp.status_code == 422

    def test_combined_filters(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Multiple filters can be combined."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes?family_id={wish_tree['family'].id}&person_id={wish_tree['person'].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_empty_results(self, test_client, admin_user, wish_tree):
        """Non-matching filter returns empty list."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes?search=nonexistentxyz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["wishes"] == []
        assert data["total_pages"] == 0


# ---------------------------------------------------------------------------
# Default (grouped) order tests
# ---------------------------------------------------------------------------


def expected_sort_order(tree):
    """The canonical grouped default order for the sort_tree fixture."""
    fw = tree["family_wishes"]
    w = tree["wishes"]
    return [
        fw["a"].id,
        w["a1_practical"].id,
        w["a1_fun"].id,
        w["a2_practical"].id,
        w["a2_fun"].id,
        fw["b"].id,
        w["b1_practical"].id,
        w["b1_fun"].id,
        w["b2_practical"].id,
        w["b2_fun"].id,
        fw["c"].id,
        w["c1_practical"].id,
        w["c1_fun"].id,
        w["c2_practical"].id,
        w["c2_fun"].id,
    ]


class TestDefaultOrder:
    """The grouped default order (referrer → family → person, family wish first)."""

    def test_default_groups_by_family(self, logged_in_admin, sort_tree):
        """Each family's wishes form a contiguous block; blocks follow referrer, family id."""
        resp = logged_in_admin.get("/api/admin/wishes")
        assert resp.status_code == 200
        items = resp.json()["wishes"]
        assert len(items) == 15

        fam_ids = [item["family_id"] for item in items]
        # Collapse consecutive runs — one run per family, in referrer/family order
        runs = [fam_ids[0]]
        for fam_id in fam_ids[1:]:
            if fam_id != runs[-1]:
                runs.append(fam_id)
        assert runs == [sort_tree["fam_a"].id, sort_tree["fam_b"].id, sort_tree["fam_c"].id]
        for fam in (sort_tree["fam_a"], sort_tree["fam_b"], sort_tree["fam_c"]):
            assert fam_ids.count(fam.id) == 5

    def test_default_order_within_family(self, logged_in_admin, sort_tree):
        """Family wish first, then persons in order, practical before fun."""
        resp = logged_in_admin.get("/api/admin/wishes")
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.json()["wishes"]]
        assert ids == expected_sort_order(sort_tree)

    def test_default_referrer_group_dominates_family_id(self, logged_in_admin, sort_tree):
        """The lowest family id belongs to ref2's family and sorts after ref1's families."""
        assert sort_tree["fam_c"].id < sort_tree["fam_a"].id
        resp = logged_in_admin.get("/api/admin/wishes")
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.json()["wishes"]]
        assert ids.index(sort_tree["family_wishes"]["c"].id) > ids.index(sort_tree["wishes"]["b2_fun"].id)

    def test_explicit_sort_still_applies(self, logged_in_admin, wish_tree):
        """An explicit sort= still orders by that field."""
        resp = logged_in_admin.get("/api/admin/wishes?sort=description")
        assert resp.status_code == 200
        descs = [w["description"] for w in resp.json()["wishes"]]
        assert descs == sorted(descs)

        resp = logged_in_admin.get("/api/admin/wishes?sort=-description")
        assert resp.status_code == 200
        assert [w["description"] for w in resp.json()["wishes"]] == sorted(descs, reverse=True)

    def test_unknown_or_empty_sort_falls_back_to_default(self, logged_in_admin, wish_tree):
        """Unknown or empty sort values fall back to the grouped default (family wish first)."""
        for sort_param in ("bogus", ""):
            resp = logged_in_admin.get(f"/api/admin/wishes?sort={sort_param}")
            assert resp.status_code == 200
            items = resp.json()["wishes"]
            by_type = {w["type"]: w for w in items}
            assert [w["id"] for w in items] == [by_type["family"]["id"], by_type["practical"]["id"], by_type["fun"]["id"]]

    def test_default_order_across_pages(self, logged_in_admin, sort_tree):
        """The grouped order continues correctly across pages."""
        full = logged_in_admin.get("/api/admin/wishes")
        assert full.status_code == 200
        full_ids = [w["id"] for w in full.json()["wishes"]]

        paged_ids = []
        for page in (1, 2, 3):
            resp = logged_in_admin.get(f"/api/admin/wishes?page={page}&page_size=5")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total"] == 15
            assert data["total_pages"] == 3
            assert len(data["wishes"]) == 5
            paged_ids.extend(w["id"] for w in data["wishes"])

        assert paged_ids == full_ids
        assert paged_ids == expected_sort_order(sort_tree)

    def test_type_order_practical_fun_adult(self, logged_in_admin, wish_tree, db):
        """A person's wishes order by type: practical, fun, adult.

        An adult wish on a child violates the age-based type rules, but is
        inserted directly at the DB level to exercise the sort key itself.
        """
        adult = Wish(person_id=wish_tree["person"].id, type=WishType.adult, description="A board game night")
        db.add(adult)
        db.commit()

        fam_wish = db.query(Wish).filter(Wish.family_id == wish_tree["family"].id, Wish.type == WishType.family).first()
        resp = logged_in_admin.get(f"/api/admin/wishes?family_id={wish_tree['family'].id}")
        assert resp.status_code == 200
        ids = [w["id"] for w in resp.json()["wishes"]]
        assert ids == [fam_wish.id, wish_tree["wishes"][0].id, wish_tree["wishes"][1].id, adult.id]

    def test_unassigned_families_sort_first(self, logged_in_admin, unassigned_tree):
        """Families without a referrer sort ahead of assigned ones, before family id."""
        assert unassigned_tree["unassigned"].id > unassigned_tree["assigned"].id
        resp = logged_in_admin.get("/api/admin/wishes")
        assert resp.status_code == 200
        fam_ids = [w["family_id"] for w in resp.json()["wishes"]]
        assert fam_ids == [unassigned_tree["unassigned"].id, unassigned_tree["assigned"].id]


# ---------------------------------------------------------------------------
# Get endpoint tests
# ---------------------------------------------------------------------------


class TestGetWish:
    def test_get_valid_wish(self, test_client, admin_user, wish_tree):
        """Get a valid wish returns detail with person context."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get(f"/api/admin/wishes/{wish_tree['wishes'][0].id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == wish_tree["wishes"][0].id
        assert data["person_given_name"] == "WishChild"
        assert data["person_family_name"] == "Wish Family"

    def test_get_nonexistent_wish(self, test_client, admin_user):
        """Non-existent wish returns 404."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.get("/api/admin/wishes/99999")
        assert resp.status_code == 404

    def test_get_soft_deleted_wish(self, test_client, admin_user, wish_tree, db):
        """Soft-deleted wish returns 404."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_tree["wishes"][0].deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.get(f"/api/admin/wishes/{wish_tree['wishes'][0].id}")
        assert resp.status_code == 404

    def test_get_family_wish(self, test_client, admin_user, wish_tree, db):
        """Family wish returns detail with null person fields."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        w = family_wish(db, wish_tree)
        resp = test_client.get(f"/api/admin/wishes/{w.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "family"
        assert data["description"] == "Warm clothes"
        assert data["person_id"] is None
        assert data["person_given_name"] is None
        assert data["person_family_name"] is None


# ---------------------------------------------------------------------------
# Patch endpoint tests
# ---------------------------------------------------------------------------


class TestPatchWish:
    def test_update_description(self, test_client, admin_user, wish_tree):
        """Update description only."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"description": "Updated backpack"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated backpack"

    def test_update_size(self, test_client, admin_user, wish_tree):
        """Update size."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"size": "Large"},
        )
        assert resp.status_code == 200
        assert resp.json()["size"] == "Large"

    def test_update_color(self, test_client, admin_user, wish_tree):
        """Update color."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"color": "Blue"},
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == "Blue"

    def test_update_color_empty_clears(self, test_client, admin_user, wish_tree):
        """Sending '' clears color to NULL."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_id = wish_tree["wishes"][0].id
        resp = test_client.patch(f"/api/admin/wishes/{wish_id}", json={"color": "Blue"})
        assert resp.status_code == 200

        resp = test_client.patch(f"/api/admin/wishes/{wish_id}", json={"color": ""})
        assert resp.status_code == 200
        assert resp.json()["color"] is None

    def test_update_size_empty_clears(self, test_client, admin_user, wish_tree):
        """Sending '' clears size to NULL."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(f"/api/admin/wishes/{wish_tree['wishes'][0].id}", json={"size": ""})
        assert resp.status_code == 200
        assert resp.json()["size"] is None

    def test_change_type_valid(self, test_client, admin_user, wish_tree, db):
        """Change type to another valid type for person's age (after removing conflict)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Child (age 10) can have practical or fun
        # Soft-delete the existing fun wish to avoid unique constraint conflict
        fun_wish = [w for w in wish_tree["wishes"] if w.type == WishType.fun][0]
        fun_wish.deleted_at = datetime.now(timezone.utc)
        db.commit()

        wish = wish_tree["wishes"][0]  # practical
        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"type": "fun"},
        )
        assert resp.status_code == 200
        assert resp.json()["type"] == "fun"

    def test_change_type_invalid(self, test_client, admin_user, wish_tree):
        """Change type to invalid type for person's age returns 400."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Child (age 10) cannot have adult type
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"type": "adult"},
        )
        assert resp.status_code == 400

    def test_update_family_wish_description(self, test_client, admin_user, wish_tree, db):
        """Family wish description is editable like any other wish."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        w = family_wish(db, wish_tree)
        resp = test_client.patch(f"/api/admin/wishes/{w.id}", json={"description": "Updated family wish"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "Updated family wish"
        assert data["person_id"] is None

    def test_change_type_on_family_wish_rejected(self, test_client, admin_user, wish_tree, db):
        """Type is fixed per owner — a family wish cannot change type."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        w = family_wish(db, wish_tree)
        resp = test_client.patch(f"/api/admin/wishes/{w.id}", json={"type": "fun"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Family wish type cannot be changed"
        assert w.type == WishType.family

    def test_set_assigned_to_id(self, test_client, admin_user, wish_tree):
        """Set assigned_to_id to a valid user."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_clear_assigned_to_id(self, test_client, admin_user, wish_tree, db):
        """Clear assigned_to_id via 0 sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"assigned_to_id": 0},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] is None

    def test_set_purchased_at(self, test_client, admin_user, wish_tree):
        """Set purchased_at."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-01-15T10:30:00Z"
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchased_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is not None

    def test_clear_purchased_at(self, test_client, admin_user, wish_tree, db):
        """'' clears purchased_at (partial-update sentinel convention); null is a no-op."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchased_at = datetime.now(timezone.utc)
        db.commit()

        # null is a no-op (partial-update convention)
        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"purchased_at": None},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is not None

        # '' clears to NULL
        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"purchased_at": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is None

    def test_invalid_purchased_at_422(self, test_client, admin_user, wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchased_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_invalid_received_at_422(self, test_client, admin_user, wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"received_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_set_purchased_where(self, test_client, admin_user, wish_tree):
        """Set purchased_where."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_where"] == "Target"

    def test_set_received_at(self, test_client, admin_user, wish_tree):
        """Set received_at."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-02-01T12:00:00Z"
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"received_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is not None

    def test_set_purchaser_note(self, test_client, admin_user, wish_tree):
        """Set purchaser_note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.patch(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}",
            json={"purchaser_note": "Got it on sale"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Got it on sale"

    def test_clear_purchaser_note(self, test_client, admin_user, wish_tree, db):
        """Clear purchaser_note via empty string sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = test_client.patch(
            f"/api/admin/wishes/{wish.id}",
            json={"purchaser_note": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] is None


# ---------------------------------------------------------------------------
# Mark-purchased endpoint tests
# ---------------------------------------------------------------------------


class TestMarkPurchased:
    def test_normal_case(self, test_client, admin_user, wish_tree):
        """Normal mark-purchased sets purchased_at, purchased_where, and assigns to admin."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_where": "Walmart"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["purchased_at"] is not None
        assert data["purchased_where"] == "Walmart"
        assert data["assigned_to_id"] == admin_user.id

    def test_purchased_at_explicit(self, test_client, admin_user, wish_tree):
        """An explicit purchased_at is used as-is."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-02-14T09:30:00Z"
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_where": "Walmart", "purchased_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] == dt

    def test_purchased_at_clear(self, test_client, admin_user, wish_tree, db):
        """'' clears purchased_at (null/omitted default to now)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchased_at = datetime.now(timezone.utc)
        db.commit()
        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_at": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["purchased_at"] is None

    def test_purchased_at_invalid_422(self, test_client, admin_user, wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_mark_purchased_family_wish(self, test_client, admin_user, wish_tree, db):
        """Family wish can be marked purchased (person fields stay null)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        w = family_wish(db, wish_tree)
        resp = test_client.post(
            f"/api/admin/wishes/{w.id}/mark-purchased",
            json={"purchased_where": "Walmart"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["purchased_at"] is not None
        assert data["purchased_where"] == "Walmart"
        assert data["assigned_to_id"] == admin_user.id
        assert data["person_id"] is None

    def test_auto_reassign(self, test_client, admin_user, wish_tree, db):
        """Mark-purchased reassigns wish to calling admin even if assigned to someone else."""
        from app.auth import get_password_hash

        # Create another user and assign the wish to them
        other_user = User(
            email="other_admin@test.com",
            hashed_password=get_password_hash("OtherPass123!"),
            role=UserRole.admin,
            display_name=None,
        )
        db.add(other_user)
        db.commit()
        db.refresh(other_user)

        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = other_user.id
        db.commit()

        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_auto_assign_unassigned(self, test_client, admin_user, wish_tree):
        """Mark-purchased assigns to admin when wish is unassigned."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        assert wish.assigned_to_id is None

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": None},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == admin_user.id

    def test_note_preservation_omit(self, test_client, admin_user, wish_tree, db):
        """Omitting purchaser_note keeps existing note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Existing note"
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "Existing note"

    def test_note_overwrite(self, test_client, admin_user, wish_tree, db):
        """Providing purchaser_note overwrites existing note."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        wish.purchaser_note = "Old note"
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target", "purchaser_note": "New note"},
        )
        assert resp.status_code == 200
        assert resp.json()["purchaser_note"] == "New note"

    def test_received_at_set(self, test_client, admin_user, wish_tree):
        """Providing received_at sets it."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        dt = "2026-02-15T10:00:00Z"
        resp = test_client.post(
            f"/api/admin/wishes/{wish_tree['wishes'][0].id}/mark-purchased",
            json={"purchased_where": "Target", "received_at": dt},
        )
        assert resp.status_code == 200
        assert resp.json()["received_at"] is not None

    def test_received_at_preservation_omit(self, test_client, admin_user, wish_tree, db):
        """Omitting received_at keeps existing value."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        existing_dt = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        wish.received_at = existing_dt
        db.commit()

        resp = test_client.post(
            f"/api/admin/wishes/{wish.id}/mark-purchased",
            json={"purchased_where": "Target"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["received_at"] == existing_dt.isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Batch-assign endpoint tests
# ---------------------------------------------------------------------------


class TestBatchAssign:
    def test_success_multiple(self, test_client, admin_user, wish_tree, second_family_with_wishes):
        """Successfully assign multiple wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish_ids = [w.id for w in wish_tree["wishes"]] + [w.id for w in second_family_with_wishes["wishes"]]
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": wish_ids, "assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 4

    def test_fail_fast_invalid_wish_id(self, test_client, admin_user, wish_tree):
        """Fail-fast when one wish ID doesn't exist."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={
                "wish_ids": [wish_tree["wishes"][0].id, 99999],
                "assigned_to_id": admin_user.id,
            },
        )
        assert resp.status_code == 400

    def test_fail_fast_invalid_user(self, test_client, admin_user, wish_tree):
        """Fail-fast when assigned_to_id user doesn't exist."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [wish_tree["wishes"][0].id], "assigned_to_id": 99999},
        )
        assert resp.status_code == 400

    def test_single_wish(self, test_client, admin_user, wish_tree):
        """Batch assign with a single wish."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [wish_tree["wishes"][0].id], "assigned_to_id": admin_user.id},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 1

    def test_batch_unassign(self, test_client, admin_user, wish_tree, db):
        """Batch-unassign wishes via assigned_to_id=0 sentinel."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        # Pre-assign wishes
        for w in wish_tree["wishes"]:
            w.assigned_to_id = admin_user.id
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-assign",
            json={"wish_ids": [w.id for w in wish_tree["wishes"]], "assigned_to_id": 0},
        )
        assert resp.status_code == 200
        assert resp.json()["assigned_count"] == 2

        # Verify wishes are unassigned
        for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wish_tree["wishes"]])).all():
            assert w.assigned_to_id is None


# ---------------------------------------------------------------------------
# Batch mark-purchased endpoint tests
# ---------------------------------------------------------------------------


class TestBatchMarkPurchased:
    def test_batch_mark_success_multiple(self, test_client, admin_user, wish_tree, second_family_with_wishes, db):
        """Batch mark sets purchase fields on all selected wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"] + second_family_with_wishes["wishes"]
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={
                "wish_ids": [w.id for w in wishes],
                "purchased_where": "Walmart",
                "received_at": "2026-02-15T10:00:00Z",
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 4}

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_where == "Walmart"
            assert fresh[w.id].received_at is not None
            assert fresh[w.id].assigned_to_id == admin_user.id

    def test_batch_mark_purchased_at_explicit(self, test_client, admin_user, wish_tree, db):
        """An explicit purchased_at is applied to every wish in the batch."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        dt = "2026-02-14T09:30:00Z"
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": dt},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_at.isoformat().replace("+00:00", "Z") == dt

    def test_batch_mark_purchased_at_clear(self, test_client, admin_user, wish_tree, db):
        """'' clears purchased_at on every wish in the batch."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        for w in wishes:
            w.purchased_at = datetime.now(timezone.utc)
        db.commit()
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": ""},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is None

    def test_batch_mark_purchased_at_invalid_422(self, test_client, admin_user, wish_tree):
        """A malformed datetime is rejected with 422, not a 500 from the DB."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_at": "not-a-date"},
        )
        assert resp.status_code == 422

    def test_batch_mark_duplicate_ids_counted_once(self, test_client, admin_user, wish_tree, db):
        """Duplicate wish IDs are deduplicated — marked_count counts unique wishes."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [wishes[0].id, wishes[0].id, wishes[1].id], "purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 2}

        fresh = db.query(Wish).filter(Wish.id == wishes[0].id).first()
        assert fresh.purchased_where == "Target"

    def test_batch_mark_family_wish(self, test_client, admin_user, wish_tree, db):
        """A family wish can be batch marked (person fields stay null)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        w = family_wish(db, wish_tree)
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id], "purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 1}

        fresh = db.query(Wish).filter(Wish.id == w.id).first()
        assert fresh.purchased_at is not None
        assert fresh.purchased_where == "Target"
        assert fresh.assigned_to_id == admin_user.id

    def test_batch_mark_reassigns_to_admin(self, test_client, admin_user, wish_tree, db):
        """Batch mark assigns each wish to the calling admin, even if assigned elsewhere."""
        from app.auth import get_password_hash

        other_user = User(
            email="other_batch_mark@test.com",
            hashed_password=get_password_hash("OtherPass123!"),
            role=UserRole.admin,
            display_name=None,
        )
        db.add(other_user)
        db.commit()
        db.refresh(other_user)

        wish = wish_tree["wishes"][0]
        wish.assigned_to_id = other_user.id
        db.commit()

        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [wish.id], "purchased_where": "Target"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 1}

        fresh = db.query(Wish).filter(Wish.id == wish.id).first()
        assert fresh.assigned_to_id == admin_user.id

    def test_batch_mark_null_purchased_where_clears(self, test_client, admin_user, wish_tree, db):
        """purchased_where=null clears any existing value."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        for w in wishes:
            w.purchased_where = "Old store"
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": None},
        )
        assert resp.status_code == 200
        assert resp.json() == {"marked_count": 2}

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].purchased_at is not None
            assert fresh[w.id].purchased_where is None

    def test_batch_mark_received_at_clear(self, test_client, admin_user, wish_tree, db):
        """received_at='' clears any existing value (partial-update sentinel)."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        existing = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        for w in wishes:
            w.received_at = existing
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "received_at": ""},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].received_at is None

    def test_batch_mark_received_at_omit_preserves(self, test_client, admin_user, wish_tree, db):
        """Omitting received_at keeps the existing value."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        existing = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)
        for w in wishes:
            w.received_at = existing
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        for w in wishes:
            assert fresh[w.id].received_at == existing

    def test_batch_mark_does_not_touch_purchaser_note(self, test_client, admin_user, wish_tree, db):
        """Batch mark leaves per-item purchaser notes untouched."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        wishes[0].purchaser_note = "Note one"
        wishes[1].purchaser_note = "Note two"
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 200

        fresh = {w.id: w for w in db.query(Wish).filter(Wish.id.in_([w.id for w in wishes])).all()}
        assert fresh[wishes[0].id].purchaser_note == "Note one"
        assert fresh[wishes[1].id].purchaser_note == "Note two"

    def test_batch_mark_empty_wish_ids_422(self, test_client, admin_user):
        """Empty wish_ids list is rejected."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [], "purchased_where": "Target"},
        )
        assert resp.status_code == 422

    def test_batch_mark_fail_fast_invalid_wish_id(self, test_client, admin_user, wish_tree, db):
        """Missing wish ID → 400 and nothing is mutated."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wish = wish_tree["wishes"][0]
        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [wish.id, 99999], "purchased_where": "Target"},
        )
        assert resp.status_code == 400

        fresh = db.query(Wish).filter(Wish.id == wish.id).first()
        assert fresh.purchased_at is None

    def test_batch_mark_fail_fast_soft_deleted(self, test_client, admin_user, wish_tree, db):
        """Soft-deleted wish ID → 400 and nothing is mutated."""
        test_client.post(
            "/api/auth/login",
            json={"email": admin_user.email, "password": "AdminPass123!"},
        )
        wishes = wish_tree["wishes"]
        wishes[1].deleted_at = datetime.now(timezone.utc)
        db.commit()

        resp = test_client.post(
            "/api/admin/wishes/batch-mark-purchased",
            json={"wish_ids": [w.id for w in wishes], "purchased_where": "Target"},
        )
        assert resp.status_code == 400

        fresh = db.query(Wish).filter(Wish.id == wishes[0].id).first()
        assert fresh.purchased_at is None


# ---------------------------------------------------------------------------
# Authorization tests
# ---------------------------------------------------------------------------


class TestAuthorization:
    def test_non_admin_list(self, test_client, referrer_user):
        """Non-admin gets 403 on list."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.get("/api/admin/wishes")
        assert resp.status_code == 403

    def test_non_admin_get(self, test_client, referrer_user):
        """Non-admin gets 403 on get."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.get("/api/admin/wishes/1")
        assert resp.status_code == 403

    def test_non_admin_patch(self, test_client, referrer_user):
        """Non-admin gets 403 on patch."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.patch("/api/admin/wishes/1", json={"description": "test"})
        assert resp.status_code == 403

    def test_non_admin_mark_purchased(self, test_client, referrer_user):
        """Non-admin gets 403 on mark-purchased."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.post("/api/admin/wishes/1/mark-purchased", json={"purchased_where": "test"})
        assert resp.status_code == 403

    def test_non_admin_batch_assign(self, test_client, referrer_user):
        """Non-admin gets 403 on batch-assign."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.post("/api/admin/wishes/batch-assign", json={"wish_ids": [1], "assigned_to_id": 1})
        assert resp.status_code == 403

    def test_non_admin_batch_mark_purchased(self, test_client, referrer_user):
        """Non-admin gets 403 on batch-mark-purchased."""
        test_client.post(
            "/api/auth/login",
            json={"email": referrer_user.email, "password": "RefPass1234!"},
        )
        resp = test_client.post("/api/admin/wishes/batch-mark-purchased", json={"wish_ids": [1], "purchased_where": "Target"})
        assert resp.status_code == 403
