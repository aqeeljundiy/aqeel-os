#!/bin/bash
# Runs as root inside the AI box, started by the box's startup (the ai-box compose in Dokploy): "once" at boot, then
# "watch". aqeelOS lists, one per line in ~/.aqeelos-agent-users, the agents that get a Linux user of
# their own (see app/agent-defaults.mjs). For each, this:
#  - makes the user ag-<agent> whose home is the agent's own folder (~/workspaces/<agent>), lets it in over
#    SSH with aqeelOS's agents key only (no forwarding of any kind), and closes everything else in the owner home to it:
#    the owner's sign-ins and keys, aqeelOS's data and the other agents' folders. aqeelOS (the claude user) keeps full
#    access to every agent's folder;
#  - runs the agent's screen as that user: its own display (with a private key file, so no other user can see or type
#    into it), its desktop and its own Chrome with its own profile. Only the agent's user and aqeelOS may control that
#    Chrome (a network rule on its control port), and aqeelOS reaches the screen through the same files it reads for
#    any screen (<agent folder>/.screen, linked as the profile's bot-desktop folder).
# The users it made go to ~/.aqeelos-agent-users.done; each agent's display and Chrome port to
# ~/.aqeelos-agent-ports (agent display port per line).
set -u
HOMEC=${AQEELOS_HOME:-$HOME}
# the Unix user aqeelOS runs as (the owner of HOMEC); "claude" on the reference box
OWNER=${AQEELOS_USER:-claude}
REQ=$HOMEC/.aqeelos-agent-users
DONE=$REQ.done
PORTS=$HOMEC/.aqeelos-agent-ports
UIDS=$HOMEC/.aqeelos-agent-uids
KEYS=/etc/ssh/agent-keys
PUB=$HOMEC/.hermes/agent-ssh/id_ed25519.pub
CHROME_SRC=$(ls -d $HOMEC/.hermes/tools/chromium-*/chrome-linux64 2>/dev/null | sort | tail -1)
CHROME=/opt/aqeelos/chrome/chrome
# OPS-17 (11 Nov 2026): agent Chromes held up to 3.4 GB on a box with a 28 GB container limit. Tabs share renderer
# processes once 6 are running, and pages left behind are not kept alive in the back/forward cache. Applies when a
# Chrome next starts (a restart, a wake, a box start).
CHROME_MEM="--renderer-process-limit=6 --disable-back-forward-cache"
# OPS-19 (12 Nov 2026, lean screen): flags for a Chrome on a lean screen that cut idle CPU. No background network checks,
# component updates, sync, translate or cast discovery, no crash-restore bubble after a Chrome that was ended, no smooth
# scrolling to render. Nothing here touches cookies, the profile or how pages draw (no GPU or timer switches).
CHROME_LEAN="--disable-background-networking --disable-component-update --disable-sync --disable-default-apps --disable-breakpad --no-pings --disable-smooth-scrolling --hide-crash-restore-bubble --disable-session-crashed-bubble --disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion"
SRC=${AQEELOS_APP:-$HOMEC/apps/hermes-ui}/scripts/agent-users.sh
# beaten every 30 s while watching: aqeelOS shows on the Agents page when this script is not running
ALIVE=$REQ.alive
# OPS-3: when each agent's screen was started (root only; gone with the box, which is a fresh start anyway), the ones
# given up on, and the one-line problems aqeelOS files as issues (app/box-ops.mjs)
RST=${AQ_RESTARTS:-/var/lib/aqeelos/restarts}
ISSUES=$HOMEC/.aqeelos-agent-issues.jsonl
# OPS-5: what the janitor found last (expected and running processes per agent), read by aqeelOS's Health
JAN=$HOMEC/.aqeelos-janitor.json
SEEN=${AQ_SEEN:-/var/lib/aqeelos/janitor-seen}
# names written here by aqeelOS (or the fixer) get their screen tried again after it was given up on
RESET=$REQ.reset
# OPS-2/OPS-4: each agent's memory cap and sleep minutes, written by aqeelOS
LIMITS=$HOMEC/.aqeelos-agent-limits

setup_box(){
  # the file permission tools (setfacl) and SSH logins for the agents' users
  command -v setfacl >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null; } || echo "agent users: could not install acl"
  mkdir -p "$KEYS"; chmod 755 "$KEYS"
  [ -f /etc/ssh/sshd_config.d/claude.conf ] && sed -i 's/^AllowUsers claude$/AllowUsers claude ag-*/' /etc/ssh/sshd_config.d/claude.conf
  printf '%s\n' 'Match User ag-*' '  AuthorizedKeysFile /etc/ssh/agent-keys/%u' '  AllowTcpForwarding no' '  AllowStreamLocalForwarding no' '  X11Forwarding no' '  PermitTunnel no' '  AllowAgentForwarding no' '  PermitUserRC no' > /etc/ssh/sshd_config.d/zz-agents.conf
  # a Chrome every agent user may run (the engine's own copy lives in the closed part of the owner home)
  setup_wake || echo "agent users: could not set up the wake proxy"
  if [ -n "$CHROME_SRC" ] && [ ! -x "$CHROME" ]; then mkdir -p /opt/aqeelos; rm -rf /opt/aqeelos/chrome; cp -a "$CHROME_SRC" /opt/aqeelos/chrome; chmod -R a+rX /opt/aqeelos; fi
}

lock_home(){
  # the home: only the claude user (and its group) inside; agents only pass through to their own folder
  chmod 750 "$HOMEC"
  # the agents allowed through are added again below (make_user); none left over from an earlier start
  setfacl -b "$HOMEC" 2>/dev/null
  for d in "$HOMEC"/* "$HOMEC"/.[!.]*; do [ -e "$d" ] || continue; [ "$d" = "$HOMEC/workspaces" ] && continue; chmod o-rwx "$d" 2>/dev/null; done
  chmod 711 "$HOMEC/workspaces" 2>/dev/null
  for d in "$HOMEC"/workspaces/*; do [ -d "$d" ] && chmod o-rwx "$d"; done
  # the lists aqeelOS and this script share stay readable by aqeelOS only
  for f in "$DONE" "$PORTS" "$UIDS"; do [ -f "$f" ] && chown "$OWNER:$OWNER" "$f" && chmod 640 "$f"; done
}

# each agent keeps the same user number for good (kept in the home volume): files and access lists store numbers,
# so a rebuild that made the users in another order would hand one agent's folder to another
uid_of(){
  local n=$1 line uid
  line=$(grep "^$n " "$UIDS" 2>/dev/null | head -1)
  if [ -n "$line" ]; then echo "${line#* }"; return; fi
  uid=$(( $(cut -d' ' -f2 "$UIDS" 2>/dev/null | sort -n | tail -1) + 1 )); [ "$uid" -lt 2001 ] && uid=2001
  while getent passwd "$uid" >/dev/null || getent group "$uid" >/dev/null; do uid=$((uid+1)); done
  echo "$n $uid" >> "$UIDS"; chown "$OWNER:$OWNER" "$UIDS"; chmod 640 "$UIDS"; echo "$uid"
}

make_user(){
  local n=$1 u="ag-$1" ws="$HOMEC/workspaces/$1" uid
  u=${u:0:32}; uid=$(uid_of "$n")
  if ! id "$u" >/dev/null 2>&1; then groupadd -g "$uid" "$u" && useradd -M -d "$ws" -s /bin/bash -u "$uid" -g "$uid" "$u" || return 1
  elif [ "$(id -u "$u")" != "$uid" ]; then groupmod -g "$uid" "$u"; usermod -u "$uid" -g "$uid" "$u" || return 1; fi
  mkdir -p "$ws"
  chown -R "$u:$OWNER" "$ws"
  find "$ws" -type d -exec chmod 2770 {} + 2>/dev/null
  find "$ws" -type f -exec chmod ug+rw,o-rwx {} + 2>/dev/null
  # it may pass through the home (not list it) to reach its folder; aqeelOS keeps full access to what it makes
  setfacl -m "u:$u:--x" "$HOMEC"
  # the folder's access list is made again from nothing: only aqeelOS and this agent, never a user left over from before
  setfacl -R -b "$ws"
  setfacl -R -m "u:$OWNER:rwX,u:$u:rwX,g:$OWNER:rwX" -m "d:u:$OWNER:rwX,d:u:$u:rwX,d:g:$OWNER:rwX" "$ws"
  if [ -f "$PUB" ]; then install -m 644 "$PUB" "$KEYS/$u"; fi
  echo "$u"
}

# a display and a Chrome port that stay the same for each agent (kept in $PORTS)
port_of(){
  local n=$1 line
  line=$(grep "^$n " "$PORTS" 2>/dev/null | head -1)
  if [ -z "$line" ]; then local i=0; while grep -q " $((40+i)) " "$PORTS" 2>/dev/null; do i=$((i+1)); done; line="$n $((40+i)) $((9600+i))"; echo "$line" >> "$PORTS"; chown "$OWNER:$OWNER" "$PORTS"; chmod 640 "$PORTS"; fi
  echo "$line"
}

# Stops everything an earlier start of this agent's screen left running: the launcher shells (and the Chrome restart
# loop they fork), the display, the desktop and its Chrome. Without this a screen whose socket went missing while its
# display still ran was started again every 30 s: each new display failed ("X server already running") and left one
# more desktop behind (11 Nov 2026: 49 desktops each for continue-support and biomarkers-support, about 9 GB).
# Only the screen's own processes: the agent's commands and tasks run as the same user and are left alone.
# the desktop's processes (window manager, desktop background, panel and their session bus)
DESK_PATS=("^(dbus-launch --exit-with-session )?bash -c xfwm4 " "/xfce4/" "^(/usr/bin/)?(xfwm4|xfdesktop|xfce4-panel|xfsettingsd|dbus-daemon|dbus-launch|fluxbox)( |\$)")
screen_kill(){
  local u=$1 disp=$2 ws=$3 sig pats
  pats=("^bash -c[[:space:]]+cd '$ws'; export HOME='$ws' DISPLAY=" "${DESK_PATS[@]}" "^Xvnc :$disp( |\$)" "--user-data-dir=$ws/\\.browser( |\$)")
  pgrep -u "$u" -f "^Xvnc :$disp( |\$)|xfce4-panel|--user-data-dir=$ws/\\.browser" >/dev/null 2>&1 || return 0
  for sig in TERM KILL; do
    for p in "${pats[@]}"; do pkill -"$sig" -u "$u" -f -- "$p" 2>/dev/null; done
    sleep 1
  done
  echo "screen for ${ws##*/}: stopped what an earlier start left running"
}
# OPS-13: only the desktop of agent user $1 (its display and Chrome keep running), before the desktop starts again
desk_kill(){
  local u=$1 sig p
  for sig in TERM KILL; do
    for p in "${DESK_PATS[@]}"; do pkill -"$sig" -u "$u" -f -- "$p" 2>/dev/null; done
    sleep 1
  done
}

