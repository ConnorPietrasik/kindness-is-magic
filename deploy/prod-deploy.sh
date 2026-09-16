#!/usr/bin/env bash
# Production deploy for Kindness Is Magic (runs on the Pi).
#
# The single entrypoint for both CD (GitHub Actions -> SSH forced command,
# see deploy/ssh-wrapper.sh) and manual runs:
#
#   ./deploy/prod-deploy.sh <tag> [--dry-run]
#
# Flow:
#   1. re-exec from a per-invocation temp copy (see below)
#   2. validate the tag (v1.2.3, optional -prerelease suffix)
#   3. deploy lock (flock — the lock dies with this process)
#   4. git fetch --tags, verify the tag exists, checkout it
#      (a dirty tree is logged and reset first: under the lock it can only
#       be residue from a crashed run)
#   5. pre-deploy DB backup (./run-compose.sh prod backup)
#   6. build + cutover (./run-compose.sh prod up -d --build) — a failed
#      build never cuts over; the cutover itself is a brief downtime
#   7. tag the two freshly built images with the version (so `docker images`
#      shows what is running)
#   8. smoke: https://<PUBLIC_HOSTNAME>/ and /api/health, 3 consecutive
#      clean polls, ~2 min bound
#
# --dry-run runs everything through the checkout, then prints the commands
# it would run without executing them.
#
# Any failure from the backup stage on tails the backend container logs.
#
# This script's CLI is part of the CD contract: the *previous* release's
# copy of it executes every new deploy (the SSH wrapper hands off to the
# script at the current checkout), so keep the interface stable: one tag
# argument, optional --dry-run.

set -euo pipefail

# --- Re-exec from a per-invocation temp copy --------------------------------
# A mid-deploy `git checkout` replaces this file with a *new* inode, which is
# harmless (the running bash keeps the old inode open and finishes with its
# old content). The one vector that can corrupt a running bash is an in-place
# rewrite of the *same* inode (an editor saving without rename,
# truncate+write). Re-executing from a private temp copy is immune to both.
# The env var stops the recursion; the repo root is carried across because
# BASH_SOURCE points at /tmp after the re-exec.
if [ -z "${KIM_DEPLOY_REEXEC:-}" ]; then
  kim_tmp="$(mktemp /tmp/kindness-deploy.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$kim_tmp"
  chmod 700 "$kim_tmp"
  KIM_DEPLOY_TMP="$kim_tmp"
  KIM_DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  KIM_DEPLOY_REEXEC=1
  export KIM_DEPLOY_TMP KIM_DEPLOY_ROOT KIM_DEPLOY_REEXEC
  exec bash "$kim_tmp" "$@"
fi
trap 'rm -f "${KIM_DEPLOY_TMP:-}"' EXIT

REPO_ROOT="${KIM_DEPLOY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

# --- Arguments ----------------------------------------------------------------
tag=""
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      dry_run=1
      ;;
    -*)
      echo "Error: unknown option '$arg'." >&2
      echo "Usage: ./deploy/prod-deploy.sh <tag> [--dry-run]" >&2
      exit 2
      ;;
    *)
      if [ -n "$tag" ]; then
        echo "Error: expected exactly one tag (got: $*)." >&2
        exit 2
      fi
      tag="$arg"
      ;;
  esac
done

if [ -z "$tag" ]; then
  echo "Error: missing tag." >&2
  echo "Usage: ./deploy/prod-deploy.sh <tag> [--dry-run]" >&2
  exit 2
fi

# The tag contract, shared with the workflow docs and deploy/ssh-wrapper.sh:
# v + semver, e.g. v1.2.3 (optional -prerelease suffix, e.g. v2.0.0-rc.1).
if ! printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.+-]*)?$'; then
  echo "Error: '$tag' is not a version tag." >&2
  echo "Expected vMAJOR.MINOR.PATCH with an optional -prerelease suffix (e.g. v1.2.3, v2.0.0-rc.1)." >&2
  exit 2
fi

