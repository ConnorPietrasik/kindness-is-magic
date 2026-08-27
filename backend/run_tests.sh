#!/usr/bin/env bash
# Run backend unit tests in parallel (pytest-xdist) against the Postgres test DB.
#
# Usage:
#   ./run_tests.sh                                  # full suite
#   ./run_tests.sh tests/test_purchaser_routes.py   # a subset of files
#   ./run_tests.sh -k display_id                    # extra pytest args pass through
#
# Env:
#   DATABASE_URL  test DB URL (default: localhost:5433, see conftest.py)
set -euo pipefail
cd "$(dirname "$0")"

PYBIN="../.venv/bin/python"
DB_URL="${DATABASE_URL:-postgresql+psycopg://KindDB:testpassword@localhost:5433/kindness_is_magic_test}"

# Fail fast with a clear message if the test DB isn't up.
# psycopg doesn't understand SQLAlchemy's +psycopg driver suffix, so strip it.
if ! "$PYBIN" -c "import psycopg, sys; psycopg.connect(sys.argv[1], connect_timeout=3).close()" "${DB_URL/+psycopg/}" 2>/dev/null; then
  echo "ERROR: test DB unreachable at $DB_URL" >&2
  echo "Start it first: ./run-compose.sh --profile test up test_db (from project root)" >&2
  exit 1
fi

exec env DATABASE_URL="$DB_URL" "$PYBIN" -m pytest -n auto -q --tb=short "$@"
