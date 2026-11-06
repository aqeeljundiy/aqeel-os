#!/bin/bash
# Copies the app to the AI box and restarts the UI. Run from the hermes-ui folder: bash scripts/deploy.sh
# Needs the `ai-vps` SSH host (see ~/.ssh/config). Secrets stay on the box in ~/apps/hermes-ui.env.
# DRY_RUN=1 bash scripts/deploy.sh: runs the local checks and builds the archives, then stops (no ssh, nothing sent).
# Optional paths (data, mockup, PRD.md, scripts/features.mjs) are private and not in the public repo: skipped if missing.
DRY=${DRY_RUN:-0}
set -e
cd "$(dirname "$0")/.."
node scripts/check-globals.mjs
for f in app/*.js app/*.mjs; do node --check "$f" || { echo "✗ $f does not parse"; exit 1; }; done
# 0) Never take the box back (5 Nov 2026: two sessions deployed at once and the later one dropped the other's work).
#    What goes live must be committed, and must contain the commit the box runs now; the box keeps that commit in
#    ~/apps/hermes-ui/.deployed-commit. DIRTY_OK=1 allows uncommitted changes (they still must contain the box's commit).
SHA=$(git rev-parse HEAD)
if [ "${DIRTY_OK:-0}" != 1 ] && [ -n "$(git status --porcelain -- app scripts assets engine extension code code-installer mockup backlog PRD.md)" ]; then
 echo "✗ there are uncommitted changes here; commit them first so the box can tell versions apart (or DIRTY_OK=1)."; exit 1; fi
BOX_SHA=""; [ "$DRY" = 1 ] || BOX_SHA=$(ssh ai-vps 'cat ~/apps/hermes-ui/.deployed-commit 2>/dev/null' || true)
if [ -n "$BOX_SHA" ] && ! git merge-base --is-ancestor "$BOX_SHA" HEAD 2>/dev/null; then
 echo "✗ the box runs commit ${BOX_SHA:0:8}, which this copy does not have: deploying would remove that work. Merge it in first (git fetch / merge main)."; exit 1; fi
# the new version must pass the checks on the private test copy first (about 5 minutes; SKIP_CHECKS=1 skips them)
[ "${SKIP_CHECKS:-0}" = 1 ] || [ "$DRY" = 1 ] || bash scripts/predeploy.sh
# 1) Never cut off work in progress (a reply, an agent being set up, a settings change, an engine restart):
#    wait until the box is idle. After 10 minutes the deploy is cancelled, with nothing changed on the box
#    (FORCE=1 bash scripts/deploy.sh deploys anyway).
[ "$DRY" = 1 ] || ssh ai-vps "FORCE=${FORCE:-0} bash -s" <<'BOX'
for i in $(seq 1 120); do
 h=$(curl -fs http://127.0.0.1:4400/healthz || true)
 n=$(echo "$h" | grep -o '"busy":[0-9]*' | cut -d: -f2); [ -z "$n" ] && n=$(echo "$h" | grep -o '"live":[0-9]*' | cut -d: -f2)
 [ "${n:-0}" = 0 ] && exit 0
 [ "$i" = 1 ] && echo "waiting for $n thing(s) in progress to finish…"
 if [ "$i" = 120 ] && [ "$FORCE" != 1 ]; then echo "✗ still busy after 10 minutes; nothing changed. Try again later, or FORCE=1."; exit 1; fi
 sleep 5
done
BOX
# 2) Only now pack the files, so what goes live is what is here at this moment (not what was here before the wait).
if [ -f scripts/features.mjs ]; then node scripts/features.mjs >/dev/null; fi
ID=$(date +%s)-$$;LH=../hui-$ID.tgz;LC=../code-$ID.tgz
PACK=""; for p in app assets backlog data engine extension mockup scripts code-installer PRD.md; do
 if [ -e "$p" ]; then PACK="$PACK $p"; else case $p in app|scripts|engine) echo "✗ $p is missing; nothing was sent."; exit 1;; *) echo "· $p not here; skipped (optional)";; esac; fi; done
tar --force-local -czf $LH $PACK
# Code (code/ here) goes to the box's own Code copy, ~/apps/aqeel-code (its data and installed packages stay there).
# VERSION is the last commit that changed Code: aqeelOS serves it, and installed apps update themselves when it differs.
CODE_V=$(git log -1 --format=%H -- code | cut -c1-12)
tar --force-local -czf $LC --exclude=code/data --exclude=code/node_modules --exclude=code/desktop/node_modules --exclude=code/desktop/dist --exclude=code/scratch code
# each deploy sends its own copies, and only one deploy unpacks and restarts at a time (several sessions deploy from here)
HT=/tmp/hui-$ID.tgz;CT=/tmp/code-$ID.tgz
for a in $LH $LC; do [ -s "$a" ] && tar --force-local -tzf "$a" >/dev/null 2>&1 || { echo "✗ the archive $a is empty or broken; nothing was sent."; rm -f $LH $LC; exit 1; }; done
if [ "$DRY" = 1 ]; then echo "✓ dry run: packed$PACK ($(tar -tzf $LH | wc -l) files) + code ($(tar -tzf $LC | wc -l) files), CODE_V=$CODE_V; nothing sent."; rm -f $LH $LC; exit 0; fi
HS=$(wc -c < $LH | tr -d ' ');CS=$(wc -c < $LC | tr -d ' ')
scp -q $LH ai-vps:$HT && scp -q $LC ai-vps:$CT && rm $LH $LC || { echo '✗ could not send the files to the box; nothing changed.'; rm -f $LH $LC; exit 1; }
ssh ai-vps "CODE_V=$CODE_V FORCE=${FORCE:-0} HT=$HT CT=$CT HS=$HS CS=$CS SHA=$SHA BOX_SHA=$BOX_SHA bash -s" <<'BOX'
set -e
# the files arrived whole: same size as sent, and readable
for x in "$HT:$HS" "$CT:$CS"; do f=${x%%:*};z=${x##*:};[ "$(wc -c < "$f" 2>/dev/null)" = "$z" ] && tar -tzf "$f" >/dev/null 2>&1 || { echo "✗ $f did not arrive whole; nothing changed."; rm -f $HT $CT; exit 1; }; done
L=/tmp/aq-live.lock;got=0
for i in $(seq 1 90); do mkdir $L 2>/dev/null && { got=1; break; }
 [ -n "$(find $L -maxdepth 0 -mmin +20 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another deploy is going live; waiting for it…"; sleep 10; done
[ "${got:-0}" = 1 ] || { echo "✗ another deploy kept going for 15 minutes; nothing changed."; rm -f $HT $CT; exit 1; }
trap 'rmdir /tmp/aq-live.lock 2>/dev/null' EXIT
# another deploy went live while this one was checked and sent: it may hold work this one lacks
NOW_SHA=$(cat ~/apps/hermes-ui/.deployed-commit 2>/dev/null || true)
if [ "$NOW_SHA" != "$BOX_SHA" ] && [ "$NOW_SHA" != "$SHA" ]; then echo "✗ another deploy (${NOW_SHA:0:8}) went live meanwhile; nothing changed. Merge it in and deploy again."; rm -f $HT $CT; exit 1; fi
# a reply may have started while the files were on their way: wait again right before the restart (up to 5 minutes)
for i in $(seq 1 60); do n=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"busy":[0-9]*' | cut -d: -f2); [ "${n:-0}" = 0 ] && break; [ "$i" = 1 ] && echo "a reply started meanwhile; waiting for it…"; sleep 5; done
n=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"busy":[0-9]*' | cut -d: -f2); if [ "${n:-0}" != 0 ] && [ "${FORCE:-0}" != 1 ]; then echo "✗ still busy; nothing changed on the box. Try again later, or FORCE=1."; rm -f $HT $CT; exit 1; fi
mkdir -p ~/apps/hermes-ui; tar -xzf $HT -C ~/apps/hermes-ui || { echo '✗ unpacking aqeelOS failed; it was not restarted.'; exit 1; }; rm $HT; echo "$SHA" > ~/apps/hermes-ui/.deployed-commit
C=~/apps/aqeel-code; mkdir -p $C; before=$(md5sum $C/package-lock.json 2>/dev/null)
tar -xzf $CT -C $C --strip-components=1 || { echo "✗ unpacking Code failed; aqeelOS was not restarted."; exit 1; }; rm $CT; echo "$CODE_V" > $C/VERSION
[ "$before" = "$(md5sum $C/package-lock.json 2>/dev/null)" ] || (cd $C && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "! Code packages: npm install failed")
tmux kill-session -t ui 2>/dev/null || true
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
~/services.sh; for i in $(seq 1 20); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done; [ -n "$h" ] && echo "$h · UI restarted" || { echo "✗ the UI did not answer within 20 s"; exit 1; }
BOX

# the update history on /backlog: recorded once the new version answers (it travels with the next deploy)
node -e "const fs=require('fs'),f='data/deploys.json';let l=[];try{l=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}let h='';try{h=require('child_process').execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim()}catch{}l.push({at:new Date().toISOString(),commit:h});fs.mkdirSync('data',{recursive:true});fs.writeFileSync(f,JSON.stringify(l.slice(-200),null,1))"
