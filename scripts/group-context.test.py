# Tests for the digest of a forum group's other topics (engine/aqeelos-group-context). Run: python3 scripts/group-context.test.py
import importlib.util
import pathlib
import sqlite3
import sys
import tempfile
import types

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gc", here.parent / "engine" / "aqeelos-group-context" / "__init__.py")
gc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gc)

NOW = 1_800_000_000.0
GROUP, OTHER = "-1001234567890", "-1009876543210"
KEY = "agent:main:telegram:group:" + GROUP + ":"


def make():
    db = pathlib.Path(tempfile.mkdtemp()) / "state.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE sessions (id TEXT, source TEXT, session_key TEXT, chat_id TEXT, thread_id TEXT, origin_json TEXT)")
    c.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER, _compressed_summary INTEGER)")
    return db, c


def session(c, sid, key, chat=GROUP, thread=None, source="telegram", origin="{}"):
    c.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)", (sid, source, key, chat, thread, origin))


def say(c, sid, role, text, ago=60, active=1, summary=0):
    c.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)", (sid, role, text, NOW - ago, active, summary))


def run(db, thread="5", key=KEY + "5", chat=GROUP):
    return gc.digest(db, key, chat, thread, NOW)


def test_sees_other_topics_not_its_own():
    db, c = make()
    session(c, "own", KEY + "5", thread="5")
    session(c, "sales", KEY + "7", thread="7", origin='{"chat_topic": "Sales"}')
    session(c, "ops", KEY + "9", thread="9")
    say(c, "own", "user", "[Ann] my own topic")
    say(c, "sales", "user", "[Bo] the launch moved to Friday", ago=7200)
    say(c, "sales", "assistant", "Noted, Friday.", ago=7100)
    say(c, "ops", "user", "[Cy] stock is low", ago=30)
    c.commit()
    out = run(db)
    assert gc.HEADER in out and "reply in the current topic" in out
    assert "the launch moved to Friday" in out and "- Sales, 2h ago: [Bo]" in out
    assert "- Sales, 1h ago: agent: Noted, Friday." in out
    assert "- topic 9, just now: [Cy] stock is low" in out
    assert "my own topic" not in out
    assert out.index("launch moved") < out.index("stock is low"), "oldest first"


def test_other_groups_agents_and_kinds_stay_out():
    db, c = make()
    session(c, "elsewhere", "agent:main:telegram:group:" + OTHER + ":7", chat=OTHER, thread="7")
    session(c, "other-agent", "agent:someone:telegram:group:" + GROUP + ":7", thread="7")
    session(c, "plain", "agent:main:telegram:group:" + GROUP, thread=None)
    session(c, "slack", "agent:main:slack:group:" + GROUP + ":7", thread="7", source="slack")
    session(c, "dm", "agent:main:telegram:dm:" + GROUP + ":7", thread="7")
    for s in ("elsewhere", "other-agent", "plain", "slack", "dm"):
        say(c, s, "user", "must not show")
    c.commit()
    assert run(db) == ""


def test_only_group_topics_get_a_digest():
    db, c = make()
    session(c, "sales", KEY + "7", thread="7")
    say(c, "sales", "user", "hello")
    c.commit()
    assert run(db) != ""
    assert run(db, thread="") == "", "no topic"
    assert run(db, key="agent:main:telegram:dm:" + GROUP + ":5") == "", "a direct chat"
    assert run(db, key="agent:main:whatsapp:group:" + GROUP + ":5") == "", "another platform"
    assert gc.digest(pathlib.Path(tempfile.mkdtemp()) / "none.db", KEY + "5", GROUP, "5", NOW) == "", "no database"


def test_skips_tools_old_and_compressed():
    db, c = make()
    session(c, "sales", KEY + "7", thread="7")
    say(c, "sales", "tool", "tool output")
    say(c, "sales", "assistant", "")
    say(c, "sales", "user", "too old", ago=73 * 3600)
    say(c, "sales", "user", "replaced", active=0)
    say(c, "sales", "user", "a summary", summary=1)
    say(c, "sales", "user", '[{"type": "text", "text": "picture caption"}]')
    c.commit()
    out = run(db)
    assert "picture caption" in out
    for gone in ("tool output", "too old", "replaced", "a summary"):
        assert gone not in out, gone


def test_bounds():
    db, c = make()
    session(c, "sales", KEY + "7", thread="7")
    for i in range(200):
        say(c, "sales", "user", "m%03d " % i + "x" * 1000, ago=200 - i)
    c.commit()
    out = run(db)
    lines = out.split("\n")[1:]
    assert len(out) <= gc.MAX_CHARS and len(lines) <= gc.MAX_MESSAGES
    assert all(len(l.split(": ", 1)[1]) <= gc.MAX_CHARS_EACH for l in lines)
    assert "m199" in out, "the newest are kept"
    assert "m000" not in out


def test_the_hook_asks_only_for_telegram_groups():
    db, c = make()
    session(c, "own", KEY + "5", thread="5")
    session(c, "sales", KEY + "7", thread="7")
    say(c, "sales", "user", "[Bo] hello")
    c.commit()
    env = {"HERMES_SESSION_PLATFORM": "telegram", "HERMES_SESSION_CHAT_TYPE": "group", "HERMES_SESSION_CHAT_ID": GROUP,
           "HERMES_SESSION_THREAD_ID": "5", "HERMES_SESSION_KEY": KEY + "5"}
    sys.modules["gateway"] = types.ModuleType("gateway")
    m = types.ModuleType("gateway.session_context")
    m.get_session_env = lambda k, d="": env.get(k, d)
    sys.modules["gateway.session_context"] = m
    gc._home = lambda: db.parent
    assert "[Bo] hello" in gc._context(session_id="own", platform="telegram")["context"]
    assert gc._context(session_id="missing", platform="telegram") is None, "a session not in the database"
    for k, v in (("HERMES_SESSION_PLATFORM", "slack"), ("HERMES_SESSION_CHAT_TYPE", "dm"), ("HERMES_SESSION_THREAD_ID", "")):
        keep, env[k] = env[k], v
        assert gc._context(session_id="own") is None, k
        env[k] = keep
    (db.parent / "config.yaml").write_text("telegram:\n  shared_topic_context: false\n", encoding="utf-8")
    gc._switched_off.__globals__["_off"].clear()
    try:
        import yaml  # noqa: F401
        assert gc._context(session_id="own", platform="telegram") is None, "switched off in config"
    except ImportError:
        pass
    m.get_session_env = lambda *a: 1 / 0
    assert gc._context(session_id="own") is None, "an error adds nothing"


for name, fn in sorted(globals().copy().items()):
    if name.startswith("test_"):
        fn()
print("ok")
