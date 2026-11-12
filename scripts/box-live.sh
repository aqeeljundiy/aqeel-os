#!/bin/bash
# Runs ON THE BOX: unpacks the checked version, restarts aqeelOS once nothing is in progress, and confirms it answers.
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: CODE_V FORCE HT CT HS CS SHA BOX_SHA DC (the commits list)
set -e
# --- migrate box-checks (12 Nov 2026) ---
# One-time, idempotent move of install-specific check scripts out of the code folder. They used to live in git at scripts/box-checks/ and were deployed to
# ~/apps/hermes-ui/scripts/box-checks/; they belong to one install, so they now live in its data folder, <data>/box-checks/ (a deploy never writes or deletes there).
#   1. every file of the old folder is copied to <data>/box-checks/ unless a file of that name is already there (an edited copy is never overwritten);
#   2. close-stage-due.mjs used to carry its sheet id, tab and account as defaults in the code: they are read from the OLD file on this box and written to
#      <data>/box-checks/close-stage-due.json (unless that exists), so the schedules that call it with only --stage keep working.
# Runs before the new files are unpacked. Deletes nothing (a deploy unpacks over the folder and never removes files; the old copies can be deleted by hand).
# It never fails the deploy. Env: AQ_LIVE (default ~/apps/hermes-ui), AQ_MIG_DATA (default $UI_DATA_DIR or ~/apps/hermes-ui-data).
aq_migrate_box_checks(){ local L=${AQ_LIVE:-$HOME/apps/hermes-ui} D=${AQ_MIG_DATA:-${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}} f n; local T="$D/box-checks" OLD="${AQ_LIVE:-$HOME/apps/hermes-ui}/scripts/close-stage-due.mjs"
 if [ -d "$L/scripts/box-checks" ]; then
  mkdir -p "$T" && chmod 700 "$T" || { echo "! box-checks: could not create $T"; return 0; }
  for f in "$L"/scripts/box-checks/*; do [ -f "$f" ] || continue; n=$(basename "$f"); [ -e "$T/$n" ] && continue
   cp -p "$f" "$T/$n.tmp" && mv "$T/$n.tmp" "$T/$n" && echo "· box-checks: kept $n in $T"; done
 fi
 if [ -f "$OLD" ] && [ ! -e "$T/close-stage-due.json" ] && grep -q "opt('sheet','" "$OLD" 2>/dev/null; then
  mkdir -p "$T" && node -e "
const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const g=n=>{const m=new RegExp(\"opt[(]'\"+n+\"','([^']*)'\").exec(s);return m?m[1]:''};
const c={};for(const k of ['sheet','tab','account']){const v=g(k);if(v)c[k]=v}
if(c.sheet){fs.writeFileSync(process.argv[2]+'.tmp',JSON.stringify(c,null,1)+'\n',{mode:0o600});fs.renameSync(process.argv[2]+'.tmp',process.argv[2]);console.log('· box-checks: close-stage-due settings kept in '+process.argv[2])}
" "$OLD" "$T/close-stage-due.json" || echo "! box-checks: could not keep the close-stage-due settings"
 fi
 return 0; }
# --- end migrate box-checks ---
# Put the previous version back (8 Nov 2026): unpack the kept .deployed.prev.tgz, restore its commit and restart only the web
# app. Recorded in DATA/live-test.json (System › Health). The owner is messaged on Telegram only if this fails too.
aq_tell_owner(){ local t c; t=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' ~/.hermes/.env | cut -d= -f2-); c=$(grep -m1 '^TELEGRAM_HOME_CHANNEL=' ~/.hermes/.env | cut -d= -f2-)
 [ -n "$t" ] && [ -n "$c" ] && curl -fs -m 20 "https://api.telegram.org/bot$t/sendMessage" --data-urlencode "chat_id=$c" --data-urlencode "text=$1" >/dev/null || echo "! could not message the owner"; }
# H7 and H8 (audit of 12 Nov 2026). The new version is never unpacked over the live folder. It is built beside it
# (<app>/.next: a copy of the live folders, the files git dropped taken out (M22), the new archive unpacked on top); a
# failure there (a full disk, a broken archive) leaves the live folder exactly as it was. Then each live folder is renamed
# into <app>/.prev and the new one renamed into its place: a rename cannot half-happen. The undo renames them back, so
# it also brings back files the new version removed, and it restores ~/services.sh. Everything else a deploy changes outside
# the app folder (engine patches, the Code files, the list of live commits that closes issues) waits until the live test passed.
aq_tops(){ tar -tzf "$1" | sed 's#^\./##' | cut -d/ -f1 | grep -v '^$' | sort -u; }
aq_stage_new(){ local A=${AQ_LIVE:-$HOME/apps/hermes-ui} T=$1 S t f n=0; S=$A/.next
 rm -rf "$S" "$A/.prev" "$A/.prev.added" "$A/.prev.tgz" "$A/.undone" "$A/.deployed.tgz.new" || return 1; mkdir -p "$S" || return 1
 while read -r t; do [ -e "$A/$t" ] || continue; cp -a "$A/$t" "$S/$t" || return 1; done < <(aq_tops "$T")
 if [ -s "$A/.deployed.tgz" ]; then
  while read -r f; do [ -f "$S/$f" ] || [ -L "$S/$f" ] || continue; rm -f "$S/$f" && n=$((n+1)); done < <(comm -23 <(tar -tzf "$A/.deployed.tgz" | grep -v '/$' | sed 's#^\./##' | sort) <(tar -tzf "$T" | grep -v '/$' | sed 's#^\./##' | sort))
  [ "$n" = 0 ] || echo "· $n file(s) that git no longer has were taken out"
 fi
 tar -xzf "$T" -C "$S" || return 1
 cp "$T" "$A/.deployed.tgz.new" || return 1
 cat "$A/.deployed-commit" > "$A/.prev.commit" 2>/dev/null || : > "$A/.prev.commit"; }
aq_switch(){ local A=${AQ_LIVE:-$HOME/apps/hermes-ui} t; mkdir -p "$A/.prev" || return 1; : > "$A/.prev.added" || return 1
 for t in "$A"/.next/*; do [ -e "$t" ] || continue; t=${t##*/}
  if [ -e "$A/$t" ]; then mv "$A/$t" "$A/.prev/$t" || return 1; else echo "$t" >> "$A/.prev.added"; fi
  mv "$A/.next/$t" "$A/$t" || return 1; done
 rmdir "$A/.next" 2>/dev/null; if [ -e "$A/.deployed.tgz" ]; then mv "$A/.deployed.tgz" "$A/.prev.tgz" || return 1; fi
 mv "$A/.deployed.tgz.new" "$A/.deployed.tgz" && echo "$SHA" > "$A/.deployed-commit"; }