version="${tag#v}"

# --- Deploy lock --------------------------------------------------------------
# flock on an open fd: the lock dies with this process, so a crashed run never
# holds it. The workflow's concurrency group only coordinates workflow runs;
# manual SSH runs go through this lock.
LOCK_FILE="${HOME:?HOME not set}/.kindness-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Error: another deploy is in progress (lock: $LOCK_FILE)." >&2
  echo "Wait for it to finish, then re-run." >&2
  exit 1
fi

# --- Git ----------------------------------------------------------------------
echo "==> Fetching tags from origin: $(git remote get-url origin 2>/dev/null || echo '<no origin remote>')"
if ! git fetch origin --tags --force; then
  echo "Error: git fetch failed — nothing was changed." >&2
  if [ ! -w .git ]; then
    echo "This clone is not writable by '$(id -un)' — after CD setup it is owned" >&2
    echo "by 'deploy'. Re-run as that user, e.g.:" >&2
    echo "  sudo -u deploy ./deploy/prod-deploy.sh $tag" >&2
  else
    echo "Is the network up (and the origin URL reachable)?" >&2
  fi
  exit 1
fi

if ! tag_sha="$(git rev-parse -q --verify "refs/tags/${tag}^{commit}")"; then
  echo "Error: unknown tag '$tag' — nothing was changed." >&2
  echo "Available version tags: $(git tag -l 'v*' | tr '\n' ' ')" >&2
  exit 1
fi

# Under the deploy lock the only writer that can leave this clone dirty is a
# previously crashed deploy (backup writes and .env are gitignored; the owner
# no longer works in this clone by design), so a dirty tree is crash residue,
# never live work: log it, reset, continue.
if [ -n "$(git status --porcelain)" ]; then
  echo "==> Dirty working tree (leftover from a crashed run?) — resetting:"
  git status --porcelain
  git reset --hard -q
fi

echo "==> Checking out $tag ($(git rev-parse --short "$tag_sha")) ..."
git checkout -q "$tag"

# PUBLIC_HOSTNAME, the same first-match-grep way run-compose.sh reads .env.
# (|| true: a missing .env/key must read as empty, not abort under pipefail —
# the backup stage then fails with the first-start message.)
PUBLIC_HOSTNAME="$(grep -m1 '^PUBLIC_HOSTNAME=' .env 2>/dev/null | cut -d'=' -f2- | tr -d "'\"" || true)"

if [ "$dry_run" -eq 1 ]; then
  echo ""
  echo "== DRY RUN: fetched, verified and checked out $tag. The real deploy would now run:"
  echo "   ./run-compose.sh prod backup"
  echo "   ./run-compose.sh prod up -d --build"
  echo "   sudo docker tag kindness-is-magic-backend:latest kindness-is-magic-backend:${version}"
  echo "   sudo docker tag kindness-is-magic-frontend:latest kindness-is-magic-frontend:${version}"
  if [ -n "$PUBLIC_HOSTNAME" ]; then
    echo "   smoke check: https://${PUBLIC_HOSTNAME}/ and https://${PUBLIC_HOSTNAME}/api/health (3 consecutive 200s, ~2 min bound)"
  else
    echo "   smoke check: https://<PUBLIC_HOSTNAME unset in .env> ... (this would fail)"
  fi
  echo "== DRY RUN complete (no cutover)."
  exit 0
fi

# The prod stack is involved from here on, so every failure tails the backend
# container logs to stdout (docker logs works on stopped containers too).
tail_backend_logs() {
  echo ""
  echo "--- last 100 lines of the backend container logs ---"
  sudo docker compose -f docker-compose.prod.yml logs --tail 100 backend 2>&1 || true
  echo "--- end of backend logs ---"
}

fail() {
  echo ""
  echo "ERROR: ${1:-deploy failed}"
  tail_backend_logs
  exit 1
}

