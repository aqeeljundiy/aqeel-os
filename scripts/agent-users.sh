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

setup_box(){
  # the file permission tools (setfacl) and SSH logins for the agents' users
  command -v setfacl >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null; } || echo "agent users: could not install acl"
  mkdir -p "$KEYS"; chmod 755 "$KEYS"
  [ -f /etc/ssh/sshd_config.d/claude.conf ] && sed -i 's/^AllowUsers claude$/AllowUsers claude ag-*/' /etc/ssh/sshd_config.d/claude.conf
  printf '%s\n' 'Match User ag-*' '  AuthorizedKeysFile /etc/ssh/agent-keys/%u' '  AllowTcpForwarding no' '  AllowStreamLocalForwarding no' '  X11Forwarding no' '  PermitTunnel no' '  AllowAgentForwarding no' '  PermitUserRC no' > /etc/ssh/sshd_config.d/zz-agents.conf
  # a Chrome every agent user may run (the engine's own copy lives in the closed part of the owner home)
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
screen_kill(){
  local u=$1 disp=$2 ws=$3 sig pats
  pats=("^bash -c[[:space:]]+cd '$ws'; export HOME='$ws' DISPLAY=" "^(dbus-launch --exit-with-session )?bash -c xfwm4 " "^Xvnc :$disp( |\$)" "/xfce4/" "^(/usr/bin/)?(xfwm4|xfdesktop|xfce4-panel|xfsettingsd|dbus-daemon|dbus-launch)( |\$)" "--user-data-dir=$ws/\\.browser( |\$)")
  pgrep -u "$u" -f "^Xvnc :$disp( |\$)|xfce4-panel|--user-data-dir=$ws/\\.browser" >/dev/null 2>&1 || return 0
  for sig in TERM KILL; do
    for p in "${pats[@]}"; do pkill -"$sig" -u "$u" -f -- "$p" 2>/dev/null; done
    sleep 1
  done
  echo "screen for ${ws##*/}: stopped what an earlier start left running"
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
    report "$n" "screen-stopped" "its screen failed 5 times within an hour and is left stopped. See $HOMEC/workspaces/$n/.screen/xvnc.log and chrome.log; to try again: echo $n >> $RESET"
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

screen_up(){
  local n=$1 u=${2} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp
  line=$(port_of "$n"); disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  # only aqeelOS (claude) and the agent's own user may reach its Chrome's control port
  iptables -C OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null || iptables -I OUTPUT 1 -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
  # the profile's bot-desktop folder is the agent's own .screen folder (where aqeelOS looks for any agent's screen)
  local prof="$HOMEC/.hermes/profiles/$n"
  if [ -d "$prof" ] && [ ! -L "$prof/bot-desktop" ]; then rm -rf "$prof/bot-desktop.engine"; [ -e "$prof/bot-desktop" ] && mv "$prof/bot-desktop" "$prof/bot-desktop.engine"; ln -s "$sd" "$prof/bot-desktop"; chown -h "$OWNER:$OWNER" "$prof/bot-desktop"; fi
  # already running: done
  if [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ]; then return 0; fi
  # waiting before trying again, or given up on after 5 failures (OPS-3): not started now
  restart_gate "$n" || return 0
  screen_kill "$u" "$disp" "$ws"
  mkdir -p "$sd"; chown "$u:$OWNER" "$sd"; chmod 2770 "$sd"
  rm -f "$sd/rfb.sock" "/tmp/.X$disp-lock" "/tmp/.X11-unix/X$disp"
  # a lock left by the Chrome of an earlier box (the box was rebuilt, so another host name) makes Chrome refuse to start
  rm -f "$ws/.browser/SingletonLock" "$ws/.browser/SingletonSocket" "$ws/.browser/SingletonCookie"
  runuser -u "$u" -- bash -c "
    cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'
    umask 007; : > \"\$XAUTHORITY\"; xauth -q add :$disp . \$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') 2>/dev/null
    printf 'DISPLAY=:%s\nXAUTHORITY=%s\n' '$disp' \"\$XAUTHORITY\" > '$sd/env'
    ( Xvnc :$disp -geometry 1280x800 -depth 24 -auth \"\$XAUTHORITY\" -SecurityTypes None -rfbport 0 -rfbunixpath '$sd/rfb.sock' -rfbunixmode 0660 -nolisten tcp -AlwaysShared >'$sd/xvnc.log' 2>&1 & echo \$! > '$sd/launcher.pid'; wait ) &
    for i in \$(seq 40); do [ -S '$sd/rfb.sock' ] && break; sleep 0.25; done
    ( dbus-launch --exit-with-session bash -c 'xfwm4 & xfdesktop & xfce4-panel & wait' >'$sd/desktop.log' 2>&1 & )
    rm -f '$sd/chrome.stopped'
    $(declare -f chrome_loop)
    ( chrome_loop '$sd' '$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='$ws/.browser' --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cdp --window-size=1280,800 --start-maximized about:blank & )
    touch '$sd/activity'
  " && echo "screen for $n on :$disp (chrome $cdp)"
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
}

# OPS-5 (OPERATIONS.md rule 4). Expected equals running: for each agent with a screen, exactly one display on its own
# number, one window manager, desktop and panel, and one Chrome (main process) on its own profile. Anything more, or a
# display on a number that is not the agent's, is extra: reported at once, removed when it is still there a minute later
# (the copy running longest is kept). A Chrome that gave up (chrome.stopped) files one issue. The counts go to $JAN.
# One agent's counts, "<name> <expected> <running> <extra pids...>", from "pid user etimes args" lines on stdin.
jan_count(){
  local n=$1 u=$2 disp=$3 ws=$4 exp=5
  [ -f "$ws/.screen/chrome.stopped" ] && exp=4
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
janitor(){
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
    for pid in $x; do
      if printf '%s\n' "$prev" | grep -qx "$pid"; then echo "janitor: $n: removed extra process $pid ($(ps -o args= -p "$pid" 2>/dev/null | cut -c1-60))"; kill -TERM "$pid" 2>/dev/null
      else echo "$pid" >> "$SEEN.tmp"; echo "janitor: $n: extra process $pid, removed next minute if still there"; fi
    done
    if [ -f "$ws/.screen/chrome.stopped" ] && [ ! -f "$ws/.screen/chrome.reported" ]; then
      report "$n" "chrome-stopped" "its Chrome exited 5 times within an hour and is left stopped. See $ws/.screen/chrome.log; to try again: echo $n >> $RESET"
      touch "$ws/.screen/chrome.reported"
    fi
    [ -f "$ws/.screen/chrome.stopped" ] || rm -f -- "$ws/.screen/chrome.reported"
    out="$out\"$n\":{\"expected\":$e,\"running\":$r,\"extra\":[$(echo $x | tr ' ' ',')]},"
  done < "$REQ"
  mv "$SEEN.tmp" "$SEEN"
  printf '{"at":%s,"expected":%s,"running":%s,"agents":{%s}}\n' "$(date +%s)" "$tot_e" "$tot_r" "${out%,}" > "$JAN.tmp" && chown "$OWNER:$OWNER" "$JAN.tmp" 2>/dev/null; chmod 640 "$JAN.tmp"; mv "$JAN.tmp" "$JAN"
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
  watch) last=""; n=0; while true; do take_resets; [ $((n % 12)) -eq 0 ] && [ -f "$REQ" ] && janitor; [ $((n % 720)) -eq 0 ] && [ -f "$REQ" ] && trim_logs; [ $((n % 6)) -eq 0 ] && { date +%s > "$ALIVE"; chown "$OWNER:$OWNER" "$ALIVE" 2>/dev/null; }; if [ -f "$SRC" ] && [ "$0" != "$SRC" ] && ! cmp -s "$SRC" "$0"; then install -m 755 -o root -g root "$SRC" "$0" && exec "$0" watch; fi; s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; n=$((n+1)); [ $((n % 6)) -eq 0 ] && [ -f "$REQ" ] && screens; sleep 5; done ;;
esac
