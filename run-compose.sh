#!/usr/bin/env bash
# Wrapper so `sudo docker compose` always runs from the project directory.
# Usage:
#   ./run-compose.sh up --build
#   ./run-compose.sh exec backend alembic upgrade head

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
  sudo docker compose --profile test down -v --remove-orphans 2>/dev/null
  cleanup() {
    sudo docker rm -f kindness-is-magic-test_db-1 2>/dev/null || true
    sudo docker network rm kindness-is-magic_kindnet 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM
  sudo docker compose --profile test up test_db "$@"
  exit $?
fi

exec sudo docker compose "$@"
