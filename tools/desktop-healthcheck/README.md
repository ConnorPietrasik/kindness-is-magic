# Desktop healthcheck

A KDE notification when the live site has been down for ~10 min (two
consecutive 5-min polls of `https://<KIM_HOST>/` and `/api/health`), a
re-notification every 30 min while it stays down (so the first one is not
missed), and again on recovery. A single failed poll that recovers is never
announced.

Re-alert cadence is `REALERT_EVERY` near the top of `healthcheck.sh` (in
5-min polls; set to 1 to re-alert on every poll once down is confirmed —
a single blip still never alerts).

Logless: only a few bytes of streak state in
`~/.local/state/kim-healthcheck/`; the unit silences stdout/stderr so the
journal gets nothing.

## Install (once per machine)

```sh
install -m755 tools/desktop-healthcheck/healthcheck.sh "$HOME/.local/bin/kim-healthcheck"
mkdir -p "$HOME/.config/systemd/user"
install -m644 -t "$HOME/.config/systemd/user" \
  tools/desktop-healthcheck/kim-health.service \
  tools/desktop-healthcheck/kim-health.timer
# set KIM_HOST=<your PUBLIC_HOSTNAME — the apex, not www> in
# ~/.config/systemd/user/kim-health.service, then:
systemctl --user daemon-reload
systemctl --user enable --now kim-health.timer
```

www must not be used: its router 301-redirects, so every poll would read as
"down".

## Try it

```sh
KIM_HOST=kindnessismagic.love ~/.local/bin/kim-healthcheck    # one poll now
```

Quiet if the site is up. A lone failed poll is quiet too; two failures in a
row fire the DOWN notification, and the next good poll announces the recovery.

`systemctl --user status kim-health.timer` shows the next run.
