"""aqeelOS main agent rule (soft guard).

The main agent (the profile whose home is the aqeelOS root, not profiles/<name>) may still edit another agent's files:
the owner can ask for a direct fix. But by default it should give that agent the access it lacks so the agent fixes its
own work. When one of its file or terminal tools touches another agent's own files (instructions, skills, schedules,
memories, workspace), the result gets one reminder line appended. Nothing is blocked; any error here leaves the result as is.
"""
import os
import re
from pathlib import Path

NOTE = ("\n\n[Main agent rule] This touched another agent's own work ({who}). Unless the owner asked you to fix it "
        "directly, give that agent the access it lacks instead (manage_agent share, a tool, a connection) and tell it in "
        "its own chat or topic what it now has and to fix it itself.")
TOOLS = {"write_file", "patch", "terminal", "execute_code", "skill_manage"}
OWN = r"(?:SOUL\.md|skills|cron|memories|workspace)"


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _main_root():
    """The aqeelOS root when this process is the main agent, else None."""
    h = _home().resolve()
    if h.parent.name == "profiles":
        return None
    return h


def others_touched(text: str, root: Path, user_home: Path) -> list:
    """Agent names whose own files the text points at (pure; tested)."""
    names = set()
    r, u = re.escape(str(root)), re.escape(str(user_home))
    for pat in (r"(?:%s|~/\.hermes|\$HERMES_HOME)/profiles/([a-z0-9][a-z0-9_-]{0,63})/%s" % (r, OWN),
                r"(?:%s|~)/workspaces/([a-z0-9][a-z0-9_-]{0,63})/" % u,
                r"(?:aqeelos|hermes)\s+-p\s+([a-z0-9][a-z0-9_-]{0,63})\s+(?:cron|skills)\b"):
        for m in re.finditer(pat, text):
            n = m.group(1).split("--")[0]
            if n not in ("default",) and n != root.name:
                names.add(n)
    main_ws = os.environ.get("AQEELOS_MAIN_AGENT", "default")
    names.discard(main_ws)
    return sorted(names)


def _transform(tool_name="", args=None, result=None, **_):
    try:
        if tool_name not in TOOLS or not isinstance(result, str):
            return None
        root = _main_root()
        if root is None:
            return None
        text = " ".join(str(v) for v in (args or {}).values() if isinstance(v, (str, int, float)))
        who = others_touched(text, root, Path.home())
        if not who:
            return None
        return result + NOTE.format(who=", ".join(who))
    except Exception:
        return None


def register(ctx) -> None:
    ctx.register_hook("transform_tool_result", _transform)