# A problem aqeelOS files as one issue (app/box-ops.mjs reads the file; same agent and key = same issue).
report(){
  local n=$1 key=$2 msg=$3 title=${4:-} t=""
  [ -n "$title" ] && t=",\"title\":\"${title//\"/\'}\""
  printf '{"at":%s,"agent":"%s","key":"%s","what":"%s"%s}\n' "$(date +%s)" "$n" "$key" "${msg//\"/\'}" "$t" >> "$ISSUES"
  chown "$OWNER:$OWNER" "$ISSUES" 2>/dev/null; chmod 640 "$ISSUES" 2>/dev/null
  echo "agent users: $n: $msg"
}

# OPS-3 (OPERATIONS.md rule 3). May the screen of agent $1 be started now? Every start is noted. A screen that has to be
# started again waits 5 s, 30 s, 2 min, then 10 min after the start before; the 6th start within an hour (5 failures)
# does not happen: the screen stays stopped and one issue is filed. 0 = start it, 1 = wait, 2 = given up.
WAITS=(5 30 120 600 600)
restart_gate(){
  local n=$1 now=${2:-$(date +%s)} f="$RST/$1" recent cnt last
  mkdir -p "$RST"; chmod 700 "$RST" 2>/dev/null
  [ -f "$f.stopped" ] && return 2
  recent=$(awk -v t=$((now-3600)) '$1+0>t' "$f" 2>/dev/null)
  cnt=$(printf '%s' "$recent" | grep -c .)
  if [ "$cnt" -ge 6 ]; then
    echo "$now" > "$f.stopped"
    report "$n" "screen-stopped" "its screen failed 5 times within an hour and is left stopped. See $HOMEC/workspaces/$n/.screen/xvnc.log, desktop.log and chrome.log; to try again: echo $n >> $RESET"
    return 2
  fi
  if [ "$cnt" -gt 0 ]; then last=$(printf '%s\n' "$recent" | tail -1); [ $((now-last)) -lt "${WAITS[$((cnt-1))]}" ] && return 1; fi
  { [ -n "$recent" ] && printf '%s\n' "$recent"; echo "$now"; } > "$f.tmp" && mv "$f.tmp" "$f"
  return 0
}
# names in $RESET: their screens may be started again (the counts start over)
take_resets(){
  [ -s "$RESET" ] || return 0
  local n
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    rm -f -- "$RST/$n" "$RST/$n.stopped" "$RST/$n.wakefails" "$HOMEC/workspaces/$n/.screen/chrome.stopped" "$HOMEC/workspaces/$n/.screen/lean.failed" "$HOMEC/workspaces/$n/.screen/nosleep"
    echo "agent users: $n: screen may start again"
  done < "$RESET"
  : > "$RESET"
}

# Chrome on an agent's screen, run by the screen's own launcher as the agent's user. It is started again when it exits,
# waiting 5 s, 30 s, 2 min, 10 min; after 5 exits within an hour it stays stopped and says so in .screen/chrome.stopped
# (the janitor files the issue). Passed to the agent's shell with declare -f.
chrome_loop(){
  local sd=$1; shift
  local waits=(5 30 120 600 600) ts=() now c t t0 code alive asleep step
  while true; do
    t0=$(date +%s); "$@" >"$sd/chrome.log" 2>&1; code=$?
    now=$(date +%s); alive=0; asleep=0
    kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && alive=1
    [ -f "$sd/asleep" ] && asleep=1
    c=1; for t in "${ts[@]}"; do [ $((now-t)) -lt 3600 ] && c=$((c+1)); done
    step=$(chrome_exit_step "$asleep" "$alive" "$code" $((now-t0)) "$c")
    case $step in
      stop) return ;;
      reopen) sleep 2 ;;
      giveup) echo "$now" > "$sd/chrome.stopped"; return ;;
      *) ts+=("$now"); sleep "${waits[$((c-1))]}" ;;
    esac
  done
}
# What the loop does when Chrome exits (OPS-19, 12 Nov 2026). asleep (a deliberate sleep: the idle rule or the memory
# watchdog made it) or the screen's launcher gone: stop, never open Chrome against it. Exit code 0 after running 20 s or
# more: a person closed the window in the take-over view (or Chrome was asked to restart): open it again after 2 s with its
# tabs back, not counted as a failure. Anything else is a failure: back-off 5 s, 30 s, 2 min, 10 min, and after 5 within an
# hour it is given up on. $5 = failures within the hour including this one.
chrome_exit_step(){
  local asleep=$1 alive=$2 code=$3 ran=$4 count=$5
  [ "$asleep" = 1 ] && { echo stop; return; }
  [ "$alive" = 1 ] || { echo stop; return; }
  [ "$code" = 0 ] && [ "$ran" -ge 20 ] && { echo reopen; return; }
  [ "$count" -ge 5 ] && { echo giveup; return; }
  echo backoff
}

# OPS-2 and OPS-4 (agreed with the owner 11 Nov 2026). aqeelOS writes each agent's budget to $LIMITS, one line
# "<agent> <memory cap MB> <sleep minutes>" (app/box-ops.mjs, from hermes-ui-data/agent-limits.json; an agent whose
# screen runs its own AdsPower never sleeps; defaults 4096 MB and 30 minutes). No line, or no file yet: both off (as
# before 11 Nov), so a root script that updates before the app has written the file changes nothing. 0 turns either off.
limit_of(){
  local l; l=$(grep "^$1 " "$LIMITS" 2>/dev/null | head -1)
  set -- $l
  echo "${2:-0} ${3:-0}"
}
# the port Chrome itself listens on: the agent's own port when its screen never sleeps (as before 11 Nov), else 10000
# above it, behind the wake proxy on the agent's own port
chrome_port(){ local cdp=$1 sleep=$2; [ "$sleep" -gt 0 ] && echo $((cdp+10000)) || echo "$cdp"; }

# OPS-19 (12 Nov 2026, the owner's decision): an agent's screen is an X server and one tiny window manager, nothing else
# ("lean"), started when the agent's browser is first used or a person opens the view, and put to sleep after its sleep
# minutes (default 15). The old XFCE desktop ("desktop") stays as a per-install setting and as the fallback when a lean
# start does not come up. aqeelOS writes the wanted mode as the 4th column of each $LIMITS line (lean or desktop; no
# column = lean). Markers in the agent's .screen folder: mode (what is running: lean-fluxbox, lean-bare or desktop),
# lean.failed (lean did not come up once: this agent uses the desktop until reset), nosleep (two wakes failed: always on until reset),
# waking (a wake was asked, holds its time in ms; gone when Chrome answers).
mode_of(){ local m; m=$(awk -v n="$1" '$1==n {print ($4=="desktop"?"desktop":"lean"); exit}' "$LIMITS" 2>/dev/null); echo "${m:-lean}"; }
# which screen to start: $1 wanted (lean|desktop), $2 fluxbox installed (1/0), $3 lean failed for this agent before (1/0)
screen_pick(){
  [ "$1" = desktop ] && { echo desktop; return; }
  [ "${3:-0}" = 1 ] && { echo desktop; return; }
  [ "${2:-0}" = 1 ] && echo lean-fluxbox || echo lean-bare
}
# $1 sleep minutes, $2 now, $3 last use, $4 asleep (1/0), $5 nosleep marker (1/0), $6 its own AdsPower runs (1/0), $7 screen running (1/0)
# -> sleep, or why not: off, awake-always, asleep, ads, down, wait
sleep_step(){
  local sl=$1 now=$2 last=$3 asleep=$4 nosleep=$5 ads=$6 running=$7
  [ "${sl:-0}" -gt 0 ] || { echo off; return; }
  [ "$nosleep" = 1 ] && { echo awake-always; return; }
  [ "$asleep" = 1 ] && { echo asleep; return; }
  [ "$ads" = 1 ] && { echo ads; return; }
  [ "$running" = 1 ] || { echo down; return; }
  [ $((now-last)) -ge $((sl*60)) ] && echo sleep || echo wait
}
# a screen that is not running: start it, or leave it asleep until it is used (on demand)? $1 sleep minutes, $2 nosleep marker
# (1/0), $3 seconds since a wake was asked (-1 = none). A wake asked less than 2 minutes ago is started even when a
# start was held back by the restart back-off.
ondemand_step(){
  local sl=$1 nosleep=$2 age=$3
  [ "${sl:-0}" -gt 0 ] || { echo start; return; }
  [ "$nosleep" = 1 ] && { echo start; return; }
  [ "$age" -ge 0 ] && [ "$age" -lt 120 ] && { echo start; return; }
  echo sleep
}
# what a wake's result means: $1 came up (1/0), $2 failed wakes in a row before this one. ok, retry (the first failure: one more
# try), keep-awake (the second in a row: this agent's screen stays always on and one Health item is filed, no person needed)
wake_step(){ [ "$1" = 1 ] && { echo ok; return; }; [ "${2:-0}" -ge 1 ] && echo keep-awake || echo retry; }

