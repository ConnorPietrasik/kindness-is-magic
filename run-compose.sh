#!/usr/bin/env bash
# Wrapper so `sudo docker compose` always runs from the project directory.
# Usage:
#   ./run-compose.sh <compose args>                       dev stack (e.g. up --build, exec backend alembic upgrade head)
#   ./run-compose.sh clear                                remove all containers, volumes, networks incl. the DB volume (DEBUG=true only)
#   ./run-compose.sh test                                 one-shot backend tests: test DB + pytest in a container, cleans up after itself
#   ./run-compose.sh testdb                               start the test DB attached (Ctrl+C tears it down)
#   ./run-compose.sh prod <compose args>                  production stack (e.g. up -d --build)
#   ./run-compose.sh prod setup                           one-time prod prerequisites: toolchain/.env checks, acme.json, DNS warnings
#   ./run-compose.sh prod backup                          dump the production DB to backups/kindness-backup-<timestamp>.sql
#   ./run-compose.sh prod restore-from-backup <backup.sql>   restore it (DESTRUCTIVE, double-confirmed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Read a variable from the .env file (first match, no quotes)
env_get() {
  local key="$1"
  local value
  value=$(grep -m1 "^${key}=" .env 2>/dev/null | cut -d'=' -f2- | tr -d "'\"")
  echo "$value"
}

# Read a variable from the .env.example file (first match, no quotes)
example_get() {
  local key="$1"
  local value
  value=$(grep -m1 "^${key}=" .env.example 2>/dev/null | cut -d'=' -f2- | tr -d "'\"")
  echo "$value"
}

