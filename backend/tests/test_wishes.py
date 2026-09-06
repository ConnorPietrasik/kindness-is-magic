"""Tests for wish schemas, validation rules, and age-based wish type enforcement."""

import pytest
from pydantic import ValidationError

from app.models import PersonRole, WishType
from app.schemas import (
    _CLEAR,
    AdminWishUpdate,
    PersonCreate,
    PersonCreateInFamily,
    PersonUpdate,
    WishCreate,
    WishUpdate,
    validate_wishes_for_age,
)

# ---------------------------------------------------------------------------
# WishCreate schema tests
# ---------------------------------------------------------------------------


class TestWishCreate:
    def test_valid_adult_wish(self):
        wish = WishCreate(type=WishType.adult, description="A new laptop")
        assert wish.type == WishType.adult
        assert wish.description == "A new laptop"
        assert wish.size is None

    def test_valid_wish_with_size(self):
        wish = WishCreate(type=WishType.practical, description="A winter coat", size="Large")
        assert wish.size == "Large"

    def test_size_zero_becomes_none(self):
        wish = WishCreate(type=WishType.fun, description="A toy", size="0")
        assert wish.size is None

    def test_size_empty_string_becomes_none(self):
        wish = WishCreate(type=WishType.fun, description="A toy", size="")
        assert wish.size is None

    def test_description_max_length(self):
        with pytest.raises(ValidationError):
            WishCreate(type=WishType.adult, description="x" * 101)

    def test_description_min_length(self):
        with pytest.raises(ValidationError):
            WishCreate(type=WishType.adult, description="")

    def test_size_max_length(self):
        with pytest.raises(ValidationError):
            WishCreate(type=WishType.adult, description="A coat", size="x" * 21)

    def test_description_sanitized(self):
        wish = WishCreate(type=WishType.adult, description="  A nice coat  ")
        assert wish.description == "A nice coat"

    def test_valid_wish_with_color(self):
        wish = WishCreate(type=WishType.practical, description="A winter coat", color="Blue")
        assert wish.color == "Blue"

    def test_color_zero_becomes_none(self):
        wish = WishCreate(type=WishType.fun, description="A toy", color="0")
        assert wish.color is None

    def test_color_empty_string_becomes_none(self):
        wish = WishCreate(type=WishType.fun, description="A toy", color="")
        assert wish.color is None

    def test_color_max_length(self):
        with pytest.raises(ValidationError):
            WishCreate(type=WishType.adult, description="A coat", color="x" * 21)

    def test_color_sanitized(self):
        wish = WishCreate(type=WishType.adult, description="A coat", color="  Blue  ")
        assert wish.color == "Blue"


# ---------------------------------------------------------------------------
# WishUpdate schema tests
# ---------------------------------------------------------------------------


class TestWishUpdate:
    def test_partial_update_description(self):
        update = WishUpdate(description="Updated description")
        assert update.description == "Updated description"
        assert update.type is None
        assert update.size is None

    def test_partial_update_size(self):
        update = WishUpdate(size="XL")
        assert update.size == "XL"

    def test_size_zero_becomes_clear(self):
        """'0' (the UI's N/A marker) maps to the _CLEAR sentinel, not a no-op."""
        update = WishUpdate(size="0")
        assert update.size is _CLEAR

    def test_size_empty_becomes_clear(self):
        """'' maps to the _CLEAR sentinel so partial_update clears the column."""
        update = WishUpdate(size="")
        assert update.size is _CLEAR

    def test_partial_update_color(self):
        update = WishUpdate(color="Blue")
        assert update.color == "Blue"

    def test_color_zero_becomes_clear(self):
        update = WishUpdate(color="0")
        assert update.color is _CLEAR

    def test_color_empty_becomes_clear(self):
        """'' maps to the _CLEAR sentinel so partial_update clears the column."""
        update = WishUpdate(color="")
        assert update.color is _CLEAR

    def test_size_junk_type_rejected(self):
        """Non-string junk 422s instead of slipping through to the DB."""
        with pytest.raises(ValidationError):
            WishUpdate(size=42)
        with pytest.raises(ValidationError):
            WishUpdate(size=[1])

    def test_size_integer_zero_rejected(self):
        """Integer 0 is not a clear sentinel for text fields — ``''`` clears."""
        with pytest.raises(ValidationError):
            WishUpdate(size=0)

    def test_color_junk_type_rejected(self):
        with pytest.raises(ValidationError):
            WishUpdate(color={"a": 1})

    def test_size_max_length(self):
        with pytest.raises(ValidationError):
            WishUpdate(size="x" * 21)

    def test_size_null_is_noop(self):
        """null maps to None (partial-update no-op)."""
        assert WishUpdate(size=None).size is None


# ---------------------------------------------------------------------------
# AdminWishUpdate schema tests
# ---------------------------------------------------------------------------


