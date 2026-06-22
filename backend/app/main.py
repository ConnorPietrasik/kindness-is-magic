from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy import text

from app.database import get_db

app = FastAPI()


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
        text("INSERT INTO referrer (\"limit\", email, phone_number) VALUES (5, 'test@kind.is-magic', '111-222-3333') RETURNING id")
    ).scalar()

    test_family = db.execute(
        text(f"INSERT INTO family (referrer_id, family_name, address, phone_number, family_wish) VALUES ({test_referrer}, 'TestFamily', '123 Kind St', '444-555-6666', 'world peace') RETURNING id")
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
