#!/bin/bash
# C1 test rig for the root script (scripts/agent-users.sh): does anything it does follow a link an agent planted?
# Run as an ordinary user on Linux (scripts/root-script-links.test.mjs does): no root and no real agent users needed.
#
# How the users are stood in for. A throwaway tree holds a home (the owner's), one agent's folder in it, the wake proxy's
# folder, and "root's files" (OUT): a file with known content, a folder, a big log. Every place the root script touches in
# the agent's folder, in the home and in the proxy's folder gets a link into OUT. The script's as_user (how it runs a
# step as the agent, the owner or the proxy's user) goes through $AQ_AS here: OUT is made read-only for the length of that
# command, which is what another user's rights on root's files are, enforced by the kernel. Anything the script still does
# as "root" (directly) reaches OUT through the link and changes it. After every step OUT must be exactly as it was:
# same names, sizes, modes and content. chown cannot be tried without root, so a stand-in records every call: each must
# carry -h, none may be recursive, and outside hand_tree none may name anything inside the agent's folder.
# The rig first proves it can see a followed link (the old line, run on purpose, must be caught).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" != 0 ] || { echo "run this as an ordinary user, not root"; exit 2; }
T=$(mktemp -d "${TMPDIR:-/tmp}/aq-links.XXXXXX") || exit 2
trap 'chmod -R u+rwX "$T" 2>/dev/null; rm -rf "$T"' EXIT
OUT=$T/root-files; H=$T/home; WS=$H/workspaces/a1; SD=$WS/.screen; BIN=$T/bin; WK=$T/wake
mkdir -p "$H/workspaces" "$H/.hermes/profiles/a1" "$H/uploads" "$BIN" "$WK" "$T/rst"
mkout(){ rm -rf "$OUT"; mkdir -p "$OUT/dir"; echo ROOT > "$OUT/target"; echo ROOT > "$OUT/dir/inside"; head -c 11000000 /dev/zero > "$OUT/big.log"; chmod -R go-w "$OUT"; }
mkout
REAL_SLEEP=$(command -v sleep); REAL_PGREP=$(command -v pgrep)
fails=0; checks=0
snap(){ ( cd "$OUT" && find . -printf '%p %s %m %l\n' | sort; find . -type f -exec cksum {} + | sort ); }
BASE=$(snap)
ok(){ checks=$((checks+1)); }
bad(){ fails=$((fails+1)); echo "FAIL: $*"; }
same(){ if [ "$(snap)" = "$BASE" ]; then ok; else bad "$1: root's files changed"; diff <(echo "$BASE") <(snap) | head -8; mkout; fi; }

