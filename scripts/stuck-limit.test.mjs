// A sign-in that answers "rate limit" on every run for hours (app/stuck-limit.mjs, AU-10, 20 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {stuckAgents,RUNS} from '../app/stuck-limit.mjs';

const now=Date.parse('2026-11-20T02:00:00Z');
const line=(agent,minAgo,o={})=>JSON.stringify({t:(now-minAgo*60e3)/1000,agent,platform:'local',reason:'rate_limit',retried:true,recovered:false,...o});

test('an agent rate-limited on every run for over two hours is stuck; short or recovered ones are not',()=>{
 const log=[...[200,170,140,110,80,50].map(m=>line('fixer-a',m)),       // every 30 min for over 2 h
  ...[20,15,10,5].map(m=>line('line-b',m)),                                // a short burst: waits, never moves
  ...[200,150,100,50].map(m=>line('line-c',m)),line('line-c',30,{recovered:true}),  // one got through: the sign-in works
  ...[200,150,100,50].map(m=>line('line-d',m,{reason:'timeout'})),         // not a rate limit
  ...[230,190,150,110].map(m=>line('main',m)),                             // the main agent's session key is "main"
  'not json',''].join('\n');
 assert.deepEqual(stuckAgents(log,now).sort(),['default','fixer-a']);
 assert.ok(RUNS>=4)});

test('turns before the agent last moved do not count, and old turns fall out of the window',()=>{
 const log=[235,205,175,145,115].map(m=>line('fixer-a',m)).join('\n');
 assert.deepEqual(stuckAgents(log,now),['fixer-a'],'over 2 h of misses inside the 4 h window');
 assert.deepEqual(stuckAgents(log,now,a=>a==='fixer-a'?now-160*60e3:0),[],'it moved 160 min ago: only one miss since');
 assert.deepEqual(stuckAgents(log,now+3*3600e3),[],'three hours later the misses are older than the window')});

test('a stuck move holds for hours so the back-home step does not undo it, and never overrides a hand placement (review 21 Nov 2026)',async()=>{
 const {STUCK_HOLD}=await import('../app/stuck-limit.mjs');const {pinState,SETTLE}=await import('../app/account-pools.mjs');
 const now=Date.parse('2026-11-21T00:00:00Z'),pin={at:now,until:now+STUCK_HOLD,why:'rate limit'};
 assert.ok(STUCK_HOLD>=6*SETTLE,'held far longer than the usual settle time');
 assert.equal(pinState(pin,now+2*SETTLE).free,false,'two hours later it still may not go back home');assert.equal(pinState(pin,now+STUCK_HOLD+1).free,true,'then it may');
 const src=(await import('node:fs')).readFileSync(new URL('../app/accounts.mjs',import.meta.url),'utf8'),i=src.indexOf('stuckAgents(await readFile');
 assert.match(src.slice(i,i+900),/pinState\(pin0\)\.hand\)continue/,'an agent placed by hand is skipped');
 assert.match(src.slice(i,i+1600),/until:Date\.now\(\)\+STUCK_HOLD/,'the move writes the long pin')});
