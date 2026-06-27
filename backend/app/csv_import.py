"""CSV import logic for bulk-loading referrers, families, people, and users.

CSV Format
----------
The file is divided into *sections*, each introduced by a comment line
starting with ``#``.  Recognised section names (case-insensitive) are:

- **referrers**  — name, family_limit, phone_number
- **families**   — referrer_name, family_name, family_wish, contact_name, bio, address, phone_number
- **people**     — family_name, given_name, age, practical_wish, fun_wish, title, note
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

from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.models import Family, Person, Referrer, User, UserRole


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class RowResult:
    """Per-row outcome."""

    row_number: int          # 1-based line in the CSV file
    entity_type: str         # "referrer" | "family" | "person" | "user"
    action: str              # "created" | "skipped" | "error"
    message: str = ""        # human-readable detail
    db_id: int | None = None # primary key of the created/updated record


import dataclasses as _dc

def _row_result_to_dict(r: RowResult) -> dict:
    return _dc.asdict(r)


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


def _rows_to_dicts(section_rows: list[list[str]]) -> tuple[list[str], list[dict[str, str]]]:
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
    return db.query(Referrer).filter(Referrer.name == name).first()


def _find_family(db: Session, name: str) -> Family | None:
    return db.query(Family).filter(Family.family_name == name).first()


def _find_person(db: Session, family_id: int, given_name: str, age: int) -> Person | None:
    return (
        db.query(Person)
        .filter(
            Person.family_id == family_id,
            Person.given_name == given_name,
            Person.age == age,
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
        ref = db.query(Referrer).filter(Referrer.id == ref_id).first()
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
        fam = db.query(Family).filter(Family.id == fid).first()
        if fam:
            return fid
    except ValueError:
        pass
    fam = _find_family(db, name_or_id)
    if fam:
        return fam.id
    return None


# ---------------------------------------------------------------------------
# Processors — one per entity type
# ---------------------------------------------------------------------------

def _process_referrers(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
) -> None:
    """Create referrers from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i
        name = rec.get("name", "").strip()
        if not name:
            summary.rows.append(RowResult(row_num, "referrer", "error", "Missing 'name' column"))
            summary.referrers_errors += 1
            continue

        family_limit_raw = rec.get("family_limit", "").strip()
        phone = rec.get("phone_number", "").strip()

        if not family_limit_raw:
            summary.rows.append(RowResult(row_num, "referrer", "error", "Missing 'family_limit' column"))
            summary.referrers_errors += 1
            continue

        try:
            family_limit = int(family_limit_raw)
        except ValueError:
            summary.rows.append(RowResult(row_num, "referrer", "error", f"Invalid family_limit: {family_limit_raw}"))
            summary.referrers_errors += 1
            continue

        # Skip if name already exists (idempotent)
        existing = _find_referrer(db, name)
        if existing:
            summary.rows.append(RowResult(row_num, "referrer", "skipped", f"Referrer '{name}' already exists (id={existing.id})"))
            summary.referrers_skipped += 1
            continue

        ref = Referrer(name=name, family_limit=family_limit, phone_number=phone)
        db.add(ref)
        db.flush()
        db.refresh(ref)
        summary.rows.append(RowResult(row_num, "referrer", "created", f"Referrer '{name}' created (id={ref.id})", ref.id))
        summary.referrers_created += 1


