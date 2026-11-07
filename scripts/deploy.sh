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
# 7 Nov 2026: when this commit is on GitHub, the box fetches and packs it itself (scripts/box-pack.sh): nothing large goes
# through this Mac's connection. A commit that is not pushed yet is sent from here as before. BOX_PULL=0 always sends.
PULL=0; if [ "${BOX_PULL:-1}" != 0 ] && [ "$DRY" != 1 ] && git fetch -q origin 2>/dev/null && git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then PULL=1; echo "· the box fetches ${SHA:0:8} from GitHub itself"; fi
export PULL SHA
# A pushed commit (PULL=1) is deployed by the box itself, detached (scripts/box-deploy.sh): this Mac starts it and reads
# its log, reconnecting when the connection drops, so a VPN drop no longer stops a deploy halfway (7 Nov 2026).
if [ "$PULL" = 1 ] && [ "${SKIP_CHECKS:-0}" != 1 ]; then
 last=$(node -e "try{const l=require('./data/deploys.json');console.log(l[l.length-1].commit||'')}catch{}")
 MB=1;if [ -n "$last" ] && ! git diff --name-only "$last" HEAD -- app/localbrowser.mjs app/screen.js app/chat.js extension scripts/mybrowser-check.mjs 2>/dev/null | grep -q .; then MB=0;fi
 ID=$(date +%s)-$$
 ssh ai-vps "cat > /tmp/aq-deploy-$ID.sh" < scripts/box-deploy.sh && ssh ai-vps "cat > /tmp/box-pack-$ID.sh" < scripts/box-pack.sh || { echo "✗ could not reach the box; nothing changed."; exit 1; }
 ssh ai-vps "setsid nohup bash /tmp/aq-deploy-$ID.sh $SHA ${BOX_SHA:-none} ${FORCE:-0} $MB $ID </dev/null >/dev/null 2>&1 &" || { echo "✗ could not start the deploy on the box; nothing changed."; exit 1; }
 echo "· running on the box (log /tmp/aq-deploy-$ID.log)"
 n=0; end=$(( $(date +%s) + 3600 ))
 while [ "$(date +%s)" -lt "$end" ]; do
  out=$(ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 ai-vps "tail -n +$((n+1)) /tmp/aq-deploy-$ID.log 2>/dev/null" 2>/dev/null) || { sleep 10; continue; }
  if [ -n "$out" ]; then printf '%s\n' "$out" | grep -v '^AQ-DEPLOY '; n=$((n + $(printf '%s\n' "$out" | wc -l))); fi
  if printf '%s' "$out" | grep -q '^AQ-DEPLOY DONE'; then
   node -e "const fs=require('fs'),f='data/deploys.json';let l=[];try{l=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}l.push({at:new Date().toISOString(),commit:process.argv[1]});fs.mkdirSync('data',{recursive:true});fs.writeFileSync(f,JSON.stringify(l.slice(-200),null,1))" "$(git rev-parse --short HEAD)"
   exit 0; fi
  printf '%s' "$out" | grep -q '^AQ-DEPLOY FAILED' && exit 1
  sleep 10
 done
 echo "✗ no end after 60 minutes; see /tmp/aq-deploy-$ID.log on the box"; exit 1
fi
# the new version must pass the checks on the private test copy first (about 5 minutes; SKIP_CHECKS=1 skips them)
[ "${SKIP_CHECKS:-0}" = 1 ] || [ "$DRY" = 1 ] || bash scripts/predeploy.sh
# 1) Never cut off work in progress (a reply, an agent being set up, a settings change, an engine restart):
#    wait until the box is idle. After 10 minutes the deploy is cancelled, with nothing changed on the box
#    (FORCE=1 bash scripts/deploy.sh deploys anyway).
[ "$DRY" = 1 ] || ssh ai-vps "FORCE=${FORCE:-0} bash -s" < scripts/box-idle.sh
# 2) Only now pack the files, so what goes live is what is here at this moment (not what was here before the wait).
if [ -f scripts/features.mjs ]; then node scripts/features.mjs >/dev/null; fi
ID=$(date +%s)-$$;LH=../hui-$ID.tgz;LC=../code-$ID.tgz
PACK=""; for p in app assets backlog data engine extension mockup scripts code-installer PRD.md; do
 if [ -e "$p" ]; then PACK="$PACK $p"; else case $p in app|scripts|engine) echo "✗ $p is missing; nothing was sent."; exit 1;; *) echo "· $p not here; skipped (optional)";; esac; fi; done
if [ "$PULL" != 1 ]; then
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
else
 ID=$(date +%s)-$$;HT=/tmp/hui-$ID.tgz;CT=/tmp/code-$ID.tgz
 r=$(ssh ai-vps "bash -s -- $SHA $HT $CT" < scripts/box-pack.sh) || { echo "✗ the box could not pack ${SHA:0:8}; nothing changed."; exit 1; }
 read CODE_V HS CS <<< "$r"; echo "· packed on the box ($HS + $CS bytes)"
fi
ssh ai-vps "CODE_V=$CODE_V FORCE=${FORCE:-0} HT=$HT CT=$CT HS=$HS CS=$CS SHA=$SHA BOX_SHA=$BOX_SHA bash -s" < scripts/box-live.sh

# the update history on /backlog: recorded once the new version answers (it travels with the next deploy)
node -e "const fs=require('fs'),f='data/deploys.json';let l=[];try{l=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}let h='';try{h=require('child_process').execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim()}catch{}l.push({at:new Date().toISOString(),commit:h});fs.mkdirSync('data',{recursive:true});fs.writeFileSync(f,JSON.stringify(l.slice(-200),null,1))"
