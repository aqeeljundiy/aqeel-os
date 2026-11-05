"""Tests for Kirimdev webhook signatures (scripts/kirim-signature-patch.mjs) against the engine's webhook receiver.
Runs with the engine's own Python on the box (no pytest there), on the live file or on a patched copy:
  KIRIM_WEBHOOK=/path/to/webhook.py <engine python> -I scripts/kirim-signature.test.py
The engine's runtime: `hermes --print-runtime-command` (python3 -I with the engine folder on sys.path, then hermes_bootstrap).
"""
import asyncio, hashlib, hmac, importlib.util, json, os, sys, tempfile, time, traceback

ENGINE = os.path.expanduser("~/.hermes/hermes-agent")
sys.path.insert(0, ENGINE)
sys._hermes_pin_default_home = True
# the engine's own dependencies: start-up finds them through the real home (an empty one makes it install a new
# environment there and start again); only then does the test move to a temporary home, so it touches no agent
import hermes_bootstrap  # noqa: E402,F401
TMP_HOME = tempfile.mkdtemp(prefix="kirim-test-")
os.environ["HERMES_HOME"] = TMP_HOME

path = os.environ.get("KIRIM_WEBHOOK") or os.path.join(ENGINE, "gateway", "platforms", "webhook.py")
spec = importlib.util.spec_from_file_location("gateway.platforms.webhook", path)
wh = importlib.util.module_from_spec(spec)
sys.modules["gateway.platforms.webhook"] = wh
spec.loader.exec_module(wh)

from unittest.mock import AsyncMock  # noqa: E402
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402
from gateway.config import PlatformConfig  # noqa: E402

SECRET = "kirim-route-secret-7d1f"
BODY = b'{"event_type":"message.received","from":"628123","text":"halo"}'


def sign(body, t=None, secret=SECRET):
    t = str(int(time.time()) if t is None else t)
    return t, hmac.new(secret.encode(), t.encode() + b"." + body, hashlib.sha256).hexdigest()


def header(t, *sigs):
    return ",".join([f"t={t}"] + [f"v1={s}" for s in sigs])


class Req:
    def __init__(self, headers):
        self.headers, self.match_info, self.method = headers, {"route_name": "kirim"}, "POST"


def adapter(routes=None):
    return wh.WebhookAdapter(PlatformConfig(enabled=True, extra={"host": "127.0.0.1", "port": 0, "routes": routes or {}}))


def ok(headers, body=BODY, secret=SECRET):
    return adapter()._validate_signature(Req(headers), body, secret)


tests = []
test = tests.append


@test
def accepts_a_correct_signature():
    t, s = sign(BODY)
    assert ok({"X-Kirim-Signature": header(t, s)}) is True
    assert ok({"x-kirim-signature": header(t, s)}) is True, "header name in lower case"
    assert ok({"X-Kirim-Signature": header(t, s.upper())}) is True, "upper-case hex"
    assert ok({"X-Kirim-Signature": f" t={t} , v1={s} "}) is True, "spaces around parts"


@test
def accepts_when_any_v1_matches():
    t, s = sign(BODY)
    _, old = sign(BODY, t, secret="the-old-secret")
    assert ok({"X-Kirim-Signature": header(t, old, s)}) is True
    assert ok({"X-Kirim-Signature": header(t, s, old)}) is True


@test
def rejects_a_wrong_signature():
    t, s = sign(BODY)
    _, other = sign(BODY, t, secret="not-the-secret")
    assert ok({"X-Kirim-Signature": header(t, other)}) is False
    assert ok({"X-Kirim-Signature": header(t, "0" * 64)}) is False
    assert ok({"X-Kirim-Signature": header(t, s)}, body=BODY + b" ") is False, "body changed after signing"
    assert ok({"X-Kirim-Signature": header(str(int(t) + 1), s)}) is False, "t changed after signing"


@test
def rejects_an_old_or_future_timestamp():
    now = int(time.time())
    for t in (now - 301, now - 3600, now + 301, 0):
        t, s = sign(BODY, t)
        assert ok({"X-Kirim-Signature": header(t, s)}) is False, t
    t, s = sign(BODY, now - 240)
    assert ok({"X-Kirim-Signature": header(t, s)}) is True, "4 minutes old is still fine"


@test
def rejects_broken_headers_without_crashing():
    t, s = sign(BODY)
    for bad in ("", f"v1={s}", f"t={t}", f"t={t},t={t},v1={s}", f"t=abc,v1={s}", f"t=-{t},v1={s}", f"t={t},v1",
                f"t={t},v1={s}é", "x" * 3000, header(t, *(["0" * 64] * 8), s)):
        assert ok({"X-Kirim-Signature": bad}) is False, bad[:60]


