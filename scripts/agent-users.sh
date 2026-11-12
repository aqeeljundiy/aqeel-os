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
# an optional root-owned list of sha256 sums: when it exists, the watcher installs an updated copy of this script only if
# its sum is listed (see self_update)
PIN=${AQ_PIN:-/etc/aqeelos/agent-users.sha256}

# root runs commands only from folders that are root's own and that not everyone can write
if [ "$EUID" = 0 ]; then
  _p=""; IFS=: read -ra _dirs <<< "${PATH:-}"
  for _d in "${_dirs[@]}"; do
    case "$_d" in /*) [ "$(stat -Lc '%u' "$_d" 2>/dev/null)" = 0 ] && [ -z "$(find -L "$_d" -maxdepth 0 -perm -002 2>/dev/null)" ] && _p="$_p:$_d" ;; esac
  done
  PATH=${_p#:}; [ -n "$PATH" ] || PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH; unset _p _d _dirs
fi

# C1 (audit of 12 Nov 2026: an agent's user could become root). Root follows links. An agent owns its folder
# (~/workspaces/<agent>) and everything in it, so it can put a link to any file where this script was about to touch, write,
# chown or delete: root then did that to the link's target (/etc/cron.d, /etc/sudoers.d, this script). The rule since:
#  - root does NOTHING by path inside an agent's folder. Every write, delete and read of a file's contents there runs as the
#    agent's own user (as_user and the ag_* helpers below), so a planted link gives the agent only what it could already do;
#  - the same for the files this script shares with aqeelOS in the owner's home (own_*) and with the wake proxy (wake_*):
#    they are written as the user they belong to, never as root;
#  - what root keeps for itself lives under /var/lib/aqeelos (root's own folders);
#  - chown is always chown -h and never recursive. The one walk into an agent's folder is hand_tree, which refuses while
#    any process of that agent's user runs;
#  - a name, a number or a mode read from a file someone else can write is checked against a strict pattern before use.
# scripts/root-script-safety.test.mjs fails when a line breaks this; scripts/root-script-links.sh tries the links for real.
ok_name(){ [[ "${1:-}" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]]; }
# as_user <user> <command...>: the command runs as that user. On a terminal it also gets a session of its own, so it cannot
# type into root's. Not root (the tests): run as is, or through $AQ_AS when the test gives one.
as_user(){
  local u=$1; shift
  if [ "$EUID" != 0 ]; then if [ -n "${AQ_AS:-}" ]; then "$AQ_AS" "$u" "$@"; else "$@"; fi; return; fi
  if [ -t 0 ] || [ -t 1 ] || [ -t 2 ]; then setsid -w runuser -u "$u" -- "$@"; else runuser -u "$u" -- "$@"; fi
}
# In an agent's folder, as the agent ($1 = its user). A marker that root left there before this rule (not the agent's to
# write) is replaced: the folder is the agent's, so it may remove and make names in it.
ag_mark(){ local u=$1; shift; as_user "$u" sh -c 'for f; do : > "$f" || { rm -f -- "$f"; : > "$f"; }; done' sh "$@" 2>/dev/null </dev/null; }
ag_put(){ as_user "$1" sh -c 'printf "%s\n" "$2" > "$1.tmp.$$" && mv -f -- "$1.tmp.$$" "$1"' sh "$2" "$3" 2>/dev/null </dev/null; }
ag_rm(){ local u=$1; shift; as_user "$u" rm -f -- "$@" 2>/dev/null </dev/null; }
ag_dir(){ as_user "$1" sh -c 'mkdir -p -- "$1" && chmod 2770 "$1"' sh "$2" 2>/dev/null </dev/null; }
# the first 64 bytes of a small file there, letters, digits and . _ - only: read as the agent and within 2 s, so a link to a
# file of root's reads nothing and a pipe put in its place cannot hold this script
ag_read(){ as_user "$1" timeout 2 head -c 64 -- "$2" 2>/dev/null </dev/null | tr -cd 'A-Za-z0-9._-'; }
# what runs on the screen in folder $2 of user $1: one of the three known words, else $3 (default desktop)
screen_mode(){ local m; m=$(ag_read "$1" "$2/mode"); case "$m" in lean-fluxbox|lean-bare|desktop) echo "$m" ;; *) echo "${3:-desktop}" ;; esac; }
# the user a process number ($1) belongs to
pid_user(){ ps -o user:32= -p "$1" 2>/dev/null | tr -d ' '; }
# Is the screen's launcher (the display, its number in .screen/launcher.pid) running? The number comes from a file the
# agent can write: it must be a number, and the process must be one of this agent's own.
launcher_alive(){
  local u=$1 sd=$2 pid
  [ -f "$sd/launcher.pid" ] || return 1
  pid=$(ag_read "$u" "$sd/launcher.pid"); [[ "$pid" =~ ^[0-9]{1,9}$ ]] && [ "$pid" -gt 1 ] || return 1
  if [ "$EUID" = 0 ]; then [ "$(pid_user "$pid")" = "$u" ]; else kill -0 "$pid" 2>/dev/null; fi
}
# keeps the end of a file, as the user it belongs to: trim_lines <user> <file> <over lines> <keep lines>, trim_bytes the same in bytes
trim_lines(){ as_user "$1" sh -c '[ -f "$1" ] && [ "$(wc -l < "$1")" -gt "$2" ] && tail -n "$3" "$1" > "$1.tmp" && cat "$1.tmp" > "$1" && rm -f -- "$1.tmp"' sh "$2" "$3" "$4" 2>/dev/null </dev/null; }
trim_bytes(){ as_user "$1" sh -c '[ -f "$1" ] && [ "$(stat -c %s "$1")" -gt "$2" ] && tail -c "$3" "$1" > "$1.tmp" && cat "$1.tmp" > "$1" && rm -f -- "$1.tmp"' sh "$2" "$3" "$4" 2>/dev/null </dev/null; }
# The files shared with aqeelOS in the owner's home, written as the owner: own_put <file> (stdin becomes the file, through a
# new file beside it), own_add <file> (stdin is appended), own_clear <file>
own_put(){ as_user "$OWNER" sh -c 'umask 027; cat > "$1.tmp.$$" && mv -f -- "$1.tmp.$$" "$1"' sh "$1"; }
own_add(){ as_user "$OWNER" sh -c 'umask 027; cat >> "$1"' sh "$1"; }
own_clear(){ as_user "$OWNER" sh -c ': > "$1"' sh "$1" </dev/null; }
# text for a JSON string: no control characters, backslashes or double quotes (a folder or a process name is the agent's to
# choose, and a line break in one would have written a second, made-up line into the file aqeelOS reads)
js(){ printf '%s' "${1:-}" | tr -d '\000-\037\\' | tr '"' "'"; }

setup_box(){
  # the file permission tools (setfacl) and SSH logins for the agents' users
  command -v setfacl >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null; } || echo "agent users: could not install acl"
  mkdir -p "$KEYS"; chmod 755 "$KEYS"
  [ -f /etc/ssh/sshd_config.d/claude.conf ] && sed -i -e 's/^AllowUsers claude$/AllowUsers claude ag-* aq-fixer/' -e 's/^AllowUsers claude ag-[*]$/AllowUsers claude ag-* aq-fixer/' /etc/ssh/sshd_config.d/claude.conf
  printf '%s\n' 'Match User ag-*,aq-fixer' '  AuthorizedKeysFile /etc/ssh/agent-keys/%u' '  AllowTcpForwarding no' '  AllowStreamLocalForwarding no' '  X11Forwarding no' '  PermitTunnel no' '  AllowAgentForwarding no' '  PermitUserRC no' > /etc/ssh/sshd_config.d/zz-agents.conf
  # sshd reads its files at start: asked to read them again (running sessions stay)
  pkill -HUP -x sshd 2>/dev/null
  # a Chrome every agent user may run (the engine's own copy lives in the closed part of the owner home)
  setup_wake || echo "agent users: could not set up the wake proxy"
  x11_dir
  local_fw
  fixer_step
  devtools_fw full
  if [ -n "$CHROME_SRC" ] && [ ! -x "$CHROME" ]; then mkdir -p /opt/aqeelos; rm -rf /opt/aqeelos/chrome; cp -a --no-preserve=ownership "$CHROME_SRC" /opt/aqeelos/chrome; chmod -R a+rX /opt/aqeelos; fi
}

# CR-6, H-10, H-12 (security audit of 12 Nov 2026). The engine's dashboard (9119) gives its session token to whoever asks,
# and the gateway (8642), the WhatsApp bridges (3000-3002), the shared screen (5900, 6080), every VNC port and the deploy
# check's test copy (4402) take any caller on the box. Agents are users on the box. So: on the box's own addresses only
# root and the owner's user may connect to those ports (everyone else is refused at once), and nothing from outside the
# box reaches a VNC port. An agent reaches its own Chrome through the wake proxy as before (screen_up's rules) and its
# screen through the socket in its folder. aqeelOS itself (4400) and what agents run for themselves stay open.
# More ports: AQ_LOCAL_PORTS (the script's own environment). Safe to run again: it only adds what is missing.
LOCAL_PORTS=${AQ_LOCAL_PORTS:-9119,8642,3000:3002,4402,5900:5999,6080}
local_fw(){
  local ipt ok=1 why=""
  [[ "$LOCAL_PORTS" =~ ^[0-9:,]+$ ]] || { why="the port list is not a list of ports"; ok=0; }
  command -v iptables >/dev/null 2>&1 || { why="iptables is not installed in the box"; ok=0; }
  if [ "$ok" = 1 ]; then
    for ipt in iptables ip6tables; do
      command -v "$ipt" >/dev/null 2>&1 || continue
      "$ipt" -N AQ-LOCAL 2>/dev/null
      if ! { "$ipt" -C AQ-LOCAL -m owner --uid-owner 0 -j RETURN && "$ipt" -C AQ-LOCAL -m owner --uid-owner "$OWNER" -j RETURN && "$ipt" -C AQ-LOCAL -p tcp -m multiport --dports "$LOCAL_PORTS" -j REJECT --reject-with tcp-reset; } 2>/dev/null; then
        "$ipt" -F AQ-LOCAL && "$ipt" -A AQ-LOCAL -m owner --uid-owner 0 -j RETURN && "$ipt" -A AQ-LOCAL -m owner --uid-owner "$OWNER" -j RETURN \
          && "$ipt" -A AQ-LOCAL -p tcp -m multiport --dports "$LOCAL_PORTS" -j REJECT --reject-with tcp-reset \
          && echo "local firewall ($ipt): only root and $OWNER may connect to $LOCAL_PORTS on this box" || { [ "$ipt" = iptables ] && { ok=0; why="iptables refused the rules (no right to set them in this box?)"; }; }
      fi
      "$ipt" -C OUTPUT -o lo -p tcp -j AQ-LOCAL 2>/dev/null || "$ipt" -I OUTPUT 1 -o lo -p tcp -j AQ-LOCAL 2>/dev/null || { [ "$ipt" = iptables ] && { ok=0; why=${why:-"iptables refused the rules (no right to set them in this box?)"}; }; }
      "$ipt" -C INPUT ! -i lo -p tcp --dport 5900:5999 -j REJECT --reject-with tcp-reset 2>/dev/null || "$ipt" -I INPUT 1 ! -i lo -p tcp --dport 5900:5999 -j REJECT --reject-with tcp-reset 2>/dev/null
    done
  fi
  mkdir -p "$RST"
  if [ "$ok" = 1 ]; then rm -f -- "$RST/.fw-failed"; return 0; fi
  echo "agent users: LOCAL FIREWALL NOT APPLIED: $why. Every agent can reach the engine's dashboard and gateway on this box."
  [ -f "$RST/.fw-failed" ] || { : > "$RST/.fw-failed"; report default "local-firewall" "the box's local firewall could not be applied: $why. Until it is, every agent's user can call the engine's dashboard (9119), the gateway (8642) and the WhatsApp bridges directly. The box needs iptables and the NET_ADMIN right (the ai-box compose)." "Local firewall not applied"; }
  return 1
}

# AUD-15 part 2 (13 Nov 2026): the browsers' debugging ports. Whoever connects to a DevTools port controls that browser and every
# sign-in in it, and any user on the box may connect to 127.0.0.1. Only each agent's own Chrome port had a rule (screen_up, until
# now); the engine's browsers (the box user's Chromes on random ports, agent-browser, the AdsPower bridge on 9333), the deploy
# checks' Chromes and each agent's own AdsPower (its API and its browsers, on every address) took any caller. Same mechanism as
# local_fw: a chain on the box's own addresses (AQ-DEVTOOLS, from OUTPUT -o lo), plus one for connections from outside the box
# (AQ-DEVIN, from INPUT ! -i lo) for a debugging port that listens on every address. Every rule only refuses: "port P, anyone but
# root, the box user and the port's own user(s) -> refused at once", so rules can be added and removed in any order and a change
# never opens anything for a moment. What is a debugging port is read from what listens (ss, as root) and its command line; each
# agent's two Chrome ports (the wake proxy's outer one and Chrome's inner one) are covered from its port line, also while it sleeps:
#   outer port (the wake proxy, aq-wake): the agent's user;   inner port (its Chrome): the agent's user and the wake proxy.
# A port of an agent held by another user (someone listening on it while the agent's Chrome sleeps) is that user's alone, so the
# wake proxy cannot be led to it, and is reported. Looked at every pass of the watcher (5 s); a change is applied at once.
DEVTOOLS_RX=${AQ_DEVTOOLS_RX:-'--remote-debugging-port=|/agent-browser|adspower_global|SunBrowser|adspower-bridge[.]mjs|wake-proxy[.]mjs'}
# what listens, one "<port> <uid> <lo|any> <command line>" per TCP listener (root sees every process)
devtools_scan(){
  ss -Hltnpe 2>/dev/null | awk '{a=$4; u=0; p=""
    for(i=5;i<=NF;i++){ if($i ~ /^uid:[0-9]+$/) u=substr($i,5); if(p=="" && match($i,/pid=[0-9]+/)) p=substr($i,RSTART+4,RLENGTH-4) }
    n=split(a,x,":"); port=x[n]; host=substr(a,1,length(a)-length(port)-1)
    sc=(host ~ /^(127[.]|[[]::1[]]|[[]::ffff:127[.])/)?"lo":"any"
    if(port ~ /^[0-9]+$/ && p!="") print port, u, sc, p}' | sort -u | while read -r port uid sc pid; do
      printf '%s %s %s %s\n' "$port" "$uid" "$sc" "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | head -c 400 | tr -d '\n')"
    done
}
# each agent with its own user: "A <agent> <outer port> <inner port> <its user number>"
devtools_agents(){
  local n d cdp uid
  [ -f "$PORTS" ] || return 0
  while read -r n d cdp; do
    ok_name "$n" && [[ "$cdp" =~ ^[0-9]{2,5}$ ]] || continue
    uid=$(id -u "ag-$n" 2>/dev/null) || continue
    echo "A $n $cdp $((cdp+10000)) $uid"
  done < "$PORTS"
}
# The rules, from "L <port> <uid> <lo|any> <command line>" and "A ..." lines on stdin: devtools_rules <box user's number>
# <wake proxy's number or ->. Prints "OUT <iptables arguments>" (AQ-DEVTOOLS), "IN <arguments>" (AQ-DEVIN) and
# "SQUAT <port> <agent> <user number>", ports in order. Nothing is run: scripts/devtools-firewall.test.mjs checks what it prints.
# Anything listening on an agent's port counts, whatever it is (in any order of the lines).
devtools_rules(){
  awk -v own="$1" -v wake="${2:--}" -v rx="$DEVTOOLS_RX" '
    $1=="A" && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/ {outer[$3]=$5; inner[$4]=$5; name[$3]=$2; name[$4]=$2; ports[$3]=1; ports[$4]=1; next}
    $1=="L" && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {cmd=$0; sub(/^L +[^ ]+ +[^ ]+ +[^ ]+ */,"",cmd); nl++; lp[nl]=$2; lu[nl]=$3; ls[nl]=$4; lc[nl]=cmd}
    END{
      for(i=1;i<=nl;i++){ p=lp[i]; if(lc[i] ~ rx || (p in outer) || (p in inner)){ if(!(p in lis)) lis[p]=lu[i]; if(ls[i]=="any") wide[p]=1; ports[p]=1 } }
      for(p in ports){ n=0; delete ok; sq=""
        if(p in outer){ a=outer[p]; if(!(p in lis) || lis[p]==a || lis[p]==wake){ ok[a]=1; if(p in lis) ok[lis[p]]=1 } else { ok[lis[p]]=1; sq=lis[p] } }
        else if(p in inner){ a=inner[p]; if(!(p in lis) || lis[p]==a){ ok[a]=1; if(wake!="-") ok[wake]=1 } else { ok[lis[p]]=1; sq=lis[p] } }
        else ok[lis[p]]=1
        m=""; delete l
        # in number order, so the same set always gives the same rule
        k=0; for(u in ok) if(u!=0 && u!=own) l[++k]=u+0
        for(i=1;i<=k;i++) for(j=i+1;j<=k;j++) if(l[j]<l[i]){t=l[i]; l[i]=l[j]; l[j]=t}
        for(i=1;i<=k;i++) m=m " -m owner ! --uid-owner " l[i]
        printf "%d 1 OUT -p tcp --dport %d -m owner ! --uid-owner 0 -m owner ! --uid-owner %s%s -j REJECT --reject-with tcp-reset\n", p, p, own, m
        if(p in wide) printf "%d 2 IN -p tcp --dport %d -j REJECT --reject-with tcp-reset\n", p, p
        if(sq!="") printf "%d 3 SQUAT %d %s %s\n", p, p, name[p], sq
      } }' | sort -n -k1,1 -k2,2 | cut -d' ' -f3-
}
# applies them: what is missing is added, what is no longer wanted removed (after the adds), for iptables and ip6tables. $1=full:
# every rule is looked for again (the watcher does this once a minute), else only a change is applied. Safe to run again.
devtools_fw(){
  command -v iptables >/dev/null 2>&1 && command -v ss >/dev/null 2>&1 || return 0
  local ou wu rules ipt st kind args ok=1 good
  ou=$(id -u "$OWNER" 2>/dev/null) || return 0; wu=$(id -u "$WAKE_USER" 2>/dev/null || echo -)
  rules=$( { devtools_agents; devtools_scan | sed 's/^/L /'; } | devtools_rules "$ou" "$wu")
  mkdir -p "$RST"
  for ipt in iptables ip6tables; do
    command -v "$ipt" >/dev/null 2>&1 || continue
    st="$RST/.devtools.$ipt"; good=1
    [ "${1:-}" != full ] && [ "$rules" = "$(cat "$st" 2>/dev/null)" ] && continue
    "$ipt" -N AQ-DEVTOOLS 2>/dev/null; "$ipt" -N AQ-DEVIN 2>/dev/null
    "$ipt" -C OUTPUT -o lo -p tcp -j AQ-DEVTOOLS 2>/dev/null || "$ipt" -I OUTPUT 1 -o lo -p tcp -j AQ-DEVTOOLS 2>/dev/null || good=0
    "$ipt" -C INPUT ! -i lo -p tcp -j AQ-DEVIN 2>/dev/null || "$ipt" -I INPUT 1 ! -i lo -p tcp -j AQ-DEVIN 2>/dev/null || good=0
    while read -r kind args; do
      case $kind in OUT) "$ipt" -C AQ-DEVTOOLS $args 2>/dev/null || "$ipt" -A AQ-DEVTOOLS $args 2>/dev/null || good=0 ;;
                    IN) "$ipt" -C AQ-DEVIN $args 2>/dev/null || "$ipt" -A AQ-DEVIN $args 2>/dev/null || good=0 ;; esac
    done <<< "$rules"
    # not all in place: nothing is removed and the record stays as it was, so the next pass tries again
    [ "$good" = 1 ] || { [ "$ipt" = iptables ] && ok=0; continue; }
    # rules of ports nobody listens on any more go, once the new ones are in
    [ -f "$st" ] && while read -r kind args; do
      [ -n "$kind" ] || continue; grep -qxF -- "$kind $args" <<< "$rules" && continue
      case $kind in OUT) "$ipt" -D AQ-DEVTOOLS $args 2>/dev/null ;; IN) "$ipt" -D AQ-DEVIN $args 2>/dev/null ;; esac
    done < "$st"
    printf '%s\n' "$rules" > "$st"
  done
  # the rules screen_up used to put straight into OUTPUT for each agent's two Chrome ports are now in AQ-DEVTOOLS: removed once
  if [ "$ok" = 1 ] && [ ! -f "$RST/.devtools-legacy-gone" ] && [ -f "$PORTS" ]; then
    local n d cdp u
    while read -r n d cdp; do ok_name "$n" && [[ "$cdp" =~ ^[0-9]{2,5}$ ]] || continue; u="ag-$n"; u=${u:0:32}
      while iptables -D OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null; do :; done
      while iptables -D OUTPUT -o lo -p tcp --dport "$((cdp+10000))" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null; do :; done
    done < "$PORTS"
    : > "$RST/.devtools-legacy-gone"
  fi
  # someone else listens on an agent's Chrome port: said once per port and user
  while read -r kind args; do
    [ "$kind" = SQUAT ] || continue; set -- $args
    [ -f "$RST/.squat-$1-$3" ] && continue; : > "$RST/.squat-$1-$3"
    report "$2" "devtools-port-taken" "another user (number $3) listens on port $1, which belongs to this agent's browser. Only that user may reach it now, and this agent's browser cannot start there until it stops." "Browser port taken"
  done <<< "$rules"
  [ "$ok" = 1 ] && { rm -f -- "$RST/.devtools-fw-failed"; return 0; }
  [ -f "$RST/.devtools-fw-failed" ] || { : > "$RST/.devtools-fw-failed"; report default "devtools-firewall" "the rules that keep each browser's debugging port to its own user could not be applied (iptables refused them). Until they are, every agent's user can control the engine's browsers and the other agents' Chromes." "Browser port rules not applied"; }
  return 1
}

