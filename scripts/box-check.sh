#!/bin/bash
# Runs ON THE BOX: the new version starts as the private test copy (port 4402) and must pass the checks (see predeploy.sh).
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: MB (1 = run the My browser check), TGZ (the packed version)
set -e
L=/tmp/aq-check.lock;got=0
for i in $(seq 1 180); do mkdir $L 2>/dev/null && { got=1; break; }
 # a lock left by a run that died more than 40 minutes ago is stale
 [ -n "$(find $L -maxdepth 0 -mmin +40 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another check is using the test copy; waiting for it…"; sleep 10; done
[ "${got:-0}" = 1 ] || { echo "✗ the test copy stayed busy for 30 minutes"; exit 1; }
trap 'rmdir /tmp/aq-check.lock 2>/dev/null' EXIT
rm -rf /tmp/aq-stage && mkdir -p /tmp/aq-stage && tar -xzf $TGZ -C /tmp/aq-stage && rm $TGZ
D=/tmp/ppl
# the test copy's own data and password (made again if the box restarted and /tmp was emptied)
if [ ! -f $D/env ]; then mkdir -p $D; rm -rf $D/data; cp -a ~/apps/hermes-ui-data $D/data
 # the test copy signs in with its own password: on an install whose owner set one in the app, that one would win and every check would be signed out
 node -e "const fs=require('fs'),f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,'utf8'));delete d.ownerPw;fs.writeFileSync(f,JSON.stringify(d,null,1))" $D/data/users.json 2>/dev/null || true
 PW=$(head -c 12 /dev/urandom | base64 | tr -d "/+="); echo "$PW" > $D/pw
 printf "UI_PASSWORD_HASH=%s\nUI_INSECURE_COOKIE=1\nUI_DATA_DIR=%s\nUI_PORT=4402\nAQEELOS_LIVE=0\n" "$(node /tmp/aq-stage/app/server.mjs hash "$PW")" "$D/data" > $D/env; fi
grep -q "^AQEELOS_LIVE=" $D/env || echo "AQEELOS_LIVE=0" >> $D/env   # a test copy never runs the live jobs
[ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null || true; sleep 1
cd ~; SCHED_DESCRIBE=1 setsid nohup node --env-file=$HOME/.hermes/.env --env-file=$D/env /tmp/aq-stage/app/server.mjs > $D/log 2>&1 < /dev/null & echo $! > $D/pid
for i in $(seq 1 30); do curl -fs 127.0.0.1:4402/healthz >/dev/null && break; sleep 1; done
curl -fs 127.0.0.1:4402/healthz >/dev/null || { echo "✗ the new version did not start:"; tail -5 $D/log; exit 1; }
cd /tmp/aq-stage
echo "· 1/4 pages"
r=$(BASE=http://127.0.0.1:4402 PWFILE=$D/pw OUT=/tmp/aud-check timeout 400 node scripts/pages-check.mjs 2>&1 | tail -1)
echo "$r" | grep -q '"errors":\[\]' || { echo "✗ a page did not load: $r" | cut -c1-600; exit 1; }
echo "· 2/4 fast page switching and flicker (replays, jumps, pictures loading again, the bell, pop-ups)"
s=$(timeout 420 node scripts/shot.mjs /tmp/sweep.png "#/chat" "" "" 1280 900 "$(cat scripts/sweep.js)" 2>&1 | head -1)
echo "$s" | grep -q '\\"bad\\":0' || { echo "✗ fast page switching found problems:"; echo "$s" | cut -c1-900; exit 1; }
echo "· 3/4 every page keeps its buttons and tabs (owner and team member, All agents and one agent)"
c=$(CONTROLS_LOCAL=$HOME/apps/hermes-ui-data/controls-seen.json timeout 600 node scripts/controls-check.mjs 2>&1 | tail -1)
echo "$c" | grep -qF '"missing":[]' || { echo "✗ a page lost a button or tab: $c" | cut -c1-900; echo "  (on purpose? node scripts/controls-check.mjs --save on the test copy, then commit scripts/controls-baseline.json)"; exit 1; }
[ "$MB" = 0 ] && { echo "✓ checks passed (My browser unchanged, its check skipped)"; exit 0; }
echo "· 4/4 my browser"
m=$(timeout 480 node scripts/mybrowser-check.mjs 2>&1 | tail -1); echo "$m" | grep -q '7/7' || m=$(timeout 480 node scripts/mybrowser-check.mjs 2>&1 | tail -1)
echo "$m" | grep -q '7/7' || { echo "✗ my browser check: $m"; exit 1; }
echo "✓ checks passed"
