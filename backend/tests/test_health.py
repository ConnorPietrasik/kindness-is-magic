"""Tests for the health-check endpoint."""

from fastapi.testclient import TestClient


def test_health_check(test_client: TestClient):
    resp = test_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
