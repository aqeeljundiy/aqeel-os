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
        from gateway.control_socket import request_unserve_profile, request_serve_profile_hot, rescan_gateway_profiles
        import time
        name = sys.argv[4]
        a = request_unserve_profile(home, name)
        b = request_serve_profile_hot(home, name) if a else None
        served = name in ((b or {}).get("served_profiles") or [])
        # 16 Nov 2026 on the live box: serve-profile did its work but answered after its own 8 s limit (None), and the app restarted the
        # whole engine. Once the agent was let go, the engine serves it again by itself (its rescan, also every 30 s): ask until it is there.
        t = time.time()
        while a and not served and time.time() - t < 45:
            r = rescan_gateway_profiles(home, timeout=8.0) or {}
            served = name in (r.get("served_profiles") or [])
            if not served:
                time.sleep(3)
        out = {"ok": bool(a and served), "unserve": a, "serve": b, "waited": round(time.time() - t, 1)}
    else:
        out = {"ok": False, "error": "unknown verb"}
except Exception as e:
    out = {"ok": False, "error": str(e)[:300]}
print(json.dumps(out, default=str)[:4000])
