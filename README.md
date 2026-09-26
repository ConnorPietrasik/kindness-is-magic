# Kindness Is Magic

A web app that connects donors with families: families (referred by referrers) collect a wish list of gifts, donors sponsor the family's wishes, and volunteers purchase and deliver the gifts.

## How it works

- **Referrers** are invited by an admin with a one-time invite code. They refer families and manage the family's members and wish lists.
- **Families** register via an invite from their referrer and manage the family's members and wish list. Sponsorship is anonymous in the app — neither family nor referrer views show the donor's identity.
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
deploy/                 Production deploy scripts (CD entrypoint, server setup, SSH wrapper)
run-compose.sh          Wrapper that always runs docker compose from the repo root
demo_import.csv         Sample CSV for the admin bulk import page
AGENTS.md               Agent instructions (root, backend/, frontend/, e2e/)
```

## Getting started (development)

1. **Configure the environment**

   ```bash
   cp .env.example .env
   ```

   That's all it takes for local dev: `.env.example` ships with committed
   dev/CI placeholder values that work out of the box here and in CI.
   **Replace the values production needs before deploying** — for the secrets,
   generate real ones with
   `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. SMTP
   settings are only needed if you want real emails — with `DEBUG=true`,
   sending is suppressed.

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

- **E2E** — Playwright against the running dev stack (creates its own data + relies on info from the demo import):

  ```bash
  cd e2e && npx playwright test
  ```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `master` and
on pull requests, with three parallel jobs: **backend** (ruff check + format,
pytest against an ephemeral Postgres service container), **frontend**
(typecheck, lint, Vitest, production build), and **e2e** (the Playwright
suite). The e2e job spins up its own disposable dev stack at
`http://localhost` from the repo — nothing to prepare locally. The Deploy
(CD) workflow reuses this suite as its release gate via `workflow_call` —
see **Releases (CD)** below.

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
- Install Docker (with Docker Compose), `git`, and `curl`
- Prefer a USB SSD over the SD card for the data volume (`kindness_is_magic`) —
  Postgres on a cheap SD card is a classic long-term failure point.

### 2. DNS & network (before first start)

- **A record:** `yourdomain.com` → the Pi's public IPv4 (omit if you have none)
- **AAAA record:** `yourdomain.com` → the Pi's public IPv6 (omit if you have none)
  — at least one of the two is required
- **CNAME:** `www.yourdomain.com` → `yourdomain.com`
  (www is 301-redirected to the apex; both names are in the one Let's Encrypt
  cert)
- **Router:** forward TCP **80** and **443** to the Pi's LAN IP (along with an SSH port for CD)
- Wait for propagation: `dig +short yourdomain.com` / `dig +short AAAA yourdomain.com` should show your public IP(s)

### 3. Repo & `.env`

Clone into a neutral location such as `/opt` — **not** under a home
directory. Once CD is set up (step 6), the password-locked `deploy` user
owns the clone and works in it on every deploy, so it must live where
`deploy` can always reach it; a clone under a home dir that `deploy` can't
traverse makes every deploy fail.

```bash
sudo git clone <repo-url> /opt/kindness-is-magic
sudo chown "$(id -un)" /opt/kindness-is-magic   # you keep working in it until CD setup (step 6)
cd /opt/kindness-is-magic
cp .env.example .env
```

`.env.example` ships with committed dev/CI placeholder values (e.g.
`ci-test-*` / `kindness-test*`): replace the ones production uses.
`./run-compose.sh prod setup` lists the production-critical ones (secrets,
credentials, hostnames, contacts) that still match `.env.example` and refuses
to continue until they're replaced.

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
./run-compose.sh prod setup        # toolchain + .env checks, seeds acme.json (mode 600) and backups/, DNS warnings — re-runnable
./run-compose.sh prod up -d --build
```

`prod setup` never blocks on DNS warnings, but fix anything it reports before
relying on the first certificate issuance.

### 5. First visit

- From **outside the Pi** (phone/other machine): open `https://yourdomain.com`.
  The cert is issued on first contact; if you get a TLS error, wait 30–60 s
  and retry.
- Log in at `https://yourdomain.com` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### 6. Releases (CD)

Releases are tags: **cut a tag, push it, the server deploys it.**

```bash
git tag v1.2.3 && git push origin v1.2.3
```

Pushing a `v*` tag runs the **Deploy (CD)** workflow, which does, in order:

1. **CI gate** — the full CI suite (backend, frontend, e2e) runs against the
   *tagged commit* (`deploy.yml` reuses `ci.yml` via `workflow_call`, whose
   called run checks out the caller's SHA). A red gate aborts before anything
   touches the server.
2. **SSH deploy** — the runner connects to the server as the `deploy` user
   with a dedicated restricted key (its forced command accepts exactly
   `deploy <tag> [--dry-run]`; there is no shell to log into) and runs
   `deploy/prod-deploy.sh <tag>`, which:
   - takes a **pre-deploy database backup**
     (`backups/kindness-backup-<timestamp>.sql`, named in the run's log and
     final summary),
   - builds and cuts over (`prod up -d --build`) — a brief downtime; a failed
     build never cuts over (the old stack keeps running),
   - tags the two freshly built images with the version, so `docker images`
     shows what is running (`kindness-is-magic-backend:1.2.3`,
     `kindness-is-magic-frontend:1.2.3`),
   - smoke-checks the live site: `https://<domain>/` and `/api/health` must
     both answer 200 three times in a row (~2 min bound).

**Redeploy / rollback** — GitHub Actions → *Deploy (CD)* → *Run workflow*,
entering the tag. A manual run **skips the CI gate** (its SHA would be the
branch tip, not the tag, so gating would certify the wrong commit) and
deploys the exact tag directly — a deliberate override, e.g. an emergency
rollback to the previous tag.

**Recovering from a failed deploy job** — re-run the workflow (the gate
re-runs), or from the server:

```bash
sudo -u deploy ./deploy/prod-deploy.sh v1.2.3        # add --dry-run to stop after the checkout
```

The script is self-contained (fetch, checkout, backup, build, cutover,
smoke), but only `deploy` can write the clone and `backups/`, so the owner
account's own shell can't run it. The restricted key is the same path from
any machine: `ssh -i <deploy-key> deploy@<host> "deploy v1.2.3"`.

**One-time CD setup** (on the server, after the first-start above):

```bash
sudo ./deploy/setup-server.sh
```

It creates the password-locked `deploy` user (NOPASSWD sudo for the docker
binary only), makes it own the clone (including `.env`) and `backups/`, and
verifies that `deploy` can actually reach the clone (a clone under a home
directory it can't traverse fails here with a message saying to move it),
pins the clone's `origin` to the public HTTPS URL, installs the
forced-command wrapper at `/usr/local/bin/kindness-deploy`, and prints a
**private key once**. Then:

1. Add the private key as the repository secret **`DEPLOY_SSH_KEY`**
   (GitHub → Settings → Secrets and variables → Actions).
2. Check that **`DEPLOY_HOST`** and **`DEPLOY_SSH_PORT`** at the top of
   `.github/workflows/deploy.yml` are this server's hostname and SSH port.

The script is idempotent; re-running it **rotates the key** — replace the
secret with the freshly printed one.

**Day-to-day server access** (owner account — inspection and recovery only):

```bash
./run-compose.sh prod logs -f [backend|frontend|traefik|db|backups]
./run-compose.sh prod ps
sudo docker images # running version: kindness-is-magic-{backend,frontend}:<version>
```

- **Cert renewals are automatic** — Traefik re-issues ~30 days before each
  90-day expiry. No cron, no certbot. Requirements: apex A/AAAA record(s) +
  www CNAME still resolve, ports 80/443 still forwarded, Traefik running.
- Rate limits (login etc., 5/min per visitor) are effectively 2× looser with
  2 backend workers (per-process storage) — intentional at this scale.

### 7. Backups

All application data is in the `kindness_is_magic` Postgres volume (the
`traefik_certs` volume holds Let's Encrypt state and re-issues itself if lost —
not worth backing up), so a `pg_dump` of the database is the whole backup.

**Automatic.** The `backups` service in the prod stack runs `pg_dump` daily at
**03:00 Pacific time** (`TZ=America/Los_Angeles`, DST-aware) and writes
`backups/kindness-backup-<timestamp>.sql`, deleting dumps older than
`BACKUP_KEEP_DAYS` days (default 7 — set it in `.env`). The time and timezone
are literals in the `backups` service in `docker-compose.prod.yml`. To check:

- `./run-compose.sh prod ps` — the service goes `(unhealthy)` if no dump is
  fresher than ~25 h (expected on a fresh deploy, until the first 03:00 run).
- `ls -lt backups/` — what exists.
- `./run-compose.sh prod exec backups tail /var/log/backups.log` — a failed
  run's `pg_dump` error.

**Manual** — any time, e.g. before a risky change (writes the same files, so a
manual backup also refreshes the automatic health marker). After CD setup,
`backups/` is owned by `deploy`, so run it as that user:

```bash
sudo -u deploy ./run-compose.sh prod backup   # writes backups/kindness-backup-<timestamp>.sql
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

## License

Licensed under the [GNU GPL v3](LICENSE).

## Agent documentation

Each directory keeps its own `AGENTS.md` with patterns and conventions (soft deletes, roles and permissions, response builders, React Query usage, testing conventions, ...). Read the one for the directory you're working in before making changes there.
