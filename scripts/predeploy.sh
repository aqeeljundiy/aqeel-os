#!/bin/bash
# Checks before every deploy (deploy.sh runs this unless SKIP_CHECKS=1). The new version starts as the private
# test copy on the box (port 4402, its own data and password) and must pass, in about 5 minutes:
#   1. every page loads without an error            (pages-check)
#   2. hopping fast between pages, agents and All   (sweep.js: no "Couldn't load", no null text, no script errors,
#      no flicker: replayed fades, content jumping instead of gliding, pictures loading again, the bell re-popping,
#      pop-ups that skip their fade or snap before leaving)
#   3. every page keeps its buttons and tabs     (controls-check against scripts/controls-baseline.json)
#   4. "My browser" end to end with a stand-in extension (mybrowser-check; tried twice, its agent setup is slow)
# Any failure stops the deploy with what failed; the live app is never touched by this script.
set -e
cd "$(dirname "$0")/.."
AQ_BOX=${AQ_BOX:-ai-vps}
# the My browser check (slow: it makes a throwaway agent) runs only when the browser parts changed since the last deploy
last=$(node -e "try{const l=require('./data/deploys.json');console.log(l[l.length-1].commit||'')}catch{}")
MB=1;if [ -n "$last" ] && ! git diff --name-only "$last" HEAD -- app/localbrowser.mjs app/screen.js app/chat.js extension scripts/mybrowser-check.mjs 2>/dev/null | grep -q .; then MB=0;fi
# MB_CHECK=0 skips only that check (the owner's call, e.g. 7 Nov 2026 when the engine's browser_exec made the test agent
# skip choose_browser, a problem outside the change being deployed); every other check still runs
[ "${MB_CHECK:-}" = 0 ] && { MB=0; echo "· My browser check skipped (MB_CHECK=0)"; }
# the private paths (data, mockup, PRD.md) are not in the public repo: packed only when here, like deploy.sh does
# each run sends its own copy, and only one run uses the test copy at a time: several sessions deploy from this repo,
# and a second run used to empty /tmp/aq-stage under the first (21 Oct 2026)
TGZ=/tmp/hui-check-$(date +%s)-$$.tgz
# a pushed commit is packed on the box from GitHub (deploy.sh sets PULL=1); otherwise sent from here
if [ "${PULL:-0}" = 1 ]; then ssh "$AQ_BOX" "AQ_REPO=$AQ_REPO bash -s -- $SHA $TGZ" < scripts/box-pack.sh >/dev/null || { echo "✗ the box could not pack the commit"; exit 1; }
else
PACK=""; for p in app assets backlog data engine extension mockup scripts code-installer PRD.md; do [ -e "$p" ] && PACK="$PACK $p"; done
 tar --force-local -czf ../hui-check.tgz $PACK
scp -q ../hui-check.tgz "$AQ_BOX":$TGZ && rm ../hui-check.tgz
fi
ssh "$AQ_BOX" "MB=$MB TGZ=$TGZ bash -s" < scripts/box-check.sh
