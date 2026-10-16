#!/bin/bash
# Copies the app to the AI box and restarts the UI. Run from the hermes-ui folder: bash scripts/deploy.sh
# Needs the `ai-vps` SSH host (see ~/.ssh/config). Secrets stay on the box in ~/apps/hermes-ui.env.
set -e
cd "$(dirname "$0")/.."
node scripts/check-globals.mjs
for f in app/*.js app/*.mjs; do node --check "$f" || { echo "✗ $f does not parse"; exit 1; }; done
node scripts/features.mjs >/dev/null
tar --force-local -czf ../hui.tgz app assets backlog data mockup scripts PRD.md
scp -q ../hui.tgz ai-vps:/tmp/hui.tgz && rm ../hui.tgz
ssh ai-vps 'set -e; mkdir -p ~/apps/hermes-ui && tar -xzf /tmp/hui.tgz -C ~/apps/hermes-ui && rm /tmp/hui.tgz
 tmux kill-session -t ui 2>/dev/null || true; node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || true; ~/services.sh; sleep 2; curl -fs http://127.0.0.1:4400/healthz && echo " · UI restarted"'
