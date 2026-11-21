// engine-fixes-patch.mjs across engine versions (21 Nov 2026, AU-21): an edit falls back to its alts, a fix whose code moved
// applies only where its text still is (ifHas), and the newer engine's files get their own entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXES,FILES,fixFile} from './engine-fixes-patch.mjs';
import {kirimPatch} from './kirim-signature-patch.mjs';
import {execFileSync} from 'node:child_process';

test('on the newer engine the audio fix only marks that upstream does it (its AUDIO means never transcribe)',()=>{
 const src='def f(event, index):\n    mtype, mime = 1, 2\n    if mtype in {MessageType.AUDIO, MessageType.DOCUMENT}:\n        return False\n    return mime.startswith("audio/") or (mtype == MessageType.VOICE and mime in {"", "application/octet-stream"})\n';
 const r=fixFile('gateway/run.py',src);
 assert.ok(r.applied.some(n=>/transcribed like voice notes/.test(n)),JSON.stringify(r));
 assert.match(r.out,/aqeelos:audio-stt: upstream \(v0\.23\.3\)/);assert.match(r.out,/if mtype in \{MessageType\.AUDIO, MessageType\.DOCUMENT\}:\n        return False/,'upstream\'s rule stands');
 assert.equal(fixFile('gateway/run.py',r.out).out,null,'a second run changes nothing');
});

test('the older engine still gets the original edit',()=>{
 const src='    if message_type in {MessageType.AUDIO, MessageType.DOCUMENT}:\n        return False\n    return message_type == MessageType.VOICE or _event_media_type_at(event, index).startswith("audio/")\n';
 const r=fixFile('gateway/run.py',src);assert.match(r.out,/_aq_mt = _event_media_type_at\(event, index\)/);
});

