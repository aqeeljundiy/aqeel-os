#!/bin/bash
# Runs ON THE BOX after a deploy and engine reload: are Telegram voice notes and photos reaching the agents?
# bash scripts/media-check.sh ["YYYY-MM-DD HH:MM" UTC, default: the engine's start]
# 1) the engine has the media fixes in place; 2) since the start: downloads that failed for good, retried, or worked;
# replied-to / forwarded audio that was transcribed; messages kept during a stop. Exit 1 when a fix is missing or a
# download failed for good.
H=~/.hermes; E=$H/hermes-agent; bad=0
S="$1"; [ -z "$S" ] && S=$(python3 -c "import json;l=[json.loads(x) for x in open('$H/logs/gateway-exit-diag.log') if '\"gateway.start\"' in x];print(l[-1]['ts'][:16].replace('T',' '))" 2>/dev/null)
echo "== since $S UTC"
for t in "telegram-media-retry:plugins/platforms/telegram/adapter.py" "audio-stt:gateway/run.py" "audio-stt-route:gateway/run_inbound.py" "hold-inbound-during-restart:gateway/platforms/base.py"; do
 grep -q "aqeelos:${t%%:*}" "$E/${t#*:}" && echo "✓ engine fix ${t%%:*}" || { echo "✗ engine fix ${t%%:*} missing"; bad=1; }; done
logs=$(ls $H/logs/gateway.log $H/profiles/*/logs/gateway.log 2>/dev/null)
since(){ awk -v s="$S" 'substr($0,1,16)>=s' $logs 2>/dev/null; }
f=$(since | grep -a "Failed to cache" | wc -l); r=$(since | grep -a "media download try\|media lookup try" | wc -l)
ok=$(since | grep -a "Cached .* at \|Cached replied-to\|saved at" | wc -l)
tx=$(awk -v s="$S" 'substr($0,1,16)>=s' $H/logs/agent.log $H/profiles/*/logs/agent.log 2>/dev/null | grep -ai "transcri" | grep -aiv "error\|fail" | wc -l)
echo "downloads failed for good: $f · retried: $r · media cached: $ok · transcription lines: $tx"
echo "kept during a stop: $(since | grep -ac "inbound message kept") · dropped: $(since | grep -ac "Dropping inbound message")"
[ "$f" -gt 0 ] && { since | grep -a "Failed to cache" | cut -c1-160; bad=1; }
exit $bad
