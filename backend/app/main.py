import contextlib
import json
import logging
import os
import sys
from collections.abc import Generator
from datetime import datetime, timezone

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import SQLAlchemyError

from app.auth import get_password_hash
from app.database import get_db
from app.models import User, UserRole


# ---------------------------------------------------------------------------
# Logging — structured JSON to stdout (Docker's logging driver captures it)
# ---------------------------------------------------------------------------


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per log line to stdout.

    Docker's ``json-file`` logging driver picks up stdout automatically,
    rotates the backing file, and exposes it via ``docker logs``.
    No file handlers are used — files inside containers disappear on
    restart and waste disk I/O.

    Usage:

        docker logs backend     # human-readable
        docker logs backend | jq '.level == "ERROR"'  # filter
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Attach exception info when present
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(JsonFormatter())
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    handlers=[_handler],
)
# Silence noisy third-party loggers at INFO unless explicitly asked
# slowapi logs ERROR when key_func returns None (dev/e2e rate-limit skip)
for _quiet in ("uvicorn.access", "watchfiles"):
    logging.getLogger(_quiet).setLevel(logging.WARNING)
logging.getLogger("slowapi").setLevel(logging.CRITICAL)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: seed bootstrap admin on startup
# ---------------------------------------------------------------------------


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> Generator[None, None, None]:
    """Seed bootstrap admin user on startup."""
    from sqlalchemy.exc import ProgrammingError, OperationalError

    db = None
    try:
        db = next(get_db())

        # -----------------------------------------------------------------
        # Bootstrap admin user (only if env vars are set)
        # -----------------------------------------------------------------
        admin_email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
        admin_password = os.environ.get("ADMIN_PASSWORD")
        if admin_email and admin_password:
            existing = db.query(User).filter(User.email == admin_email).first()
            if not existing:
                admin = User(
                    email=admin_email,
                    hashed_password=get_password_hash(admin_password),
                    role=UserRole.admin,
                    referrer_id=None,
                    family_id=None,
                    is_active=True,
                )
                db.add(admin)
                db.commit()
                logger.info("Bootstrap admin user created.")

    except (ProgrammingError, OperationalError) as exc:
        logger.warning(
            "Database error during startup seed — skipping: %s",
            exc,
        )
    except Exception as exc:
        logger.error(
            "Unexpected error during startup seed — skipping: %s",
            exc,
            exc_info=True,
        )
    finally:
        if db:
            db.close()

    yield


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
from app.rate_limit import limiter  # noqa: E402

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """Return rate-limit errors with `detail` key so the frontend displays them."""
    response = JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": f"Rate limit exceeded. {exc.detail}"},
    )
    response = limiter._inject_headers(response, request.state.view_rate_limit)
    return response


# ---------------------------------------------------------------------------
# CORS — required for HttpOnly cookie auth from a different origin
# ---------------------------------------------------------------------------
_cors_origins = [os.environ.get("APP_BASE_URL", "http://localhost")]
if os.environ.get("DEBUG", "false").lower() == "true":
    _cors_origins.append("http://localhost")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    """Catch all SQLAlchemy errors (IntegrityError, OperationalError, etc.)
    and return a generic 500 — never leak DB internals to the client."""
    logger.error("Database error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal database error occurred"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return structured Pydantic validation errors as 422.

    Uses ``jsonable_encoder`` so that nested exception objects inside the
    ``ctx`` field (e.g. the ValueError from our email validator) are
    serialized to strings instead of raising TypeError.
    """
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content=jsonable_encoder({"detail": exc.errors()}),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Catch-all for any unhandled exception — return 500 without stack traces."""
    logger.error("Unexpected error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred"},
    )


# ---------------------------------------------------------------------------
# Include auth routes
# ---------------------------------------------------------------------------
from app.auth_routes import router as auth_router  # noqa: E402

app.include_router(auth_router)

# ---------------------------------------------------------------------------
# Include admin routes (Phase 1)
# ---------------------------------------------------------------------------
from app.admin_routes import (  # noqa: E402
    csv_admin_router,
    family_admin_router,
    people_admin_router,
    referrer_admin_router,
)

app.include_router(referrer_admin_router)
app.include_router(family_admin_router)
app.include_router(people_admin_router)
app.include_router(csv_admin_router)

# ---------------------------------------------------------------------------
# Include self-service routes (Phase 3)
# ---------------------------------------------------------------------------
from app.referrer_routes import router as referrer_router  # noqa: E402
from app.family_routes import router as family_router  # noqa: E402
from app.people_routes import router as people_router  # noqa: E402

app.include_router(referrer_router)
app.include_router(family_router)
app.include_router(people_router)


# ---------------------------------------------------------------------------
# Existing routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
