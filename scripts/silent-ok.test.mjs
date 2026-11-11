// Tests for app/silent-ok.mjs and its use in app/posting-limits.mjs. Run: node --test scripts/silent-ok.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {engineToolList,silentPosting,SILENT_RUNS,SILENT_RUNS_PLAIN} from '../app/silent-ok.mjs';
import {createPostingLimits,clean} from '../app/posting-limits.mjs';

const NOW=Date.parse('2026-11-12T02:00:00Z'),gates=n=>Array.from({length:n},(_,i)=>({at:NOW-(n-i)*600e3,allow:true,n:2}));
const LOG35="2026-11-11 12:29:48,255 INFO tools.mcp_tool: MCP server 'aqeelos-notify' (HTTP): registered 35 tool(s): mcp__aqeelos_notify__send_to_person, mcp__aqeelos_notify__my_logs\n2026-11-11 12:29:49,000 INFO other line\n";
const LOG44="2026-11-11 18:24:10,642 INFO tools.mcp_tool: MCP server 'aqeelos-notify' (HTTP): registered 44 tool(s): mcp__aqeelos_notify__send_to_person, mcp__aqeelos_notify__record_post, mcp__aqeelos_notify__manage_agent\n";

test('the engine tool list is read from the last registration line',()=>{
 assert.deepEqual(engineToolList(LOG35),{at:'2026-11-11 12:29:48',count:35,has:false});
 assert.equal(engineToolList(LOG35+LOG44).has,true);assert.equal(engineToolList(LOG44+LOG35).has,false,'the last one counts');
 assert.equal(engineToolList('nothing here'),null);assert.equal(engineToolList(''),null)});

test('allowed runs with no post and no record_post tool: one item that names the tool list',()=>{
 const x=silentPosting({gates:gates(SILENT_RUNS),entries:[],tools:engineToolList(LOG35),now:NOW});
 assert.equal(x.kind,'tool');assert.match(x.text,/record_post is missing/);assert.match(x.detail,/6 runs since/);assert.match(x.detail,/Restart this agent/);assert.match(x.detail,/35/)});

test('fewer than N runs, a pause, or a recorded post since: nothing',()=>{
 assert.equal(silentPosting({gates:gates(SILENT_RUNS-1),tools:engineToolList(LOG35),now:NOW}),null);
 assert.equal(silentPosting({gates:gates(SILENT_RUNS),tools:engineToolList(LOG35),now:NOW,stopped:true}),null);
 assert.equal(silentPosting({gates:gates(SILENT_RUNS),entries:[{at:NOW-60e3}],tools:engineToolList(LOG35),now:NOW}),null,'a post a minute ago: the runs before it do not count');
 const g=[...gates(8),{at:NOW-1,allow:false,n:0}];assert.equal(silentPosting({gates:g.map(x=>({...x,allow:false})),tools:engineToolList(LOG35),now:NOW}),null,'runs the gate refused are not silence')});

test('record_post is there: only a long run of nothing is reported, with the agent\'s own words',()=>{
 assert.equal(silentPosting({gates:gates(SILENT_RUNS_PLAIN-1),tools:engineToolList(LOG44),now:NOW}),null);
 const x=silentPosting({gates:gates(SILENT_RUNS_PLAIN),tools:engineToolList(LOG44),answer:'no fresh thread\nfound',now:NOW});
 assert.equal(x.kind,'idle');assert.match(x.detail,/record_post is available/);assert.match(x.detail,/no fresh thread found/);
 assert.equal(silentPosting({gates:gates(SILENT_RUNS_PLAIN),tools:null,now:NOW}).kind,'idle','an unknown tool list is never blamed')});

async function rig(){const dir=await mkdtemp(path.join(tmpdir(),'so-'));let t=NOW;const events=[],ok=[];let tools=engineToolList(LOG35);
 const pl=createPostingLimits({DATA:path.join(dir,'d'),WORK:path.join(dir,'w'),HERMES_HOME:path.join(dir,'h'),PORT:4400,live:false,sig:a=>'s',setKey:async()=>({ok:true}),readConfig:async()=>({}),pick:()=>null,
  look:async()=>'',event:async(...x)=>events.push(x),solved:async(...x)=>ok.push(x),engineTools:async()=>tools,log:()=>{},now:()=>t,retryMs:0});
 await pl.set('ct',{rules:clean({on:true,tz:'UTC',perDay:70,perHour:6,gapMin:8,perRun:2,quietFrom:0,quietTo:0})});
 return {pl,events,ok,tick:ms=>{t+=ms},setTools:v=>{tools=v}}}

test('posting-limits: six allowed runs with no record_post files ONE item once, then it clears when a post is recorded',async()=>{const {pl,events,ok,tick,setTools}=await rig();
 for(let i=0;i<SILENT_RUNS;i++){assert.match(await pl.gate('ct'),/post at most 2/);tick(600e3)}
 await pl.silence('ct');assert.equal(events.length,1);assert.equal(events[0][0],'silent');assert.equal(events[0][3].topic,'silent-posting');assert.match(events[0][2],/record_post/);
 await pl.silence('ct');assert.equal(events.length,2,'asked again: the same topic, so Health keeps one item');assert.equal(events[1][3].topic,events[0][3].topic);
 setTools(engineToolList(LOG44));await pl.silence('ct');assert.equal(events.length,2,'tool back and fewer than 12 runs: nothing new');assert.equal(ok.at(-1)[1],'silent-posting');
 const r=await pl.record('ct',{post_url:'https://www.threads.com/@x/post/1',text:'a real comment text here',lead:'warm'});assert.ok(r.text);
 await pl.silence('ct');assert.equal(ok.length>=2,true)});
