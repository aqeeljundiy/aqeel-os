#!/bin/bash
# Runs ON THE BOX: unpacks the checked version, restarts aqeelOS once nothing is in progress, and confirms it answers.
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: CODE_V FORCE HT CT HS CS SHA BOX_SHA
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
tmux kill-session -t "=ui" 2>/dev/null || true   # "=" = exactly ui (a bare -t ui also matches ui-staging)
# the box's ~/services.sh must match sessions exactly too (has-session -t "=$1"), or ui-staging keeps ui from starting (7 Nov 2026)
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
~/services.sh; for i in $(seq 1 20); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done; [ -n "$h" ] && echo "$h · UI restarted" || { echo "✗ the UI did not answer within 20 s"; exit 1; }
