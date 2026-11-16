# One agent, not the whole engine (owner, 16 Nov 2026: "why not restart the specific agent?"). Every agent is served by the one
# engine process; these are the engine's own control-socket verbs for a single agent (app/agent-reload.mjs):
#   reload-plugins <home> <agent home>   re-discover that agent's plugins and re-wire its live channels (a plugin switched on or updated)
#   cycle <home> <agent>                 unserve and serve again: that agent's runtime and channels are rebuilt, the others keep running
# argv[1] is the engine's folder (its libraries). stdout: one JSON line, {"ok": true|false, ...}; nothing else.
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
import glob, os
_sp = sorted(glob.glob(os.path.expanduser("~/.hermes/installs/*/environments/*/venv/lib/python*/site-packages")), key=os.path.getmtime)
if _sp and _sp[-1] not in sys.path:
    sys.path.insert(1, _sp[-1])
from pathlib import Path
out = {"ok": False}
try:
    verb, home = sys.argv[2], Path(sys.argv[3])
    if verb == "reload-plugins":
        from gateway.control_socket import reload_gateway_plugins
        agent_home = Path(sys.argv[4])
        a = reload_gateway_plugins(home, profile_home=agent_home)
        out = {"ok": bool(a and a.get("reloaded")), "answer": a}
    elif verb == "cycle":
        from gateway.control_socket import request_unserve_profile, request_serve_profile_hot
        name = sys.argv[4]
        a = request_unserve_profile(home, name)
        b = request_serve_profile_hot(home, name) if a else None
        out = {"ok": bool(a and b and name in (b.get("served_profiles") or [])), "unserve": a, "serve": b}
    else:
        out = {"ok": False, "error": "unknown verb"}
except Exception as e:
    out = {"ok": False, "error": str(e)[:300]}
print(json.dumps(out, default=str)[:4000])
