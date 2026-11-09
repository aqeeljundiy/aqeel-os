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
        return (kept or os.environ.get("AQEELOS_CUSTOMER_HOLD_TEXT") or "One moment please, I am checking this."), err
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


# ---- 3) a long chat starts fresh after a quiet gap (audit G1: the owner's Telegram DM ran from 17 Oct to 6 Nov,
# 2,052 messages, compaction on the owner's turn took 385 s). The engine never resets a chat because of time; /stop
# marks it "suspended" so the next message starts a new one. This does the same for a direct chat that is quiet for
# QUIET_H hours and either very long or days old. Groups and customer lines are left alone.
QUIET_H, BIG_TOKENS, OLD_DAYS = 6, 150_000, 3
_rolled = set()  # session keys started fresh here: their first turn is told where the earlier chat is


def should_roll(chat_type, platform, idle_h, tokens, age_d):
    """Pure rule (tested): start a direct team chat fresh after a quiet gap when it is long or old."""
    if str(chat_type or "").lower() not in ("dm", "private", "direct"):
        return False
    if str(platform or "").lower() in CUSTOMER_PLATFORMS - {"whatsapp"} or str(platform or "").lower() in ("cron", "api_server", "cli", "local"):
        return False
    return idle_h >= QUIET_H and (tokens >= BIG_TOKENS or age_d >= OLD_DAYS)


def _dispatch(event=None, gateway=None, session_store=None, **_):
    try:
        src = getattr(event, "source", None)
        if src is None or gateway is None or session_store is None:
            return None
        key = gateway._session_key_for_source(src)
        entry = getattr(session_store, "_entries", {}).get(key)
        if entry is None or getattr(entry, "suspended", False):
            return None
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc)
        def _t(v):
            if v is None:
                return now
            if isinstance(v, str):
                v = _dt.datetime.fromisoformat(v)
            return v if v.tzinfo else v.replace(tzinfo=_dt.timezone.utc)
        idle_h = (now - _t(getattr(entry, "updated_at", None))).total_seconds() / 3600
        age_d = (now - _t(getattr(entry, "created_at", None))).total_seconds() / 86400
        tokens = int(getattr(entry, "last_prompt_tokens", 0) or 0)
        platform = getattr(getattr(src, "platform", None), "value", "") or ""
        if should_roll(getattr(src, "chat_type", ""), platform, idle_h, tokens, age_d):
            if session_store.suspend_session(key):
                _rolled.add(key)
                logger.info("aqeelos-live: %s chat %s starts fresh (quiet %.1f h, %d tokens, %.1f days old)", platform, key, idle_h, tokens, age_d)
    except Exception as e:
        logger.debug("aqeelos-live rollover: %s", e)
    return None


# ---- 4) loop guard (audit G4: Donna called delegate_task {"action":"list"} 27 times in 25 minutes and never answered).
# The same tool with the same arguments more than REPEAT_MAX times in one turn is blocked, and the agent is told to stop
# and say plainly what is blocking it.
REPEAT_MAX = 3
_calls = {}  # (session, turn) -> {call fingerprint: count}


def repeat_block(counts, fp):
    """Pure rule (tested): count one more identical call; a message when it is one too many."""
    counts[fp] = counts.get(fp, 0) + 1
    if counts[fp] > REPEAT_MAX:
        return ("[aqeelOS loop guard] You already made this exact call " + str(REPEAT_MAX) + " times in this turn and it "
                "did not get you further. Stop repeating it. Answer the person now: say plainly what you found, what is "
                "blocking you (a model limit, a tool that keeps failing, missing access) and what happens next.")
    return None


# ---- names people remember (7 Nov 2026) ----
# Everything an agent makes has a plain name and one line on what it is for. The engine's own schedule and skill tools are
# checked here; aqeelOS's tools (keys, logins) are checked by aqeelOS itself (app/name-rules.mjs).

def _words(s):
    return len([w for w in str(s or "").split() if w])


def _fm_desc(content):
    """The description in a SKILL.md's frontmatter ('' when there is none)."""
    m = re.match(r"^---\s*\n(.*?)\n---", str(content or ""), re.S)
    if not m:
        return ""
    d = re.search(r"^description:\s*(.*(?:\n[ \t]+.*)*)", m.group(1), re.M)
    return re.sub(r"\s+", " ", (d.group(1) if d else "")).strip().strip("'\"").strip(">|").strip()


def name_block(tool_name, args):
    """The refusal text when something is made without a plain name and one line on what it is for, else None (pure; tested)."""
    a = args if isinstance(args, dict) else {}
    if tool_name == "cronjob" and str(a.get("action", "")).lower() == "create":
        n = str(a.get("name") or "").strip()
        if len(n) < 3 or re.fullmatch(r"[\W\d_]+", n):
            return ("Not done yet: give this schedule a plain \"name\" that says what it does (for example \"Weekly sales report "
                    "to the team\"), then create it again. Right after, call organize_schedule with one sentence on what it does and why.")
    if tool_name == "skill_manage":
        ops = a.get("operations") if isinstance(a.get("operations"), list) else [a]
        for op in ops:
            if isinstance(op, dict) and str(op.get("action", "")) == "create":
                d = _fm_desc(op.get("content"))
                if len(d) < 12 or _words(d) < 3:
                    return ("Not done yet: the skill needs a one-line \"description\" in its frontmatter that says what it is for "
                            "and when to use it (for example \"Use when making the weekly sales report: where the numbers come from and how to lay them out.\"), then create it again.")
    return None


