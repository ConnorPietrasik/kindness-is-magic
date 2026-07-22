"""Shared fixtures for the kindness-is-magic backend test suite.

Uses a dedicated Postgres test container (test_db in docker-compose.yml)
with transaction rollback for fast, isolated test runs.

Run with:
    ./run-compose.sh up test_db   # start the test DB
    ./run-compose.sh run test      # run the tests
"""

import os
import sys
from collections.abc import Generator
from typing import Any
from urllib.parse import urlparse, urlunparse

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

# ---------------------------------------------------------------------------
# Ensure the app package is importable from the test directory
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# Suppress email sending in tests (set before any app imports)
# ---------------------------------------------------------------------------
os.environ.setdefault("SUPPRESS_SEND", "1")

# ---------------------------------------------------------------------------
# Postgres test engine (connects to the test_db docker service)
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://KindDB:testpassword@test_db:5432/kindness_is_magic_test",
)


def _get_worker_schema():
    """Return a per-worker schema name when running under xdist, else None."""
    worker_id = os.environ.get("PYTEST_XDIST_WORKER")
    if worker_id:
        return f"test_{worker_id}"
    return None


_engine_schema = _get_worker_schema()

engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)

# Use event listener to set search_path on every connection so xdist
# workers each operate on their own schema and don't collide on unique
# constraints.
if _engine_schema:
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute(f'SET search_path TO "{_engine_schema}"')
        cursor.close()

    # Pre-create the schema so the first connection doesn't fail
    with engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{_engine_schema}"'))
        conn.commit()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _ensure_test_db_exists():
    """Create the test database if it does not already exist.

    Connects to the default 'postgres' database on the same server to
    check / create the target database.
    """
    parsed = urlparse(TEST_DATABASE_URL)
    db_name = parsed.path.lstrip("/")

    # Build an admin URL pointing to the 'postgres' default database
    admin_parsed = parsed._replace(path="/postgres")
    admin_url = urlunparse(admin_parsed)

    admin_engine = create_engine(admin_url)
    try:
        with admin_engine.connect() as conn:
            # Check if database exists
            result = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :dbname"),
                {"dbname": db_name},
            ).fetchone()
            if not result:
                conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    finally:
        admin_engine.dispose()


# Ensure the test database exists at import time
# (wrapped so import doesn't crash if DB is not yet reachable —
#  the _setup_test_schema fixture will fail with a clear error instead)
try:
    _ensure_test_db_exists()
except Exception:  # noqa: BLE001
    pass  # will fail later at fixture time with a clearer error


@pytest.fixture(autouse=True)
def _env_isolation(monkeypatch: pytest.MonkeyPatch):
    """Strip env vars that would leak real credentials / production DB."""
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.setenv("DEBUG", "true")
    # Ensure our test DATABASE_URL and secrets are set
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-do-not-use-in-production-aaaabbbbccccdddd")
    monkeypatch.setenv("REFRESH_SECRET_KEY", "test-refresh-secret-key-do-not-use-in-production-aaaabbbbccccdddd")


@pytest.fixture(scope="session")
def _setup_test_schema() -> Generator[None, None, None]:
    """Create all tables and seed required data once at the start of the test
    session, then tear everything down at the end.

    When running under xdist, each worker gets its own schema (set via
    search_path) so parallel tests don't collide on unique constraints.
    """
    from app.models import Base
    from app import models  # noqa: F401 — register all model metadata

    Base.metadata.create_all(bind=engine)

    yield

    Base.metadata.drop_all(bind=engine)
    # Drop the per-worker schema if we created one
    if _engine_schema:
        with engine.connect() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{_engine_schema}" CASCADE'))
            conn.commit()


@pytest.fixture()
def db(_setup_test_schema: None) -> Generator[Session, Any, None]:
    """Yield a database session wrapped in a transaction that rolls back after each test.

    Uses a savepoint (nested transaction) so that ``db.commit()`` in seed
    fixtures works correctly — the savepoint is committed, but the outer
    transaction is rolled back, leaving the next test with a clean DB.
    """
    connection = engine.connect()
    transaction = connection.begin()
    # Savepoint lets individual commits work inside the outer transaction
    connection.begin_nested()

    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


# ---------------------------------------------------------------------------
# Override get_db so every route hit during tests uses the test DB
# ---------------------------------------------------------------------------


@pytest.fixture()
def test_client(db: Session) -> Generator[Any, Any, None]:
    """Yield a synchronous TestClient bound to the Postgres test DB.

    Patches both database.get_db (used by route handlers) and
    SessionLocal (used directly by mail.py) so that all database
    access goes through the test session.
    """
    from app.main import app
    from app import database
    import app.mail as mail_module

    # Patch the DB dependency at the module level

    def _override_get_db() -> Generator[Session, Any, None]:
        yield db

    app.dependency_overrides[database.get_db] = _override_get_db

    # Patch SessionLocal in both database.py and mail.py (mail imports
    # its own copy at module level).
    _original_db_session_local = database.SessionLocal
    _original_mail_session_local = mail_module.SessionLocal

    def _test_session_local(**kwargs):
        return db

    database.SessionLocal = _test_session_local  # type: ignore[assignment]
    mail_module.SessionLocal = _test_session_local  # type: ignore[assignment]

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    database.SessionLocal = _original_db_session_local  # type: ignore[assignment]
    mail_module.SessionLocal = _original_mail_session_local  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Helper: create seed data for auth testing
# ---------------------------------------------------------------------------


