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
DESK_PATS=("^(dbus-launch --exit-with-session )?bash -c xfwm4 " "/xfce4/" "^(/usr/bin/)?(xfwm4|xfdesktop|xfce4-panel|xfsettingsd|dbus-daemon|dbus-launch)( |\$)")
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
  local n=$1 key=$2 msg=$3
  printf '{"at":%s,"agent":"%s","key":"%s","what":"%s"}\n' "$(date +%s)" "$n" "$key" "${msg//\"/\'}" >> "$ISSUES"
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
    rm -f -- "$RST/$n" "$RST/$n.stopped" "$HOMEC/workspaces/$n/.screen/chrome.stopped"
    echo "agent users: $n: screen may start again"
  done < "$RESET"
  : > "$RESET"
}

# Chrome on an agent's screen, run by the screen's own launcher as the agent's user. It is started again when it exits,
# waiting 5 s, 30 s, 2 min, 10 min; after 5 exits within an hour it stays stopped and says so in .screen/chrome.stopped
# (the janitor files the issue). Passed to the agent's shell with declare -f.
chrome_loop(){
  local sd=$1; shift
  local waits=(5 30 120 600 600) ts=() now c t
  while kill -0 "$(cat "$sd/launcher.pid")" 2>/dev/null; do
    "$@" >"$sd/chrome.log" 2>&1
    now=$(date +%s); ts+=("$now"); c=0
    for t in "${ts[@]}"; do [ $((now-t)) -lt 3600 ] && c=$((c+1)); done
    if [ "$c" -ge 5 ]; then echo "$now" > "$sd/chrome.stopped"; return; fi
    sleep "${waits[$((c-1))]}"
  done
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
    read -r _ sl <<< "$(limit_of "$n")"; [ "$sl" -gt 0 ] || continue
    [ -f "$sd/asleep" ] && continue
    # its own AdsPower runs on this screen: never put to sleep
    pgrep -u "$u" -f "adspower_global|SunBrowser" >/dev/null 2>&1 && continue
    [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null || continue
    last=0; for f in "$WAKE/$n.active" "$sd/activity" "$sd/layout"; do [ -e "$f" ] && [ "$(stat -c %Y "$f")" -gt "$last" ] && last=$(stat -c %Y "$f"); done
    [ $((now-last)) -ge $((sl*60)) ] || continue
    local line disp; line=$(grep "^$n " "$PORTS" | head -1); disp=$(echo "$line" | cut -d' ' -f2)
    screen_kill "$u" "$disp" "$ws" >/dev/null; touch "$sd/asleep"; chown "$u:$OWNER" "$sd/asleep" 2>/dev/null; rm -f -- "$RST/$n"
    echo "screen for $n: asleep after $(( (now-last)/60 )) min unused"
  done < "$REQ"
}
# <agent>.wake: its screen starts now (the proxy waits for it)
take_wakes(){
  local f n
  for f in "$WAKE"/*.wake; do
    [ -e "$f" ] || continue
    n=$(basename "$f" .wake); rm -f -- "$f"
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] && grep -qx "$n" "$REQ" 2>/dev/null && id "ag-$n" >/dev/null 2>&1 || continue
    touch "$WAKE/$n.active"
    if [ -f "$HOMEC/workspaces/$n/.screen/asleep" ]; then rm -f -- "$HOMEC/workspaces/$n/.screen/asleep"; echo "screen for $n: woken"; fi
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
  # the one desktop launch (the whole screen and the desktop alone both use it); its log keeps why the last one ended
  local desk="( dbus-launch --exit-with-session bash -c 'xfwm4 & xfdesktop & xfce4-panel & wait' >>'$sd/desktop.log' 2>&1 & )"
  # OPS-13: window manager, desktop background or panel gone while the display runs: the desktop alone starts again,
  # through the same back-off as the screen (a display that is not running is the whole screen's start, below)
  if [ "$part" = desktop ]; then
    [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ] || return 0
    restart_gate "$n" || return 0
    desk_kill "$u"
    runuser -u "$u" -- bash -c "cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'; $desk" && echo "janitor: $n: ${why:-desktop missing}: its desktop is started again on :$disp"
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
  # a screen that sleeps gets its tabs back when it wakes
  local open="about:blank"; [ "$cport" != "$cdp" ] && open="--restore-last-session"
  runuser -u "$u" -- bash -c "
    cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'
    umask 007; : > \"\$XAUTHORITY\"; xauth -q add :$disp . \$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') 2>/dev/null
    printf 'DISPLAY=:%s\nXAUTHORITY=%s\n' '$disp' \"\$XAUTHORITY\" > '$sd/env'
    ( Xvnc :$disp -geometry 1280x800 -depth 24 -auth \"\$XAUTHORITY\" -SecurityTypes None -rfbport 0 -rfbunixpath '$sd/rfb.sock' -rfbunixmode 0660 -nolisten tcp -AlwaysShared >'$sd/xvnc.log' 2>&1 & echo \$! > '$sd/launcher.pid'; wait ) &
    for i in \$(seq 40); do [ -S '$sd/rfb.sock' ] && break; sleep 0.25; done
    $desk
    rm -f '$sd/chrome.stopped'
    $(declare -f chrome_loop)
    ( chrome_loop '$sd' '$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='$ws/.browser' --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cport --window-size=1280,800 --start-maximized $open & )
    echo $cport > '$sd/layout'
    touch '$sd/activity'
  " && echo "screen for $n on :$disp (chrome $cport)"
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
  [ -f "$ws/.screen/chrome.stopped" ] && exp=4
  [ -f "$ws/.screen/asleep" ] && exp=0
  awk -v u="$u" -v d="$disp" -v b="--user-data-dir=$ws/.browser" -v n="$n" -v want="$exp" '
    $2!=u {next}
    { a=$0; sub(/^[ \t]*[0-9]+[ \t]+[^ \t]+[ \t]+[0-9]+[ \t]+/,"",a); k="" }
    a ~ ("^Xvnc :" d "( |$)") {k="xvnc"}
    k=="" && a ~ /^Xvnc :/ {run++; ex=ex " " $1; next}
    k=="" && a ~ /^(\/usr\/bin\/)?xfwm4( |$)/ {k="xfwm4"}
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
  awk -v u="$1" -v d="$2" '
    $2!=u {next}
    { a=$0; sub(/^[ \t]*[0-9]+[ \t]+[^ \t]+[ \t]+[0-9]+[ \t]+/,"",a) }
    a ~ ("^Xvnc :" d "( |$)") {x=1}
    a ~ /^(\/usr\/bin\/)?xfwm4( |$)/ {w=1}
    a ~ /^(\/usr\/bin\/)?xfdesktop( |$)/ {k=1}
    a ~ /^(\/usr\/bin\/)?xfce4-panel( |$)/ {p=1}
    END { if(!x) exit; s=""; if(!w) s=s ", window manager"; if(!k) s=s ", desktop background"; if(!p) s=s ", panel"; if(s!="") print substr(s,3) }'
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
  miss=$(jan_missing "$u" "$disp")
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
    out="$out\"$n\":{\"expected\":$e,\"running\":$r,\"extra\":[$(echo $x | tr ' ' ',')],\"mb\":${mb:-0},\"asleep\":$([ -f "$ws/.screen/asleep" ] && echo true || echo false)},"
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
mem_step(){
  local mb=$1 cap=$2 now=$3 since=$4 acted=$5
  [ "$cap" -gt 0 ] && [ "$mb" -gt "$cap" ] || { echo none; return; }
  [ "$mb" -gt $((cap*2)) ] && { echo biggest; return; }
  [ $((now-since)) -lt 180 ] && { echo none; return; }
  [ "$acted" -eq 0 ] && { echo chrome; return; }
  [ $((now-acted)) -ge 180 ] && [ "$acted" -gt 0 ] && { echo report; return; }
  echo none
}
mem_cap(){
  local n=$1 u=$2 ws=$3 mb cap f="$RST/$1.mem" since=0 acted=0 now step pid
  mb=$(mem_mb "$u"); read -r cap _ <<< "$(limit_of "$n")"; now=$(date +%s)
  # its own AdsPower runs as the same user (about 4 GB more): at least 8 GB, whatever aqeelOS knew about it
  [ "$cap" -gt 0 ] && [ "$cap" -lt 8192 ] && pgrep -u "$u" -f "adspower_global|SunBrowser" >/dev/null 2>&1 && cap=8192
  [ -f "$f" ] && read -r since acted < "$f"
  if [ "$cap" -le 0 ] || [ "$mb" -le "$cap" ]; then rm -f -- "$f"; echo "$mb"; return; fi
  [ "${since:-0}" -gt 0 ] || since=$now
  step=$(mem_step "$mb" "$cap" "$now" "$since" "${acted:-0}")
  case "$step" in
    chrome) pid=$(ps -u "$u" -o pid=,args= | awk -v b="--user-data-dir=$ws/.browser" 'index($0,b) && $0 !~ /--type=/ {print $1; exit}')
            [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null; acted=$now; echo "janitor: $n uses $mb MB (cap $cap): its Chrome is started again" >&2 ;;
    report) report "$n" "memory" "uses $mb MB, over its $cap MB cap, even after its Chrome was started again. Raise its cap in hermes-ui-data/agent-limits.json or find what grows (System › Per agent)" >&2; acted=-1 ;;
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
  [ -f "$ISSUES" ] && [ "$(wc -l < "$ISSUES")" -gt 400 ] && tail -200 "$ISSUES" > "$ISSUES.tmp" && cat "$ISSUES.tmp" > "$ISSUES" && rm -f -- "$ISSUES.tmp"
  return 0
}

# sourced by the tests (scripts/agent-users.test.mjs): the functions only
[ "${AQ_AGENT_USERS_LIB:-0}" = 1 ] && return 0 2>/dev/null

case "${1:-watch}" in
  once) once ;;
  reset) [ -n "${2:-}" ] && echo "$2" >> "$RESET" && take_resets ;;
  janitor) janitor ;;
  stop) [ -n "${2:-}" ] && echo "$2" >> "$REQ.stop" && take_stops ;;
  watch) last=""; n=0; while true; do take_resets; take_stops; take_wakes; proxy_up; [ $((n % 12)) -eq 0 ] && [ -f "$REQ" ] && { janitor; sleep_idle; setup_wake; }; [ $((n % 720)) -eq 0 ] && [ -f "$REQ" ] && trim_logs; [ $((n % 6)) -eq 0 ] && { date +%s > "$ALIVE"; chown "$OWNER:$OWNER" "$ALIVE" 2>/dev/null; }; if [ -f "$SRC" ] && [ "$0" != "$SRC" ] && ! cmp -s "$SRC" "$0"; then install -m 755 -o root -g root "$SRC" "$0" && exec "$0" watch; fi; s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; n=$((n+1)); [ $((n % 6)) -eq 0 ] && [ -f "$REQ" ] && screens; sleep 5; done ;;
esac
