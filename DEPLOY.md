# Production Deployment (Raspberry Pi)

The Pi runs the **prod stack only** (`docker-compose.prod.yml`): Traefik (HTTPS +
Let's Encrypt) → nginx (static frontend) + FastAPI backend (2 workers) → Postgres.
Development happens on the workstation with `docker-compose.yml` — never on the Pi.

## 1. Hardware & OS

- Raspberry Pi 4B, 4 GB RAM, headless Debian (netinst image)
- `sudo apt install docker.io docker-compose-v2 git curl`
- Prefer a USB SSD over the SD card for the data volume (`kindness_is_magic`) —
  Postgres on a cheap SD card is a classic long-term failure point.

## 2. DNS & network (before first start)

- **A record:** `yourdomain.com` → the Pi's public IP
- **CNAME:** `www.yourdomain.com` → `yourdomain.com`
  (www is 301-redirected to the apex; both names are in the one Let's Encrypt
  cert — this record is re-validated at every renewal, keep it alive)
- **Router:** forward TCP **80** and **443** to the Pi's LAN IP
- Wait for propagation: `dig +short yourdomain.com` should show your public IP

## 3. Repo & `.env`

```bash
git clone <repo-url> && cd <repo>
cp .env.example .env
```

Fill in every value. **Do not copy the workstation `.env`** — it has
`DEBUG=true`, dev secrets, and no `PUBLIC_HOSTNAME`.

| Key | Notes |
|-----|-------|
| `SECRET_KEY`, `REFRESH_SECRET_KEY` | generate: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | bootstrap admin, created on first backend start — **the only way an admin is ever created** |
| `PUBLIC_HOSTNAME` | bare domain, e.g. `yourdomain.com` (no scheme) |
| `LETSENCRYPT_EMAIL` | Let's Encrypt expiry notices (safety net) |
| `APP_BASE_URL` | `https://yourdomain.com` (links in emails) |
| `DEBUG` | `false` |
| `POSTGRES_*`, `MAIL_*` | real values |

## 4. Prerequisites & start

```bash
./run-compose.sh prod setup        # toolchain + .env checks, seeds acme.json (mode 600), DNS warnings — re-runnable
./run-compose.sh prod up -d --build
```

`prod setup` never blocks on DNS warnings, but fix anything it reports before
relying on the first certificate issuance.

## 5. First visit

- From **outside the Pi** (phone/other machine): open `https://yourdomain.com`.
  The cert is issued on first contact; if you get a TLS error, wait 30–60 s
  and retry.
- Log in at `https://yourdomain.com` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## 6. Day-to-day

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

## 7. Backups

All persistent state is the `kindness_is_magic` Postgres volume. From the repo
directory, occasionally:

```bash
set -a && . ./.env && set +a
sudo docker run --rm --network kindness-is-magic_kindnet \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres:15-alpine pg_dump -h db -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "kindness-backup-$(date +%Y%m%d).sql"
```

Restore: `psql` the file back in, or wipe the volume and re-seed.

## 8. Troubleshooting

- **TLS error on first visit** — DNS or port-forwarding not live yet. Re-run
  `./run-compose.sh prod setup` to see exactly which check warns; verify with
  `dig +short yourdomain.com` from anywhere.
- **Cert renewal failing** — both A and www records must resolve (see §2);
  `./run-compose.sh prod logs -f traefik` shows the ACME error.
- **502s after a deploy** — `prod logs -f backend` (DB not ready / migration
  error / `.env` typo are the usual suspects).
- **429s** — per-visitor rate limit (auth endpoints); not a bug.
- **Factory reset (destroys all data — back up first):**
  `./run-compose.sh prod down -v` (there is deliberately no `clear` for prod).

## Notes

- `traefik:latest` is unpinned for now — pin a specific version tag when you
  want upgrade stability.
- The async route handlers doing sync DB work are why the backend runs 2
  workers (loop-stall isolation); the real fix would be async SQLAlchemy.
