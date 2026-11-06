// aqeelos-notify's base server (app/relay.mjs): signed addresses only; send_to_person is the only tool answered here.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHmac} from 'node:crypto';
process.env.UI_PORT='4499';   // not the live app: no background sweep
const {createRelay}=await import('../app/relay.mjs');
const DATA=await mkdtemp(path.join(tmpdir(),'relay-')),SECRET='s3cret';
const r=createRelay({DATA,DASH:'http://127.0.0.1:9',TOKEN:'x',HERMES_HOME:path.join(DATA,'hh'),SECRET,listAgents:async()=>['default'],links:{list:async()=>[]},platformsOf:async()=>[],nameOf:a=>a,ownerName:()=>'Owner'});
const sig=a=>createHmac('sha256',SECRET).update('relay:'+a).digest('base64url').slice(0,32);
const call=(name,args={},a='default')=>r.mcp(a,sig(a),{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});

test('a wrong signature is refused',async()=>{assert.equal((await r.mcp('default','nope',{method:'tools/list',id:1})).status,403)});
test('tools/list has send_to_person',async()=>{const o=await r.mcp('default',sig('default'),{jsonrpc:'2.0',id:1,method:'tools/list'});assert.deepEqual(o.body.result.tools.map(t=>t.name),['send_to_person'])});
test('an unknown tool is refused by name, never sent as a message',async()=>{const o=await call('list_public');assert.equal(o.body.result.isError,true);assert.match(o.body.result.content[0].text,/Unknown tool: list_public/)});
test('send_to_person with no channel set up says so plainly',async()=>{const o=await call('send_to_person',{text:'hi'});assert.equal(o.body.result.isError,true);assert.match(o.body.result.content[0].text,/No channel matches/)});
