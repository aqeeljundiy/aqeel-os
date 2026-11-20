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
