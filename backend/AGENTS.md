# Backend - Agent Instructions

**No backward compatibility needed.** The app is not yet deployed.

## Stack

- **FastAPI** + **SQLAlchemy 2.0** (declarative models) + **Alembic** for migrations
- **PyJWT** for auth (access tokens + refresh tokens), **bcrypt** for password hashing
- **psycopg** (v3) for Postgres
- **slowapi** for rate limiting

## Runtime

- **Python 3.11** (Docker image `python:3.11-slim`).
- Do not upgrade dependencies unless requested.

## Logging

Structured JSON to stdout via `JsonFormatter` (`main.py`). A request middleware logs every HTTP request with `request_id`, `user_id`, `user_email`, `method`, `path`, `status_code`, `duration_ms` and adds `X-Request-ID` to responses. A `_RequestContextFilter` auto-injects `request_id`/`user_id` into all log records during request handling. Set `LOG_LEVEL` env var to control verbosity (default `INFO`).

## Key Patterns

- **Soft deletes:** All normal queries must exclude soft-deleted records (`Model.deleted_at.is_(None)`) unless the endpoint explicitly needs deleted data. Deletion sets `deleted_at` to the current timestamp (`datetime.now(timezone.utc)`) rather than removing the row. For plain Python checks (e.g. in conditionals on already-loaded objects), use `is None` / `is not None`.
- **Family approval:** Invite-registered families start as `pending`; direct creation is `approved`. Referrer queries filter by `approved` status. Admin sees all.
- **Referrer approval:** Unlocked invite codes start as `pending`; email-locked codes and admin-created referrers are auto-`approved`. Rejected referrers cannot log in. Pending referrers are blocked from `send-family-invite`.
- **Invite codes:** Referrer tokens use `KRI-` prefix, family tokens use `KFI-` prefix (10 chars each). Use `generate_invite_code(prefix=...)` from `auth.py`.
- **Role-based access:** Six roles — `admin`, `referrer`, `family`, `purchaser`, `delivery`, `donor`. Auth dependencies (`auth.py`) validate JWTs (from HttpOnly cookies) and attach the current user to the request. `permissions.py` provides role-check, ownership-check, and capability-check dependencies (e.g. `require_claim_capable`).
- **Response builders:** `response_builders.py` constructs API response dicts. Route handlers delegate to these rather than building responses inline. List endpoints build items with the list-item builders there and return via `column_filtered_page()`.
- **Partial-update sentinel convention:** `partial_update()` (`response_builders.py`) uses `exclude_unset=True`; `None` means no-op. To clear nullable columns: send `0` for FKs, `""` for any other nullable field. For typed fields where `""` wouldn't parse (e.g. `datetime`), add a `mode="before"` validator coercing `""` → `_CLEAR`. See `FamilyUpdate.pickup_window`.
- **Referrer notes bypass wish lock:** `referrer_notes` is always editable regardless of lock level; standard fields are still blocked when locked.
- **Display IDs:** List endpoints return `id` (DB key for mutations) and `display_id` (presentational hierarchical position, e.g. `3-2-1`). Always use `compute_display_ids()` from `response_builders.py` — see its docstring for format and enumeration rules (multi-scope endpoints such as packing slips batch via `compute_position_maps()`).

## Project Structure

All app code lives under `app/` (flat, no subdirectories):

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app creation, middleware, route mounting |
| `models.py` | SQLAlchemy declarative models |
| `schemas.py` | Pydantic request/response models |
| `database.py` | Engine and session setup |
| `auth.py` | JWT creation/validation, password hashing, current-user dependencies |
| `auth_routes.py` | Login, register, password reset, token refresh, referrer/family self-registration via invites |
| `permissions.py` | Role-check, ownership-check, and capability-check dependencies |
| `response_builders.py` | Response dict construction |
| `user_validation.py` | Shared user registration validation logic |
| `mail.py` | Email sending (SMTP via fastapi-mail), templates, unsubscribe helpers |
| `admin_referrers.py` | Admin CRUD for referrers + approve/reject |
| `admin_invites.py` | Admin CRUD for referrer invite tokens (list/get/revoke) |
| `admin_families.py` | Admin CRUD for families |
| `admin_people.py` | Admin CRUD for people |
| `admin_users.py` | Admin CRUD for users + CSV import |
| `admin_wishes.py` | Admin CRUD for wishes (list/detail/update/mark-purchased/batch-assign) |
| `config.py` | Business logic constants (e.g. `MAX_FAMILY_PERSONS`, `GIFT_CLAIM_CAP`) |
| `delivery_routes.py` | Delivery person self-service (assigned families, packing slips) |
| `donor_routes.py` | Donor / claim-capable self-service (family claims — available to admin, referrer, purchaser, donor) |
| `purchaser_routes.py` | Purchaser self-service (assigned wishes, mark purchased) |
| `referrer_routes.py` | Referrer-managed families and people |
| `family_routes.py` | Family self-service endpoints |
| `families_routes.py` | Public family resource endpoints |
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
- Admins access resources via `admin_*_routes.py` modules only. They are explicitly excluded from self-service guards (`require_family`, `require_referrer`) — e.g. `require_family` rejects admins because they have their own routes.
- Self-service roles are scoped to their assignments — referrers to families, families to themselves, purchasers and delivery people to admin-assigned resources.

## API Conventions

- Keep route handlers thin. Reuse existing helpers and response builders.
- Match existing HTTP status codes and response formats. Do not introduce new ones without discussion.
- Do not suppress Ruff errors unless there is a documented reason.
- Admin list endpoints support a `columns` query param for field selection. Self-service endpoints don't.

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


