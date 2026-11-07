"""Tests for the audit's engine fixes (scripts/engine-fixes-patch.mjs). Runs with the engine's own Python on the box:
  ENGINE_FIXED=<folder with the patched files, laid out like the engine> <engine python> -I scripts/engine-fixes.test.py
Without ENGINE_FIXED it tests the live engine files.
"""
import importlib.util, os, pwd, sys, tempfile, time, traceback, types

# Real user home: a tool/cron shell sets HOME=<home>/.hermes/home, so "~" is wrong there.
REAL_HOME = os.environ.get("HERMES_REAL_HOME") or pwd.getpwuid(os.getuid()).pw_dir
ENGINE = os.path.join(REAL_HOME, ".hermes", "hermes-agent")
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
def webhook_excludes_admin_tools_without_limiting_future_connectors():
    m = load('hermes_cli.tools_config', 'hermes_cli/tools_config.py')
    admins = {'aqeelos-notify', 'aqeelos-self', 'aqeelos-code'}
    c = {'mcp_servers': {n: {'url': 'http://localhost:9999/mcp'} for n in admins | {'future-app'}},
         'platform_toolset_excludes': {'webhook': sorted(admins)}}
    assert not admins & m._get_platform_tools(c, 'webhook')
    assert 'future-app' in m._get_platform_tools(c, 'webhook')
    for channel in ['telegram', 'whatsapp', 'slack', 'email', 'api_server', 'cron']:
        assert admins <= m._get_platform_tools(c, channel), channel
    c['platform_toolset_excludes']['webhook'] = ['mcp-' + n for n in admins]
    assert not admins & m._get_platform_tools(c, 'webhook')


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
        os.environ["HOME"] = os.path.join(REAL_HOME, ".hermes", "home")  # what a tool command has
        os.environ["HERMES_REAL_HOME"] = REAL_HOME
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
    assert seen.get("HOME") == REAL_HOME, seen.get("HOME")
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

    # display.fallback_notice defaults to owner_dm_only: the dashboard and owner DMs see it, groups never do
    os.environ["HERMES_SESSION_CHAT_TYPE"] = "dm"
    try:
        for p in ("api_server", "telegram"):
            assert "(Answered with GPT, Claude was down.)" in run(p), (p, run(p))
        os.environ["HERMES_SESSION_CHAT_TYPE"] = "group"
        assert run("telegram") == "Halo kak, ini jawabannya.", ("telegram group", run("telegram"))
    finally:
        os.environ.pop("HERMES_SESSION_CHAT_TYPE", None)
    for p in ("whatsapp", "webhook", "cron", "cli", "oneshot", "tool", ""):
        assert run(p) == "Halo kak, ini jawabannya.", (p, run(p))


def _run_turn():
    return load("gateway.run_turn", "gateway/run_turn.py")


def _drops(m):
    import json
    f = os.path.join(m._AQ_LOG_DIR, "aqeelos-dropped.jsonl")
    if not os.path.exists(f):
        return []
    with open(f) as fh:
        return [json.loads(x) for x in fh if x.strip()]


def _retry(m, first, second=None, partial=False, current=True):
    import asyncio
    m._AQ_LOG_DIR = tempfile.mkdtemp(dir=TMP)
    calls = []

    async def run():
        calls.append(1)
        return second

    out = asyncio.run(m._aq_retry_once(first, run, history_len=4, partial_of=lambda r: partial,
                                        is_current=lambda: current, session_key="agent:sela:whatsapp:dm:1",
                                        platform="whatsapp", wait=0))
    return out, len(calls), _drops(m)


@test
def a_turn_that_failed_before_anything_ran_is_tried_once_more():
    m = _run_turn()
    first = {"failed": True, "failure_reason": "timeout", "failure_retryable": True, "error": "read timed out"}
    out, n, drops = _retry(m, first, {"failed": False, "final_response": "Halo"})
    assert n == 1 and out["final_response"] == "Halo", (n, out)
    assert drops == [dict(drops[0], agent="sela", platform="whatsapp", reason="timeout", partial=False, retried=True, recovered=True)], drops


@test
def a_turn_where_something_already_ran_is_never_repeated():
    m = _run_turn()
    first = {"failed": True, "failure_reason": "timeout", "failure_retryable": True}
    out, n, drops = _retry(m, first, {"failed": False}, partial=True)
    assert n == 0 and out is first, n
    assert drops[0]["partial"] is True and drops[0]["retried"] is False, drops