# One-time production prerequisites before the first `prod up` (idempotent —
# safe to re-run any time). Usage: ./run-compose.sh prod setup
prod_setup() {
  # Toolchain preflight — check only, never install (this script is meant to
  # work on any distro: Debian, Fedora, ...).
  command -v docker >/dev/null 2>&1 || {
    echo "Error: docker not found. Install Docker Engine first:"
    echo "  https://docs.docker.com/engine/install/  (has a page per distro)"
    exit 1
  }
  if ! sudo docker compose version >/dev/null 2>&1; then
    echo "Error: the Docker Compose plugin ('docker compose') is not available."
    echo "  Install it: https://docs.docker.com/compose/install/"
    exit 1
  fi
  command -v curl >/dev/null 2>&1 || {
    echo "Error: curl not found (needed for the public-IP DNS check)."
    echo "  Install it for your distro — it's in the main repos everywhere."
    exit 1
  }

  # --- .env preflight ---------------------------------------------------------
  if [ ! -f .env ]; then
    echo "Error: no .env in ${SCRIPT_DIR} — copy .env.example to .env and fill in real values."
    exit 1
  fi

  local missing=()
  local example_keys=()
  local var value example_value
  for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
             SECRET_KEY REFRESH_SECRET_KEY \
             ADMIN_EMAIL ADMIN_PASSWORD \
             APP_BASE_URL \
             MAIL_USERNAME MAIL_PASSWORD MAIL_FROM \
             PUBLIC_HOSTNAME LETSENCRYPT_EMAIL; do
    value="$(env_get "$var")"
    if [ -z "$value" ]; then
      missing+=("$var")
      continue
    fi
    example_value="$(example_get "$var")"
    if [ -n "$example_value" ] && [ "$value" = "$example_value" ]; then
      example_keys+=("$var")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Error: .env is missing required production values:"
    printf '  - %s\n' "${missing[@]}"
    exit 1
  fi
  if [ "${#example_keys[@]}" -gt 0 ]; then
    echo "Error: .env still has the value from .env.example — replace it for production:"
    printf '  - %s\n' "${example_keys[@]}"
    exit 1
  fi

  # Dev/e2e-only Zeffy values: a production backend pointed at the mock would
  # 502 every checkout, and ZEFFY_MIN_INTERVAL_SECONDS=0 disables the throttle
  # protecting the rate-limited real API — refuse the committed dev values.
  local zeffy_dev_vars=()
  for var in ZEFFY_API_KEY ZEFFY_API_BASE ZEFFY_MIN_INTERVAL_SECONDS; do
    value="$(env_get "$var")"
    example_value="$(example_get "$var")"
    if [ -n "$value" ] && [ "$value" = "$example_value" ]; then
      zeffy_dev_vars+=("$var")
    fi
  done
  if [ "${#zeffy_dev_vars[@]}" -gt 0 ]; then
    echo "Error: .env still has dev/e2e Zeffy values from .env.example:"
    printf '  - %s\n' "${zeffy_dev_vars[@]}"
    echo "Set real Zeffy credentials for production (or leave ZEFFY_API_BASE / ZEFFY_MIN_INTERVAL_SECONDS unset)."
    exit 1
  fi

  if [ "$(env_get DEBUG)" = "true" ]; then
    echo "Warning: DEBUG=true in .env — production would run with insecure cookies and no rate limiting."
  fi

  # --- Let's Encrypt storage ---------------------------------------------------
  # Traefik requires acme.json to be mode 600. Seed the named volume
  # (kindness-is-magic_ prefix comes from `name:` in docker-compose.prod.yml)
  # with the file + perms — touch/chmod are no-ops if it already exists.
  local vol="kindness-is-magic_traefik_certs"
  echo "Seeding Let's Encrypt storage (volume: ${vol})..."
  sudo docker volume create "$vol" >/dev/null
  sudo docker run --rm -v "${vol}:/data" alpine:3 \
    sh -c 'touch /data/acme.json && chmod 600 /data/acme.json'
  echo "acme.json ready (mode 600)."

  # --- Backup storage ---------------------------------------------------------
  # The prod stack bind-mounts ./backups (the backups service writes daily
  # dumps there). Create it before the first `prod up` so it is owned by this
  # user — otherwise Docker creates the mount source as root, and the manual
  # `prod backup` can no longer write to it.
  mkdir -p backups
  echo "backups/ ready (target of the daily automatic backups)."

  # --- Advisory DNS checks (warnings only, never block) -------------------------
  local host dns_out a_record aaaa_record www_resolved box_ip4 box_ip6 problem shown
  local problems=()
  host="$(env_get PUBLIC_HOSTNAME)"

  # Compare A/AAAA records against this box's public egress address, per family.
  # The box may be IPv4-only, IPv6-only, or dual-stack, and a plain
  # ifconfig.me call returns whichever family the resolver prefers — so each
  # record is compared with the box's address in the same family only.
  dns_out="$(getent hosts "$host" 2>/dev/null || true)"
  a_record="$(printf '%s\n' "$dns_out" | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $1; exit}')"
  aaaa_record="$(printf '%s\n' "$dns_out" | awk '$1 ~ /:/ {print $1; exit}')"
  shown="${a_record}"
  [ -n "$aaaa_record" ] && shown="${shown:+${shown}, }${aaaa_record}"
  if [ -z "$dns_out" ]; then
    echo "Warning: DNS — '${host}' does not resolve yet."
    echo "         Let's Encrypt (and visitors) will fail until an A or AAAA record points at this server."
  else
    box_ip4="$(curl -4 -fsS --max-time 10 ifconfig.me 2>/dev/null || true)"
    box_ip6="$(curl -6 -fsS --max-time 10 ifconfig.me 2>/dev/null || true)"
    if [ -z "$box_ip4" ] && [ -z "$box_ip6" ]; then
      echo "DNS check: '${host}' -> ${shown} (could not determine this box's public IP; skipped comparison)."
    else
      if [ -n "$box_ip4" ]; then
        if [ "$a_record" = "$box_ip4" ]; then
          :
        elif [ -z "$a_record" ]; then
          problems+=("no A record found (this box's public IPv4 is ${box_ip4})")
        else
          problems+=("A record is ${a_record}, but this box's public IPv4 is ${box_ip4}")
        fi
      elif [ -n "$a_record" ]; then
        problems+=("A record is ${a_record}, but this box has no public IPv4 — IPv4 visitors will not reach this box")
      fi
      if [ -n "$box_ip6" ]; then
        if [ "$aaaa_record" = "$box_ip6" ]; then
          :
        elif [ -z "$aaaa_record" ]; then
          problems+=("no AAAA record found (this box's public IPv6 is ${box_ip6})")
        else
          problems+=("AAAA record is ${aaaa_record}, but this box's public IPv6 is ${box_ip6}")
        fi
      elif [ -n "$aaaa_record" ]; then
        problems+=("AAAA record is ${aaaa_record}, but this box has no public IPv6 — IPv6 visitors will not reach this box")
      fi
      if [ "${#problems[@]}" -eq 0 ]; then
        echo "DNS check OK: '${host}' -> ${shown} (this box's public IP)."
      else
        echo "Warning: DNS — '${host}' is not set up to reach this box:"
        for problem in "${problems[@]}"; do
          echo "         - ${problem}"
        done
        echo "         Point the A/AAAA records at this box's public IP(s) and forward TCP 80/443 on your router."
      fi
    fi
  fi

  www_resolved="$(getent hosts "www.${host}" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$www_resolved" ]; then
    echo "Warning: DNS — 'www.${host}' does not resolve yet (CNAME at the apex)."
    echo "         Needed for the www 301 redirect and for cert renewals to keep working."
  else
    echo "DNS check OK: 'www.${host}' -> ${www_resolved}."
  fi

  echo ""
  echo "Setup complete. Next: ./run-compose.sh prod up -d --build"
}

