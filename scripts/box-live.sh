#!/bin/bash
# Runs ON THE BOX: unpacks the checked version, restarts aqeelOS once nothing is in progress, and confirms it answers.
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: CODE_V FORCE HT CT HS CS SHA BOX_SHA DC (the commits list)
set -e
# Put the previous version back (8 Nov 2026): unpack the kept .deployed.prev.tgz, restore its commit and restart only the web
# app. Recorded in DATA/live-test.json (System › Health). The owner is messaged on Telegram only if this fails too.
aq_tell_owner(){ local t c; t=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' ~/.hermes/.env | cut -d= -f2-); c=$(grep -m1 '^TELEGRAM_HOME_CHANNEL=' ~/.hermes/.env | cut -d= -f2-)
 [ -n "$t" ] && [ -n "$c" ] && curl -fs -m 20 "https://api.telegram.org/bot$t/sendMessage" --data-urlencode "chat_id=$c" --data-urlencode "text=$1" >/dev/null || echo "! could not message the owner"; }
aq_undo(){ local why=$1 A=~/apps/hermes-ui P; AQ_UNDONE=1; P=$(cat $A/.deployed.prev-commit 2>/dev/null)
 if [ ! -s $A/.deployed.prev.tgz ] || [ -z "$P" ]; then echo "✗ $why, and there is no previous version to put back"; aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed its check ($why) and there was no previous version to put back. Open System › Health."; return 1; fi
 echo "↩ $why: putting ${P:0:8} back…"
 tar -xzf $A/.deployed.prev.tgz -C $A && cp $A/.deployed.prev.tgz $A/.deployed.tgz && echo "$P" > $A/.deployed-commit || { aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why) and putting ${P:0:8} back failed while unpacking. Please check the server."; return 1; }
 tmux kill-session -t "=ui" 2>/dev/null || true; ~/services.sh || echo "! ~/services.sh exited with an error ($?); the check below decides"; local h=""; for i in $(seq 1 30); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done
 node -e "const fs=require('fs'),f=(process.env.UI_DATA_DIR||require('os').homedir()+'/apps/hermes-ui-data')+'/live-test.json';let d={runs:[]};try{d=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}const r=d.runs&&d.runs[0];const u={at:Date.now(),to:process.argv[1],why:process.argv[2],ok:!!process.argv[3]};if(r&&r.sha===process.argv[4])r.undo=u;else d.runs=[{at:Date.now(),sha:process.argv[4],ok:false,failed:[process.argv[2]],results:[],undo:u},...(d.runs||[])].slice(0,30);fs.writeFileSync(f,JSON.stringify(d,null,1))" "$P" "$why" "$h" "$SHA" 2>/dev/null || true
 if [ -n "$h" ]; then echo "↩ ${P:0:8} is back and answers. The deploy of ${SHA:0:8} was undone ($why); System › Health shows why."; return 0; fi
 echo "✗ ${P:0:8} was put back but does not answer"; aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why); ${P:0:8} was put back but does not answer yet. Please check the server."; return 1; }
# Once the new files are unpacked (AQ_STAGE=golive) any failure that is not handled below (12 Nov 2026: ~/services.sh returned 1 and the
# deploy said "FAILED go live" with the new version running, untested and not undone) puts the previous version back, as a failed live
# test does; if that is impossible the log says which version is running. Past the live test (AQ_STAGE=done) the new, tested version stays.
aq_exit(){ local rc=$?
 if [ "$rc" != 0 ] && [ "${AQ_STAGE:-}" = golive ] && [ -z "${AQ_UNDONE:-}" ]; then set +e; echo "✗ going live stopped (exit $rc) after the new files were unpacked, before the live test"
  if aq_undo "going live failed"; then :; else echo "! the NEW version ${SHA:0:8} is running: it was not live-tested and the previous version could not be put back"; fi
 elif [ "$rc" != 0 ] && [ "${AQ_STAGE:-}" = done ]; then echo "! a final step stopped (exit $rc); the new version ${SHA:0:8} is running and passed its live test"; fi
 rmdir /tmp/aq-live.lock 2>/dev/null || true; return $rc; }
