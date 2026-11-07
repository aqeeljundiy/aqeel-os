#!/bin/bash
# Starts online Code in its own container (see online-gate.mjs). The container holds only the online projects
# (/root/code-projects), Code itself (/root/app, kept up to date from aqeelOS) and the coding tools' own sign-ins.
# Env: AQ_BASE (aqeelOS inside the server's network), CODE_KEY (this copy's aqeelOS key), CODE_GATE_SECRET, and this
# install's addresses: AQEELOS_PUBLIC (https://ai.example.com), CODE_HOST (code.example.com), CODE_PREVIEW_HOST
# (code-preview.example.com). They can also live in /root/app/data/online.env (KEY=value lines), which updates keep.
set -u
export HOME=/root PATH=/usr/local/bin:/usr/bin:/bin
command -v chromium >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium git curl unzip ca-certificates >/dev/null; }
command -v claude >/dev/null || npm i -g --silent @anthropic-ai/claude-code >/dev/null 2>&1
command -v codex >/dev/null || npm i -g --silent @openai/codex >/dev/null 2>&1
cd /root/app
[ -f data/online.env ] && { set -a; . data/online.env; set +a; }
for v in AQEELOS_PUBLIC CODE_HOST CODE_PREVIEW_HOST; do [ -n "${!v:-}" ] || { echo "online Code: $v is not set (see the top of online-start.sh)" >&2; exit 1; }; done
export AQEELOS_PUBLIC CODE_HOST CODE_PREVIEW_HOST
# this copy's link to aqeelOS (it polls for agents' jobs and updates itself through it)
mkdir -p data /root/code-projects
[ -f data/aqeelos.json ] || printf '{"base":"%s","token":"%s","user":"Owner"}' "$AQ_BASE" "$CODE_KEY" > data/aqeelos.json
[ -d node_modules ] || npm install --silent --no-audit --no-fund >/dev/null 2>&1
( while true; do node online-gate.mjs; sleep 3; done ) &
while true; do
 # a clean environment: the coding AIs only get what they need
 env -i HOME=/root PATH=$PATH LANG=C.UTF-8 HUB_PORT=4321 CBA_ONLINE=1 CBA_BROWSER=/usr/bin/chromium \
  CBA_PUBLIC_APP=https://$CODE_HOST CBA_PUBLIC_PREVIEW=https://$CODE_PREVIEW_HOST AQEELOS_ORIGINS=$AQEELOS_PUBLIC \
  node --max-old-space-size=2048 server.mjs
 sleep 3
done