# The log of every sleep and wake (read by aqeelOS for the Health line): one JSON line each, with how long a wake took.
# "wake" = asked until Chrome answered on its port; "fallback" = a lean start did not come up and the old desktop was started.
SCREEN_EVENTS=${AQ_SCREEN_EVENTS:-${AQ_WAKE:-/var/lib/aqeelos/wake}/events.jsonl}
now_ms(){ date +%s%3N; }
# screen_event <agent> <sleep|wake|start|fallback|keep-awake> <ms> <true|false> <mode> [note]
screen_event(){
  local note=${6:-}
  mkdir -p "$(dirname "$SCREEN_EVENTS")" 2>/dev/null
  printf '{"at":%s,"agent":"%s","event":"%s","ms":%s,"ok":%s,"mode":"%s","note":"%s"}\n' "$(date +%s)" "$1" "$2" "${3:-0}" "${4:-true}" "${5:-}" "${note//\"/\'}" >> "$SCREEN_EVENTS" 2>/dev/null
  chmod 644 "$SCREEN_EVENTS" 2>/dev/null
  return 0
}
# the window manager's files for a lean screen: no toolbar, no menu, no keys, no borders, every window maximised
lean_wm_files(){
  local sd=$1 d=$1/fluxbox
  mkdir -p "$d" "$sd/fb"
  printf '%s\n' "session.screen0.toolbar.visible: false" "session.screen0.workspaces: 1" "session.screen0.focusModel: MouseFocus" "session.screen0.defaultDeco: NONE" "session.appsFile: $d/apps" "session.keyFile: $d/keys" "session.menuFile: $d/menu" "session.styleFile: $d/style" "session.screen0.rootCommand: true" > "$d/init"
  # no wallpaper: the default style asks fbsetbg for one, and with no setter installed it put an error box on every lean screen (P&P, 12 Nov)
  printf '%s
' "background: none" > "$d/style"
  : > "$d/keys"
  # fluxbox still calls fbsetbg for a wallpaper whatever the style says, and with no setter installed fbsetbg opens an error box
  # (xmessage) on the screen (P&P, 12 Nov, still there after the style fix). A do-nothing fbsetbg first on the PATH ends it.
  mkdir -p "$d/bin"; printf '%s
' '#!/bin/sh' 'exit 0' > "$d/bin/fbsetbg"; chmod 755 "$d/bin/fbsetbg"
  printf '%s\n' "[begin] ()" "[end]" > "$d/menu"
  printf '%s\n' "[app] (name=.*)" "  [Deco] {NONE}" "  [Maximized] {yes}" "[end]" > "$d/apps"
}
# graceful end of an agent's Chrome (its tabs and session are written on a normal exit): up to 8 s
chrome_graceful(){
  local u=$1 ws=$2 pid i
  pid=$(ps -u "$u" -o pid=,args= 2>/dev/null | awk -v b="--user-data-dir=$ws/.browser" 'index($0,b) && $0 !~ /--type=/ {print $1; exit}')
  [ -n "$pid" ] || return 0
  kill -TERM "$pid" 2>/dev/null
  for i in $(seq 16); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.5; done
  return 0
}
# Put agent $1 (user $2) to sleep: the marker first (the Chrome loop sees it and does not open Chrome again), Chrome ended
# gracefully, then the rest of the screen. $3 = why, for the log.
put_to_sleep(){
  local n=$1 u=$2 why=${3:-idle} ws="$HOMEC/workspaces/$1" disp t0 sd="$HOMEC/workspaces/$1/.screen"
  disp=$(grep "^$n " "$PORTS" | head -1 | cut -d' ' -f2); t0=$(now_ms)
  touch "$sd/asleep"; chown "$u:$OWNER" "$sd/asleep" 2>/dev/null
  chrome_graceful "$u" "$ws"
  screen_kill "$u" "$disp" "$ws" >/dev/null
  rm -f -- "$RST/$n" "$sd/waking"
  screen_event "$n" sleep $(( $(now_ms) - t0 )) true "$(cat "$sd/mode" 2>/dev/null || echo desktop)" "$why"
  echo "screen for $n: asleep ($why)"
}
# Is the screen of agent $1 up with Chrome answering? (rfb socket, Chrome listening on its port, window manager running)
screen_ready(){
  local n=$1 u=$2 cport=$3 sd="$HOMEC/workspaces/$1/.screen"
  [ -S "$sd/rfb.sock" ] || return 1
  ss -Hltn "sport = :$cport" 2>/dev/null | grep -q . || return 1
  case "$(cat "$sd/mode" 2>/dev/null)" in lean-fluxbox) pgrep -u "$u" -x fluxbox >/dev/null 2>&1 ;; *) return 0 ;; esac
}
# Runs in the background after a screen is started: waits up to 60 s for it to be ready and writes the result to the log
# with the time since $3 (ms: when the wake was asked). A lean start that does not come up is replaced once by the old desktop
# (lean.failed). A wake that does not come up is tried once more; the second in a row keeps the agent's screen always on and
# files one issue (report). $4 = wake (counts) or start (box start: only the lean fallback applies).
wake_verify(){
  local n=$1 u=$2 t0=$3 kind=${4:-wake} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp cport sl i ok=0 ms mode fails step
  line=$(port_of "$n"); disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  read -r _ sl <<< "$(limit_of "$n")"; cport=$(chrome_port "$cdp" "$sl")
  for i in $(seq "${AQ_WAKE_TRIES:-120}"); do screen_ready "$n" "$u" "$cport" && { ok=1; break; }; sleep "${AQ_WAKE_TICK:-0.5}"; done
  ms=$(( $(now_ms) - t0 )); mode=$(cat "$sd/mode" 2>/dev/null || echo desktop)
  if [ "$ok" = 1 ]; then
    rm -f -- "$sd/waking" "$RST/$n.wakefails"
    screen_event "$n" "$kind" "$ms" true "$mode"; echo "screen for $n: $kind took $ms ms ($mode)"; return 0
  fi
  if [ "${mode#lean}" != "$mode" ] && [ ! -f "$sd/lean.failed" ]; then
    touch "$sd/lean.failed"
    screen_event "$n" fallback "$ms" false "$mode" "the lean screen did not come up in 60 s: starting the old desktop"
    echo "screen for $n: the lean screen did not come up: starting the old desktop"
    rm -f -- "$RST/$n"; screen_kill "$u" "$disp" "$ws"; [ -f "$sd/waking" ] || echo "$t0" > "$sd/waking"
    AQ_NOVERIFY=1 screen_up "$n" "$u"; wake_verify "$n" "$u" "$t0" "$kind"; return $?
  fi
  rm -f -- "$sd/waking"
  screen_event "$n" "$kind" "$ms" false "$mode" "Chrome did not answer within 60 s"
  echo "screen for $n: $kind failed after $ms ms ($mode)"
  [ "$kind" = wake ] || return 1
  fails=$(cat "$RST/$n.wakefails" 2>/dev/null || echo 0); step=$(wake_step 0 "$fails")
  mkdir -p "$RST"; echo $((fails+1)) > "$RST/$n.wakefails"
  if [ "$step" = retry ]; then
    rm -f -- "$RST/$n"; screen_kill "$u" "$disp" "$ws"; t0=$(now_ms); echo "$t0" > "$sd/waking"
    AQ_NOVERIFY=1 screen_up "$n" "$u"; wake_verify "$n" "$u" "$t0" wake; return $?
  fi
  touch "$sd/nosleep"; screen_event "$n" keep-awake 0 true "$mode" "two wakes in a row failed: this screen stays on"
  report "$n" "wake-failed" "its screen did not wake twice in a row, so it stays always on (no sleep) until reset. See $sd/chrome.log, xvnc.log and desktop.log; to let it sleep again: echo $n >> $RESET" "Agent screen would not wake"
  rm -f -- "$RST/$n"; screen_kill "$u" "$disp" "$ws"; AQ_NOVERIFY=1 screen_up "$n" "$u"
  return 1
}

