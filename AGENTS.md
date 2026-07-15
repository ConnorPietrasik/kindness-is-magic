# Kindness Is Magic — Agent Instructions

## Environment Constraints

- **You are running inside a minimal Docker container (Arch Linux).**
- **Python 3.14 and Ruff are installed.** Use `python3` and `ruff` for backend work. You can run `ruff check`, `ruff format`, and import-check the codebase.
- **No Docker-in-Docker.** The test suite requires a Postgres container (`test_db`) that you cannot start. Do not attempt `docker compose` or `docker run`.
- **No root/sudo access.** You cannot install system packages.
- **Node.js and npm ARE available** (v26/v11). You can run frontend tooling from `frontend/` (`npm run typecheck`, `npm run lint`, `npm run build`, etc.).
- **Basic shell commands work:** `ls`, `grep`, `find`, `sed`, `awk`, etc.

## Testing

- The backend tests (`backend/tests/`) require a live Postgres database. They **cannot be run** in this environment.
- Use `ruff check backend/` and `ruff format --check backend/` to validate code quality.
- You can also use `python3 -c "import ..."` to verify imports and basic logic.

## Project Structure

- `backend/` — FastAPI + SQLAlchemy backend (Python)
- `frontend/` — React + Vite frontend (TypeScript)
