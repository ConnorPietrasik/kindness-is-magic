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
# Postgres test engine (connects to the test_db docker service)
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://KindDB:testpassword@test_db:5432/kindness_is_magic_test",
)

engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
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
    monkeypatch.setenv("COOKIE_SECURE", "false")
    # Ensure our test DATABASE_URL and secrets are set
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-do-not-use")
    monkeypatch.setenv("REFRESH_SECRET_KEY", "test-refresh-secret-key-do-not-use")


@pytest.fixture(scope="session")
def _setup_test_schema() -> Generator[None, None, None]:
    """Create all tables and seed required data once at the start of the test
    session, then tear everything down at the end."""
    from app.models import Base, Referrer, Family
    from app import models  # noqa: F401 — register all model metadata

    Base.metadata.create_all(bind=engine)

    # Seed the orphan referrer that Family rows depend on (FK default = id 1)
    session = TestingSessionLocal()
    try:
        session.add(
            Referrer(
                id=Family.ORPHAN_REFERRER_ID,
                name="Orphan",
                family_limit=0,
                phone_number="000-0000",
            )
        )
        session.commit()
        # Advance the sequence so next auto-generated id doesn't collide
        session.execute(text("SELECT setval('referrer_id_seq', 1, true)"))
        session.commit()
    finally:
        session.close()

    yield

    Base.metadata.drop_all(bind=engine)


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
    """Yield a synchronous TestClient bound to the Postgres test DB."""
    from app.main import app
    from app import database

    # Patch the DB dependency at the module level
    original_get_db = database.get_db

    def _override_get_db() -> Generator[Session, Any, None]:
        yield db

    app.dependency_overrides[database.get_db] = _override_get_db

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


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
    from app.models import Family

    f = Family(
        referrer_id=Family.ORPHAN_REFERRER_ID,
        family_name="TestFamily",
        family_wish="World peace",
        contact_name="Contact Person",
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