# rule 2: a sleeping screen. The wake proxy (scripts/wake-proxy.mjs) runs as its own user aq-wake and shares $WAKE with
# this script (and with aqeelOS, whose screen viewer wakes a screen too): <agent>.wake asks for a start, <agent>.active is
# the last use, ports lists the agents it listens for.
WAKE=${AQ_WAKE:-/var/lib/aqeelos/wake}
PROXY=/usr/local/lib/aqeelos/wake-proxy.mjs
PROXY_SRC=${AQEELOS_APP:-$HOMEC/apps/hermes-ui}/scripts/wake-proxy.mjs
setup_wake(){
  id aq-wake >/dev/null 2>&1 || useradd -r -M -d /nonexistent -s /usr/sbin/nologin aq-wake || return 1
  mkdir -p "$WAKE" "$(dirname "$PROXY")"; chown aq-wake:"$OWNER" "$WAKE"; chmod 2770 "$WAKE"
  if [ -f "$PROXY_SRC" ] && ! cmp -s "$PROXY_SRC" "$PROXY"; then install -m 644 -o root -g root "$PROXY_SRC" "$PROXY"; pkill -TERM -u aq-wake 2>/dev/null; fi
  return 0
}
# the proxy runs while any agent's screen may sleep; started again with the same back-off as a screen (OPS-3)
proxy_up(){
  [ -s "$WAKE/ports" ] || { pkill -TERM -u aq-wake 2>/dev/null; return 0; }
  [ -f "$PROXY" ] || return 0
  pgrep -u aq-wake -f "wake-proxy\\.mjs" >/dev/null 2>&1 && return 0
  restart_gate wake-proxy || return 0
  setsid runuser -u aq-wake -- node "$PROXY" "$WAKE" >>"$WAKE/proxy.log" 2>&1 < /dev/null &
  echo "wake proxy started"
}
# a screen idle for its sleep minutes (no DevTools use through the proxy, no viewer, no typing) is stopped and marked
# asleep; a deliberate stop is not a failure, so its restart count starts over
sleep_idle(){
  local n u ws sd sl last f now; now=$(date +%s)
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; ws="$HOMEC/workspaces/$n"; sd="$ws/.screen"
    read -r _ sl <<< "$(limit_of "$n")"
    # its own AdsPower runs on this screen: never put to sleep
    local ads=0 run=0 asl=0 nos=0
    pgrep -u "$u" -f "adspower_global|SunBrowser" >/dev/null 2>&1 && ads=1
    [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && run=1
    [ -f "$sd/asleep" ] && asl=1; [ -f "$sd/nosleep" ] && nos=1
    last=0; for f in "$WAKE/$n.active" "$sd/activity" "$sd/layout" "$sd/waking"; do [ -e "$f" ] && [ "$(stat -c %Y "$f")" -gt "$last" ] && last=$(stat -c %Y "$f"); done
    [ "$(sleep_step "$sl" "$now" "$last" "$asl" "$nos" "$ads" "$run")" = sleep ] || continue
    put_to_sleep "$n" "$u" "$(( (now-last)/60 )) min unused"
  done < "$REQ"
}
# <agent>.wake: its screen starts now (the proxy waits for it)
take_wakes(){
  local f n req t0 sd
  for f in "$WAKE"/*.wake; do
    [ -e "$f" ] || continue
    n=$(basename "$f" .wake); req=$(stat -c %Y "$f" 2>/dev/null || date +%s); rm -f -- "$f"
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] && grep -qx "$n" "$REQ" 2>/dev/null && id "ag-$n" >/dev/null 2>&1 || continue
    touch "$WAKE/$n.active"; sd="$HOMEC/workspaces/$n/.screen"
    if [ -f "$sd/asleep" ]; then
      # the wake's clock starts when it was asked (the proxy or the viewer wrote the file), so it counts what the person waits
      t0=$((req*1000)); [ $(( $(now_ms) - t0 )) -lt 120000 ] || t0=$(now_ms)
      echo "$t0" > "$sd/waking"; rm -f -- "$sd/asleep"; echo "screen for $n: woken"
    fi
    screen_up "$n" "ag-$n"
  done
}
# OPS-2: one command stops everything an agent's user runs: "aq-agent-users stop <agent>", or a line in $REQ.stop
# (aqeelOS). A screen that may sleep stays asleep until used; one that never sleeps starts again on the next pass.
take_stops(){
  [ -s "$REQ.stop" ] || return 0
  local n u sl
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    pkill -TERM -u "$u" 2>/dev/null; sleep 2; pkill -KILL -u "$u" 2>/dev/null
    rm -f -- "$RST/$n"; read -r _ sl <<< "$(limit_of "$n")"
    [ "$sl" -gt 0 ] && touch "$HOMEC/workspaces/$n/.screen/asleep"
    echo "agent users: $n: stopped everything it ran"
  done < "$REQ.stop"
  : > "$REQ.stop"
}
# OPS-17: aqeelOS's memory watchdog (app/memwatch.mjs) asks, one "<agent> sleep|chrome|adspower" per line in $REQ.mem,
# when the box is short of memory. Each is checked again here: an agent mid-reply or with its screen used in the last
# 5 minutes is left alone, and only sleep, a Chrome restart (chrome_loop starts it again) or an AdsPower restart (its
# keep-alive loop in aqeelOS starts it again) is ever done. Prints the step taken: sleep, chrome, adspower or skip.
mem_req_step(){
  local what=$1 now=$2 used=$3 busy=$4 ads=$5 asleep=$6
  case "$what" in sleep|chrome|adspower) ;; *) echo skip; return ;; esac
  { [ "$busy" = 1 ] || [ $((now-used)) -lt "$IN_USE" ]; } && { echo skip; return; }
  [ "$asleep" = 1 ] && { echo skip; return; }
  [ "$what" = sleep ] && [ "$ads" = 1 ] && { echo skip; return; }
  [ "$what" = adspower ] && [ "$ads" != 1 ] && { echo skip; return; }
  echo "$what"
}
take_mem(){
  [ -s "$REQ.mem" ] || return 0
  local n what u ws sd now busy ads asleep step line disp pid sl
  while read -r n what; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    ws="$HOMEC/workspaces/$n"; sd="$ws/.screen"; now=$(date +%s); busy=0; ads=0; asleep=0
    in_reply "$n" "$now" && busy=1
    pgrep -u "$u" -f "adspower_global|SunBrowser" >/dev/null 2>&1 && ads=1
    [ -f "$sd/asleep" ] && asleep=1
    # only a screen that may sleep (it wakes through the wake proxy on use) is put to sleep
    read -r _ sl <<< "$(limit_of "$n")"; [ "$what" = sleep ] && { [ "${sl:-0}" -le 0 ] || [ -f "$sd/nosleep" ]; } && what=no-sleep
    step=$(mem_req_step "$what" "$now" "$(last_use "$n" "$sd")" "$busy" "$ads" "$asleep")
    case "$step" in
      sleep) put_to_sleep "$n" "$u" "asked by aqeelOS, box short of memory" ;;
      chrome) pid=$(ps -u "$u" -o pid=,args= | awk -v b="--user-data-dir=$ws/.browser" 'index($0,b) && $0 !~ /--type=/ {print $1; exit}')
              [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null && echo "memory: $n: Chrome started again (asked by aqeelOS, box short of memory)" ;;
      # the program and its browsers only, never the keep-alive loop around it ("bash -c ... adspower_global ...")
      adspower) pkill -TERM -u "$u" -f "^[^ ]*/(adspower_global|SunBrowser)( |$)" 2>/dev/null && echo "memory: $n: AdsPower started again (asked by aqeelOS, box short of memory)" ;;
      *) echo "memory: $n: $what not done (in use or not running)" ;;
    esac
  done < "$REQ.mem"
  : > "$REQ.mem"
}

