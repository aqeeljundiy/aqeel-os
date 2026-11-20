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
import sys
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


# ---- 2b) did this group message tag the agent (16 Nov 2026). The engine takes "@bot" out of the text before the model
# sees it, so an agent told the owner his tagged "check @bot" had reached it untagged. Read here from the platform's own
# message (entities, reply), kept per chat, and sent with the next turn's context: mention, reply or none.
_tags = {}  # session key -> mention / reply / none


def _span(text, entity):
    """The text an entity covers (offsets count UTF-16 units)."""
    try:
        b = (text or "").encode("utf-16-le")
        off, n = int(getattr(entity, "offset", 0)), int(getattr(entity, "length", 0))
        return b[off * 2:(off + n) * 2].decode("utf-16-le", "ignore")
    except Exception:
        return ""


def tag_of(msg, bot_id, bot_username):
    """Pure rule (tested): 'mention' when the message names the bot (@name, a text mention, /cmd@name), 'reply' when it
    answers one of the bot's messages, else 'none'; '' when the bot is unknown."""
    if msg is None or not (bot_id or bot_username):
        return ""
    want = ("@" + str(bot_username or "")).lower()
    for text, ents in ((getattr(msg, "text", None), getattr(msg, "entities", None)), (getattr(msg, "caption", None), getattr(msg, "caption_entities", None))):
        for e in ents or ():
            kind = str(getattr(e, "type", "") or "").split(".")[-1].lower()
            if kind == "mention" and bot_username and _span(text, e).strip().lower() == want:
                return "mention"
            if kind == "text_mention" and bot_id and str(getattr(getattr(e, "user", None), "id", "")) == str(bot_id):
                return "mention"
            if kind == "bot_command" and bot_username and _span(text, e).lower().endswith(want):
                return "mention"
    rep = getattr(getattr(msg, "reply_to_message", None), "from_user", None)
    if rep is not None and bot_id and str(getattr(rep, "id", "")) == str(bot_id):
        return "reply"
    return "none"


def _note_tag(event, gateway):
    src = getattr(event, "source", None)
    if src is None or gateway is None or (getattr(getattr(src, "platform", None), "value", "") or "") != "telegram":
        return
    if str(getattr(src, "chat_type", "") or "").lower() in ("dm", "private", "direct"):
        return
    msg = getattr(event, "raw_message", None)
    bot = None
    try:
        bot = msg.get_bot()
    except Exception:
        for ad in (getattr(gateway, "adapters", None) or {}).values():
            if getattr(getattr(ad, "platform", None), "value", "") == "telegram" and getattr(ad, "_bot", None) is not None:
                bot = ad._bot
                break
    try:
        name = getattr(bot, "username", None)
    except Exception:
        name = None
    tag, key = tag_of(msg, getattr(bot, "id", None), name), gateway._session_key_for_source(src)
    if not tag:
        _tags.pop(key, None)  # unknown: never carry the last message's answer over to this one
        return
    if len(_tags) > 5000:
        _tags.clear()
    _tags[key] = (tag, bool(getattr(getattr(msg, "from_user", None), "is_bot", False)))


def _dispatch(event=None, gateway=None, session_store=None, **_):
    try:
        _note_tag(event, gateway)
    except Exception as e:
        logger.debug("aqeelos-live tag: %s", e)
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


# ---- better design by default (12 Nov 2026) ----
# A schedule made or changed with the engine's own tool gets the same review as one made with aqeelOS's my_schedules
# (app/design-guard.mjs): "run this command and repeat the output" needs no AI, "step 0: run a script, stop if nothing" is a
# check that belongs in front, and faster than every 30 minutes needs a check or an event. aqeelOS answers with the text
# that says what to call instead; no answer, or any failure, lets the call through.

_DESIGN_KEYS = ("action", "job_id", "id", "name", "prompt", "schedule", "script", "no_agent", "deliver")


def design_block(tool_name, args, post=None):
    """The refusal text when aqeelOS's design review wants this schedule built another way, else None (fail open; tested)."""
    a = args if isinstance(args, dict) else {}
    if tool_name != "cronjob" or str(a.get("action", "")).lower() not in ("create", "update", "edit"):
        return None
    if a.get("prompt") is None and a.get("schedule") is None:
        return None
    try:
        r = (post or _post)("/schedule-review", {"args": {k: a[k] for k in _DESIGN_KEYS if a.get(k) is not None}}, 4)
        b = r.get("block") if isinstance(r, dict) else None
        return str(b) if b else None
    except Exception as e:
        logger.debug("aqeelos-live design review: %s", e)
        return None


