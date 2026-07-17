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
import dataclasses

from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.models import Family, Person, Referrer, User, UserRole
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
# Field schema definitions
# ---------------------------------------------------------------------------


@dataclass
class FieldDef:
    """Schema for a single CSV column."""

    name: str
    key: str = ""  # internal key in resolved dict; defaults to name if empty
    required: bool = True
    sanitize: bool = True
    converter: callable = None  # e.g., int for family_limit, age
    resolver: callable = None  # e.g., _resolve_ref_id for FK lookups


# ---------------------------------------------------------------------------
# Model-introspection helper — derive FieldDefs from SQLAlchemy columns
# ---------------------------------------------------------------------------

# Columns that are managed by the framework, never imported from CSV
_SKIP_COLUMNS = {"id", "deleted_at", "created_at"}


def _build_fields(
    model: type,
    *,
    csv_name_map: dict[str, str] | None = None,
    fk_resolvers: dict[str, callable] | None = None,
    converters: dict[str, callable] | None = None,
    optional: set[str] | None = None,
    skip: set[str] | None = None,
) -> list[FieldDef]:
    """Build a list of FieldDefs by introspecting *model* columns.

    System columns (``id``, ``deleted_at``, ``created_at``) are always
    skipped.  Additional columns can be excluded via ``skip``.

    Parameters
    ----------
    csv_name_map:
        Map model column name → CSV header name (when they differ).
    fk_resolvers:
        Map model FK column name → resolver callable.
    converters:
        Map model column name → type converter (e.g. ``int``).
    optional:
        Extra column names that should be treated as optional even if the
        model column is ``nullable=False``.
    skip:
        Extra column names to exclude beyond the default system columns.
    """
    csv_name_map = csv_name_map or {}
    fk_resolvers = fk_resolvers or {}
    converters = converters or {}
    optional = optional or set()
    extra_skip = (skip or set()) | _SKIP_COLUMNS

    fields: list[FieldDef] = []
    for col in model.__table__.columns:  # type: ignore[union-attr]
        colname = col.name
        if colname in extra_skip:
            continue

        is_fk = col.foreign_keys is not None and len(col.foreign_keys) > 0
        is_string = hasattr(col.type, "length")

        fields.append(
            FieldDef(
                name=csv_name_map.get(colname, colname),
                key=colname,
                required=col.nullable is False and colname not in optional,
                sanitize=is_string and not is_fk,
                converter=converters.get(colname),
                resolver=fk_resolvers.get(colname),
            )
        )
    return fields


# Entity field schemas — derived from models, with CSV-specific overrides.

REFERRER_FIELDS: list[FieldDef] = _build_fields(
    Referrer,
    optional={"phone_number"},
)

FAMILY_FIELDS: list[FieldDef] = _build_fields(
    Family,
    csv_name_map={"referrer_id": "referrer_name"},
    fk_resolvers={"referrer_id": _resolve_ref_id},
    optional={"bio", "address", "phone_number", "referrer_id"},
)

PERSON_FIELDS: list[FieldDef] = _build_fields(
    Person,
    csv_name_map={"family_id": "family_name"},
    fk_resolvers={"family_id": _resolve_family_id},
    converters={"age": int},
    optional={"title", "note"},
)


@dataclass
class EntitySchema:
    """Ties a CSV section to its entity class and dedup logic."""

    section_name: str
    entity_type: str  # singular, for RowResult
    summary_prefix: str  # e.g. "families", "people" — prefix for ImportSummary attrs
    entity_cls: type
    fields: list[FieldDef]
    find_existing: callable  # (db, **resolved_values) -> existing entity or None
    display_name_field: str  # field used in "created" / "skipped" messages
    create_kwargs: callable  # (resolved_values) -> dict for entity constructor


# ---------------------------------------------------------------------------
# Generic section processor
# ---------------------------------------------------------------------------


def _process_field(
    rec: dict[str, str],
    fld: FieldDef,
    db: Session,
) -> tuple[str | None, str | None]:
    """Process a single field: extract, validate, convert, resolve.

    Returns ``(value, error_message)``.  If error_message is not None the
    caller should abort the row.  If the field is optional and missing,
    value is None.
    """
    raw = rec.get(fld.name, "").strip()

    # Handle missing optional fields
    if not raw:
        if fld.required:
            return None, f"Missing '{fld.name}'"
        return None, None

    # Sanitize (text fields only — skip if converter will handle it)
    if fld.sanitize:
        try:
            raw = sanitize_plain_text(raw)
        except ValueError as exc:
            return None, f"{fld.name}: {exc}"

    # Convert (e.g. int)
    if fld.converter is not None:
        try:
            raw = fld.converter(raw)
        except (ValueError, TypeError):
            return None, f"Invalid {fld.name}: {raw}"

    # Resolve FK lookups
    if fld.resolver is not None:
        resolved = fld.resolver(raw, db)
        if resolved is None:
            return (
                None,
                f"{fld.name.replace('_', ' ').title()} '{rec.get(fld.name, '').strip()}' not found",
            )
        return resolved, None

    return raw, None