@test
def no_retry_for_a_chat_that_is_too_long_a_new_message_or_a_stale_session():
    m = _run_turn()
    for first, cur in (({"failed": True, "failure_reason": "context_overflow"}, True),
                       ({"failed": True, "failure_reason": "timeout", "compression_exhausted": True}, True),
                       ({"failed": True, "failure_reason": "timeout", "failure_retryable": False}, True),
                       ({"failed": True, "failure_reason": "timeout"}, False)):
        out, n, drops = _retry(m, first, {"failed": False}, current=cur)
        assert n == 0 and out is first and len(drops) == 1, (first, n, drops)
    out, n, drops = _retry(m, {"failed": True, "interrupted": True}, {"failed": False})
    assert n == 0 and drops == [], (n, drops)  # the person sent a new message: that one is answered, nothing dropped
    out, n, drops = _retry(m, {"failed": False, "final_response": "ok"}, {"failed": False})
    assert n == 0 and drops == [], drops


@test
def a_retry_that_fails_again_says_so_in_plain_words():
    m = _run_turn()
    first = {"failed": True, "failure_reason": "server_error", "failure_retryable": True}
    out, n, drops = _retry(m, first, {"failed": True, "failure_reason": "server_error", "failure_retryable": True})
    assert n == 1 and out.get("_aq_retried") and drops[0]["retried"] and not drops[0]["recovered"], (out, drops)
    add = lambda resp, note: (str(resp or "").strip() + "\n\n" + note).strip()
    text = m._aq_failed_reply("", out, m.FAILED_TURN_NOTICE, add)
    assert text.startswith("My AI model did not answer in time. I tried once more by myself"), text
    assert "Your request was not processed" not in text, text
    part = m._aq_failed_reply("", {"failed": True, "failure_reason": "loop_error"}, m.PARTIAL_FAILED_TURN_NOTICE, add)
    assert part == "Something went wrong on my side while I was answering. Part of it may already be done, so check that before sending it again.", part
    # the aqeelOS "couldn't reach any of my models" reply already says what to do; the retry is still mentioned
    keep = lambda resp, note: resp
    text = m._aq_failed_reply("I couldn't reach any of my models just now (Claude and GPT). Please send it again in a minute.", out, m.FAILED_TURN_NOTICE, keep)
    assert text.endswith("(I tried once more by myself and it failed again.)"), text


@test
def a_cloned_agent_never_gets_another_agents_bot_token():
    m = load("aq_profile_channels", "hermes_cli/profile_channels.py")
    env = os.path.join(tempfile.mkdtemp(dir=TMP), ".env")
    with open(env, "w") as fh:
        fh.write("# keys\nTELEGRAM_BOT_TOKEN=1:a\nCOVE_SUPPORT_BOT_TOKEN=2:b\nPINE_SLACK_APP_TOKEN=xapp\n"
                 "GITHUB_TOKEN_ABEL=ghp\nOPENAI_API_KEY=sk\n")
    removed = m.strip_channel_env_file(__import__("pathlib").Path(env))
    left = open(env).read()
    assert "COVE_SUPPORT_BOT_TOKEN" not in left and "PINE_SLACK_APP_TOKEN" not in left and "TELEGRAM_BOT_TOKEN" not in left, left
    assert "GITHUB_TOKEN_ABEL=ghp" in left and "OPENAI_API_KEY=sk" in left and "# keys" in left, left
    assert sorted(removed.get("bot_token", [])) == ["COVE_SUPPORT_BOT_TOKEN", "PINE_SLACK_APP_TOKEN"], removed


@test
def phone_masking_is_its_own_setting_and_keys_stay_hidden():
    m = load("aq_redact", "agent/redact.py")
    txt = "customer +6287885993124 key sk-proj-abcdefghijklmnopqrstuvwx"
    m._redact_phones_enabled = lambda: True
    m._REDACT_ENABLED = True
    on = m.redact_sensitive_text(txt, force=True)
    assert "+6287885993124" not in on and "****" in on, on
    m._redact_phones_enabled = lambda: False
    off = m.redact_sensitive_text(txt, force=True)
    assert "+6287885993124" in off, off
    assert "abcdefghijklmnopqrstuvwx" not in off, off


