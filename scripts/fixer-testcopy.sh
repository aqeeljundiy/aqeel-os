#!/bin/bash
# Runs ON THE BOX, for the fixer (GIT-2, 12 Nov 2026): starts the fixer's own git work dir as the private test copy on port
# 4402, the same way a deploy's check does (scripts/box-check.sh), so a fix is proven on the test copy before it becomes a
# pull request. The test copy has its own password and a copy of the data, and AQEELOS_LIVE=0 (it never runs live jobs).
#   bash scripts/fixer-testcopy.sh <work dir>     prints the test copy's address and where its password is
# It waits for the lock a deploy check uses, so the two never fight over port 4402, and keeps it only while it starts.
set -e
W=${1:?usage: fixer-testcopy.sh <work dir>}
[ -f "$W/app/server.mjs" ] || { echo "✗ $W is not an aqeelOS checkout"; exit 1; }
L=/tmp/aq-check.lock; got=0
for i in $(seq 1 60); do mkdir $L 2>/dev/null && { got=1; break; }
 [ -n "$(find $L -maxdepth 0 -mmin +90 2>/dev/null)" ] && { rmdir $L 2>/dev/null; continue; }
 [ "$i" = 1 ] && echo "· a deploy check is using the test copy; waiting for it…"; sleep 10; done
[ "$got" = 1 ] || { echo "✗ the test copy stayed busy for 10 minutes"; exit 1; }
trap 'rmdir /tmp/aq-check.lock 2>/dev/null' EXIT
# H9 (audit of 12 Nov 2026): the test copy's folder was 775 and its password, settings and copy of the data 664: every
# agent's user could read the password and sign in to the copy as the owner. Everything here is made for this user only
# (umask 077, folders 700), a folder that is a link or someone else's is refused, and the copy listens on 127.0.0.1 only.
umask 077
aq_private(){ local d=$1; [ -L "$d" ] && { echo "✗ $d is a link; refusing to use it"; return 1; }; mkdir -p "$d" 2>/dev/null; [ -d "$d" ] && [ -O "$d" ] && [ ! -L "$d" ] || { echo "✗ $d is not this user's own folder; refusing to use it"; return 1; }; chmod 700 "$d"; }
rm -rf /tmp/aq-stage && aq_private /tmp/aq-stage
for p in app assets backlog engine extension scripts code-installer; do [ -e "$W/$p" ] && cp -a "$W/$p" /tmp/aq-stage/; done
D=/tmp/ppl
aq_private $D; chmod -R go-rwx $D 2>/dev/null || true
if [ ! -f $D/env ]; then rm -rf $D/data; cp -a ~/apps/hermes-ui-data $D/data; chmod -R go-rwx $D/data
 node -e "const fs=require('fs'),f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,'utf8'));delete d.ownerPw;fs.writeFileSync(f,JSON.stringify(d,null,1))" $D/data/users.json 2>/dev/null || true
 PW=$(head -c 12 /dev/urandom | base64 | tr -d "/+="); echo "$PW" > $D/pw
 printf "UI_PASSWORD_HASH=%s\nUI_INSECURE_COOKIE=1\nUI_DATA_DIR=%s\nUI_PORT=4402\nUI_HOST=127.0.0.1\nAQEELOS_LIVE=0\n" "$(node /tmp/aq-stage/app/server.mjs hash "$PW")" "$D/data" > $D/env; fi
grep -q "^AQEELOS_LIVE=" $D/env || echo "AQEELOS_LIVE=0" >> $D/env
grep -q "^UI_HOST=" $D/env || echo "UI_HOST=127.0.0.1" >> $D/env
[ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null || true; sleep 1
cd ~; SCHED_DESCRIBE=1 setsid nohup node --env-file=$HOME/.hermes/.env --env-file=$D/env /tmp/aq-stage/app/server.mjs > $D/log 2>&1 < /dev/null & echo $! > $D/pid
for i in $(seq 1 30); do curl -fs 127.0.0.1:4402/healthz >/dev/null && break; sleep 1; done
curl -fs 127.0.0.1:4402/healthz >/dev/null || { echo "✗ the test copy did not start:"; tail -5 $D/log; exit 1; }
echo "✓ the test copy of $W answers on http://127.0.0.1:4402 (password in $D/pw; scripts/ask-agent.mjs and scripts/actions-check.mjs use it; tests: node --test scripts/<name>.test.mjs in $W)"
