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
        from sqlalchemy.exc import ProgrammingError

        db = next(get_db())
        try:
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
        except ProgrammingError:
            logger.warning(
                "Users table does not exist — skipping admin seed. "
                "Run 'alembic upgrade head' to create tables."
            )
        finally:
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
# Existing routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.post("/api/db/verify")
async def verify_database(db=Depends(get_db)):
    """Run a quick verification: check tables exist, seed data, and orphan behaviour."""
    # 1. Confirm all three tables exist
    tables = db.execute(
        text(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
            """
        )
    ).fetchall()
    table_names = {row[0] for row in tables}
    expected = {"referrer", "family", "person"}
    missing = expected - table_names
    if missing:
        raise HTTPException(400, f"Missing tables: {missing}. Run 'alembic upgrade head' first.")

    # 2. Check orphan referrer exists
    orphan = db.execute(
        text("SELECT id FROM referrer WHERE id = 1 LIMIT 1")
    ).fetchone()
    if not orphan:
        raise HTTPException(400, "Orphan referrer (id=1) not found. Run 'alembic upgrade head' first.")

    # 3. Create a test referrer + family + person
    test_referrer = db.execute(
        text("INSERT INTO referrer (name, family_limit, email, phone_number) VALUES ('test', 5, 'test@kind.is-magic', '111-222-3333') RETURNING id")
    ).scalar()

    test_family = db.execute(
        text(f"INSERT INTO family (referrer_id, family_name, address, phone_number, family_wish, contact_name) VALUES ({test_referrer}, 'TestFamily', '123 Kind St', '444-555-6666', 'world peace', 'Family Contact') RETURNING id")
    ).scalar()

    test_person = db.execute(
        text(f"INSERT INTO person (family_id, given_name, age, practical_wish, fun_wish, note) VALUES ({test_family}, 'Testy', 30, 'a car', 'fly', 'test note') RETURNING id")
    ).scalar()

    # 4. Delete the test referrer and confirm family re-parented to orphan
    db.execute(text(f"DELETE FROM referrer WHERE id = {test_referrer}"))
    db.flush()

    re_parented = db.execute(
        text("SELECT referrer_id FROM family WHERE id = :fid"), {"fid": test_family}
    ).scalar()

    # 5. Clean up test data
    db.execute(text(f"DELETE FROM person WHERE id = {test_person}"))
    db.execute(text(f"DELETE FROM family WHERE id = {test_family}"))
    db.commit()

    return {
        "tables": sorted(table_names),
        "orphan_referrer_id": 1,
        "re_parented_to": re_parented,
        "orphan_reparenting": "PASS" if re_parented == 1 else "FAIL",
    }