@test
def deleted_state_db_is_logged_once_with_its_path():
    import logging
    m = load("aq_hermes_state", "hermes_state.py")
    d = os.path.join(TMP, "gone-agent")
    os.makedirs(d)
    path = os.path.join(d, "state.db")
    db = m.SessionDB(db_path=__import__("pathlib").Path(path))
    try:
        db.create_session("s1", source="cli") if hasattr(db, "create_session") else None
    except Exception:
        pass
    seen = []

    class H(logging.Handler):
        def emit(self, rec):
            seen.append((rec.levelno, rec.getMessage()))
    h = H()
    m.logger.addHandler(h)
    try:
        import shutil as _sh
        _sh.rmtree(d)
        for _ in range(5):
            try:
                db._halt_if_db_generation_changed()
            except m.StateDbReplacedError:
                pass
            except Exception as exc:  # the replaced error may live in hermes_state_errors
                assert type(exc).__name__ == "StateDbReplacedError", repr(exc)
    finally:
        m.logger.removeHandler(h)
    hits = [x for x in seen if "state.db" in x[1]]
    assert len(hits) == 1, seen
    assert path in hits[0][1] and hits[0][0] == logging.WARNING, hits


@test
def oauth_tokens_survive_a_resaved_secret_for_the_same_client():
    import json, pathlib
    m = load("aq_mcp_oauth", "tools/mcp_oauth.py")
    home = os.path.join(TMP, "oauth-home")
    os.makedirs(os.path.join(home, "mcp-tokens"))
    st = m.HermesTokenStorage("slack-as2", hermes_home=home)
    tok = st._tokens_path()
    tok.write_text(json.dumps({"access_token": "xoxp-test", "token_type": "Bearer"}))
    st._client_info_path().write_text(json.dumps({"client_id": "1.2", "client_secret": "${AQ_TEST_SECRET}"}))
    m._invalidate_tokens_on_client_change(st, "1.2", "real-secret")
    assert tok.exists(), "same client id, other secret: the sign-in stays"
    m._invalidate_tokens_on_client_change(st, "9.9", "real-secret")
    assert not tok.exists(), "another client id still discards the tokens"
    # an unexpanded secret is filled from the environment, or keeps the saved one; never saved as ${...}
    st._client_info_path().write_text(json.dumps({"client_id": "1.2", "client_secret": "saved"}))
    meta = types.SimpleNamespace(grant_types=["authorization_code"], response_types=["code"], token_endpoint_auth_method="client_secret_post")
    cfg = {"client_id": "1.2", "client_secret": "${AQ_TEST_SECRET_MISSING}", "_resolved_port": 0, "redirect_uri": "https://x/cb"}
    try:
        m._maybe_preregister_client(st, cfg, meta)
    except Exception as exc:
        raise AssertionError("preregister failed: %r" % exc)
    assert json.loads(st._client_info_path().read_text()).get("client_secret") == "saved"
    os.environ["AQ_TEST_SECRET2"] = "from-env"
    cfg["client_secret"] = "${AQ_TEST_SECRET2}"
    m._maybe_preregister_client(st, cfg, meta)
    assert json.loads(st._client_info_path().read_text()).get("client_secret") == "from-env"


@test
def review_summaries_never_reach_a_chat_platform():
    src = open(os.path.join(FIXED, "gateway/run_turn_runner.py")).read()
    i = src.index("def _make_bg_review_callbacks")
    body = src[i:src.index("def release()", i)]
    assert "aqeelos:no-review-pings" in body
    assert "_send_status_text" not in body, "deliver() must not send the summary to the chat"
    assert 'event_type="review.summary"' in body, "the local viewer still gets the frame"


@test
def a_message_that_arrives_while_the_engine_stops_is_kept_and_handled_later():
    import asyncio
    m = load("aq_platform_base", "gateway/platforms/base.py")
    m._AQ_HELD_DIR = os.path.join(TMP, "held")
    from gateway.platforms.event import MessageEvent
    from gateway.session import SessionSource
    from gateway.config import Platform

    class A:  # just what the helpers read
        name = "Telegram"
        platform = Platform.TELEGRAM
        _message_handler = None
        _aq_replaying = False

        def __init__(self, tok):
            self.config = types.SimpleNamespace(token=tok, api_key=None)
            self.got = []

        async def handle_message(self, ev):
            self.got.append(ev.text)
    a = A("123:abc")
    src = SessionSource(platform=Platform.TELEGRAM, chat_id="42", chat_type="dm", user_id="7")
    import threading
    ev = MessageEvent(text="hello during restart", source=src, raw_message=threading.Lock())  # not picklable
    assert m._aq_hold_inbound(a, ev) is True
    assert m._aq_hold_inbound(a, MessageEvent(text="internal", source=src, internal=True)) is False
    f = m._aq_held_file(a)
    assert os.path.exists(f)
    assert m._aq_held_file(A("999:other")) != f, "another bot never replays this one's messages"
    assert m._aq_held_file(A(None)) is None
    asyncio.run(m._aq_replay_held(a, f))
    assert a.got == ["hello during restart"], a.got
    assert not os.listdir(m._AQ_HELD_DIR), os.listdir(m._AQ_HELD_DIR)
    src_text = open(os.path.join(FIXED, "gateway/platforms/base.py")).read()
    i = src_text.index("async def handle_message(self, event: MessageEvent)")
    assert "_aq_hold_inbound(self, event)" in src_text[i:i + 1500]


