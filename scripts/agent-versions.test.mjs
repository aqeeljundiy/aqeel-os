// Tests for the self-repair kit (app/agent-versions.mjs). Run: node --test scripts/agent-versions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {createAgentVersions,recordAgentChange,redactLog,verifyProvider,resign,rollbackPlan,capabilityLines,VERSION_TOOLS,OWN_SETTING} from '../app/agent-versions.mjs';

test('redactLog hides keys, bearer tokens, bot tokens, long opaque strings; phone numbers stay in full',()=>{
 const t=redactLog('api_key=sk-abc123456789 Authorization: Bearer abcdefghijklmnop bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAA to 6281200000001 '+'x'.repeat(45));
 assert.doesNotMatch(t,/sk-abc|abcdefghijklmnop|AAAAAAAAAAAA|xxxxxxxxxx/);assert.match(t,/6281200000001/)});

test('verifyProvider: HMAC-SHA256 hex (Tripay style), token (Xendit style), wrong signature refused; resign makes the engine V2 signature',()=>{
 const raw=Buffer.from('{"status":"PAID"}'),key='priv';const sig=createHmac('sha256',key).update(raw).digest('hex');
 assert.equal(verifyProvider({header:'x-callback-signature',scheme:'hmac-sha256-hex'},{'x-callback-signature':sig},raw,key),true);
 assert.equal(verifyProvider({header:'x-callback-signature',scheme:'hmac-sha256-hex'},{'x-callback-signature':'00'+sig.slice(2)},raw,key),false);
 assert.equal(verifyProvider({header:'x-callback-token',scheme:'token'},{'x-callback-token':'priv'},raw,key),true);
 assert.equal(verifyProvider({header:'x-callback-token',scheme:'token'},{},raw,key),false);
 const h=resign('s3',raw,1700000000);assert.equal(h['x-webhook-signature-v2'],createHmac('sha256','s3').update('1700000000.'+raw.toString()).digest('hex'))});

test('rollbackPlan: a rollback never undoes what an earlier automatic rollback did',()=>{
 const p=rollbackPlan([{id:'1623',at:10,state:'done',by:'Pixel Agent'},{id:'1624',at:20,state:'done',by:'aqeelOS (automatic rollback)'},{id:'1625',at:30,state:'done',by:'aqeelOS (automatic rollback)'}],{since:0,now:50});
 assert.deepEqual(p.map(x=>x.id),['1623'])});
test('rollbackPlan: only done, undoable changes in the window, newest first',()=>{
 const p=rollbackPlan([{id:'1',at:10,state:'done'},{id:'2',at:20,state:'undone'},{id:'3',at:30,state:'done'},{id:'4',at:40,state:'done',undoable:false},{id:'5',at:5,state:'done'}],{since:10,now:50});
 assert.deepEqual(p.map(x=>x.id),['3','1'])});

test('capabilityLines states real tools, apps needing a sign-in, schedules, WhatsApp and the fix-yourself tools',()=>{
 const L=capabilityLines({at:'x',toolsByChannel:{telegram:['hermes-telegram','aqeelos-notify']},off:['browser'],apps:[{name:'notion',state:'needs a sign-in'},{name:'n8n',state:'ready'}],skills:3,skillNames:['a'],schedules:[{name:'Daily',on:false}],whatsapp:{mode:'test',testers:['AJ']},team:'Cove',webhooks:[],selfRuns:true,terminal:'its own Linux user'}).join('\n');
 for(const s of ['telegram: hermes-telegram, aqeelos-notify','browser','notion (needs a sign-in)','Daily [paused]','mode test','Cove','create_my_webhook','my_deliveries','undo_my_change'])assert.ok(L.includes(s),s)});

test('tool list: every tool has a schema; own settings are only stt/tts/timezone/display',()=>{
 for(const t of VERSION_TOOLS){assert.ok(t.name&&t.description&&t.inputSchema?.type==='object',t.name)}
 assert.ok(OWN_SETTING.test('stt.language'));assert.ok(!OWN_SETTING.test('model.default'));assert.ok(!OWN_SETTING.test('mcp_servers.x'))});

