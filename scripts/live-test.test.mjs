// The real-life test after every deploy (scripts/live-test.mjs): its decisions, without a box.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ownServers,mustList,overdue,replied,answered,summary,heard,sawRed,startFault} from './live-test.mjs';

test('only the agent’s own local aqeelOS tool servers are checked',()=>{
 assert.deepEqual(ownServers({mcp_servers:{'aqeelos-notify':{url:'http://127.0.0.1:4400/mcp/notify/a/x'},'aqeelos-self':{url:'http://127.0.0.1:4400/mcp/self/a/y'},'aqeelos-off':{url:'http://127.0.0.1:4400/x',enabled:false},
  notion:{url:'https://mcp.notion.com/mcp'},'aqeelos-remote':{url:'https://evil.example/mcp'}}}).map(x=>x.name),['aqeelos-notify','aqeelos-self']);
 assert.equal(mustList('aqeelos-notify'),true);assert.equal(mustList('aqeelos-self'),false)});

test('a schedule is late only when switched on and more than 20 minutes past its next run',()=>{const now=Date.parse('2026-11-08T02:00:00Z');
 const j=(id,next,extra={})=>({id,name:id,profile:'sesa',enabled:true,state:'scheduled',next_run_at:next,...extra});
 const l=overdue([j('late','2026-11-08T01:30:00Z'),j('fine','2026-11-08T01:50:00Z'),j('future','2026-11-08T03:00:00Z'),j('off','2026-11-08T00:00:00Z',{enabled:false}),j('paused','2026-11-08T00:00:00Z',{state:'paused'})],now);
 assert.deepEqual(l.map(x=>x.id),['late'])});

test('Kirimdev replied when aqeelOS sent something after the test began; the agent answered when the reply holds the word',()=>{
 assert.equal(replied({a:100,b:200},150),true);assert.equal(replied({a:100},150),false);assert.equal(replied(undefined,1),false);
 assert.equal(answered('LT1A2B3C',"LT1A2B3C"),true);assert.equal(answered('OK','LT1A2B3C'),false)});

test('skipped checks never fail the test; any failed one does',()=>{
 assert.deepEqual(summary([{name:'a',ok:true},{name:'b',skipped:true,why:'x'}]),{ok:true,failed:[]});
 assert.deepEqual(summary([{name:'a',ok:true},{name:'k',ok:false,why:'no reply'}]),{ok:false,failed:['k: no reply']})});

test('the voice clip counts as heard when the transcript has its word; the picture counts as seen when the reply names red',()=>{
 assert.equal(heard('Deploy check. The word is orange.'),true);assert.equal(heard('Deploy check.'),false);assert.equal(heard(undefined),false);
 assert.equal(sawRed('LT1A2B3C Red'),true);assert.equal(sawRed('LT1A2B3C reddish'),false)});

test('the test agent not being set up is a setup fault, never a reason to undo; a set-up agent that cannot answer is a failure',()=>{
 assert.equal(startFault(401,'{"error":{"message":"Invalid gateway API key (API_SERVER_KEY)","type":"gateway_auth_error"}}'),'setup');
 assert.equal(startFault(500,"API server rejected request for profile 'aq-livetest': no profile-scoped API_SERVER_KEY is configured"),'setup');
 assert.equal(startFault(404,'not found'),'setup');assert.equal(startFault(400,'unknown provider x'),'setup');assert.equal(startFault(400,'Model is not authenticated'),'setup');
 assert.equal(startFault(500,'Internal Server Error'),'fail');assert.equal(startFault(0,'fetch failed'),'fail');assert.equal(startFault(503,'engine is restarting'),'fail');
 assert.deepEqual(summary([{name:'agent',skipped:true,setup:true,why:'the test agent is not set up'},{name:'tools',ok:true}]),{ok:true,failed:[]})});
