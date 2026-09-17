#!/usr/bin/env bash
# One-time CD setup on the production server (the Pi). Run as root, AFTER the
# README 'Production deployment' first-start (steps 1-5) is done:
#
#   sudo ./deploy/setup-server.sh
#
# What it does (idempotent — safe to re-run; re-running ROTATES the deploy
# key, so the GitHub secret must be updated with the freshly printed one):
#
#   - creates or adopts the password-locked `deploy` user (normal shell —
#     sshd executes the forced command through the user's shell, so nologin
#     would break deploys)
#   - sudoers drop-in: NOPASSWD for the docker binary only (run-compose.sh
#     calls `sudo docker`; docker-group membership alone is insufficient)
#   - chowns the repo clone (including .env) and backups/ to the user — the
#     owner account no longer deploys (see README 'Releases (CD)')
#   - pins the clone's `origin` to the public HTTPS URL (the password-locked
#     deploy user has no SSH key — an SSH remote would make git fetch fail)
#   - installs the forced-command wrapper at /usr/local/bin/kindness-deploy
#     (parses SSH_ORIGINAL_COMMAND as `deploy <tag> [--dry-run]`, refuses
#     everything else, execs the in-repo deploy script)
#   - generates an ed25519 keypair, appends the restricted public key to
#     the deploy user's authorized_keys, and prints the private key ONCE

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_USER="deploy"
WRAPPER_SOURCE="$REPO_ROOT/deploy/ssh-wrapper.sh"
WRAPPER_PATH="/usr/local/bin/kindness-deploy"
SUDOERS_FILE="/etc/sudoers.d/kindness-deploy"
KEY_MARKER="kindness-deploy"

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: run as root:  sudo ./deploy/setup-server.sh" >&2
  exit 1
fi

# --- Preflight -----------------------------------------------------------------
if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "Error: no .env in $REPO_ROOT — do the README 'Production deployment'" >&2
  echo "first-start (steps 1-5) before running this." >&2
  exit 1
fi
if [ ! -f "$WRAPPER_SOURCE" ]; then
  echo "Error: $WRAPPER_SOURCE not found (run this from the repo clone)." >&2
  exit 1
fi
missing=""
for tool in docker git sudo visudo ssh-keygen; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Error: missing tool(s):$missing" >&2
  echo "Install them (Docker: https://docs.docker.com/engine/install/) and re-run." >&2
  exit 1
fi

# --- Deploy user -----------------------------------------------------------------
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Adopting existing user '$DEPLOY_USER'."
else
  useradd -m -s /bin/bash "$DEPLOY_USER"
  echo "Created user '$DEPLOY_USER'."
fi
# A real shell is required: sshd runs the forced command through it.
usermod -s /bin/bash "$DEPLOY_USER"
# Locked password: the account is reachable only via the restricted SSH key
# below (no password auth possible, no other key will be added by this script).
pw_field="$(getent shadow "$DEPLOY_USER" | cut -d: -f2)"
case "$pw_field" in
  '!'*)
    echo "Password for '$DEPLOY_USER' is already locked."
    ;;
  *)
    passwd -l "$DEPLOY_USER" >/dev/null
    echo "Locked the password for '$DEPLOY_USER'."
    ;;
esac

# --- Sudoers: NOPASSWD for the docker binary only ----------------------------------
docker_bin="$(command -v docker)"
tmp_sudoers="$(mktemp)"
# One EXIT trap for both temp artifacts — the body is evaluated at exit, so
# ${key_dir:-} also covers the deploy keypair created further below: an abort
# after keygen must not leave the fresh (not yet printed) private key in /tmp.
trap 'rm -f "${tmp_sudoers:-}"; rm -rf "${key_dir:-}"' EXIT
printf '%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$docker_bin" > "$tmp_sudoers"
visudo -cf "$tmp_sudoers" >/dev/null   # validate before installing
install -o root -g root -m 440 "$tmp_sudoers" "$SUDOERS_FILE"
echo "Sudoers drop-in $SUDOERS_FILE: '$DEPLOY_USER' may run '$docker_bin' with NOPASSWD (nothing else)."

# --- Ownership: the deploy user owns the clone (incl. .env) and backups/ -------------
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_ROOT"
echo "Repo clone (including .env) and backups/ are now owned by '$DEPLOY_USER'."

# --- Reachability: the deploy user must be able to reach the clone ------------------
# Every deploy (the forced command, fetch, checkout, backups) runs as the deploy
# user, so a clone under a parent dir it can't traverse breaks CD. Check as the
# owner (before the chown the repo belongs to the human account, and any user's
# git would be refused by the dubious-ownership check for the wrong reason).
if ! sudo -u "$DEPLOY_USER" git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: '$DEPLOY_USER' cannot access $REPO_ROOT (permission denied on a parent dir?)." >&2
  echo "The deploy user must reach the clone on every deploy. Move it to a neutral" >&2
  echo "location (e.g. /opt/kindness-is-magic) or add execute-for-others on each" >&2
  echo "parent dir (chmod o+x <dir>) and re-run." >&2
  exit 1
fi
echo "'$DEPLOY_USER' can access the clone at $REPO_ROOT."