@test
def a_kirim_header_never_falls_through_to_other_checks():
    t, _ = sign(BODY)
    gh = "sha256=" + hmac.new(SECRET.encode(), BODY, hashlib.sha256).hexdigest()
    assert ok({"X-Hub-Signature-256": gh}) is True, "the GitHub check itself works"
    assert ok({"X-Kirim-Signature": header(t, "0" * 64), "X-Hub-Signature-256": gh}) is False
    v1 = hmac.new(SECRET.encode(), BODY, hashlib.sha256).hexdigest()
    assert ok({"X-Kirim-Signature": f"t={t}", "X-Webhook-Signature": v1}) is False


@test
def the_delivery_id_comes_from_what_was_signed():
    t, s = sign(BODY)
    a = wh._kirim_delivery_id({"X-Kirim-Signature": header(t, s), "X-Request-ID": "one"}, BODY)
    b = wh._kirim_delivery_id({"X-Kirim-Signature": header(t, s), "X-Request-ID": "two"}, BODY)
    assert a.startswith("kirim-") and a == b
    assert wh._kirim_delivery_id({"X-Kirim-Signature": header(t, s)}, BODY + b"x") != a
    t2, s2 = sign(BODY, int(t) + 30)  # Kirimdev's retry: the same body signed again with a new t
    assert wh._kirim_delivery_id({"X-Kirim-Signature": header(t2, s2)}, BODY) == a, "a retry is the same delivery"
    assert wh._kirim_delivery_id({"X-Request-ID": "r"}, BODY) == ""
    assert wh._kirim_delivery_id({"X-Kirim-Signature": "garbage"}, BODY) == ""


@test
def http_signed_is_accepted_bad_or_old_is_401_and_a_replay_wakes_nothing():
    async def run():
        from tests.gateway.fixtures.webhook_route_authority import mount_authority
        a = adapter({"kirim": {"secret": SECRET, "prompt": "Kirimdev: {text}"}})
        a.handle_message = AsyncMock()
        app = web.Application(client_max_size=a._max_body_bytes)
        mount_authority(app, a)
        app.router.add_post("/webhooks/{route_name}", a._handle_webhook)
        async with TestClient(TestServer(app)) as cli:
            post = lambda h, body=BODY: cli.post("/webhooks/kirim", data=body, headers={"content-type": "application/json", **h})
            t, s = sign(BODY)
            r = await post({"X-Kirim-Signature": header(t, s)})
            assert r.status == 202, (r.status, await r.text())
            assert a.handle_message.await_count == 1
            event = a.handle_message.await_args.args[0]
            assert "halo" in event.text, event.text
            _, wrong = sign(BODY, t, secret="nope")
            r = await post({"X-Kirim-Signature": header(t, wrong)})
            assert r.status == 401, r.status
            ot, os_ = sign(BODY, int(time.time()) - 600)
            r = await post({"X-Kirim-Signature": header(ot, os_)})
            assert r.status == 401, r.status
            r = await post({})
            assert r.status == 401, r.status
            # the same signed request again, with another request id: the same delivery, nobody woken twice
            r = await post({"X-Kirim-Signature": header(t, s), "X-Request-ID": "fresh-id"})
            assert r.status == 200 and (await r.json()).get("status") == "duplicate", (r.status, await r.text())
            assert a.handle_message.await_count == 1
            # Kirimdev's own retry (signed again, new t): still the same delivery
            t2, s2 = sign(BODY, int(time.time()) + 1)
            r = await post({"X-Kirim-Signature": header(t2, s2)})
            assert r.status == 200 and (await r.json()).get("status") == "duplicate", (r.status, await r.text())
            # a new message (a new body) goes through
            body3 = BODY.replace(b"halo", b"halo lagi")
            t3, s3 = sign(body3)
            r = await post({"X-Kirim-Signature": header(t3, s3)}, body3)
            assert r.status == 202, (r.status, await r.text())
            assert a.handle_message.await_count == 2
    asyncio.run(run())


@test
def a_route_bound_to_an_agent_is_still_found_while_its_event_is_handed_over():
    import hermes_constants as hc
    from gateway.platforms.webhook_delivery import route_digest
    gw, agent_home = os.path.join(TMP_HOME, "gw"), os.path.join(TMP_HOME, "agent")
    os.makedirs(gw), os.makedirs(agent_home)
    with open(os.path.join(gw, "webhook_subscriptions.json"), "w") as f:
        json.dump({"kirim": {"secret": SECRET, "profile": "continue-support", "prompt": "x", "deliver": "log"}}, f)
    hc.pin_process_hermes_home(gw)  # the gateway's own home, as in the running engine
    a = adapter()
    a._reload_dynamic_routes()
    assert "kirim" in a._routes
    token = hc.set_hermes_home_override(agent_home)  # inside the routed agent's scope, whose home has no list
    try:
        chat = wh._WebhookDeliveryIdentity.from_parts("continue-support", "kirim", "kirim-abc").session_chat_id
        assert route_digest(a, chat), "route digest"
        assert "kirim" in a._routes, "the route stayed"
    finally:
        hc._HERMES_HOME_OVERRIDE.reset(token)
        hc.pin_process_hermes_home(None)


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
shutil.rmtree(TMP_HOME, ignore_errors=True)
sys.exit(1 if failed else 0)
