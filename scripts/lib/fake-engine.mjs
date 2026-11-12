// A fake engine for the end-to-end resume test (scripts/resume-e2e.test.mjs). It speaks the parts of the engine's API that aqeelOS uses for
// chat turns (POST /api/sessions/<id>/chat/stream, server-sent events), schedule runs (POST /api/cron/jobs/<id>/trigger, GET /api/status) and
// writes the engine's records where aqeelOS reads them (gateway.pid, state.db, cron/executions.db, cron/jobs.json; here as JSON, read by
// scripts/lib/e2e-preload.mjs). It can be told to hang in the middle of a turn or a run, to go down, to restart (a new process id; what was
// running is cut off and never finishes), and to refuse a provider. Everything that reaches "the outside world" (a message to a customer, a
// post, a Telegram delivery) is written to `effects`, so a test can count what went out and whether anything went out twice.
// A turn is a list of steps: {say}, {tool, outward, key, args}, {wait: ms}, {hang: true}.
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';import path from 'node:path';

export const NOTE_START='[System note from aqeelOS: you were interrupted by ';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// the engine's process runs with the app's HOME (the folder above HERMES_HOME), as the real engine does. On Linux the app's gateway watch reads
// /proc/<pid>/environ, and a process with the test runner's HOME was "an engine started with the wrong home folder": the app restarted it after
// every start, and while it restarts ready() is false and every resume pass waits. That cost seconds of real time on a slow box, which the 60x clock
// turns into minutes (12 Nov 2026, "cut again and again" on GitHub's 2-core runner)
const sleeper=home=>spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'ignore',env:{...process.env,HOME:path.dirname(home),USERPROFILE:path.dirname(home)}});

