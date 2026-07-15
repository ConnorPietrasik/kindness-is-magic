# Backend - Agent Instructions

## Stack

- **FastAPI** + **SQLAlchemy 2.0** (declarative models) + **Alembic** for migrations
- **PyJWT** for auth (access tokens + refresh tokens), **bcrypt** for password hashing
- **psycopg2-binary** for Postgres

## Key Patterns

- **Soft deletes:** Models use an `is_deleted` boolean column. Queries filter `is_deleted == False`.
  - Never use `not Model.is_deleted` - that evaluates the SQLAlchemy Column in Python (always truthy). Use `Model.is_deleted == False` so SQLAlchemy generates SQL.
- **Role-based access:** Four roles - `admin`, `referrer`, `family`, `person`. Auth middleware (`auth.py`) validates JWTs and attaches the user to the request. `permissions.py` provides ownership and admin-check dependencies.
- **Response builders:** `response_builders.py` constructs API response dicts. Route handlers delegate to these rather than building responses inline.

## Route Modules

| File | Scope |
|------|-------|
| `auth_routes.py` | Login, register, password reset, token refresh |
| `admin_routes.py` | Admin CRUD for referrers, families, people |
| `referrer_routes.py` | Referrer-managed families and people |
| `family_routes.py` | Family self-service endpoints |
| `people_routes.py` | Person endpoints |
| `csv_import.py` | Bulk CSV import (~400 lines, referrers/families/people/users) |

## Migrations

Any model change in `models.py` needs a matching Alembic migration in `alembic/versions/`. Use `alembic revision --autogenerate -m "description"` to generate.

## Config

See `.env` at the project root for runtime config: JWT secrets, token lifetimes, bootstrap admin credentials, `COOKIE_SECURE`, invite expiry.

## Validation

- Tests in `tests/` use **pytest** + **httpx** (async test client). They require a live Postgres database and **cannot be run** in this environment.

- Use `ruff check .` and `ruff format --check .` to validate code quality. You can also use `python3 -c "import ..."` to verify imports and basic logic.

- **Do not enable Ruff E712**. SQLAlchemy comparisons intentionally use `== False` because they generate SQL expressions.
