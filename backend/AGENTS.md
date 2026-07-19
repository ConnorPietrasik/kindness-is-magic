# Backend - Agent Instructions

## Stack

- **FastAPI** + **SQLAlchemy 2.0** (declarative models) + **Alembic** for migrations
- **PyJWT** for auth (access tokens + refresh tokens), **bcrypt** for password hashing
- **psycopg** (v3) for Postgres
- **slowapi** for rate limiting

## Runtime

- **Python 3.11** (Docker image `python:3.11-slim`).
- Do not upgrade dependencies unless requested.

## Key Patterns

- **Soft deletes:** All normal queries must exclude soft-deleted records (`Model.deleted_at.is_(None)`) unless the endpoint explicitly needs deleted data. Deletion sets `deleted_at` to the current timestamp (`datetime.now(timezone.utc)`) rather than removing the row. For plain Python checks (e.g. in conditionals on already-loaded objects), use `is None` / `is not None`.
- **Role-based access:** Three roles — `admin`, `referrer`, `family`. Auth dependencies (`auth.py`) validate JWTs (from HttpOnly cookies) and attach the current user to the request. `permissions.py` provides ownership and admin-check dependencies.
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
| `mail.py` | Email sending (SMTP via fastapi-mail), templates, unsubscribe helpers |
| `admin_routes.py` | Admin CRUD for referrers, families, people |
| `referrer_routes.py` | Referrer-managed families and people |
| `family_routes.py` | Family self-service endpoints |
| `people_routes.py` | Shared person endpoints |
| `csv_import.py` | Bulk CSV import (referrers/families/people/users) |
| `rate_limit.py` | Rate limiter configuration (`slowapi`) |

Migrations live in `alembic/versions/`. Tests live in `tests/` (root-level, sibling to `app/`).

## Database Rules

- Use the existing `get_db` dependency from `database.py`. Never create new engines or sessions inside route handlers.
- Commit mutations explicitly in the route handler (e.g. `db.commit()`).
- Do not call `commit()` in helper functions unless they own the transaction.

## Authorization Rules

- Never trust role or ownership information from request bodies. Always use the authenticated user from JWT dependencies.
- Admins access resources via `admin_routes.py` only. They are explicitly excluded from self-service guards (`require_family`, `require_referrer`) — e.g. `require_family` rejects admins because they have their own routes.
- Referrers may only manage their assigned families/people. Families may only access their own data.

## API Conventions

- Keep route handlers thin. Reuse existing helpers and response builders.
- Match existing HTTP status codes and response formats. Do not introduce new ones without discussion.
- Do not suppress Ruff errors unless there is a documented reason.

## Config

See `.env` at the project root for runtime config: JWT secrets, token lifetimes, bootstrap admin credentials, `DEBUG`, invite expiry, SMTP mail settings, `APP_BASE_URL`.

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
cd /dockerx/kindness-is-magic/backend && DATABASE_URL="postgresql+psycopg://KindDB:testpassword@localhost:5433/kindness_is_magic_test" /dockerx/.venv/bin/pytest -n auto -q --tb=short > /tmp/test-output.txt 2>&1
```

Then read the summary with `tail -5 /tmp/test-output.txt`. If there are failures, read more of the file to inspect tracebacks.

**When running tests after changes:** iterate until tests pass. Avoid pasting full test output unless a failure needs user input. Report: final test status, pass/fail count, and a brief summary of any fixes made. If a failure requires a design decision, ask the user.

## Validation Workflow

After making code changes:
1. Run `ruff check .` and `ruff format --check .` first (instant).
2. If the change could affect behaviour, run the test suite (see "Running Tests").
3. For trivial changes (typos, formatting, renames), skip tests unless asked.

## Validation

- Tests in `tests/` use **pytest** + **httpx** + **pytest-xdist**. See "Running Tests" above.

- Use `ruff check .` and `ruff format --check .` to validate code quality. You can also use `python3 -c "import ..."` to verify imports and basic logic.


