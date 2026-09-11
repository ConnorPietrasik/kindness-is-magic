"""Tests for the one-shot leader lock that guards lifespan side effects.

With `uvicorn --workers N` the app lifespan runs once per worker process, so
the bootstrap seed and the daily deadline-check task must run in exactly one
worker. main._try_acquire_leader_lock() elects a leader via a non-blocking
flock on a container-local file.

conftest's autouse _env_isolation points LIFESPAN_LOCK_PATH at a unique
per-test file, so ordinary tests always become the leader (the bootstrap
tests cover the leader path). Here we cover the lock semantics and the
non-leader code path.
"""

import fcntl
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import database
from app import main as main_module
from app.models import User

NON_LEADER_EMAIL = "non-leader@test.com"
NON_LEADER_PASSWORD = "NonLeaderPass123!"


class TestLeaderLock:
    def test_lock_is_exclusive_until_released(self, monkeypatch: pytest.MonkeyPatch, tmp_path):
        monkeypatch.setenv("LIFESPAN_LOCK_PATH", str(tmp_path / "leader.lock"))

        fd1 = main_module._try_acquire_leader_lock()
        assert fd1 is not None
        try:
            # A second "worker" cannot acquire while the first holds it.
            assert main_module._try_acquire_leader_lock() is None
        finally:
            os.close(fd1)  # releases the flock

        # Re-acquirable once released.
        fd2 = main_module._try_acquire_leader_lock()
        assert fd2 is not None
        os.close(fd2)

    @pytest.fixture()
    def non_leader_client(self, db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path):
        """TestClient whose lifespan finds the leader lock already held."""
        monkeypatch.setenv("ADMIN_EMAIL", NON_LEADER_EMAIL)
        monkeypatch.setenv("ADMIN_PASSWORD", NON_LEADER_PASSWORD)

        lock_path = tmp_path / "held.lock"
        monkeypatch.setenv("LIFESPAN_LOCK_PATH", str(lock_path))
        holder_fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
        fcntl.flock(holder_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

        # Same DB wiring as test_bootstrap_admin.bootstrap_client: the
        # lifespan calls next(get_db()) and the patched SessionLocal, so it
        # must use the test session.
        from app.main import app

        def _override_get_db():
            yield db

        app.dependency_overrides[database.get_db] = _override_get_db
        original_session_local = database.SessionLocal

        def _test_session_local(**kwargs):
            return db

        database.SessionLocal = _test_session_local  # type: ignore[assignment]

        try:
            with TestClient(app) as client:
                yield client
        finally:
            app.dependency_overrides.clear()
            database.SessionLocal = original_session_local  # type: ignore[assignment]
            fcntl.flock(holder_fd, fcntl.LOCK_UN)
            os.close(holder_fd)

    def test_non_leader_skips_seed_but_serves(self, non_leader_client: TestClient, db: Session):
        # ADMIN_EMAIL/ADMIN_PASSWORD are set, but the lock is held elsewhere
        # → no seed, and the app still serves.
        users = db.query(User).filter(User.email == NON_LEADER_EMAIL).all()
        assert users == []
        assert non_leader_client.get("/api/health").status_code == 200