# screen_up <agent> <user> [desktop <why>]: with "desktop", only the desktop of a running screen starts again (OPS-13)
screen_up(){
  local n=$1 u=${2} part=${3:-all} why=${4:-} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp cport cap sl
  line=$(port_of "$n"); disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  read -r cap sl <<< "$(limit_of "$n")"; cport=$(chrome_port "$cdp" "$sl")
  # only aqeelOS (claude) and the agent's own user may reach its Chrome's control port; behind the proxy, the proxy's
  # user may reach the inner one too
  iptables -C OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null || iptables -I OUTPUT 1 -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
  if [ "$cport" != "$cdp" ]; then iptables -C OUTPUT -o lo -p tcp --dport "$cport" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null || iptables -I OUTPUT 1 -o lo -p tcp --dport "$cport" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null; fi
  # the profile's bot-desktop folder is the agent's own .screen folder (where aqeelOS looks for any agent's screen)
  local prof="$HOMEC/.hermes/profiles/$n"
  if [ -d "$prof" ] && [ ! -L "$prof/bot-desktop" ]; then rm -rf "$prof/bot-desktop.engine"; [ -e "$prof/bot-desktop" ] && mv "$prof/bot-desktop" "$prof/bot-desktop.engine"; ln -s "$sd" "$prof/bot-desktop"; chown -h "$OWNER:$OWNER" "$prof/bot-desktop"; fi
  # asleep (OPS-4): started by take_wakes when used
  [ -f "$sd/asleep" ] && return 0
  local running=0 mode want haswm=0 failed=0 wk_age=-1 t0
  [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ] && running=1
  # OPS-19: a screen that is not running and may sleep stays asleep until used (the wake proxy, the viewer or a schedule's
  # check asks for it), so a box start or a screen that was never used costs nothing
  if [ "$running" = 0 ] && [ "$part" = all ]; then
    [ -f "$sd/waking" ] && wk_age=$(( $(date +%s) - $(stat -c %Y "$sd/waking" 2>/dev/null || date +%s) ))
    if [ "$(ondemand_step "$sl" "$([ -f "$sd/nosleep" ] && echo 1 || echo 0)" "$wk_age")" = sleep ]; then
      mkdir -p "$sd"; chown "$u:$OWNER" "$sd"; chmod 2770 "$sd"; touch "$sd/asleep"; chown "$u:$OWNER" "$sd/asleep" 2>/dev/null
      screen_event "$n" sleep 0 true "$(cat "$sd/mode" 2>/dev/null || echo none)" "not running: left asleep until used"
      echo "screen for $n: left asleep until used"; return 0
    fi
  fi
  # lean or the old desktop: a running screen keeps what it runs (a change of the setting applies at its next sleep and wake)
  want=$(mode_of "$n"); command -v fluxbox >/dev/null 2>&1 && haswm=1; [ -f "$sd/lean.failed" ] && failed=1
  if [ "$running" = 1 ] && [ -f "$sd/mode" ]; then mode=$(cat "$sd/mode"); elif [ "$running" = 1 ]; then mode=desktop; else mode=$(screen_pick "$want" "$haswm" "$failed"); fi
  # the one window-manager launch (the whole screen and that part alone both use it); its log keeps why the last one ended
  local desk lean="" open="about:blank"
  case $mode in
    desktop) desk="( dbus-launch --exit-with-session bash -c 'xfwm4 & xfdesktop & xfce4-panel & wait' >>'$sd/desktop.log' 2>&1 & )" ;;
    lean-fluxbox) lean_wm_files "$sd"; chown -R "$u:$OWNER" "$sd/fb" 2>/dev/null
      desk="( HOME='$sd/fb' PATH='$sd/fluxbox/bin':$PATH fluxbox -rc '$sd/fluxbox/init' -no-slit -no-toolbar >>'$sd/desktop.log' 2>&1 & )" ;;
    *) desk=":" ;;
  esac
  [ "${mode#lean}" != "$mode" ] && lean="$CHROME_LEAN --window-position=0,0"
  # OPS-13: window manager, desktop background or panel gone while the display runs: the desktop alone starts again,
  # through the same back-off as the screen (a display that is not running is the whole screen's start, below)
  if [ "$part" = desktop ]; then
    [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ] || return 0
    restart_gate "$n" || return 0
    desk_kill "$u"
    [ "$desk" = ":" ] || runuser -u "$u" -- bash -c "cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'; $desk" && echo "janitor: $n: ${why:-desktop missing}: its ${mode#lean-} window manager is started again on :$disp"
    return 0
  fi
  # already running with Chrome on the port it should use: done. On another port (sleeping was switched on or off for
  # this agent, or the screen dates from before 11 Nov) it is started again once, which is not a failure.
  if [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ]; then
    [ "$(cat "$sd/layout" 2>/dev/null || echo "$cdp")" = "$cport" ] && return 0
    echo "screen for $n: Chrome moves to port $cport"; rm -f -- "$RST/$n"
  fi
  # waiting before trying again, or given up on after 5 failures (OPS-3): not started now
  restart_gate "$n" || return 0
  screen_kill "$u" "$disp" "$ws"
  mkdir -p "$sd"; chown "$u:$OWNER" "$sd"; chmod 2770 "$sd"
  rm -f "$sd/rfb.sock" "/tmp/.X$disp-lock" "/tmp/.X11-unix/X$disp"
  # a lock left by the Chrome of an earlier box (the box was rebuilt, so another host name) makes Chrome refuse to start
  rm -f "$ws/.browser/SingletonLock" "$ws/.browser/SingletonSocket" "$ws/.browser/SingletonCookie"
  # a screen that sleeps, and every lean screen, gets its tabs back when Chrome starts (also after it was closed by hand)
  { [ "$cport" != "$cdp" ] || [ -n "$lean" ]; } && open="--restore-last-session"
  runuser -u "$u" -- bash -c "
    cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'
    umask 007; : > \"\$XAUTHORITY\"; xauth -q add :$disp . \$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') 2>/dev/null
    printf 'DISPLAY=:%s\nXAUTHORITY=%s\n' '$disp' \"\$XAUTHORITY\" > '$sd/env'
    ( Xvnc :$disp -geometry 1280x800 -depth 24 -auth \"\$XAUTHORITY\" -SecurityTypes None -rfbport 0 -rfbunixpath '$sd/rfb.sock' -rfbunixmode 0660 -nolisten tcp -AlwaysShared >'$sd/xvnc.log' 2>&1 & echo \$! > '$sd/launcher.pid'; wait ) &
    for i in \$(seq 40); do [ -S '$sd/rfb.sock' ] && break; sleep 0.25; done
    $desk
    rm -f '$sd/chrome.stopped'
    $(declare -f chrome_exit_step chrome_loop)
    ( chrome_loop '$sd' '$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='$ws/.browser' --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cport --window-size=1280,800 --start-maximized $CHROME_MEM $lean $open & )
    echo $cport > '$sd/layout'
    touch '$sd/activity'
  " || return 0
  echo "$mode" > "$sd/mode"
  echo "screen for $n on :$disp (chrome $cport, $mode)"
  # how long it took, whether it came up, and the fall back to the old desktop when a lean start does not (OPS-19)
  if [ "${AQ_NOVERIFY:-0}" != 1 ]; then
    t0=$(cat "$sd/waking" 2>/dev/null); [[ "$t0" =~ ^[0-9]{13}$ ]] || t0=$(now_ms)
    ( wake_verify "$n" "$u" "$t0" "$([ -f "$sd/waking" ] && echo wake || echo start)" & )
  fi
}

once(){
  setup_box
  [ -f "$REQ" ] || return 0
  lock_home
  local out="" n r
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    r=$(make_user "$n") && out="$out$r"$'\n'
  done < "$REQ"
  printf '%s' "$out" > "$DONE.tmp"; chown "$OWNER:$OWNER" "$DONE.tmp"; chmod 640 "$DONE.tmp"; mv "$DONE.tmp" "$DONE"
  echo "agent users: $(printf '%s' "$out" | tr '\n' ' ')"
  remove_gone
  uploads_fix
  screens
}

# an agent that no longer exists: its screen and Chrome stop, its user and SSH key go, its control port rule goes, and
# its folder stays (handed to aqeelOS's claude user)
remove_gone(){
  local u n line cdp
  for u in $(getent passwd | cut -d: -f1 | grep '^ag-'); do
    n=${u#ag-}
    grep -qx "$n" "$REQ" 2>/dev/null && continue
    pkill -KILL -u "$u" 2>/dev/null; sleep 1
    line=$(grep "^$n " "$PORTS" 2>/dev/null | head -1); cdp=$(echo "$line" | cut -d' ' -f3)
    [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
    [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$((cdp+10000))" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null
    [ -f "$PORTS" ] && sed -i "/^$n /d" "$PORTS"
    rm -f "$KEYS/$u"
    userdel "$u" 2>/dev/null; groupdel "$u" 2>/dev/null
    [ -d "$HOMEC/workspaces/$n" ] && chown -R "$OWNER:$OWNER" "$HOMEC/workspaces/$n"
    echo "agent users: removed $u"
  done
  # display and port lines of agents that are gone (their users already went with an earlier box)
  if [ -f "$PORTS" ]; then local keep; keep=$(while read -r l; do n=${l%% *}; grep -qx "$n" "$REQ" && echo "$l"; done < "$PORTS"); printf "%s\n" "$keep" | sed "/^$/d" > "$PORTS.tmp" && chown "$OWNER:$OWNER" "$PORTS.tmp" && chmod 640 "$PORTS.tmp" && mv "$PORTS.tmp" "$PORTS"; fi
}

# every isolated agent's screen stays up (started again if it stopped)
screens(){
  [ -x "$CHROME" ] || return 0
  local n
  while read -r n; do [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue; id "ag-$n" >/dev/null 2>&1 && screen_up "$n" "ag-$n"; done < "$REQ"
  wake_ports
}
# the agents whose screen may sleep, for the wake proxy: "<agent> <its port> <Chrome's port>"
wake_ports(){
  [ -d "$WAKE" ] || return 0
  local n l out="" sl
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] && id "ag-$n" >/dev/null 2>&1 || continue
    read -r _ sl <<< "$(limit_of "$n")"; [ "$sl" -gt 0 ] || continue
    l=$(grep "^$n " "$PORTS" 2>/dev/null | head -1); [ -n "$l" ] || continue
    out="$out$n $(echo "$l" | cut -d' ' -f3) $(( $(echo "$l" | cut -d' ' -f3) + 10000 ))"$'
'
  done < "$REQ"
  [ "$out" = "$(cat "$WAKE/ports" 2>/dev/null)"$'
' ] || [ "$out" = "$(cat "$WAKE/ports" 2>/dev/null)" ] && return 0
  printf '%s' "$out" > "$WAKE/ports.tmp" && chown aq-wake:"$OWNER" "$WAKE/ports.tmp" && chmod 640 "$WAKE/ports.tmp" && mv "$WAKE/ports.tmp" "$WAKE/ports"
}

# OPS-5 (OPERATIONS.md rule 4). Expected equals running: for each agent with a screen, exactly one display on its own
# number, one window manager, desktop and panel, and one Chrome (main process) on its own profile. Anything more, or a
# display on a number that is not the agent's, is extra: reported at once, removed when it is still there a minute later
# (the copy running longest is kept). A Chrome that gave up (chrome.stopped) files one issue. The counts go to $JAN.
# One agent's counts, "<name> <expected> <running> <extra pids...>", from "pid user etimes args" lines on stdin.
jan_count(){
  local n=$1 u=$2 disp=$3 ws=$4 exp=5
  # OPS-19: a lean screen has an X server, one window manager (fluxbox) and Chrome, or no window manager at all
  case "$(cat "$ws/.screen/mode" 2>/dev/null)" in lean-fluxbox) exp=3 ;; lean-bare) exp=2 ;; esac
  [ -f "$ws/.screen/chrome.stopped" ] && exp=$((exp-1))
  [ -f "$ws/.screen/asleep" ] && exp=0
  awk -v u="$u" -v d="$disp" -v b="--user-data-dir=$ws/.browser" -v n="$n" -v want="$exp" '
    $2!=u {next}
    { a=$0; sub(/^[ \t]*[0-9]+[ \t]+[^ \t]+[ \t]+[0-9]+[ \t]+/,"",a); k="" }
    a ~ ("^Xvnc :" d "( |$)") {k="xvnc"}
    k=="" && a ~ /^Xvnc :/ {run++; ex=ex " " $1; next}
    k=="" && a ~ /^(\/usr\/bin\/)?xfwm4( |$)/ {k="xfwm4"}
    k=="" && a ~ /^(\/usr\/bin\/)?fluxbox( |$)/ {k="fluxbox"}
    k=="" && a ~ /^(\/usr\/bin\/)?xfdesktop( |$)/ {k="xfdesktop"}
    k=="" && a ~ /^(\/usr\/bin\/)?xfce4-panel( |$)/ {k="panel"}
    k=="" && a !~ /--type=/ { i=index(a,b); if(i){c=substr(a,i+length(b),1); if(c==""||c==" ")k="chrome"} }
    k=="" {next}
    { run++; if(!(k in best) || $3+0>bet[k]){ if(k in best) ex=ex " " best[k]; best[k]=$1; bet[k]=$3+0 } else ex=ex " " $1 }
    END { print n, want, run+0 ex }'
}
# OPS-13 (decided 11 Nov 2026). A desktop part (window manager, desktop background, panel) missing from a running
# display for 10 minutes starts again: the desktop alone, its display and Chrome keep running (screen_up ... desktop),
# through restart_gate (OPS-3), and never while the agent uses its screen: a reply through aqeelOS ($BUSY, written by
# app/box-ops.mjs every minute), or DevTools traffic, a viewer or typing (wake proxy's .active, .screen/activity) within
# 5 minutes. A missing display or Chrome is not this: screen_up and chrome_loop start those again.
# Which parts are missing, from "pid user etimes args" lines on stdin; nothing when the agent's display is not running.
jan_missing(){
  awk -v u="$1" -v d="$2" -v mode="${3:-desktop}" '
    $2!=u {next}
    { a=$0; sub(/^[ \t]*[0-9]+[ \t]+[^ \t]+[ \t]+[0-9]+[ \t]+/,"",a) }
    a ~ ("^Xvnc :" d "( |$)") {x=1}
    a ~ /^(\/usr\/bin\/)?xfwm4( |$)/ {w=1}
    a ~ /^(\/usr\/bin\/)?fluxbox( |$)/ {fb=1}
    a ~ /^(\/usr\/bin\/)?xfdesktop( |$)/ {k=1}
    a ~ /^(\/usr\/bin\/)?xfce4-panel( |$)/ {p=1}
    END { if(!x) exit; if(mode=="lean-bare") exit; if(mode=="lean-fluxbox"){ if(!fb) print "window manager"; exit } s=""; if(!w) s=s ", window manager"; if(!k) s=s ", desktop background"; if(!p) s=s ", panel"; if(s!="") print substr(s,3) }'
}
PART_WAIT=600 IN_USE=300
BUSY=$HOMEC/.aqeelos-agent-busy
# none (nothing missing), wait (missing under 10 min), busy (in use), restart
part_step(){
  local now=$1 since=$2 used=$3 busy=$4
  [ "$since" -gt 0 ] || { echo none; return; }
  [ $((now-since)) -lt "$PART_WAIT" ] && { echo wait; return; }
  { [ "$busy" = 1 ] || [ $((now-used)) -lt "$IN_USE" ]; } && { echo busy; return; }
  echo restart
}
# the last use of agent $1's screen (folder $2) other than a reply: DevTools traffic, a viewer, typing
last_use(){ local f m last=0; for f in "$WAKE/$1.active" "$2/activity"; do [ -e "$f" ] && m=$(stat -c %Y "$f") && [ "$m" -gt "$last" ] && last=$m; done; echo "$last"; }
# agent $1 is mid-reply: named in $BUSY, written within 3 minutes of $2 (an app that stopped writing blocks nothing)
in_reply(){ [ -f "$BUSY" ] && [ $(( $2 - $(stat -c %Y "$BUSY") )) -lt 180 ] && grep -qx -- "$1" "$BUSY"; }
# one agent: ps lines on stdin; $5 = now (tests)
desk_check(){
  local n=$1 u=$2 disp=$3 ws=$4 now=${5:-$(date +%s)} f="$RST/$1.part" miss since=0 busy=0 step
  miss=$(jan_missing "$u" "$disp" "$(cat "$ws/.screen/mode" 2>/dev/null || echo desktop)")
  [ -f "$ws/.screen/asleep" ] && miss=""
  if [ -z "$miss" ]; then rm -f -- "$f"; return 0; fi
  mkdir -p "$RST"; [ -f "$f" ] && read -r since < "$f"
  [ "${since:-0}" -gt 0 ] || { since=$now; echo "$now" > "$f"; }
  in_reply "$n" "$now" && busy=1
  step=$(part_step "$now" "$since" "$(last_use "$n" "$ws/.screen")" "$busy")
  [ "$step" = restart ] || return 0
  # the next try (if this one does not hold) waits another 10 minutes; restart_gate counts it as a start
  echo "$now" > "$f"
  screen_up "$n" "$u" desktop "$miss missing for $(( (now-since)/60 )) min"
}
# OPS-16: the engine's browser helpers (browser_exec's `python -m browser_harness.daemon`) never exit by themselves, not
# even when their Chrome is gone: on 10 Nov 2026 Elkiya had 35 of ~45 MB, one per agent per day. They always run detached
# (parent 1), so that alone says nothing. One over 2 hours old whose Chrome no longer listens, or over a day old whatever
# (Chrome unknown or alive), is stopped. The engine stops its own idle ones (engine/patches/2026-11-11-harness-idle-stop.patch);
# this takes those of a process that died first. Root reaches every user's: the claude user's and each ag-<agent>'s.
# From "pid ppid etimes cdp-port" lines on stdin ("-" when the port is unknown) and the listening ports in $1: the pids to stop.
harness_orphans(){
  awk -v listen=" $1 " '$2==1 && ($3>86400 || ($3>7200 && $4!="-" && index(listen, " " $4 " ")==0)) {print $1}'
}
# the Chrome port a daemon was started on (BU_CDP_WS / BU_CDP_URL); root in the box may not read another user's
# environ (no ptrace right), so it is read as the process's own user then
harness_port(){
  local pid=$1 env
  env=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null) || env=""
  [ -n "$env" ] || env=$(runuser -u "$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')" -- cat "/proc/$pid/environ" 2>/dev/null | tr '\0' '\n')
  printf '%s\n' "$env" | sed -n 's#^BU_CDP_\(WS\|URL\)=[a-z]*://[^/]*:\([0-9][0-9]*\).*#\2#p' | head -1
}
harness_sweep(){
  local listen lines="" pid pp et port
  listen=$(ss -Hltn 2>/dev/null | awk '{n=split($4,a,":"); printf "%s ", a[n]}')
  while read -r pid pp et; do
    port=$(harness_port "$pid"); lines="$lines$pid $pp $et ${port:--}"$'\n'
  done < <(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null | awk '$4 ~ /python/ && index($0, "-m browser_harness.daemon") {print $1, $2, $3}')
  for pid in $(printf '%s' "$lines" | harness_orphans "$listen"); do
    echo "janitor: stopped a leftover browser helper $pid ($(ps -o user=,etime= -p "$pid" 2>/dev/null | xargs))"; kill -TERM "$pid" 2>/dev/null
  done
}
janitor(){
  harness_sweep
  local ps n u line disp ws out="" tot_e=0 tot_r=0 res e r x pid prev
  ps=$(ps -eo pid=,user:32=,etimes=,args= 2>/dev/null)
  mkdir -p "$(dirname "$SEEN")"; touch "$SEEN"; prev=$(cat "$SEEN"); : > "$SEEN.tmp"
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    line=$(grep "^$n " "$PORTS" 2>/dev/null | head -1); [ -n "$line" ] || continue
    disp=$(echo "$line" | cut -d' ' -f2); ws="$HOMEC/workspaces/$n"
    res=$(printf '%s\n' "$ps" | jan_count "$n" "$u" "$disp" "$ws")
    read -r _ e r x <<< "$res"
    tot_e=$((tot_e+e)); tot_r=$((tot_r+r))
    printf '%s\n' "$ps" | desk_check "$n" "$u" "$disp" "$ws"
    for pid in $x; do
      if printf '%s\n' "$prev" | grep -qx "$pid"; then echo "janitor: $n: removed extra process $pid ($(ps -o args= -p "$pid" 2>/dev/null | cut -c1-60))"; kill -TERM "$pid" 2>/dev/null
      else echo "$pid" >> "$SEEN.tmp"; echo "janitor: $n: extra process $pid, removed next minute if still there"; fi
    done
    if [ -f "$ws/.screen/chrome.stopped" ] && [ ! -f "$ws/.screen/chrome.reported" ]; then
      report "$n" "chrome-stopped" "its Chrome exited 5 times within an hour and is left stopped. See $ws/.screen/chrome.log; to try again: echo $n >> $RESET"
      touch "$ws/.screen/chrome.reported"
    fi
    [ -f "$ws/.screen/chrome.stopped" ] || rm -f -- "$ws/.screen/chrome.reported"
    local mb; mb=$(mem_cap "$n" "$u" "$ws")
    out="$out\"$n\":{\"expected\":$e,\"running\":$r,\"extra\":[$(echo $x | tr ' ' ',')],\"mb\":${mb:-0},\"asleep\":$([ -f "$ws/.screen/asleep" ] && echo true || echo false),\"mode\":\"$(cat "$ws/.screen/mode" 2>/dev/null || echo desktop)\",\"nosleep\":$([ -f "$ws/.screen/nosleep" ] && echo true || echo false)},"
  done < "$REQ"
  mv "$SEEN.tmp" "$SEEN"
  printf '{"at":%s,"expected":%s,"running":%s,"agents":{%s}}\n' "$(date +%s)" "$tot_e" "$tot_r" "${out%,}" > "$JAN.tmp" && chown "$OWNER:$OWNER" "$JAN.tmp" 2>/dev/null; chmod 640 "$JAN.tmp"; mv "$JAN.tmp" "$JAN"
}

# OPS-2 (rule 2): an agent's memory is what its own user runs (its real share, Pss, so Chrome's shared pages count once).
# Over its cap for 3 minutes: its Chrome is started again (the usual cause; Chrome comes back by itself, tabs restored
# when it may sleep). Still over 3 minutes later: one issue. Over twice the cap: its biggest process is stopped at once.
# Prints the agent's MB.
# Root in the box may not read another user's smaps (no ptrace right; 11 Nov 2026 every agent read 0 MB): then the sum
# of its processes' resident memory, which counts Chrome's shared pages more than once (a cap on the safe side).
mem_mb(){ local u=$1 p kb=0 v; for p in $(pgrep -u "$u" 2>/dev/null); do v=$(awk '/^Pss:/{print $2; exit}' "/proc/$p/smaps_rollup" 2>/dev/null); kb=$((kb+${v:-0})); done
  [ "$kb" -gt 0 ] || kb=$(ps -u "$u" -o rss= 2>/dev/null | awk '{s+=$1} END{print s+0}'); echo $((kb/1024)); }
# decides, from MB, cap and the over-since/acted times kept in $RST/<agent>.mem: none, chrome, report, biggest
# $6 = 1 while the agent is at work (a reply or schedule in $BUSY, its screen used in the last 5 minutes): nothing of it
# is restarted then (OPS-17), unless it holds three times its cap
mem_step(){
  local mb=$1 cap=$2 now=$3 since=$4 acted=$5 busy=${6:-0}
  [ "$cap" -gt 0 ] && [ "$mb" -gt "$cap" ] || { echo none; return; }
  [ "$mb" -gt $((cap*3)) ] && { echo biggest; return; }
  [ "$busy" = 1 ] && { echo none; return; }
  [ "$mb" -gt $((cap*2)) ] && { echo biggest; return; }
  [ $((now-since)) -lt 180 ] && { echo none; return; }
  [ "$acted" -eq 0 ] && { echo chrome; return; }
  [ $((now-acted)) -ge 180 ] && [ "$acted" -gt 0 ] && { echo report; return; }
  echo none
}
# MB the agent's Chrome (its own .browser) or its AdsPower (program, browsers, RPA) holds, from resident memory
part_mb(){ local u=$1 what=$2 re; [ "$what" = adspower ] && re='^[^ ]*/(adspower_global|SunBrowser)( |$)' || re='^[^ ]*/chrome( |$)'
  ps -u "$u" -o rss=,args= 2>/dev/null | awk -v re="$re" '{a=$0; sub(/^ *[0-9]+ +/,"",a); if(a ~ re) s+=$1} END{print int(s/1024)}'; }
# which part to start again: the bigger one (Chrome on a tie)
mem_target(){ [ "${2:-0}" -gt "${1:-0}" ] && echo adspower || echo chrome; }
mem_cap(){
  local n=$1 u=$2 ws=$3 mb cap f="$RST/$1.mem" since=0 acted=0 now step pid
  mb=$(mem_mb "$u"); read -r cap _ <<< "$(limit_of "$n")"; now=$(date +%s)
  # its own AdsPower runs as the same user (about 4 GB more): at least 8 GB, whatever aqeelOS knew about it
  [ "$cap" -gt 0 ] && [ "$cap" -lt 8192 ] && pgrep -u "$u" -f "adspower_global|SunBrowser" >/dev/null 2>&1 && cap=8192
  [ -f "$f" ] && read -r since acted < "$f"
  if [ "$cap" -le 0 ] || [ "$mb" -le "$cap" ]; then rm -f -- "$f"; echo "$mb"; return; fi
  [ "${since:-0}" -gt 0 ] || since=$now
  local busy=0; { in_reply "$n" "$now" || [ $((now-$(last_use "$n" "$ws/.screen"))) -lt "$IN_USE" ]; } && busy=1
  step=$(mem_step "$mb" "$cap" "$now" "$since" "${acted:-0}" "$busy")
  # the part that holds more is the one started again: on 11 Nov 2026 continue-threads' Chrome was restarted while its
  # AdsPower held 5.7 GB in one process (rpa.min.js, 11 days old)
  [ "$step" = chrome ] && [ "$(mem_target "$(part_mb "$u" chrome)" "$(part_mb "$u" adspower)")" = adspower ] && step=adspower
  case "$step" in
    chrome) pid=$(ps -u "$u" -o pid=,args= | awk -v b="--user-data-dir=$ws/.browser" 'index($0,b) && $0 !~ /--type=/ {print $1; exit}')
            [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null; acted=$now; echo "janitor: $n uses $mb MB (cap $cap): its Chrome is started again" >&2 ;;
    adspower) pkill -TERM -u "$u" -f "^[^ ]*/(adspower_global|SunBrowser)( |$)" 2>/dev/null; acted=$now; echo "janitor: $n uses $mb MB (cap $cap): its AdsPower is started again" >&2 ;;
    report) report "$n" "memory" "uses $mb MB, over its $cap MB cap, even after its Chrome or AdsPower was started again. Raise its cap in hermes-ui-data/agent-limits.json or find what grows (System › Per agent)" >&2; acted=-1 ;;
    biggest) pid=$(ps -u "$u" -o pid= --sort=-rss | head -1 | tr -d ' '); [ -n "$pid" ] && echo "janitor: $n uses $mb MB, twice its $cap MB cap: stopping its biggest process $pid ($(ps -o args= -p "$pid" | cut -c1-60))" >&2 && kill -TERM "$pid" 2>/dev/null ;;
  esac
  mkdir -p "$RST"; echo "$since ${acted:-0}" > "$f"
  echo "$mb"
}

