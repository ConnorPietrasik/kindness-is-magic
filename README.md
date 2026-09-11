# Kindness Is Magic

A web app that connects donors with families: families (referred by case workers) collect a wish list of gifts, donors sponsor the family's wishes, and volunteers purchase and deliver the gifts.

## How it works

- **Referrers** (case workers) are invited by an admin with a one-time invite code. They refer families and manage the family's members and wish lists.
- **Families** register via an invite from their referrer and can see who is sponsoring their wishes and the status of each gift.
- **Donors** (and other claim-capable roles) browse public families and **sponsor** a family — a "claim" in the code — committing to cover its wishes.
- **Purchasers** are assigned specific wishes and mark them as purchased.
- **Delivery** people are assigned families and use packing slips and delivery slips to ship the gifts.
- **Admins** oversee everything: referrers, invites, families, people, wishes, assignments, deadlines, the sent-email log, and CSV bulk import.

There are six roles: `admin`, `referrer`, `family`, `purchaser`, `delivery`, `donor`. Auth is cookie-based (HttpOnly JWT access + refresh tokens); the frontend silently refreshes expiring tokens.

## Tech stack

| Layer | Stack |
|-------|-------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0, Alembic, PyJWT, bcrypt, psycopg 3, slowapi, fastapi-mail |
| Frontend | React 19, Vite, TypeScript, React Query, Tailwind CSS 4, Biome |
| Database | PostgreSQL 15 |
| Tests | pytest (+ xdist), Vitest, Playwright |
| Infra | Docker Compose (dev); Traefik + Let's Encrypt (prod) |

## Repository layout

```
backend/   FastAPI app (app/ is a flat module layout), alembic migrations, tests/
frontend/  React + Vite SPA (src/), Vitest tests
e2e/       Playwright end-to-end tests
.env.example   All runtime configuration (secrets, admin bootstrap, SMTP, ...)
docker-compose.yml      Dev stack: Traefik + Postgres + backend + frontend
docker-compose.prod.yml Production stack (nginx + 2-worker backend + Traefik HTTPS)
run-compose.sh          Wrapper that always runs docker compose from the repo root
demo_import.csv         Sample CSV for the admin bulk import page
AGENTS.md               Agent instructions (root, backend/, frontend/, e2e/)
```

## Getting started (development)