// a fake engine dashboard: /api/cron/jobs per profile
function fakeDash(){const jobs={};let n=0;const srv=createServer(async(req,res)=>{const u=new URL(req.url,'http://x');const prof=u.searchParams.get('profile');let body='';for await(const c of req)body+=c;const b=body?JSON.parse(body):{};
 const L=jobs[prof]||=[];const m=/^\/api\/cron\/jobs(?:\/([^/]+))?(?:\/(pause|resume|trigger|runs))?$/.exec(u.pathname);const send=(c,j)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(j))};
 if(!m)return send(404,{});const [,id,act]=m;
 if(!id&&req.method==='GET')return send(200,L);if(!id&&req.method==='POST'){const j={id:'j'+(++n),name:b.name,prompt:b.prompt,schedule:{expr:b.schedule},schedule_display:b.schedule,deliver:b.deliver,enabled:true,state:'scheduled'};L.push(j);return send(200,{job:j})}
 const j=L.find(x=>x.id===id);if(!j)return send(404,{detail:'not found'});
 if(act==='pause'){j.enabled=false;j.state='paused';return send(200,j)}if(act==='resume'){j.enabled=true;j.state='scheduled';return send(200,j)}if(act==='runs')return send(200,{runs:[]})
 if(req.method==='PUT'){Object.assign(j,b.updates);if(b.updates.schedule)j.schedule={expr:b.updates.schedule},j.schedule_display=b.updates.schedule;return send(200,j)}
 if(req.method==='DELETE'){L.splice(L.indexOf(j),1);return send(200,{ok:true})}return send(405,{})});
 return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({srv,jobs,url:'http://127.0.0.1:'+srv.address().port})))}

async function make(o={}){const root=await mkdtemp(path.join(tmpdir(),'av-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data');await mkdir(path.join(H,'profiles','bot','skills','cat','one'),{recursive:true});
 await writeFile(path.join(H,'profiles','bot','skills','cat','one','SKILL.md'),'v1\n');const d=await fakeDash();let t=Date.UTC(2026,10,6,8,0);const told=[],filed=[],cfg={stt:{language:'id'}};
 const v=createAgentVersions({DATA,HERMES_HOME:H,DASH:d.url,DASH_TOKEN:'x',listAgents:async()=>['default','bot'],nameOf:a=>a==='bot'?'Bot':a,readConfig:async()=>cfg,
  setKey:async(a,k,val)=>{const p=k.split('.');let x=cfg;while(p.length>1)x=x[p.shift()]||={};x[p[0]]=val;return {ok:true}},pick:(o,k)=>k.split('.').reduce((x,y)=>x&&typeof x==='object'?x[y]:undefined,o),
  issues:{file:async x=>{filed.push(x);return {issue:{id:'i1'}}},forAgent:async()=>[]},ping:o.ping||(async()=>({ok:true})),tellOwner:async x=>{told.push(x)},quiet:o.quiet,now:()=>t,live:true,log:()=>{}});
 return {v,d,H,DATA,cfg,told,filed,tick:ms=>{t+=ms}}}

test('schedules: create, edit, pause and remove are versions; undo brings back exactly what was there',async()=>{const {v,d}=await make();
 try{const c=await v.mySchedules('bot',{action:'create',name:'Daily',schedule:'0 9 * * *',prompt:'do it'},{by:'Bot'});assert.match(c.text,/Created j1/);
  await v.mySchedules('bot',{action:'edit',id:'j1',schedule:'0 10 * * *',why:'later'},{by:'Bot'});assert.equal(d.jobs.bot[0].schedule_display,'0 10 * * *');
  await v.mySchedules('bot',{action:'pause',id:'j1'},{by:'Bot'});assert.equal(d.jobs.bot[0].state,'paused');
  await v.mySchedules('bot',{action:'remove',id:'j1'},{by:'Bot'});assert.equal(d.jobs.bot.length,0);
  const ch=(await v.changes('bot')).items;assert.equal(ch.length,4);
  await v.undo('bot',ch[0].id);assert.equal(d.jobs.bot.length,1);assert.equal(d.jobs.bot[0].state,'paused');assert.equal(d.jobs.bot[0].schedule_display,'0 10 * * *');
  // not its own: refused and marked outside (the caller files it for the fixer)
  const r=await v.mySchedules('bot',{action:'pause',id:'donna-job'});assert.equal(r.isError,true);assert.equal(r.outside,true);
  await assert.rejects(v.undo('bot',ch[0].id),/already undone/)}finally{d.srv.close()}});

test('settings: versioned with the value before; undo sets it back; anything else is outside',async()=>{const {v,d,cfg}=await make();
 try{await v.mySetting('bot','stt.language','en',{by:'Bot'});assert.equal(cfg.stt.language,'en');const [x]=(await v.changes('bot')).items;await v.undo('bot',x.id);assert.equal(cfg.stt.language,'id');
  assert.equal((await v.mySetting('bot','model.default','x')).outside,true)}finally{d.srv.close()}});

test('skills: a change to its own skills folder becomes a version and undo restores the file',async()=>{const {v,d,H}=await make();
 try{const f=path.join(H,'profiles','bot','skills','cat','one','SKILL.md');await v.skillsSnap('bot');await writeFile(f,'v2 broken\n');
  const [x]=await v.skillsSnap('bot',{why:'edit'});assert.equal(x.kind,'skill');assert.equal(x.target,'cat/one');
  await v.undo('bot',x.id);assert.equal(await readFile(f,'utf8'),'v1\n')}finally{d.srv.close()}});

test('automatic rollback: no answer twice after a self-change undoes it, tells the owner and files an issue; an answer clears the watch',async()=>{
 let up=false;const {v,d,cfg,told,filed,tick}=await make({ping:async()=>up?{ok:true}:{ok:false,why:'exit 1'}});
 try{await v.mySetting('bot','stt.language','xx',{by:'Bot'});await v.arm('bot');
  tick(4*60e3);await v.watchTick();assert.equal(cfg.stt.language,'xx');   // one miss: wait
  tick(5*60e3);await v.watchTick();assert.equal(cfg.stt.language,'id');   // second miss: rolled back
  assert.match(told[0],/stopped answering/);assert.equal(filed.length,1);
  up=true;tick(5*60e3);await v.watchTick();assert.equal((await v.load('bot')).watch,null)}finally{d.srv.close()}});

test('recordAgentChange: a change made by another agent is recorded on the target agent', async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'av-rac-'));
 const sets=[];const v=createAgentVersions({DATA,HERMES_HOME:DATA,DASH:'http://127.0.0.1:1',DASH_TOKEN:'x',listAgents:async()=>['default','bot'],nameOf:a=>a,readConfig:async()=>({}),setKey:async(a,k,val)=>{sets.push([a,k,val]);return {ok:true}},pick:()=>undefined});
 // agent-access passes by as {agent,name,level}
 await recordAgentChange({agent:'bot',kind:'settings',id:'timezone',by:{agent:'default',name:'Dora AI',level:'owner'},before:'UTC',after:'Asia/Jakarta',why:'test'});
 const d=JSON.parse(await readFile(path.join(DATA,'agent-versions','bot','index.json'),'utf8'));
 assert.equal(d.items.length,1);assert.equal(d.items[0].by,'Dora AI');assert.equal(d.items[0].target,'timezone');assert.deepEqual(d.items[0].after,{value:'Asia/Jakarta'});
 assert.ok(!/object Object/.test(d.items[0].what),d.items[0].what);assert.equal(d.items[0].kind,'setting');
 await v.undo('bot',d.items[0].id,{by:'owner'});assert.deepEqual(sets,[['bot','timezone','UTC']]);
 assert.equal(await recordAgentChange({kind:'settings'}),null);
});

