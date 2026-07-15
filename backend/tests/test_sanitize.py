"""Tests for input sanitization (HTML rejection + whitespace normalization)."""

import pytest
from pydantic import ValidationError

from app.schemas import (
    FamilyCreate,
    FamilyCreateByReferrer,
    FamilyUpdate,
    PersonCreate,
    PersonCreateInFamily,
    PersonUpdate,
    ReferrerCreate,
    ReferrerSelfRegister,
    ReferrerSelfUpdate,
    ReferrerUpdate,
)
from app.user_validation import sanitize_plain_text


# ---------------------------------------------------------------------------
# Unit tests for sanitize_plain_text
# ---------------------------------------------------------------------------


class TestSanitizePlainText:
    def test_plain_text_passes_through(self):
        assert sanitize_plain_text("Hello world") == "Hello world"

    def test_strips_leading_trailing_whitespace(self):
        assert sanitize_plain_text("  hello  ") == "hello"

    def test_collapses_internal_whitespace(self):
        assert sanitize_plain_text("hello    world") == "hello world"

    def test_collapses_newlines_and_tabs(self):
        assert sanitize_plain_text("hello\n\n\tworld") == "hello world"

    def test_rejects_script_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text('<script>alert("xss")</script>')

    def test_rejects_img_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text('<img src="x" onerror="alert(1)">')

    def test_rejects_div_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text("<div>normal text</div>")

    def test_rejects_embedded_tag_in_normal_text(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text("Hello <b>world</b>")

    def test_rejects_self_closing_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text("Hello<br/>world")

    def test_rejects_svg_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text('<svg onload="alert(1)">')

    def test_rejects_iframe_tag(self):
        with pytest.raises(ValueError, match="HTML tags are not allowed"):
            sanitize_plain_text('<iframe src="evil.com"></iframe>')


# ---------------------------------------------------------------------------
# Integration tests — Pydantic schema validators reject HTML
# ---------------------------------------------------------------------------


HTML_PAYLOAD = '<script>alert("xss")</script>'


class TestReferrerSchemasRejectHtml:
    def test_referrer_create(self):
        with pytest.raises(ValidationError):
            ReferrerCreate(name=HTML_PAYLOAD, family_limit=5, phone_number="555-0001")

    def test_referrer_update(self):
        with pytest.raises(ValidationError):
            ReferrerUpdate(name=HTML_PAYLOAD)

    def test_referrer_self_update(self):
        with pytest.raises(ValidationError):
            ReferrerSelfUpdate(name=HTML_PAYLOAD)

    def test_referrer_self_register(self):
        with pytest.raises(ValidationError):
            ReferrerSelfRegister(
                code="KMG-ABC123",
                name=HTML_PAYLOAD,
                email="test@test.com",
                phone_number="555-0001",
                password="Password123!",
            )


class TestFamilySchemasRejectHtml:
    def test_family_create_name(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name=HTML_PAYLOAD,
                family_wish="A wish",
                contact_name="Contact",
            )

    def test_family_create_wish(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish=HTML_PAYLOAD,
                contact_name="Contact",
            )

    def test_family_create_contact(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name=HTML_PAYLOAD,
            )

    def test_family_create_bio(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name="Contact",
                bio=HTML_PAYLOAD,
            )

    def test_family_create_address(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name="Contact",
                address=HTML_PAYLOAD,
            )

    def test_family_update(self):
        with pytest.raises(ValidationError):
            FamilyUpdate(family_name=HTML_PAYLOAD)

    def test_family_create_by_referrer(self):
        with pytest.raises(ValidationError):
            FamilyCreateByReferrer(
                family_name=HTML_PAYLOAD,
                family_wish="A wish",
                contact_name="Contact",
            )


class TestPersonSchemasRejectHtml:
    def test_person_create_name(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name=HTML_PAYLOAD,
                age=10,
                practical_wish="Shoes",
                fun_wish="Game",
            )

    def test_person_create_practical_wish(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                practical_wish=HTML_PAYLOAD,
                fun_wish="Game",
            )

    def test_person_create_fun_wish(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                practical_wish="Shoes",
                fun_wish=HTML_PAYLOAD,
            )

    def test_person_create_note(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                practical_wish="Shoes",
                fun_wish="Game",
                note=HTML_PAYLOAD,
            )

    def test_person_create_title(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                practical_wish="Shoes",
                fun_wish="Game",
                title=HTML_PAYLOAD,
            )

    def test_person_update(self):
        with pytest.raises(ValidationError):
            PersonUpdate(given_name=HTML_PAYLOAD)

    def test_person_create_in_family(self):
        with pytest.raises(ValidationError):
            PersonCreateInFamily(
                given_name=HTML_PAYLOAD,
                age=10,
                practical_wish="Shoes",
                fun_wish="Game",
            )


# ---------------------------------------------------------------------------
# Positive tests — valid plain text passes through cleanly
# ---------------------------------------------------------------------------


class TestValidInputPasses:
    def test_referrer_create_clean(self):
        r = ReferrerCreate(name="Alice Smith", family_limit=5, phone_number="555-0001")
        assert r.name == "Alice Smith"

    def test_family_create_clean(self):
        f = FamilyCreate(
            referrer_id=1,
            family_name="The Smiths",
            family_wish="A new roof for our home",
            contact_name="John Smith",
            bio="A family of four\n\nWe really need help.",
            address="123 Main St",
        )
        assert f.family_name == "The Smiths"
        # Whitespace should be normalized
        assert f.bio == "A family of four We really need help."

    def test_person_create_clean(self):
        p = PersonCreate(
            family_id=1,
            given_name="Alice",
            age=10,
            practical_wish="A backpack for school",
            fun_wish="A doll",
            note="Allergic to peanuts",
        )
        assert p.given_name == "Alice"
        assert p.note == "Allergic to peanuts"

    def test_whitespace_normalization(self):
        f = FamilyCreate(
            referrer_id=1,
            family_name="  The   Smiths  ",
            family_wish="A   new    roof",
            contact_name="John Smith",
        )
        assert f.family_name == "The Smiths"
        assert f.family_wish == "A new roof"
