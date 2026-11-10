"""Tests for pool auto-sizing (app/database.py::_detect_pool_settings).

The one-off probe engine is faked, so no live DB is needed: the behavior
under test is the clamp math (per-worker budget of
(max_connections - 1) // APP_WORKERS), the DB_POOL_SIZE / DB_MAX_OVERFLOW
overrides, and the loud startup failure on a bad APP_WORKERS.
"""

import contextlib
import os

import pytest

from app import database

TEST_URL = "postgresql+psycopg://nobody:nopass@nowhere:5432/none"


class _FakeConn:
    def __init__(self, max_connections: int):
        self._max_connections = max_connections

    def exec_driver_sql(self, _sql: str):
        return self

    def scalar_one(self) -> int:
        return self._max_connections


class _FakeProbe:
    """Stands in for the probe engine: yields one connection whose
    SHOW max_connections answer is fixed; None makes connect() fail."""

    def __init__(self, max_connections: int | None):
        self._max_connections = max_connections
        self.disposed = False

    @contextlib.contextmanager
    def connect(self):
        if self._max_connections is None:
            raise ConnectionRefusedError("no database")
        yield _FakeConn(self._max_connections)

    def dispose(self):
        self.disposed = True


def _detect(
    monkeypatch: pytest.MonkeyPatch,
    *,
    max_connections: int | None,
    workers: str | None,
    cores: int = 8,
    **overrides: str,
) -> tuple[int, int, _FakeProbe]:
    """Run _detect_pool_settings against a faked probe and cpu_count.

    workers=None leaves APP_WORKERS unset; **overrides sets extra env vars
    (e.g. DB_POOL_SIZE), both pool overrides are cleared otherwise.
    """
    probe = _FakeProbe(max_connections)
    monkeypatch.setattr(database, "create_engine", lambda *args, **kwargs: probe)
    monkeypatch.setattr(os, "cpu_count", lambda: cores)
    if workers is None:
        monkeypatch.delenv("APP_WORKERS", raising=False)
    else:
        monkeypatch.setenv("APP_WORKERS", workers)
    monkeypatch.delenv("DB_POOL_SIZE", raising=False)
    monkeypatch.delenv("DB_MAX_OVERFLOW", raising=False)
    for name, value in overrides.items():
        monkeypatch.setenv(name, value)
    pool_size, max_overflow = database._detect_pool_settings(TEST_URL)
    return pool_size, max_overflow, probe


class TestPerWorkerBudget:
    def test_no_clamp_when_headroom_plenty(self, monkeypatch: pytest.MonkeyPatch):
        # 4 cores -> pool 8 + overflow 8; 2 workers, 100 conns -> budget 49.
        pool_size, max_overflow, probe = _detect(monkeypatch, max_connections=100, workers="2", cores=4)
        assert (pool_size, max_overflow) == (8, 8)
        assert probe.disposed  # probe engine cleaned up

    def test_overflow_clamped_to_budget(self, monkeypatch: pytest.MonkeyPatch):
        # 8 cores -> pool 16 + overflow 16; 2 workers, 50 conns -> budget 24.
        pool_size, max_overflow, _ = _detect(monkeypatch, max_connections=50, workers="2", cores=8)
        assert (pool_size, max_overflow) == (16, 8)

    def test_pool_clamped_to_budget_zeroes_overflow(self, monkeypatch: pytest.MonkeyPatch):
        # 16 cores -> pool 32; 2 workers, 50 conns -> budget 24.
        pool_size, max_overflow, _ = _detect(monkeypatch, max_connections=50, workers="2", cores=16)
        assert (pool_size, max_overflow) == (24, 0)

    def test_fleet_never_exceeds_max_connections_minus_one(self, monkeypatch: pytest.MonkeyPatch):
        # 32 cores -> each process wants 64 + 64. Across the worker counts a
        # box would realistically run, the fleet's worst-case demand stays
        # under max_connections (one connection kept free for out-of-band
        # access: psql, migrations, the nightly pg_dump).
        for max_connections in (10, 100, 1000):
            for workers in (1, 2, 4, 16, 64):
                if workers > max_connections - 1:
                    continue  # more workers than connections is a broken box, not a config
                pool_size, max_overflow, _ = _detect(monkeypatch, max_connections=max_connections, workers=str(workers), cores=32)
                assert (pool_size + max_overflow) * workers <= max_connections - 1

    def test_fallback_to_default_when_probe_fails(self, monkeypatch: pytest.MonkeyPatch):
        # Probe down -> assume POSTGRES_DEFAULT_MAX_CONNECTIONS (100). 2
        # workers, 64 cores (pool 128) -> budget 49, so the assumed value is
        # observable in the result.
        pool_size, max_overflow, probe = _detect(monkeypatch, max_connections=None, workers="2", cores=64)
        assert (pool_size, max_overflow) == (49, 0)
        assert probe.disposed

    def test_env_overrides_bypass_clamp(self, monkeypatch: pytest.MonkeyPatch):
        # Explicit operator values always win (documented in the docstring),
        # even when they exceed the auto-sized budget.
        pool_size, max_overflow, _ = _detect(
            monkeypatch,
            max_connections=100,
            workers="2",
            cores=4,
            DB_POOL_SIZE="30",
            DB_MAX_OVERFLOW="20",
        )
        assert (pool_size, max_overflow) == (30, 20)


class TestAppWorkersParsing:
    def test_defaults_to_one_when_unset(self, monkeypatch: pytest.MonkeyPatch):
        # 64 cores (pool 128), 1 worker, 100 conns -> budget 99: no
        # APP_WORKERS at all must behave as exactly one worker.
        pool_size, max_overflow, _ = _detect(monkeypatch, max_connections=100, workers=None, cores=64)
        assert (pool_size, max_overflow) == (99, 0)

    @pytest.mark.parametrize("raw", ["abc", "", "0", "-2", "2.5"])
    def test_bad_value_fails_loudly(self, monkeypatch: pytest.MonkeyPatch, raw: str):
        # A bad value must fail at startup with a clear message instead of
        # crashing with a bare ValueError (or, for 0/negative, silently
        # pretending to be one worker).
        with pytest.raises(ValueError, match="APP_WORKERS must be a positive integer"):
            _detect(monkeypatch, max_connections=100, workers=raw, cores=4)
