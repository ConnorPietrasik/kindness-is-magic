"""Tests for the columns query parameter on admin list endpoints.

The ``columns`` param provides two benefits:
1. **Conditional DB lookups** — skips queries for related data not needed.
2. **Response filtering** — trims the JSON payload to requested fields
   (plus required fields).
"""

from fastapi.testclient import TestClient

import pytest

from tests.conftest import login_as


def _admin_login(client: TestClient) -> dict:
    return login_as(client, "admin@test.com", "AdminPass123!")


# ---------------------------------------------------------------------------
# Unit tests — ColumnRequest
# ---------------------------------------------------------------------------


class TestColumnRequest:
    def test_parse_none_means_all_needed(self):
        from app.response_builders import ColumnRequest

        req = ColumnRequest.parse(None)
        assert req.needs("anything") is True
        assert req.needs("a", "b", "c") is True

    def test_parse_comma_separated(self):
        from app.response_builders import ColumnRequest

        req = ColumnRequest.parse("id,name,created_at")
        assert req.needs("id") is True
        assert req.needs("name") is True
        assert req.needs("created_at") is True
        assert req.needs("bio") is False

    def test_parse_strips_whitespace(self):
        from app.response_builders import ColumnRequest

        req = ColumnRequest.parse(" id , name , created_at ")
        assert req.needs("id") is True
        assert req.needs("name") is True

    def test_parse_empty_string_means_no_columns(self):
        from app.response_builders import ColumnRequest

        req = ColumnRequest.parse("")
        assert req._requested == set()
        assert req.needs("anything") is False

    def test_needs_accepts_multiple(self):
        from app.response_builders import ColumnRequest

        req = ColumnRequest.parse("id,name")
        assert req.needs("bio", "name") is True  # name matches
        assert req.needs("bio", "address") is False


# ---------------------------------------------------------------------------
# Unit tests — apply_column_filter
# ---------------------------------------------------------------------------


class TestApplyColumnFilter:
    @pytest.fixture()
    def family_item(self):
        from app.schemas import FamilyDetail

        return FamilyDetail(
            id=1,
            display_id="1",
            family_name="Smith",
            family_wish="Peace",
            contact_name="Jane",
            referrer_id=None,
            verification_status="verified",
            phone_number="555-0000",
            address="123 Main St",
            person_count=0,
            wish_lock_level="family",
            deleted_at=None,
        )

    def test_none_returns_full_dump(self, family_item):
        from app.response_builders import apply_column_filter

        result = apply_column_filter([family_item], None)
        assert len(result) == 1
        assert "family_name" in result[0]
        assert "bio" in result[0]

    def test_filters_to_requested_plus_required(self, family_item):
        from app.response_builders import apply_column_filter

        result = apply_column_filter([family_item], "id,family_name")
        assert len(result) == 1
        # Requested fields present
        assert "id" in result[0]
        assert "family_name" in result[0]
        # Optional non-requested fields excluded (incl. the query-backed ones)
        assert "bio" not in result[0]
        assert "referrer_notes" not in result[0]
        assert "family_wish" not in result[0]
        assert "person_count" not in result[0]
        # Required fields always included
        assert "verification_status" in result[0]
        assert "contact_name" in result[0]
        assert "address" in result[0]

    def test_always_include_forced(self, family_item):
        from app.response_builders import apply_column_filter

        result = apply_column_filter([family_item], "family_name", always_include={"id", "display_id"})
        assert "id" in result[0]
        assert "display_id" in result[0]
        assert "family_name" in result[0]
        assert "bio" not in result[0]

    def test_required_fields_always_included(self, family_item):
        from app.response_builders import apply_column_filter

        result = apply_column_filter([family_item], "bio")
        assert "id" in result[0]  # required
        assert "family_name" in result[0]  # required
        assert "bio" in result[0]  # requested

    def test_unknown_column_returns_400(self, family_item):
        from app.response_builders import apply_column_filter
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            apply_column_filter([family_item], "id,nonexistent_field")
        assert exc_info.value.status_code == 400
        assert "nonexistent_field" in exc_info.value.detail

    def test_filters_dict_items(self):
        from app.response_builders import apply_column_filter

        items = [{"id": 1, "name": "A", "extra": "data"}]
        result = apply_column_filter(items, "id,name")
        assert result == [{"id": 1, "name": "A"}]


