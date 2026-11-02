"""Tests for the health-check endpoint."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import database
from app.main import app


def test_health_check(test_client: TestClient):
    resp = test_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_check_returns_500_when_db_is_unreachable(test_client: TestClient, monkeypatch):
    # Override the db dependency with a session bound to a dead address so
    # the endpoint's SELECT 1 fails (the test_client fixture's own override
    # would otherwise always yield a live session).
    dead_engine = create_engine("postgresql+psycopg://nobody:nothing@127.0.0.1:1/none")
    dead_sessions = sessionmaker(autocommit=False, autoflush=False, bind=dead_engine)

    def _dead_get_db():
        db = dead_sessions()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setitem(app.dependency_overrides, database.get_db, _dead_get_db)
    resp = test_client.get("/api/health")
    assert resp.status_code == 500
    dead_engine.dispose()
