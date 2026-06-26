#!/usr/bin/env bash
# Wrapper so `sudo docker compose` always runs from the project directory.
# Usage:
#   ./run-compose.sh up --build
#   ./run-compose.sh exec backend alembic upgrade head

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Convenience: `./run-compose.sh test` runs tests and cleans up after.
if [ "$1" = "test" ]; then
  shift
  sudo docker compose --profile test run --rm test "$@"
  sudo docker compose --profile test down -v
  exit $?
fi

exec sudo docker compose "$@"
