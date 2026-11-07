#!/bin/bash
# Runs ON THE BOX: waits until no reply, agent setup or engine restart is in progress (10 minutes at most).
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: FORCE
for i in $(seq 1 120); do
 h=$(curl -fs http://127.0.0.1:4400/healthz || true)
 n=$(echo "$h" | grep -o '"busy":[0-9]*' | cut -d: -f2); [ -z "$n" ] && n=$(echo "$h" | grep -o '"live":[0-9]*' | cut -d: -f2)
 [ "${n:-0}" = 0 ] && exit 0
 [ "$i" = 1 ] && echo "waiting for $n thing(s) in progress to finish…"
 if [ "$i" = 120 ] && [ "$FORCE" != 1 ]; then echo "✗ still busy after 10 minutes; nothing changed. Try again later, or FORCE=1."; exit 1; fi
 sleep 5
done
