"""CSV import logic for bulk-loading referrers, families, people, and users.

CSV Format
----------
The file is divided into *sections*, each introduced by a comment line
starting with ``#``.  Recognised section names (case-insensitive) are:

- **referrers**  — name, family_limit, phone_number
- **families**   — referrer_name, family_name, family_wish, contact_name, bio, address, phone_number
- **people**     — family_name, given_name, age, wish, size, fun_wish, title, note
- **users**      — email, password, role, referrer_name_or_id, family_name_or_id

Sections are processed in dependency order:
    referrers → families → people → users

Within each section the first row is the *header* (column names).
Subsequent rows are data.

For ``families``, ``people``, and ``users`` the lookup column
(``referrer_name``, ``family_name``, etc.) matches against already-imported
records first, then falls back to existing DB records.  If nothing matches
the row is recorded as an error.

Blank lines and lines starting with ``#`` (outside of a section header) are
skipped.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
import dataclasses

from sqlalchemy.orm import Session

from app.auth import get_password_hash, generate_unique_family_invite_code
from app.models import (
    Family,
    FamilyApprovalStatus,
    Person,
    Referrer,
    ReferrerApprovalStatus,
    User,
    UserRole,
    Wish,
    WishType,
)
from app.user_validation import (
    sanitize_plain_text,
    validate_email,
    validate_user_role_consistency,
)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class RowResult:
    """Per-row outcome."""

    row_number: int  # 1-based line in the CSV file
    entity_type: str  # "referrer" | "family" | "person" | "user"
    action: str  # "created" | "skipped" | "error"
    message: str = ""  # human-readable detail
    db_id: int | None = None  # primary key of the created/updated record


def _row_result_to_dict(r: RowResult) -> dict:
    return dataclasses.asdict(r)


@dataclass
class ImportSummary:
    """Top-level result returned to the API caller."""

    referrers_created: int = 0
    referrers_skipped: int = 0
    referrers_errors: int = 0
    families_created: int = 0
    families_skipped: int = 0
    families_errors: int = 0
    people_created: int = 0
    people_skipped: int = 0
    people_errors: int = 0
    users_created: int = 0
    users_skipped: int = 0
    users_errors: int = 0
    rows: list[RowResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "summary": {
                "referrers": {
                    "created": self.referrers_created,
                    "skipped": self.referrers_skipped,
                    "errors": self.referrers_errors,
                },
                "families": {
                    "created": self.families_created,
                    "skipped": self.families_skipped,
                    "errors": self.families_errors,
                },
                "people": {
                    "created": self.people_created,
                    "skipped": self.people_skipped,
                    "errors": self.people_errors,
                },
                "users": {
                    "created": self.users_created,
                    "skipped": self.users_skipped,
                    "errors": self.users_errors,
                },
            },
            "rows": [_row_result_to_dict(r) for r in self.rows],
        }


# ---------------------------------------------------------------------------
# CSV parsing helpers
# ---------------------------------------------------------------------------

_SECTION_RE = re.compile(r"^\s*#\s*(\w+)\s*$")


def _parse_sections(csv_text: str) -> dict[str, list[list[str]]]:
    """Split raw CSV text into named sections.

    Returns ``{section_name: [[header], [row1], [row2], ...]}``.
    """
    sections: dict[str, list[list[str]]] = {}
    current_section: str | None = None

    reader = csv.reader(io.StringIO(csv_text))
    for row in reader:
        if not row or all(c.strip() == "" for c in row):
            continue

        first = row[0].strip()

        # Detect section header
        m = _SECTION_RE.match(first)
        if m:
            current_section = m.group(1).lower()
            sections.setdefault(current_section, [])
            continue

        if current_section is not None:
            sections[current_section].append([c.strip() for c in row])

    return sections


def _rows_to_dicts(
    section_rows: list[list[str]],
) -> tuple[list[str], list[dict[str, str]]]:
    """Convert raw row lists into dicts keyed by the header row."""
    if not section_rows:
        return [], []
    headers = [h.lower().strip() for h in section_rows[0]]
    records = []
    for row in section_rows[1:]:
        d: dict[str, str] = {}
        for i, h in enumerate(headers):
            d[h] = row[i] if i < len(row) else ""
        records.append(d)
    return headers, records


# ---------------------------------------------------------------------------
# Lookup helpers — match by name within a session
# ---------------------------------------------------------------------------


def _find_referrer(db: Session, name: str) -> Referrer | None:
    return db.query(Referrer).filter(Referrer.name == name, Referrer.deleted_at.is_(None)).first()


def _find_family(db: Session, name: str) -> Family | None:
    return db.query(Family).filter(Family.family_name == name, Family.deleted_at.is_(None)).first()


def _find_person(db: Session, family_id: int, given_name: str, age: int) -> Person | None:
    return (
        db.query(Person)
        .filter(
            Person.family_id == family_id,
            Person.given_name == given_name,
            Person.age == age,
            Person.deleted_at.is_(None),
        )
        .first()
    )


def _find_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower()).first()


def _resolve_ref_id(name_or_id: str, db: Session) -> int | None:
    """Resolve a referrer reference: integer id first, then name lookup."""
    if not name_or_id:
        return None
    # Try integer ID
    try:
        ref_id = int(name_or_id)
        ref = db.query(Referrer).filter(Referrer.id == ref_id, Referrer.deleted_at.is_(None)).first()
        if ref:
            return ref_id
    except ValueError:
        pass
    # Try name lookup
    ref = _find_referrer(db, name_or_id)
    if ref:
        return ref.id
    return None


def _resolve_family_id(name_or_id: str, db: Session) -> int | None:
    """Resolve a family reference: integer id first, then name lookup."""
    if not name_or_id:
        return None
    try:
        fid = int(name_or_id)
        fam = db.query(Family).filter(Family.id == fid, Family.deleted_at.is_(None)).first()
        if fam:
            return fid
    except ValueError:
        pass
    fam = _find_family(db, name_or_id)
    if fam:
        return fam.id
    return None


# ---------------------------------------------------------------------------
# Per-entity processors
# ---------------------------------------------------------------------------


def _process_referrers(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
    dry_run: bool = False,
) -> None:
    """Create referrers from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i

        name = rec.get("name", "").strip()
        if not name:
            summary.rows.append(RowResult(row_num, "referrer", "error", "Missing 'name'"))
            summary.referrers_errors += 1
            continue

        try:
            name = sanitize_plain_text(name)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "referrer", "error", f"name: {exc}"))
            summary.referrers_errors += 1
            continue

        family_limit_raw = rec.get("family_limit", "").strip()
        if not family_limit_raw:
            summary.rows.append(RowResult(row_num, "referrer", "error", "Missing 'family_limit'"))
            summary.referrers_errors += 1
            continue

        try:
            family_limit = int(family_limit_raw)
        except ValueError:
            summary.rows.append(RowResult(row_num, "referrer", "error", f"Invalid family_limit: {family_limit_raw}"))
            summary.referrers_errors += 1
            continue

        phone_number = rec.get("phone_number", "").strip() or ""

        # Skip if already exists
        existing = _find_referrer(db, name)
        if existing:
            summary.rows.append(
                RowResult(
                    row_num,
                    "referrer",
                    "skipped",
                    f"Referrer '{name}' already exists (id={existing.id})",
                )
            )
            summary.referrers_skipped += 1
            continue

        code = generate_unique_family_invite_code(db)
        referrer = Referrer(
            name=name,
            family_limit=family_limit,
            phone_number=phone_number,
            family_invite_code=code,
            approval_status=ReferrerApprovalStatus.approved,
        )
        db.add(referrer)
        db.flush()
        db.refresh(referrer)
        summary.rows.append(
            RowResult(
                row_num,
                "referrer",
                "created" if not dry_run else "would_create",
                f"Referrer '{name}' {'created' if not dry_run else 'would be created'} (id={referrer.id})",
                referrer.id,
            )
        )
        summary.referrers_created += 1


