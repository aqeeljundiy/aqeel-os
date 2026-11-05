"""Tests for the audit's engine fixes (scripts/engine-fixes-patch.mjs). Runs with the engine's own Python on the box:
  ENGINE_FIXED=<folder with the patched files, laid out like the engine> <engine python> -I scripts/engine-fixes.test.py
Without ENGINE_FIXED it tests the live engine files.
"""
import importlib.util, os, sys, tempfile, time, traceback, types

ENGINE = os.path.expanduser("~/.hermes/hermes-agent")
sys.path.insert(0, ENGINE)
sys._hermes_pin_default_home = True
import hermes_bootstrap  # noqa: E402,F401  (start-up through the real home; see kirim-signature.test.py)
TMP = tempfile.mkdtemp(prefix="engine-fixes-test-")
FIXED = os.environ.get("ENGINE_FIXED") or ENGINE


def load(mod, rel):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(FIXED, rel))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


tests = []
test = tests.append


@test
def an_engine_started_from_a_tool_command_gets_the_real_home():
    start = load("hermes_cli.gateway_runtime_start", "hermes_cli/gateway_runtime_start.py")
    seen = {}

    real_popen = start.subprocess.Popen

    def fake_popen(cmd, *a, **kw):
        if isinstance(cmd, (list, tuple)) and "gateway" in cmd and "run" in cmd:
            seen.update(kw.get("env") or {})
            raise RuntimeError("stop here: the engine is not really started")
        return real_popen(cmd, *a, **kw)  # anything else the engine runs on the way

    home = os.path.join(TMP, "gwhome")
    os.makedirs(home)
    old = dict(os.environ)
    try:
        os.environ["HOME"] = os.path.expanduser("~/.hermes/home")  # what a tool command has
        os.environ["HERMES_REAL_HOME"] = "/home/claude"
        start.subprocess.Popen = fake_popen
        try:
            try:
                start.spawn_unmanaged_gateway(__import__("pathlib").Path(home), deadline=time.monotonic() + 30)
            except Exception:
                if not seen:
                    raise  # failed before it started the engine
        finally:
            start.subprocess.Popen = real_popen
    finally:
        os.environ.clear()
        os.environ.update(old)
    assert seen.get("HOME") == "/home/claude", seen.get("HOME")
    assert seen.get("HERMES_HOME") == os.path.realpath(home), seen.get("HERMES_HOME")


@test
def the_backup_model_note_shows_in_owner_chats_only():
    fin = load("agent.turn_finalizer", "agent/turn_finalizer.py")

    def run(platform):
        agent = types.SimpleNamespace(
            session_id="s", model="claude-opus-5-5", platform=platform,
            _provider_fallback_active=True, _provider_fallback_route=("openai-codex", "gpt-6.1-sol"),
            _primary_runtime={"provider": "claude-subscription-directsdk-experimental", "model": "claude-opus-5-5"},
            _fallback_chain=[])
        out, _, _ = fin.apply_llm_output_transform(agent, "Halo kak, ini jawabannya.", turn_id="t-" + platform, platform=platform)
        return out

    for p in ("api_server", "telegram"):
        assert "(Answered with GPT, Claude was down.)" in run(p), (p, run(p))
    for p in ("whatsapp", "webhook", "cron", "cli", "oneshot", "tool", ""):
        assert run(p) == "Halo kak, ini jawabannya.", (p, run(p))


failed = 0
for fn in tests:
    try:
        fn()
        print("✓", fn.__name__.replace("_", " "))
    except Exception:
        failed += 1
        print("✗", fn.__name__.replace("_", " "))
        traceback.print_exc()
print(f"{len(tests) - failed}/{len(tests)} passed")
import shutil  # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if failed else 0)
