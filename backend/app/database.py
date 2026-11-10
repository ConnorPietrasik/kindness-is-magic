import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://KindDB:testpassword@db:5432/kindness_is_magic",
)

# Fallback if max_connections can't be read (e.g. DB not reachable at import time).
POSTGRES_DEFAULT_MAX_CONNECTIONS = 100


def _app_worker_count() -> int:
    """Worker count of the process group sharing the database (APP_WORKERS).

    It must match the number of uvicorn workers actually running — the prod
    image sets one value and passes it to both — so a bad value is a config
    error to fail on at startup, not a number to guess at.
    """
    raw = os.environ.get("APP_WORKERS", "1")
    try:
        workers = int(raw)
        if workers < 1:
            raise ValueError
    except ValueError:
        raise ValueError(
            f"APP_WORKERS must be a positive integer (got {raw!r}) — it drives both the uvicorn "
            "worker count and the per-worker DB pool budget"
        ) from None
    return workers


def _detect_pool_settings(url: str) -> tuple[int, int]:
    """Pick (pool_size, max_overflow) for this machine.

    The warm pool is 2 connections per CPU core (floor of 5 — Pi-friendly),
    with burst headroom (max_overflow) equal to the pool size, clamped to a
    per-process budget of (max_connections - 1) // APP_WORKERS: one
    connection kept free for out-of-band access (psql, migrations, ...), and
    the rest divided equally across all worker processes so the whole box
    never wants more connections than Postgres can hand out. max_connections
    is queried live from the server.

    APP_WORKERS is the worker count of the process group sharing this
    database — set by the image (prod runs 2 workers and passes the same
    value to uvicorn), defaulting to 1 for dev and anything run directly.
    A bad value fails at startup (see _app_worker_count) rather than
    silently mis-sizing the pool.

    Override either value with the DB_POOL_SIZE / DB_MAX_OVERFLOW env vars.
    """
    workers = _app_worker_count()

    cores = os.cpu_count() or 1
    pool_size = max(5, 2 * cores)
    max_overflow = pool_size

    probe = create_engine(url, pool_size=1, max_overflow=0)
    try:
        with probe.connect() as conn:
            max_connections = int(conn.exec_driver_sql("SHOW max_connections").scalar_one())
    except Exception:
        logger.warning(
            "could not read Postgres max_connections; assuming %d",
            POSTGRES_DEFAULT_MAX_CONNECTIONS,
            exc_info=True,
        )
        max_connections = POSTGRES_DEFAULT_MAX_CONNECTIONS
    finally:
        probe.dispose()

    budget = max(1, (max_connections - 1) // workers)
    pool_size = min(pool_size, budget)
    max_overflow = min(max_overflow, budget - pool_size)

    override = os.environ.get("DB_POOL_SIZE")
    if override:
        pool_size = max(1, int(override))
    override = os.environ.get("DB_MAX_OVERFLOW")
    if override:
        max_overflow = max(0, int(override))

    return pool_size, max_overflow


POOL_SIZE, MAX_OVERFLOW = _detect_pool_settings(DATABASE_URL)

engine = create_engine(DATABASE_URL, pool_size=POOL_SIZE, max_overflow=MAX_OVERFLOW)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def is_active_claim_race(exc: IntegrityError) -> bool:
    """Whether a failed commit lost a double-claim race on the
    one-active-claim-per-family index (uq_family_claims_family_active).

    Both claim-creation paths — POST /api/families/{id}/claim and the cart
    checkout — commit into that partial unique index, and only a violation
    of exactly this constraint is a lost race. Any other IntegrityError is a
    genuine surprise and should be re-raised to the 500 handler rather than
    mislabelled as "already sponsored".

    Detection is duck-typed on the driver error: ``pgcode`` is the SQLSTATE
    (23505 = unique_violation) and ``diag`` is psycopg's error diagnostics,
    so a missing ``orig`` (programmatically raised) simply isn't a race.
    """
    orig = exc.orig
    diag = getattr(orig, "diag", None)
    return getattr(orig, "pgcode", None) == "23505" and getattr(diag, "constraint_name", None) == "uq_family_claims_family_active"