# OPS-7 (rule 7): a screen's logs stay short (the newest 2 MB of one over 10 MB), and the issues file keeps its last 200 lines
trim_logs(){
  local f n
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    for f in "$HOMEC/workspaces/$n/.screen/"{chrome,xvnc,desktop}.log; do
      [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 10485760 ] && tail -c 2097152 "$f" > "$f.tmp" && cat "$f.tmp" > "$f" && rm -f -- "$f.tmp" && echo "agent users: $n: trimmed ${f##*/}"
    done
  done < "$REQ"
  [ -f "$SCREEN_EVENTS" ] && [ "$(wc -l < "$SCREEN_EVENTS")" -gt 4000 ] && tail -2000 "$SCREEN_EVENTS" > "$SCREEN_EVENTS.tmp" && cat "$SCREEN_EVENTS.tmp" > "$SCREEN_EVENTS" && rm -f -- "$SCREEN_EVENTS.tmp"
  [ -f "$ISSUES" ] && [ "$(wc -l < "$ISSUES")" -gt 400 ] && tail -200 "$ISSUES" > "$ISSUES.tmp" && cat "$ISSUES.tmp" > "$ISSUES" && rm -f -- "$ISSUES.tmp"
  return 0
}

# OPS-18 (12 Nov 2026). Uploads: ~/uploads holds the files the chat and the channels hand to agents. Each agent has its own
# user, which reaches the folder only through its access list, so every agent's user is named on it (and on files made later:
# default entries), and a file written private (mode 600: mkstemp) has an empty list mask that hid it from the agent (P&P,
# 10 Nov: two issues) and is made readable. The folder itself stays closed to every other user.
uploads_fix(){
  local d="$HOMEC/uploads" n u
  [ -d "$d" ] || return 0
  find "$d" -xdev -type f ! -perm -044 -exec chmod a+r {} + 2>/dev/null
  [ -f "$REQ" ] || return 0
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    setfacl -m "u:$u:rX,d:u:$u:rX" "$d" 2>/dev/null
  done < "$REQ"
  return 0
}