def _process_families(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
    dry_run: bool = False,
) -> None:
    """Create families from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i

        # Resolve referrer (optional)
        referrer_ref = rec.get("referrer_name", "").strip()
        referrer_id = None
        if referrer_ref:
            referrer_id = _resolve_ref_id(referrer_ref, db)
            if referrer_id is None:
                summary.rows.append(
                    RowResult(
                        row_num,
                        "family",
                        "error",
                        f"Referrer '{referrer_ref}' not found",
                    )
                )
                summary.families_errors += 1
                continue

        # family_name (required)
        family_name = rec.get("family_name", "").strip()
        if not family_name:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'family_name'"))
            summary.families_errors += 1
            continue

        try:
            family_name = sanitize_plain_text(family_name)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "family", "error", f"family_name: {exc}"))
            summary.families_errors += 1
            continue

        # family_wish (required)
        family_wish = rec.get("family_wish", "").strip()
        if not family_wish:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'family_wish'"))
            summary.families_errors += 1
            continue

        try:
            family_wish = sanitize_plain_text(family_wish)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "family", "error", f"family_wish: {exc}"))
            summary.families_errors += 1
            continue

        # contact_name (required)
        contact_name = rec.get("contact_name", "").strip()
        if not contact_name:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'contact_name'"))
            summary.families_errors += 1
            continue

        try:
            contact_name = sanitize_plain_text(contact_name)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "family", "error", f"contact_name: {exc}"))
            summary.families_errors += 1
            continue

        # Optional fields
        bio_raw = rec.get("bio", "").strip()
        bio: str | None = None
        if bio_raw:
            try:
                bio = sanitize_plain_text(bio_raw)
            except ValueError:
                pass  # silently drop invalid optional bio

        address_raw = rec.get("address", "").strip()
        address: str | None = None
        if address_raw:
            try:
                address = sanitize_plain_text(address_raw)
            except ValueError:
                pass

        # phone_number (required)
        phone_number = rec.get("phone_number", "").strip()
        if not phone_number:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'phone_number'"))
            summary.families_errors += 1
            continue

        # Skip if already exists
        existing = _find_family(db, family_name)
        if existing:
            summary.rows.append(
                RowResult(
                    row_num,
                    "family",
                    "skipped",
                    f"Family '{family_name}' already exists (id={existing.id})",
                )
            )
            summary.families_skipped += 1
            continue

        family = Family(
            referrer_id=referrer_id,
            family_name=family_name,
            family_wish=family_wish,
            contact_name=contact_name,
            bio=bio,
            address=address,
            phone_number=phone_number,
            approval_status=FamilyApprovalStatus.approved,
        )
        db.add(family)
        db.flush()
        db.refresh(family)
        summary.rows.append(
            RowResult(
                row_num,
                "family",
                "created" if not dry_run else "would_create",
                f"Family '{family_name}' {'created' if not dry_run else 'would be created'} (id={family.id})",
                family.id,
            )
        )
        summary.families_created += 1


def _process_people(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
    dry_run: bool = False,
) -> None:
    """Create people from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i

        # Resolve family (required)
        family_ref = rec.get("family_name", "").strip()
        if not family_ref:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'family_name'"))
            summary.people_errors += 1
            continue

        family_id = _resolve_family_id(family_ref, db)
        if family_id is None:
            summary.rows.append(
                RowResult(
                    row_num,
                    "person",
                    "error",
                    f"Family '{family_ref}' not found",
                )
            )
            summary.people_errors += 1
            continue

        # given_name (required)
        given_name = rec.get("given_name", "").strip()
        if not given_name:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'given_name'"))
            summary.people_errors += 1
            continue

        try:
            given_name = sanitize_plain_text(given_name)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "person", "error", f"given_name: {exc}"))
            summary.people_errors += 1
            continue

        # age (required, integer)
        age_raw = rec.get("age", "").strip()
        if not age_raw:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'age'"))
            summary.people_errors += 1
            continue

        try:
            age = int(age_raw)
        except ValueError:
            summary.rows.append(RowResult(row_num, "person", "error", f"Invalid age: {age_raw}"))
            summary.people_errors += 1
            continue

        # wish (required for all ages)
        wish_desc = rec.get("wish", "").strip()
        if not wish_desc:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'wish'"))
            summary.people_errors += 1
            continue

        try:
            wish_desc = sanitize_plain_text(wish_desc)
        except ValueError as exc:
            summary.rows.append(RowResult(row_num, "person", "error", f"wish: {exc}"))
            summary.people_errors += 1
            continue

        # size (optional, empty → NULL)
        size_raw = rec.get("size", "").strip()
        size: str | None = None
        if size_raw and size_raw != "0":
            try:
                size = sanitize_plain_text(size_raw)
            except ValueError:
                size = None

        # fun_wish (required for children, error if present for adults)
        fun_wish_raw = rec.get("fun_wish", "").strip()
        fun_wish: str | None = None
        if fun_wish_raw:
            try:
                fun_wish = sanitize_plain_text(fun_wish_raw)
            except ValueError as exc:
                summary.rows.append(RowResult(row_num, "person", "error", f"fun_wish: {exc}"))
                summary.people_errors += 1
                continue

        # Validate age-based wish rules
        if age >= 18:
            # Adults: no fun_wish allowed
            if fun_wish:
                summary.rows.append(RowResult(row_num, "person", "error", "Adult (age >= 18) should not have fun_wish"))
                summary.people_errors += 1
                continue
        else:
            # Children: fun_wish is required
            if not fun_wish:
                summary.rows.append(RowResult(row_num, "person", "error", "Child (age < 18) must have fun_wish"))
                summary.people_errors += 1
                continue

        # Optional fields
        title = rec.get("title", "").strip() or None
        if title:
            try:
                title = sanitize_plain_text(title)
            except ValueError:
                title = None

        note = rec.get("note", "").strip() or None
        if note:
            try:
                note = sanitize_plain_text(note)
            except ValueError:
                note = None

        # Skip if already exists (same family + given_name + age)
        existing = _find_person(db, family_id, given_name, age)
        if existing:
            summary.rows.append(
                RowResult(
                    row_num,
                    "person",
                    "skipped",
                    f"Person '{given_name}' already exists (id={existing.id})",
                )
            )
            summary.people_skipped += 1
            continue

        person = Person(
            family_id=family_id,
            given_name=given_name,
            age=age,
            title=title,
            note=note,
        )
        db.add(person)
        db.flush()

        # Create wish(es) based on age
        if age >= 18:
            # Adult: one 'adult' wish
            wish = Wish(
                person_id=person.id,
                type=WishType.adult,
                description=wish_desc,
                size=size,
            )
            db.add(wish)
        else:
            # Child: practical + fun wishes
            practical_wish = Wish(
                person_id=person.id,
                type=WishType.practical,
                description=wish_desc,
                size=size,
            )
            fun_wish_obj = Wish(
                person_id=person.id,
                type=WishType.fun,
                description=fun_wish,
                size=None,
            )
            db.add_all([practical_wish, fun_wish_obj])

        db.refresh(person)
        summary.rows.append(
            RowResult(
                row_num,
                "person",
                "created" if not dry_run else "would_create",
                f"Person '{given_name}' {'created' if not dry_run else 'would be created'} (id={person.id})",
                person.id,
            )
        )
        summary.people_created += 1


