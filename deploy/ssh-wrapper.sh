#!/bin/sh
# Forced-command entrypoint for the Kindness Is Magic deploy key.
#
# Installed by deploy/setup-server.sh at /usr/local/bin/kindness-deploy —
# outside the repo on purpose, so the entrypoint itself survives repo
# checkouts. The deploy key's authorized_keys line forces *every* SSH
# session with that key to run this script, whatever command the client
# requested; the requested command arrives in SSH_ORIGINAL_COMMAND and must
# be exactly:
#
#   deploy <tag> [--dry-run]
#
# Anything else is refused. On success this hands off to the in-repo deploy
# script at the *current* checkout of the clone — i.e. the previous
# release's prod-deploy.sh executes the new deploy (version skew is
# intentional; that script's interface must stay stable).

REPO_DIR="__REPO_DIR__"

cmd="${SSH_ORIGINAL_COMMAND:-}"

case "$cmd" in
  "deploy "*)
    rest="${cmd#deploy }"
    ;;
  *)
    echo "refused: only 'deploy <tag> [--dry-run]' is allowed on this key (got: ${cmd:-<empty>})" >&2
    exit 1
    ;;
esac

# Word-split the rest (no valid argument contains whitespace — the tag is
# validated below). Globbing is off so a hostile tag like v1*2 can't expand.
set -f
# shellcheck disable=SC2086
set -- $rest
set +f

tag=""
dry=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      dry="--dry-run"
      ;;
    -*)
      echo "refused: unknown option '$arg' (got: $cmd)" >&2
      exit 1
      ;;
    *)
      if [ -n "$tag" ]; then
        echo "refused: expected exactly one tag (got: $cmd)" >&2
        exit 1
      fi
      tag="$arg"
      ;;
  esac
done

if [ -z "$tag" ]; then
  echo "refused: expected 'deploy <tag> [--dry-run]' (got: ${cmd:-<empty>})" >&2
  exit 1
fi

# The tag contract, shared with the workflow docs and deploy/prod-deploy.sh.
if ! printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.+-]*)?$'; then
  echo "refused: '$tag' is not a version tag (expected vMAJOR.MINOR.PATCH, optional -prerelease suffix)" >&2
  exit 1
fi

script="$REPO_DIR/deploy/prod-deploy.sh"
if [ ! -f "$script" ]; then
  echo "refused: $script not found in the repo checkout" >&2
  exit 1
fi

# shellcheck disable=SC2086
exec "$script" "$tag" $dry