def _pre_tool(tool_name="", args=None, session_id="", turn_id="", **_):
    try:
        why = name_block(tool_name, args)
        if why:
            logger.info("aqeelos-live: names: refused %s without a plain name or description", tool_name)
            return {"action": "block", "message": why}
        why = design_block(tool_name, args)
        if why:
            logger.info("aqeelos-live: design: sent %s back for a better trigger", tool_name)
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
_senders = {}  # session id -> who sent the message this turn answers (group_replies checks them in aqeelOS)
_lock = threading.Lock()


# Tool output diet (20 Nov 2026, the owner: "reads context and tokens as needed without overburning"). Every tool result stays
# in the run and is read again on every later AI call: in one Continue Threads run, 13 outputs over 6,000 characters were
# 196k of its 356k. A long result of a reading tool keeps its start and end; the whole of it is saved in the agent's folder,
# and the agent searches that file for the part it needs. Instructions (skills, memory, tool lists) and the agent's own
# connected apps are never cut. <root>/aqeelos-tool-cap.json: {"max": 8000, "off": ["agent", ...]}; max 0 turns it off.
CAP_TOOLS = ("terminal", "read_file", "search_files", "execute_code", "web_extract", "web_search", "process")
CAP_DEFAULT = 8000


def cap_text(text, limit, saved_at):
    """The start and end of a long tool result with a note where the whole of it is; None when it fits."""
    if not isinstance(text, str) or limit <= 0 or len(text) <= limit:
        return None
    head, tail = int(limit * 0.7), int(limit * 0.2)
    cut = len(text) - head - tail
    note = ("\n\n[aqeelOS: " + format(cut, ",") + " characters of this output were left out to keep the run light. The whole output is in "
            + saved_at + ": search it (grep -n 'word' FILE, or sed -n '120,160p' FILE) for the part you need instead of reading it whole.]\n\n")
    return text[:head] + note + text[-tail:]


def _cap_conf():
    try:
        _, root = _agent_and_root()
        return json.loads((root / "aqeelos-tool-cap.json").read_text())
    except Exception:
        return {}