@test
def replied_and_forwarded_audio_is_transcribed_documents_are_not():
    import ast, enum
    src = open(os.path.join(FIXED, "gateway/run.py")).read()
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_event_media_is_stt_input")

    class MessageType(enum.Enum):
        TEXT = 1; VOICE = 2; AUDIO = 3; DOCUMENT = 4; PHOTO = 5
    ns = {"MessageType": MessageType, "_event_media_type_at": lambda e, i: e.media_types[i] if i < len(e.media_types) else ""}
    exec(compile(ast.Module([fn], []), "stt", "exec"), ns)
    f = ns["_event_media_is_stt_input"]
    ev = lambda t, mt: types.SimpleNamespace(message_type=t, media_types=[mt])
    assert f(ev(MessageType.VOICE, "audio/ogg", ), 0)
    assert f(ev(MessageType.AUDIO, "audio/ogg"), 0), "replied-to voice note (AUDIO) is transcribed"
    assert f(ev(MessageType.AUDIO, ""), 0)
    assert not f(ev(MessageType.DOCUMENT, "audio/ogg"), 0), "a document stays a file"
    assert not f(ev(MessageType.AUDIO, "video/mp4"), 0)
    r = open(os.path.join(FIXED, "gateway/run_inbound.py")).read()
    i = r.index("def _classify_inbound_media")
    body = r[i:i + 2000]
    assert "elif not pending_stt_prepared and _event_media_is_stt_input" not in body
    assert "audio_file_paths.append(path)" in body and "audio_paths.append(path)" in body


@test
def telegram_media_downloads_wait_longer_and_retry():
    import ast, asyncio
    import telegram
    from telegram.error import TimedOut, BadRequest
    src = open(os.path.join(FIXED, "plugins/platforms/telegram/adapter.py")).read()
    tree = ast.parse(src)
    fn = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_aq_patch_media_downloads":
            fn = node
    assert fn is not None
    calls = []

    async def fake_download(self, buf=None, **kw):
        calls.append(kw.get("read_timeout"))
        if len(calls) < 3:
            raise TimedOut("Timed out")
        return bytearray(b"ok")
    saved = telegram.File.download_as_bytearray, getattr(telegram.File, "_aq_media_retry", None)
    try:
        telegram.File.download_as_bytearray = fake_download
        if hasattr(telegram.File, "_aq_media_retry"):
            del telegram.File._aq_media_retry
        import logging as _lg
        ns = {"asyncio": asyncio, "logger": _lg.getLogger("t")}
        exec(compile(ast.Module([fn], []), "dl", "exec"), ns)
        ns["_aq_patch_media_downloads"]()
        f = types.SimpleNamespace(file_size=4_000_000)
        orig_sleep = asyncio.sleep

        async def no_sleep(_s):
            return None
        ns["asyncio"] = types.SimpleNamespace(sleep=no_sleep)
        out = asyncio.run(telegram.File.download_as_bytearray(f))
        assert out == bytearray(b"ok") and len(calls) == 3, calls
        assert calls[0] >= 60, calls
        calls.clear()

        async def bad(self, buf=None, **kw):
            calls.append(1)
            raise BadRequest("File is too big")
        telegram.File._aq_media_retry = False
        telegram.File.download_as_bytearray = bad
        ns["_aq_patch_media_downloads"]()
        try:
            asyncio.run(telegram.File.download_as_bytearray(f))
            raise AssertionError("BadRequest must surface")
        except BadRequest:
            pass
        assert calls == [1], "a refused file is not retried"
    finally:
        telegram.File.download_as_bytearray = saved[0]
        telegram.File._aq_media_retry = saved[1] if saved[1] is not None else False


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
