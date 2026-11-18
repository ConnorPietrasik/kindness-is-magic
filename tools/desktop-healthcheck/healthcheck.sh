#!/usr/bin/env bash
# Kindness Is Magic — desktop healthcheck.
#
# Invoked every 5 min by kim-health.timer (systemd user unit; see README.md).
# Polls the live site through its public URL — so DNS, the TLS certificate,
# NAT and Traefik are in the test, not just the app — and shows a KDE
# notification when two consecutive polls (~10 min) have failed, re-notifies
# every REALERT_EVERY polls while it stays down (so the alert is not missed),
# and again when a notified outage recovers. A single failed poll that
# recovers was never announced in the first place.
#
# Deliberately logless: nothing is written except a few bytes of streak
# state in $XDG_STATE_HOME/kim-healthcheck/state, and the unit silences
# stdout/stderr so even the journal gets nothing.
#
# KIM_HOST: bare apex hostname (no scheme). Use the apex, not www — the www
# router 301-redirects and would read as "down" here.
#
# Run manually with KIM_HOST=<host> to test a single poll.

set -u

if [ -z "${KIM_HOST:-}" ]; then
  # Fail loud through the one channel we have.
  notify-send -u critical -a "Kim healthcheck" "Kim healthcheck misconfigured" \
    "KIM_HOST is empty in ~/.config/systemd/user/kim-health.service" 2>/dev/null
  exit 0
fi

# Re-alert cadence while the site stays down, in polls (5 min each):
# after the initial alert, notify again every REALERT_EVERY failures.
# Set to 1 to re-alert on every poll once down is confirmed.
REALERT_EVERY=6

BASE="https://${KIM_HOST}"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/kim-healthcheck"
STATE_FILE="${STATE_DIR}/state"

# Previous run, one value per line:
#   1: state          ok | down
#   2: fail streak    consecutive failed polls in the current down streak
#   3: down_since     epoch the current down streak started (empty when ok)
prev=ok fails=0 down_since=
if [ -f "$STATE_FILE" ]; then
  { IFS= read -r prev || true; IFS= read -r fails || true; IFS= read -r down_since || true; } < "$STATE_FILE"
fi
case "$prev" in ok | down) ;; *) prev=ok fails=0 down_since= ;; esac
case "$fails" in '' | *[!0-9]*) fails=0 ;; esac
case "$down_since" in '' | *[!0-9]*) down_since= ;; esac

# Print "ok" or a short reason. The curl exit code is the triage info, so
# the notification can say "my network died" vs "the Pi is down":
#   6 = DNS failure   7 = connection refused   28 = timeout   35/60 = TLS
check() {
  local code rc
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      6) echo "dns-failed" ;;
      7) echo "connection-refused" ;;
      28) echo "timeout" ;;
      35 | 60) echo "tls-error" ;;
      *) echo "curl-failed(rc=${rc})" ;;
    esac
  elif [ "$code" = "200" ]; then
    echo ok
  else
    echo "http-${code}"
  fi
}

front="$(check "${BASE}/")"
api="$(check "${BASE}/api/health")"

now="$(date +%s)"
save() {
  mkdir -p "$STATE_DIR"
  printf '%s\n%s\n%s\n' "$1" "$2" "$3" > "$STATE_FILE"
}

if [ "$front" = "ok" ] && [ "$api" = "ok" ]; then
  # Only announce recovery of an announced incident: the DOWN notice fires
  # at fails == 2, so a streak of 1 was never reported.
  if [ "$prev" = "down" ] && [ "$fails" -ge 2 ]; then
    since="${down_since:-$now}"
    since_hm="$(date -d "@${since}" +%H:%M 2>/dev/null || true)"
    notify-send -a "Kim healthcheck" "Kindness Is Magic is back up" \
      "Down since ${since_hm:-?} (~$(( (now - since) / 60 )) min)."
  fi
  save ok 0 ""
else
  fails=$((fails + 1))
  [ -n "$down_since" ] || down_since=$now
  # Persist before notifying: a crash mid-notification must not lose the streak.
  save down "$fails" "$down_since"
  # Alert at the 2nd consecutive failure; while it stays down, re-alert every
  # REALERT_EVERY polls so a missed notification does not go unnoticed.
  if [ "$fails" -eq 2 ] || { [ "$fails" -gt 2 ] && [ $(( (fails - 2) % REALERT_EVERY )) -eq 0 ]; }; then
    what=""
    [ "$front" != "ok" ] && what="front=${front}"
    [ "$api" != "ok" ] && what="${what:+${what} }api=${api}"
    since_hm="$(date -d "@${down_since}" +%H:%M 2>/dev/null || true)"
    if [ "$fails" -eq 2 ]; then
      notify-send -u critical -a "Kim healthcheck" "Kindness Is Magic is DOWN" \
        "Since ${since_hm:-?}: ${what} — ${KIM_HOST}"
    else
      notify-send -u critical -a "Kim healthcheck" "Kindness Is Magic is still down" \
        "~$(( (now - down_since) / 60 )) min now (since ${since_hm:-?}): ${what} — ${KIM_HOST}"
    fi
  fi
fi

# The notification is the interface: the exit code must stay 0 even if
# notify-send itself hiccups, so the unit never reads as failed.
exit 0
