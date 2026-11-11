#!/bin/bash
# Runs ON THE BOX from box-live.sh after the new files are unpacked (12 Nov 2026): puts scripts/services.sh at ~/services.sh,
# but never over a hand edit. ~/services.sh is replaced only when it is
#   - missing, or the same as the new one (nothing to do),
#   - the version this script shipped last (<data>/services.shipped), or one of the hand-edited originals listed in
#     scripts/services-legacy.sha256: then it is replaced and the deploy log says so,
#   - anything else (a box-specific edit): NOT replaced. The deploy log shows the diff and says "drift"; SERVICES_ADOPT=1
#     (env of the deploy) replaces it after the diff has been shown, keeping the old file as ~/services.sh.bak-<time>.
# Always exits 0: the launcher problem must never fail a go-live by itself. Env: HOME, AQ_APP (default ~/apps/hermes-ui),
# UI_DATA_DIR (default ~/apps/hermes-ui-data), SERVICES_ADOPT.
APP=${AQ_APP:-$HOME/apps/hermes-ui}; DATA=${UI_DATA_DIR:-$HOME/apps/hermes-ui-data}
NEW=$APP/scripts/services.sh; BOX=$HOME/services.sh; SHIPPED=$DATA/services.shipped
[ -s "$NEW" ] || { echo "· services.sh: this version ships none; ~/services.sh untouched"; exit 0; }
bash -n "$NEW" 2>/dev/null || { echo "! services.sh: the shipped launcher does not parse; ~/services.sh untouched"; exit 0; }
put(){ mkdir -p "$DATA" 2>/dev/null; cp "$NEW" "$BOX.new" && chmod 755 "$BOX.new" && mv "$BOX.new" "$BOX" && cp "$NEW" "$SHIPPED" 2>/dev/null; }
sum(){ sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
if [ ! -e "$BOX" ]; then put && echo "· services.sh: installed (the box had none)" || echo "! services.sh: could not install it"; exit 0; fi
if cmp -s "$NEW" "$BOX"; then mkdir -p "$DATA" 2>/dev/null; cp "$NEW" "$SHIPPED" 2>/dev/null; echo "· services.sh: ~/services.sh is the shipped one"; exit 0; fi
why=""
if [ -s "$SHIPPED" ] && cmp -s "$SHIPPED" "$BOX"; then why="it was the previously shipped version"
else h=$(sum "$BOX"); if [ -n "$h" ] && grep -q "^$h " "$(dirname "$0")/services-legacy.sha256" 2>/dev/null; then why="it was an original hand-edited version (listed in scripts/services-legacy.sha256)"; fi; fi
if [ -n "$why" ]; then
 echo "· services.sh: replacing ~/services.sh ($why); what changes:"; diff -u "$BOX" "$NEW" | head -60 | sed 's/^/    /'
 cp "$BOX" "$BOX.bak-$(date -u +%Y%m%d-%H%M%S)" 2>/dev/null; put && echo "· services.sh: updated" || echo "! services.sh: could not update it; ~/services.sh stays as it is"; exit 0; fi
echo "! services.sh drift: ~/services.sh was edited on this box and differs from the shipped scripts/services.sh. It was NOT replaced. What the shipped one would change:"
diff -u "$BOX" "$NEW" | head -80 | sed 's/^/    /'
if [ "${SERVICES_ADOPT:-0}" = 1 ]; then
 cp "$BOX" "$BOX.bak-$(date -u +%Y%m%d-%H%M%S)" 2>/dev/null && put && echo "· services.sh: SERVICES_ADOPT=1: replaced after showing the diff; the old file is ~/services.sh.bak-*" || echo "! services.sh: could not replace it"
else echo "  Take the edit into scripts/services.sh (git) and deploy, or deploy once with SERVICES_ADOPT=1 to replace the box's file."; fi
exit 0
