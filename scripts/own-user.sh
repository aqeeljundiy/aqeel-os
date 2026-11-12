#!/bin/bash
# Give an agent its own Linux user (ag-<agent>) instead of the main user. Run as the box user (claude), never as root.
#   bash scripts/own-user.sh <agent>          only looks: what would change and what would break (changes nothing)
#   bash scripts/own-user.sh <agent> --do     does it: records how it is now (<data>/own-user-prev/<agent>.txt), takes the agent off the trusted list (agent-trust.json) and asks the app to apply it
#   bash scripts/own-user.sh <agent> --undo   the way back: puts the agent on the trusted list again (the root script then takes its user away and hands the folder back; the app sets its terminal to local)
# The same switch is Agents > Edit agent > Trusted (off). The app then asks the root script (aq-agent-users) for the user; the
# root script makes ag-<agent>, hands the folder over and starts a screen of its own; the agent's terminal moves to that user.
set -u
A=${1:-}; DO=${2:-}
[[ "$A" =~ ^[a-z0-9][a-z0-9_-]{0,28}$ ]] || { echo "usage: own-user.sh <agent> [--do]"; exit 2; }
H=${AQEELOS_HOME:-$HOME}; HH=$H/.hermes; P=$HH/profiles/$A; W=$H/workspaces/$A
DATA=${UI_DATA_DIR:-$H/apps/hermes-ui-data}; TRUST=$DATA/agent-trust.json
[ -d "$P" ] || { echo "no profile $P"; exit 1; }
say(){ printf '%s\n' "$*"; }
if grep -q "\"$A\"" "$TRUST" 2>/dev/null; then say "trusted now: yes (runs as $(id -un))"; else say "trusted now: no (already on its own user, or about to be)"; fi
id "ag-$A" >/dev/null 2>&1 && say "user ag-$A: exists" || say "user ag-$A: not made yet (the root script makes it within a minute of the switch)"
say "terminal now: $(sed -n 's/^  backend: //p' "$P/config.yaml" | head -1)   browser cdp_url: [$(sed -n "s/^  cdp_url: //p" "$P/config.yaml" | head -1)]"
say; say "-- what would change for it"
say "1. Its terminal and file tools run as ag-$A over SSH (terminal.backend ssh), in $W. They can no longer read $HH, $P/.env, the data folder or other agents."
say "2. Its own screen and Chrome start (display and port from ~/.aqeelos-agent-ports, Chrome profile $W/.browser). The engine screen it uses now (Xvnc as $(id -un)) stops being used:"
pgrep -af "Xvnc.*profiles/$A/" | cut -c1-120 | sed 's/^/     running now: /'
say "   its browser sign-ins live in $W/.screen/browser-profile (engine screen); the root script copies that profile over $W/.browser when it makes the user (the old .browser is kept as .browser.before-own-user, the engine screen's profile stays for the way back)."
say "   if the move fails (a command as the user, SSH from aqeelOS or Chrome as the user does not work) the root script puts everything back by itself and files an issue."
say "3. $W is handed over to ag-$A (chown of every name in it); aqeelOS keeps access through an access list."
say "4. About a minute of agent restart (applyDefaults) when the settings change; the Telegram/WhatsApp gateway runs on as $(id -un)."
say; say "-- checks"
n=$(find "$W" -xdev -not -user "$(id -un)" 2>/dev/null | wc -l); say "files in $W not owned by $(id -un): $n (leftovers of an earlier own user are re-owned by the root script)"
say "access list entries naming a number (old user): $(getfacl -p "$W" 2>/dev/null | grep -c '^user:[0-9]')"
say "secrets in the profile .env (names) vs files in $W/.secrets:"
for k in $(sed -n 's/^\([A-Z0-9_]*\(KEY\|TOKEN\|SECRET\)[A-Z0-9_]*\)=.*/\1/p' "$P/.env" 2>/dev/null | sort -u); do
  [ -e "$W/.secrets/$k" ] && say "   $k: also a file in .secrets (a terminal command can read it)" || say "   $k: only in the profile .env (terminal commands will NOT see it; tools run by the engine still do)"
done
say "schedules (cron jobs) naming it: $(grep -c "$A" "$HH/cron/jobs.json" 2>/dev/null | head -1)   (a job's script that reads files outside $W would fail)"
say "scripts or notes in $W naming /home/$(id -un) outside caches:"; grep -rIl "/home/$(id -un)" "$W" --exclude-dir=.browser --exclude-dir=.cache --exclude-dir=.screen --exclude-dir=.config 2>/dev/null | head -5 | sed 's/^/   /'
if [ "$DO" = "--undo" ]; then
  [ -f "$TRUST" ] || echo '{"trusted":[]}' > "$TRUST"
  node -e 'const fs=require("fs"),f=process.argv[1],a=process.argv[2];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.trusted=[...new Set([...(j.trusted||[]),a])].sort();fs.writeFileSync(f+".tmp",JSON.stringify(j,null,1));fs.renameSync(f+".tmp",f)' "$TRUST" "$A" \n    && say "UNDONE: $A is trusted again (runs as $(id -un)). The app applies it on its next defaults pass; the root script takes ag-$A away and hands the folder back. Its engine screen profile ($W/.screen/browser-profile) was never changed."
  exit 0
fi
if [ "$DO" = "--do" ]; then
  mkdir -p "$DATA/own-user-prev" && { date -u +%FT%TZ; id -un; stat -c 'folder owner %U:%G mode %a' "$W"; sed -n '/^terminal:/,/^[a-z]/p;/^browser:/,/^[a-z]/p;/^bot_desktop:/,/^[a-z]/p' "$P/config.yaml" | grep -v -i 'key|token|secret|password'; } > "$DATA/own-user-prev/$A.txt" 2>/dev/null && say "recorded how it is now: $DATA/own-user-prev/$A.txt"
  [ -f "$TRUST" ] || echo '{"trusted":[]}' > "$TRUST"
  node -e 'const fs=require("fs"),f=process.argv[1],a=process.argv[2];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.trusted=(j.trusted||[]).filter(x=>x!==a);fs.writeFileSync(f+".tmp",JSON.stringify(j,null,1));fs.renameSync(f+".tmp",f)' "$TRUST" "$A" \
    && say "DONE: $A is off the trusted list. The app applies it on its next defaults pass (or press Restart agents on System > Health). Stop its old engine screen first if it is running."
else
  say; say "Nothing was changed. To do it:  bash scripts/own-user.sh $A --do   (or Agents > Edit agent > Trusted: off)"
fi