test('automatic rollback of a test agent (or during a restart hold): undone and filed, but the owner is not messaged',async()=>{
 for(const q of ['test','hold']){const {v,d,cfg,told,filed,tick}=await make({ping:async()=>({ok:false,why:'exit 1'}),quiet:a=>a==='bot'?q:null});
  try{await v.mySetting('bot','stt.language','xx',{by:'Bot'});await v.arm('bot');tick(4*60e3);await v.watchTick();tick(5*60e3);await v.watchTick();
   assert.equal(cfg.stt.language,'id');assert.equal(told.length,0,q+': owner not told');assert.equal(filed.length,1)}finally{d.srv.close()}}});

test('skills: a copy equal to the shared tier coming and going is not a self-change (no undo, no watch, no rollback loop)',async()=>{
 let pings=0;const {v,d,H,tick}=await make({ping:async()=>{pings++;return {ok:false,why:'exit 1'}}});
 try{const own=path.join(H,'profiles','bot','skills','productivity','xlsx'),sh=path.join(H,'skills','productivity','xlsx');
  await mkdir(own,{recursive:true});await mkdir(sh,{recursive:true});await writeFile(path.join(sh,'SKILL.md'),'shared xlsx\n');await writeFile(path.join(own,'SKILL.md'),'shared xlsx\n');
  await v.skillsSnap('bot');
  await rm(own,{recursive:true});const [gone]=await v.skillsSnap('bot',{by:'Bot',why:'its own skill change'});
  assert.equal(gone.undoable,false);assert.match(gone.by,/shared skill copy/);assert.equal((await v.load('bot')).watch,null);
  await mkdir(own,{recursive:true});await writeFile(path.join(own,'SKILL.md'),'shared xlsx\n');const [back]=await v.skillsSnap('bot',{by:'Bot'});
  assert.equal(back.undoable,false);tick(10*60e3);await v.watchTick();assert.equal(pings,0);
  // an own copy that differs from the shared one is still the agent's change
  await writeFile(path.join(own,'SKILL.md'),'my edit\n');const [mine]=await v.skillsSnap('bot',{by:'Bot'});assert.equal(mine.undoable,true);assert.ok((await v.load('bot')).watch)}finally{d.srv.close()}});

test('watch: a ping that could not tell (engine restarting) counts no miss and never rolls back',async()=>{
 const {v,d,cfg,tick}=await make({ping:async()=>({ok:false,unsure:true,why:'restarting'})});
 try{await v.mySetting('bot','stt.language','xx',{by:'Bot'});for(let i=0;i<4;i++){tick(5*60e3);await v.watchTick()}
  assert.equal(cfg.stt.language,'xx');assert.equal((await v.load('bot')).watch.fails,0)}finally{d.srv.close()}});