@pytest.fixture()
def admin_user(db: Session):
    """Create a bootstrap admin user and return it."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="admin@test.com",
        hashed_password=get_password_hash("AdminPass123!"),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def referrer_record(db: Session):
    """Create a Referrer row in the DB."""
    from app.models import Referrer

    r = Referrer(name="Test Referrer", family_limit=10, phone_number="555-0001")
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture()
def referrer_user(db: Session, referrer_record):
    """Create a referrer-role User linked to the Referrer record."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="referrer@test.com",
        hashed_password=get_password_hash("RefPass1234!"),
        role=UserRole.referrer,
        referrer_id=referrer_record.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def family_record(db: Session):
    """Create a Family row."""
    from app.models import Family, FamilyApprovalStatus

    f = Family(
        family_name="TestFamily",
        family_wish="World peace",
        contact_name="Contact Person",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@pytest.fixture()
def family_user(db: Session, family_record):
    """Create a family-role User linked to the Family record."""
    from app.models import User, UserRole
    from app.auth import get_password_hash

    user = User(
        email="family@test.com",
        hashed_password=get_password_hash("FamPass1234!"),
        role=UserRole.family,
        family_id=family_record.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Helper: log in as a user and return the response JSON
# ---------------------------------------------------------------------------


def login_as(client: Any, email: str, password: str) -> dict:
    """POST to /api/auth/login and return the response JSON."""
    return client.post("/api/auth/login", json={"email": email, "password": password}).json()


# ---------------------------------------------------------------------------
# Phase 1 fixtures — Referrer + Family + Person trees for admin CRUD tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def referrer_with_families(db: Session, referrer_record):
    """Create a Referrer with 1-2 Family rows."""
    from app.models import Family, FamilyApprovalStatus

    f1 = Family(
        referrer_id=referrer_record.id,
        family_name="Smith Family",
        family_wish="A new roof",
        contact_name="Jane Smith",
        approval_status=FamilyApprovalStatus.approved,
    )
    f2 = Family(
        referrer_id=referrer_record.id,
        family_name="Jones Family",
        family_wish="Warm clothes",
        contact_name="Bob Jones",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add_all([f1, f2])
    db.commit()
    db.refresh(f1)
    db.refresh(f2)
    return {"referrer": referrer_record, "families": [f1, f2]}


@pytest.fixture()
def family_with_people(db: Session, family_record):
    """Create a Family with 1-2 Person rows."""
    from app.models import Person

    p1 = Person(
        family_id=family_record.id,
        given_name="Alice",
        age=8,
        practical_wish="A backpack",
        fun_wish="A doll",
    )
    p2 = Person(
        family_id=family_record.id,
        given_name="Charlie",
        age=12,
        practical_wish="New shoes",
        fun_wish="A football",
    )
    db.add_all([p1, p2])
    db.commit()
    db.refresh(p1)
    db.refresh(p2)
    return {"family": family_record, "people": [p1, p2]}


# ---------------------------------------------------------------------------
# Phase 3 fixtures — Self-service trees for referrer/family ownership tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def referrer_with_full_tree(db: Session):
    """Referrer with 1 Family + 1 Person, plus a referrer-role User.

    Returns a dict with keys: referrer, family, person, user.
    """
    from app.models import FamilyApprovalStatus, Family, Person, Referrer, User, UserRole
    from app.auth import get_password_hash

    ref = Referrer(name="Tree Referrer", family_limit=5, phone_number="555-1000")
    db.add(ref)
    db.commit()
    db.refresh(ref)

    fam = Family(
        referrer_id=ref.id,
        family_name="Tree Family",
        family_wish="A new home",
        contact_name="Tree Contact",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    person = Person(
        family_id=fam.id,
        given_name="Tree Person",
        age=10,
        practical_wish="A bike",
        fun_wish="A game",
    )
    db.add(person)
    db.commit()
    db.refresh(person)

    user = User(
        email="tree_referrer@test.com",
        hashed_password=get_password_hash("TreeRef1234!"),
        role=UserRole.referrer,
        referrer_id=ref.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"referrer": ref, "family": fam, "person": person, "user": user}


@pytest.fixture()
def another_referrer(db: Session):
    """Second Referrer + referrer-role User (for 403 cross-referrer tests).

    Returns a dict with keys: referrer, user.
    """
    from app.models import Referrer, User, UserRole
    from app.auth import get_password_hash

    ref = Referrer(name="Another Referrer", family_limit=5, phone_number="555-2000")
    db.add(ref)
    db.commit()
    db.refresh(ref)

    user = User(
        email="another_referrer@test.com",
        hashed_password=get_password_hash("AnotherRef1234!"),
        role=UserRole.referrer,
        referrer_id=ref.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"referrer": ref, "user": user}


@pytest.fixture()
def another_family(db: Session, referrer_record):
    """Second Family + family-role User (for 403 cross-family tests).

    Returns a dict with keys: family, user.
    """
    from app.models import Family, FamilyApprovalStatus, User, UserRole
    from app.auth import get_password_hash

    fam = Family(
        referrer_id=referrer_record.id,
        family_name="Another Family",
        family_wish="A computer",
        contact_name="Another Contact",
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)

    user = User(
        email="another_family@test.com",
        hashed_password=get_password_hash("AnotherFam1234!"),
        role=UserRole.family,
        family_id=fam.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"family": fam, "user": user}


@pytest.fixture()
def person_in_another_family(db: Session, another_family):
    """Person in another_family (for 403 cross-family person tests).

    Returns a dict with keys: family, person.
    """
    from app.models import Person

    fam = another_family["family"]
    person = Person(
        family_id=fam.id,
        given_name="Another Person",
        age=7,
        practical_wish="A jacket",
        fun_wish="A toy",
    )
    db.add(person)
    db.commit()
    db.refresh(person)

    return {"family": fam, "person": person}
