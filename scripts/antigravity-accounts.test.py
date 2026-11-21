# Tests for several Google accounts in engine/antigravity-subscription/__init__.py (20 Nov 2026): which account a request goes
# to, and moving on when one is out of quota or its sign-in stopped working.
# Run: python3 -I scripts/antigravity-accounts.test.py
import importlib.util
import json
import pathlib
import sys
import tempfile
import types

if sys.version_info < (3, 10):   # the plugin runs on the AI box's Python (3.12+); an older one cannot read its type hints
    print("skipped: Python 3.10 or newer needed")
    sys.exit(0)

here = pathlib.Path(__file__).resolve().parent
plugin = here.parent / "engine" / "antigravity-subscription"
# the engine's own modules the plugin imports, as small stand-ins
prov = types.ModuleType("providers")
prov.register_provider = lambda p: None
base = types.ModuleType("providers.base")
base.ProviderProfile = type("ProviderProfile", (), {"__init__": lambda self, **k: self.__dict__.update(k)})
sys.modules.update({"providers": prov, "providers.base": base})
sys.path.insert(0, str(plugin))
spec = importlib.util.spec_from_file_location("ag", plugin / "__init__.py")
ag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ag)
n = 0


def check(name, cond):
    global n
    assert cond, name
    n += 1
    print("ok", name)


A = [{"id": "main"}, {"id": "g000001"}, {"id": "g000002"}]
day = "2026-11-20"
now = 1795161600.0   # 20 Nov 2026 07:00 UTC
check("no state: the order as listed", [a["id"] for a in ag.order_accounts(A, {}, now)] == ["main", "g000001", "g000002"])
st = {"used": {day: {"main": 40, "g000001": 3}}}
check("the least used today goes first", [a["id"] for a in ag.order_accounts(A, st, now)] == ["g000002", "g000001", "main"])
st = {"used": {day: {"main": 1}}, "cool": {"g000001": now + 600, "g000002": now + 60}}
check("a resting account goes last, the one back soonest first", [a["id"] for a in ag.order_accounts(A, st, now)] == ["main", "g000002", "g000001"])
st = {"used": {"2026-11-19": {"main": 99}}}
check("yesterday's count does not count", [a["id"] for a in ag.order_accounts(A, st, now)][0] == "main")

# the list: main always, an extra one only once its folder holds a sign-in and it is not still being set up
with tempfile.TemporaryDirectory() as t:
    t = pathlib.Path(t)
    ag._HOME = t
    ag._ACCTS = t / ".gemini" / "aqeelos-accounts.json"
    ok_home, half_home, pend_home = t / "a", t / "b", t / "c"
    for h in (ok_home, pend_home):
        (h / ".gemini" / "antigravity-cli").mkdir(parents=True)
        (h / ".gemini" / "antigravity-cli" / "antigravity-oauth-token").write_text("x")
    ag._ACCTS.parent.mkdir(parents=True, exist_ok=True)
    ag._ACCTS.write_text(json.dumps({"accounts": [{"id": "g0000a1", "home": str(ok_home)}, {"id": "g0000b2", "home": str(half_home)},
                                                  {"id": "g0000c3", "home": str(pend_home), "pending": True}, {"id": "../x", "home": str(ok_home)}]}))
    got = ag._accounts()
    check("main plus the signed-in extra account only", [a["id"] for a in got] == ["main", "g0000a1"])
    check("an extra account runs agy with its own home", ag._env(ok_home)["HOME"] == str(ok_home) and "HOME" not in ag._env(t) or ag._env(t).get("HOME") != str(ok_home))
    ag._ACCTS.write_text("not json")
    check("a broken list leaves main", [a["id"] for a in ag._accounts()] == ["main"])

