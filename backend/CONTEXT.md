# Kindness Is Magic — Backend Context Overview

> Read this file to quickly get up to speed on the backend codebase.

## High-Level Summary

**Kindness Is Magic** is a charity/assistance platform for managing families in need, the referrers who advocate for them, and the people (individuals) within each family. The backend is a **FastAPI** REST API backed by **PostgreSQL** via **SQLAlchemy** (2.x ORM). Migrations are managed with **Alembic**.

The system has three user roles with distinct permissions:
- **Admin** — full CRUD over all entities, user management, CSV bulk import
- **Referrer** — self-service access to their own families and people
- **Family** — self-service access to their own family info and people

---

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, lifespan, CORS, router mounting
│   ├── database.py           # SQLAlchemy engine, SessionLocal, Base
│   ├── models.py             # ORM models (User, Referrer, Family, Person, auth tokens)
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── auth.py               # JWT, bcrypt, cookie helpers, get_current_user
│   ├── auth_routes.py        # /api/auth/* — login, logout, refresh, password, invites
│   ├── permissions.py        # RBAC dependencies (require_admin, require_referrer, etc.)
│   ├── admin_routes.py       # /api/admin/* — CRUD for referrers, families, people, CSV
│   ├── referrer_routes.py    # /api/referrer/* — referrer self-service
│   ├── family_routes.py      # /api/family/* — family self-service
│   ├── people_routes.py      # /api/people/* — shared person endpoints
│   └── csv_import.py         # CSV bulk import logic
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial.py    # Initial schema + orphan referrer seed
├── tests/
│   ├── conftest.py           # Fixtures: db, test_client, admin_user, referrer/family trees
│   └── test_*.py             # ~13 test modules
├── Dockerfile
├── requirements.txt
├── requirements-test.txt
├── alembic.ini
└── pytest.ini
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | FastAPI 0.115.0 + Uvicorn 0.32.0 |
| Database | PostgreSQL (psycopg2-binary) |
| ORM | SQLAlchemy 2.0 (async not used — sync sessions) |
| Migrations | Alembic 1.13.1 |
| Auth | PyJWT 2.8.0, bcrypt 4.1.2 |
| Validation | Pydantic (via FastAPI) |
| Testing | pytest, FastAPI TestClient, real Postgres DB with transaction rollback |

## Configuration (Environment Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://KindDB:testpassword@db:5432/kindness_is_magic` | DB connection string |
| `SECRET_KEY` | `dev-secret-key-change-me` | JWT access token signing |
| `REFRESH_SECRET_KEY` | `dev-refresh-secret-key-change-me` | JWT refresh token signing |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token TTL |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token TTL |
| `INVITE_EXPIRY_HOURS` | `168` (7 days) | Referrer invite code expiry |
| `ADMIN_EMAIL` | *(unset)* | Bootstrap admin email (seeded on startup if set) |
| `ADMIN_PASSWORD` | *(unset)* | Bootstrap admin password |
| `COOKIE_SECURE` | `false` | Set `Secure` flag on auth cookies (true for HTTPS/prod) |

## Database Schema

### Core Domain Models

```
Referrer (id, name, family_limit, phone_number)
    └── Family (id, referrer_id→FK, family_name, bio, address, phone_number,
                  family_wish, contact_name)
            └── Person (id, family_id→FK, given_name, title, age,
                         practical_wish, fun_wish, note)
```

### Auth Models

```
User (id, email (unique), hashed_password, role (admin|referrer|family),
      referrer_id→FK|NULL, family_id→FK|NULL, is_active, created_at)

ReferrerInviteToken (id, code (unique), family_limit, expires_at, used,
                      created_at, redeemed_by_user_id→FK, redeemed_by_referrer_id→FK)

PasswordResetToken (id, user_id→FK(CASCADE), token (unique), expires_at, used, created_at)
```

### Special: Orphan Referrer

A `Referrer` row with `id=0`, name `"Orphan"` is seeded in the initial migration.
When a referrer is deleted, their families are reassigned to the orphan referrer
(rather than cascade-deleted). The `family.referrer_id` FK uses `SET DEFAULT`
with `server_default='0'`. The sequence is advanced to `1` so auto-generated
IDs don't collide with id=0.

### Relationships

- `User.role == "admin"` → `referrer_id` and `family_id` are both `NULL`
- `User.role == "referrer"` → linked to one `Referrer` via `referrer_id`
- `User.role == "family"` → linked to one `Family` via `family_id`
- `Person` cascade: `Family → Person` uses `cascade="all, delete-orphan"`

## Authentication & Authorization

### Auth Flow
1. **Login** (`POST /api/auth/login`) — email + password → sets `access_token` and `refresh_token` as **HttpOnly cookies**
2. **Access** — subsequent requests read `access_token` cookie → `get_current_user()` dependency
3. **Refresh** (`POST /api/auth/refresh`) — uses `refresh_token` cookie → rotates both tokens
4. **Logout** (`POST /api/auth/logout`) — clears both cookies
5. **Password reset** — `POST /api/auth/forgot-password` creates token, `POST /api/auth/reset-password` consumes it (dev mode logs token)
6. **Referrer self-registration** — admin creates invite via `POST /api/auth/invite-referrer`, public redeems via `POST /api/auth/register-referrer` (auto-logs in)

