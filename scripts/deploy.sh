#!/bin/bash
# Copies the app to the AI box and restarts the UI. Run from the hermes-ui folder: bash scripts/deploy.sh
# Needs the `ai-vps` SSH host (see ~/.ssh/config). Secrets stay on the box in ~/apps/hermes-ui.env.
set -e
cd "$(dirname "$0")/.."
node scripts/check-globals.mjs
for f in app/*.js app/*.mjs; do node --check "$f" || { echo "✗ $f does not parse"; exit 1; }; done
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
# the update history on /backlog: when each deploy went live and which commit it carried
node -e "const fs=require('fs'),f='data/deploys.json';let l=[];try{l=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}let h='';try{h=require('child_process').execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim()}catch{}l.push({at:new Date().toISOString(),commit:h});fs.writeFileSync(f,JSON.stringify(l.slice(-200),null,1))"
node scripts/features.mjs >/dev/null
tar --force-local -czf ../hui.tgz app assets backlog data extension mockup scripts PRD.md
scp -q ../hui.tgz ai-vps:/tmp/hui.tgz && rm ../hui.tgz
ssh ai-vps 'bash -s' <<'BOX'
set -e
mkdir -p ~/apps/hermes-ui && tar -xzf /tmp/hui.tgz -C ~/apps/hermes-ui && rm /tmp/hui.tgz
tmux kill-session -t ui 2>/dev/null || true
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
~/services.sh; sleep 2; curl -fs http://127.0.0.1:4400/healthz && echo " · UI restarted"
BOX
