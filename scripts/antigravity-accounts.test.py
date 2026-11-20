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

check("quota words are recognised", all(ag._QUOTA.search(x) for x in ["RESOURCE_EXHAUSTED", "HTTP 429", "You have reached your usage limit", "quota exceeded"]))
check("other errors are not quota", not ag._QUOTA.search("Stopped for safety: agy tried to use its own tool read_file."))
print(n, "passed")