# the files arrived whole: same size as sent, and readable
for x in "$HT:$HS" "$CT:$CS"; do f=${x%%:*};z=${x##*:};[ "$(wc -c < "$f" 2>/dev/null)" = "$z" ] && tar -tzf "$f" >/dev/null 2>&1 || { echo "✗ $f did not arrive whole; nothing changed."; rm -f $HT $CT; exit 1; }; done
L=/tmp/aq-live.lock;got=0
for i in $(seq 1 90); do mkdir $L 2>/dev/null && { got=1; break; }
 [ -n "$(find $L -maxdepth 0 -mmin +20 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another deploy is going live; waiting for it…"; sleep 10; done
[ "${got:-0}" = 1 ] || { echo "✗ another deploy kept going for 15 minutes; nothing changed."; rm -f $HT $CT; exit 1; }
trap aq_exit EXIT
# another deploy went live while this one was checked and sent: it may hold work this one lacks
NOW_SHA=$(cat ~/apps/hermes-ui/.deployed-commit 2>/dev/null || true)
if [ "$NOW_SHA" != "$BOX_SHA" ] && [ "$NOW_SHA" != "$SHA" ]; then echo "✗ another deploy (${NOW_SHA:0:8}) went live meanwhile; nothing changed. Merge it in and deploy again."; rm -f $HT $CT; exit 1; fi
# Right before the restart, once more (up to 5 minutes): what cannot be continued afterwards must be finished ("hold": an
# agent being set up, an engine restart, a restore). Replies and runs in progress are not waited for since 12 Nov 2026:
# aqeelOS journals them and continues them when the new version answers (app/resume.mjs). WAIT_IDLE=1 waits for them too.
aq_n(){ local h b l n; h=$(curl -fs http://127.0.0.1:4400/healthz || true); b=$(echo "$h" | grep -o '"busy":[0-9]*' | cut -d: -f2); l=$(echo "$h" | grep -o '"live":[0-9]*' | cut -d: -f2)
 if [ "${WAIT_IDLE:-0}" = 1 ]; then echo "${b:-0}"; return; fi
 n=$(echo "$h" | grep -o '"hold":[0-9]*' | cut -d: -f2); [ -z "$n" ] && n=$(( ${b:-0} - ${l:-0} )); [ "$n" -lt 0 ] && n=0; echo "$n"; }
for i in $(seq 1 60); do n=$(aq_n); [ "${n:-0}" = 0 ] && break; [ "$i" = 1 ] && echo "something that cannot be continued is in progress; waiting for it…"; sleep 5; done
n=$(aq_n); if [ "${n:-0}" != 0 ] && [ "${FORCE:-0}" != 1 ]; then echo "✗ still busy; nothing changed on the box. Try again later, or FORCE=1."; rm -f $HT $CT; exit 1; fi
AQ_CUT=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"inFlight":[0-9]*' | cut -d: -f2)
# Drift guard (7 Nov 2026: the fixer patched app code on the box and the next deploy silently put the old file back).
# Before unpacking, the live files are compared with what the box last unpacked (.deployed.tgz, kept below; before the
# first one, the box's git copy of the commit it says it runs). Any difference is saved as DATA/drift/<time>.patch,
# printed here, and listed on System › Health, so nobody's fix is lost. It never stops the deploy.
aq_drift(){ local L=${AQ_LIVE:-$HOME/apps/hermes-ui} D=${AQ_DRIFT_DATA:-${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}} R=$HOME/apps/aqeel-os-src B; B=$(mktemp -d) || return 1
 if [ -s "$L/.deployed.tgz" ]; then tar -xzf "$L/.deployed.tgz" -C "$B" 2>/dev/null || { rm -rf "$B"; return 1; }
 elif [ -n "$BOX_SHA" ] && git -C "$R" cat-file -e "$BOX_SHA^{commit}" 2>/dev/null; then
  git -C "$R" archive "$BOX_SHA" $(git -C "$R" ls-tree --name-only "$BOX_SHA" | grep -xE 'app|assets|backlog|engine|extension|scripts|code-installer') | tar -x -C "$B" || { rm -rf "$B"; return 1; }
 else echo "· drift check: no copy of what the box ran yet; it checks from the next deploy on"; rm -rf "$B"; return 0; fi
 local P; P=$(mktemp); local X=(-x '*.bak*' -x '*.prev' -x '*.orig' -x '*.tmp' -x '*.rej' -x node_modules -x __pycache__ -x '*.pyc' -x features.mjs)
 for d in app assets backlog engine extension scripts code-installer; do [ -d "$B/$d" ] || continue
  # changed and removed files; a file only on the box counts when it is newer than the last deploy (older ones are leftovers)
  (cd "$B" && diff -ru "${X[@]}" "$d" "$L/$d" | grep -v "^Only in $L/" | sed "s#^+++ $L/#+++ #;s#^diff -ru.*##") >> "$P"
  find "$L/$d" -type f -newer "$L/.deployed-commit" ! -name '*.bak*' ! -name '*.prev' ! -name '*.orig' ! -name '*.tmp' ! -name '*.rej' ! -name '*.pyc' ! -path '*/node_modules/*' ! -name features.mjs 2>/dev/null | while read -r f; do r=${f#$L/}; [ -e "$B/$r" ] || diff -u --label /dev/null --label "$r" /dev/null "$f" >> "$P"; done
 done
 rm -rf "$B"
 if [ -s "$P" ]; then mkdir -p "$D/drift"; local O E same=""; O="$D/drift/$(date -u +%Y%m%d-%H%M%S).patch"; local i=1; while [ -e "$O" ]; do i=$((i+1)); O="$D/drift/$(date -u +%Y%m%d-%H%M%S)-$i.patch"; done   # two differences in one second keep their own file
  # the same difference saved by an earlier, stopped deploy is not saved twice
  for E in "$D"/drift/*.patch; do [ -f "$E" ] && [ "$(tail -n +4 "$E")" = "$(cat "$P")" ] && { same=$E; break; }; done
  if [ -n "$same" ]; then O=$same; else
  { echo "# Changed on the live box after deploy ${BOX_SHA:0:8}, found by the deploy of ${SHA:0:8} at $(date -u '+%F %T') UTC, before it unpacked."
    echo "# The deploy put the files from git back. If this is a fix, take it into git (git apply -p0 in the repo), or it stays lost."; echo; cat "$P"; } > "$O"; chmod 600 "$O"; fi
  echo "! drift: the box had changes git does not have. Saved as ${O#$D/} (System › Health lists it and asks for it):"; grep -E '^(\+\+\+|Only in) ' "$P" | sed 's/^+++ /  changed: /;s/\t.*//' | head -40
  head -c 20000 "$P"; [ "$(wc -c < "$P")" -gt 20000 ] && echo "… (the rest is in the file)"
  # 12 Nov 2026: a deploy no longer drops it silently. Without FORCE=1 it stops here (return 3); the app files one Health "Needs you" item
  # naming the files (code-changes.mjs raise). FORCE=1 goes on, and the item stays until the patch is taken into git or dropped.
  rm -f "$P"; [ "${FORCE:-0}" = 1 ] && { echo "! FORCE=1: going on; the patch stays in ${O#$D/} and on Health."; return 0; }; return 3
 else echo "· drift check: the box ran exactly ${BOX_SHA:0:8}"; fi
 rm -f "$P"; }
rc=0; aq_drift || rc=$?
if [ "$rc" = 3 ]; then echo "✗ the box has live changes that git does not have (saved above; System › Health asks for them). Nothing was changed. Take them into git and deploy again, or FORCE=1 to put the git files back anyway."; rm -f $HT $CT; exit 1; fi
[ "$rc" = 0 ] || echo "! drift check: it could not run (the deploy goes on)"
# the version running now is kept, so a failed live test below can put it back (8 Nov 2026)
T0=$(( $(date +%s) * 1000 ))
if [ -s ~/apps/hermes-ui/.deployed.tgz ]; then cp ~/apps/hermes-ui/.deployed.tgz ~/apps/hermes-ui/.deployed.prev.tgz && cp ~/apps/hermes-ui/.deployed-commit ~/apps/hermes-ui/.deployed.prev-commit 2>/dev/null || true; fi
mkdir -p ~/apps/hermes-ui; tar -xzf $HT -C ~/apps/hermes-ui || { echo '✗ unpacking aqeelOS failed; it was not restarted.'; exit 1; }; cp $HT ~/apps/hermes-ui/.deployed.tgz.new && mv ~/apps/hermes-ui/.deployed.tgz.new ~/apps/hermes-ui/.deployed.tgz; rm $HT; echo "$SHA" > ~/apps/hermes-ui/.deployed-commit; [ -n "$DC" ] && [ -s "$DC" ] && mv "$DC" ~/apps/hermes-ui/.deployed-commits
AQ_STAGE=golive   # from here on aq_exit undoes an unhandled failure
C=~/apps/aqeel-code; mkdir -p $C; before=$(md5sum $C/package-lock.json 2>/dev/null)
tar -xzf $CT -C $C --strip-components=1 || { echo "✗ unpacking Code failed; aqeelOS was not restarted."; exit 1; }; rm $CT; echo "$CODE_V" > $C/VERSION
# Online Code is off unless this install switched it on (12 Nov 2026): the Code files above stay (the Build app downloads and Live are made from
# them), but their npm packages are only for the workspace that runs on the server, so they are installed only while it is on.
AQ_OC=$(cd ~/apps/hermes-ui && UI_DATA_DIR=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data} node $( [ -f $HOME/apps/hermes-ui.env ] && echo --env-file=$HOME/apps/hermes-ui.env ) scripts/online-code.mjs 2>/dev/null || echo off)
if [ "$AQ_OC" = on ]; then [ "$before" = "$(md5sum $C/package-lock.json 2>/dev/null)" ] || (cd $C && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "! Code packages: npm install failed")
else echo "· online Code is off: its packages are not installed or updated (coding happens on people's own computers)"; fi
# the note the new version reads when it starts: an update restarted it, so what was in progress says "interrupted by an update"
AQ_DATA=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}; mkdir -p "$AQ_DATA/resume" && printf '{"at":%s000,"why":"update"}' "$(date +%s)" > "$AQ_DATA/resume/planned.json" || true
tmux kill-session -t "=ui" 2>/dev/null || true   # "=" = exactly ui (a bare -t ui also matches ui-staging)
# the box's ~/services.sh must match sessions exactly too (has-session -t "=$1"), or ui-staging keeps ui from starting (7 Nov 2026)
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
# ~/services.sh comes from git (scripts/services.sh) unless this box edited it by hand (scripts/services-install.sh says which); it never fails the deploy
SERVICES_ADOPT=${SERVICES_ADOPT:-0} bash ~/apps/hermes-ui/scripts/services-install.sh || echo "! services.sh install: see the message above"
~/services.sh || echo "! ~/services.sh exited with an error ($?); the UI check below decides"; for i in $(seq 1 20); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done; [ -n "$h" ] && echo "$h · UI restarted" || { echo "✗ the UI did not answer within 20 s"; aq_undo "the UI did not answer"; exit 1; }
# The real-life test (8 Nov 2026, the owner's stability plan): tool servers, schedules, engine, a Kirimdev tester message and
# one short reply from the test agent. If it fails, the previous version goes back by itself (no engine restart), the
# failure shows on System › Health, and the owner hears about it only if putting it back fails too. LIVE_TEST=0 skips it.
if [ "${LIVE_TEST:-1}" != 0 ] && [ -f ~/apps/hermes-ui/scripts/live-test.mjs ]; then
 echo "· live test (about 5 minutes)…"
 rc=0; lt=$(cd ~/apps/hermes-ui && timeout 900 node --env-file=$HOME/.hermes/.env --env-file=$HOME/apps/hermes-ui.env scripts/live-test.mjs --since "$T0" --sha "$SHA" 2>&1) || rc=$?   # set -e: keep going to the undo
 echo "$lt" | tail -12
 [ "$rc" = 0 ] || { aq_undo "the live test failed"; exit 1; }
fi
AQ_STAGE=done
# what the restart cut off continues by itself (app/resume.mjs); said here so the deploy's log shows it
w=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"waiting":[0-9]*' | cut -d: -f2); [ "${AQ_CUT:-0}" = 0 ] && [ "${w:-0}" = 0 ] || echo "· ${AQ_CUT:-0} reply(ies) were in progress at the restart; ${w:-0} thing(s) are being continued (System › Health shows the result)"