export class FakeEngine{
 constructor({home,warp=1,r0=Date.now()}){this.home=home;this.warp=warp;this.r0=r0;
  this.sessions={};this.executions=[];this.jobs=[];this.routing=[];this.effects=[];this.posts=[];this.triggers=[];this.log=[];
  this.turns=new Set();this.runs=new Set();this.down=false;this.provider={telegram:true,whatsapp:true};this.proc=null;this.gen=0;this.n=0;
  // what the fake agent does with a turn it has never seen (a person's message) and with a note from aqeelOS
  this.script=()=>[{say:'Done.'}];this.resumeSteps=null;this.resumeHangs=0;this.triggerFails=0;this.triggerHangs=false}
 vnow(){return this.r0+(Date.now()-this.r0)*this.warp}
 iso(){return new Date(this.vnow()).toISOString()}
 /* ---------- records ---------- */
 file(...p){return path.join(this.home,...p)}
 flush(){mkdirSync(this.file('cron'),{recursive:true});
  writeFileSync(this.file('state.db'),JSON.stringify({sessions:this.sessions,routing:this.routing}));
  writeFileSync(this.file('cron','executions.db'),JSON.stringify({executions:this.executions}));
  writeFileSync(this.file('cron','jobs.json'),JSON.stringify({jobs:this.jobs}))}
 async start(){this.dash=await this.listen();this.gate=await this.listen();this.proc=sleeper(this.home);this.gen=1;this.flush();this.pidFile();return this}
 pidFile(){writeFileSync(this.file('gateway.pid'),String(this.proc.pid))}
 listen(){return new Promise(r=>{const s=createServer((q,a)=>this.handle(q,a).catch(e=>{try{a.writeHead(500);a.end(String(e.message))}catch{}}));s.listen(0,'127.0.0.1',()=>r(s))})}
 get dashUrl(){return 'http://127.0.0.1:'+this.dash.address().port}
 get gateUrl(){return 'http://127.0.0.1:'+this.gate.address().port}
 async stop(){for(const s of [this.dash,this.gate])s?.close();for(const s of [this.dash,this.gate])s?.closeAllConnections?.();try{this.proc?.kill()}catch{};this.proc=null}
 /* ---------- what a test can do to the engine ---------- */
 setDown(v){this.down=!!v;if(v)for(const s of [this.dash,this.gate])s.closeAllConnections?.()}
 // the engine process restarts: new process id, every turn and run in progress is cut off and never ends
 restart(){for(const t of this.turns)t.abort();for(const r of this.runs)r.abort();
  // the cut runs keep their row and the process id of the engine that died (an id no later process can get: Windows hands ids out again at once)
  for(const x of this.executions)if(x.pid===this.proc.pid)x.pid=2e9+(++this.n);try{this.proc.kill()}catch{};this.proc=sleeper(this.home);this.gen++;this.pidFile();this.flush()}
 // a hanging turn or run goes on to its end (the engine kept working while aqeelOS was away)
 release(){for(const t of this.turns)t.release();for(const r of this.runs)r.release()}
 session(sid,source='api_server'){return this.sessions[sid]||={source,messages:[]}}
 push(sess,m){sess.messages.push({id:++this.n,timestamp:this.vnow()/1000,content:'',tool_calls:null,tool_call_id:null,...m});this.flush()}
 effect(e){this.effects.push({...e,at:this.vnow()})}
 /* ---------- HTTP ---------- */
 async handle(req,res){if(this.down){req.socket.destroy();return}
  const u=new URL(req.url,'http://x'),p=u.pathname,body=await new Promise(r=>{const c=[];req.on('data',x=>c.push(x));req.on('end',()=>r(Buffer.concat(c).toString('utf8')))});let j={};try{j=JSON.parse(body||'{}')}catch{}
  const json=(code,o)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(o))};
  if(p==='/api/status')return json(200,{gateway_running:true,gateway_state:'running',gateway_pid:this.proc.pid,active_agents:this.turns.size+this.runs.size,profiles:[{name:'default'}],gateway_platforms:{},hermes_home:this.home});
  let m=/^(?:\/p\/([^/]+))?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p);if(m&&req.method==='POST')return this.chat(req,res,decodeURIComponent(m[2]),j);
  m=/^\/api\/cron\/jobs\/([^/]+)\/trigger$/.exec(p);if(m&&req.method==='POST'){const id=decodeURIComponent(m[1]);this.triggers.push({job:id,at:this.vnow(),agent:u.searchParams.get('profile')});
   if(this.triggerFails>0){this.triggerFails--;return json(503,{error:'engine busy'})}if(!this.jobs.some(x=>x.id===id))return json(404,{error:'no such job'});this.startRun(id);return json(200,{ok:true})}
  if(p==='/api/cron/jobs'&&req.method==='GET')return json(200,this.jobs);
  json(200,{})}
 /* ---------- a chat turn ---------- */
 async chat(req,res,sid,body){const sess=this.session(sid),msg=typeof body.message==='string'?body.message:(body.message||[]).map(x=>x.text||'').join('\n'),isNote=msg.startsWith(NOTE_START);
  this.posts.push({sid,text:msg,note:isNote,at:this.vnow(),gen:this.gen});this.push(sess,{role:'user',content:msg});
  const t={sid,aborted:false,abort(){t.aborted=true;t.wake?.()},release(){t.wake?.()},res};this.turns.add(t);
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});const ev=(type,d={})=>{if(!res.destroyed&&!res.writableEnded)res.write('event: '+type+'\ndata: '+JSON.stringify({type,...d})+'\n\n')};
  ev('run.started',{run_id:'run-'+(++this.n)});
  try{
   let steps;if(isNote){sess.resumes=(sess.resumes||0)+1;steps=this.resumeSteps?this.resumeSteps(sess,msg):(sess.steps||[]).filter(s=>!s.hang);if(this.resumeHangs>0){this.resumeHangs--;steps=[{tool:'read_file',key:'again-'+(++this.n)},{hang:true}]}}
   else{steps=this.script(msg,sess);sess.steps=steps}
   for(const s of steps){if(t.aborted)return;
    if(s.say){ev('assistant.delta',{delta:s.say});this.push(sess,{role:'assistant',content:s.say})}
    else if(s.wait)await Promise.race([sleep(s.wait),new Promise(r=>t.wake=r)]);
    else if(s.hang){await new Promise(r=>t.wake=r);if(t.aborted)return}
    else if(s.tool){const id='call-'+(++this.n),done=sess.messages.some(x=>x.role==='assistant'&&String(x.tool_calls||'').includes('"key":"'+s.key+'"'));
     // a step the history already shows is not done again (the agent reads its own history, as the note asks)
     if(s.key&&s.outward&&this.effects.some(e=>e.key===s.key))continue;if(done&&!s.outward)continue;
     this.push(sess,{role:'assistant',tool_calls:JSON.stringify([{id,function:{name:s.tool},key:s.key}])});ev('tool.started',{name:s.tool});
     if(s.hangOpen){await new Promise(r=>t.wake=r);if(t.aborted)return}
     if(s.outward)this.effect({kind:'outward',tool:s.tool,key:s.key,sid,...(s.args||{})});await sleep(s.ms||20);if(t.aborted)return;
     this.push(sess,{role:'tool',tool_call_id:id,content:'ok'});ev('tool.completed',{name:s.tool})}}
   if(t.aborted)return;ev('run.completed');
  }finally{this.turns.delete(t);if(!res.writableEnded)res.end()}}
 /* ---------- a schedule run ---------- */
 // the engine's own scheduler fires a job (or aqeelOS's "run now" does): a row in the engine's ledger, a result, a delivery
 startRun(jobId,{hang=false}={}){const job=this.jobs.find(x=>x.id===jobId)||{id:jobId,name:jobId},row={id:'x'+(++this.n),job_id:jobId,status:'running',pid:this.proc.pid,claimed_at:this.iso(),error:'',delivery_outcome:null};
  this.executions.push(row);this.flush();const r={abort(){r.aborted=true;r.wake?.()},release(){r.wake?.()}};this.runs.add(r);
  (async()=>{try{if(hang||job.hang){await new Promise(x=>r.wake=x)}else await sleep(job.ms||60);if(r.aborted)return;
    this.effect({kind:'job-work',job:jobId,exec:row.id});row.status='completed';
    if(job.deliver){const ok=this.provider[job.deliver];this.effect({kind:'delivery',platform:job.deliver,job:jobId,exec:row.id,ok});row.delivery_outcome=ok?'delivered':'failed';if(!ok)row.delivery_error=job.deliver+' did not answer'}
    this.flush()}finally{this.runs.delete(r)}})();return row}
 hangingRun(jobId){return this.startRun(jobId,{hang:true})}
 /* ---------- a Telegram / WhatsApp chat the restart cut off ---------- */
 // the engine marks the chat (gateway_routing.resume_pending) and carries on from the person's last message once it can answer on the provider
 markChannelCut(key,sid,platform='telegram'){this.routing=this.routing.filter(r=>r.session_key!==key);
  this.routing.push({session_key:key,updated_at:this.vnow()/1000,entry_json:JSON.stringify({origin:{platform},platform,session_id:sid,resume_pending:true,resume_reason:'restart_timeout',last_resume_marked_at:this.iso()})});this.flush()}
 // true when it could (the provider answered): the reply goes out once and the mark is cleared
 channelCarryOn(key,platform='telegram'){if(!this.provider[platform])return false;const r=this.routing.find(x=>x.session_key===key);if(!r)return false;
  this.effect({kind:'channel-reply',platform,key,ok:true});r.entry_json=JSON.stringify({...JSON.parse(r.entry_json),resume_pending:false});this.flush();return true}
 cleanup(){rmSync(this.home,{recursive:true,force:true})}
}
