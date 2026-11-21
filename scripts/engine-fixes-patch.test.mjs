// engine-fixes-patch.mjs across engine versions (21 Nov 2026, AU-21): an edit falls back to its alts, a fix whose code moved
// applies only where its text still is (ifHas), and the newer engine's files get their own entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXES,FILES,fixFile} from './engine-fixes-patch.mjs';
import {kirimPatch} from './kirim-signature-patch.mjs';

test('an edit whose place moved uses its alt for the newer engine',()=>{
 const src='def f(event, index):\n    mtype, mime = 1, 2\n    if mtype in {MessageType.AUDIO, MessageType.DOCUMENT}:\n        return False\n    return mime.startswith("audio/") or (mtype == MessageType.VOICE and mime in {"", "application/octet-stream"})\n';
 const r=fixFile('gateway/run.py',src);
 assert.ok(r.applied.some(n=>/transcribed like voice notes/.test(n)),JSON.stringify(r));
 assert.match(r.out,/aqeelos:audio-stt:/);assert.match(r.out,/if mtype == MessageType.AUDIO:\n        return not mime or mime.startswith\("audio\/"\)/);
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