# OPS-18: leftovers of agents' work that nothing stops. Scratch Postgres servers (an agent's test database under
# cache/scratch, started detached, 5 left on Elkiya up to 2 days), Next.js servers (3 of 16 to 18 days) and the staging
# copies of aqeelOS itself (one 5 days old with live data, the deploy check's /tmp/aq-stage). They belong to no screen, so
# nothing above counts them. Decided from what is observable, every 5 minutes, and only after 15 minutes of watching:
#  - stopped: its folder is gone; or it has had no client for its limit (a scratch Postgres 2 h, an app 24 h, the deploy
#    check's test copy 3 h, never while a check holds it). A client is a connection on its port (Postgres: a backend process);
#  - reported (one issue, "Leftover process"): it still has clients but is over 7 days old, nothing is stopped;
#  - never while its agent is mid-reply or has an engine session ($BUSY).
# Only the owner's and the agents' users. Postgres gets SIGINT (a clean fast shutdown), the rest SIGTERM, SIGKILL 2 minutes later.
ORPH=${AQ_ORPHANS:-/var/lib/aqeelos/orphans}
ORPH_TMP=${AQ_TMP:-/tmp}
ORPH_WATCH=900 PG_IDLE=7200 APP_IDLE=86400 CHECK_IDLE=10800 ORPH_REPORT_AGE=604800
# "pid ppid user etimes kind" of what may be a leftover, from "pid ppid user etimes args" lines on stdin; $1 = the owner's user
orphan_kinds(){
  awk -v owner="$1" '
    $3!=owner && $3 !~ /^ag-/ {next}
    { a=$0; sub(/^[ \t]*[0-9]+[ \t]+[0-9]+[ \t]+[^ \t]+[ \t]+[0-9]+[ \t]+/,"",a); k="" }
    a ~ /[/]postgres -D [^ ]*[/]cache[/]scratch[/]/ {k="pg"}
    k=="" && a ~ /^next-server [(]v[0-9]/ {k="app"}
    k=="" && a ~ /^node .*[/]hermes-ui-staging[/]app[/]server[.]mjs( |$)/ {k="stage"}
    k=="" && a ~ /^node .*[/]tmp[/]aq-stage[/]app[/]server[.]mjs( |$)/ {k="check"}
    k!="" {print $1, $2, $3, $4, k}'
}
# the ports process $1 listens on, from `ss -Htlnp` lines on stdin
orphan_ports(){
  awk -v p="$1" 'index($0, "pid=" p ",") { n=split($4, a, ":"); if(!(a[n] in seen)){seen[a[n]]=1; printf "%s ", a[n]} }'
}
# how many established connections are on the ports $1, from `ss -Htn state established` lines on stdin (local address third)
orphan_clients(){
  awk -v ports=" $1 " '{ n=split($3, a, ":"); if(index(ports, " " a[n] " ")) c++ } END { print c+0 }'
}
# client backends of the Postgres server with pid $1, from "pid ppid user etimes args" lines on stdin
orphan_pg_clients(){
  awk -v p="$1" '$2==p && $0 ~ /postgres: [^ ]+ [^ ]+ / && $0 !~ /postgres: (io worker|checkpointer|background writer|walwriter|autovacuum|logical replication|archiver|startup|walsender|walreceiver|stats)/ {c++} END {print c+0}'
}
# stop, report or none: kind, age (s), idle (s since its last client), watched (s since first seen), clients, gone (1: its
# folder is gone), checking (1: a deploy check holds the test copy)
orphan_step(){
  local kind=$1 age=$2 idle=$3 watched=$4 clients=$5 gone=$6 checking=${7:-0} lim
  [ "$watched" -ge "$ORPH_WATCH" ] || { echo none; return; }
  case $kind in
    pg) lim=$PG_IDLE ;;
    check) [ "$checking" = 1 ] && { echo none; return; }; lim=$CHECK_IDLE ;;
    *) lim=$APP_IDLE ;;
  esac
  [ "$gone" = 1 ] && [ "$kind" != check ] && { echo stop; return; }
  [ "$clients" -eq 0 ] && [ "$idle" -ge "$lim" ] && { echo stop; return; }
  [ "$clients" -gt 0 ] && [ "$age" -ge "$ORPH_REPORT_AGE" ] && { echo report; return; }
  echo none
}
# the staging copy runs in a restart loop (staging-run.sh): stopped first, or the app comes back 2 seconds later
orphan_stop(){
  local pid=$1 kind=$2 sig=TERM p pp i
  [ "$kind" = pg ] && sig=INT
  if [ "$kind" = stage ]; then
    p=$pid
    for i in 1 2 3; do
      pp=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); [ -n "$pp" ] && [ "$pp" -gt 1 ] || break
      ps -o args= -p "$pp" 2>/dev/null | grep -q 'staging-run[.]sh' || break
      kill -TERM "$pp" 2>/dev/null; p=$pp
    done
  fi
  kill -"$sig" "$pid" 2>/dev/null
}
orphan_sweep(){
  local now ps listen estab lines pid ppid user age kind cwd gone ports clients first last start st d f agent act stopped=0 checking=0 what
  now=$(date +%s); ps=$(ps -eo pid=,ppid=,user:32=,etimes=,args= 2>/dev/null)
  listen=$(ss -Htlnp 2>/dev/null); estab=$(ss -Htn state established 2>/dev/null)
  [ -d "$ORPH_TMP/aq-check.lock" ] && checking=1
  mkdir -p "$ORPH"
  lines=$(printf '%s\n' "$ps" | orphan_kinds "$OWNER")
  while read -r pid ppid user age kind; do
    [ -n "$pid" ] || continue
    f="$ORPH/$pid"
    # asked to stop earlier and still there 2 minutes later: killed
    if [ -e "$f.term" ]; then
      read -r st < "$f.term"; [ $((now-${st:-0})) -ge 120 ] && { kill -KILL "$pid" 2>/dev/null; echo "janitor: leftover $kind $pid did not stop: killed"; rm -f "$f.term"; }
      continue
    fi
    ports=$(printf '%s\n' "$listen" | orphan_ports "$pid")
    if [ "$kind" = pg ]; then clients=$(printf '%s\n' "$ps" | orphan_pg_clients "$pid"); else clients=$(printf '%s\n' "$estab" | orphan_clients "$ports"); fi
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    [ -n "$cwd" ] || cwd=$(runuser -u "$user" -- readlink "/proc/$pid/cwd" 2>/dev/null)
    gone=0
    case "$cwd" in *" (deleted)") gone=1 ;; "") ;; *) [ -d "$cwd" ] || gone=1 ;; esac
    # first seen, last client, start: a number reused by another process (another start) begins again
    first=$now; last=$((now-age)); start=$((now-age))
    if [ -f "$f" ]; then
      read -r first last st < "$f"; d=$((start-${st:-0})); [ "$d" -lt 0 ] && d=$((-d))
      [ "$d" -le 30 ] || { first=$now; last=$start; rm -f "$f.term" "$f.reported"; }
    fi
    [ "$clients" -gt 0 ] && last=$now
    printf '%s %s %s\n' "$first" "$last" "$start" > "$f"
    agent=""; case "$cwd" in */workspaces/*) agent=${cwd#*/workspaces/}; agent=${agent%%/*} ;; esac
    [ -n "$agent" ] && in_reply "$agent" "$now" && continue
    act=$(orphan_step "$kind" "$age" $((now-last)) $((now-first)) "$clients" "$gone" "$checking")
    what="$kind process $pid of $user ($((age/3600)) h old, ${cwd:-folder unknown}, ports: ${ports:-none}, clients: $clients)"
    case "$act" in
      stop)
        [ "$stopped" -lt 3 ] || continue
        stopped=$((stopped+1)); echo "janitor: stopping leftover $what"
        orphan_stop "$pid" "$kind"; echo "$now" > "$f.term" ;;
      report)
        if [ ! -e "$f.reported" ]; then touch "$f.reported"; report default "leftover-$kind-$pid" "$what is over 7 days old and still has clients, so it is left running. If nobody needs it, stop it." "Leftover process"; fi ;;
    esac
  done <<< "$lines"
  # state of processes that are gone
  for f in "$ORPH"/*; do [ -e "$f" ] || continue; pid=${f##*/}; pid=${pid%%.*}; kill -0 "$pid" 2>/dev/null || rm -f "$f"; done
  return 0
}

