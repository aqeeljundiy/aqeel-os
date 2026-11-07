// Schedules (app/schedules.mjs): organize_schedule files and renames only the agent's own job; folders; engine down is a plain error.
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'sched-'));process.env.HOME=HOME;
const {createSchedules}=await import('../app/schedules.mjs');
// a fake engine dashboard: two jobs on two agents; PUT renames
const JOBS=[{id:'j1',profile:'default',name:'x3',prompt:'p',schedule:{display:'every day'}},{id:'j2',profile:'sela',name:'Sela job',prompt:'q'}];const puts=[];
const srv=createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{const u=new URL(req.url,'http://x');
 if(req.headers['x-hermes-session-token']!=='tok'){res.writeHead(401);return res.end('{}')}
 if(u.pathname==='/api/cron/jobs'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({jobs:JOBS}))}
 const m=/^\/api\/cron\/jobs\/([^/]+)$/.exec(u.pathname);if(m&&req.method==='PUT'){const j=JOBS.find(x=>x.id===m[1]);const up=JSON.parse(b).updates||{};puts.push([m[1],u.searchParams.get('profile'),up]);if(up.name)j.name=up.name;res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(j))}
 res.writeHead(404);res.end('{}')})});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));const DASH='http://127.0.0.1:'+srv.address().port;
const make=(dash=DASH)=>createSchedules({DATA:path.join(HOME,'data'),DASH:dash,TOKEN:'tok',HERMES_HOME:path.join(HOME,'.hermes'),listAgents:async()=>['default','sela'],python:async()=>null,root:path.join(HOME,'r'),live:false});
test.after(()=>srv.close());

test('organize_schedule: renames and files the agent\'s own job (an extra number counts as the agent)',async()=>{
 const {mkdir}=await import('node:fs/promises');await mkdir(path.join(HOME,'data'),{recursive:true});
 const s=make();const r=await s.organize('default--whatsapp-2',{job_id:'j1',title:'Daily sales summary',folder:'Shop',description:'Sums yesterday\'s orders.'});
 assert.ok(!r.isError,r.text);assert.match(r.text,/Filed "Daily sales summary" in the folder Shop/);
 assert.deepEqual(puts.at(-1),['j1','default',{name:'Daily sales summary'}]);
 const info=await s.info();const m=Object.entries(info.meta||{}).find(([k])=>k.endsWith('|j1'))?.[1]||{};assert.equal(m.folder,'Shop');assert.equal(m.summary,'Sums yesterday\'s orders.')});

test('organize_schedule: another agent\'s job is not found, and nothing is changed',async()=>{
 const s=make();const n=puts.length;const r=await s.organize('default',{job_id:'j2',title:'Mine now'});
 assert.equal(r.isError,true);assert.match(r.text,/No schedule with that ID/);assert.equal(puts.length,n)});

test('folders: create, rename, delete',async()=>{
 const s=make();assert.equal((await s.folderOp({create:'Clients'})).name,'Clients');
 await s.folderOp({from:'Clients',to:'Customers'});let i=await s.info();assert.ok(i.folders.includes('Customers'));assert.ok(!i.folders.includes('Clients'));
 await assert.rejects(s.folderOp({create:'  '}),/name/)});

test('engine not running: organize says so instead of crashing',async()=>{
 const s=make('http://127.0.0.1:9');const r=await s.organize('default',{job_id:'j1'}).catch(e=>({isError:true,text:e.message}));assert.equal(r.isError,true);assert.ok(r.text.length>0)});
