import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://KindDB:testpassword@db:5432/kindness_is_magic",
)

# Fallback if max_connections can't be read (e.g. DB not reachable at import time).
POSTGRES_DEFAULT_MAX_CONNECTIONS = 100


def _detect_pool_settings(url: str) -> tuple[int, int]:
    """Pick (pool_size, max_overflow) for this machine.

    The warm pool is 2 connections per CPU core (floor of 5 — Pi-friendly),
    with burst headroom (max_overflow) equal to the pool size, clamped to the
    server's actual max_connections (queried live) minus one connection kept
    free for out-of-band access (psql, migrations, ...). A single uvicorn
    process owns this pool; if you ever run N workers, budget for
    N * (size + overflow) against max_connections.

    Override either value with the DB_POOL_SIZE / DB_MAX_OVERFLOW env vars.
    """
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

    budget = max(1, max_connections - 1)
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
