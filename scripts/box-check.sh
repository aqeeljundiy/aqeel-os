#!/bin/bash
# Runs ON THE BOX: the checks the new version must pass before it goes live (see predeploy.sh).
# deploy.sh / predeploy.sh send it with ssh (bash -s), and box-deploy.sh runs it from the commit being deployed. Env: MB (1 = run the My browser check), TGZ (the packed version)
# Light by default (12 Nov 2026: both servers were CPU-bound and a deploy's browser checks ran on the same box as the agents):
#   what runs at a deploy: every script parses, no browser script clashes (check-globals), and the engine update check (engine-sim.sh).
#   Not at a deploy any more: the test copy (port 4402) and the four browser checks (pages, fast switching, buttons and tabs, My browser).
#   FULL_CHECK=1        runs them at the deploy too, as before (for a person who wants them before going live).
#   BROWSER_ONLY=1     runs only those four, on the test copy; app/browser-checks.mjs does that once a night in the maintenance window
#                      and reports a failure on Health, it never undoes a deploy.
# The auto-undo after a failed live test (box-live.sh) is not part of this script and is unchanged.
set -e
FULL=${FULL_CHECK:-0}; BO=${BROWSER_ONLY:-0}; HEAVY=0; { [ "$FULL" = 1 ] || [ "$BO" = 1 ]; } && HEAVY=1
L=/tmp/aq-check.lock;got=0
for i in $(seq 1 180); do mkdir $L 2>/dev/null && { got=1; break; }
 # a lock left by a run that died more than 90 minutes ago is stale (one run, every check tried twice at its limit, takes up to ~75)
 [ -n "$(find $L -maxdepth 0 -mmin +90 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· another check is using the test copy; waiting for it…"; sleep 10; done
[ "${got:-0}" = 1 ] || { echo "✗ the test copy stayed busy for 30 minutes"; exit 1; }
# H9 (audit of 12 Nov 2026): the test copy's folder was 775 and its password, settings and copy of the data 664: every
# agent's user could read the password and sign in to the copy as the owner. Everything here is made for this user only
# (umask 077, folders 700), a folder that is a link or someone else's is refused, and the copy listens on 127.0.0.1 only.
umask 077
aq_private(){ local d=$1; [ -L "$d" ] && { echo "✗ $d is a link; refusing to use it"; return 1; }; mkdir -p "$d" 2>/dev/null; [ -d "$d" ] && [ -O "$d" ] && [ ! -L "$d" ] || { echo "✗ $d is not this user's own folder; refusing to use it"; return 1; }; chmod 700 "$d"; }
D=/tmp/ppl
# the copy is stopped and its password and data removed when the check ends, however it ends (it used to stay up on 4402
# with the live engine's keys and a copy of the data)
aq_copy_down(){ [ "$HEAVY" = 1 ] || return 0; [ -f $D/pid ] && kill "$(cat $D/pid 2>/dev/null)" 2>/dev/null; rm -rf $D/pid $D/data $D/env $D/pw; return 0; }
trap 'aq_copy_down; rmdir /tmp/aq-check.lock 2>/dev/null' EXIT
rm -rf /tmp/aq-stage && aq_private /tmp/aq-stage && tar -xzf $TGZ -C /tmp/aq-stage && rm $TGZ
if [ "$HEAVY" != 1 ]; then cd /tmp/aq-stage; echo "· light checks (FULL_CHECK=1 adds the test copy and the browser checks)"
 echo "· 1/2 every script parses, no browser script clashes"
 for f in app/*.js app/*.mjs; do node --check "$f" || { echo "✗ $f does not parse"; exit 1; }; done
 node scripts/check-globals.mjs || { echo "✗ browser scripts clash (see above)"; exit 1; }
else
# the test copy's own data and password (made again if the box restarted and /tmp was emptied)
aq_private $D; chmod -R go-rwx $D 2>/dev/null || true
if [ ! -f $D/env ]; then rm -rf $D/data; cp -a ~/apps/hermes-ui-data $D/data; chmod -R go-rwx $D/data
 # the test copy signs in with its own password: on an install whose owner set one in the app, that one would win and every check would be signed out
 node -e "const fs=require('fs'),f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,'utf8'));delete d.ownerPw;fs.writeFileSync(f,JSON.stringify(d,null,1))" $D/data/users.json 2>/dev/null || true
 PW=$(head -c 12 /dev/urandom | base64 | tr -d "/+="); echo "$PW" > $D/pw
 printf "UI_PASSWORD_HASH=%s\nUI_INSECURE_COOKIE=1\nUI_DATA_DIR=%s\nUI_PORT=4402\nUI_HOST=127.0.0.1\nAQEELOS_LIVE=0\n" "$(node /tmp/aq-stage/app/server.mjs hash "$PW")" "$D/data" > $D/env; fi
grep -q "^AQEELOS_LIVE=" $D/env || echo "AQEELOS_LIVE=0" >> $D/env   # a test copy never runs the live jobs
[ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null || true; sleep 1
cd ~; SCHED_DESCRIBE=1 setsid nohup node --env-file=$HOME/.hermes/.env --env-file=$D/env /tmp/aq-stage/app/server.mjs > $D/log 2>&1 < /dev/null & echo $! > $D/pid
for i in $(seq 1 30); do curl -fs 127.0.0.1:4402/healthz >/dev/null && break; sleep 1; done
curl -fs 127.0.0.1:4402/healthz >/dev/null || { echo "✗ the new version did not start:"; tail -5 $D/log; exit 1; }
cd /tmp/aq-stage
fi
# OPS-6 (11 Nov 2026): on 10 Nov deploys failed six times on random misses that passed when run alone (the button check,
# My browser). Every check now gets one more try before it counts, and a check that rests on a model's choices (My
# browser: whether the test agent picks the right tool) reports but never stops a deploy.
again(){ echo "  · $1 missed once; trying again ($(printf '%s' "$2" | tr '\n' ' ' | cut -c1-200))"; }
# 5/5 the engine update check (ENG-3, scripts/engine-sim.sh) needs no test copy: it runs alongside the others, under /tmp
ES=/tmp/aq-engsim-$$.out; [ "$BO" = 1 ] || { nice -n 10 bash scripts/engine-sim.sh /tmp/aq-stage > $ES 2>&1 & ESP=$!; }
if [ "$HEAVY" = 1 ]; then
echo "· 1/5 pages"
pages(){ BASE=http://127.0.0.1:4402 PWFILE=$D/pw OUT=/tmp/aud-check timeout 400 node scripts/pages-check.mjs 2>&1 | tail -1; }
r=$(pages); echo "$r" | grep -q '"errors":\[\]' || { again pages "$r"; r=$(pages); }
echo "$r" | grep -q '"errors":\[\]' || { echo "✗ a page did not load: $r" | cut -c1-600; exit 1; }
# FLICKER_CHECK=0 skips only this check; every other check still runs. Not needed any more (12 Nov 2026): the sweep used to judge every page 2.5 s after
# opening it, so a loaded server failed it at random; it now waits until the page has settled, and a slow page is named (slowPages), not failed.
# When it fails, a page flickers (it says which, what and when) or never finished loading: fix that, do not skip the check.
if [ "${FLICKER_CHECK:-1}" = 0 ]; then echo "· 2/5 fast page switching: skipped (FLICKER_CHECK=0)"; else
echo "· 2/5 fast page switching and flicker (replays, jumps, pictures loading again, the bell, pop-ups, the shell drawn again, pages that move while they load)"
sweep(){ timeout 720 node scripts/shot.mjs /tmp/sweep.png "#/chat" "" "" 1280 900 "$(cat scripts/sweep.js)" 2>&1 | head -1; }
s=$(sweep); echo "$s" | grep -q '\\"bad\\":0' || { again "fast page switching" "$s"; s=$(sweep); }
echo "$s" | grep -q '\\"bad\\":0' || { echo "✗ fast page switching found problems (twice):"; echo "$s" | cut -c1-900; exit 1; }
# slow is not a flicker, but it is said: the pages that took over 10 s to settle
sp=$(printf '%s' "$s" | grep -o 'slowPages[^]]*' | sed 's/^slowPages[^[]*\[//; s/\\"//g' | cut -c1-400); [ -n "$sp" ] && echo "  · slow to load (named, not failed): $sp"
fi
echo "· 3/5 every page keeps its buttons and tabs (owner and team member, All agents and one agent)"
# 52 page views as the owner and a team member: about 7 minutes on a busy P&P (11 Nov 2026), so 10 minutes was too close; a run
# stopped at its limit prints nothing, and says so instead of an empty miss
controls(){ local o; o=$(CONTROLS_LOCAL=$HOME/apps/hermes-ui-data/controls-seen.json timeout 900 node scripts/controls-check.mjs 2>&1 | tail -1); echo "${o:-it ran out of time (15 minutes) before it finished}"; }
c=$(controls); echo "$c" | grep -qF '"missing":[]' || { again "the button check" "$c"; c=$(controls); }
echo "$c" | grep -qF '"missing":[]' || { echo "✗ a page lost a button or tab (twice): $c" | cut -c1-900; echo "  (on purpose? node scripts/controls-check.mjs --save on the test copy, then commit scripts/controls-baseline.json)"; exit 1; }
if [ "$MB" = 0 ]; then echo "· 4/5 my browser: skipped (MB_CHECK=0)"; else
echo "· 4/5 my browser (reports only: it rests on the test agent's choices)"
m=$(timeout 480 node scripts/mybrowser-check.mjs 2>&1 | tail -1); echo "$m" | grep -q '7/7' || { again "my browser" "$m"; m=$(timeout 480 node scripts/mybrowser-check.mjs 2>&1 | tail -1); }
if echo "$m" | grep -q '7/7'; then echo "  ✓ my browser: $m"; else echo "  ! my browser check missed twice (not counted, it rests on the model): $(echo "$m" | cut -c1-400)"; fi
fi
fi   # HEAVY: the four browser checks
# no run leaves a test copy standing (aq_copy_down, at exit)
[ "$BO" = 1 ] && { echo "✓ browser checks passed"; exit 0; }
echo "· $([ "$HEAVY" = 1 ] && echo 5/5 || echo 2/2) engine update (a clean engine update plus the patch steps gives the live engine)"
er=0; wait $ESP || er=$?
# 2 = the simulation itself could not run (disk, git): one more try, then reported without stopping the deploy
[ "$er" = 2 ] && { again "the engine update check" "$(tail -3 $ES)"; er=0; bash scripts/engine-sim.sh /tmp/aq-stage > $ES 2>&1 || er=$?; }
sed 's/^/  /' $ES; rm -f $ES
[ "$er" = 1 ] && { echo "✗ engine update check: see the files above"; exit 1; }
[ "$er" = 2 ] && echo "  ! the engine update check could not run twice (not counted)"
echo "✓ checks passed"
