"""Tests for input sanitization (HTML rejection + whitespace normalization)."""

import pytest
from pydantic import ValidationError

from app.schemas import (
    AdminReferrerUpdate,
    AdminUserCreate,
    AdminUserUpdate,
    AdminWishUpdate,
    DonorWishPurchaseMark,
    FamilyCreate,
    FamilyCreateByReferrer,
    FamilyUpdate,
    PersonCreate,
    PersonCreateInFamily,
    PersonUpdate,
    ReferrerCreate,
    ReferrerSelfRegister,
    ReferrerUpdate,
    WishBatchMarkPurchased,
    WishCreate,
    WishPurchaseMark,
)
from app.models import PersonRole, UserRole, WishType
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
            ReferrerCreate(name=HTML_PAYLOAD, family_limit=5, phone_number="555-000-0001")

    def test_admin_referrer_update(self):
        with pytest.raises(ValidationError):
            AdminReferrerUpdate(name=HTML_PAYLOAD)

    def test_referrer_update(self):
        with pytest.raises(ValidationError):
            ReferrerUpdate(name=HTML_PAYLOAD)

    def test_referrer_self_register(self):
        with pytest.raises(ValidationError):
            ReferrerSelfRegister(
                code="KMG-ABC123",
                name=HTML_PAYLOAD,
                email="test@test.com",
                phone_number="555-000-0001",
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
                phone_number="555-000-0001",
                address="123 Main St",
            )

    def test_family_create_wish(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish=HTML_PAYLOAD,
                contact_name="Contact",
                phone_number="555-000-0001",
                address="123 Main St",
            )

    def test_family_create_contact(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name=HTML_PAYLOAD,
                phone_number="555-000-0001",
                address="123 Main St",
            )

    def test_family_create_bio(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name="Contact",
                phone_number="555-000-0001",
                address="123 Main St",
                bio=HTML_PAYLOAD,
            )

    def test_family_create_address(self):
        with pytest.raises(ValidationError):
            FamilyCreate(
                referrer_id=1,
                family_name="The Smiths",
                family_wish="A wish",
                contact_name="Contact",
                phone_number="555-000-0001",
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
                phone_number="555-000-0001",
                address="123 Main St",
            )


class TestPersonSchemasRejectHtml:
    def test_person_create_name(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name=HTML_PAYLOAD,
                role=PersonRole.daughter,
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description="Shoes"),
                    WishCreate(type=WishType.fun, description="Game"),
                ],
            )

    def test_person_create_wish_description(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                role=PersonRole.daughter,
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description=HTML_PAYLOAD),
                    WishCreate(type=WishType.fun, description="Game"),
                ],
            )

    def test_person_create_note(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                role=PersonRole.daughter,
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description="Shoes"),
                    WishCreate(type=WishType.fun, description="Game"),
                ],
                note=HTML_PAYLOAD,
            )

    def test_person_create_invalid_role(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                role="Ms.",  # not a valid PersonRole
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description="Shoes"),
                    WishCreate(type=WishType.fun, description="Game"),
                ],
            )

    def test_person_update(self):
        with pytest.raises(ValidationError):
            PersonUpdate(given_name=HTML_PAYLOAD)

    def test_person_create_in_family(self):
        with pytest.raises(ValidationError):
            PersonCreateInFamily(
                given_name=HTML_PAYLOAD,
                role=PersonRole.daughter,
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description="Shoes"),
                    WishCreate(type=WishType.fun, description="Game"),
                ],
            )


# ---------------------------------------------------------------------------
# Positive tests — valid plain text passes through cleanly
# ---------------------------------------------------------------------------


class TestValidInputPasses:
    def test_referrer_create_clean(self):
        r = ReferrerCreate(name="Alice Smith", family_limit=5, phone_number="555-000-0001")
        assert r.name == "Alice Smith"

    def test_family_create_clean(self):
        f = FamilyCreate(
            referrer_id=1,
            family_name="The Smiths",
            family_wish="A new roof for our home",
            contact_name="John Smith",
            phone_number="555-123-1234",
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
            role=PersonRole.daughter,
            age=10,
            wishes=[
                WishCreate(type=WishType.practical, description="A backpack for school"),
                WishCreate(type=WishType.fun, description="A doll"),
            ],
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
            phone_number="555-123-1234",
            address="123 Main St",
        )
        assert f.family_name == "The Smiths"
        assert f.family_wish == "A new roof"


