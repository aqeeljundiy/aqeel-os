#!/bin/bash
# Runs as root inside the AI box, started by the box's startup (the ai-box compose in Dokploy): "once" at boot, then
# "watch". aqeelOS lists, one per line in /home/claude/.aqeelos-agent-users, the agents that get a Linux user of
# their own (see app/agent-defaults.mjs). For each, this:
#  - makes the user ag-<agent> whose home is the agent's own folder (/home/claude/workspaces/<agent>), lets it in over
#    SSH with aqeelOS's agents key only (no forwarding of any kind), and closes everything else in /home/claude to it:
#    the owner's sign-ins and keys, aqeelOS's data and the other agents' folders. aqeelOS (the claude user) keeps full
#    access to every agent's folder;
#  - runs the agent's screen as that user: its own display (with a private key file, so no other user can see or type
#    into it), its desktop and its own Chrome with its own profile. Only the agent's user and aqeelOS may control that
#    Chrome (a network rule on its control port), and aqeelOS reaches the screen through the same files it reads for
#    any screen (<agent folder>/.screen, linked as the profile's bot-desktop folder).
# The users it made go to /home/claude/.aqeelos-agent-users.done; each agent's display and Chrome port to
# /home/claude/.aqeelos-agent-ports (agent display port per line).
set -u
HOMEC=${AQEELOS_HOME:-/home/claude}
REQ=$HOMEC/.aqeelos-agent-users
DONE=$REQ.done
PORTS=$HOMEC/.aqeelos-agent-ports
UIDS=$HOMEC/.aqeelos-agent-uids
KEYS=/etc/ssh/agent-keys
PUB=$HOMEC/.hermes/agent-ssh/id_ed25519.pub
CHROME_SRC=$(ls -d $HOMEC/.hermes/tools/chromium-*/chrome-linux64 2>/dev/null | sort | tail -1)
CHROME=/opt/aqeelos/chrome/chrome
SRC=$HOMEC/apps/hermes-ui/scripts/agent-users.sh

setup_box(){
  # the file permission tools (setfacl) and SSH logins for the agents' users
  command -v setfacl >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null; } || echo "agent users: could not install acl"
  mkdir -p "$KEYS"; chmod 755 "$KEYS"
  [ -f /etc/ssh/sshd_config.d/claude.conf ] && sed -i 's/^AllowUsers claude$/AllowUsers claude ag-*/' /etc/ssh/sshd_config.d/claude.conf
  printf '%s\n' 'Match User ag-*' '  AuthorizedKeysFile /etc/ssh/agent-keys/%u' '  AllowTcpForwarding no' '  AllowStreamLocalForwarding no' '  X11Forwarding no' '  PermitTunnel no' '  AllowAgentForwarding no' '  PermitUserRC no' > /etc/ssh/sshd_config.d/zz-agents.conf
  # a Chrome every agent user may run (the engine's own copy lives in the closed part of /home/claude)
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
  for f in "$DONE" "$PORTS" "$UIDS"; do [ -f "$f" ] && chown claude:claude "$f" && chmod 640 "$f"; done
}

# each agent keeps the same user number for good (kept in the home volume): files and access lists store numbers,
# so a rebuild that made the users in another order would hand one agent's folder to another
uid_of(){
  local n=$1 line uid
  line=$(grep "^$n " "$UIDS" 2>/dev/null | head -1)
  if [ -n "$line" ]; then echo "${line#* }"; return; fi
  uid=$(( $(cut -d' ' -f2 "$UIDS" 2>/dev/null | sort -n | tail -1) + 1 )); [ "$uid" -lt 2001 ] && uid=2001
  while getent passwd "$uid" >/dev/null || getent group "$uid" >/dev/null; do uid=$((uid+1)); done
  echo "$n $uid" >> "$UIDS"; chown claude:claude "$UIDS"; chmod 640 "$UIDS"; echo "$uid"
}

