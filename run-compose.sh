#!/usr/bin/env bash
# Wrapper so `sudo docker compose` always runs from the project directory.
# Usage:
#   ./run-compose.sh up --build
#   ./run-compose.sh exec backend alembic upgrade head
#   ./run-compose.sh prod up -d --build   (production stack)
#   ./run-compose.sh prod setup           (one-time prod prerequisites)

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
    echo "Error: the 'docker compose' v2 plugin is not available."
    echo "  Install it for your distro (Debian/Ubuntu: docker-compose-v2, Fedora: docker-compose)."
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
  local var
  for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
             SECRET_KEY REFRESH_SECRET_KEY \
             ADMIN_EMAIL ADMIN_PASSWORD \
             PUBLIC_HOSTNAME LETSENCRYPT_EMAIL; do
    if [ -z "$(env_get "$var")" ]; then
      missing+=("$var")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Error: .env is missing required production values:"
    printf '  - %s\n' "${missing[@]}"
    exit 1
  fi

  if [[ "$(env_get POSTGRES_USER)" == *replace* ]]; then
    echo "Error: POSTGRES_USER still has the .env.example placeholder — set real Postgres credentials."
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

  # --- Advisory DNS checks (warnings only, never block) -------------------------
  local host resolved www_resolved public_ip
  host="$(env_get PUBLIC_HOSTNAME)"

  # Compare the IPv4 A record against this box's public IPv4 egress address.
  dns_out="$(getent hosts "$host" 2>/dev/null || true)"
  resolved="$(printf '%s\n' "$dns_out" | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $1; exit}')"
  if [ -z "$dns_out" ]; then
    echo "Warning: DNS — '${host}' does not resolve yet."
    echo "         Let's Encrypt (and visitors) will fail until an A record points at this server."
  elif [ -z "$resolved" ]; then
    echo "DNS check: '${host}' resolves but has no IPv4 A record — verify the A/AAAA records manually."
  else
    public_ip="$(curl -fsS --max-time 10 ifconfig.me 2>/dev/null || true)"
    if [ -z "$public_ip" ]; then
      echo "DNS check: '${host}' -> ${resolved} (could not determine this box's public IP; skipped comparison)."
    elif [ "$resolved" != "$public_ip" ]; then
      echo "Warning: DNS — '${host}' resolves to ${resolved}, but this box's public IP is ${public_ip}."
      echo "         Point the A record at your public IP and forward TCP 80/443 on your router."
    else
      echo "DNS check OK: '${host}' -> ${resolved} (this box's public IP)."
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

# Production: same conveniences, but always against docker-compose.prod.yml.
if [ "$1" = "prod" ]; then
  shift
  if [ "$1" = "setup" ]; then
    prod_setup
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