class TestAdminUserSchemasRejectHtml:
    def test_admin_user_create_rejects_html(self):
        with pytest.raises(ValidationError):
            AdminUserCreate(
                email="admin@test.com",
                password="Password123!",
                role=UserRole.admin,
                display_name=HTML_PAYLOAD,
            )

    def test_admin_user_update_rejects_html(self):
        with pytest.raises(ValidationError):
            AdminUserUpdate(display_name=HTML_PAYLOAD)

    def test_admin_user_create_clean(self):
        u = AdminUserCreate(
            email="admin@test.com",
            password="Password123!",
            role=UserRole.admin,
            display_name="  Admin   User  ",
        )
        assert u.display_name == "Admin User"

    def test_admin_user_create_none_display_name(self):
        u = AdminUserCreate(
            email="admin@test.com",
            password="Password123!",
            role=UserRole.admin,
        )
        assert u.display_name is None

    def test_admin_user_update_clean(self):
        u = AdminUserUpdate(display_name="  Updated   Name  ")
        assert u.display_name == "Updated Name"

    def test_admin_user_update_none_display_name(self):
        u = AdminUserUpdate(display_name=None)
        assert u.display_name is None


# ---------------------------------------------------------------------------
# Phone number validation — minimum 10 digits
# ---------------------------------------------------------------------------


class TestPhoneNumberValidation:
    def test_family_create_rejects_too_few_digits(self):
        with pytest.raises(ValidationError, match="10 digits"):
            FamilyCreate(
                referrer_id=1,
                family_name="Test",
                family_wish="Wish",
                contact_name="Contact",
                phone_number="555-1234",
                address="123 Main St",
            )

    def test_family_create_accepts_10_digits(self):
        f = FamilyCreate(
            referrer_id=1,
            family_name="Test",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="555-123-4567",
            address="123 Main St",
        )
        assert f.phone_number == "555-123-4567"

    def test_family_create_accepts_international(self):
        f = FamilyCreate(
            referrer_id=1,
            family_name="Test",
            family_wish="Wish",
            contact_name="Contact",
            phone_number="+1 (555) 123-4567",
            address="123 Main St",
        )
        assert f.phone_number == "+1 (555) 123-4567"

    def test_referrer_create_rejects_too_few_digits(self):
        with pytest.raises(ValidationError, match="10 digits"):
            ReferrerCreate(name="Test", family_limit=5, phone_number="123-4567")

    def test_family_update_rejects_too_few_digits(self):
        with pytest.raises(ValidationError, match="10 digits"):
            FamilyUpdate(phone_number="555-1234")


class TestWishPurchaseMarkSchemas:
    def test_purchase_mark_rejects_html_in_purchased_where(self):
        with pytest.raises(ValidationError):
            WishPurchaseMark(purchased_where=HTML_PAYLOAD)

    def test_purchase_mark_normalizes_whitespace_in_purchased_where(self):
        m = WishPurchaseMark(purchased_where="  Walmart\nSupercenter  ")
        assert m.purchased_where == "Walmart Supercenter"

    def test_batch_purchase_mark_rejects_html_in_purchased_where(self):
        with pytest.raises(ValidationError):
            WishBatchMarkPurchased(wish_ids=[1], purchased_where=HTML_PAYLOAD)

    def test_batch_purchase_mark_normalizes_whitespace_in_purchased_where(self):
        m = WishBatchMarkPurchased(wish_ids=[1], purchased_where="  Kmart\n ")
        assert m.purchased_where == "Kmart"

    def test_donor_purchase_mark_rejects_html_in_purchased_where(self):
        with pytest.raises(ValidationError):
            DonorWishPurchaseMark(purchased_where=HTML_PAYLOAD)

    def test_donor_purchase_mark_normalizes_whitespace_in_purchased_where(self):
        m = DonorWishPurchaseMark(purchased_where="  Kmart\n ")
        assert m.purchased_where == "Kmart"


class TestAdminWishUpdateSchemas:
    def test_rejects_html_in_purchased_where(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchased_where=HTML_PAYLOAD)

    def test_normalizes_whitespace_in_purchased_where(self):
        u = AdminWishUpdate(purchased_where="  Walmart\nSupercenter  ")
        assert u.purchased_where == "Walmart Supercenter"

    def test_rejects_html_in_purchaser_note(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchaser_note=HTML_PAYLOAD)

    def test_normalizes_whitespace_in_purchaser_note(self):
        u = AdminWishUpdate(purchaser_note="  Note\none  ")
        assert u.purchaser_note == "Note one"