# Dump the production database to backups/kindness-backup-<timestamp>.sql.
# Usage: ./run-compose.sh prod backup
prod_backup() {
  local pg_user pg_pass pg_db backup_file
  pg_user="$(env_get POSTGRES_USER)"
  pg_pass="$(env_get POSTGRES_PASSWORD)"
  pg_db="$(env_get POSTGRES_DB)"
  if [ -z "$pg_user" ] || [ -z "$pg_pass" ] || [ -z "$pg_db" ]; then
    echo "Error: POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB must be set in .env." >&2
    exit 1
  fi
  mkdir -p backups
  backup_file="backups/kindness-backup-$(date +%Y%m%d-%H%M%S).sql"
  echo "Dumping ${pg_db} -> ${backup_file} ..."
  # The client image matches the db service so dumps stay restorable.
  if ! sudo docker run --rm \
      --network kindness-is-magic_kindnet \
      -e PGPASSWORD="$pg_pass" \
      postgres:15-alpine pg_dump -h db -U "$pg_user" "$pg_db" > "$backup_file"; then
    rm -f "$backup_file"
    echo "Error: pg_dump failed (is the prod stack running? ./run-compose.sh prod ps)." >&2
    exit 1
  fi
  echo "Backup written: ${SCRIPT_DIR}/${backup_file}"
}

