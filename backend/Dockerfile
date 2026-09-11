# syntax=docker/dockerfile:1

FROM python:3.11-slim AS base

WORKDIR /app

# Install runtime dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source. In dev, docker-compose.yml overrides /app with a
# host volume mount so edits hot-reload; in prod the baked-in copy is used.
COPY . .

# --- Dev: hot reload (used by docker-compose.yml) ---
FROM base AS dev
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]

# --- Prod: no reload (used by docker-compose.prod.yml). Two workers so a
# stalled event loop (async handlers doing sync DB work) halves capacity
# instead of freezing the whole site; one-shot lifespan side effects are
# guarded by a leader lock (main._try_acquire_leader_lock). Note: slowapi's
# in-memory limits are per-process, so configured limits are effectively 2x
# looser — acceptable at this scale. ---
FROM base AS prod
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
