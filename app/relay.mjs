// Shared channels: one agent owns (and receives on) a WhatsApp/Telegram connection; agents you allow can SEND
// through it. A message is relayed by the owner agent with a one-off "no agent" job: a tiny script prints the
// text, the engine delivers it to the chosen chat, then the job and script are removed. No AI runs, no tokens.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {randomBytes,createHmac} from 'node:crypto';
import path from 'node:path';

export function createRelay({DATA,DASH,TOKEN,HERMES_HOME,SECRET,listAgents}){
 const FILE=path.join(DATA,'channel-shares.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.shares||={};db.jobs||={};db.seen||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json'}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const q=a=>'?profile='+encodeURIComponent(a);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const key=(owner,platform)=>owner+'|'+platform;

 // people the owner agent may message on that platform: the ones approved under Pairing
 async function recipients(owner,platform){try{const p=await api('/pairing'+q(owner));return (p.approved||[]).filter(x=>x.platform===platform).map(x=>({id:String(x.user_id),name:x.user_name||String(x.user_id)}))}catch{return []}}

 async function send({owner,platform,chat,text,from}){
  if(!/^[a-z_]{2,30}$/.test(platform))throw new Error('Unknown channel');
  const body=(from&&from!==owner?'['+from+'] ':'')+String(text||'').slice(0,4000);if(!String(text||'').trim())throw new Error('Nothing to send');
  const name='aqeelos-relay-'+randomBytes(5).toString('hex')+'.py';const dir=path.join(homeOf(owner),'scripts');await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,name),'print('+JSON.stringify(body)+')\n',{mode:0o600});
  let job;try{const r=await api('/cron/jobs'+q(owner),{method:'POST',body:JSON.stringify({name:'aqeelOS relay',schedule:'0 3 1 1 *',no_agent:true,script:name,deliver:platform+':'+chat})});job=r.job||r;
   if(!job?.id)throw new Error('The engine did not accept the relay job');
   const before=job.last_run_at||null;await api('/cron/jobs/'+job.id+'/trigger'+q(owner),{method:'POST',body:'{}'});
   for(let i=0;i<40;i++){await sleep(1500);const l=await api('/cron/jobs'+q(owner)).catch(()=>[]);const j=(Array.isArray(l)?l:l.jobs||[]).find(x=>x.id===job.id);
    if(j&&j.last_run_at&&j.last_run_at!==before){if(j.last_status&&j.last_status!=='ok')throw new Error('Not sent: '+(j.last_error||j.last_delivery_error||j.last_status));if(j.last_delivery_error)throw new Error('Not delivered: '+j.last_delivery_error);return {ok:true}}}
   throw new Error('The channel did not confirm in time')}
  finally{if(job?.id)await api('/cron/jobs/'+job.id+q(owner),{method:'DELETE'}).catch(()=>{});await rm(path.join(dir,name),{force:true})}}

 /* settings: for each owner|platform, which agents may send and who receives by default */
 async function shares(){await load();return db.shares}
 async function setShare(owner,platform,b){await load();const k=key(owner,platform);const agents=await listAgents();
  db.shares[k]={senders:(Array.isArray(b.senders)?b.senders:[]).filter(a=>agents.includes(a)&&a!==owner),chat:String(b.chat||'').slice(0,80)};if(!db.shares[k].senders.length&&!db.shares[k].chat)delete db.shares[k];await save();return db.shares[k]||null}
 async function channelsFor(agent){await load();return Object.entries(db.shares).filter(([k,v])=>v.senders.includes(agent)||k.startsWith(agent+'|')).map(([k,v])=>{const [owner,platform]=k.split('|');return {owner,platform,chat:v.chat}})}
 // an agent sends through a shared channel
 async function sendAs(from,owner,platform,text,chat){await load();const s=db.shares[key(owner,platform)];
  if(from!==owner&&!(s&&s.senders.includes(from)))throw new Error(from+' may not send through '+owner+"'s "+platform+'.');
  const to=chat||s?.chat||(await recipients(owner,platform))[0]?.id;if(!to)throw new Error('Nobody to send to yet: approve someone on that channel first.');
  return send({owner,platform,chat:to,text,from})}

 /* schedules that deliver through a shared channel: their results are relayed after each run */
 async function setJobRelay(agent,jobId,target){await load();const k=agent+'|'+jobId;if(target){db.jobs[k]={...target,since:db.jobs[k]?.since||new Date().toISOString()}}else{delete db.jobs[k];delete db.seen[k]}await save()}
 const ts=v=>v==null?0:typeof v==='number'?(v<1e12?v*1000:v):(Date.parse(v)||0);
 async function jobRelays(){await load();return db.jobs}
 async function tick(){await load();for(const [k,t] of Object.entries(db.jobs)){const [agent,jobId]=k.split('|');try{
   if(!(await listAgents()).includes(agent)){delete db.jobs[k];delete db.seen[k];await save();continue}
   const l=await api('/cron/jobs'+q(agent));const j=(Array.isArray(l)?l:l.jobs||[]).find(x=>x.id===jobId);if(!j){delete db.jobs[k];await save();continue}
   if(!j.last_run_at||ts(j.last_run_at)<=ts(db.seen[k]||t.since))continue;
   // the run is finished only once it has a status and its answer is saved; until then try again next tick (give up after 15 min)
   const late=Date.now()-ts(j.last_run_at)>15*60e3;const done=async()=>{db.seen[k]=j.last_run_at;await save()};
   if(!j.last_status){if(late)await done();continue}
   const runs=await api('/cron/jobs/'+jobId+'/runs'+q(agent)).catch(()=>({runs:[]}));const run=(runs.runs||[])[0];
   const m=run?await api('/sessions/'+encodeURIComponent(run.id||run.session_id)+'/messages'+q(agent)+'&limit=6&order=latest').catch(()=>({})):{};
   const last=(m.messages||m||[]).find?.(x=>x.role==='assistant'&&typeof x.content==='string'&&x.content.trim());
   const text=last?.content||(j.last_status!=='ok'?'did not run: '+(j.last_error||j.last_status):'');
   if(!text){if(late)await done();continue}
   await done();await sendAs(agent,t.owner,t.platform,(j.name?j.name+': ':'')+text,null);console.log('relay sent',k,'to',t.owner+'|'+t.platform)}catch(e){console.warn('relay tick',k,e.message)}}}
 setInterval(()=>tick().catch(()=>{}),45000).unref();

 /* the "notify me" tool agents call: a tiny MCP server, one address per agent, signed so only that agent uses it */
 const sig=a=>createHmac('sha256',SECRET).update('relay:'+a).digest('base64url').slice(0,32);
 async function mcp(agent,token,msg){if(token!==sig(agent))return {status:403,body:{error:'bad token'}};
  const reply=result=>({status:200,body:{jsonrpc:'2.0',id:msg.id,result}});
  if(msg.method==='initialize')return reply({protocolVersion:msg.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos-notify',version:'1.0.0'}});
  if(msg.method==='notifications/initialized'||msg.id==null)return {status:202,body:null};
  if(msg.method==='tools/list'){const ch=await channelsFor(agent);return reply({tools:[{name:'send_to_person',description:'Send a message to the person on WhatsApp/Telegram through a shared channel (no reply comes back to you; the channel owner receives replies). Channels you may use: '+(ch.map(c=>c.platform+' via '+c.owner).join(', ')||'none yet'),
   inputSchema:{type:'object',properties:{text:{type:'string',description:'The message'},channel:{type:'string',description:'e.g. "whatsapp" or "telegram via default"; optional when there is only one'}},required:['text']}}]})}
  if(msg.method==='tools/call'){const a=msg.params?.arguments||{};const ch=await channelsFor(agent);const want=String(a.channel||'').toLowerCase();
   const c=ch.find(c=>!want||want.includes(c.platform)&&(!/ via /.test(want)||want.endsWith(c.owner)))||null;
   if(!c)return reply({content:[{type:'text',text:'No shared channel matches. Available: '+(ch.map(c=>c.platform+' via '+c.owner).join(', ')||'none')}],isError:true});
   try{await sendAs(agent,c.owner,c.platform,a.text,null);return reply({content:[{type:'text',text:'Sent on '+c.platform+'.'}]})}catch(e){return reply({content:[{type:'text',text:e.message.startsWith('Not ')?e.message:'Not sent: '+e.message}],isError:true})}}
  return {status:200,body:{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}}}}
 return {recipients,send,sendAs,shares,setShare,setJobRelay,jobRelays,mcp,sig};
}