# CR-7 part 2 (13 Nov 2026): the on-box fixer ran as the owner's user, who holds every key. With the fixer's own user (aq-fixer) the
# engine run that fixes aqeelOS's own code keeps its model access in the owner's process, but its terminal and file tools run
# over SSH as aq-fixer: it passes through the owner's home to the checkout it was given (the app puts an access list on that
# folder), cannot read ~/.hermes, the data folder, the agents' folders or the local-owner key, and its user may open one network
# connection only: the app's own port on this box (the routes the app signs for it). GitHub and the AI provider are reached by
# the app and the engine (the owner's user), never by the fixer's shell, so the firewall needs no address list for them.
# aqeelOS asks with "on" in ~/.aqeelos-fixer-user (the setting fixer.isolate); the answer is "aq-fixer" in ~/.aqeelos-fixer-user.done.
FIXREQ=$HOMEC/.aqeelos-fixer-user
FIXUSER=aq-fixer
APP_PORT=${AQ_APP_PORT:-4400}
# read as the owner (the file is the owner's), eight letters at most
fixer_wanted(){ local m; m=$(as_user "$OWNER" timeout 2 head -c 8 -- "$FIXREQ" 2>/dev/null </dev/null | tr -cd 'a-z'); [ "$m" = on ]; }
fixer_make(){
  local uid
  if ! id "$FIXUSER" >/dev/null 2>&1; then
    uid=$(uid_of "$FIXUSER") || return 1
    groupadd -g "$uid" "$FIXUSER" && useradd -M -d "$HOMEC/apps/aqeel-os-fixer" -s /bin/bash -u "$uid" -g "$uid" "$FIXUSER" || return 1
  fi
  [ -f "$PUB" ] && install -m 644 "$PUB" "$KEYS/$FIXUSER"
  # it may pass through the home (not list it); lock_home keeps this entry
  setfacl -m "u:$(id -u "$FIXUSER"):--x" "$HOMEC"
  echo "$FIXUSER" | own_put "$FIXREQ.done"
}
# the one outgoing connection of the fixer's user: the app on this box. Everything else is refused at once.
fixer_fw(){
  local ipt ok=1
  id "$FIXUSER" >/dev/null 2>&1 || return 0
  command -v iptables >/dev/null 2>&1 || ok=0
  for ipt in iptables ip6tables; do
    command -v "$ipt" >/dev/null 2>&1 || continue
    "$ipt" -N AQ-FIXER 2>/dev/null
    if ! { "$ipt" -C AQ-FIXER -o lo -p tcp --dport "$APP_PORT" -j RETURN && "$ipt" -C AQ-FIXER -j REJECT; } 2>/dev/null; then
      "$ipt" -F AQ-FIXER && "$ipt" -A AQ-FIXER -o lo -p tcp --dport "$APP_PORT" -j RETURN && "$ipt" -A AQ-FIXER -j REJECT || { [ "$ipt" = iptables ] && ok=0; }
    fi
    "$ipt" -C OUTPUT -m owner --uid-owner "$FIXUSER" -j AQ-FIXER 2>/dev/null || "$ipt" -I OUTPUT 1 -m owner --uid-owner "$FIXUSER" -j AQ-FIXER 2>/dev/null || { [ "$ipt" = iptables ] && ok=0; }
  done
  mkdir -p "$RST"
  if [ "$ok" = 1 ]; then rm -f -- "$RST/.fixer-fw-failed"; return 0; fi
  echo "agent users: FIXER FIREWALL NOT APPLIED (iptables missing or refused): the fixer's user can reach the network"
  [ -f "$RST/.fixer-fw-failed" ] || { : > "$RST/.fixer-fw-failed"; report default "fixer-firewall" "the firewall for the fixer's own user could not be applied (iptables is missing or refused the rules in this box). Until it is, the fixer's shell can reach the network; it still cannot read the owner's keys." "Install iptables in the box and run aq-agent-users once."; }
  return 1
}
fixer_step(){ fixer_wanted || return 0; fixer_make && fixer_fw; }