make_user(){
  local n=$1 u="ag-$1" ws="$HOMEC/workspaces/$1" uid
  u=${u:0:32}; uid=$(uid_of "$n")
  if ! id "$u" >/dev/null 2>&1; then groupadd -g "$uid" "$u" && useradd -M -d "$ws" -s /bin/bash -u "$uid" -g "$uid" "$u" || return 1
  elif [ "$(id -u "$u")" != "$uid" ]; then groupmod -g "$uid" "$u"; usermod -u "$uid" -g "$uid" "$u" || return 1; fi
  mkdir -p "$ws"
  chown -R "$u:claude" "$ws"
  find "$ws" -type d -exec chmod 2770 {} + 2>/dev/null
  find "$ws" -type f -exec chmod ug+rw,o-rwx {} + 2>/dev/null
  # it may pass through the home (not list it) to reach its folder; aqeelOS keeps full access to what it makes
  setfacl -m "u:$u:--x" "$HOMEC"
  # the folder's access list is made again from nothing: only aqeelOS and this agent, never a user left over from before
  setfacl -R -b "$ws"
  setfacl -R -m "u:claude:rwX,u:$u:rwX,g:claude:rwX" -m "d:u:claude:rwX,d:u:$u:rwX,d:g:claude:rwX" "$ws"
  if [ -f "$PUB" ]; then install -m 644 "$PUB" "$KEYS/$u"; fi
  echo "$u"
}

# a display and a Chrome port that stay the same for each agent (kept in $PORTS)
port_of(){
  local n=$1 line
  line=$(grep "^$n " "$PORTS" 2>/dev/null | head -1)
  if [ -z "$line" ]; then local i=0; while grep -q " $((40+i)) " "$PORTS" 2>/dev/null; do i=$((i+1)); done; line="$n $((40+i)) $((9600+i))"; echo "$line" >> "$PORTS"; chown claude:claude "$PORTS"; chmod 640 "$PORTS"; fi
  echo "$line"
}

screen_up(){
  local n=$1 u=${2} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp
  line=$(port_of "$n"); disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  # only aqeelOS (claude) and the agent's own user may reach its Chrome's control port
  iptables -C OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner claude -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null || iptables -I OUTPUT 1 -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner claude -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
  # the profile's bot-desktop folder is the agent's own .screen folder (where aqeelOS looks for any agent's screen)
  local prof="$HOMEC/.hermes/profiles/$n"
  if [ -d "$prof" ] && [ ! -L "$prof/bot-desktop" ]; then rm -rf "$prof/bot-desktop.engine"; [ -e "$prof/bot-desktop" ] && mv "$prof/bot-desktop" "$prof/bot-desktop.engine"; ln -s "$sd" "$prof/bot-desktop"; chown -h claude:claude "$prof/bot-desktop"; fi
  # already running: done
  if [ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && [ -S "$sd/rfb.sock" ]; then return 0; fi
  mkdir -p "$sd"; chown "$u:claude" "$sd"; chmod 2770 "$sd"
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
    ( while kill -0 \$(cat '$sd/launcher.pid') 2>/dev/null; do '$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='$ws/.browser' --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cdp --window-size=1280,800 --start-maximized about:blank >'$sd/chrome.log' 2>&1; sleep 3; done & )
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
  printf '%s' "$out" > "$DONE.tmp"; chown claude:claude "$DONE.tmp"; chmod 640 "$DONE.tmp"; mv "$DONE.tmp" "$DONE"
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
    [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner claude -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
    [ -f "$PORTS" ] && sed -i "/^$n /d" "$PORTS"
    rm -f "$KEYS/$u"
    userdel "$u" 2>/dev/null; groupdel "$u" 2>/dev/null
    [ -d "$HOMEC/workspaces/$n" ] && chown -R claude:claude "$HOMEC/workspaces/$n"
    echo "agent users: removed $u"
  done
  # display and port lines of agents that are gone (their users already went with an earlier box)
  if [ -f "$PORTS" ]; then local keep; keep=$(while read -r l; do n=${l%% *}; grep -qx "$n" "$REQ" && echo "$l"; done < "$PORTS"); printf "%s\n" "$keep" | sed "/^$/d" > "$PORTS.tmp" && chown claude:claude "$PORTS.tmp" && chmod 640 "$PORTS.tmp" && mv "$PORTS.tmp" "$PORTS"; fi
}

# every isolated agent's screen stays up (started again if it stopped)
screens(){
  [ -x "$CHROME" ] || return 0
  local n
  while read -r n; do [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue; id "ag-$n" >/dev/null 2>&1 && screen_up "$n" "ag-$n"; done < "$REQ"
}

case "${1:-watch}" in
  once) once ;;
  watch) last=""; n=0; while true; do if [ -f "$SRC" ] && [ "$0" != "$SRC" ] && ! cmp -s "$SRC" "$0"; then install -m 755 -o root -g root "$SRC" "$0" && exec "$0" watch; fi; s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; n=$((n+1)); [ $((n % 6)) -eq 0 ] && [ -f "$REQ" ] && screens; sleep 5; done ;;
esac
