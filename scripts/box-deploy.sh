#!/bin/bash
# Runs ON THE BOX, detached (setsid nohup), for a commit that is on GitHub (7 Nov 2026). deploy.sh starts it and only reads
# its log, so a dropped connection from the Mac (VPN) no longer kills a deploy halfway through the checks.
#   box-deploy.sh <commit> <box commit at start> <FORCE 0|1> <MB 0|1> <id>
# Log: /tmp/aq-deploy-<id>.log. Its last line is "AQ-DEPLOY DONE" or "AQ-DEPLOY FAILED <step>".
SHA=$1; BOX_SHA=$2; FORCE=${3:-0}; MB=${4:-1}; ID=$5; [ "$BOX_SHA" = none ] && BOX_SHA=""
LOG=/tmp/aq-deploy-$ID.log; exec >>"$LOG" 2>&1
fail(){ echo "AQ-DEPLOY FAILED $1"; exit 1; }
W=/tmp/aq-deploy-$ID; mkdir -p "$W"; trap 'rm -rf "$W"' EXIT
here=$(dirname "$0")
TGZ=/tmp/hui-check-$ID.tgz
bash "$here/box-pack-$ID.sh" "$SHA" "$TGZ" >/dev/null || fail pack
# the box-side steps come from the commit being deployed
tar -xzf "$TGZ" -C "$W" scripts/box-idle.sh scripts/box-check.sh scripts/box-live.sh || fail "unpack steps"
FORCE=$FORCE WAIT_IDLE=${WAIT_IDLE:-0} bash "$W/scripts/box-idle.sh" || fail "busy"
MB=$MB TGZ=$TGZ bash "$W/scripts/box-check.sh" || fail checks
HT=/tmp/hui-$ID.tgz; CT=/tmp/code-$ID.tgz
r=$(bash "$here/box-pack-$ID.sh" "$SHA" "$HT" "$CT") || fail pack
read CODE_V HS CS <<< "$r"; echo "· packed on the box ($HS + $CS bytes)"
DC=/tmp/aq-commits-$ID; git -C "$HOME/apps/aqeel-os-src" rev-list -n 5000 "$SHA" > "$DC" 2>/dev/null || DC=
CODE_V=$CODE_V FORCE=$FORCE WAIT_IDLE=${WAIT_IDLE:-0} HT=$HT CT=$CT HS=$HS CS=$CS SHA=$SHA BOX_SHA=$BOX_SHA DC=$DC bash "$W/scripts/box-live.sh" || fail "go live"
rm -f "$here/box-pack-$ID.sh" "$0"
echo "AQ-DEPLOY DONE"
