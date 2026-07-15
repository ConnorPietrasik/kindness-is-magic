# Backend - Agent Instructions

## Stack

- **FastAPI** + **SQLAlchemy 2.0** (declarative models) + **Alembic** for migrations
- **PyJWT** for auth (access tokens + refresh tokens), **bcrypt** for password hashing
- **psycopg** (v3) for Postgres

## Key Patterns

- **Soft deletes:** Models use an `is_deleted` boolean column. Queries filter `is_deleted == False`.
  - Never use `not Model.is_deleted` - that evaluates the SQLAlchemy Column in Python (always truthy). Use `Model.is_deleted == False` so SQLAlchemy generates SQL.
- **Role-based access:** Four roles - `admin`, `referrer`, `family`, `person`. Auth middleware (`auth.py`) validates JWTs and attaches the user to the request. `permissions.py` provides ownership and admin-check dependencies.
- **Response builders:** `response_builders.py` constructs API response dicts. Route handlers delegate to these rather than building responses inline.

## Project Structure

All app code lives under `app/` (flat, no subdirectories):

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app creation, middleware, route mounting |
| `models.py` | SQLAlchemy declarative models |
| `schemas.py` | Pydantic request/response models |
| `database.py` | Engine and session setup |
| `auth.py` | JWT creation/validation, password hashing, current-user dependencies |
| `auth_routes.py` | Login, register, password reset, token refresh |
| `permissions.py` | Role-check and ownership-check dependencies |
| `response_builders.py` | Response dict construction |
| `user_validation.py` | Shared user registration validation logic |
| `admin_routes.py` | Admin CRUD for referrers, families, people |
| `referrer_routes.py` | Referrer-managed families and people |
| `family_routes.py` | Family self-service endpoints |
| `people_routes.py` | Shared person endpoints |
| `csv_import.py` | Bulk CSV import (referrers/families/people/users) |

Migrations live in `alembic/versions/`. Tests live in `tests/` (root-level, sibling to `app/`).

## Migrations

Any model change in `models.py` needs a matching Alembic migration in `alembic/versions/`. Use `alembic revision --autogenerate -m "description"` to generate.

## Config

See `.env` at the project root for runtime config: JWT secrets, token lifetimes, bootstrap admin credentials, `COOKIE_SECURE`, invite expiry.

## Running Tests

Tests require a live Postgres test database. The user starts it with:
```bash
./run-compose.sh --profile test up test_db
```

Before running tests, verify the DB is reachable:
```bash
/dockerx/.venv/bin/python3 -c "import psycopg; psycopg.connect('postgresql://KindDB:testpassword@localhost:5433/kindness_is_magic_test').close()" 2>/dev/null && echo "DB OK" || echo "DB DOWN"
```

If that fails, ask the user to start the test DB. Once it's up, run tests via the persistent venv at `/dockerx/.venv`. Save output to a temp file so you can inspect it without rerunning:
```bash
cd /dockerx/kindness-is-magic/backend && DATABASE_URL="postgresql+psycopg://KindDB:testpassword@localhost:5433/kindness_is_magic_test" /dockerx/.venv/bin/pytest -q --tb=short > /tmp/test-output.txt 2>&1
```

Then read the summary with `tail -5 /tmp/test-output.txt`. If there are failures, read more of the file to inspect tracebacks.

**When running tests after changes:** iterate until tests pass. Avoid pasting full test output unless a failure needs user input. Report: final test status, pass/fail count, and a brief summary of any fixes made. If a failure requires a design decision, ask the user.

## Validation

- Tests in `tests/` use **pytest** + **httpx** (async test client). See "Running Tests" above.

- Use `ruff check .` and `ruff format --check .` to validate code quality. You can also use `python3 -c "import ..."` to verify imports and basic logic.

- **Do not enable Ruff E712**. SQLAlchemy comparisons intentionally use `== False` because they generate SQL expressions.