# ---------------------------------------------------------------------------
# User processor
# ---------------------------------------------------------------------------


def _process_users(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
    dry_run: bool = False,
) -> None:
    """Create users from CSV records."""
    ROLE_MAP = {
        "admin": UserRole.admin,
        "referrer": UserRole.referrer,
        "family": UserRole.family,
        "purchaser": UserRole.purchaser,
        "delivery": UserRole.delivery,
    }

    for i, rec in enumerate(records):
        row_num = base_row + i
        email = rec.get("email", "").strip().lower()
        password = rec.get("password", "").strip()
        role_str = rec.get("role", "").strip().lower()
        referrer_ref = rec.get("referrer_name_or_id", "").strip()
        family_ref = rec.get("family_name_or_id", "").strip()

        if not email:
            summary.rows.append(RowResult(row_num, "user", "error", "Missing 'email'"))
            summary.users_errors += 1
            continue

        # Validate email format using shared helper
        try:
            email = validate_email(email)
        except ValueError:
            summary.rows.append(RowResult(row_num, "user", "error", "Invalid email format"))
            summary.users_errors += 1
            continue

        if not password:
            summary.rows.append(RowResult(row_num, "user", "error", "Missing 'password'"))
            summary.users_errors += 1
            continue
        if not role_str:
            summary.rows.append(RowResult(row_num, "user", "error", "Missing 'role'"))
            summary.users_errors += 1
            continue

        role = ROLE_MAP.get(role_str)
        if role is None:
            summary.rows.append(
                RowResult(
                    row_num,
                    "user",
                    "error",
                    f"Invalid role: {role_str} (must be admin, referrer, family, purchaser, or delivery)",
                )
            )
            summary.users_errors += 1
            continue

        # Skip if email already exists
        existing = _find_user_by_email(db, email)
        if existing:
            summary.rows.append(
                RowResult(
                    row_num,
                    "user",
                    "skipped",
                    f"User '{email}' already exists (id={existing.id})",
                )
            )
            summary.users_skipped += 1
            continue

        # Resolve foreign keys (always — needed even to detect bad admin refs)
        referrer_id = _resolve_ref_id(referrer_ref, db) if referrer_ref else None
        family_id = _resolve_family_id(family_ref, db) if family_ref else None

        # Validate role constraints using shared helper
        role_errors = validate_user_role_consistency(role, referrer_id, family_id)
        if role_errors:
            # Translate generic messages to CSV-friendly wording
            friendly = {
                "Admin users must not have referrer_id": "Admin users cannot have referrer_id or family_id",
                "Admin users must not have family_id": "Admin users cannot have referrer_id or family_id",
                "Referrer users must have a referrer_id": "Referrer users must have a referrer_name_or_id",
                "Referrer users must not have a family_id": "Referrer users cannot have a family_name_or_id",
                "Family users must have a family_id": "Family users must have a family_name_or_id",
                "Family users must not have a referrer_id": "Family users cannot have referrer_name_or_id",
                "Purchaser users must not have referrer_id": "Purchaser users cannot have referrer_id or family_id",
                "Purchaser users must not have family_id": "Purchaser users cannot have referrer_id or family_id",
                "Delivery users must not have referrer_id": "Delivery users cannot have referrer_id or family_id",
                "Delivery users must not have family_id": "Delivery users cannot have referrer_id or family_id",
            }
            for err in role_errors:
                summary.rows.append(RowResult(row_num, "user", "error", friendly.get(err, err)))
                summary.users_errors += 1
            continue

        # Resolve display_name: CSV value takes precedence, then role-based default
        display_name: str | None = rec.get("display_name", "").strip() or None
        if display_name is None:
            if role == UserRole.admin:
                display_name = "Kindness Fairy"
            elif role == UserRole.referrer and referrer_id:
                ref = db.query(Referrer).filter(Referrer.id == referrer_id).first()
                if ref:
                    display_name = ref.name

        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            role=role,
            display_name=display_name,
            referrer_id=referrer_id,
            family_id=family_id,
        )
        db.add(user)
        db.flush()
        db.refresh(user)
        summary.rows.append(
            RowResult(
                row_num,
                "user",
                "created",
                f"User '{email}' created (id={user.id})",
                user.id,
            )
        )
        summary.users_created += 1