def _process_families(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
) -> None:
    """Create families from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i
        family_name = rec.get("family_name", "").strip()
        family_wish = rec.get("family_wish", "").strip()
        contact_name = rec.get("contact_name", "").strip()

        if not family_name:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'family_name'"))
            summary.families_errors += 1
            continue
        if not family_wish:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'family_wish'"))
            summary.families_errors += 1
            continue
        if not contact_name:
            summary.rows.append(RowResult(row_num, "family", "error", "Missing 'contact_name'"))
            summary.families_errors += 1
            continue

        # Resolve referrer
        referrer_name_or_id = rec.get("referrer_name", "").strip()
        referrer_id = _resolve_ref_id(referrer_name_or_id, db)
        if referrer_id is None:
            summary.rows.append(RowResult(row_num, "family", "error", f"Referrer '{referrer_name_or_id}' not found"))
            summary.families_errors += 1
            continue

        # Skip if family name already exists
        existing = _find_family(db, family_name)
        if existing:
            summary.rows.append(RowResult(row_num, "family", "skipped", f"Family '{family_name}' already exists (id={existing.id})"))
            summary.families_skipped += 1
            continue

        fam = Family(
            referrer_id=referrer_id,
            family_name=family_name,
            family_wish=family_wish,
            contact_name=contact_name,
            bio=rec.get("bio", "").strip() or None,
            address=rec.get("address", "").strip() or None,
            phone_number=rec.get("phone_number", "").strip() or None,
        )
        db.add(fam)
        db.flush()
        db.refresh(fam)
        summary.rows.append(RowResult(row_num, "family", "created", f"Family '{family_name}' created (id={fam.id})", fam.id))
        summary.families_created += 1


def _process_people(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
) -> None:
    """Create people from CSV records."""
    for i, rec in enumerate(records):
        row_num = base_row + i
        family_name_or_id = rec.get("family_name", "").strip()
        given_name = rec.get("given_name", "").strip()
        age_raw = rec.get("age", "").strip()
        practical_wish = rec.get("practical_wish", "").strip()
        fun_wish = rec.get("fun_wish", "").strip()

        if not family_name_or_id:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'family_name'"))
            summary.people_errors += 1
            continue
        if not given_name:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'given_name'"))
            summary.people_errors += 1
            continue
        if not age_raw:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'age'"))
            summary.people_errors += 1
            continue
        if not practical_wish:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'practical_wish'"))
            summary.people_errors += 1
            continue
        if not fun_wish:
            summary.rows.append(RowResult(row_num, "person", "error", "Missing 'fun_wish'"))
            summary.people_errors += 1
            continue

        try:
            age = int(age_raw)
        except ValueError:
            summary.rows.append(RowResult(row_num, "person", "error", f"Invalid age: {age_raw}"))
            summary.people_errors += 1
            continue

        # Resolve family (try integer id first, then name)
        family_id = _resolve_family_id(family_name_or_id, db)
        if family_id is None:
            summary.rows.append(RowResult(row_num, "person", "error", f"Family '{family_name_or_id}' not found"))
            summary.people_errors += 1
            continue

        # Skip if a person with the same family_id, given_name, and age already exists
        existing = _find_person(db, family_id, given_name, age)
        if existing:
            summary.rows.append(
                RowResult(
                    row_num,
                    "person",
                    "skipped",
                    f"Person '{given_name}' (age {age}) already exists in family (id={existing.id})",
                )
            )
            summary.people_skipped += 1
            continue

        per = Person(
            family_id=family_id,
            given_name=given_name,
            age=age,
            practical_wish=practical_wish,
            fun_wish=fun_wish,
            title=rec.get("title", "").strip() or None,
            note=rec.get("note", "").strip() or None,
        )
        db.add(per)
        db.flush()
        db.refresh(per)
        summary.rows.append(RowResult(row_num, "person", "created", f"Person '{given_name}' created (id={per.id})", per.id))
        summary.people_created += 1


def _process_users(
    db: Session,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
) -> None:
    """Create users from CSV records."""
    ROLE_MAP = {"admin": UserRole.admin, "referrer": UserRole.referrer, "family": UserRole.family}

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
            summary.rows.append(RowResult(row_num, "user", "error", f"Invalid role: {role_str} (must be admin, referrer, or family)"))
            summary.users_errors += 1
            continue

        # Skip if email already exists
        existing = _find_user_by_email(db, email)
        if existing:
            summary.rows.append(RowResult(row_num, "user", "skipped", f"User '{email}' already exists (id={existing.id})"))
            summary.users_skipped += 1
            continue

        # Resolve foreign keys (always — needed even to detect bad admin refs)
        referrer_id = _resolve_ref_id(referrer_ref, db) if referrer_ref else None
        family_id = _resolve_family_id(family_ref, db) if family_ref else None

        # Validate role constraints
        if role == UserRole.admin:
            if referrer_id or family_id:
                summary.rows.append(RowResult(row_num, "user", "error", "Admin users cannot have referrer_id or family_id"))
                summary.users_errors += 1
                continue
        elif role == UserRole.referrer:
            if referrer_id is None:
                summary.rows.append(RowResult(row_num, "user", "error", "Referrer users must have a referrer_name_or_id"))
                summary.users_errors += 1
                continue
            if family_id is not None:
                summary.rows.append(RowResult(row_num, "user", "error", "Referrer users cannot have a family_name_or_id"))
                summary.users_errors += 1
                continue
        elif role == UserRole.family:
            if family_id is None:
                summary.rows.append(RowResult(row_num, "user", "error", "Family users must have a family_name_or_id"))
                summary.users_errors += 1
                continue
            if referrer_id is not None:
                summary.rows.append(RowResult(row_num, "user", "error", "Family users cannot have a referrer_name_or_id"))
                summary.users_errors += 1
                continue

        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            role=role,
            referrer_id=referrer_id,
            family_id=family_id,
            is_active=True,
        )
        db.add(user)
        db.flush()
        db.refresh(user)
        summary.rows.append(RowResult(row_num, "user", "created", f"User '{email}' created (id={user.id})", user.id))
        summary.users_created += 1


# ---------------------------------------------------------------------------
# Public entry-point
# ---------------------------------------------------------------------------

def import_csv(db: Session, csv_text: str) -> ImportSummary:
    """Parse and import a CSV string into the database.

    Returns an ``ImportSummary`` with counts and per-row results.
    """
    sections = _parse_sections(csv_text)
    summary = ImportSummary()

    # Track row offsets for accurate row numbering
    # We need to compute where each section's data rows start in the original file.
    # For simplicity we just number them sequentially within the section.
    row_offset = 0

    # Process in dependency order
    for section_name in ("referrers", "families", "people", "users"):
        section_rows = sections.get(section_name)
        if not section_rows:
            continue

        headers, records = _rows_to_dicts(section_rows)
        if not records:
            continue

        processor = {
            "referrers": _process_referrers,
            "families": _process_families,
            "people": _process_people,
            "users": _process_users,
        }[section_name]

        processor(db, records, row_offset + 1, summary)
        row_offset += len(section_rows)  # header + data rows

    db.commit()
    return summary