1. **Configure the environment**

   ```bash
   cp .env.example .env
   ```

   Fill in real values: `POSTGRES_*`, `SECRET_KEY` / `REFRESH_SECRET_KEY`
   (generate with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`),
   and `ADMIN_EMAIL` / `ADMIN_PASSWORD` (bootstrap admin, created on first backend
   start). SMTP settings are only needed if you want real emails — with
   `DEBUG=true`, sending is suppressed.

2. **Start the dev stack**

   ```bash
   ./run-compose.sh up --build
   ```

   Pending Alembic migrations are applied automatically when the backend
   starts. Log in at `http://localhost` with the bootstrap admin credentials.
   The dev stack uses host ports 80/443 (Traefik), 8099 (Traefik dashboard),
   5432 (Postgres), and 5433 (test DB).

3. **Optional: seed demo data** — import `demo_import.csv` via the admin UI's CSV upload page (`/admin/csv-upload`).

To start over from a clean slate, `./run-compose.sh clear` removes all
containers, volumes, and networks, including the database (`DEBUG=true` only).

## Running tests

- **Backend** — one-shot and self-contained: starts a dedicated Postgres test
  DB, runs the full suite in a container, and cleans up after itself:

  ```bash
  ./run-compose.sh test
  ```

  During backend development, keep the test DB up with `./run-compose.sh testdb` so agents can run the suite via `backend/run_tests.sh`.

- **Frontend** — Vitest (unit/integration, jsdom):

  ```bash
  cd frontend && npm run test                  # plus: npm run typecheck, npm run lint
  ```

- **E2E** — Playwright against the running dev stack (creates its own data):

  ```bash
  cd e2e && npx playwright test
  ```

## Configuration

Runtime config lives in `.env` (see `.env.example` for documented defaults): JWT secrets and token lifetimes, bootstrap admin, `DEBUG` (insecure cookies + no rate limiting in dev), invite expiry, SMTP mail settings, `APP_BASE_URL` (links in emails), and production-only `PUBLIC_HOSTNAME` / `LETSENCRYPT_EMAIL` for the Traefik/Let's Encrypt setup.

Business-logic constants — per-family person limit, gift claim cap, refresh-token rotation grace window, and event-deadline enforcement timing — live in `backend/app/config.py` and are changed there in code, not via `.env` (only `APP_BASE_URL` in that file is env-sourced).

## Production deployment

The production target is a Raspberry Pi running the **prod stack only**
(`docker-compose.prod.yml`): Traefik (HTTPS + Let's Encrypt) → nginx (static
frontend) + FastAPI backend (2 workers) → Postgres. Development happens on
the workstation with `docker-compose.yml` — never on the Pi.

### 1. Hardware & OS

- Raspberry Pi 4B, 4 GB RAM, headless Debian
- `sudo apt install docker.io docker-compose-v2 git curl`
- Prefer a USB SSD over the SD card for the data volume (`kindness_is_magic`) —
  Postgres on a cheap SD card is a classic long-term failure point.

### 2. DNS & network (before first start)

- **A record:** `yourdomain.com` → the Pi's public IP
- **CNAME:** `www.yourdomain.com` → `yourdomain.com`
  (www is 301-redirected to the apex; both names are in the one Let's Encrypt
  cert — this record is re-validated at every renewal, keep it alive)
- **Router:** forward TCP **80** and **443** to the Pi's LAN IP
- Wait for propagation: `dig +short yourdomain.com` should show your public IP

### 3. Repo & `.env`

```bash
git clone <repo-url> && cd <repo>
cp .env.example .env
```

Fill in every value.

| Key | Notes |
|-----|-------|
| `SECRET_KEY`, `REFRESH_SECRET_KEY` | generate: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | bootstrap admin, created on first backend start — the only way to get the *first* admin; further admins can be created from the admin users page or CSV import |
| `PUBLIC_HOSTNAME` | bare domain, e.g. `yourdomain.com` (no scheme) |
| `LETSENCRYPT_EMAIL` | Let's Encrypt expiry notices (safety net) |
| `APP_BASE_URL` | `https://yourdomain.com` (links in emails) |
| `DEBUG` | `false` |
| `POSTGRES_*`, `MAIL_*` | real values |

### 4. Prerequisites & start

```bash
./run-compose.sh prod setup        # toolchain + .env checks, seeds acme.json (mode 600), DNS warnings — re-runnable
./run-compose.sh prod up -d --build
```

`prod setup` never blocks on DNS warnings, but fix anything it reports before
relying on the first certificate issuance.

### 5. First visit

- From **outside the Pi** (phone/other machine): open `https://yourdomain.com`.
  The cert is issued on first contact; if you get a TLS error, wait 30–60 s
  and retry.
- Log in at `https://yourdomain.com` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### 6. Day-to-day

```bash
git pull && ./run-compose.sh prod up -d --build   # redeploy
./run-compose.sh prod logs -f [backend|frontend|traefik|db]
./run-compose.sh prod ps
```

- **Cert renewals are automatic** — Traefik re-issues ~30 days before each
  90-day expiry. No cron, no certbot. Requirements: apex A record + www CNAME
  still resolve, ports 80/443 still forwarded, Traefik running.
- Rate limits (login etc., 5/min per visitor) are effectively 2× looser with
  2 backend workers (per-process storage) — intentional at this scale.

### 7. Backups

All application data is in the `kindness_is_magic` Postgres volume (the
`traefik_certs` volume holds Let's Encrypt state and re-issues itself if lost —
not worth backing up). From the repo directory, occasionally:

```bash
./run-compose.sh prod backup         # writes kindness-backup-<timestamp>.sql
```

Restore takes the backup file, double-confirms, and **destroys the current
database** (a dump can only be loaded into an empty one, so after it runs the
file is the only copy of what was there):

```bash
./run-compose.sh prod restore-from-backup kindness-backup-20250101-120000.sql
```

(If you want to throw the data away rather than restore it, that's the
factory reset in Troubleshooting below.)

### 8. Troubleshooting

- **TLS error on first visit** — DNS or port-forwarding not live yet. Re-run
  `./run-compose.sh prod setup` to see exactly which check warns; verify with
  `dig +short yourdomain.com` from anywhere.
- **Cert renewal failing** — both A and www records must resolve (see step 2);
  `./run-compose.sh prod logs -f traefik` shows the ACME error.
- **502s after a deploy** — `prod logs -f backend` (DB not ready / migration
  error / `.env` typo are the usual suspects).
- **429s** — per-visitor rate limit (auth endpoints); not a bug.
- **Factory reset (destroys all data — back up first):**
  `./run-compose.sh prod down -v` (there is deliberately no `clear` for prod).

### Deployment notes

- `traefik:latest` is unpinned for now — pin a specific version tag when you
  want upgrade stability.

## License

Licensed under the [GNU GPL v3](LICENSE).

## Agent documentation

Each directory keeps its own `AGENTS.md` with patterns and conventions (soft deletes, roles and permissions, response builders, React Query usage, testing conventions, ...). Read the one for the directory you're working in before making changes there.
