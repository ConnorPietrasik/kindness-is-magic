#!/usr/bin/env bash
# Wrapper so `sudo docker compose` always runs from the project directory.
# Usage:
#   ./run-compose.sh up --build
#   ./run-compose.sh exec backend alembic upgrade head

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

exec sudo docker compose "$@"