test('a fix whose code moved is skipped quietly where it is gone, and applied in its new file',()=>{
 assert.ok(FILES.includes('persistence/sqlite/_holder.py')&&FILES.includes('agent/credential_pool_selection.py'));
 assert.deepEqual(fixFile('hermes_state.py','# the store moved to persistence\n').errors,[]);
 const holder='        if self._db_replaced or self._db_file_was_replaced():\n            self._db_replaced = True\n            self._disable_close_time_checkpoint()\n            logger.error(_STATE_DB_REPLACED_MSG)\n            raise StateDbReplacedError(_STATE_DB_REPLACED_MSG)\n';
 assert.match(fixFile('persistence/sqlite/_holder.py',holder).out,/aqeelos:replaced-db-log-once/);
 const sel='    def _strategy_pick(self, available: list[PooledCredential]) -> PooledCredential:\n        from agent.credential_pool import STRATEGY_LEAST_USED, STRATEGY_RANDOM\n        return available[0]\n';
 assert.match(fixFile('agent/credential_pool_selection.py',sel).out,/_pref = next\(.*\n        if _pref is not None:\n            return _pref\n/);
});

test('the pool fix is made once on the older engine (one entry, not two)',()=>{
 const src='    return strategy if strategy in SUPPORTED_POOL_STRATEGIES else STRATEGY_FILL_FIRST\n\nx\n        self._strategy = get_pool_strategy(provider)\n\n        if self._strategy == STRATEGY_RANDOM:\n';
 const r=fixFile('agent/credential_pool.py',src);assert.equal(r.errors.length,0,r.errors.join());
 assert.equal(r.out.split('def get_pool_prefer').length,2);assert.equal(r.out.split('self._prefer = get_pool_prefer').length,2);
 assert.match(r.out,/elif self._strategy == STRATEGY_RANDOM:/);
});

test('a place found nowhere is reported, never patched halfway',()=>{
 const r=fixFile('hermes_cli/tools_config.py','def nothing():\n    pass\n');assert.equal(r.out,null);assert.equal(r.errors.length,1);
});

test('the webhook route list fits both engines, and the signature check needs no engine helper',()=>{
 const old='        from hermes_constants import get_hermes_home\n        subs_path = get_hermes_home() / _DYNAMIC_ROUTES_FILENAME\n';
 const neu='        from hermes_constants import get_hermes_home\n        from utils import file_cache_version\n        subs_path = get_hermes_home() / _DYNAMIC_ROUTES_FILENAME\n';
 for(const s of [old,neu]){const r=kirimPatch(s);assert.ok(r.applied.includes('webhook routes for agents'),JSON.stringify(r.errors));assert.match(r.out,/get_routing_process_hermes_home\(\) \/ _DYNAMIC_ROUTES_FILENAME/)}
 assert.match(kirimPatch(neu).out,/from utils import file_cache_version/);
});

test('every fix entry names its file and tag',()=>{for(const f of FIXES){assert.ok(f.tag&&f.file&&f.edits.length,f.name)}});

test('an engine with the older text of a fix gets the newer one in place, so it matches a clean engine plus the steps',async()=>{
 const {UPGRADES}=await import('./engine-fixes-patch.mjs');
 const old='import os\n_AQ_HELD_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "aqeelos-held-inbound")\n_AQ_HELD_MAX_AGE = 1\n    return os.path.join(_AQ_HELD_DIR, "%s-%s.pickle-lines" % (plat, key))\n        os.makedirs(_AQ_HELD_DIR, mode=0o700, exist_ok=True)\n# aqeelos:hold-inbound-during-restart\n';
 const r=fixFile('gateway/platforms/base.py',old);assert.ok(r.out&&!r.out.includes('_AQ_HELD_DIR'),r.out);assert.match(r.out,/def _aq_held_dir\(\)/);
 assert.equal(fixFile('gateway/platforms/base.py',r.out).out,null,'a second run changes nothing');assert.ok(UPGRADES.length>=3);
 const k=kirimPatch('        matched = _hmac_str_equal(sig, expected) or matched\n# aqeelos:kirim-signature aqeelos:webhook-routes-home\n');
 assert.match(k.out||'',/hmac\.compare_digest\(sig\.encode\(\), expected\.encode\(\)\)/);
});

test('a schedule cleanup over its time limit logs the stuck stack, once, on both engines',()=>{
 const src='    worker.start()\n    if not done.wait(timeout):\n        logger.error(\n            "Job \'%s\': %s exceeded %.1fs; abandoning cleanup so future runs remain dispatchable",\n            job_id,\n            label,\n            timeout)\n        return False\n    if error:\n';
 const r=fixFile('cron/scheduler.py',src);assert.ok(r.applied.some(n=>/logs where it is stuck/.test(n)),JSON.stringify(r.errors));
 assert.match(r.out,/sys\._current_frames\(\)\.get\(worker\.ident\)/);assert.match(r.out,/aqeelos-cleanup-stack/);
 assert.equal(fixFile('cron/scheduler.py',r.out).out,null,'a second run changes nothing');
});

test('a dashboard action drops a proxy on this box but keeps a real one, on both engines',()=>{
 const src='    # dashboard profile\'s credentials; see _profile_action_environment (also drops _HERMES_GATEWAY).\n    action_env = _profile_action_environment(subcommand, env_overrides)\n\n    def _popen(**detach: Any) -> subprocess.Popen:\n';
 const r=fixFile('hermes_cli/web_server_gateway.py',src);assert.ok(r.applied.some(n=>/plugin proxy/.test(n)),JSON.stringify(r.errors));
 assert.match(r.out,/aqeelos:action-env-no-loopback-proxy/);assert.equal(fixFile('hermes_cli/web_server_gateway.py',r.out).out,null,'a second run changes nothing');
 const body=r.out.split('\n').filter(l=>/^    (for _aq_key|    _aq_val|    if any|        action_env\.pop)/.test(l)).map(l=>l.slice(4)).join('\n');
 const py=`action_env={"HTTPS_PROXY":"http://127.0.0.1:45613","https_proxy":"http://127.0.0.1:45613","HTTP_PROXY":"http://proxy.corp:3128","SSL_CERT_FILE":"/x"}\n${body}\nprint(sorted(action_env))`;
 const out=execFileSync('python3',['-c',py],{encoding:'utf8'}).trim();assert.equal(out,"['HTTP_PROXY', 'SSL_CERT_FILE']");
});
