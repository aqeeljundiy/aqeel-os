#!/bin/bash
# Runs ON THE BOX: unpacks the checked version, restarts aqeelOS once nothing is in progress, and confirms it answers.
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: CODE_V FORCE HT CT HS CS SHA BOX_SHA DC (the commits list)
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
 if [ -s "$P" ]; then mkdir -p "$D/drift"; local O; O="$D/drift/$(date -u +%Y%m%d-%H%M%S).patch"
  { echo "# Changed on the live box after deploy ${BOX_SHA:0:8}, found by the deploy of ${SHA:0:8} at $(date -u '+%F %T') UTC, before it unpacked."
    echo "# The deploy put the files from git back. If this is a fix, take it into git (git apply -p0 in the repo), or it stays lost."; echo; cat "$P"; } > "$O"; chmod 600 "$O"
  echo "! drift: the box had changes git does not have. Saved as ${O#$D/} (System › Health lists it):"; grep -E '^(\+\+\+|Only in) ' "$P" | sed 's/^+++ /  changed: /;s/\t.*//' | head -40
  head -c 20000 "$P"; [ "$(wc -c < "$P")" -gt 20000 ] && echo "… (the rest is in the file)"
 else echo "· drift check: the box ran exactly ${BOX_SHA:0:8}"; fi
 rm -f "$P"; }
aq_drift || echo "! drift check: it could not run (the deploy goes on)"
mkdir -p ~/apps/hermes-ui; tar -xzf $HT -C ~/apps/hermes-ui || { echo '✗ unpacking aqeelOS failed; it was not restarted.'; exit 1; }; cp $HT ~/apps/hermes-ui/.deployed.tgz.new && mv ~/apps/hermes-ui/.deployed.tgz.new ~/apps/hermes-ui/.deployed.tgz; rm $HT; echo "$SHA" > ~/apps/hermes-ui/.deployed-commit; [ -n "$DC" ] && [ -s "$DC" ] && mv "$DC" ~/apps/hermes-ui/.deployed-commits
C=~/apps/aqeel-code; mkdir -p $C; before=$(md5sum $C/package-lock.json 2>/dev/null)
tar -xzf $CT -C $C --strip-components=1 || { echo "✗ unpacking Code failed; aqeelOS was not restarted."; exit 1; }; rm $CT; echo "$CODE_V" > $C/VERSION
[ "$before" = "$(md5sum $C/package-lock.json 2>/dev/null)" ] || (cd $C && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "! Code packages: npm install failed")
tmux kill-session -t "=ui" 2>/dev/null || true   # "=" = exactly ui (a bare -t ui also matches ui-staging)
# the box's ~/services.sh must match sessions exactly too (has-session -t "=$1"), or ui-staging keeps ui from starting (7 Nov 2026)
node ~/apps/hermes-ui/scripts/apply-skill-patches.mjs || echo "! skill patches: see the message above"
~/services.sh; for i in $(seq 1 20); do sleep 1; h=$(curl -fs http://127.0.0.1:4400/healthz) && break; done; [ -n "$h" ] && echo "$h · UI restarted" || { echo "✗ the UI did not answer within 20 s"; exit 1; }