### RBAC Dependencies

| Dependency | Allows |
|-----------|--------|
| `require_admin` | `admin` only |
| `require_referrer` | `admin` or `referrer` |
| `require_family` | `family` only |
| `require_person_owner(per_id)` | admin, or referrer owning the person's family, or the family user |

## API Endpoints

### Auth (`/api/auth/*`)

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| POST | `/register` | admin | Create a new user |
| POST | `/login` | public | Authenticate, set cookies |
| POST | `/logout` | authenticated | Clear cookies |
| POST | `/refresh` | refresh cookie | Rotate tokens |
| GET | `/me` | authenticated | Current user profile |
| PUT | `/me/password` | authenticated | Change own password |
| POST | `/forgot-password` | public | Request reset token |
| POST | `/reset-password` | public | Consume reset token |
| POST | `/invite-referrer` | admin | Create invite code (KMG-XXXXXX) |
| POST | `/register-referrer` | public | Redeem invite → create Referrer + User |

### Admin — Referrers (`/api/admin/referrers/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all referrers |
| GET | `/{ref_id}` | Get referrer detail (with family_count) |
| POST | `/` | Create referrer |
| PATCH | `/{ref_id}` | Partial update referrer |
| DELETE | `/{ref_id}` | Delete referrer (families → orphan) |

### Admin — Families (`/api/admin/families/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all families |
| GET | `/{fam_id}` | Get family detail (with person_count) |
| POST | `/` | Create family (requires valid referrer_id) |
| PATCH | `/{fam_id}` | Partial update family |
| DELETE | `/{fam_id}` | Delete family (cascades to people) |

### Admin — People (`/api/admin/people/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all people |
| GET | `/{per_id}` | Get person detail |
| POST | `/` | Create person (requires valid family_id) |
| PATCH | `/{per_id}` | Partial update person |
| DELETE | `/{per_id}` | Delete person |

### Admin — CSV (`/api/admin/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/csv-sample` | Get sample CSV template |
| POST | `/import-csv` | Bulk import (referrers → families → people → users) |

CSV format uses `# section_name` headers. Sections processed in dependency order. Duplicate records are skipped (idempotent). Errors are reported per-row.

### Referrer Self-Service (`/api/referrer/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/me` | Get own referrer detail |
| PATCH | `/me` | Update own referrer info |
| GET | `/families` | List own families |
| GET | `/families/{fam_id}` | Get family detail (ownership check) |
| POST | `/families` | Create family (respects family_limit) |
| PATCH | `/families/{fam_id}` | Update own family |
| DELETE | `/families/{fam_id}` | Delete own family |
| GET | `/families/{fid}/people` | List people in a family |
| POST | `/families/{fid}/people` | Create person in a family |

### Family Self-Service (`/api/family/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/me` | Get own family detail |
| PATCH | `/me` | Update own family info |
| GET | `/people` | List own people |
| POST | `/people` | Create person |

### Shared People (`/api/people/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/{per_id}` | Get person (ownership via `require_person_owner`) |
| PATCH | `/{per_id}` | Update person (ownership check) |
| DELETE | `/{per_id}` | Delete person (ownership check) |

### Health

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| GET | `/api/health` | public | Returns `{"status": "ok"}` |

## CORS

Configured for `http://localhost` and `http://localhost:3000` with `allow_credentials=True` (required for HttpOnly cookie auth from a different origin).

## Startup Behavior (Lifespan)

On startup, if `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars are set and no admin with that email exists, a bootstrap admin user is created. This is wrapped in broad exception handling so DB errors don't crash the app.

## Testing

- **Database**: Uses a real Postgres container (`test_db`) with a separate test database
- **Isolation**: Each test runs inside a rolled-back transaction (savepoint pattern)
- **Key fixtures** (in `conftest.py`):
  - `db` — transaction-scoped session
  - `test_client` — FastAPI TestClient with `get_db` overridden
  - `admin_user`, `referrer_record`, `referrer_user`, `family_record`, `family_user`
  - `referrer_with_families`, `family_with_people` — admin CRUD trees
  - `referrer_with_full_tree`, `another_referrer`, `another_family` — self-service ownership trees
  - `login_as(client, email, password)` — helper function
- Run with: `./run-compose.sh run test` (from project root)

## Known Patterns / Gotchas

1. **Partial updates** use `model_dump(exclude_unset=True)` + manual `setattr` — not `model_dump()` which includes defaults.
2. **Computed fields** like `family_count` and `person_count` are calculated at response time via separate queries (not ORM eager-loading).
3. **Orphan referrer** (id=0) must exist before any Family row is created. The migration seeds it explicitly and advances the sequence.
4. **CSV import** processes sections in dependency order (referrers → families → people → users) and resolves foreign keys by name or ID.
5. **Admin CRUD** and **self-service routes** have separate implementations with duplicated helper functions (`_build_referrer_detail`, `_build_family_detail`, `_partial_update`). This is intentional — they live in different route modules with different guards.
6. **Person `note` column** is `Text()` in the migration but `String(400)` in the model — a minor schema inconsistency.
7. **`require_family`** only allows `UserRole.family` (not admin) — this is intentional for the self-service family routes, but means admins must use the admin routes to access family data.
