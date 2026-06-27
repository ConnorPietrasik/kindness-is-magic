import contextlib
import os
from collections.abc import Generator

from fastapi import Depends, FastAPI, HTTPException
import logging

logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.database import get_db
from app.models import User, UserRole


# ---------------------------------------------------------------------------
# Lifespan: seed bootstrap admin if none exists
# ---------------------------------------------------------------------------

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> Generator[None, None, None]:
    """Seed bootstrap admin user on startup."""
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password:
        from sqlalchemy.exc import ProgrammingError, OperationalError

        db = None
        try:
            db = next(get_db())
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
                "Database error during admin seed — skipping: %s",
                exc,
            )
        except Exception as exc:
            logger.error(
                "Unexpected error during admin seed — skipping: %s",
                exc,
                exc_info=True,
            )
        finally:
            if db:
                db.close()
    yield


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS — required for HttpOnly cookie auth from a different origin
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