# the folders kept by aq_switch go back (also after a switch that stopped half way); 1 = there were none
aq_put_back(){ local A=${AQ_LIVE:-$HOME/apps/hermes-ui} t; [ -d "$A/.prev" ] || return 1; rm -rf "$A/.undone"; mkdir -p "$A/.undone" || return 2
 for t in "$A"/.prev/*; do [ -e "$t" ] || continue; t=${t##*/}; if [ -e "$A/$t" ]; then mv "$A/$t" "$A/.undone/$t" || return 2; fi; mv "$A/.prev/$t" "$A/$t" || return 2; done
 while read -r t; do [ -n "$t" ] && [ -e "$A/$t" ] && mv "$A/$t" "$A/.undone/$t"; done < "$A/.prev.added" 2>/dev/null
 if [ -e "$A/.prev.tgz" ]; then mv -f "$A/.prev.tgz" "$A/.deployed.tgz" || return 2; fi
 rm -rf "$A/.undone" "$A/.prev" "$A/.prev.added" "$A/.prev.commit" "$A/.next" "$A/.deployed.tgz.new"; return 0; }
aq_services_keep(){ local A=${AQ_LIVE:-$HOME/apps/hermes-ui} D=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}; rm -f "$A/.services.prev" "$A/.services.shipped.prev"
 [ -f ~/services.sh ] && cp -p ~/services.sh "$A/.services.prev"; [ -f "$D/services.shipped" ] && cp -p "$D/services.shipped" "$A/.services.shipped.prev"; return 0; }