def _cap(tool_name="", args=None, result=None, session_id="", **_):
    try:
        if not isinstance(result, str) or not (tool_name in CAP_TOOLS or tool_name.startswith("browser_")):
            return None
        agent, root = _agent_and_root()
        conf = _cap_conf()
        limit = int(conf.get("max", CAP_DEFAULT)) if agent not in (conf.get("off") or []) else 0
        if limit <= 0 or len(result) <= limit:
            return None
        folder = Path.home() / "workspaces" / agent
        if not folder.is_dir():
            folder = root / "workspaces" / agent if (root / "workspaces" / agent).is_dir() else _home()
        out = folder / ".aqeelos" / "tool-output"
        out.mkdir(parents=True, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S") + "-" + tool_name + "-" + format(abs(hash(result)) % 10**8, "08d") + ".txt"
        (out / name).write_text(result)
        for old in sorted(out.glob("*.txt"))[:-200]:
            old.unlink(missing_ok=True)
        return cap_text(result, limit, str(out / name))
    except Exception as e:
        logger.debug("aqeelos-live tool cap: %s", e)
        return None


# Usage ledger (owner, 20 Nov 2026: "tracking the usage is really important across any LLM"). One line per AI call, whatever
# the provider, in <root>/usage-ledger/<UTC day>.jsonl: who (agent, session, channel), what (model, provider, the account
# when the provider plugin says which), how much (tokens read, written, cached; estimated from the size of the request and
# the answer when the provider reports none, as Google's agy does), and what the request was made of (the anatomy):
# instructions, tool list, chat history, tool results, the newest message. aqeelOS adds the person and the schedule when
# it reads the ledger (ledger.mjs). Nothing here can stop or slow a call: every error is swallowed.
_pending: dict = {}
_LEDGER_LOCK = threading.Lock()


def _chars(x) -> int:
    if x is None:
        return 0
    if isinstance(x, str):
        return len(x)
    try:
        return len(json.dumps(x, ensure_ascii=False, default=str))
    except Exception:
        return len(str(x))


def anatomy(system_prompt, request_messages, request) -> dict:
    """characters per part of one request: sys (instructions), tools (the tool list), hist (earlier user and assistant turns),
    toolres (tool results), last (the newest user message)"""
    out = {"sys": _chars(system_prompt), "tools": 0, "hist": 0, "toolres": 0, "last": 0}
    msgs = list(request_messages or [])
    last_user = max((i for i, m in enumerate(msgs) if isinstance(m, dict) and m.get("role") == "user"), default=-1)
    for i, m in enumerate(msgs):
        if not isinstance(m, dict):
            continue
        role, n = m.get("role") or m.get("type") or "", _chars(m.get("content")) + _chars(m.get("tool_calls")) + _chars(m.get("output"))
        if role == "system" or role == "developer":
            out["sys"] += n if not system_prompt else 0
        elif role in ("tool", "function", "function_call_output"):
            out["toolres"] += n
        elif i == last_user:
            out["last"] += n
        else:
            out["hist"] += n
    if isinstance(request, dict):
        out["tools"] = _chars(request.get("tools")) or 0
    return out


def _acct_of(provider: str) -> str:
    """the account the provider plugin says it used for this thread's last call (antigravity-subscription keeps one)"""
    try:
        for mod in list(sys.modules.values()):
            f = getattr(mod, "AQEELOS_LAST_ACCOUNT", None)
            if isinstance(f, dict):
                return str(f.get(threading.get_ident()) or "")
    except Exception:
        pass
    return ""


def _pre_api(api_request_id="", system_prompt=None, request_messages=None, request=None, approx_input_tokens=0, tool_count=0, **_):
    try:
        if len(_pending) > 500:
            _pending.clear()
        _pending[str(api_request_id)] = {"an": anatomy(system_prompt, request_messages, request), "approx": int(approx_input_tokens or 0), "n": int(tool_count or 0)}
    except Exception as e:
        logger.debug("aqeelos-live ledger pre: %s", e)


def ledger_line(*, agent, session_id, platform, task_id, model, provider, usage, assistant_chars, tool_calls, duration, pre, acct, aux="") -> dict:
    u = usage or {}
    inp = int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
    cr, cw = int(u.get("cache_read_tokens") or 0), int(u.get("cache_write_tokens") or 0)
    out = int(u.get("output_tokens") or u.get("completion_tokens") or 0)
    an = (pre or {}).get("an") or {}
    est = not (inp or cr or cw or out)
    if est:   # no usage from the provider: about 4 characters a token, the way the engine estimates too
        inp = int((pre or {}).get("approx") or sum(an.values()) // 4)
        out = int((assistant_chars or 0) // 4 + 40 * (tool_calls or 0))
    total_in = inp + cr + cw
    chars = sum(an.values()) or 1
    parts = {k: int(round(total_in * v / chars)) for k, v in an.items()} if an else {}
    line = {"t": round(time.time(), 1), "a": agent, "s": session_id or "", "p": platform or "", "task": str(task_id or "")[:80], "m": model or "",
            "pv": provider or "", "acct": acct or "", "in": inp, "cr": cr, "cw": cw, "out": out, "est": est, "ms": int((duration or 0) * 1000), "an": parts,
            "n": int((pre or {}).get("n") or 0)}
    if aux:
        line["aux"] = aux
    return line


def _write_ledger(line: dict) -> None:
    _, root = _agent_and_root()
    d = root / "usage-ledger"
    d.mkdir(exist_ok=True)
    f = d / (time.strftime("%Y-%m-%d", time.gmtime()) + ".jsonl")
    data = (json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    with _LEDGER_LOCK:
        fd = os.open(str(f), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o640)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)


def _post_api(api_request_id="", session_id="", platform="", task_id="", model="", provider="", usage=None, assistant_content_chars=0,
              assistant_tool_call_count=0, api_duration=0, **_):
    try:
        agent, _ = _agent_and_root()
        pre = _pending.pop(str(api_request_id), None)
        _write_ledger(ledger_line(agent=agent, session_id=session_id, platform=platform, task_id=task_id, model=model, provider=provider, usage=usage,
                                  assistant_chars=assistant_content_chars, tool_calls=assistant_tool_call_count, duration=api_duration, pre=pre, acct=_acct_of(provider)))
    except Exception as e:
        logger.debug("aqeelos-live ledger: %s", e)


def _api_err(api_request_id="", session_id="", platform="", task_id="", model="", provider="", status_code=None, retryable=None, error=None, **_):
    """a failed AI call: one ledger line with err (aqeelOS, 21 Nov 2026: a model that fails an agent's work is moved off by itself,
    accounts.mjs model trials, and the pickers say which models failed which work)"""
    try:
        agent, _ = _agent_and_root()
        _pending.pop(str(api_request_id), None)
        e = error or {}
        _write_ledger({"t": round(time.time(), 1), "a": agent, "s": session_id or "", "p": platform or "", "task": str(task_id or "")[:80], "m": model or "",
                       "pv": provider or "", "acct": _acct_of(provider), "err": str(e.get("type") or "error")[:60], "msg": str(e.get("message") or "")[:200],
                       "code": status_code, "retry": bool(retryable), "in": 0, "cr": 0, "cw": 0, "out": 0, "an": {}})
    except Exception as ex:
        logger.debug("aqeelos-live ledger err: %s", ex)


def _post_aux(session_id="", platform="", task_id="", model="", provider="", usage=None, api_duration=0, aux_task="", **_):
    try:
        agent, _ = _agent_and_root()
        _write_ledger(ledger_line(agent=agent, session_id=session_id, platform=platform, task_id=task_id, model=model, provider=provider, usage=usage,
                                  assistant_chars=0, tool_calls=0, duration=api_duration, pre=None, acct=_acct_of(provider), aux=str(aux_task or "aux")[:40]))
    except Exception as e:
        logger.debug("aqeelos-live ledger aux: %s", e)


def _context(session_id="", platform="", sender_id="", is_first_turn=False, **_):
    try:
        with _lock:
            last = _seen.get(session_id or "", "")
        chat, tag = {}, ("", False)
        try:
            from gateway.session_context import get_session_env
            chat = {k: str(get_session_env("HERMES_SESSION_" + k.upper()) or "") for k in ("chat_id", "thread_id", "chat_type", "chat_name")}
            tag = _tags.get(str(get_session_env("HERMES_SESSION_KEY") or ""), tag)
            chat["tagged"] = tag[0]
        except Exception:
            pass
        if session_id and sender_id:
            with _lock:
                if len(_senders) > 5000:
                    _senders.clear()
                _senders[session_id] = {"sender": str(sender_id), "tagged": tag[0], "bot": tag[1]}
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


def _team_view(args=None, session_id="", **_):
    # who is asking comes from the session the engine hands this call, never from the model's arguments or the process
    # environment (which another chat running at the same moment may have just set)
    try:
        return json.dumps(_post("/team-view", {"session": str(session_id or ""), "args": args or {}}, 75))
    except Exception as e:
        return json.dumps({"error": "Team view did not answer: " + str(e)[:160]})


GROUP_REPLIES_SCHEMA = {
    "name": "group_replies",
    "description": ("Whether you get this Telegram group's messages without being tagged, and switching that for THIS whole "
                    "group (every topic, everyone in it). aqeelOS takes the chat from the conversation you are in, never "
                    "from you. status: what your settings say for this chat id now. add: answer everyone here without a "
                    "tag, when a person who tagged you here asks for it; remove: need a tag again, when a person here asks. "
                    "The change is saved as one of your changes (my_changes); aqeelOS then restarts you gracefully and "
                    "posts the confirmation in this chat. Until then say it is being switched, not that it is active; "
                    "never claim a channel setting you have not checked here."),
    "parameters": {"type": "object", "properties": {
        "action": {"type": "string", "enum": ["status", "add", "remove"]},
        "why": {"type": "string", "description": "Who asked and what they said, in a few words"}}, "required": ["action"]},
}


def _group_replies(args=None, session_id="", **_):
    # the chat comes from the session the engine hands this call; the asker from the message this turn answers
    try:
        with _lock:
            turn = dict(_senders.get(str(session_id or ""), {}))
        return json.dumps(_post("/group-replies", {"session": str(session_id or ""), "sender": turn.get("sender", ""), "tagged": turn.get("tagged", ""),
                                                   "bot": bool(turn.get("bot")), "args": args or {}}, 60))
    except Exception as e:
        return json.dumps({"error": "aqeelOS did not answer, so nothing changed: " + str(e)[:160]})


def register(ctx) -> None:
    if _agent_and_root()[0] == os.environ.get("AQEELOS_MAIN_AGENT", "default"):
        ctx.register_tool("team_view", "aqeelos-team-view", TEAM_VIEW_SCHEMA, _team_view)
    ctx.register_tool("group_replies", "aqeelos-group-replies", GROUP_REPLIES_SCHEMA, _group_replies)
    ctx.register_hook("pre_llm_call", _context)
    ctx.register_hook("transform_llm_output", _transform)
    ctx.register_hook("pre_gateway_dispatch", _dispatch)
    ctx.register_hook("pre_tool_call", _pre_tool)
    ctx.register_hook("transform_tool_result", _cap)
    ctx.register_hook("pre_api_request", _pre_api)
    ctx.register_hook("post_api_request", _post_api)
    ctx.register_hook("post_auxiliary_call", _post_aux)
    ctx.register_hook("api_request_error", _api_err)