class TestAdminWishUpdate:
    def test_partial_update_color(self):
        update = AdminWishUpdate(color="Red")
        assert update.color == "Red"

    def test_color_zero_becomes_clear(self):
        update = AdminWishUpdate(color="0")
        assert update.color is _CLEAR

    def test_color_empty_becomes_clear(self):
        """'' maps to the _CLEAR sentinel so partial_update clears the column."""
        update = AdminWishUpdate(color="")
        assert update.color is _CLEAR

    def test_color_max_length(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(color="x" * 21)

    def test_size_max_length(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(size="x" * 21)

    def test_purchaser_note_junk_type_rejected(self):
        """Non-string junk 422s instead of slipping through to the DB."""
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchaser_note=42)

    def test_purchased_where_junk_type_rejected(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchased_where=42)

    def test_purchased_where_max_length(self):
        """Over-length purchased_where 422s (column is String(200))."""
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchased_where="x" * 201)

    def test_purchaser_note_max_length(self):
        """Over-length purchaser_note 422s (column is String(400))."""
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchaser_note="x" * 401)

    def test_purchased_at_iso_string_parses(self):
        """ISO-8601 strings parse to datetime."""
        update = AdminWishUpdate(purchased_at="2026-01-15T10:30:00Z")
        assert update.purchased_at is not None
        assert update.purchased_at.year == 2026

    def test_purchased_at_junk_rejected(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(purchased_at=42)

    def test_purchased_at_empty_clears(self):
        """'' maps to the _CLEAR sentinel so the caller clears the column."""
        assert AdminWishUpdate(purchased_at="").purchased_at is _CLEAR

    def test_purchased_at_null_is_noop(self):
        """null maps to None (partial-update no-op)."""
        assert AdminWishUpdate(purchased_at=None).purchased_at is None

    def test_received_at_empty_clears(self):
        """'' maps to the _CLEAR sentinel so the caller clears the column."""
        assert AdminWishUpdate(received_at="").received_at is _CLEAR

    def test_received_at_invalid_string_rejected(self):
        with pytest.raises(ValidationError):
            AdminWishUpdate(received_at="not-a-datetime")

    def test_purchaser_note_empty_clears(self):
        """'' maps to the _CLEAR sentinel so the caller clears the column."""
        assert AdminWishUpdate(purchaser_note="").purchaser_note is _CLEAR

    def test_purchased_where_empty_clears(self):
        """'' maps to the _CLEAR sentinel (previously stored '' as-is)."""
        assert AdminWishUpdate(purchased_where="").purchased_where is _CLEAR

    def test_assigned_to_id_zero_clears(self):
        """0 maps to the _CLEAR sentinel (clear the FK to NULL)."""
        assert AdminWishUpdate(assigned_to_id=0).assigned_to_id is _CLEAR

    def test_assigned_to_id_junk_rejected(self):
        """Non-integer junk 422s (lists hit the DB, non-numeric strings 500'd in the route)."""
        with pytest.raises(ValidationError):
            AdminWishUpdate(assigned_to_id=[1])
        with pytest.raises(ValidationError):
            AdminWishUpdate(assigned_to_id="abc")

    def test_assigned_to_id_boolean_rejected(self):
        """Booleans are an int subclass — rejected explicitly (previously a 500 in the route)."""
        with pytest.raises(ValidationError):
            AdminWishUpdate(assigned_to_id=True)

    def test_assigned_to_id_null_is_noop(self):
        """null maps to None (partial-update no-op)."""
        assert AdminWishUpdate(assigned_to_id=None).assigned_to_id is None


# ---------------------------------------------------------------------------
# Age validation tests
# ---------------------------------------------------------------------------


class TestValidateWishesForAge:
    def test_adult_with_adult_wish(self):
        wishes = [WishCreate(type=WishType.adult, description="A laptop")]
        validate_wishes_for_age(wishes, 18)  # should not raise

    def test_adult_with_adult_wish_over_18(self):
        wishes = [WishCreate(type=WishType.adult, description="A laptop")]
        validate_wishes_for_age(wishes, 25)  # should not raise

    def test_child_with_practical_and_fun(self):
        wishes = [
            WishCreate(type=WishType.practical, description="A coat"),
            WishCreate(type=WishType.fun, description="A game"),
        ]
        validate_wishes_for_age(wishes, 17)  # should not raise

    def test_child_with_practical_and_fun_age_zero(self):
        wishes = [
            WishCreate(type=WishType.practical, description="Diapers"),
            WishCreate(type=WishType.fun, description="A rattle"),
        ]
        validate_wishes_for_age(wishes, 0)  # should not raise

    def test_adult_rejects_practical_wish(self):
        wishes = [WishCreate(type=WishType.practical, description="A coat")]
        with pytest.raises(ValueError, match="adult"):
            validate_wishes_for_age(wishes, 18)

    def test_adult_rejects_fun_wish(self):
        wishes = [WishCreate(type=WishType.fun, description="A game")]
        with pytest.raises(ValueError, match="adult"):
            validate_wishes_for_age(wishes, 20)

    def test_adult_rejects_both_wishes(self):
        wishes = [
            WishCreate(type=WishType.practical, description="A coat"),
            WishCreate(type=WishType.fun, description="A game"),
        ]
        with pytest.raises(ValueError, match="adult"):
            validate_wishes_for_age(wishes, 18)

    def test_child_rejects_adult_wish(self):
        wishes = [WishCreate(type=WishType.adult, description="A laptop")]
        with pytest.raises(ValueError, match="practical.*fun"):
            validate_wishes_for_age(wishes, 10)

    def test_child_rejects_only_practical(self):
        wishes = [WishCreate(type=WishType.practical, description="A coat")]
        with pytest.raises(ValueError, match="practical.*fun"):
            validate_wishes_for_age(wishes, 10)

    def test_child_rejects_only_fun(self):
        wishes = [WishCreate(type=WishType.fun, description="A game")]
        with pytest.raises(ValueError, match="practical.*fun"):
            validate_wishes_for_age(wishes, 10)

    def test_child_rejects_three_wishes(self):
        wishes = [
            WishCreate(type=WishType.practical, description="A coat"),
            WishCreate(type=WishType.fun, description="A game"),
            WishCreate(type=WishType.adult, description="A laptop"),
        ]
        with pytest.raises(ValueError, match="practical.*fun"):
            validate_wishes_for_age(wishes, 10)


# ---------------------------------------------------------------------------
# PersonCreate schema integration tests
# ---------------------------------------------------------------------------


class TestPersonCreateWishes:
    def test_valid_child_person_with_wishes(self):
        person = PersonCreate(
            family_id=1,
            given_name="Alice",
            role=PersonRole.daughter,
            age=10,
            wishes=[
                WishCreate(type=WishType.practical, description="A backpack"),
                WishCreate(type=WishType.fun, description="A doll"),
            ],
        )
        assert len(person.wishes) == 2

    def test_valid_adult_person_with_wishes(self):
        person = PersonCreate(
            family_id=1,
            given_name="Bob",
            role=PersonRole.father,
            age=25,
            wishes=[WishCreate(type=WishType.adult, description="A laptop")],
        )
        assert len(person.wishes) == 1

    def test_child_person_rejects_adult_wish(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                wishes=[WishCreate(type=WishType.adult, description="A laptop")],
            )

    def test_adult_person_rejects_child_wishes(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Bob",
                age=25,
                wishes=[
                    WishCreate(type=WishType.practical, description="A coat"),
                    WishCreate(type=WishType.fun, description="A game"),
                ],
            )

    def test_duplicate_wish_types_rejected(self):
        with pytest.raises(ValidationError):
            PersonCreate(
                family_id=1,
                given_name="Alice",
                age=10,
                wishes=[
                    WishCreate(type=WishType.practical, description="A coat"),
                    WishCreate(type=WishType.practical, description="Shoes"),
                ],
            )


# ---------------------------------------------------------------------------
# PersonCreateInFamily schema tests
# ---------------------------------------------------------------------------


class TestPersonCreateInFamilyWishes:
    def test_valid_child_person(self):
        person = PersonCreateInFamily(
            given_name="Alice",
            role=PersonRole.daughter,
            age=8,
            wishes=[
                WishCreate(type=WishType.practical, description="A backpack"),
                WishCreate(type=WishType.fun, description="A doll"),
            ],
        )
        assert len(person.wishes) == 2

    def test_valid_adult_person(self):
        person = PersonCreateInFamily(
            given_name="Bob",
            role=PersonRole.father,
            age=30,
            wishes=[WishCreate(type=WishType.adult, description="A laptop")],
        )
        assert len(person.wishes) == 1

    def test_rejects_wrong_wish_types_for_age(self):
        with pytest.raises(ValidationError):
            PersonCreateInFamily(
                given_name="Alice",
                age=8,
                wishes=[WishCreate(type=WishType.adult, description="A laptop")],
            )


# ---------------------------------------------------------------------------
# PersonUpdate schema tests
# ---------------------------------------------------------------------------


class TestPersonUpdateWishes:
    def test_update_name_only(self):
        update = PersonUpdate(given_name="New Name")
        assert update.given_name == "New Name"
        assert update.wishes is None

    def test_update_wishes_with_age(self):
        update = PersonUpdate(
            age=10,
            wishes=[
                WishCreate(type=WishType.practical, description="New coat"),
                WishCreate(type=WishType.fun, description="New game"),
            ],
        )
        assert update.age == 10
        assert len(update.wishes) == 2

    def test_update_wishes_rejects_wrong_age(self):
        with pytest.raises(ValidationError, match="adult"):
            PersonUpdate(
                age=25,
                wishes=[
                    WishCreate(type=WishType.practical, description="A coat"),
                    WishCreate(type=WishType.fun, description="A game"),
                ],
            )

    def test_update_wishes_without_age_no_validation(self):
        """Wishes-only update skips age validation (route handler checks existing age)."""
        update = PersonUpdate(
            wishes=[WishCreate(type=WishType.adult, description="A laptop")],
        )
        # Should not raise — age validation happens in route handler
        assert update.wishes is not None
