# An agent's scripts call the tools it has connected (17 Nov 2026, app/tool-bridge.mjs). One worker per agent and server: it connects
# with the engine's own MCP client, so the sign-in is the agent's own and a renewed key goes through the engine's refresh lock, never
# around it. It never starts a browser sign-in (suppress_interactive_oauth): a server that needs one says so.
# argv[1] the engine's folder (its libraries), argv[2] the server name in the agent's config.yaml; HERMES_HOME = the agent's home.
# stdout: one JSON line {"ready":..} after connecting, then one JSON line per call; stdin: one JSON line per call {"id","tool","arguments"}.
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
import glob, os
_sp = sorted(glob.glob(os.path.expanduser("~/.hermes/installs/*/environments/*/venv/lib/python*/site-packages")), key=os.path.getmtime)
if _sp and _sp[-1] not in sys.path:
    sys.path.insert(1, _sp[-1])


def say(o):
    sys.stdout.write(json.dumps(o, default=str) + "\n")
    sys.stdout.flush()


def content_of(r):
    texts, other = [], []
    for c in getattr(r, "content", None) or []:
        t = getattr(c, "type", "")
        if t == "text":
            texts.append(getattr(c, "text", ""))
        else:
            other.append({"type": t, "mimeType": getattr(c, "mimeType", None)})
    # the SDK's own names (structured_content, is_error); older ones used the protocol's camelCase
    st = getattr(r, "structured_content", None)
    if st is None:
        st = getattr(r, "structuredContent", None)
    err = getattr(r, "is_error", None)
    if err is None:
        err = getattr(r, "isError", False)
    return {"text": "\n".join(texts), "other": other, "structured": st, "isError": bool(err)}


def main():
    name = sys.argv[2]
    try:
        from hermes_cli.mcp_config import _get_mcp_servers, _resolve_mcp_server_config, _tool_filters
        from tools.mcp_tool_loop import _ensure_mcp_loop, _run_on_mcp_loop
        from tools.mcp_tool_discovery import _connect_server
        from tools.mcp_oauth import suppress_interactive_oauth
    except Exception as e:
        return say({"ready": False, "error": "this engine has no MCP client aqeelOS knows (" + str(e)[:200] + ")"})
    cfg = _get_mcp_servers().get(name)
    if not isinstance(cfg, dict):
        return say({"ready": False, "error": "no tool server called " + name + " in this agent's settings"})
    include, exclude = _tool_filters(cfg)
    cfg = _resolve_mcp_server_config(dict(cfg))
    _ensure_mcp_loop()
    try:
        with suppress_interactive_oauth():
            server = _run_on_mcp_loop(_connect_server(name, cfg), timeout=float(cfg.get("connect_timeout", 60)) + 10)
    except BaseException as e:
        return say({"ready": False, "error": (type(e).__name__ + ": " + str(e))[:400]})
    names = [t.name for t in server._tools]
    allowed = [n for n in names if (include is None or n in include) and not (exclude and n in exclude)]
    say({"ready": True, "tools": allowed})
    try:
        for line in sys.stdin:
            try:
                req = json.loads(line)
            except Exception:
                continue
            rid, tool = req.get("id"), str(req.get("tool") or "")
            if tool not in allowed:
                say({"id": rid, "ok": False, "error": "this agent has no tool " + tool + " on " + name})
                continue
            try:
                r = _run_on_mcp_loop(server.session.call_tool(tool, req.get("arguments") or {}), timeout=float(req.get("timeout") or 120))
                say({"id": rid, "ok": True, **content_of(r)})
            except BaseException as e:
                say({"id": rid, "ok": False, "error": (type(e).__name__ + ": " + str(e))[:400]})
    finally:
        try:
            _run_on_mcp_loop(server.shutdown(), timeout=20)
        except BaseException:
            pass


if __name__ == "__main__":
    main()