# sourced by the tests (scripts/agent-users.test.mjs): the functions only
[ "${AQ_AGENT_USERS_LIB:-0}" = 1 ] && return 0 2>/dev/null

case "${1:-watch}" in
  once) once ;;
  reset) [ -n "${2:-}" ] && echo "$2" >> "$RESET" && take_resets ;;
  janitor) janitor ;;
  stop) [ -n "${2:-}" ] && echo "$2" >> "$REQ.stop" && take_stops ;;
  watch) last=""; n=0; while true; do take_resets; take_stops; take_mem; take_wakes; proxy_up; [ $((n % 12)) -eq 0 ] && [ -f "$REQ" ] && { janitor; sleep_idle; setup_wake; }; [ $((n % 720)) -eq 0 ] && [ -f "$REQ" ] && trim_logs; [ $((n % 60)) -eq 0 ] && [ -f "$REQ" ] && { uploads_fix; orphan_sweep; }; [ $((n % 6)) -eq 0 ] && { date +%s > "$ALIVE"; chown "$OWNER:$OWNER" "$ALIVE" 2>/dev/null; }; if [ -f "$SRC" ] && [ "$0" != "$SRC" ] && ! cmp -s "$SRC" "$0"; then install -m 755 -o root -g root "$SRC" "$0" && exec "$0" watch; fi; s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; n=$((n+1)); [ $((n % 6)) -eq 0 ] && [ -f "$REQ" ] && screens; sleep 5; done ;;
esac