check("the chosen account goes first", [a["id"] for a in ag.prefer(A, "g000002", {}, now)] == ["g000002", "main", "g000001"])
check("a chosen account that is resting does not", [a["id"] for a in ag.prefer(A, "g000002", {"cool": {"g000002": now + 60}}, now)] == ["main", "g000001", "g000002"])
check("no choice: the order stays", ag.prefer(A, "", {}, now) == A)
check("quota words are recognised", all(ag._QUOTA.search(x) for x in ["RESOURCE_EXHAUSTED", "HTTP 429", "You have reached your usage limit", "quota exceeded"]))
check("other errors are not quota", not ag._QUOTA.search("Stopped for safety: agy tried to use its own tool read_file."))
check("a weekly quota rests until its reset", ag.quota_rest("Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 160h15m57s.") == 160 * 3600 + 15 * 60 + 57 + 60)
check("minutes only", ag.quota_rest("quota reached, resets in 12m") == 12 * 60 + 60)
check("no reset named: an hour", ag.quota_rest("RESOURCE_EXHAUSTED") == 3600)
check("never more than 8 days", ag.quota_rest("Resets in 900h") == 8 * 24 * 3600)

# 21 Nov 2026: an account whose plan lacks the model. agy prints its error and quits before reading the prompt.
check("agy's model refusal is recognised", ag._MODEL_MISSING.search('invalid model selection (--model "gemini-4-neon-high" --effort ""): model gemini-4-neon-high is not recognized as a known model'))
import os, stat, threading
acp = types.ModuleType("agent.copilot_acp_client")
acp.CopilotACPClient = type("CopilotACPClient", (), {})
sys.modules.update({"agent": types.ModuleType("agent"), "agent.copilot_acp_client": acp})
Client = ag._make_client_class()
with tempfile.TemporaryDirectory() as t:
    t = pathlib.Path(t)
    ag._HOME = t
    ag._STATE = t / ".gemini" / "aqeelos-agy-state.json"
    (t / ".gemini").mkdir(parents=True, exist_ok=True)
    fake = t / "agy"
    fake.write_text('#!/bin/sh\necho \'{"event":"result","result":{"status":"ERROR","error":"invalid model selection: model gemini-4-neon-high is not recognized as a known model"}}\'\nexit 1\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    c = object.__new__(Client)
    c._acp_command, c._active_process_lock, c._active_processes = str(fake).replace("agy", "agy"), threading.Lock(), set()
    os.environ["ANTIGRAVITY_SUBSCRIPTION_COMMAND"] = str(fake)
    err = ""
    try:
        c._run_once("x" * 3_000_000, timeout_seconds=60, model="gemini-4-neon-high", home=t)   # far more than a pipe holds
    except RuntimeError as e:
        err = str(e)
    except BrokenPipeError:
        err = "BrokenPipeError"
    check("agy quitting before the prompt gives agy's own reason, not Broken pipe", "invalid model selection" in err)
    # the request moves on: the first account lacks the model, the second answers; the first rests
    calls = []
    def once(prompt, *, timeout_seconds, model=None, home=None):
        calls.append(str(home))
        if str(home).endswith("lower"):
            raise RuntimeError("Antigravity: " + err)
        return ("OK", "")
    c._run_once = once
    ag._accounts = lambda: [{"id": "g0000a1", "home": t / "lower"}, {"id": "main", "home": t}]
    ag._chosen = lambda: ""
    out = c._run_prompt("hi", timeout_seconds=60, model="gemini-4-neon-high")
    check("an account without the model is skipped and the next one answers", out == ("OK", "") or out[0] == "OK")
    check("and it rests for hours", float(ag._read_state().get("cool", {}).get("g0000a1", 0)) > ag.time.time() + 3 * 3600)

    # 22 Nov 2026: an empty answer from one account goes on to the next account at once, and that account does not rest
    ag._write_state(lambda st: st.__setitem__("cool", {}))
    def once2(prompt, *, timeout_seconds, model=None, home=None):
        if str(home).endswith("lower"):
            raise RuntimeError("Antigravity: empty answer")
        return ("OK2", "")
    c._run_once = once2
    out = c._run_prompt("hi", timeout_seconds=60, model="gemini-4-neon-high")
    check("an empty answer moves on to the next account", out[0] == "OK2")
    check("and the empty account does not rest", "g0000a1" not in (ag._read_state().get("cool") or {}))
    def once3(prompt, *, timeout_seconds, model=None, home=None):
        raise RuntimeError("Antigravity: empty answer")
    c._run_once = once3
    try:
        c._run_prompt("hi", timeout_seconds=60, model="gemini-4-neon-high"); got = ""
    except RuntimeError as e:
        got = str(e)
    check("empty from every account is an error the engine sees", got == "Antigravity: empty answer")
print(n, "passed")
