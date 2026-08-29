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
            WishCreate(type=WishType.adult, description="x" * 61)

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

    def test_size_zero_becomes_none(self):
        update = WishUpdate(size="0")
        assert update.size is None

    def test_size_empty_becomes_clear(self):
        """'' maps to the _CLEAR sentinel so partial_update clears the column."""
        update = WishUpdate(size="")
        assert update.size is _CLEAR

    def test_partial_update_color(self):
        update = WishUpdate(color="Blue")
        assert update.color == "Blue"

    def test_color_zero_becomes_none(self):
        update = WishUpdate(color="0")
        assert update.color is None

    def test_color_empty_becomes_clear(self):
        """'' maps to the _CLEAR sentinel so partial_update clears the column."""
        update = WishUpdate(color="")
        assert update.color is _CLEAR


# ---------------------------------------------------------------------------
# AdminWishUpdate schema tests
# ---------------------------------------------------------------------------


class TestAdminWishUpdate:
    def test_partial_update_color(self):
        update = AdminWishUpdate(color="Red")
        assert update.color == "Red"

    def test_color_zero_becomes_none(self):
        update = AdminWishUpdate(color="0")
        assert update.color is None

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
