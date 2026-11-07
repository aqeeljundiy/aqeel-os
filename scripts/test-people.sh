#!/bin/bash
# Private test copy of aqeelOS for People checks: port 4402, own password and own copy of the data.
# Usage on the box: bash test-people.sh [fresh]   (fresh = new data copy and password)
D=/tmp/ppl; mkdir -p $D
[ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null; sleep 1
if [ "$1" = fresh ] || [ ! -f $D/env ]; then
 rm -rf $D/data; cp -a ~/apps/hermes-ui-data $D/data
 PW=$(head -c 12 /dev/urandom | base64 | tr -d "/+="); echo "$PW" > $D/pw
 printf "UI_PASSWORD_HASH=%s\nUI_INSECURE_COOKIE=1\nUI_DATA_DIR=%s\nUI_PORT=4402\nAQEELOS_LIVE=0\n" "$(node ~/apps/hermes-ui/app/server.mjs hash "$PW")" "$D/data" > $D/env
fi
grep -q "^AQEELOS_LIVE=" $D/env || echo "AQEELOS_LIVE=0" >> $D/env   # a test copy never runs the live jobs
nohup node --env-file="$HOME/.hermes/.env" --env-file=$D/env "$HOME/apps/hermes-ui/app/server.mjs" > $D/log 2>&1 &
echo $! > $D/pid; sleep 2; tail -1 $D/log
