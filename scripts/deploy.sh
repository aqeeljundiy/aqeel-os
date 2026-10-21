#!/bin/bash
# Copies the app to the AI box and restarts the UI. Run from the hermes-ui folder: bash scripts/deploy.sh
# Needs the `ai-vps` SSH host (see ~/.ssh/config). Secrets stay on the box in ~/apps/hermes-ui.env.
set -e
cd "$(dirname "$0")/.."
node scripts/check-globals.mjs
for f in app/*.js app/*.mjs; do node --check "$f" || { echo "✗ $f does not parse"; exit 1; }; done
# the new version must pass the checks on the private test copy first (about 5 minutes; SKIP_CHECKS=1 skips them)
[ "${SKIP_CHECKS:-0}" = 1 ] || bash scripts/predeploy.sh
# 1) Never cut off work in progress (a reply, an agent being set up, a settings change, an engine restart):
#    wait until the box is idle. After 10 minutes the deploy is cancelled, with nothing changed on the box
#    (FORCE=1 bash scripts/deploy.sh deploys anyway).
ssh ai-vps "FORCE=${FORCE:-0} bash -s" <<'BOX'
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
node scripts/features.mjs >/dev/null
tar --force-local -czf ../hui.tgz app assets backlog data engine extension mockup scripts code-installer PRD.md
# Code (code/ here) goes to the box's own Code copy, ~/apps/aqeel-code (its data and installed packages stay there).
# VERSION is the last commit that changed Code: aqeelOS serves it, and installed apps update themselves when it differs.
CODE_V=$(git log -1 --format=%H -- code | cut -c1-12)
tar --force-local -czf ../code.tgz --exclude=code/data --exclude=code/node_modules --exclude=code/desktop/node_modules --exclude=code/desktop/dist --exclude=code/scratch code
# each deploy sends its own copies, and only one deploy unpacks and restarts at a time (several sessions deploy from here)
ID=$(date +%s)-$$;HT=/tmp/hui-$ID.tgz;CT=/tmp/code-$ID.tgz
scp -q ../hui.tgz ai-vps:$HT && scp -q ../code.tgz ai-vps:$CT && rm ../hui.tgz ../code.tgz
ssh ai-vps "CODE_V=$CODE_V FORCE=${FORCE:-0} HT=$HT CT=$CT bash -s" <<'BOX'
set -e
L=/tmp/aq-live.lock
for i in $(seq 1 90); do mkdir $L 2>/dev/null && break
 [ -n "$(find $L -maxdepth 0 -mmin +20 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another deploy is going live; waiting for it…"; sleep 10; done
[ -d $L ] || { echo "✗ another deploy kept going for 15 minutes; nothing changed."; rm -f $HT $CT; exit 1; }
trap 'rmdir /tmp/aq-live.lock 2>/dev/null' EXIT
# a reply may have started while the files were on their way: wait again right before the restart (up to 5 minutes)
for i in $(seq 1 60); do n=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"busy":[0-9]*' | cut -d: -f2); [ "${n:-0}" = 0 ] && break; [ "$i" = 1 ] && echo "a reply started meanwhile; waiting for it…"; sleep 5; done
n=$(curl -fs http://127.0.0.1:4400/healthz | grep -o '"busy":[0-9]*' | cut -d: -f2); if [ "${n:-0}" != 0 ] && [ "${FORCE:-0}" != 1 ]; then echo "✗ still busy; nothing changed on the box. Try again later, or FORCE=1."; rm -f $HT $CT; exit 1; fi
mkdir -p ~/apps/hermes-ui && tar -xzf $HT -C ~/apps/hermes-ui && rm $HT
C=~/apps/aqeel-code; mkdir -p $C; before=$(md5sum $C/package-lock.json 2>/dev/null)
tar -xzf $CT -C $C --strip-components=1 && rm $CT && echo "$CODE_V" > $C/VERSION
[ "$before" = "$(md5sum $C/package-lock.json 2>/dev/null)" ] || (cd $C && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "! Code packages: npm install failed")
tmux kill-session -t ui 2>/dev/null || true
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
~/services.sh; for i in $(seq 1 20); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done; [ -n "$h" ] && echo "$h · UI restarted" || { echo "✗ the UI did not answer within 20 s"; exit 1; }
BOX

# the update history on /backlog: recorded once the new version answers (it travels with the next deploy)
node -e "const fs=require('fs'),f='data/deploys.json';let l=[];try{l=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}let h='';try{h=require('child_process').execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim()}catch{}l.push({at:new Date().toISOString(),commit:h});fs.writeFileSync(f,JSON.stringify(l.slice(-200),null,1))"