def _process_section(
    db: Session,
    schema: EntitySchema,
    records: list[dict[str, str]],
    base_row: int,
    summary: ImportSummary,
    dry_run: bool = False,
) -> None:
    """Generic processor for referrers, families, and people."""

    entity_type = schema.entity_type
    prefix = schema.summary_prefix
    summary_attr_created = f"{prefix}_created"
    summary_attr_skipped = f"{prefix}_skipped"
    summary_attr_errors = f"{prefix}_errors"

    for i, rec in enumerate(records):
        row_num = base_row + i

        # --- Phase 1: process all fields ---
        resolved: dict[str, object] = {}
        errors: list[str] = []

        for fld in schema.fields:
            value, err = _process_field(rec, fld, db)
            if err is not None:
                errors.append(err)
                continue
            resolved[fld.key or fld.name] = value

        if errors:
            for err in errors:
                summary.rows.append(RowResult(row_num, entity_type, "error", err))
            setattr(
                summary,
                summary_attr_errors,
                getattr(summary, summary_attr_errors) + len(errors),
            )
            continue

        # --- Phase 2: skip if already exists ---
        existing = schema.find_existing(db, **resolved)
        if existing:
            display = resolved[schema.display_name_field]
            summary.rows.append(
                RowResult(
                    row_num,
                    entity_type,
                    "skipped",
                    f"{schema.entity_cls.__name__} '{display}' already exists (id={existing.id})",
                )
            )
            setattr(
                summary,
                summary_attr_skipped,
                getattr(summary, summary_attr_skipped) + 1,
            )
            continue

        # --- Phase 3: create entity ---
        kwargs = schema.create_kwargs(resolved)
        entity = schema.entity_cls(**kwargs)
        db.add(entity)
        db.flush()
        db.refresh(entity)

        display = resolved[schema.display_name_field]
        summary.rows.append(
            RowResult(
                row_num,
                entity_type,
                "created" if not dry_run else "would_create",
                f"{schema.entity_cls.__name__} '{display}' {'created' if not dry_run else 'would be created'} (id={entity.id})",
                entity.id,
            )
        )
        setattr(summary, summary_attr_created, getattr(summary, summary_attr_created) + 1)


# ---------------------------------------------------------------------------
# Entity schema registrations
# ---------------------------------------------------------------------------


def _find_existing_referrer(db: Session, name: str, **_kw) -> Referrer | None:
    return _find_referrer(db, name)


def _find_existing_family(db: Session, family_name: str, **_kw) -> Family | None:
    return _find_family(db, family_name)


def _find_existing_person(db: Session, family_id: int, given_name: str, age: int, **_kw) -> Person | None:
    return _find_person(db, family_id, given_name, age)


def _referrer_kwargs(resolved: dict) -> dict:
    return {
        "name": resolved["name"],
        "family_limit": resolved["family_limit"],
        "phone_number": resolved.get("phone_number") or "",
    }


def _family_kwargs(resolved: dict) -> dict:
    return {
        "referrer_id": resolved.get("referrer_id"),
        "family_name": resolved["family_name"],
        "family_wish": resolved["family_wish"],
        "contact_name": resolved["contact_name"],
        "bio": resolved.get("bio"),
        "address": resolved.get("address"),
        "phone_number": resolved.get("phone_number"),
    }


def _person_kwargs(resolved: dict) -> dict:
    return {
        "family_id": resolved["family_id"],
        "given_name": resolved["given_name"],
        "age": resolved["age"],
        "practical_wish": resolved["practical_wish"],
        "fun_wish": resolved["fun_wish"],
        "title": resolved.get("title"),
        "note": resolved.get("note"),
    }


REFERRER_SCHEMA = EntitySchema(
    section_name="referrers",
    entity_type="referrer",
    summary_prefix="referrers",
    entity_cls=Referrer,
    fields=REFERRER_FIELDS,
    find_existing=_find_existing_referrer,
    display_name_field="name",
    create_kwargs=_referrer_kwargs,
)

FAMILY_SCHEMA = EntitySchema(
    section_name="families",
    entity_type="family",
    summary_prefix="families",
    entity_cls=Family,
    fields=FAMILY_FIELDS,
    find_existing=_find_existing_family,
    display_name_field="family_name",
    create_kwargs=_family_kwargs,
)

PERSON_SCHEMA = EntitySchema(
    section_name="people",
    entity_type="person",
    summary_prefix="people",
    entity_cls=Person,
    fields=PERSON_FIELDS,
    find_existing=_find_existing_person,
    display_name_field="given_name",
    create_kwargs=_person_kwargs,
)

# Map section names to schemas (for the generic dispatch loop)
_GENERIC_SCHEMAS: dict[str, EntitySchema] = {
    "referrers": REFERRER_SCHEMA,
    "families": FAMILY_SCHEMA,
    "people": PERSON_SCHEMA,
}


# ---------------------------------------------------------------------------
# User processor — kept separate due to bcrypt hashing and role logic
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
                    f"Invalid role: {role_str} (must be admin, referrer, or family)",
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
                "Family users must not have a referrer_id": "Family users cannot have a referrer_name_or_id",
            }
            for err in role_errors:
                summary.rows.append(RowResult(row_num, "user", "error", friendly.get(err, err)))
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

        headers, records = _rows_to_dicts(section_rows)
        if not records:
            continue

        if section_name in _GENERIC_SCHEMAS:
            _process_section(
                db,
                _GENERIC_SCHEMAS[section_name],
                records,
                row_offset + 1,
                summary,
                dry_run=dry_run,
            )
        elif section_name == "users":
            _process_users(db, records, row_offset + 1, summary, dry_run=dry_run)

        row_offset += len(section_rows)  # header + data rows

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return summary
