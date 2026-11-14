"""Warm standby natives (aqeelOS, 14 Nov 2026): the next call's native starts while this one waits on the model.

A standby is spawned from exactly the inputs of the call that offered it and blocks on stdin, so it holds no
conversation state; a later call adopts it only when every spawn input hashes the same, replays its whole
history into it as a cold native would, and gets the same response. The fake native logs its pid at start and
at query time, which tells which process served a call and when it was started."""
import json
import logging
import os
from pathlib import Path
import sys
import time

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import directsdk

NATIVE = r"""
import json, os, pathlib, sys, time
log = pathlib.Path(os.environ['NATIVE_LOG'])
def note(*parts):
    with log.open('a') as f:
        f.write(' '.join(str(p) for p in (os.getpid(), time.monotonic()) + parts) + '\n')
note('start')
rows = []
for line in sys.stdin:
    row = json.loads(line); rows.append(row)
    if row.get('shouldQuery') is False:
        print(json.dumps({'type': 'result', 'num_turns': 0, 'is_error': False}), flush=True)
note('query', len(rows))
system = pathlib.Path(sys.argv[sys.argv.index('--system-prompt-file') + 1]).read_text()
wire = json.loads(json.loads(pathlib.Path(sys.argv[sys.argv.index('--settings') + 1]).read_text())['env']['CLAUDE_CODE_EXTRA_BODY'])
assert wire['tools'][0]['name'] == 'mcp__hermes__probe'
hang = os.environ.get('HANG_FILE')
if hang and os.path.exists(hang):
    import subprocess
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pathlib.Path(hang + '.pids').write_text(f'{os.getpid()} {child.pid}')
    print(json.dumps({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': 'started'}}}), flush=True)
    time.sleep(60)
tool = len(rows) == 1
blocks = ([{'type': 'text', 'text': 'calling'}, {'type': 'tool_use', 'id': 'toolu_warm', 'name': 'mcp__hermes__probe', 'input': {'value': 'x'}}]
          if tool else [{'type': 'text', 'text': f'done after {len(rows)} frames, system {system}'}])
for b in blocks:
    if b['type'] == 'text':
        print(json.dumps({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': b['text']}}}), flush=True)
print(json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': blocks, 'id': 'msg_warm', 'model': 'sonnet', 'stop_reason': 'tool_use' if tool else 'end_turn'}}), flush=True)
print(json.dumps({'type': 'stream_event', 'event': {'type': 'message_stop'}}), flush=True)
u = {'input_tokens': 3, 'output_tokens': 5, 'cache_read_input_tokens': 7, 'cache_creation_input_tokens': 11}
print(json.dumps({'type': 'result', 'num_turns': 2 if tool else 1, 'subtype': 'error_max_turns' if tool else 'success', 'is_error': tool, 'usage': u, 'total_cost_usd': .01}), flush=True)
sys.exit(1 if tool else 0)
"""


def _alive(pid):
    try:
        import psutil
    except ImportError:
        try:
            os.kill(pid, 0)  # windows-footgun: ok - psutil is installed wherever the suite runs on Windows
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    return psutil.pid_exists(pid) and psutil.Process(pid).status() != psutil.STATUS_ZOMBIE


def _until(condition, timeout=15):
    # Event-driven in the code under test; the bound only guards a hang on a loaded runner.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(.02)
    return False


@pytest.fixture
def pool(monkeypatch):
    monkeypatch.setenv(directsdk.WARM_ENV, '1')
    monkeypatch.delenv(directsdk.WARM_MAX_ENV, raising=False)
    monkeypatch.delenv(directsdk.WARM_IDLE_ENV, raising=False)
    fresh = directsdk.WarmPool()
    monkeypatch.setattr(directsdk, '_WARM', fresh)
    yield fresh
    fresh.close()