# ---------------------------------------------------------------------------
# Integration tests — admin endpoints with ?columns=...
# ---------------------------------------------------------------------------


class TestAdminFamiliesColumns:
    def test_columns_filters_response(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families?columns=id,family_name")
        assert resp.status_code == 200
        family = resp.json()["families"][0]
        # Requested fields present
        assert "id" in family
        assert "family_name" in family
        # Required fields always included
        assert "verification_status" in family
        assert "contact_name" in family
        assert "address" in family
        # Optional non-requested fields excluded
        assert "bio" not in family
        assert "referrer_notes" not in family

    def test_unknown_column_returns_400(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families?columns=id,fake_field")
        assert resp.status_code == 400
        assert "fake_field" in resp.json()["detail"]

    def test_no_columns_returns_full(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families")
        assert resp.status_code == 200
        family = resp.json()["families"][0]
        assert "family_name" in family
        assert "family_wish" in family
        assert "person_count" in family
        assert "bio" in family

    def test_family_wish_optional_column(self, test_client: TestClient, admin_user, family_with_people):
        """family_wish is an optional column — omitted from the response (and the
        lookup skipped) when not requested, real value when requested."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families?columns=id,family_name")
        assert resp.status_code == 200
        assert "family_wish" not in resp.json()["families"][0]

        resp = test_client.get("/api/admin/families?columns=id,family_name,family_wish")
        assert resp.status_code == 200
        assert resp.json()["families"][0]["family_wish"] == "World peace"

    def test_person_count_optional_column(self, test_client: TestClient, admin_user, family_with_people):
        """person_count is an optional column — omitted from the response (and the
        lookup skipped) when not requested, real value when requested."""
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families?columns=id,family_name")
        assert resp.status_code == 200
        assert "person_count" not in resp.json()["families"][0]

        resp = test_client.get("/api/admin/families?columns=id,family_name,person_count")
        assert resp.status_code == 200
        assert resp.json()["families"][0]["person_count"] == 2

    def test_pagination_meta_always_included(self, test_client: TestClient, admin_user, family_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/families?columns=id")
        assert resp.status_code == 200
        body = resp.json()
        assert "total" in body
        assert "page" in body
        assert "page_size" in body
        assert "total_pages" in body


class TestAdminPeopleColumns:
    def test_columns_filters_response(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people?columns=id,given_name")
        assert resp.status_code == 200
        person = resp.json()["people"][0]
        assert "id" in person
        assert "given_name" in person
        # Optional non-requested fields excluded
        assert "note" not in person

    def test_wishes_always_included(self, test_client: TestClient, admin_user, family_with_people):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/people?columns=id")
        assert resp.status_code == 200
        person = resp.json()["people"][0]
        assert "wishes" in person
        assert len(person["wishes"]) == 2  # child has practical + fun


class TestAdminReferrersColumns:
    def test_columns_filters_response(self, test_client: TestClient, admin_user, referrer_record):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/referrers?columns=id,name")
        assert resp.status_code == 200
        referrer = resp.json()["referrers"][0]
        assert "id" in referrer
        assert "name" in referrer
        # Optional non-requested fields excluded
        assert "approved_by_admin_name" not in referrer


class TestAdminUsersColumns:
    def test_columns_filters_response(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.get("/api/admin/users?columns=id,email")
        assert resp.status_code == 200
        user = resp.json()["users"][0]
        assert "id" in user
        assert "email" in user
        # Required fields always included
        assert "display_name" in user
        assert "role" in user
        # Optional non-requested fields excluded
        assert "referrer_name" not in user
