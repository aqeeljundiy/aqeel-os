"""aqeelOS live context and output guard (7 Nov 2026).

Installed by aqeelOS into every agent's home (app/agent-live.mjs) and switched on there.

1) pre_llm_call: asks aqeelOS on this box (http://127.0.0.1:4400/agent-live/context) for this turn's context and adds it
   to the user's message: who sent it, checked against the team policy (owner / team member / not verified), and,
   when it changed since this chat last saw it, the list of what this agent can do and its open problems. The system
   prompt is built once per chat, so before this an open chat never saw a tool or rule added later.
2) transform_llm_output: a reply that holds a script traceback or stack dump is not sent as it is. The error goes to
   aqeelOS (the agent's my_health and its next message), the reply keeps only its own words, and a schedule run whose
   reply was only the error stays silent.

Any failure here leaves the turn as it is (fail open): aqeelOS being down must never stop an agent answering.
"""
import json
import logging
import os
import re
import threading
import time
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)
URL = os.environ.get("AQEELOS_LIVE_URL", "http://127.0.0.1:4400/agent-live")
CUSTOMER_PLATFORMS = {"whatsapp", "webhook", "sms", "email"}

_TB_START = re.compile(r"^\s*Traceback \(most recent call last\):\s*$", re.M)
_PY_FRAME = re.compile(r'^\s*File "[^"]+", line \d+', re.M)
_JS_FRAME = re.compile(r"^\s+at .+[:(].*\d+:\d+\)?\s*$", re.M)
_ERR_LINE = re.compile(r"^[\w.]*(Error|Exception|Interrupt|Exit)\b.*$", re.M)


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _agent_and_root():
    h = _home().resolve()
    if h.parent.name == "profiles":
        return h.name, h.parent.parent
    return "default", h


def _key():
    _, root = _agent_and_root()
    try:
        return (root / "secrets" / "agent-live.key").read_text().strip()
    except Exception:
        return ""


def _post(path: str, data: dict, timeout: float) -> dict:
    agent, _ = _agent_and_root()
    body = json.dumps({**data, "key": _key(), "agent": agent}).encode()
    req = urllib.request.Request(URL + path, data=body, headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


# ---- 2) output guard (pure parts are tested in scripts/agent-live.test.mjs through python) ----

def split_traceback(text: str):
    """(kept_text, error_text). error_text is '' when the text holds no traceback or stack dump."""
    if not isinstance(text, str) or not text:
        return text, ""
    blocks = []
    for m in _TB_START.finditer(text):
        rest = text[m.start():]
        end = None
        for e in _ERR_LINE.finditer(rest):
            if e.start() > 0:
                end = m.start() + e.end()
                break
        blocks.append((m.start(), end if end is not None else len(text)))
    if not blocks:
        frames = list(_PY_FRAME.finditer(text)) + list(_JS_FRAME.finditer(text))
        if len(frames) < 3:
            return text, ""
        frames.sort(key=lambda f: f.start())
        start = text.rfind("\n", 0, frames[0].start()) + 1
        prev = text.rfind("\n", 0, max(start - 1, 0)) + 1
        if start and _ERR_LINE.match(text[prev:start].strip() or "x"):
            start = prev
        end = frames[-1].end()
        e = _ERR_LINE.search(text, end)
        if e and text[end:e.start()].count("\n") <= 2:
            end = e.end()
        blocks.append((start, end))
    kept, err, at = [], [], 0
    for s, e in blocks:
        kept.append(text[at:s])
        err.append(text[s:e])
        at = e
    kept.append(text[at:])
    k = "".join(kept)
    k = re.sub(r"```[a-z]*\s*```", "", k)
    k = re.sub(r"\n{3,}", "\n\n", k).strip()
    return k, "\n\n".join(x.strip() for x in err)


def guard_reply(text: str, platform: str):
    """The text to send instead, or None to leave the reply as it is. Second value: the held error."""
    kept, err = split_traceback(text)
    if not err:
        return None, ""
    p = (platform or "").lower()
    if p == "cron":
        return (kept if kept and not kept.strip().startswith("[SILENT]") else "[SILENT]"), err
    if p in CUSTOMER_PLATFORMS:
        return (kept or "Mohon tunggu sebentar ya, saya cek dulu."), err
    note = "(A script error was held back from this chat; it is in my health list and I am fixing it.)"
    return ((kept + "\n\n" + note) if kept else note), err


def _transform(response_text=None, platform="", session_id="", **_):
    try:
        out, err = guard_reply(response_text, platform)
        if not err:
            return None
        threading.Thread(target=_report, args=(err, platform, session_id), daemon=True).start()
        return out
    except Exception as e:
        logger.debug("aqeelos-live guard: %s", e)
        return None


def _report(err, platform, session_id):
    try:
        _post("/held", {"error": err[-4000:], "platform": platform or "", "session": session_id or ""}, 10)
    except Exception as e:
        logger.warning("aqeelos-live: held error not reported: %s", e)


# ---- 1) live context ----

_seen = {}  # session id -> hash of the last capability list this chat got
_lock = threading.Lock()


def _context(session_id="", platform="", sender_id="", is_first_turn=False, **_):
    try:
        with _lock:
            last = _seen.get(session_id or "", "")
        r = _post("/context", {"platform": platform or "", "sender": sender_id or "", "session": session_id or "",
                               "first": bool(is_first_turn), "seen": last}, 3)
        if r.get("hash"):
            with _lock:
                if len(_seen) > 5000:
                    _seen.clear()
                _seen[session_id or ""] = r["hash"]
        text = str(r.get("text") or "").strip()
        return {"context": text} if text else None
    except Exception as e:
        logger.debug("aqeelos-live context: %s", e)
        return None


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _context)
    ctx.register_hook("transform_llm_output", _transform)
