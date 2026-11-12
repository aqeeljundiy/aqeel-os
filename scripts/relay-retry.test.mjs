// A schedule result relayed through a shared Telegram/WhatsApp channel (app/relay.mjs tick) when the provider is down while aqeelOS restarts:
// a refused send is tried again later (it used to be marked as sent first and lost), a send that a restart cut off in the middle is never
// repeated (it may have arrived), and a delivery that worked is never sent twice. A fake engine answers the engine calls the relay makes.
// (The Kirimdev WhatsApp outbox has its own restart test: scripts/kirimdev-outbox.test.mjs.)
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createServer} from 'node:http';
process.env.UI_PORT='4499';   // not the live app: no background loop
const {createRelay}=await import('../app/relay.mjs');

const state={provider:'down',hangSend:false,relayRuns:0,delivered:[],jobs:{}};
const T=new Date(Date.now()+5e3).toISOString();   // a run that finished after the relay was set up
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x'),p=u.pathname,c=[];req.on('data',x=>c.push(x));req.on('end',()=>{
 const json=(o,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(o))};let b={};try{b=JSON.parse(Buffer.concat(c).toString()||'{}')}catch{}
 if(p==='/api/cron/jobs'&&req.method==='GET')return json({jobs:[{id:'j1',name:'Weekly report',last_run_at:T,last_status:'ok'},...Object.values(state.jobs)]});
 if(p==='/api/cron/jobs'&&req.method==='POST'){const id='rj'+(++state.relayRuns);state.jobs[id]={id,name:'aqeelOS relay',deliver:b.deliver};return json({job:{id}})}
 let m=/^\/api\/cron\/jobs\/([^/]+)\/trigger$/.exec(p);
 if(m){const j=state.jobs[m[1]];if(state.hangSend)return;   // the app is cut off here: this never answers
  j.last_run_at=new Date().toISOString();if(state.provider==='up'){j.last_status='ok';state.delivered.push(b)}else{j.last_status='ok';j.last_delivery_error='telegram did not answer'}return json({ok:true})}
 if(/^\/api\/cron\/jobs\/j1\/runs$/.test(p))return json({runs:[{id:'run1'}]});
 if(/^\/api\/sessions\/run1\/messages$/.test(p))return json({messages:[{role:'assistant',content:'Sales are up 4 percent.'}]});
 if(p==='/api/pairing')return json({approved:[{platform:'telegram',user_id:'555',user_name:'Boss'}]});
 m=/^\/api\/cron\/jobs\/([^/]+)$/.exec(p);if(m&&req.method==='DELETE'){delete state.jobs[m[1]];return json({})}
 json({})})});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const DATA=await mkdtemp(path.join(tmpdir(),'relay-retry-'));
const make=()=>createRelay({DATA,DASH:'http://127.0.0.1:'+server.address().port,TOKEN:'x',HERMES_HOME:path.join(DATA,'hh'),SECRET:'s',listAgents:async()=>['default'],links:{list:async()=>[]},platformsOf:async()=>[],nameOf:a=>a,ownerName:()=>'Owner',retryMs:0});
test.after(async()=>{server.closeAllConnections();server.close();await rm(DATA,{recursive:true,force:true}).catch(()=>{})});
const quiet=async f=>{const w=console.warn;console.warn=()=>{};try{return await f()}finally{console.warn=w}};

test('a relayed result: the provider is down, the app restarts, the provider returns: delivered once, then never again',async()=>{
 let r=make();await r.setJobRelay('default','j1',{owner:'default',platform:'telegram',since:'2020-01-01T00:00:00Z'});
 await quiet(()=>r.tick());                                  // down: refused
 assert.equal(state.delivered.length,0);
 r=make();                                                    // the app restarts: the result was not marked as sent
 await quiet(()=>r.tick());assert.equal(state.delivered.length,0,'still down');
 state.provider='up';
 await quiet(()=>r.tick());assert.equal(state.delivered.length,1,'delivered when the provider is back');assert.match(JSON.stringify(state.delivered[0]),/./);
 r=make();await quiet(()=>r.tick());await quiet(()=>r.tick());assert.equal(state.delivered.length,1,'never delivered a second time');
 assert.equal(Object.keys(state.jobs).length,0,'no one-off job is left behind')});

test('a send that a restart cut off in the middle is not repeated',async()=>{
 const r1=make();await r1.setJobRelay('default','j2',{owner:'default',platform:'telegram',since:'2020-01-01T00:00:00Z'});
 // j2 does not exist in the fake engine, so the relay forgets it: use j1 again with a new run time
 state.delivered.length=0;state.provider='up';state.hangSend=true;
 const {readFile,writeFile}=await import('node:fs/promises');const f=path.join(DATA,'channel-shares.json');
 const db=JSON.parse(await readFile(f,'utf8'));db.jobs={'default|j1':{owner:'default',platform:'telegram',since:'2020-01-01T00:00:00Z'}};db.seen={};db.sending={};db.fails={};await writeFile(f,JSON.stringify(db));
 const cut=make();const pending=cut.tick().catch(()=>{});      // starts the send; the fake engine never answers (the app is killed here)
 await new Promise(r=>setTimeout(r,300));state.hangSend=false;
 const after=make();await quiet(()=>after.tick());await quiet(()=>after.tick());
 assert.equal(state.delivered.length,0,'it may have arrived, so it is not sent a second time');
 server.closeAllConnections();await pending});