class Native:
    def __init__(self, tmp_path, **env):
        self.log = tmp_path / 'native.log'
        script = tmp_path / 'native.py'
        script.write_text(NATIVE)
        self.env = {'PATH': os.environ['PATH'], 'HOME': str(tmp_path), 'NATIVE_LOG': str(self.log), **env}
        self.command = [sys.executable, str(script)]

    def client(self, **extra):
        return directsdk.Client(command=self.command, env={**self.env, **extra})

    def rows(self):
        return [line.split() for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def starts(self):
        return {int(r[0]): float(r[1]) for r in self.rows() if r[2] == 'start'}

    def queries(self):
        """(pid, frames) of every native that answered, in order."""
        return [(int(r[0]), int(r[3])) for r in self.rows() if r[2] == 'query']


def request(system='You are a probe.', **extra):
    return dict(model='sonnet', messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': 'go'}],
                tools=[{'type': 'function', 'function': {'name': 'probe', 'description': 'probe', 'parameters': {'type': 'object', 'properties': {'value': {'type': 'string'}}}}}],
                **extra)


def follow_up(req, result):
    msg = result.choices[0].message.model_dump()
    msg['content'] = (msg.get('content') or '').strip()
    return {**req, 'messages': req['messages'] + [msg, {'role': 'tool', 'tool_call_id': 'toolu_warm', 'content': 'host result'}]}


def modes(caplog):
    return [r.getMessage().split()[3] for r in caplog.records if r.getMessage().startswith('claude native call:')]


def conversation(client, req):
    first = client.create(**req)
    second = client.create(**follow_up(req, first))
    return first, second


def comparable(result):
    data = result.model_dump()
    return {'choices': data['choices'], 'usage': data['usage'], 'id': data['id'], 'model': data['model']}


def test_tool_round_adopts_the_standby_and_answers_exactly_as_cold(tmp_path, pool, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=directsdk.logger.name)
    native = Native(tmp_path)
    client = native.client()
    try:
        monkeypatch.setenv(directsdk.WARM_ENV, '0')
        cold = conversation(client, request())
        assert len(pool) == 0 and modes(caplog) == ['cold', 'cold']
        cold_queries = native.queries()
        monkeypatch.setenv(directsdk.WARM_ENV, '1')
        caplog.clear()
        first = client.create(**request())
        assert _until(lambda: len(pool) == 1), 'no standby was started while the call ran'
        standby_pid = next(iter(pool.idle.values())).process.pid
        second = client.create(**follow_up(request(), first))
        assert modes(caplog) == ['cold', 'warm']
        served = native.queries()[-1][0]
        # The plugin's own log says it adopted the standby ('warm' above). A start-time comparison was dropped on 14 Nov 2026:
        # the fake CLI writes its start time once it runs, which on a loaded box lags the launch and failed 1 run in 6.
        assert served == standby_pid, 'the follow-up was not served by the standby started earlier'
        # Same replay (system + user + assistant + tool result = 3 frames into native), same responses, same usage.
        assert [n for _, n in native.queries()[-2:]] == [n for _, n in cold_queries] == [1, 3]
        assert [comparable(r) for r in (first, second)] == [comparable(r) for r in cold]
        assert second.choices[0].message.content == 'done after 3 frames, system You are a probe.'
        assert second.usage.prompt_tokens == 21 and second.usage.completion_tokens == 5
        # The follow-up offered the next standby for the user's next message; a streamed call adopts it too.
        assert _until(lambda: len(pool) == 1)
        chunks = list(client.create(**follow_up(request(), first), stream=True))
        assert ''.join(c.choices[0].delta.content or '' for c in chunks) == 'done after 3 frames, system You are a probe.'
        assert modes(caplog)[-1] == 'warm'
    finally:
        client.close()


def test_changed_inputs_never_adopt_a_standby(tmp_path, pool, caplog):
    caplog.set_level(logging.INFO, logger=directsdk.logger.name)
    native = Native(tmp_path)
    client = native.client()
    try:
        first = client.create(**request())
        assert _until(lambda: len(pool) == 1)
        variants = [
            follow_up(request(system='A different system prompt.'), first),
            follow_up({**request(), 'model': 'opus'}, first),
            follow_up(request(extra_body={'reasoning': {'effort': 'low'}}), first),
            follow_up(request(max_tokens=64), first),
            follow_up({**request(), 'timeout': 77}, first),
        ]
        for req in variants:
            result = client.create(**req)
            assert result.choices[0].finish_reason == 'stop'
        other_env = native.client(EXTRA='changes the environment')
        try:
            other_env.create(**follow_up(request(), first))
        finally:
            other_env.close()
        assert modes(caplog) == ['cold'] * 7, modes(caplog)
        assert native.queries()[-1][1] == 3
    finally:
        client.close()


def test_off_switch_spawns_one_native_per_call(tmp_path, pool, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=directsdk.logger.name)
    for off in ('0', 'false', 'off'):
        monkeypatch.setenv(directsdk.WARM_ENV, off)
        (tmp_path / off).mkdir()
        native = Native(tmp_path / off)
        client = native.client()
        try:
            conversation(client, request())
            time.sleep(.3)
            assert len(pool) == 0 and len(native.starts()) == 2, native.rows()
        finally:
            client.close()
    assert set(modes(caplog)) == {'cold'}


def test_calls_without_tools_leave_no_standby(tmp_path, pool):
    native = Native(tmp_path)
    client = native.client()
    try:
        req = request()
        req.pop('tools')
        with pytest.raises(Exception):
            client.create(**req)  # The fake insists on the probe tool; only the spawn count matters here.
        time.sleep(.3)
        assert len(pool) == 0 and len(native.starts()) == 1
    finally:
        client.close()


def test_cancel_kills_an_adopted_standby_and_its_children(tmp_path, pool, caplog):
    caplog.set_level(logging.INFO, logger=directsdk.logger.name)
    hang = tmp_path / 'hang'
    native = Native(tmp_path, HANG_FILE=str(hang))
    client = native.client()
    try:
        first = client.create(**request())
        assert _until(lambda: len(pool) == 1)
        hang.write_text('1')
        standby_pid = next(iter(pool.idle.values())).process.pid
        stream = client.create(**follow_up(request(), first), stream=True)
        assert next(stream).choices[0].delta.content == 'started'
        assert modes(caplog) == ['cold']  # The warm call logs when it ends.
        pid, grandchild = map(int, Path(str(hang) + '.pids').read_text().split())
        assert pid == stream.request.process.pid == standby_pid, 'the call did not adopt the standby'   # pid match, not start time (see above)
        client.cancel()
        with pytest.raises(RuntimeError, match='cancel'):
            list(stream)
        assert modes(caplog) == ['cold', 'warm']
        assert _until(lambda: not _alive(pid) and not _alive(grandchild)), 'cancel() left the adopted native or its child running'
        # The cancelled call had already offered its own standby; it is a clean, unused one and stays usable.
        assert _until(lambda: len(pool) == 1)
        assert all(n.usable() for n in pool.idle.values())
    finally:
        client.close()


def test_idle_standby_is_killed_and_its_files_removed(tmp_path, pool, monkeypatch):
    monkeypatch.setenv(directsdk.WARM_IDLE_ENV, '2')
    native = Native(tmp_path)
    client = native.client()
    try:
        client.create(**request())
        assert _until(lambda: len(pool) == 1)
        standby = next(iter(pool.idle.values()))
        pid, root = standby.process.pid, standby.root
        assert root.is_dir() and _alive(pid)
        assert _until(lambda: len(pool) == 0), 'the idle standby was never dropped'
        assert _until(lambda: not _alive(pid)), 'the idle standby was dropped but left running'
        assert _until(lambda: not root.exists()), 'the idle standby left its files behind'
        assert pool.janitor is None or _until(lambda: pool.janitor is None)
    finally:
        client.close()


def test_bounded_pool_dead_standby_fallback_and_shutdown(tmp_path, pool, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=directsdk.logger.name)
    monkeypatch.setenv(directsdk.WARM_MAX_ENV, '1')
    native = Native(tmp_path)
    client = native.client()
    try:
        client.create(**request(system='one'))
        assert _until(lambda: len(pool) == 1)
        oldest = next(iter(pool.idle.values())).process.pid
        first = client.create(**request(system='two'))
        assert _until(lambda: len(pool) == 1 and next(iter(pool.idle.values())).process.pid != oldest)
        assert _until(lambda: not _alive(oldest)), 'the standby over the limit was not killed'
        # A standby that died while idle is never handed out: the call spawns cold and succeeds.
        standby = next(iter(pool.idle.values()))
        directsdk.kill_process_tree(standby.process)
        assert _until(lambda: standby.process.poll() is not None)
        result = client.create(**follow_up(request(system='two'), first))
        assert result.choices[0].message.content == 'done after 3 frames, system two'
        assert modes(caplog)[-1] == 'cold'
        # Shutdown kills every standby and accepts no new ones.
        assert _until(lambda: len(pool) == 1)
        last = next(iter(pool.idle.values())).process.pid
        pool.close()
        assert len(pool) == 0 and _until(lambda: not _alive(last))
        assert pool.offer('key', lambda: pytest.fail('closed pool started a native'), 1, 60) is False
    finally:
        client.close()


def test_settings_parse_and_default_on(monkeypatch):
    for name in (directsdk.WARM_ENV, directsdk.WARM_MAX_ENV, directsdk.WARM_IDLE_ENV):
        monkeypatch.delenv(name, raising=False)
    assert directsdk.warm_settings() == (True, 4, 300.0)
    monkeypatch.setenv(directsdk.WARM_MAX_ENV, '0')
    assert directsdk.warm_settings()[0] is False
    monkeypatch.setenv(directsdk.WARM_MAX_ENV, 'many')
    monkeypatch.setenv(directsdk.WARM_IDLE_ENV, 'nan')
    assert directsdk.warm_settings() == (True, 4, 300.0)
    monkeypatch.setenv(directsdk.WARM_ENV, 'no')
    assert directsdk.warm_settings()[0] is False
