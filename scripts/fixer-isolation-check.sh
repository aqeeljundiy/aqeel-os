#!/bin/bash
# The box check for the fixer's own user (CR-7, 13 Nov 2026). Run on the box as the owner's user, after the root script made aq-fixer:
#   bash scripts/fixer-isolation-check.sh [<a fixer work dir>]
# It logs in as aq-fixer the way the engine does and tries what the fixer must NOT be able to do (read the owner's keys, the data folder,
# the agents' folders, the local-owner key; reach any address but the app; write outside its checkout). Every "must not" that works is a
# FAIL and the script exits 1. Changes nothing on the box.
set -u
H=${AQEELOS_HOME:-$HOME}; DATA=${UI_DATA_DIR:-$H/apps/hermes-ui-data}; KEY=$H/.hermes/agent-ssh/id_ed25519; PORT=${UI_PORT:-4400}
FIX=$H/apps/aqeel-os-fixer; W=${1:-}
fail=0; pass=0
fx(){ ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes aq-fixer@127.0.0.1 "$@" 2>/dev/null </dev/null; }
must_not(){ local what=$1; shift; if fx "$@" >/dev/null 2>&1; then echo "FAIL  can $what"; fail=$((fail+1)); else echo "ok    cannot $what"; pass=$((pass+1)); fi; }
must(){ local what=$1; shift; if fx "$@" >/dev/null 2>&1; then echo "ok    can $what"; pass=$((pass+1)); else echo "FAIL  cannot $what"; fail=$((fail+1)); fi; }
[ "$(fx id -un)" = aq-fixer ] || { echo "FAIL  no login as aq-fixer (is the user made? ~/.aqeelos-fixer-user.done)"; exit 1; }
echo "ok    logs in as aq-fixer"
must_not "read the owner's .env"               "head -c1 $H/.hermes/.env"
must_not "list the owner's .hermes"            "ls $H/.hermes"
must_not "read the owner's SSH keys"           "ls $H/.ssh"
must_not "read the agents' ssh key"            "head -c1 $KEY"
must_not "list the data folder"                "ls $DATA"
must_not "read the local-owner key"            "head -c1 $DATA/local-owner.key"
must_not "list the agents' folders"            "ls $H/workspaces"
must_not "read an agent's folder"              "ls $H/workspaces/default $H/workspaces/sesa"
must_not "read the live app folder"            "ls $H/apps/hermes-ui/app"
must_not "write in the owner's home"           "touch $H/aq-fixer-probe"
must_not "write in the live app folder"        "touch $H/apps/hermes-ui/aq-fixer-probe"
must_not "reach the internet (443)"            "curl -s -m 4 -o /dev/null https://api.github.com"
must_not "reach the engine's dashboard (9119)" "curl -s -m 4 -o /dev/null http://127.0.0.1:9119/"
must_not "reach the test copy directly (4402)" "curl -s -m 4 -o /dev/null http://127.0.0.1:4402/healthz"
must "reach the app on 127.0.0.1:$PORT"        "curl -s -m 5 -f -o /dev/null http://127.0.0.1:$PORT/healthz"
if [ -n "$W" ] && [ -d "$W" ]; then
  must "read its checkout"                     "ls $W/app >/dev/null"
  must "write in its checkout"                 "touch $W/.aq-fixer-probe && rm -f $W/.aq-fixer-probe"
  must_not "write in another work dir"         "for d in $FIX/*/; do [ \"\${d%/}\" != \"${W%/}\" ] && [ -d \"\$d\" ] && touch \"\$d/.p\" && exit 0; done; exit 1"
else echo "(no work dir given: the checkout read/write checks were skipped)"; fi
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