# another user's rights on root's files: none, for as long as the command and everything it started runs. Writing is
# stopped by the kernel (read-only); changing a mode is not (this test's user owns the stand-in files), so the command's
# chmod is one that refuses what the kernel would refuse: a file of root's
mkdir -p "$T/asbin"; REAL_CHMOD=$(command -v chmod)
cat > "$T/asbin/chmod" <<EOF
#!/bin/bash
for a in "\$@"; do case "\$(readlink -f -- "\$a" 2>/dev/null)" in "$OUT"|"$OUT"/*) echo "chmod: \$a: Operation not permitted" >&2; exit 1 ;; esac; done
exec $REAL_CHMOD "\$@"
EOF
chmod +x "$T/asbin/chmod"
cat > "$T/as" <<EOF
#!/bin/bash
echo "\$1" >> "$T/as.log"; shift
$REAL_CHMOD -R a-w "$OUT"; PATH="$T/asbin:\$PATH"
setsid -w bash -c 'echo \$\$ > "$T/as.sid.'\$\$'"; exec "\$@"' _ "\$@"; rc=\$?
sid=\$(cat "$T/as.sid.\$\$" 2>/dev/null); rm -f "$T/as.sid.\$\$"
for i in \$(seq 200); do [ -n "\$sid" ] && $REAL_PGREP -s "\$sid" >/dev/null 2>&1 || break; $REAL_SLEEP 0.05; done
$REAL_CHMOD -R u+w "$OUT"; exit \$rc
EOF
chmod +x "$T/as"
# stand-ins on the PATH: chown records, the rest do nothing (no screen is really started)
cat > "$BIN/chown" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >> "$T/chown.log"
EOF
for c in pkill iptables ss xauth Xvnc fluxbox setfacl sleep useradd groupadd userdel groupdel usermod groupmod; do printf '#!/bin/sh\nexit 0\n' > "$BIN/$c"; done
printf '#!/bin/sh\nexit 1\n' > "$BIN/pgrep"
chmod +x "$BIN"/*

# every name the root script uses in an agent's .screen (and its browser folder), each a link into root's files
plant(){
  chmod -R u+rwX "$WS" 2>/dev/null; rm -rf "$WS"; mkdir -p "$SD" "$WS/.browser"
  local f
  for f in asleep waking nosleep lean.failed chrome.stopped chrome.reported activity env Xauthority rfb.sock; do ln -s "$OUT/new-$f" "$SD/$f"; done   # dangling: a touch would make the target
  for f in mode layout launcher.pid; do ln -s "$OUT/target" "$SD/$f"; done                                                                     # a write would replace root's file
  for f in chrome xvnc desktop; do ln -s "$OUT/big.log" "$SD/$f.log"; done                                                                       # a trim would cut root's file
  ln -s "$OUT/dir" "$SD/fluxbox"; ln -s "$OUT/dir" "$SD/fb"
  for f in SingletonLock SingletonSocket SingletonCookie; do ln -s "$OUT/target" "$WS/.browser/$f"; done
  : > "$T/chown.log"
}
# the whole .screen folder is a link to a folder of root's
plant_dir(){ chmod -R u+rwX "$WS" 2>/dev/null; rm -rf "$WS"; mkdir -p "$WS"; ln -s "$OUT/dir" "$SD"; : > "$T/chown.log"; }
# the files in the owner's home and in the proxy's folder, as links too
plant_home(){
  local f
  for f in .aqeelos-agent-issues.jsonl .aqeelos-janitor.json .aqeelos-agent-users.done .aqeelos-agent-users.alive .aqeelos-agent-users.reset .aqeelos-agent-users.stop .aqeelos-agent-users.mem; do rm -f "$H/$f"; ln -s "$OUT/target" "$H/$f"; done
  rm -f "$WK"/*; for f in events.jsonl ports proxy.log a1.active; do ln -s "$OUT/target" "$WK/$f"; done
  rm -rf "$H/.hermes/profiles/a1/bot-desktop"
}
printf 'a1\n' > "$H/.aqeelos-agent-users"; printf 'a1 40 9601\n' > "$H/.aqeelos-agent-ports"
printf 'a1 4096 15 lean\n' > "$H/.aqeelos-agent-limits"; printf 'a1 2001\n' > "$H/.aqeelos-agent-uids"

# run <label> <shell text>: the text runs with the root script's functions loaded, as the script would run it
run(){
  local label=$1; shift
  PATH="$BIN:$PATH" AQ_AGENT_USERS_LIB=1 AQEELOS_HOME="$H" AQ_RESTARTS="$T/rst" AQ_SEEN="$T/seen" AQ_WAKE="$WK" AQ_ORPHANS="$T/orph" AQ_AS="$T/as" AQ_NOVERIFY=1 AQ_WAKE_TRIES=2 AQ_WAKE_TICK=0 \
    bash -c "source '$HERE/agent-users.sh'; CHROME=/bin/true
      id(){ case \"\$*\" in '-u ag-a1') echo 2001 ;; -u*) command id \"\$@\" ;; *) return 0 ;; esac; }
      chrome_loop(){ :; }; getent(){ return 1; }; ps(){ :; }
      $*" >"$T/out.log" 2>&1 </dev/null
  same "$label"
}

# 0. the rig sees a followed link: the line as it was before the fix must be caught
plant; BASE0=$BASE
( touch "$SD/asleep" ) 2>/dev/null
if [ "$(snap)" != "$BASE" ]; then ok; rm -f "$OUT/new-asleep"; else bad "the rig did not see root's old touch through a link"; fi
[ "$(snap)" = "$BASE" ] || { echo "rig could not restore root's files"; exit 2; }

# 1. each step, with every name a link
for layout in plant plant_dir; do
  $layout; plant_home; run "$layout put_to_sleep" 'put_to_sleep a1 ag-a1 "test"'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout screen_up (left asleep until used)" 'rm -f "$HOMEC/workspaces/a1/.screen/asleep" 2>/dev/null; screen_up a1 ag-a1'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout screen_up (a wake: the screen starts)" 'ondemand_step(){ echo start; }; screen_up a1 ag-a1'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout screen_up (the old desktop)" 'ondemand_step(){ echo start; }; mode_of(){ echo desktop; }; screen_up a1 ag-a1'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout screen_up (desktop part only)" 'launcher_alive(){ return 0; }; screen_up a1 ag-a1 desktop "panel missing"'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout wake_verify (fails: fallback, retry, keep awake)" 'screen_up(){ :; }; screen_kill(){ :; }; wake_verify a1 ag-a1 $(now_ms) wake; wake_verify a1 ag-a1 $(now_ms) wake; wake_verify a1 ag-a1 $(now_ms) start'
  $layout; plant_home; rm -rf "$T/rst"; run "$layout wake_verify (comes up)" 'screen_ready(){ return 0; }; wake_verify a1 ag-a1 $(now_ms) wake'
  $layout; plant_home; rm -f "$WK/a1.wake"; : > "$WK/a1.wake"; run "$layout take_wakes" 'screen_up(){ :; }; take_wakes'
  $layout; plant_home; rm -f "$H/.aqeelos-agent-users.stop"; echo a1 > "$H/.aqeelos-agent-users.stop"; run "$layout take_stops" 'take_stops'
  $layout; plant_home; rm -f "$H/.aqeelos-agent-users.reset"; echo a1 > "$H/.aqeelos-agent-users.reset"; run "$layout take_resets" 'take_resets'
  $layout; plant_home; rm -f "$H/.aqeelos-agent-users.mem"; echo "a1 sleep" > "$H/.aqeelos-agent-users.mem"; run "$layout take_mem" 'in_reply(){ return 1; }; last_use(){ echo 0; }; take_mem'
  $layout; plant_home; run "$layout sleep_idle" 'sleep_step(){ echo sleep; }; sleep_idle'
  $layout; plant_home; run "$layout janitor" 'harness_sweep(){ :; }; mem_cap(){ echo 0; }; janitor'
  $layout; plant_home; run "$layout trim_logs" 'trim_logs'
  $layout; plant_home; run "$layout screens + wake_ports" 'CHROME=/bin/true; screens'
done

# 2. the files in the owner's home and the proxy's folder alone (a link there is the owner's or the proxy's doing)
plant; plant_home; run "report (issues file is a link)" 'report a1 k "text" "Title"'
plant; plant_home; run "screen_event (events file is a link)" 'screen_event a1 sleep 0 true lean-bare note'
plant; plant_home; run "once's lists" 'printf x | own_put "$DONE"; date +%s | own_put "$ALIVE"; echo "a9 2009" | own_add "$UIDS"; own_clear "$RESET"'
rm -f "$H/.aqeelos-agent-uids"; printf 'a1 2001\n' > "$H/.aqeelos-agent-uids"

# 3. the agent's folder itself: handed over only as links (chown -h), a link in the agent's place is refused
plant; mkdir -p "$WS/sub"; ln -s "$OUT/target" "$WS/sub/link"; ln -s "$OUT/dir" "$WS/dirlink"
run "ws_top + hand_tree" 'stat(){ if [ "$1" = -c ] && [ "$2" = %u ]; then echo 1; else command stat "$@"; fi; }; ws_top ag-a1 "$HOMEC/workspaces/a1"'
grep -q -- "-h -- ag-a1:" "$T/chown.log" && ok || bad "hand_tree did not hand the folder over with chown -h"
chmod -R u+rwX "$WS"; rm -rf "$WS"; ln -s "$OUT/dir" "$WS"; : > "$T/chown.log"
run "ws_top (the agent's folder is a link)" 'ws_top ag-a1 "$HOMEC/workspaces/a1"; echo "rc=$?"'
grep -q "rc=1" "$T/out.log" && ok || bad "ws_top did not refuse a link in the agent's place"
[ -s "$T/chown.log" ] && bad "ws_top ran chown on a link in the agent's place: $(cat "$T/chown.log")" || ok
rm -f "$WS"
# a link in the owner's home is skipped by lock_home (chmod follows links)
plant; ln -s "$OUT/dir" "$H/tools"; run "lock_home (a link in the home)" 'lock_home'; rm -f "$H/tools"

# 4. every chown the script ran above (all steps): -h always, never recursive
plant; plant_home; : > "$T/chown.all"
for step in 'put_to_sleep a1 ag-a1 t' 'ondemand_step(){ echo start; }; screen_up a1 ag-a1' 'screen_up a1 ag-a1' 'lock_home' 'setup_wake' 'report a1 k t' 'harness_sweep(){ :; }; mem_cap(){ echo 0; }; janitor'; do
  rm -rf "$T/rst"; : > "$T/chown.log"; run "chown log: $step" "id(){ case \"\$*\" in '-u ag-a1') echo 2001 ;; aq-wake) return 0 ;; -u*) command id \"\$@\" ;; *) return 0 ;; esac; }; $step"; cat "$T/chown.log" >> "$T/chown.all"
done
while read -r line; do
  [ -n "$line" ] || continue
  case " $line " in *" -h "*) ok ;; *) bad "chown without -h: $line" ;; esac
  case " $line " in *" -R "*|*" --recursive "*) bad "recursive chown: $line" ;; esac
  case "$line" in *"$WS/"*) bad "chown inside the agent's folder: $line" ;; esac
done < "$T/chown.all"

# 5. numbers and names from files others can write are checked before use
run "launcher_alive (not a number)" 'cd "$HOMEC"; mkdir -p x; for v in "1" "-1" "0" "x" "\$(touch pwned)" "a[\$(touch pwned)]"; do printf "%s\n" "$v" > x/launcher.pid; launcher_alive ag-a1 "$HOMEC/x" && echo "ALIVE:$v"; done; [ -e pwned ] && echo PWNED; true'
grep -Eq "ALIVE|PWNED" "$T/out.log" && bad "launcher_alive took a bad process number: $(cat "$T/out.log")" || ok
run "limit_of / port_of (not numbers)" 'cd "$HOMEC"; printf "a1 a[\$(id>pwned)] 15\n" > .aqeelos-agent-limits; printf "a1 40 x[\$(id>pwned)]\n" > .aqeelos-agent-ports; read -r cap sl <<< "$(limit_of a1)"; echo "cap=$cap sl=$sl"; port_of a1 && echo PORT-TAKEN; wake_ports; sleep_idle; screen_up a1 ag-a1; [ -e pwned ] && echo PWNED; true'
grep -q "cap=0 sl=15" "$T/out.log" && ! grep -Eq "PWNED|PORT-TAKEN" "$T/out.log" && ok || bad "a limit or port that is not a number was used: $(cat "$T/out.log")"
printf 'a1 40 9601\n' > "$H/.aqeelos-agent-ports"; printf 'a1 4096 15 lean\n' > "$H/.aqeelos-agent-limits"
run "report (a line break in a folder name)" 'rm -f "$ISSUES"; report default k "$(printf "one\n{\"agent\":\"x\",\"key\":\"forged\"}\\\\")" t; wc -l < "$ISSUES"'
[ "$(tail -1 "$T/out.log" | tr -d ' ')" = 1 ] && ok || bad "report wrote more than one line: $(cat "$T/out.log")"
for n in '../x' 'a b' 'A' '' 'a;b' "$(printf 'a\nb')"; do
  run "names ($n)" "ok_name '$n' && echo NAME-OK; make_user '$n' && echo MADE; port_of '$n' && echo PORT; true"
  grep -Eq "NAME-OK|MADE|PORT" "$T/out.log" && bad "the name '$n' was accepted" || ok
done

echo "root script links: $checks checks, $fails failed"
[ "$fails" = 0 ]