def _pre_tool(tool_name="", args=None, session_id="", turn_id="", **_):
    try:
        why = name_block(tool_name, args)
        if why:
            logger.info("aqeelos-live: names: refused %s without a plain name or description", tool_name)
            return {"action": "block", "message": why}
    except Exception as e:
        logger.debug("aqeelos-live names: %s", e)
    try:
        key = (session_id or "", turn_id or "")
        if len(_calls) > 2000:
            _calls.clear()
        fp = tool_name + ":" + json.dumps(args or {}, sort_keys=True, default=str)[:2000]
        msg = repeat_block(_calls.setdefault(key, {}), fp)
        if msg:
            logger.warning("aqeelos-live: loop guard stopped %s in session %s", tool_name, session_id)
            threading.Thread(target=_report, args=("Loop guard: " + tool_name + " repeated more than " + str(REPEAT_MAX) + " times in one turn with the same arguments", "loop", session_id), daemon=True).start()
            return {"action": "block", "message": msg}
    except Exception as e:
        logger.debug("aqeelos-live loop guard: %s", e)
    return None


# ---- 1) live context ----

_seen = {}  # session id -> hash of the last capability list this chat got
_lock = threading.Lock()


def _context(session_id="", platform="", sender_id="", is_first_turn=False, **_):
    try:
        with _lock:
            last = _seen.get(session_id or "", "")
        chat = {}
        try:
            from gateway.session_context import get_session_env
            chat = {k: str(get_session_env("HERMES_SESSION_" + k.upper()) or "") for k in ("chat_id", "thread_id", "chat_type", "chat_name")}
        except Exception:
            pass
        r = _post("/context", {"platform": platform or "", "sender": sender_id or "", "session": session_id or "",
                               "first": bool(is_first_turn), "seen": last, "chat": chat}, 3)
        if r.get("hash"):
            with _lock:
                if len(_seen) > 5000:
                    _seen.clear()
                _seen[session_id or ""] = r["hash"]
        text = str(r.get("text") or "").strip()
        if is_first_turn and _rolled:
            try:
                from gateway.session_context import get_session_env
                k = get_session_env("HERMES_SESSION_KEY") or ""
            except Exception:
                k = ""
            if k in _rolled or (not k and len(_rolled) == 1):
                _rolled.discard(k) if k else _rolled.clear()
                text = ("[aqeelOS] This chat started fresh after a quiet gap, so it stays fast. What was said before is in your "
                        "past sessions (session_search) and your memory; look there when the person refers to it.\n\n" + text).strip()
        return {"context": text} if text else None
    except Exception as e:
        logger.debug("aqeelos-live context: %s", e)
        return None


TEAM_VIEW_SCHEMA = {
    "name": "team_view",
    "description": ("For admins supervising how the team uses aqeelOS. overview: per person, chats and messages. list: chats, "
                    "filtered by person, agent, days or words. read: one chat's messages (give chat and agent from list). where: "
                    "each person's folder and each agent's home and workspace. Covers every agent, private ones too. aqeelOS checks "
                    "who is asking and logs every lookup."),
    "parameters": {"type": "object", "properties": {
        "action": {"type": "string", "enum": ["overview", "list", "read", "where"]},
        "person": {"type": "string", "description": "Part of a person's name"},
        "agent": {"type": "string"}, "chat": {"type": "string", "description": "Chat id from list"},
        "days": {"type": "integer", "description": "How far back, default 7"}, "query": {"type": "string", "description": "Words the chat must contain"},
        "limit": {"type": "integer"}, "offset": {"type": "integer"},
        "include_automated": {"type": "boolean", "description": "Also schedules and background runs"}}, "required": ["action"]},
}


def _team_view(args=None, **_):
    # who is asking comes from the engine's own session, never from the model's arguments
    try:
        from gateway.session_context import get_session_env
        ctx = {k: str(get_session_env(v) or "") for k, v in (("session", "HERMES_SESSION_ID"), ("platform", "HERMES_SESSION_PLATFORM"), ("uid", "HERMES_SESSION_USER_ID"))}
        return json.dumps(_post("/team-view", {**ctx, "args": args or {}}, 75))
    except Exception as e:
        return json.dumps({"error": "Team view did not answer: " + str(e)[:160]})


def register(ctx) -> None:
    if _agent_and_root()[0] == os.environ.get("AQEELOS_MAIN_AGENT", "default"):
        ctx.register_tool("team_view", "aqeelos-team-view", TEAM_VIEW_SCHEMA, _team_view)
    ctx.register_hook("pre_llm_call", _context)
    ctx.register_hook("transform_llm_output", _transform)
    ctx.register_hook("pre_gateway_dispatch", _dispatch)
    ctx.register_hook("pre_tool_call", _pre_tool)
