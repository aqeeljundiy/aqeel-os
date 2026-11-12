#!/bin/bash
# AUD-15 (13 Nov 2026): run on the AI box as root after a deploy (it changes nothing). As each agent's Linux user (ag-*) it tries:
#  - every browser debugging port on the box that is not that agent's own: the box user's and the engine's browsers, the deploy
#    checks' Chromes, agent-browser, the AdsPower bridge, other agents' Chromes and AdsPower, and the wake proxy's ports. Each must
#    be refused (PASS) or it is a FAIL. Only a TCP connect, closed at once: nothing is sent, so nothing is woken or driven;
#  - the app's own port (4400), which an agent's user must still reach (FAIL when the firewall shuts it out);
#  - every other screen: another agent's or the engine's VNC socket (may it even open it?, so a screen is never connected to) and
#    every X display that is not its own (it must not open it without that display's key);
#  - and that no viewer bridge of an older app (websockify on a 127.0.0.1 port) is still listening.
# Prints one PASS/FAIL line per try and a summary; exits 1 on any FAIL, 2 when it cannot run.
#   sudo bash scripts/devtools-reach-check.sh            (on the box; AQEELOS_USER when the box user is not "claude")
set -u
[ "$EUID" = 0 ] || [ -n "${AQ_RUNAS:-}" ] || { echo "run as root: it tries as each agent's own user"; exit 2; }
OWNER=${AQEELOS_USER:-claude}
OHOME=$(getent passwd "$OWNER" | cut -d: -f6)
[ -n "$OHOME" ] || { echo "no user $OWNER on this box"; exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# the root script decides what a debugging port is and whose it is: the same functions are used here
AU=${AQ_AGENT_USERS:-$HERE/agent-users.sh}
[ -f "$AU" ] || AU=/usr/local/sbin/aq-agent-users
export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME=$OHOME AQEELOS_USER=$OWNER
# shellcheck disable=SC1090
source "$AU" || { echo "could not read $AU"; exit 2; }
APP_PORT=${AQ_APP_PORT:-4400}
runas(){ local u=$1; shift; if [ -n "${AQ_RUNAS:-}" ]; then "$AQ_RUNAS" "$u" "$@"; else runuser -u "$u" -- "$@"; fi; }
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "PASS  $*"; }
bad(){ fail=$((fail+1)); echo "FAIL  $*"; }

# what a user may not reach, from the scan and the agents' port lines: "<port> <whose>" per line, for user number $1 (the wake
# proxy's number $2; stdin: devtools_scan lines prefixed "L ", devtools_agents lines). A port is the user's own when it listens as
# that user, or is one of its agent's two Chrome ports while nobody else holds it (the same as devtools_rules decides).
not_mine(){
  awk -v me="$1" -v wake="${2:--}" -v rx="$DEVTOOLS_RX" '
    $1=="A" {own[$3]=$5; own[$4]=$5; who[$3]="agent " $2 " (its browser, through the wake proxy)"; who[$4]="agent " $2 " (its Chrome)"; next}
    $1=="L" {cmd=$0; sub(/^L +[^ ]+ +[^ ]+ +[^ ]+ */,"",cmd); nl++; lp[nl]=$2; luid[nl]=$3; lc[nl]=cmd}
    END{ for(i=1;i<=nl;i++){ p=lp[i]; if(lc[i] ~ rx || (p in own)){ if(!(p in lu)) lu[p]=luid[i]; if(!(p in who)) who[p]="user " luid[i] ": " substr(lc[i],1,60) } }
      for(p in who){ if(p in own){ L=(p in lu)?lu[p]:""; m=(L=="" || L==own[p] || L==wake)?(own[p]==me):(L==me) } else m=(lu[p]==me); if(!m) print p, who[p] } }' | sort -n
}
try_tcp(){ runas "$1" timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$2" >/dev/null 2>&1; }

[ "${AQ_REACH_LIB:-0}" = 1 ] && return 0 2>/dev/null   # the tests: functions only
scan=$(devtools_scan | sed 's/^/L /'); agents=$(devtools_agents); wake=$(id -u "$WAKE_USER" 2>/dev/null || echo -)
users=$(getent passwd | awk -F: '$1 ~ /^ag-/ {print $1":"$3}')
[ -n "$users" ] || { echo "no agent users (ag-*) on this box: nothing to try"; exit 0; }
for x in $users; do
  u=${x%%:*}; uid=${x##*:}
  echo "== $u"
  while read -r port whose; do
    [ -n "$port" ] || continue
    if try_tcp "$u" "$port"; then bad "$u reached port $port ($whose)"; else ok "$u is refused on port $port ($whose)"; fi
  done <<< "$(printf '%s\n%s\n' "$scan" "$agents" | not_mine "$uid" "$wake")"
  if try_tcp "$u" "$APP_PORT"; then ok "$u still reaches the app on $APP_PORT"; else bad "$u cannot reach the app on $APP_PORT (the firewall shuts out too much)"; fi
  # screens: VNC sockets (never connected to: only whether this user may open them) and X displays
  for s in "$OHOME"/workspaces/*/.screen/rfb.sock "$OHOME"/.hermes/bot-desktop/rfb.sock "$OHOME"/.hermes/profiles/*/bot-desktop/rfb.sock; do
    [ -S "$s" ] || continue; [ "$(stat -c %u "$s")" = "$uid" ] && continue
    if runas "$u" test -w "$s" 2>/dev/null; then bad "$u may open the screen socket $s"; else ok "$u may not open $s"; fi
  done
  for x11 in /tmp/.X11-unix/X*; do
    [ -S "$x11" ] || continue; [ "$(stat -c %u "$x11")" = "$uid" ] && continue
    command -v xdpyinfo >/dev/null 2>&1 || { echo "SKIP  no xdpyinfo on the box: X displays not tried"; break; }
    d=:${x11##*/X}
    if runas "$u" env -u XAUTHORITY HOME=/nonexistent DISPLAY="$d" timeout 5 xdpyinfo >/dev/null 2>&1; then bad "$u opened the display $d without its key"; else ok "$u cannot open the display $d"; fi
  done
done
echo "== viewer bridges"
if ps -eo args= | grep -E '^([^ ]*/)?(python3? )?([^ ]*/)?websockify 127[.]0[.]0[.]1:[0-9]+ --unix-target=' >/dev/null; then bad "a viewer bridge (websockify on a 127.0.0.1 port) still runs: restart the app or end it"; else ok "no viewer bridge listens on a port"; fi
echo "== $pass passed, $fail failed"
[ "$fail" = 0 ]