aq_services_back(){ local A=${AQ_LIVE:-$HOME/apps/hermes-ui} D=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}; [ -f "$A/.services.prev" ] || return 0
 cmp -s "$A/.services.prev" ~/services.sh || { cp -p "$A/.services.prev" ~/services.sh.undo && mv ~/services.sh.undo ~/services.sh && echo "↩ ~/services.sh is the previous one again"; }
 if [ -f "$A/.services.shipped.prev" ]; then cp -p "$A/.services.shipped.prev" "$D/services.shipped"; else rm -f "$D/services.shipped"; fi
 rm -f "$A/.services.prev" "$A/.services.shipped.prev"; return 0; }
aq_undo(){ local why=$1 A=${AQ_LIVE:-$HOME/apps/hermes-ui} P rc; AQ_UNDONE=1; P=$(cat $A/.deployed.prev-commit 2>/dev/null || true)
 [ -d $A/.prev ] && [ -s $A/.prev.commit ] && P=$(cat $A/.prev.commit)   # the folders kept by this deploy's switch are that version
 if { [ ! -s $A/.deployed.prev.tgz ] && [ ! -d $A/.prev ]; } || [ -z "$P" ]; then echo "✗ $why, and there is no previous version to put back"; aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed its check ($why) and there was no previous version to put back. Open System › Health."; return 1; fi
 echo "↩ $why: putting ${P:0:8} back…"
 rc=0; aq_put_back || rc=$?
 if [ "$rc" = 0 ]; then
  echo "$P" > $A/.deployed-commit || { aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why) and putting ${P:0:8} back failed. Please check the server."; return 1; }
 elif [ "$rc" = 1 ] && [ -s $A/.deployed.prev.tgz ]; then
  tar -xzf $A/.deployed.prev.tgz -C $A && cp $A/.deployed.prev.tgz $A/.deployed.tgz && echo "$P" > $A/.deployed-commit || { aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why) and putting ${P:0:8} back failed while unpacking. Please check the server."; return 1; }
 else aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why) and putting ${P:0:8} back failed while moving its folders. Please check the server."; return 1; fi
 aq_services_back
 tmux kill-session -t "=ui" 2>/dev/null || true; ~/services.sh || echo "! ~/services.sh exited with an error ($?); the check below decides"; local h=""; for i in $(seq 1 30); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done
 node -e "const fs=require('fs'),f=(process.env.UI_DATA_DIR||require('os').homedir()+'/apps/hermes-ui-data')+'/live-test.json';let d={runs:[]};try{d=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}const r=d.runs&&d.runs[0];const u={at:Date.now(),to:process.argv[1],why:process.argv[2],ok:!!process.argv[3]};if(r&&r.sha===process.argv[4])r.undo=u;else d.runs=[{at:Date.now(),sha:process.argv[4],ok:false,failed:[process.argv[2]],results:[],undo:u},...(d.runs||[])].slice(0,30);fs.writeFileSync(f,JSON.stringify(d,null,1))" "$P" "$why" "$h" "$SHA" 2>/dev/null || true
 if [ -n "$h" ]; then echo "↩ ${P:0:8} is back and answers. The deploy of ${SHA:0:8} was undone ($why); System › Health shows why."; return 0; fi
 echo "✗ ${P:0:8} was put back but does not answer"; aq_tell_owner "aqeelOS: the deploy of ${SHA:0:8} failed ($why); ${P:0:8} was put back but does not answer yet. Please check the server."; return 1; }
