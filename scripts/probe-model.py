# One tiny question to one provider through the engine's own provider code (backup-models.mjs: is a provider that kept
# dropping working again?). stdin: {"provider": "...", "model": "..."}  stdout: the answer text, nothing when it failed.
# HERMES_HOME is the agent's engine home, so its own sign-in is used.
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
req = json.load(sys.stdin)
from agent.auxiliary_client import call_llm
try:
    r = call_llm(provider=req["provider"], model=req.get("model") or None, messages=[{"role": "user", "content": "Reply with the single word: ok"}], max_tokens=16, timeout=60)
    print((r.choices[0].message.content or "").strip())
except Exception as e:
    print("no answer:", str(e)[:200], file=sys.stderr)
    sys.exit(1)