# ---------------------------------------------------------------------------
# Public entry-point
# ---------------------------------------------------------------------------


def import_csv(
    db: Session,
    csv_text: str,
    dry_run: bool = False,
) -> ImportSummary:
    """Parse and import a CSV string into the database.

    Returns an ``ImportSummary`` with counts and per-row results.

    If ``dry_run`` is True, no database writes are committed — entities are
    still flushed (to get surrogate keys) but the transaction is rolled back
    at the end.
    """
    sections = _parse_sections(csv_text)
    summary = ImportSummary()

    # Track row offsets for accurate row numbering
    row_offset = 0

    # Process in dependency order
    for section_name in ("referrers", "families", "people", "users"):
        section_rows = sections.get(section_name)
        if not section_rows:
            continue

        _headers, records = _rows_to_dicts(section_rows)
        if not records:
            continue

        if section_name == "referrers":
            _process_referrers(db, records, row_offset + 1, summary, dry_run=dry_run)
        elif section_name == "families":
            _process_families(db, records, row_offset + 1, summary, dry_run=dry_run)
        elif section_name == "people":
            _process_people(db, records, row_offset + 1, summary, dry_run=dry_run)
        elif section_name == "users":
            _process_users(db, records, row_offset + 1, summary, dry_run=dry_run)

        row_offset += len(section_rows)  # header + data rows

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return summary
