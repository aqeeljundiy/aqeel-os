# One tiny question to one provider through the engine's own provider code (backup-models.mjs: is a provider that kept
# dropping working again?). argv[2] (or stdin): {"provider": "...", "model": "..."}  stdout: the answer text, nothing when it failed.
# HERMES_HOME is the agent's engine home, so its own sign-in is used.
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
# the engine's own libraries (ruamel and the rest): the venv's python wrapper resets sys.path, so add its newest
# site-packages by hand (the same as the gateway's environment, 30 Oct 2026)
import glob, os
_sp = sorted(glob.glob(os.path.expanduser("~/.hermes/installs/*/environments/*/venv/lib/python*/site-packages")) + glob.glob("/home/claude/.hermes/installs/*/environments/*/venv/lib/python*/site-packages"), key=os.path.getmtime)
if _sp and _sp[-1] not in sys.path:
    sys.path.insert(1, _sp[-1])
# the request comes as an argument: the engine's venv python is a wrapper that does not pass stdin on (30 Oct 2026)
req = json.loads(sys.argv[2]) if len(sys.argv) > 2 else json.load(sys.stdin)
from agent.auxiliary_client import call_llm
try:
    r = call_llm(provider=req["provider"], model=req.get("model") or None, messages=[{"role": "user", "content": "Reply with the single word: ok"}], max_tokens=16, timeout=60)
    print((r.choices[0].message.content or "").strip())
except Exception as e:
    print("no answer:", str(e)[:200], file=sys.stderr)
    sys.exit(1)