# From the moment the live folders are switched (AQ_STAGE=golive, set BEFORE the switch since 12 Nov: H7) any failure that is not handled below (12 Nov 2026: ~/services.sh returned 1 and the
# deploy said "FAILED go live" with the new version running, untested and not undone) puts the previous version back, as a failed live
# test does; if that is impossible the log says which version is running. Past the live test (AQ_STAGE=done) the new, tested version stays.
aq_exit(){ local rc=$?
 if [ "$rc" != 0 ] && [ "${AQ_STAGE:-}" = golive ] && [ -z "${AQ_UNDONE:-}" ]; then set +e; echo "✗ going live stopped (exit $rc) after the new files were unpacked, before the live test"
  if aq_undo "going live failed"; then :; else echo "! the NEW version ${SHA:0:8} is running: it was not live-tested and the previous version could not be put back"; fi
 elif [ "$rc" != 0 ] && [ "${AQ_STAGE:-}" = done ]; then echo "! a final step stopped (exit $rc); the new version ${SHA:0:8} is running and passed its live test"; fi
 aq_unlock; return $rc; }
# M17: the lock says who holds it and is touched every minute while its deploy lives, so a long go-live (5 min wait, 15 min
# live test, an undo) is not taken for a dead one after 20 minutes, and nobody removes a lock that is not theirs
aq_unlock(){ [ -n "${AQ_BEAT:-}" ] && kill "$AQ_BEAT" 2>/dev/null; [ "$(cat /tmp/aq-live.lock/owner 2>/dev/null)" = "$$" ] && rm -rf /tmp/aq-live.lock; return 0; }
# the files arrived whole: same size as sent, and readable
for x in "$HT:$HS" "$CT:$CS"; do f=${x%%:*};z=${x##*:};[ "$(wc -c < "$f" 2>/dev/null)" = "$z" ] && tar -tzf "$f" >/dev/null 2>&1 || { echo "✗ $f did not arrive whole; nothing changed."; rm -f $HT $CT; exit 1; }; done
L=/tmp/aq-live.lock;got=0
for i in $(seq 1 90); do mkdir $L 2>/dev/null && { got=1; echo $$ > $L/owner; break; }
 [ -n "$(find $L -maxdepth 0 -mmin +20 2>/dev/null)" ] && { rm -rf $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another deploy is going live; waiting for it…"; sleep 10; done
[ "${got:-0}" = 1 ] || { echo "✗ another deploy kept going for 15 minutes; nothing changed."; rm -f $HT $CT; exit 1; }
trap aq_exit EXIT
( while kill -0 $$ 2>/dev/null && [ "$(cat $L/owner 2>/dev/null)" = "$$" ]; do touch $L 2>/dev/null; sleep 60; done ) >/dev/null 2>&1 & AQ_BEAT=$!
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
# M17: deploying the commit that is already live again must not make "the previous version" that same commit
if [ -s ~/apps/hermes-ui/.deployed.tgz ] && [ "$NOW_SHA" != "$SHA" ]; then cp ~/apps/hermes-ui/.deployed.tgz ~/apps/hermes-ui/.deployed.prev.tgz && cp ~/apps/hermes-ui/.deployed-commit ~/apps/hermes-ui/.deployed.prev-commit 2>/dev/null || true; fi
aq_migrate_box_checks || true   # install-specific check scripts move to the data folder first (see above)
mkdir -p ~/apps/hermes-ui
# H7: built beside the live folder; a failure here changes nothing that is live
aq_stage_new "$HT" || { rm -rf ~/apps/hermes-ui/.next ~/apps/hermes-ui/.deployed.tgz.new; echo '✗ unpacking aqeelOS failed (disk full?). The live version was not touched and keeps running.'; rm -f $HT $CT; exit 1; }
aq_services_keep
AQ_STAGE=golive   # set BEFORE the switch: from here on aq_exit undoes an unhandled failure
aq_switch || { echo '✗ switching to the new files failed'; exit 1; }
rm -f $HT
# the note the new version reads when it starts: an update restarted it, so what was in progress says "interrupted by an update"
AQ_DATA=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}; mkdir -p "$AQ_DATA/resume" && printf '{"at":%s000,"why":"update"}' "$(date +%s)" > "$AQ_DATA/resume/planned.json" || true
# ~/services.sh is installed first and the UI stopped last, so the UI is down only for its own restart (L8: it used to wait
# for the engine patches, up to 8 minutes on a stale patch lock)
# ~/services.sh comes from git (scripts/services.sh) unless this box edited it by hand (scripts/services-install.sh says which); it never fails the deploy
SERVICES_ADOPT=${SERVICES_ADOPT:-0} bash ~/apps/hermes-ui/scripts/services-install.sh || echo "! services.sh install: see the message above"
tmux kill-session -t "=ui" 2>/dev/null || true   # "=" = exactly ui (a bare -t ui also matches ui-staging)
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
# H8: only a version that passed its live test changes anything outside the app folder. An undone deploy leaves the engine,
# the Code files and the list of live commits (which closes issues as "live on the box") as they were.
A=~/apps/hermes-ui; rm -rf $A/.prev $A/.prev.added $A/.prev.commit $A/.prev.tgz $A/.undone $A/.services.prev $A/.services.shipped.prev
[ -n "$DC" ] && [ -s "$DC" ] && mv "$DC" $A/.deployed-commits
node $A/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above (exit $?)"
# every copy of the engine plugins this version ships (the engine home and each agent's own) becomes the shipped version (12 Nov 2026: copies were
# made once and never updated, so a plugin fix reached no agent). Only shipped files are replaced, a home without a plugin does not get it, the
# engine loads the update at its next restart and System › Health shows what waits or still differs (app/plugin-sync.mjs). Never fails the deploy.
(cd $A && UI_DATA_DIR=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data} node $( [ -f $HOME/apps/hermes-ui.env ] && echo --env-file=$HOME/apps/hermes-ui.env ) scripts/plugin-sync.mjs) || echo "! plugin sync: see the message above (exit $?)"
C=~/apps/aqeel-code; mkdir -p $C; before=$(md5sum $C/package-lock.json 2>/dev/null)
if tar -xzf $CT -C $C --strip-components=1; then rm -f $CT; echo "$CODE_V" > $C/VERSION; else echo "! unpacking Code failed; the Code files may be mixed. aqeelOS itself is live and tested."; rm -f $CT; fi
# Online Code is off unless this install switched it on (12 Nov 2026): the Code files above stay (the Build app downloads and Live are made from
# them), but their npm packages are only for the workspace that runs on the server, so they are installed only while it is on.
AQ_OC=$(cd $A && UI_DATA_DIR=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data} node $( [ -f $HOME/apps/hermes-ui.env ] && echo --env-file=$HOME/apps/hermes-ui.env ) scripts/online-code.mjs 2>/dev/null || echo off)
if [ "$AQ_OC" = on ]; then [ "$before" = "$(md5sum $C/package-lock.json 2>/dev/null)" ] || (cd $C && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "! Code packages: npm install failed")
else echo "· online Code is off: its packages are not installed or updated (coding happens on people's own computers)"; fi
# what the restart cut off continues by itself (app/resume.mjs); said here so the deploy's log shows it
w=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"waiting":[0-9]*' | cut -d: -f2); [ "${AQ_CUT:-0}" = 0 ] && [ "${w:-0}" = 0 ] || echo "· ${AQ_CUT:-0} reply(ies) were in progress at the restart; ${w:-0} thing(s) are being continued (System › Health shows the result)"