# Restore the production database from a backup file.
# DESTROYS the current database. Usage:
#   ./run-compose.sh prod restore-from-backup <backup.sql>
prod_restore() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    echo "Usage: ./run-compose.sh prod restore-from-backup <backup.sql>" >&2
    echo "Available backups:" >&2
    (ls -1t backups/kindness-backup-*.sql 2>/dev/null || true) >&2
    exit 1
  fi
  # A bare filename is resolved against the backups folder.
  if [ ! -s "$file" ] && [ -s "backups/${file}" ]; then
    file="backups/${file}"
  fi
  if [ ! -s "$file" ]; then
    echo "Error: no such (non-empty) backup file: ${file}" >&2
    exit 1
  fi

  local pg_user pg_pass pg_db
  pg_user="$(env_get POSTGRES_USER)"
  pg_pass="$(env_get POSTGRES_PASSWORD)"
  pg_db="$(env_get POSTGRES_DB)"
  if [ -z "$pg_user" ] || [ -z "$pg_pass" ] || [ -z "$pg_db" ]; then
    echo "Error: POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB must be set in .env." >&2
    exit 1
  fi

  # Two confirmations: the live database is erased permanently.
  local answer
  echo "This will DESTROY the current production database (${pg_db}) and replace"
  echo "it with the state captured in: ${file}"
  read -r -p "Type 'yes' to continue: " answer
  if [ "$answer" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
  local backup_base
  backup_base="$(basename "$file")"
  read -r -p "FINAL: the current database will be permanently erased. Type the backup filename to proceed: " answer
  if [ "$answer" != "$file" ] && [ "$answer" != "$backup_base" ]; then
    echo "Aborted."
    exit 1
  fi

  # Stop the stack (no -v: keep traefik_certs so Let's Encrypt state survives
  # the incident), then drop only the db volume. The kindness-is-magic_ prefix
  # comes from `name:` in docker-compose.prod.yml.
  sudo docker compose -f docker-compose.prod.yml down
  sudo docker volume rm kindness-is-magic_kindness_is_magic 2>/dev/null || true
  sudo docker compose -f docker-compose.prod.yml up -d --wait db
  if ! sudo docker compose -f docker-compose.prod.yml exec -T \
      -e PGPASSWORD="$pg_pass" \
      db psql -h localhost -v ON_ERROR_STOP=1 -U "$pg_user" "$pg_db" < "$file"; then
    echo "Error: restore failed — the stack is down and the db is left running" >&2
    echo "       with partial data for inspection (./run-compose.sh prod logs db)." >&2
    exit 1
  fi
  sudo docker compose -f docker-compose.prod.yml up -d
  echo "Restore complete."
}

# Production: same conveniences, but always against docker-compose.prod.yml.
if [ "$1" = "prod" ]; then
  shift
  if [ "$1" = "setup" ]; then
    prod_setup
    exit 0
  fi
  if [ "$1" = "backup" ]; then
    prod_backup
    exit 0
  fi
  if [ "$1" = "restore-from-backup" ]; then
    prod_restore "${2:-}"
    exit 0
  fi
  exec sudo docker compose -f docker-compose.prod.yml "$@"
fi

# Convenience: `./run-compose.sh clear` removes all containers, volumes, and
# networks for the project, including the persistent database volume.
# Only allowed when DEBUG is set to a truthy value.
if [ "$1" = "clear" ]; then
  if [ "$(env_get DEBUG)" != "true" ]; then
    echo "Error: 'clear' is only available when DEBUG=true in .env."
    exit 1
  fi
  sudo docker compose down -v --remove-orphans
  sudo docker compose --profile test down -v --remove-orphans 2>/dev/null || true
  # Also remove the named db volume (compose down -v may miss it if no service
  # is using it at that point)
  sudo docker volume rm kindness_is_magic 2>/dev/null || true
  # Remove the project network if it still exists
  sudo docker network rm kindness-is-magic_kindnet 2>/dev/null || true
  # Prune any leftover anonymous/orphan volumes (e.g. from interrupted builds)
  sudo docker volume prune -f
  echo "Cleared all containers, volumes, and networks."
  exit 0
fi

# Convenience: `./run-compose.sh test` runs tests and cleans up after.
if [ "$1" = "test" ]; then
  shift
  sudo docker compose --profile test down -v --remove-orphans 2>/dev/null
  sudo docker compose --profile test run --rm test "$@"
  sudo docker compose --profile test down -v --remove-orphans
  exit $?
fi

# Convenience: `./run-compose.sh testdb` starts test_db attached (with logs),
# and tears everything down when you Ctrl+C or it exits.
if [ "$1" = "testdb" ]; then
  shift
  cleanup() {
    sudo docker rm -f kindness-is-magic-test_db-1 2>/dev/null || true
    sudo docker network rm kindness-is-magic_kindnet 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM
  sudo docker compose --profile test up test_db "$@"
  exit $?
fi

exec sudo docker compose "$@"
