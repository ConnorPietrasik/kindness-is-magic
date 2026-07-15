# Backend - Agent Instructions

## Stack

- **FastAPI** + **SQLAlchemy 2.0** (declarative models) + **Alembic** for migrations
- **PyJWT** for auth (access tokens + refresh tokens), **bcrypt** for password hashing
- **psycopg** (v3) for Postgres

## Runtime

- **Python 3.11** (Docker image `python:3.11-slim`).
- Do not upgrade dependencies unless requested.

## Key Patterns

- **Soft deletes:** All normal queries must exclude soft-deleted records (`Model.is_deleted == False`) unless the endpoint explicitly needs deleted data. Deletion sets `is_deleted = True` rather than removing the row.
  - Never use `not Model.is_deleted` — that evaluates the SQLAlchemy Column in Python (always truthy). Use `Model.is_deleted == False` so SQLAlchemy generates SQL.
- **Role-based access:** Three roles — `admin`, `referrer`, `family`. Auth middleware (`auth.py`) validates JWTs and attaches the user to the request. `permissions.py` provides ownership and admin-check dependencies.
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

## Database Rules

- Use the existing `get_db` dependency from `database.py`. Never create new engines or sessions inside route handlers.
- Commit mutations explicitly in the route handler (e.g. `db.commit()`).
- Do not call `commit()` in helper functions unless they own the transaction.

## Migrations

- Any model change in `models.py` needs a matching Alembic migration in `alembic/versions/`. Use `alembic revision --autogenerate -m "description"` to generate.
- Never edit existing migrations. Create a new one instead.
- Do not delete migrations to fix failures.

## Authorization Rules

- Never trust role or ownership information from request bodies. Always use the authenticated user from JWT dependencies.
- Admins access resources via `admin_routes.py` only. They are explicitly excluded from self-service guards (`require_family`, `require_referrer`) — e.g. `require_family` rejects admins because they have their own routes.
- Referrers may only manage their assigned families/people. Families may only access their own data.

## API Conventions

- Self-service list endpoints (`/api/referrer/families`, `/api/family/people`) intentionally omit pagination. Referrers are bounded by `family_limit` and families have small person counts, so unbounded lists are acceptable here.
- Keep route handlers thin. Reuse existing helpers and response builders.
- Match existing HTTP status codes and response formats. Do not introduce new ones without discussion.
- Do not suppress Ruff errors unless there is a documented reason.

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

## Validation Workflow

After making code changes:
1. Run `ruff check .` and `ruff format --check .` first (instant).
2. If the change could affect behaviour, run the test suite (see "Running Tests").
3. For trivial changes (typos, formatting, renames), skip tests unless asked.

## Validation

- Tests in `tests/` use **pytest** + **httpx** (async test client). See "Running Tests" above.

- Use `ruff check .` and `ruff format --check .` to validate code quality. You can also use `python3 -c "import ..."` to verify imports and basic logic.

- **Do not enable Ruff E712**. SQLAlchemy comparisons intentionally use `== False` because they generate SQL expressions.