# /tmp/.X11-unix (every display's socket) belonged to whichever agent started a display first, who could then remove or
# swap the others'. It is root's: chown -h never follows a link, and once the name is root's nobody else can replace it
# (/tmp is sticky), so the mode is set only on a folder that is root's by then.
x11_dir(){
  local d=/tmp/.X11-unix
  chown -h root:root "$d" 2>/dev/null; [ -L "$d" ] && rm -f -- "$d"; [ -e "$d" ] || mkdir -m 1777 "$d" 2>/dev/null
  [ "$(stat -c '%u %F' "$d" 2>/dev/null)" = "0 directory" ] && chmod 1777 "$d"
  return 0
}

# Only names directly in the owner's home and in its workspaces folder (no agent can add or swap a name there), and never
# through a link: chmod follows links, so a link in the home to a system folder had that folder closed to everyone.
lock_home(){
  # the home: only the claude user (and its group) inside; agents only pass through to their own folder
  chmod 750 "$HOMEC"
  # Who may pass through the home: exactly the agents asked for, set in one step (M19: the list used to be emptied first and
  # filled again one agent at a time, each after a walk through its whole folder, so every other agent was locked out of
  # its home meanwhile). By user number: a user that is not made yet is named too. None left over from an earlier start.
  local n uid acl="" d
  while read -r n; do
    ok_name "$n" || continue
    handover_failed "$n" && continue
    uid=$(awk -v n="$n" '$1==n && $2 ~ /^[0-9]+$/ {print $2; exit}' "$UIDS" 2>/dev/null)
    [ -n "$uid" ] && [ "$uid" -ge 2001 ] && acl="$acl,u:$uid:--x"
  done < "$REQ"
  # the fixer's own user (CR-7), when aqeelOS asked for it and it has its number
  if fixer_wanted; then uid=$(awk -v n="$FIXUSER" '$1==n && $2 ~ /^[0-9]+$/ {print $2; exit}' "$UIDS" 2>/dev/null); [ -n "$uid" ] && [ "$uid" -ge 2001 ] && acl="$acl,u:$uid:--x"; fi
  setfacl -k "$HOMEC" 2>/dev/null
  if [ -n "$acl" ]; then setfacl --set "u::rwx,g::r-x,o::---$acl" "$HOMEC" 2>/dev/null || setfacl -b "$HOMEC" 2>/dev/null; else setfacl -b "$HOMEC" 2>/dev/null; fi
  for d in "$HOMEC"/* "$HOMEC"/.[!.]*; do [ -e "$d" ] || continue; [ -L "$d" ] && continue; [ "$d" = "$HOMEC/workspaces" ] && continue; chmod o-rwx "$d" 2>/dev/null; done
  [ -L "$HOMEC/workspaces" ] || chmod 711 "$HOMEC/workspaces" 2>/dev/null
  for d in "$HOMEC"/workspaces/*; do [ -d "$d" ] && [ ! -L "$d" ] && chmod o-rwx "$d"; done
  return 0
}

# each agent keeps the same user number for good (kept in the home volume): files and access lists store numbers,
# so a rebuild that made the users in another order would hand one agent's folder to another
uid_of(){
  local n=$1 line uid
  ok_name "$n" || return 1
  line=$(grep "^$n " "$UIDS" 2>/dev/null | head -1)
  # the number comes from a file in the owner's home: only a plain number from 2001 up is ever a user number
  if [ -n "$line" ]; then uid=${line#* }; [[ "$uid" =~ ^[0-9]{4,9}$ ]] && [ "$uid" -ge 2001 ] || return 1; echo "$uid"; return; fi
  uid=$(( $(awk '$2 ~ /^[0-9]{1,9}$/ {print $2}' "$UIDS" 2>/dev/null | sort -n | tail -1) + 1 )); [ "$uid" -lt 2001 ] && uid=2001
  while getent passwd "$uid" >/dev/null || getent group "$uid" >/dev/null; do uid=$((uid+1)); done
  echo "$n $uid" | own_add "$UIDS"; echo "$uid"
}

# The agent's folder itself. Its name sits in the owner's workspaces folder, where no agent can add or swap a name, so root
# may make it and set its owner, mode and access list: never through a link, and only the folder, not what is in it.
ws_top(){
  local u=$1 ws=$2 acl="u:$OWNER:rwX,u:$1:rwX,g:$OWNER:rwX"
  [ -L "$ws" ] && { echo "agent users: $ws is a link, not a folder: left alone" >&2; return 1; }
  mkdir -p "$ws"; [ -d "$ws" ] && [ ! -L "$ws" ] || return 1
  # not the agent's yet (a new agent, or one that ran as the owner until now): what is in it is handed over, once
  [ "$(stat -c %u "$ws")" = "$(id -u "$u")" ] || hand_tree "$u:$OWNER" "$ws" "$u" "$acl"
  chown -h "$u:$OWNER" "$ws"; chmod 2770 "$ws"
  setfacl -b "$ws"; setfacl -m "$acl" -m "d:u:$OWNER:rwX,d:u:$u:rwX,d:g:$OWNER:rwX" "$ws"
  # a file aqeelOS put there closed (mode 600) is opened to the agent by aqeelOS's own user, the file's owner
  as_user "$OWNER" find "$ws" -xdev -user "$OWNER" ! -type l ! -perm -060 -exec chmod g+rwX {} + 2>/dev/null </dev/null
  return 0
}
# The one walk root makes into an agent's folder: every name in it gets a new owner ($1, to the agent when it gets a user of
# its own, back to the owner when the agent is removed), and with $4 the modes and access list of an agent's folder.
# Refused while any process of the agent's user ($3, a name or a number) runs: with none, nothing can swap a name under
# the walk. chown -h changes a link, never its target; a file with a second name elsewhere (a hard link) is left alone.
hand_tree(){
  local own=$1 ws=$2 u=$3 acl=${4:-} strip=${5:-}
  [ -d "$ws" ] && [ ! -L "$ws" ] || return 1
  pgrep -u "$u" >/dev/null 2>&1 && { echo "agent users: $ws not handed over: processes of $u still run" >&2; return 1; }
  find "$ws" -xdev \( -type f -links +1 \) -o -exec chown -h -- "$own" {} +
  # $5: a user number whose access-list entries go (the way back of a move to its own user)
  [[ "$strip" =~ ^[0-9]{4,9}$ ]] && { setfacl -R -P -x "u:$strip" "$ws" 2>/dev/null; setfacl -R -P -x "d:u:$strip" "$ws" 2>/dev/null; }
  [ -n "$acl" ] || return 0
  find "$ws" -xdev -type d -exec chmod 2770 {} + 2>/dev/null
  find "$ws" -xdev -type f -links 1 -exec chmod ug+rw,o-rwx {} + 2>/dev/null
  setfacl -R -P -b "$ws"
  setfacl -R -P -m "$acl" -m "d:u:$OWNER:rwX,d:u:${own%%:*}:rwX,d:g:$OWNER:rwX" "$ws"
}

make_user(){
  local n=$1 u="ag-$1" ws="$HOMEC/workspaces/$1" uid
  ok_name "$n" || return 1
  u=${u:0:32}; uid=$(uid_of "$n") || return 1; [ -n "$uid" ] || return 1
  if ! id "$u" >/dev/null 2>&1; then groupadd -g "$uid" "$u" && useradd -M -d "$ws" -s /bin/bash -u "$uid" -g "$uid" "$u" || return 1
  elif [ "$(id -u "$u")" != "$uid" ]; then groupmod -g "$uid" "$u"; usermod -u "$uid" -g "$uid" "$u" || return 1; fi
  # it may pass through the home (not list it) to reach its folder; aqeelOS keeps full access to what it makes
  setfacl -m "u:$u:--x" "$HOMEC"
  # the folder's own access list is made again from nothing: only aqeelOS and this agent, never a user left over from before.
  # C1: what is inside is the agent's, and root no longer walks it on every pass (ws_top, hand_tree)
  ws_top "$u" "$ws" || return 1
  if [ -f "$PUB" ]; then install -m 644 "$PUB" "$KEYS/$u"; fi
  echo "$u"
}

# Giving an agent that has run as the owner until now its own user (the "Trusted: off" switch; scripts/own-user.sh). A new
# agent has nothing running; this one has an engine screen (display and Chrome as the owner) holding its folder, and its
# real browser sign-ins sit in the engine screen's profile (.screen/browser-profile), not in the .browser the own user's
# Chrome uses (found on 12 Nov 2026 for one such agent: its .browser was 5 days old). So a move is: record how it was,
# stop only that agent's old screen, make the user and hand the folder over, carry the sign-ins over, bring the screen up,
# check, and undo everything when the check fails (the app flips the agent's terminal to its user only once the user is in
# .done, so a move that is undone changes nothing for the agent). Root's own folder $HAND keeps the record: <agent>.prev
# (owner, mode, time), <agent>.acl (the folder's access list before) and, after a failed move, <agent>.failed (no new try
# until that file is removed: rm /var/lib/aqeelos/handover/<agent>.failed).
HAND=${AQ_HANDOVER:-/var/lib/aqeelos/handover}
handover_failed(){ [ -f "$HAND/$1.failed" ]; }
# a move, not a new agent: no user yet, and the folder is the owner's
handover_needed(){
  local n=$1 u ws="$HOMEC/workspaces/$1"
  ok_name "$n" || return 1
  u="ag-$n"; u=${u:0:32}
  id "$u" >/dev/null 2>&1 && return 1
  [ -d "$ws" ] && [ ! -L "$ws" ] || return 1
  [ "$(stat -c %u "$ws" 2>/dev/null)" = "$(id -u "$OWNER" 2>/dev/null)" ]
}
handover_record(){
  local n=$1 ws="$HOMEC/workspaces/$1"
  mkdir -p "$HAND" && chmod 700 "$HAND"
  printf 'agent=%s\nat=%s\nowner=%s\nmode=%s\n' "$n" "$(date +%s)" "$(stat -c %u:%g "$ws")" "$(stat -c %a "$ws")" > "$HAND/$n.prev"
  getfacl -p "$ws" > "$HAND/$n.acl" 2>/dev/null
}
# only the old engine screen of this agent (display and Chrome run by the owner): its display on the profile's own socket,
# its Chrome on the engine screen's profile. Nothing else of the owner's, and never the agent's gateway.
legacy_screen_stop(){
  local n=$1 ws="$HOMEC/workspaces/$1" sig p
  local pats=("^Xvnc :[0-9]+ .*-rfbunixpath $HOMEC/.hermes/profiles/$n/bot-desktop/" "--user-data-dir=$ws/\\.screen/browser-profile( |\$)")
  for sig in TERM KILL; do
    for p in "${pats[@]}"; do pkill -"$sig" -u "$OWNER" -f -- "$p" 2>/dev/null; done
    sleep 1
  done
  for p in "${pats[@]}"; do pgrep -u "$OWNER" -f -- "$p" >/dev/null 2>&1 && return 1; done
  return 0
}
# the sign-ins: the engine screen's profile becomes the own user's .browser (the one it had is kept beside it), once, as the
# agent's user; the engine screen's profile stays where it is for the way back
adopt_profile(){
  local n=$1 u=$2 ws="$HOMEC/workspaces/$1"
  as_user "$u" sh -c 'ws=$1; src=$ws/.screen/browser-profile
    [ -d "$src/Default" ] || exit 0
    if [ -e "$ws/.browser/.aq-adopted" ]; then rm -rf -- "$ws/.browser"
    elif [ -e "$ws/.browser" ]; then b=$ws/.browser.before-own-user; [ ! -e "$b" ] || b=$b.$$; mv -- "$ws/.browser" "$b" || exit 1; fi
    cp -a -- "$src" "$ws/.browser" || { rm -rf -- "$ws/.browser"; exit 1; }
    rm -f -- "$ws/.browser/SingletonLock" "$ws/.browser/SingletonSocket" "$ws/.browser/SingletonCookie"
    : > "$ws/.browser/.aq-adopted"' sh "$ws" </dev/null
}
# the user runs a command, aqeelOS's key gets in over SSH (what its terminal and the nightly backup use), and its Chrome starts
handover_check(){
  local n=$1 u=$2 ws="$HOMEC/workspaces/$1" key="$HOMEC/.hermes/agent-ssh/id_ed25519" got
  [ "$(as_user "$u" id -un </dev/null 2>/dev/null)" = "$u" ] || { echo "a command as $u does not run"; return 1; }
  if [ "${AQ_NOSSH:-0}" != 1 ]; then
    got=$(as_user "$OWNER" ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$u@127.0.0.1" id -un </dev/null 2>/dev/null)
    [ "$got" = "$u" ] || { echo "SSH as $u from aqeelOS is refused"; return 1; }
  fi
  # Chrome starts: headless on a debugging port of its own, up when it writes DevToolsActivePort (up to 90 s: the box can be
  # busy), then ended. Not --dump-dom: this Chrome never exits after it (its background services keep it alive), so the
  # first check (12 Nov 2026, load average 15) ran into its time limit and undid a move that was fine.
  if [ -x "$CHROME" ]; then
    as_user "$u" sh -c 'cd "$1"; export HOME="$1"; d=$(mktemp -d "$1/.aq-chk.XXXXXX") || exit 1
      "$2" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --user-data-dir="$d" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 about:blank >/dev/null 2>&1 </dev/null &
      p=$!; rc=1; for i in $(seq 180); do [ -s "$d/DevToolsActivePort" ] && { rc=0; break; }; kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
      kill "$p" 2>/dev/null; sleep 1; pkill -KILL -f -- "--user-data-dir=$d" 2>/dev/null; rm -rf -- "$d"; exit $rc' sh "$ws" "$CHROME" </dev/null \
      || { echo "Chrome does not start as $u"; return 1; }
  fi
  return 0
}
# the way back, from what the record says: the user, its key and its rules go, the folder goes back to its owner and its
# access list loses the user's entries (the rest is left as it was)
ws_back(){
  local n=$1 u=$2 ws="$HOMEC/workspaces/$1" uid own
  uid=$(id -u "$u" 2>/dev/null); own=$(sed -n 's/^owner=//p' "$HAND/$n.prev" 2>/dev/null | head -1)
  [[ "$own" =~ ^[0-9]+:[0-9]+$ ]] || own="$(id -u "$OWNER"):$(id -g "$OWNER")"
  hand_tree "$own" "$ws" "$u" "" "$uid" || return 1
  [ -n "$uid" ] && setfacl -x "u:$uid" "$HOMEC" 2>/dev/null
  chown -h "$own" "$ws"
  return 0
}
handover_undo(){
  local n=$1 u=$2 line cdp
  pkill -KILL -u "$u" 2>/dev/null; sleep 1
  line=$(port_line "$n"); cdp=$(echo "$line" | cut -d' ' -f3)
  [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
  [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$((cdp+10000))" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null
  rm -f -- "$KEYS/$u"
  ws_back "$n" "$u" || return 1
  userdel "$u" 2>/dev/null; groupdel "$u" 2>/dev/null
  return 0
}
# the whole move for one agent; prints the user's name when it worked (what make_user prints), nothing when it did not
handover(){
  local n=$1 u why="" r
  ok_name "$n" || return 1
  u="ag-$n"; u=${u:0:32}
  handover_record "$n" || { report "$n" "own-user" "could not record how its folder was, so it was not moved to its own user. Nothing changed." "Own user not made"; return 1; }
  if ! legacy_screen_stop "$n"; then
    report "$n" "own-user" "its old screen would not stop, so it was not moved to its own user yet. Nothing changed; it is tried again at the next start of the box script." "Own user not made"; return 1
  fi
  r=$(make_user "$n") && [ -n "$r" ] || { handover_undo "$n" "$u"; report "$n" "own-user" "its user could not be made, so it stays as it was." "Own user not made"; return 1; }
  if adopt_profile "$n" "$u"; then
    [ -x "$CHROME" ] && { screen_up "$n" "$u" >/dev/null 2>&1; }
    why=$(handover_check "$n" "$u") && { echo "agent users: $n moved to its own user $u" >&2; echo "$r"; return 0; }
  else
    why="its browser sign-ins could not be carried over"
  fi
  if handover_undo "$n" "$u"; then
    : > "$HAND/$n.failed"
    report "$n" "own-user" "moving it to its own user failed ($why), so everything was put back: its folder is the main user's again and it runs as before. Not tried again until $HAND/$n.failed is removed." "Own user not made"
  else
    : > "$HAND/$n.failed"
    report "$n" "own-user" "moving it to its own user failed ($why) and going back stopped part way: look at its folder's owner and the user $u." "Own user: move stuck"
  fi
  return 1
}

# a display and a Chrome port that stay the same for each agent (kept in $PORTS)
port_of(){
  local n=$1 line
  ok_name "$n" || return 1
  line=$(grep "^$n " "$PORTS" 2>/dev/null | head -1)
  if [ -z "$line" ]; then local i=0; while grep -q " $((40+i)) " "$PORTS" 2>/dev/null; do i=$((i+1)); done; line="$n $((40+i)) $((9600+i))"; echo "$line" | own_add "$PORTS"; fi
  # the two numbers go into network rules, sums and the screen's command line: plain numbers or nothing
  [[ "$line" =~ ^[a-z0-9_-]+\ [0-9]{1,5}\ [0-9]{1,5}$ ]] || return 1
  echo "$line"
}
# the same line when the agent has one (none is made)
port_line(){ local l; l=$(grep "^$1 " "$PORTS" 2>/dev/null | head -1); [[ "$l" =~ ^[a-z0-9_-]+\ [0-9]{1,5}\ [0-9]{1,5}$ ]] && echo "$l"; }

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
  local n=$1 key=$2 msg title=${4:-} t=""
  msg=$(js "$3"); [ -n "$title" ] && t=",\"title\":\"$(js "$title")\""
  printf '{"at":%s,"agent":"%s","key":"%s","what":"%s"%s}\n' "$(date +%s)" "$(js "$n")" "$(js "$key")" "$msg" "$t" | own_add "$ISSUES"
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
  local n again=0
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    # a move to an own user that was undone is allowed again (and tried at once, below)
    [ -f "$HAND/$n.failed" ] && { rm -f -- "$HAND/$n.failed"; again=1; }
    rm -f -- "$RST/$n" "$RST/$n.stopped" "$RST/$n.wakefails" "$RST/$n.chrome-reported"
    ag_rm "ag-$n" "$HOMEC/workspaces/$n/.screen/chrome.stopped" "$HOMEC/workspaces/$n/.screen/lean.failed" "$HOMEC/workspaces/$n/.screen/nosleep"
    echo "agent users: $n: screen may start again"
  done < "$RESET"
  own_clear "$RESET"
  [ "$again" = 1 ] && once
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
  # the numbers are used in sums: anything that is not a plain number counts as 0 (off)
  local l a b; l=$(grep "^$1 " "$LIMITS" 2>/dev/null | head -1)
  read -r _ a b _ <<< "$l"
  [[ "$a" =~ ^[0-9]{1,7}$ ]] || a=0; [[ "$b" =~ ^[0-9]{1,5}$ ]] || b=0
  echo "$((10#$a)) $((10#$b))"
}
# the port Chrome itself listens on: always 10000 above the agent's own port, behind the wake proxy, which listens on the
# agent's own port for EVERY agent whatever its sleep setting (13 Nov 2026: sleep 0 used to take an agent out of the proxy while
# its running Chrome kept the inner port, so 127.0.0.1:<port> stopped answering until Chrome restarted). Sleep 0 only means
# the screen is never put to sleep. The second argument (sleep minutes) is kept so callers need not change; it no longer matters.
chrome_port(){ local cdp=$1; echo $((cdp+10000)); }

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
  local note; note=$(js "${6:-}")
  mkdir -p "$(dirname "$SCREEN_EVENTS")" 2>/dev/null
  # the log lives in the wake proxy's folder: written as the proxy's user, never as root
  printf '{"at":%s,"agent":"%s","event":"%s","ms":%s,"ok":%s,"mode":"%s","note":"%s"}\n' "$(date +%s)" "$(js "$1")" "$(js "$2")" "${3:-0}" "${4:-true}" "$(js "${5:-}")" "$note" | as_user "$WAKE_USER" sh -c 'cat >> "$1"' sh "$SCREEN_EVENTS" 2>/dev/null
  return 0
}
# the window manager's files for a lean screen: no toolbar, no menu, no keys, no borders, every window maximised
# Runs as the agent's user (screen_up passes it with declare -f), never as root. A folder root left there before 12 Nov
# that the agent may not write is moved aside first.
lean_wm_files(){
  local sd=$1 d=$1/fluxbox x
  for x in "$d" "$sd/fb"; do [ -d "$x" ] && [ ! -w "$x" ] && mv -- "$x" "$x.old.$$"; done
  mkdir -p "$d" "$sd/fb" "$d/bin" || return 1
  rm -f -- "$d/init" "$d/style" "$d/keys" "$d/menu" "$d/apps" "$d/bin/fbsetbg"
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
  ok_name "$n" || return 1
  disp=$(port_line "$n" | cut -d' ' -f2); t0=$(now_ms)
  ag_mark "$u" "$sd/asleep"
  chrome_graceful "$u" "$ws"
  screen_kill "$u" "$disp" "$ws" >/dev/null
  rm -f -- "$RST/$n"; ag_rm "$u" "$sd/waking"
  screen_event "$n" sleep $(( $(now_ms) - t0 )) true "$(screen_mode "$u" "$sd")" "$why"
  echo "screen for $n: asleep ($why)"
}
# Is the screen of agent $1 up with Chrome answering? (rfb socket, Chrome listening on its port, window manager running)
screen_ready(){
  local n=$1 u=$2 cport=$3 mode=${4:-} sd="$HOMEC/workspaces/$1/.screen"
  [ -S "$sd/rfb.sock" ] || return 1
  ss -Hltn "sport = :$cport" 2>/dev/null | grep -q . || return 1
  case "${mode:-$(screen_mode "$u" "$sd")}" in lean-fluxbox) pgrep -u "$u" -x fluxbox >/dev/null 2>&1 ;; *) return 0 ;; esac
}
# Runs in the background after a screen is started: waits up to 60 s for it to be ready and writes the result to the log
# with the time since $3 (ms: when the wake was asked). A lean start that does not come up is replaced once by the old desktop
# (lean.failed). A wake that does not come up is tried once more; the second in a row keeps the agent's screen always on and
# files one issue (report). $4 = wake (counts) or start (box start: only the lean fallback applies).
wake_verify(){
  local n=$1 u=$2 t0=$3 kind=${4:-wake} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp cport sl i ok=0 ms mode fails step
  ok_name "$n" || return 1
  line=$(port_of "$n") || return 1; disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  read -r _ sl <<< "$(limit_of "$n")"; cport=$(chrome_port "$cdp" "$sl")
  # what was started (screen_up wrote it before this began): read once, not on each of the 120 looks
  mode=$(screen_mode "$u" "$sd")
  for i in $(seq "${AQ_WAKE_TRIES:-120}"); do screen_ready "$n" "$u" "$cport" "$mode" && { ok=1; break; }; sleep "${AQ_WAKE_TICK:-0.5}"; done
  ms=$(( $(now_ms) - t0 )); mode=$(screen_mode "$u" "$sd")
  if [ "$ok" = 1 ]; then
    ag_rm "$u" "$sd/waking"; rm -f -- "$RST/$n.wakefails"
    screen_event "$n" "$kind" "$ms" true "$mode"; echo "screen for $n: $kind took $ms ms ($mode)"; return 0
  fi
  if [ "${mode#lean}" != "$mode" ] && [ ! -f "$sd/lean.failed" ]; then
    ag_mark "$u" "$sd/lean.failed"
    screen_event "$n" fallback "$ms" false "$mode" "the lean screen did not come up in 60 s: starting the old desktop"
    echo "screen for $n: the lean screen did not come up: starting the old desktop"
    rm -f -- "$RST/$n"; screen_kill "$u" "$disp" "$ws"; [ -f "$sd/waking" ] || ag_put "$u" "$sd/waking" "$t0"
    AQ_NOVERIFY=1 screen_up "$n" "$u"; wake_verify "$n" "$u" "$t0" "$kind"; return $?
  fi
  ag_rm "$u" "$sd/waking"
  screen_event "$n" "$kind" "$ms" false "$mode" "Chrome did not answer within 60 s"
  echo "screen for $n: $kind failed after $ms ms ($mode)"
  [ "$kind" = wake ] || return 1
  fails=$(cat "$RST/$n.wakefails" 2>/dev/null || echo 0); step=$(wake_step 0 "$fails")
  mkdir -p "$RST"; echo $((fails+1)) > "$RST/$n.wakefails"
  if [ "$step" = retry ]; then
    rm -f -- "$RST/$n"; screen_kill "$u" "$disp" "$ws"; t0=$(now_ms); ag_put "$u" "$sd/waking" "$t0"
    AQ_NOVERIFY=1 screen_up "$n" "$u"; wake_verify "$n" "$u" "$t0" wake; return $?
  fi
  ag_mark "$u" "$sd/nosleep"; screen_event "$n" keep-awake 0 true "$mode" "two wakes in a row failed: this screen stays on"
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
# $WAKE belongs to the proxy's user (and aqeelOS's group): what this script puts there is written as that user, so a link
# placed there by the proxy or by aqeelOS is never followed by root
WAKE_USER=aq-wake
wake_put(){ as_user "$WAKE_USER" sh -c 'umask 027; cat > "$1.tmp" && mv -f -- "$1.tmp" "$1"' sh "$1"; }
wake_touch(){ as_user "$WAKE_USER" touch -- "$1" 2>/dev/null </dev/null || as_user "$OWNER" touch -- "$1" 2>/dev/null </dev/null; }
setup_wake(){
  id aq-wake >/dev/null 2>&1 || useradd -r -M -d /nonexistent -s /usr/sbin/nologin aq-wake || return 1
  mkdir -p "$WAKE" "$(dirname "$PROXY")"; [ -L "$WAKE" ] && return 1; chown -h aq-wake:"$OWNER" "$WAKE"; chmod 2770 "$WAKE"
  # the two logs root wrote there before 12 Nov become the proxy user's (a copy under a new name, made as that user)
  local f; for f in "$SCREEN_EVENTS" "$WAKE/proxy.log"; do
    [ "${f%/*}" = "$WAKE" ] && [ -f "$f" ] && [ "$(stat -c %U "$f" 2>/dev/null)" != "$WAKE_USER" ] && as_user "$WAKE_USER" sh -c 'cp -- "$1" "$1.new" && mv -f -- "$1.new" "$1"' sh "$f" 2>/dev/null </dev/null
  done
  if [ -f "$PROXY_SRC" ] && ! cmp -s "$PROXY_SRC" "$PROXY"; then install -m 644 -o root -g root "$PROXY_SRC" "$PROXY"; pkill -TERM -u aq-wake 2>/dev/null; fi
  return 0
}
# the proxy runs while any agent's screen may sleep; started again with the same back-off as a screen (OPS-3)
proxy_up(){
  [ -s "$WAKE/ports" ] || { pkill -TERM -u aq-wake 2>/dev/null; return 0; }
  [ -f "$PROXY" ] || return 0
  pgrep -u aq-wake -f "wake-proxy\\.mjs" >/dev/null 2>&1 && return 0
  restart_gate wake-proxy || return 0
  # its log is opened by the proxy's own user, not by root
  setsid runuser -u "$WAKE_USER" -- sh -c 'if ( : >>"$2/proxy.log" ) 2>/dev/null; then exec node "$1" "$2" >>"$2/proxy.log" 2>&1; else exec node "$1" "$2"; fi' sh "$PROXY" "$WAKE" < /dev/null > /dev/null 2>&1 &
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
    [ -f "$sd/asleep" ] && asl=1; [ -f "$sd/nosleep" ] && nos=1
    [ "$asl" = 0 ] && [ "${sl:-0}" -gt 0 ] && launcher_alive "$u" "$sd" && run=1
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
    wake_touch "$WAKE/$n.active"; sd="$HOMEC/workspaces/$n/.screen"
    if [ -f "$sd/asleep" ]; then
      # the wake's clock starts when it was asked (the proxy or the viewer wrote the file), so it counts what the person waits
      t0=$((req*1000)); [ $(( $(now_ms) - t0 )) -lt 120000 ] || t0=$(now_ms)
      ag_put "ag-$n" "$sd/waking" "$t0"; ag_rm "ag-$n" "$sd/asleep"; echo "screen for $n: woken"
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
    [ "$sl" -gt 0 ] && ag_mark "$u" "$HOMEC/workspaces/$n/.screen/asleep"
    echo "agent users: $n: stopped everything it ran"
  done < "$REQ.stop"
  own_clear "$REQ.stop"
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
  own_clear "$REQ.mem"
}

# screen_up <agent> <user> [desktop <why>]: with "desktop", only the desktop of a running screen starts again (OPS-13)
screen_up(){
  local n=$1 u=${2} part=${3:-all} why=${4:-} ws="$HOMEC/workspaces/$1" sd="$HOMEC/workspaces/$1/.screen" line disp cdp cport cap sl
  ok_name "$n" || return 0
  line=$(port_of "$n") || return 0; disp=$(echo "$line" | cut -d' ' -f2); cdp=$(echo "$line" | cut -d' ' -f3)
  read -r cap sl <<< "$(limit_of "$n")"; cport=$(chrome_port "$cdp" "$sl")
  # only aqeelOS (claude) and the agent's own user may reach its Chrome's control port; behind the proxy, the proxy's
  # user may reach the inner one too: rules in AQ-DEVTOOLS (devtools_fw, from the port line), applied before Chrome starts below
  # the profile's bot-desktop folder is the agent's own .screen folder (where aqeelOS looks for any agent's screen)
  local prof="$HOMEC/.hermes/profiles/$n"
  # (the profile is the owner's: the link is made as the owner, not as root)
  if [ -d "$prof" ] && [ ! -L "$prof/bot-desktop" ]; then as_user "$OWNER" sh -c 'rm -rf -- "$1/bot-desktop.engine"; [ -e "$1/bot-desktop" ] && mv -- "$1/bot-desktop" "$1/bot-desktop.engine"; ln -s -- "$2" "$1/bot-desktop"' sh "$prof" "$sd" </dev/null; fi
  # asleep (OPS-4): started by take_wakes when used
  [ -f "$sd/asleep" ] && return 0
  local running=0 mode want haswm=0 failed=0 wk_age=-1 t0
  [ -S "$sd/rfb.sock" ] && launcher_alive "$u" "$sd" && running=1
  # OPS-19: a screen that is not running and may sleep stays asleep until used (the wake proxy, the viewer or a schedule's
  # check asks for it), so a box start or a screen that was never used costs nothing
  if [ "$running" = 0 ] && [ "$part" = all ]; then
    [ -f "$sd/waking" ] && wk_age=$(( $(date +%s) - $(stat -c %Y "$sd/waking" 2>/dev/null || date +%s) ))
    if [ "$(ondemand_step "$sl" "$([ -f "$sd/nosleep" ] && echo 1 || echo 0)" "$wk_age")" = sleep ]; then
      ag_dir "$u" "$sd"; ag_mark "$u" "$sd/asleep"
      screen_event "$n" sleep 0 true "$(screen_mode "$u" "$sd" none)" "not running: left asleep until used"
      echo "screen for $n: left asleep until used"; return 0
    fi
  fi
  # lean or the old desktop: a running screen keeps what it runs (a change of the setting applies at its next sleep and wake)
  want=$(mode_of "$n"); command -v fluxbox >/dev/null 2>&1 && haswm=1; [ -f "$sd/lean.failed" ] && failed=1
  if [ "$running" = 1 ]; then mode=$(screen_mode "$u" "$sd" desktop); else mode=$(screen_pick "$want" "$haswm" "$failed"); fi
  # the one window-manager launch (the whole screen and that part alone both use it); its log keeps why the last one ended
  local desk lean="" open="about:blank"
  case $mode in
    desktop) desk="( dbus-launch --exit-with-session bash -c 'xfwm4 & xfdesktop & xfce4-panel & wait' >>'$sd/desktop.log' 2>&1 & )" ;;
    lean-fluxbox) as_user "$u" bash -c "$(declare -f lean_wm_files); lean_wm_files \"\$1\"" bash "$sd" </dev/null
      desk="( HOME='$sd/fb' PATH='$sd/fluxbox/bin':$PATH fluxbox -rc '$sd/fluxbox/init' -no-slit -no-toolbar >>'$sd/desktop.log' 2>&1 & )" ;;
    *) desk=":" ;;
  esac
  [ "${mode#lean}" != "$mode" ] && lean="$CHROME_LEAN --window-position=0,0"
  # OPS-13: window manager, desktop background or panel gone while the display runs: the desktop alone starts again,
  # through the same back-off as the screen (a display that is not running is the whole screen's start, below)
  if [ "$part" = desktop ]; then
    [ "$running" = 1 ] || return 0
    restart_gate "$n" || return 0
    desk_kill "$u"
    [ "$desk" = ":" ] || as_user "$u" bash -c "cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'; $desk" && echo "janitor: $n: ${why:-desktop missing}: its ${mode#lean-} window manager is started again on :$disp"
    return 0
  fi
  # already running with Chrome on the port it should use: done. On another port (sleeping was switched on or off for
  # this agent, or the screen dates from before 11 Nov) it is started again once, which is not a failure.
  if [ "$running" = 1 ]; then
    local lay; lay=$(ag_read "$u" "$sd/layout"); [ "${lay:-$cdp}" = "$cport" ] && return 0
    echo "screen for $n: Chrome moves to port $cport"; rm -f -- "$RST/$n"
  fi
  # waiting before trying again, or given up on after 5 failures (OPS-3): not started now
  restart_gate "$n" || return 0
  screen_kill "$u" "$disp" "$ws"
  # its Chrome's two ports are this agent's (and the box user's) before Chrome listens on them
  [ "$EUID" = 0 ] && devtools_fw >/dev/null
  ag_dir "$u" "$sd"
  # the display's lock and socket: names in /tmp and in /tmp/.X11-unix, both root's and sticky (x11_dir), so nobody can swap
  # the folder under this, and rm removes a name, never a link's target
  rm -f -- "/tmp/.X$disp-lock" "/tmp/.X11-unix/X$disp"
  # a lock left by the Chrome of an earlier box (the box was rebuilt, so another host name) makes Chrome refuse to start
  ag_rm "$u" "$sd/rfb.sock" "$ws/.browser/SingletonLock" "$ws/.browser/SingletonSocket" "$ws/.browser/SingletonCookie"
  # a screen that sleeps, and every lean screen, gets its tabs back when Chrome starts (also after it was closed by hand)
  { [ "$cport" != "$cdp" ] || [ -n "$lean" ]; } && open="--restore-last-session"
  as_user "$u" bash -c "
    cd '$ws'; export HOME='$ws' DISPLAY=:$disp XAUTHORITY='$sd/Xauthority'
    umask 007; : > \"\$XAUTHORITY\"; xauth -q add :$disp . \$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') 2>/dev/null
    printf 'DISPLAY=:%s\nXAUTHORITY=%s\n' '$disp' \"\$XAUTHORITY\" > '$sd/env'
    ( Xvnc :$disp -geometry 1280x800 -depth 24 -auth \"\$XAUTHORITY\" -SecurityTypes None -rfbport -1 -localhost -rfbunixpath '$sd/rfb.sock' -rfbunixmode 0660 -nolisten tcp -AlwaysShared >'$sd/xvnc.log' 2>&1 & echo \$! > '$sd/launcher.pid'; wait ) &
    for i in \$(seq 40); do [ -S '$sd/rfb.sock' ] && break; sleep 0.25; done
    $desk
    rm -f '$sd/chrome.stopped'
    $(declare -f chrome_exit_step chrome_loop)
    ( chrome_loop '$sd' '$CHROME' --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir='$ws/.browser' --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cport --window-size=1280,800 --start-maximized $CHROME_MEM $lean $open & )
    echo $cport > '$sd/layout'
    touch '$sd/activity'
  " </dev/null || return 0
  ag_put "$u" "$sd/mode" "$mode"
  echo "screen for $n on :$disp (chrome $cport, $mode)"
  # how long it took, whether it came up, and the fall back to the old desktop when a lean start does not (OPS-19)
  if [ "${AQ_NOVERIFY:-0}" != 1 ]; then
    t0=$(ag_read "$u" "$sd/waking"); [[ "$t0" =~ ^[0-9]{13}$ ]] || t0=$(now_ms)
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
    handover_failed "$n" && continue
    if handover_needed "$n"; then r=$(handover "$n") && [ -n "$r" ] && out="$out$r"$'\n'; continue; fi
    r=$(make_user "$n") && out="$out$r"$'\n'
  done < "$REQ"
  printf '%s' "$out" | own_put "$DONE"
  echo "agent users: $(printf '%s' "$out" | tr '\n' ' ')"
  remove_gone
  uploads_fix
  screens
}

# an agent that no longer exists: its screen and Chrome stop, its user and SSH key go, its control port rule goes, and
# its folder stays (handed to aqeelOS's claude user)
remove_gone(){
  local u n line cdp uid l
  for u in $(getent passwd | cut -d: -f1 | grep '^ag-'); do
    n=${u#ag-}; ok_name "$n" || continue
    grep -qxF -- "$n" "$REQ" 2>/dev/null && continue
    uid=$(id -u "$u" 2>/dev/null)
    pkill -KILL -u "$u" 2>/dev/null; sleep 1
    line=$(port_line "$n"); cdp=$(echo "$line" | cut -d' ' -f3)
    [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$cdp" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -j REJECT 2>/dev/null
    [ -n "$cdp" ] && iptables -D OUTPUT -o lo -p tcp --dport "$((cdp+10000))" -m owner ! --uid-owner "$OWNER" -m owner ! --uid-owner "$u" -m owner ! --uid-owner aq-wake -j REJECT 2>/dev/null
    rm -f -- "$KEYS/$u"
    userdel "$u" 2>/dev/null; groupdel "$u" 2>/dev/null
    # its folder goes back to the owner: after its last process is gone (hand_tree checks by user number), links untouched
    [ -n "$uid" ] && hand_tree "$OWNER:$OWNER" "$HOMEC/workspaces/$n" "$uid"
    echo "agent users: removed $u"
  done
  # display and port lines of agents that are gone (theirs above, and those whose users went with an earlier box)
  if [ -f "$PORTS" ]; then local keep; keep=$(while read -r l; do n=${l%% *}; grep -qxF -- "$n" "$REQ" && echo "$l"; done < "$PORTS"); printf "%s\n" "$keep" | sed "/^$/d" | own_put "$PORTS"; fi
}

# every isolated agent's screen stays up (started again if it stopped)
screens(){
  [ -x "$CHROME" ] || return 0
  local n
  while read -r n; do [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue; id "ag-$n" >/dev/null 2>&1 && screen_up "$n" "ag-$n"; done < "$REQ"
  wake_ports
}
# every agent with a screen, for the wake proxy: "<agent> <its port> <Chrome's port>" (the sleep setting does not matter)
wake_ports(){
  [ -d "$WAKE" ] || return 0
  local n l out=""
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] && id "ag-$n" >/dev/null 2>&1 || continue
    l=$(port_line "$n"); [ -n "$l" ] || continue
    out="$out$n $(echo "$l" | cut -d' ' -f3) $(( $(echo "$l" | cut -d' ' -f3) + 10000 ))"$'
'
  done < "$REQ"
  [ "$out" = "$(cat "$WAKE/ports" 2>/dev/null)"$'
' ] || [ "$out" = "$(cat "$WAKE/ports" 2>/dev/null)" ] && return 0
  printf '%s' "$out" | wake_put "$WAKE/ports"
}

# OPS-5 (OPERATIONS.md rule 4). Expected equals running: for each agent with a screen, exactly one display on its own
# number, one window manager, desktop and panel, and one Chrome (main process) on its own profile. Anything more, or a
# display on a number that is not the agent's, is extra: reported at once, removed when it is still there a minute later
# (the copy running longest is kept). A Chrome that gave up (chrome.stopped) files one issue. The counts go to $JAN.
# One agent's counts, "<name> <expected> <running> <extra pids...>", from "pid user etimes args" lines on stdin.
jan_count(){
  local n=$1 u=$2 disp=$3 ws=$4 exp=5 mode=${5:-}
  # OPS-19: a lean screen has an X server, one window manager (fluxbox) and Chrome, or no window manager at all
  case "${mode:-$(screen_mode "$u" "$ws/.screen")}" in lean-fluxbox) exp=3 ;; lean-bare) exp=2 ;; esac
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
  local n=$1 u=$2 disp=$3 ws=$4 now=${5:-$(date +%s)} f="$RST/$1.part" miss since=0 busy=0 step mode=${6:-}
  miss=$(jan_missing "$u" "$disp" "${mode:-$(screen_mode "$u" "$ws/.screen")}")
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
  local pid=$1 env who
  # the shell prints the redirect's own error (Permission denied: root has no ptrace right on another user's process) before a
  # trailing 2>/dev/null applies, so the read runs inside a group whose stderr is closed
  env=$({ tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null) || env=""
  [ -n "$env" ] || { who=$(pid_user "$pid"); [ -n "$who" ] && env=$(as_user "$who" cat "/proc/$pid/environ" 2>/dev/null </dev/null | tr '\0' '\n'); }
  printf '%s\n' "$env" | sed -n 's#^BU_CDP_\(WS\|URL\)=[a-z]*://[^/]*:\([0-9][0-9]*\).*#\2#p' | head -1
}
harness_sweep(){
  local listen lines="" pid pp et port
  listen=$(ss -Hltn 2>/dev/null | awk '{n=split($4,a,":"); printf "%s ", a[n]}')
  while read -r pid pp et; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    port=$(harness_port "$pid"); lines="$lines$pid $pp $et ${port:--}"$'\n'
  done < <(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null | awk '$4 ~ /python/ && index($0, "-m browser_harness.daemon") {print $1, $2, $3}')
  for pid in $(printf '%s' "$lines" | harness_orphans "$listen"); do
    echo "janitor: stopped a leftover browser helper $pid ($(ps -o user=,etime= -p "$pid" 2>/dev/null | xargs))"; kill -TERM "$pid" 2>/dev/null
  done
}
janitor(){
  harness_sweep
  local ps n u line disp ws out="" tot_e=0 tot_r=0 res e r x pid prev mode
  ps=$(ps -eo pid=,user:32=,etimes=,args= 2>/dev/null)
  mkdir -p "$(dirname "$SEEN")"; touch "$SEEN"; prev=$(cat "$SEEN"); : > "$SEEN.tmp"
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    line=$(port_line "$n"); [ -n "$line" ] || continue
    disp=$(echo "$line" | cut -d' ' -f2); ws="$HOMEC/workspaces/$n"; mode=$(screen_mode "$u" "$ws/.screen")
    res=$(printf '%s\n' "$ps" | jan_count "$n" "$u" "$disp" "$ws" "$mode")
    read -r _ e r x <<< "$res"
    tot_e=$((tot_e+e)); tot_r=$((tot_r+r))
    printf '%s\n' "$ps" | desk_check "$n" "$u" "$disp" "$ws" "" "$mode"
    for pid in $x; do
      if printf '%s\n' "$prev" | grep -qx "$pid"; then echo "janitor: $n: removed extra process $pid ($(ps -o args= -p "$pid" 2>/dev/null | cut -c1-60))"; kill -TERM "$pid" 2>/dev/null
      else echo "$pid" >> "$SEEN.tmp"; echo "janitor: $n: extra process $pid, removed next minute if still there"; fi
    done
    # "reported" is this script's own note: kept with root's files, not in the agent's folder
    if [ -f "$ws/.screen/chrome.stopped" ] && [ ! -f "$RST/$n.chrome-reported" ]; then
      report "$n" "chrome-stopped" "its Chrome exited 5 times within an hour and is left stopped. See $ws/.screen/chrome.log; to try again: echo $n >> $RESET"
      mkdir -p "$RST"; : > "$RST/$n.chrome-reported"
    fi
    [ -f "$ws/.screen/chrome.stopped" ] || rm -f -- "$RST/$n.chrome-reported"
    local mb; mb=$(mem_cap "$n" "$u" "$ws")
    out="$out\"$n\":{\"expected\":$e,\"running\":$r,\"extra\":[$(echo $x | tr ' ' ',')],\"mb\":${mb:-0},\"asleep\":$([ -f "$ws/.screen/asleep" ] && echo true || echo false),\"mode\":\"$mode\",\"nosleep\":$([ -f "$ws/.screen/nosleep" ] && echo true || echo false)},"
  done < "$REQ"
  mv "$SEEN.tmp" "$SEEN"
  printf '{"at":%s,"expected":%s,"running":%s,"agents":{%s}}\n' "$(date +%s)" "$tot_e" "$tot_r" "${out%,}" | own_put "$JAN"
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
    # the logs are the agent's own files: trimmed as the agent
    for f in chrome xvnc desktop; do
      trim_bytes "ag-$n" "$HOMEC/workspaces/$n/.screen/$f.log" 10485760 2097152 && echo "agent users: $n: trimmed $f.log"
    done
  done < "$REQ"
  trim_lines "$WAKE_USER" "$SCREEN_EVENTS" 4000 2000
  trim_lines "$OWNER" "$ISSUES" 400 200
  return 0
}

# OPS-18 (12 Nov 2026). Uploads: ~/uploads holds the files the chat and the channels hand to agents. Each agent has its own
# user, which reaches the folder only through its access list, so every agent's user is named on it (and on files made later:
# default entries), and a file written private (mode 600: mkstemp) has an empty list mask that hid it from the agent (P&P,
# 10 Nov: two issues) and is made readable. The folder itself stays closed to every other user.
uploads_fix(){
  local d="$HOMEC/uploads" n u
  [ -d "$d" ] || return 0
  # the folder is the owner's: both steps run as the owner
  as_user "$OWNER" find "$d" -xdev -type f ! -perm -044 -exec chmod a+r {} + 2>/dev/null </dev/null
  [ -f "$REQ" ] || return 0
  while read -r n; do
    [[ "$n" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || continue
    u="ag-$n"; u=${u:0:32}; id "$u" >/dev/null 2>&1 || continue
    as_user "$OWNER" setfacl -m "u:$u:rX,d:u:$u:rX" "$d" 2>/dev/null </dev/null
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
    # H-15: a headless Chrome somebody started by hand for a look (profile under /tmp, an open debugging port) and left
    # running: pnp-box had one for 13 hours. Treated like a leftover app: stopped after 24 h without a client on its port.
    k=="" && a ~ /[/]chrome .*--headless/ && a ~ /--user-data-dir=[/]tmp[/]/ && a ~ /--remote-debugging-port[=]/ && a !~ /--type=/ {k="probe"}
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
      # only a restart loop of the same user: a process is never stopped because of what another user's child is called
      [ "$(pid_user "$pp")" = "$(pid_user "$pid")" ] || break
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
    [ -n "$cwd" ] || cwd=$(as_user "$user" readlink "/proc/$pid/cwd" 2>/dev/null </dev/null)
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
    ok_name "$agent" || agent=""
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

# The watcher installs a newer copy of this script from the app's folder (a deploy puts it there) and starts it.
# That folder belongs to the owner's user, so that user decides what root runs: it is root in all but name, by design
# (deploys need no root). Agents cannot write there. What is checked here: the copy is taken first into root's own folder
# and only that copy is looked at and installed; one that does not parse is never installed (L6), and aqeelOS is told once;
# and when root has made the list $PIN, only a copy whose sha256 is in it is installed (then a deploy that changes this
# script needs root to add the new sum: `sha256sum scripts/agent-users.sh | cut -d' ' -f1 >> $PIN`).
self_update(){
  [ -f "$SRC" ] && [ "$0" != "$SRC" ] && ! cmp -s "$SRC" "$0" || return 1
  local t sum why=""
  mkdir -p /var/lib/aqeelos && t=$(mktemp /var/lib/aqeelos/agent-users.XXXXXX) || return 1
  cat -- "$SRC" > "$t" 2>/dev/null; sum=$(sha256sum < "$t" | cut -d' ' -f1)
  if cmp -s "$t" "$0"; then rm -f -- "$t"; return 1; fi
  bash -n "$t" 2>/dev/null || why="does not parse (bash -n)"
  [ -z "$why" ] && [ -f "$PIN" ] && ! grep -qx -- "$sum" "$PIN" && why="is not in root's list $PIN"
  if [ -n "$why" ]; then
    rm -f -- "$t"; mkdir -p "$RST"
    [ "$(cat "$RST/.update-refused" 2>/dev/null)" = "$sum" ] || { echo "$sum" > "$RST/.update-refused"; report default "root-script-update" "the new copy of the root script ($SRC) $why, so the one running stays. Nothing else is affected." "Root script update refused"; }
    return 1
  fi
  install -m 755 -o root -g root "$t" "$0"; local rc=$?; rm -f -- "$t" "$RST/.update-refused"; return $rc
}

# sourced by the tests (scripts/agent-users.test.mjs): the functions only
[ "${AQ_AGENT_USERS_LIB:-0}" = 1 ] && return 0 2>/dev/null

case "${1:-watch}" in
  once) once ;;
  reset) ok_name "${2:-}" && echo "$2" | own_add "$RESET" && take_resets ;;
  janitor) janitor ;;
  stop) ok_name "${2:-}" && echo "$2" | own_add "$REQ.stop" && take_stops ;;
  watch) last=""; n=0; while true; do take_resets; take_stops; take_mem; take_wakes; proxy_up; if [ $((n % 12)) -eq 0 ]; then devtools_fw full; else devtools_fw; fi; [ $((n % 12)) -eq 0 ] && [ -f "$REQ" ] && { janitor; sleep_idle; setup_wake; local_fw; fixer_step; }; [ $((n % 720)) -eq 0 ] && [ -f "$REQ" ] && trim_logs; [ $((n % 60)) -eq 0 ] && [ -f "$REQ" ] && { uploads_fix; orphan_sweep; }; [ $((n % 6)) -eq 0 ] && { date +%s | own_put "$ALIVE"; }; self_update && exec "$0" watch; s=$(stat -c %Y "$REQ" 2>/dev/null || echo none); if [ "$s" != "$last" ]; then once; last=$s; fi; n=$((n+1)); [ $((n % 6)) -eq 0 ] && [ -f "$REQ" ] && screens; sleep 5; done ;;
esac
