// Tests for a relayed send (app/relay.mjs, CH-8): a send that timed out on the network is tried once more; a refused one is not.
// Run: node --test scripts/relay-send.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../app/relay.mjs';

// a made-up engine: each triggered run ends with the next result in `results` (an error text, or '' for delivered)
async function engine(results){const jobs=new Map();let n=0,runs=0;
 const srv=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{const u=new URL(req.url,'http://x'),p=u.pathname,out=j=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(j))};
  if(req.method==='POST'&&p==='/api/cron/jobs'){const id='j'+(++n);jobs.set(id,{id,...JSON.parse(b)});return out({job:jobs.get(id)})}
  const t=/^\/api\/cron\/jobs\/(\w+)\/trigger$/.exec(p);if(t){const j=jobs.get(t[1]),r=results[runs++]??'';Object.assign(j,{last_run_at:new Date().toISOString()+runs,last_status:r?'error':'ok',last_error:r||null});return out({ok:true})}
  if(req.method==='GET'&&p==='/api/cron/jobs')return out({jobs:[...jobs.values()]});
  if(req.method==='DELETE'){jobs.delete(p.split('/').pop());return out({ok:true})}
  res.statusCode=404;out({})})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {DASH:'http://127.0.0.1:'+srv.address().port,runs:()=>runs,close:()=>srv.close()}}
const relay=async e=>{const H=await mkdtemp(path.join(tmpdir(),'relay-'));return createRelay({DATA:path.join(H,'data'),DASH:e.DASH,TOKEN:'t',HERMES_HOME:H,SECRET:'s',listAgents:async()=>['cove'],sendRetryMs:10})};

test('a send that timed out is tried once more and gets through',async()=>{const e=await engine(['delivery error: Telegram send failed: Timed out (target telegram:-100)','']);
 try{const r=await relay(e);assert.deepEqual(await r.send({owner:'cove',platform:'telegram',chat:'-100',text:'Halo tim'}),{ok:true});assert.equal(e.runs(),2)}finally{e.close()}});
test('a send that is refused is not tried again; two timeouts in a row give up',async()=>{
 const e=await engine(['delivery error: Telegram send failed: Chat not found']);
 try{const r=await relay(e);await assert.rejects(r.send({owner:'cove',platform:'telegram',chat:'-100',text:'x'}),/Chat not found/);assert.equal(e.runs(),1)}finally{e.close()}
 const e2=await engine(['Timed out','Timed out']);
 try{const r=await relay(e2);await assert.rejects(r.send({owner:'cove',platform:'telegram',chat:'-100',text:'x'}),/Timed out/);assert.equal(e2.runs(),2,'once more, not forever')}finally{e2.close()}});
