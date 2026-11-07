#!/bin/bash
# Runs ON THE BOX (deploy.sh and predeploy.sh send it with ssh ... bash -s). Packs one commit straight from GitHub, so a
# deploy no longer uploads the whole app through the Mac's connection (7 Nov 2026: a VPN deploy took 15+ minutes).
#   AQ_REPO=<git url> bash box-pack.sh <commit> <aqeelOS archive> [<Code archive>]   (AQ_REPO: the repo to fetch, the deploying copy's origin)
# Prints "CODE_V <aqeelOS size> <Code size>". The box-only private files (data, mockup, PRD.md, scripts/features.mjs) are
# never in the public repo and are never in these archives: they stay as they are in ~/apps/hermes-ui.
set -e
SHA=$1; OUT=$2; OUTC=$3
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "✗ box-pack: give the full commit id" >&2; exit 1; }
R=$HOME/apps/aqeel-os-src
[ -n "${AQ_REPO:-}" ] || { echo "✗ box-pack: AQ_REPO (the repo to fetch) is not set" >&2; exit 1; }
exec 9>"$R.lock"; flock -w 600 9 || { echo "✗ box-pack: another pack kept the copy busy" >&2; exit 1; }
[ -d "$R/.git" ] || git clone -q "$AQ_REPO" "$R"
git -C "$R" remote set-url origin "$AQ_REPO"
cd "$R"
git cat-file -e "$SHA^{commit}" 2>/dev/null || git fetch -q origin
git cat-file -e "$SHA^{commit}" 2>/dev/null || { echo "✗ box-pack: commit $SHA is not on GitHub (push it first)" >&2; exit 1; }
git -c advice.detachedHead=false checkout -q --force "$SHA"; git clean -qfdx
PACK=""; for p in app assets backlog engine extension scripts code-installer; do [ -e "$p" ] && PACK="$PACK $p"; done
tar -czf "$OUT" $PACK
CODE_V=-; CS=0
if [ -n "$OUTC" ]; then
 tar -czf "$OUTC" --exclude=code/data --exclude=code/node_modules --exclude=code/desktop/node_modules --exclude=code/desktop/dist --exclude=code/scratch code
 CODE_V=$(git log -1 --format=%H -- code | cut -c1-12); CS=$(wc -c < "$OUTC" | tr -d ' ')
fi
echo "$CODE_V $(wc -c < "$OUT" | tr -d ' ') $CS"
