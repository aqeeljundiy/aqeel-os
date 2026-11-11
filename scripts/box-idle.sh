#!/bin/bash
# Runs ON THE BOX before a deploy or update goes live.
# Since 12 Nov 2026 (owner) it no longer waits for replies and runs to finish: with this many schedules the box is never
# idle, and what the restart cuts off is continued afterwards (app/resume.mjs). It still waits (10 minutes at most) for
# what cannot be continued: an agent being set up, a settings change, an engine restart or update, a restore ("hold" in
# /healthz). WAIT_IDLE=1 brings the old rule back: wait until nothing at all is in progress.
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: FORCE, WAIT_IDLE
num(){ echo "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d: -f2; }
for i in $(seq 1 120); do
 h=$(curl -fs http://127.0.0.1:4400/healthz || true)
 busy=$(num "$h" busy); live=$(num "$h" live); [ -z "$busy" ] && busy=$live
 if [ "${WAIT_IDLE:-0}" = 1 ]; then n=${busy:-0}
 else n=$(num "$h" hold); [ -z "$n" ] && n=$(( ${busy:-0} - ${live:-0} )); [ "$n" -lt 0 ] && n=0   # a version before "hold": busy without the replies
  [ "$i" = 1 ] && [ "${live:-0}" != 0 ] && echo "· ${live} reply(ies) in progress: not waited for, they continue by themselves after the restart"; fi
 [ "${n:-0}" = 0 ] && exit 0
 [ "$i" = 1 ] && echo "waiting for $n thing(s) in progress to finish…"
 if [ "$i" = 120 ] && [ "$FORCE" != 1 ]; then echo "✗ still busy after 10 minutes; nothing changed. Try again later, or FORCE=1."; exit 1; fi
 sleep 5
done