# --- Pre-deploy backup ----------------------------------------------------------
echo "==> Pre-deploy database backup ..."
backup_rc=0
backup_output="$(./run-compose.sh prod backup 2>&1)" || backup_rc=$?
if [ "$backup_rc" -ne 0 ]; then
  printf '%s\n' "$backup_output"
  echo ""
  echo "Error: pre-deploy backup failed — the prod stack is not running (or Postgres is unhealthy)."
  echo "If this is the first deploy, do the README 'Production deployment' first-start"
  echo "(steps 1-5) first, then re-run. Otherwise start the stack manually"
  echo "(./run-compose.sh prod up -d) and re-run."
  tail_backend_logs
  exit 1
fi
printf '%s\n' "$backup_output"
backup_file="$(printf '%s\n' "$backup_output" | sed -n 's/^Backup written: \(.*\)$/\1/p' | tail -n 1)"

# --- Build + cutover --------------------------------------------------------------
echo "==> Building images and cutting over (brief downtime) ..."
./run-compose.sh prod up -d --build || fail "build/cutover failed — see the backend logs below"

# --- Tag the freshly built images ---------------------------------------------------
# Compose names its built images <project>-<service>:latest (project name from
# the top-level `name:` in docker-compose.prod.yml). Tagging them with the
# version is what makes `docker images` show what is running.
echo "==> Tagging the built images as :${version} ..."
sudo docker tag "kindness-is-magic-backend:latest" "kindness-is-magic-backend:${version}" \
  || fail "could not tag kindness-is-magic-backend:latest (image missing — did the build really run?)"
sudo docker tag "kindness-is-magic-frontend:latest" "kindness-is-magic-frontend:${version}" \
  || fail "could not tag kindness-is-magic-frontend:latest (image missing — did the build really run?)"

# --- Smoke check ----------------------------------------------------------------------
# Polls https://$PUBLIC_HOSTNAME/ and /api/health through local Traefik:
# --resolve pins the hostname to 127.0.0.1, so TLS and certificate verification
# stay real and there is no dependence on the router's NAT hairpin. Pass = 3
# consecutive clean polls: a crash-looping backend alternates 502 (container
# up, no healthy server) with 503 (in the gaps between restarts), and one
# lucky poll must not pass.
smoke_check() {
  local host="$1"
  local base="https://${host}"
  local deadline consecutive=0 attempt=0 code_front code_api
  deadline=$(( $(date +%s) + 120 ))

  echo "==> Smoke check: ${base}/ and ${base}/api/health (3 consecutive 200s, ~2 min bound) ..."
  while :; do
    attempt=$(( attempt + 1 ))
    code_front="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "${host}:443:127.0.0.1" "${base}/" || true)"
    code_api="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "${host}:443:127.0.0.1" "${base}/api/health" || true)"
    if [ "$code_front" = "200" ] && [ "$code_api" = "200" ]; then
      consecutive=$(( consecutive + 1 ))
      if [ "$consecutive" -ge 3 ]; then
        echo "Smoke check passed (poll ${attempt})."
        return 0
      fi
    else
      consecutive=0
      echo "  poll ${attempt}: frontend=${code_front} api=${code_api} (streak reset)"
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Error: smoke check did not pass within ~2 minutes." >&2
      return 1
    fi
    sleep 5
  done
}

if [ -z "$PUBLIC_HOSTNAME" ]; then
  fail "PUBLIC_HOSTNAME is empty in .env — cannot smoke-check the site"
fi
smoke_check "$PUBLIC_HOSTNAME" || fail "smoke check failed — the new stack is not serving cleanly (see the backend logs below)"

# --- Summary -------------------------------------------------------------------------
echo ""
echo "================= DEPLOY OK ================="
echo "  tag:      $tag"
echo "  commit:   $(git rev-parse --short "$tag_sha")"
echo "  backup:   ${backup_file:-<unknown>}"
echo "  images:   kindness-is-magic-backend:${version}, kindness-is-magic-frontend:${version}"
echo "  site:     https://${PUBLIC_HOSTNAME} (smoke passed: 3 consecutive 200s)"
echo "============================================="
