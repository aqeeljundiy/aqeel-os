#!/bin/bash
# Runs as root inside the AI box, started by the box's startup (the ai-box compose in Dokploy): "once" at boot, then
# "watch". aqeelOS lists, one per line in /home/claude/.aqeelos-agent-users, the agents that get a Linux user of
# their own (see app/agent-defaults.mjs). For each, this makes the user ag-<agent> whose home is the agent's own
# folder (/home/claude/workspaces/<agent>), lets it in over SSH with aqeelOS's agents key, and closes everything else
# in /home/claude to it: the owner's sign-ins and keys, aqeelOS's data and the other agents' folders. aqeelOS (the
# claude user) keeps full access to every agent's folder. The users it made go to /home/claude/.aqeelos-agent-users.done.
set -u
HOMEC=/home/claude
REQ=$HOMEC/.aqeelos-agent-users
DONE=$REQ.done
KEYS=/etc/ssh/agent-keys
PUB=$HOMEC/.hermes/agent-ssh/id_ed25519.pub

lock_home(){
  # the home: only the claude user (and its group) inside; agents only pass through to their own folder
  chmod 750 "$HOMEC"
  for d in "$HOMEC"/* "$HOMEC"/.[!.]*; do [ -e "$d" ] || continue; [ "$d" = "$HOMEC/workspaces" ] && continue; chmod o-rwx "$d" 2>/dev/null; done
  chmod 711 "$HOMEC/workspaces" 2>/dev/null
  for d in "$HOMEC"/workspaces/*; do [ -d "$d" ] && chmod o-rwx "$d"; done
}

make_user(){
  local n=$1 u="ag-$1" ws="$HOMEC/workspaces/$1"
  u=${u:0:32}
  id "$u" >/dev/null 2>&1 || useradd -M -d "$ws" -s /bin/bash -U "$u" || return 1
  mkdir -p "$ws"
  chown -R "$u:claude" "$ws"
  find "$ws" -type d -exec chmod 2770 {} + 2>/dev/null
  find "$ws" -type f -exec chmod ug+rw,o-rwx {} + 2>/dev/null
  # it may pass through the home (not list it) to reach its folder; aqeelOS keeps full access to what it makes
  setfacl -m "u:$u:--x" "$HOMEC"
  setfacl -R -m "u:claude:rwX,u:$u:rwX,g:claude:rwX" -m "d:u:claude:rwX,d:u:$u:rwX,d:g:claude:rwX" "$ws"
  if [ -f "$PUB" ]; then install -m 644 "$PUB" "$KEYS/$u"; fi
  echo "$u"
}

once(){
  mkdir -p "$KEYS"; chmod 755 "$KEYS"
  [ -f "$REQ" ] || return 0
  lock_home
  local out="" n r
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    r=$(make_user "$n") && out="$out$r"$'\n'
  done < "$REQ"
  printf '%s' "$out" > "$DONE.tmp"; chown claude:claude "$DONE.tmp"; mv "$DONE.tmp" "$DONE"
  echo "agent users: $(printf '%s' "$out" | tr '\n' ' ')"
}

case "${1:-watch}" in
  once) once ;;
  watch) last=""; while true; do s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; sleep 5; done ;;
esac
