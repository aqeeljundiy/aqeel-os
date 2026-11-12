#!/bin/bash
# The launcher of a box's always-on services (tmux sessions), run as the box user as ~/services.sh. Safe to re-run: a session
# that exists is left alone. In git since 12 Nov 2026 (it was a hand-edited file outside it, and the two servers had drifted
# apart); every deploy installs it through scripts/services-install.sh, which never overwrites a box-specific edit.
# What differs per install is detected or set in <data folder>/services.conf (one "name=on|off" per line, default auto):
#   adspower-bridge  auto: on when the data folder has agent-adspower.json (agents with their own AdsPower)
#   nightly          auto: on when ~/nightly-engine-restart.sh is executable (asks aqeelOS for the nightly engine restart at 02:00 Jakarta; the file itself is only the marker now)
# Online Code starts only while ~/.aqeelos-online-code exists (aqeelOS writes it from System > Settings). Its public hosts are
# CODE_HOST / CODE_PREVIEW_HOST from ~/apps/hermes-ui.env (read as text, never run). Secrets stay in the env files: nothing here.
# NEVER exits non-zero: a deploy treats that as a failed go-live (11 Nov 2026), so every optional part is an if, every start
# says what it could not do, and the last line is exit 0.
export PATH=$HOME/.local/bin:$PATH
if [ -f ~/.hermes/.env ]; then set -a; . ~/.hermes/.env; set +a; fi
DATA=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}
# CR-5 (security audit of 12 Nov 2026): the sessions' logs were /tmp/<name>.log, readable by every user on the box, and the
# gateway's holds the agents' tool-server addresses with their signatures. They are in ~/logs/aqeelos now (AQ_LOGS), a folder
# only the box user can open, each file 600. A log over 20 MB keeps its last 2 MB (the rest stays once as <name>.log.1); that
# is looked at each time this script runs (every deploy and box start). A session that is already running keeps writing where
# it was started (its old /tmp file is closed to others here) until it next restarts.
umask 077
LOGS=${AQ_LOGS:-$HOME/logs/aqeelos}
mkdir -p "$LOGS/.cmd" 2>/dev/null; chmod 700 "$HOME/logs" "$LOGS" "$LOGS/.cmd" 2>/dev/null
for f in "$LOGS"/*.log; do [ -f "$f" ] && [ ! -L "$f" ] || continue
 if [ "$(wc -c < "$f")" -gt 20971520 ]; then cp "$f" "$f.1" 2>/dev/null; tail -c 2097152 "$f" > "$f.tmp" && cat "$f.tmp" > "$f"; rm -f "$f.tmp"; fi; done
for f in xvfb wm vnc novnc adspower-bridge gateway dashboard ui code nightly; do [ -f "/tmp/$f.log" ] && [ -O "/tmp/$f.log" ] && [ ! -L "/tmp/$f.log" ] && chmod 600 "/tmp/$f.log"; done
# M16: a session that exists is left alone, so a changed command never reached a running one (the nightly session went on
# running a retired script). Each session's command is kept in $LOGS/.cmd/<name>; a session that is safe to restart (nobody's
# work runs in it) is started again when its command differs. The engine, the UI and the screen are never restarted here.
RESTART_SAFE="nightly novnc vnc adspower-bridge"
start(){ local n=$1 c=$2 log="$LOGS/$1.log" rec="$LOGS/.cmd/$1"
 if tmux has-session -t "=$n" 2>/dev/null; then
  case " $RESTART_SAFE " in *" $n "*) [ "$(cat "$rec" 2>/dev/null)" = "$c" ] && return 0; tmux kill-session -t "=$n" 2>/dev/null; echo "· services.sh: $n is started again (its command changed)" ;; *) return 0 ;; esac
 fi
 : >> "$log" 2>/dev/null; chmod 600 "$log" 2>/dev/null
 if tmux new-session -d -s "$n" "umask 077; cd ~; $c 2>&1 | tee -a '$log'"; then printf '%s' "$c" > "$rec" 2>/dev/null; else echo "! services.sh: could not start $n"; fi; return 0; }
# a value from a "name=value" file, without running it
kv(){ grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | tr -d ' \r"'"'"; return 0; }
# on / off / auto from services.conf
opt(){ case "$(kv "$DATA/services.conf" "$1")" in on|1|yes|true) echo on;; off|0|no|false) echo off;; *) echo auto;; esac; }
hostok(){ local h=${1:-$2}; case "$h" in *[!a-z0-9.-]*|'') h=$2;; esac; echo "$h"; }
# Virtual screen :99 that aqeelOS browses on; streamed to the app through noVNC on 127.0.0.1:6080
export DISPLAY=:99
if command -v Xvfb >/dev/null; then
  pgrep -x Xvfb >/dev/null || rm -f /tmp/.X99-lock /tmp/.X11-unix/X99   # a hard stop leaves the lock behind
 start xvfb "Xvfb :99 -screen 0 1280x800x24 -nolisten tcp"
 sleep 1
 start wm "fluxbox"
 start vnc "while true; do x11vnc -display :99 -localhost -forever -shared -nopw -quiet -rfbport 5900; sleep 2; done"
 start novnc "while true; do websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900; sleep 2; done"
fi
# AdsPower stays on :99; each agent runs its own AdsPower (aqeelOS app/agent-adspower.mjs), this bridge gives one agent a fixed address
ab=$(opt adspower-bridge); if [ "$ab" = auto ]; then if [ -f "$DATA/agent-adspower.json" ]; then ab=on; else ab=off; fi; fi
if [ "$ab" = on ]; then start adspower-bridge "while true; do node $HOME/apps/hermes-ui/scripts/adspower-bridge.mjs; sleep 3; done"; fi
# No DISPLAY: each agent gets its own Bot Desktop screen when it browses
start gateway "env -u DISPLAY hermes -p default gateway"
start dashboard "hermes -p default dashboard --no-open"
# aqeelOS UI, restarts itself if it ever exits
start ui "while true; do node --env-file=\$HOME/.hermes/.env --env-file=\$HOME/apps/hermes-ui.env \$HOME/apps/hermes-ui/app/server.mjs; sleep 2; done"
# aqeelOS Code online (projects that live on the box; reached through aqeelOS behind sign-in).
# A clean environment: the coding AIs it runs never see the box's secrets. Heap capped so a heavy build can't starve the agents.
if [ -f $HOME/.aqeelos-online-code ]; then
 CH=$(hostok "${CODE_HOST:-$(kv $HOME/apps/hermes-ui.env CODE_HOST)}" code.localhost); CP=$(hostok "${CODE_PREVIEW_HOST:-$(kv $HOME/apps/hermes-ui.env CODE_PREVIEW_HOST)}" code-preview.localhost)
 start code "while true; do cd \$HOME/apps/aqeel-code && env -i HOME=\$HOME PATH=\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 HUB_PORT=4321 CBA_ONLINE=1 CBA_PUBLIC_APP=https://$CH CBA_PUBLIC_PREVIEW=https://$CP node --max-old-space-size=2048 server.mjs; sleep 3; done"
fi
# nightly engine restart (10 Nov 2026; through the app since 12 Nov). The engine's memory builds up over a day. Once a day (02:00 Jakarta)
# this asks aqeelOS for a restart by dropping <data>/restart-request.json; aqeelOS queues it like every other restart that can wait
# and does it in the maintenance window: first gently for up to restartGraceMinutes (default 10), then with --interrupt, and what that
# cut off is continued (app/restart-later.mjs, app/maintenance.mjs, app/resume.mjs). The old ~/nightly-engine-restart.sh (50 tries, never
# forced, so a background task blocked it for good) is not run any more.
nt=$(opt nightly); if [ "$nt" = auto ]; then if [ -x "$HOME/nightly-engine-restart.sh" ]; then nt=on; else nt=off; fi; fi
if [ "$nt" = on ]; then start nightly "while true; do [ \$(date -u +%H%M) = 1900 ] && { printf '{\"why\":\"nightly engine restart\"}' > $DATA/restart-request.json.tmp && mv $DATA/restart-request.json.tmp $DATA/restart-request.json; sleep 61; }; sleep 30; done"; fi
exit 0
