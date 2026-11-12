#!/bin/bash
# The box check for the fixer's own user (CR-7 and AUD-6, 13 Nov 2026). Run on the box as the owner's user, after the root script made aq-fixer
# (it exists once the first fixer run, or the canary, asked for it: ~/.aqeelos-fixer-user.done lists aq-fixer):
#   bash ~/apps/hermes-ui/scripts/fixer-isolation-check.sh [<a fixer work dir>]
# It logs in as aq-fixer the way the engine does (SSH, the agents' key) and tries what EVERY fixer run (a code fix, a settings repair, a proof
# run) must NOT be able to do. One line per property, PASS or FAIL; every "must not" that works is a FAIL and the script exits 1. Changes
# nothing on the box (the few files it touches are probes in places aq-fixer must not be able to write, removed again if they appear).
set -u
H=${AQEELOS_HOME:-$HOME}; DATA=${UI_DATA_DIR:-$H/apps/hermes-ui-data}; KEY=$H/.hermes/agent-ssh/id_ed25519; PORT=${UI_PORT:-4400}
APP=${AQEELOS_APP:-$H/apps/hermes-ui}; FIX=$H/apps/aqeel-os-fixer; W=${1:-}
fail=0; pass=0
fx(){ ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes aq-fixer@127.0.0.1 "$@" 2>/dev/null </dev/null; }
no(){ local what=$1; shift; if fx "$@" >/dev/null 2>&1; then echo "FAIL  can $what"; fail=$((fail+1)); else echo "PASS  cannot $what"; pass=$((pass+1)); fi; }
yes_(){ local what=$1; shift; if fx "$@" >/dev/null 2>&1; then echo "PASS  can $what"; pass=$((pass+1)); else echo "FAIL  cannot $what"; fail=$((fail+1)); fi; }
# the first path of each list that exists is probed (a file that is not on this box proves nothing, so it is skipped and said)
first(){ local p; for p in "$@"; do [ -e "$p" ] && { echo "$p"; return; }; done; }
probe(){ local what=$1 path=$2; if [ -e "$path" ]; then no "$what" "head -c1 '$path' >/dev/null"; else echo "skip  $what (not on this box)"; fi; }
[ "$(fx id -un)" = aq-fixer ] || { echo "FAIL  no login as aq-fixer (is the user made? ~/.aqeelos-fixer-user.done)"; exit 1; }
echo "PASS  logs in as aq-fixer"; pass=$((pass+1))
echo "-- not the box user, no sudo, no way to become it"
[ "$(fx id -u)" != "$(id -u)" ] && { echo "PASS  its user id is not the box user's"; pass=$((pass+1)); } || { echo "FAIL  same user id as the box user"; fail=$((fail+1)); }
no "sudo anything"                              "sudo -n true"
no "find a sudo program"                        "command -v sudo >/dev/null && sudo -n -l"
no "become the box user (su)"                   "echo | su -c id $(id -un)"
no "log in as the box user over SSH"            "ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no $(id -un)@127.0.0.1 id"
no "write the sudoers files or cron"            "touch /etc/sudoers.d/aq-fixer-probe /etc/cron.d/aq-fixer-probe"
echo "-- no secret is readable (keys, sign-ins, the data folder)"
no "list the data folder"                       "ls $DATA"
for f in ui-secret backup-key local-owner.key fixer-github-token kirimdev-secrets.json accounts.json users.json team-policy.json cloud-fixer.json agent-trust.json; do probe "read data/$f" "$DATA/$f"; done
no "read the owner's .env"                      "head -c1 $H/.hermes/.env"
no "list the owner's .hermes"                   "ls $H/.hermes"
probe "read the engine's sign-ins (auth.json)"  "$H/.hermes/auth.json"
probe "read the agents' ssh key"                "$KEY"
no "list the owner's SSH folder"                "ls $H/.ssh"
no "list the Claude sign-ins"                   "ls $H/.claude-accounts $H/.claude"
for p in "$H"/.hermes/profiles/*/.env; do [ -e "$p" ] && { probe "read an agent's .env" "$p"; break; }; done
for p in "$H"/workspaces/*/.secrets; do [ -e "$p" ] && { no "list an agent's secrets folder" "ls $p"; break; }; done
for p in /home/*/.ssh /root; do [ -e "$p" ] && no "list $p" "ls $p"; done
no "read the app's own environment file"        "head -c1 $H/apps/hermes-ui.env"
op=$(pgrep -u "$(id -un)" -f 'node.*server.mjs' 2>/dev/null | head -1)
if [ -n "$op" ]; then no "read the running app's environment (/proc/$op/environ)" "head -c1 /proc/$op/environ"; else echo "skip  the app's /proc environment (the app is not running here)"; fi
echo "-- no other agent's folder, no write outside its own folder"
no "list the agents' folders"                   "ls $H/workspaces"
a=$(first "$H"/workspaces/default "$H"/workspaces/*)
[ -n "$a" ] && no "read an agent's folder ($(basename "$a"))" "ls '$a'" || echo "skip  an agent's folder (none on this box)"
no "read the live app folder"                   "ls $APP/app"
no "write in the live app folder"               "touch $APP/aq-fixer-probe"
no "write in the app's code (app/)"             "touch $APP/app/aq-fixer-probe"
no "write in the data folder"                   "touch $DATA/aq-fixer-probe"
no "write in the owner's home"                  "touch $H/aq-fixer-probe"
no "write in the engine's source"               "touch $H/.hermes/hermes-agent/aq-fixer-probe"
no "write in /etc or /usr"                      "touch /etc/aq-fixer-probe /usr/local/bin/aq-fixer-probe"
for p in "$APP/aq-fixer-probe" "$APP/app/aq-fixer-probe" "$DATA/aq-fixer-probe" "$H/aq-fixer-probe"; do [ -e "$p" ] && { rm -f "$p"; echo "note  removed a probe file the fixer should not have been able to make: $p"; }; done
echo "-- no network but the app"
no "reach the internet (443)"                   "curl -s -m 4 -o /dev/null https://api.github.com"
no "reach the engine's dashboard (9119)"        "curl -s -m 4 -o /dev/null http://127.0.0.1:9119/"
no "reach the test copy directly (4402)"        "curl -s -m 4 -o /dev/null http://127.0.0.1:4402/healthz"
yes_ "reach the app on 127.0.0.1:$PORT"         "curl -s -m 5 -f -o /dev/null http://127.0.0.1:$PORT/healthz"
echo "-- the app answers it only through signed routes"
code=$(fx "curl -s -m 5 -o /dev/null -w %{http_code} -X POST -H 'content-type: application/json' -d '{\"action\":\"soul_rule\",\"args\":{}}' http://127.0.0.1:$PORT/fixer-ops/i0/i0-1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/repair")
case "$code" in 403|410|404|405|400) echo "PASS  a repair with a made-up signature is refused (HTTP $code)"; pass=$((pass+1));; *) echo "FAIL  a repair with a made-up signature answered HTTP '${code:-none}'"; fail=$((fail+1));; esac
code=$(fx "curl -s -m 5 -o /dev/null -w %{http_code} http://127.0.0.1:$PORT/ui/health/issues")
case "$code" in 401|403) echo "PASS  the app's admin API needs a sign-in (HTTP $code)"; pass=$((pass+1));; *) echo "FAIL  the app's admin API answered HTTP '${code:-none}' without a sign-in"; fail=$((fail+1));; esac
if [ -n "$W" ] && [ -d "$W" ]; then
  echo "-- its own work folder"
  yes_ "read its checkout or scratch folder"    "ls $W >/dev/null"
  yes_ "write in it"                            "touch $W/.aq-fixer-probe && rm -f $W/.aq-fixer-probe"
  no "write in another work folder"             "for d in $FIX/*/; do [ \"\${d%/}\" != \"${W%/}\" ] && [ -d \"\$d\" ] && touch \"\$d/.p\" && exit 0; done; exit 1"
else echo "skip  its own work folder checks (give one as the argument: ls $FIX)"; fi
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