# --- Pin origin to the public HTTPS URL ----------------------------------------------
# The deploy user has no SSH key; server-side fetch over HTTPS needs no
# credentials (public repo). Convert scp-like and ssh:// remotes to https://.
# Run git as the deploy user: root reading a deploy-owned clone is refused
# by git's dubious-ownership check (and would mask a real missing remote).
origin_url="$(sudo -u "$DEPLOY_USER" git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
if [ -z "$origin_url" ]; then
  echo "Error: the clone has no 'origin' remote. Set it (git remote add origin <url>) and re-run." >&2
  exit 1
fi
https_url="$(printf '%s\n' "$origin_url" \
  | sed -E 's#^git@([^:/]+):#https://\1/#; s#^ssh://git@([^/]+)/#https://\1/#')"
if [ "$https_url" != "$origin_url" ]; then
  sudo -u "$DEPLOY_USER" git -C "$REPO_ROOT" remote set-url origin "$https_url"
  echo "Pinned origin to HTTPS: $https_url"
else
  echo "Origin already HTTPS: $https_url"
fi

# Verify the deploy user can actually fetch (non-fatal: a transient network
# failure shouldn't block setup, but CD will fail until this works).
if sudo -u "$DEPLOY_USER" git -C "$REPO_ROOT" ls-remote origin HEAD >/dev/null 2>&1; then
  echo "Verified: '$DEPLOY_USER' can fetch from origin over HTTPS."
else
  echo "Warning: '$DEPLOY_USER' could not reach origin over HTTPS just now"
  echo "(network down? wrong URL? repo not public?). CD will fail until it can —"
  echo "test with: sudo -u $DEPLOY_USER git -C $REPO_ROOT ls-remote origin HEAD"
fi

# --- Forced-command wrapper (stable path, outside the repo) ---------------------------
tmp_wrapper="$(mktemp)"
# Escape the replacement (a repo path could contain & or #, which are special
# in a sed replacement with # delimiters).
esc_repo="$(printf '%s' "$REPO_ROOT" | sed -e 's/[\\&#]/\\&/g')"
sed "s#__REPO_DIR__#${esc_repo}#g" "$WRAPPER_SOURCE" > "$tmp_wrapper"
install -m 755 "$tmp_wrapper" "$WRAPPER_PATH"
rm -f "$tmp_wrapper"
echo "Installed the forced-command wrapper at $WRAPPER_PATH"
echo "(accepts exactly 'deploy <tag> [--dry-run]', execs $REPO_ROOT/deploy/prod-deploy.sh)."

# --- Deploy key ----------------------------------------------------------------------------
# A fresh keypair on every run; the previous restricted key (same marker) is
# removed first so authorized_keys doesn't accumulate dead keys.
key_dir="$(mktemp -d)"
chmod 700 "$key_dir"
ssh-keygen -t ed25519 -N '' -C "$KEY_MARKER" -f "$key_dir/deploy_key" -q

ssh_dir="/home/${DEPLOY_USER}/.ssh"
auth_file="$ssh_dir/authorized_keys"
mkdir -p "$ssh_dir"
had_old_key=0
if [ -f "$auth_file" ]; then
  if grep -q "$KEY_MARKER" "$auth_file"; then
    had_old_key=1
  fi
  grep -v "$KEY_MARKER" "$auth_file" > "$auth_file.new" || true
  mv "$auth_file.new" "$auth_file"
fi
{
  printf 'command="%s",no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc ' "$WRAPPER_PATH"
  cat "$key_dir/deploy_key.pub"
} >> "$auth_file"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ssh_dir"
chmod 700 "$ssh_dir"
chmod 600 "$auth_file"
echo "Appended the restricted public key to $auth_file (forced command: $WRAPPER_PATH)."

# --- Output -----------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo " CD setup complete. The deploy private key is shown ONCE below —"
echo " copy it now; it is not stored anywhere on this server."
echo "======================================================================"
echo ""
cat "$key_dir/deploy_key"
echo ""
if [ "$had_old_key" -eq 1 ]; then
  echo "NOTE: a previous restricted key was removed — the old GitHub secret"
  echo "      no longer works; replace it with the key above."
  echo ""
fi
echo "Next steps:"
echo " 1. GitHub -> this repo -> Settings -> Secrets and variables -> Actions:"
echo "    add (or replace) the repository secret  DEPLOY_SSH_KEY"
echo "    with the private key above (the whole -----BEGIN ... -----END block)."
echo " 2. In .github/workflows/deploy.yml, set  DEPLOY_HOST  and"
echo "    DEPLOY_SSH_PORT  at the top of the file to this server's public"
echo "    hostname (e.g. kindnessismagic.love) and SSH port."
echo " 3. Verify the wiring from this server (expect a clean 'unknown tag'"
echo "    failure — that proves key + wrapper + script all work):"
echo "      ssh -i <private-key-file> -o StrictHostKeyChecking=accept-new \\"
echo "          ${DEPLOY_USER}@<host> 'deploy v9.9.9'"
echo "      (add -p <ssh-port> if your sshd isn't on port 22)"
echo " 4. Cut the first release:"
echo "      git tag v1.0.0 && git push origin v1.0.0"
