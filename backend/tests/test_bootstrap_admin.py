"""Tests for the bootstrap admin seeding in the app lifespan (main.py).

conftest's autouse _env_isolation strips ADMIN_EMAIL/ADMIN_PASSWORD, so the
seeding branch is normally dead code in tests. The bootstrap_client fixture
below sets the env vars *before* entering the TestClient context, so the
lifespan actually runs the seed for these tests.

Covers:
- admin created from ADMIN_EMAIL/ADMIN_PASSWORD (email stripped + lowercased,
  role admin, derived display name, login works with the env password)
- idempotency: an existing user with the same email is left untouched
  (password and display name not clobbered, no duplicate row)
- no env vars → no user created
- DB error during startup → seed skipped, app still starts
"""

import pytest
import sqlalchemy.exc
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import database, main as main_module
from app.auth import get_password_hash
from app.models import User, UserRole
from tests.conftest import login_as

BOOTSTRAP_EMAIL = "bootstrap@test.com"
# Sent through the env var with padding + mixed case: the lifespan must
# strip and lowercase it before using it.
BOOTSTRAP_EMAIL_ENV = f" {BOOTSTRAP_EMAIL.upper()} "
BOOTSTRAP_PASSWORD = "BootstrapPass123!"
PREEXISTING_PASSWORD = "ExistingPass123!"


@pytest.fixture()
def bootstrap_client(db: Session, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest):
    """TestClient whose lifespan runs with the given bootstrap variant.

    Variants (via indirect parametrize):
    - "seed":         ADMIN_EMAIL/ADMIN_PASSWORD set, empty DB
    - "no_env":       env vars unset (autouse _env_isolation strips them)
    - "preexisting":  env vars set, a user with the same email already exists
    - "broken_db":    env vars set, get_db raises OperationalError
    """
    variant = request.param

    if variant != "no_env":
        monkeypatch.setenv("ADMIN_EMAIL", BOOTSTRAP_EMAIL_ENV)
        monkeypatch.setenv("ADMIN_PASSWORD", BOOTSTRAP_PASSWORD)

    if variant == "preexisting":
        existing = User(
            email=BOOTSTRAP_EMAIL,
            hashed_password=get_password_hash(PREEXISTING_PASSWORD),
            role=UserRole.admin,
            display_name="KeepMe",
        )
        db.add(existing)
        db.commit()
        db.refresh(existing)

    if variant == "broken_db":

        def _boom():
            raise sqlalchemy.exc.OperationalError("SELECT 1", {}, Exception("db down"))

        monkeypatch.setattr(main_module, "get_db", _boom)

    # Same DB wiring as conftest.test_client (the lifespan calls next(get_db())
    # and patched SessionLocal, so it must use the test session).
    from app.main import app

    def _override_get_db():
        yield db

    app.dependency_overrides[database.get_db] = _override_get_db
    original_session_local = database.SessionLocal

    def _test_session_local(**kwargs):
        return db

    database.SessionLocal = _test_session_local  # type: ignore[assignment]

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    database.SessionLocal = original_session_local  # type: ignore[assignment]


def _users_with_email(db: Session) -> list[User]:
    return db.query(User).filter(User.email == BOOTSTRAP_EMAIL).all()


class TestBootstrapSeeding:
    @pytest.mark.parametrize("bootstrap_client", ["seed"], indirect=True)
    def test_creates_admin_from_env(self, bootstrap_client: TestClient, db: Session):
        users = _users_with_email(db)
        assert len(users) == 1
        admin = users[0]
        assert admin.email == BOOTSTRAP_EMAIL  # stripped + lowercased
        assert admin.role == UserRole.admin
        assert admin.display_name == "Bootstrap"
        assert admin.referrer_id is None
        assert admin.family_id is None

        # The env password must actually work — the hash round-trips.
        resp = login_as(bootstrap_client, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD)
        assert resp["user"]["email"] == BOOTSTRAP_EMAIL

    @pytest.mark.parametrize("bootstrap_client", ["no_env"], indirect=True)
    def test_no_seed_without_env(self, bootstrap_client: TestClient, db: Session):
        assert _users_with_email(db) == []
        assert bootstrap_client.get("/api/health").status_code == 200

    @pytest.mark.parametrize("bootstrap_client", ["preexisting"], indirect=True)
    def test_existing_user_not_clobbered(self, bootstrap_client: TestClient, db: Session):
        users = _users_with_email(db)
        assert len(users) == 1  # no duplicate row
        assert users[0].display_name == "KeepMe"  # not overwritten

        # Old password still works; the env password must NOT.
        resp = login_as(bootstrap_client, BOOTSTRAP_EMAIL, PREEXISTING_PASSWORD)
        assert resp["user"]["email"] == BOOTSTRAP_EMAIL
        resp = bootstrap_client.post("/api/auth/login", json={"email": BOOTSTRAP_EMAIL, "password": BOOTSTRAP_PASSWORD})
        assert resp.status_code == 401

    @pytest.mark.parametrize("bootstrap_client", ["broken_db"], indirect=True)
    def test_db_error_skips_seed_without_crashing(self, bootstrap_client: TestClient, db: Session):
        # Lifespan swallows the DB error (warning) and the app still serves.
        assert bootstrap_client.get("/api/health").status_code == 200
        assert _users_with_email(db) == []
