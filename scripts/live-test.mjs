#!/usr/bin/env node
// The real-life test after every deploy (8 Nov 2026, the owner's stability plan). box-live.sh runs it on the box right
// after the new version answers; when it fails, box-live.sh puts the previous version back by itself. Token-light: the only
// model call is one short reply from a throwaway test agent (and the one Kirimdev tester reply).
//   node scripts/live-test.mjs [--since <ms>] [--sha <commit>] [--only tools,schedules,engine,kirimdev,agent]
// Checks:
//   tools      every live agent's aqeelOS tool servers (aqeelos-*) answer initialize and list their tools
//   schedules  no switched-on schedule of a live agent is overdue (missed its window by more than 20 minutes)
//   engine     the engine had no unclean or failed exit since the deploy began
//   kirimdev   a signed tester message to a Test-mode Kirimdev line gets its reply sent
//   agent      the test agent answers one short message (text, and the voice note and photo once media checks are on)
// Writes the result to DATA/live-test.json (System › Health shows the latest) and exits 1 when anything failed.
import {readFile,writeFile,rename,stat,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';

const HOME=homedir(),HERMES_HOME=(process.env.HERMES_HOME||path.join(HOME,'.hermes')).replace(/^~(?=\/|$)/,HOME);
const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(HOME,'apps','hermes-ui-data'));
export const TEST_AGENT=process.env.LIVE_TEST_AGENT||'aq-livetest';
const DASH=(process.env.HERMES_DASH||'http://127.0.0.1:9119').replace(/\/$/,''),GATE=(process.env.HERMES_API||'http://127.0.0.1:8642').replace(/\/$/,'');
const UI='http://127.0.0.1:'+(Number(process.env.UI_PORT)||4400);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- pure parts (scripts/live-test.test.mjs) ---------- */
// the aqeelOS tool servers in an agent's config: name and local address
export function ownServers(config){return Object.entries(config?.mcp_servers||{}).filter(([n,e])=>/^aqeelos-/.test(n)&&e&&e.enabled!==false&&/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(e.url||''))).map(([n,e])=>({name:n,url:String(e.url)}))}
// every server must answer; aqeelos-notify must also list its tools (others list theirs only when the agent is set up for
// them, e.g. aqeelos-self once the agent has its own Linux user)
export const mustList=name=>name==='aqeelos-notify';
// schedules that missed their window: switched on, not paused, next run more than `grace` ms in the past
export function overdue(jobs,now=Date.now(),grace=20*60e3){return (jobs||[]).filter(j=>j&&j.enabled!==false&&!/paused|disabled|completed/i.test(String(j.state||''))&&j.next_run_at&&Date.parse(j.next_run_at)<now-grace)
 .map(j=>({id:j.id,name:j.name||j.id,agent:j.profile||'default',due:j.next_run_at}))}
// a new message aqeelOS sent ("ours" in kirimdev-state.json) after the test began
export const replied=(ours,since)=>Object.values(ours||{}).some(t=>Number(t)>=since);
// the reply proves the agent read the message: it carries the nonce
export const answered=(reply,nonce)=>String(reply||'').includes(nonce);
export function summary(results){const bad=results.filter(r=>!r.ok&&!r.skipped);return {ok:!bad.length,failed:bad.map(r=>r.name+': '+r.why)}}

/* ---------- the checks ---------- */
const readJson=async(f,d)=>JSON.parse(await readFile(f,'utf8').catch(()=>JSON.stringify(d)));
const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
async function liveAgents(){const test=new Set((await readFile(path.join(HERMES_HOME,'.aqeelos-test-agents'),'utf8').catch(()=>'')).split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')));
 const {agentNames}=await import('../app/agentops.mjs');const all=await agentNames({copies:true});
 return all.filter(a=>!test.has(a.split('--')[0])&&a!==(process.env.HELP_AGENT||'aqeelos-help')&&a!==TEST_AGENT)}

async function checkTools(){const {readConfig}=await import('../app/agentops.mjs');const bad=[];let n=0;
 for(const a of await liveAgents()){for(const s of ownServers(await readConfig(a).catch(()=>null))){n++;
  const h={'content-type':'application/json',accept:'application/json, text/event-stream'};
  try{const i=await fetch(s.url,{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'live-test',version:'1'}}}),signal:AbortSignal.timeout(15000)});
   const l=await fetch(s.url,{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}),signal:AbortSignal.timeout(15000)});
   const t=(await l.json().catch(()=>({}))).result?.tools||[];if(i.status!==200||l.status!==200||mustList(s.name)&&!t.length)bad.push(a+'/'+s.name+' ('+i.status+'/'+l.status+', '+t.length+' tools)')}
  catch(e){bad.push(a+'/'+s.name+' ('+e.message+')')}}}
 return bad.length?{ok:false,why:bad.join('; ')}:{ok:true,why:n+' tool servers answer'}}

async function checkSchedules(){const tok=process.env.HERMES_DASHBOARD_SESSION_TOKEN||'';
 const r=await fetch(DASH+'/api/cron/jobs?profile=all',{headers:{'x-hermes-session-token':tok},signal:AbortSignal.timeout(30000)}).catch(e=>({ok:false,status:e.message}));
 if(!r.ok)return {ok:false,why:'the engine did not list the schedules ('+r.status+')'};
 const live=new Set(await liveAgents()),j=await r.json(),late=overdue((Array.isArray(j)?j:j.jobs||[]).filter(x=>live.has(x.profile||'default')));
 return late.length?{ok:false,why:late.map(x=>x.agent+' "'+x.name+'" due '+x.due).join('; ')}:{ok:true,why:'no schedule missed its window'}}

async function checkEngine(since){const {engineEvents}=await import('../app/agent-health.mjs');
 const tail=async(f,n)=>{try{const t=await readFile(f,'utf8');return t.length>n?t.slice(-n):t}catch{return ''}};
 const e=engineEvents(await tail(path.join(HERMES_HOME,'logs','gateway-exit-diag.log'),4e5),await tail(path.join(HERMES_HOME,'logs','errors.log'),1e6),since);
 return e.unclean||e.nonzero?{ok:false,why:(e.unclean?e.unclean+' unclean exit(s) ':'')+(e.nonzero?e.nonzero+' failed exit(s)':'')}:{ok:true,why:'no unclean exit'}}

async function checkKirimdev(){const lines=(await readJson(path.join(DATA,'kirimdev.json'),{})).lines||{},secrets=await readJson(path.join(DATA,'kirimdev-secrets.json'),{});
 const {testWebhook,sign,pickTester}=await import('./kirimdev-test-message.mjs');
 // a line in Test mode with a webhook and a tester with a phone (only testers can be written to, never a customer)
 let pick=null;for(const [a,l] of Object.entries(lines)){if((l.mode||'test')!=='test'||!(secrets[a]?.secrets||[])[0])continue;try{pick={a,l,t:pickTester(l)};break}catch{}}
 if(!pick)return {skipped:true,why:'no Test-mode line with a webhook and a tester with a phone'};
 const since=Date.now(),w=testWebhook({line:pick.l,tester:pick.t,text:'aqeelOS deploy check: please reply with one short line.'});
 const r=await fetch(UI+'/kirimdev/'+pick.a,{method:'POST',headers:{'content-type':'application/json','x-kirim-event':'message.received','x-kirim-event-id':w.eid,'x-kirim-signature':sign(w.raw,secrets[pick.a].secrets[0],w.ts)},body:w.raw}).catch(e=>({ok:false,status:e.message}));
 if(!r.ok)return {ok:false,why:pick.a+' did not take the test message ('+r.status+')'};
 const wait=Math.max(60,Number(pick.l.debounceSec)||0)+240;
 for(let i=0;i<wait/5;i++){await sleep(5000);if(replied((await readJson(path.join(DATA,'kirimdev-state.json'),{})).ours,since))return {ok:true,why:pick.a+' replied to '+(pick.t.who||'the tester')}}
 return {ok:false,why:pick.a+' sent no reply within '+wait+' s'}}

// the test agent, made once: listed as a test agent FIRST (so making it never restarts the engine and nobody is alerted
// about it), then a plain profile on the main agent's model. Never a real agent.
async function ensureTestAgent(){const {isAgent,readConfig,setKey,pick}=await import('../app/agentops.mjs');if(await isAgent(TEST_AGENT))return 'ready';
 const list=path.join(HERMES_HOME,'.aqeelos-test-agents'),cur=await readFile(list,'utf8').catch(()=>'');
 if(!cur.split('\n').map(x=>x.trim()).includes(TEST_AGENT))await writeFile(list,cur+(cur&&!cur.endsWith('\n')?'\n':'')+TEST_AGENT+'\n');
 const r=await fetch(DASH+'/api/profiles',{method:'POST',headers:{'x-hermes-session-token':process.env.HERMES_DASHBOARD_SESSION_TOKEN||'','content-type':'application/json'},body:JSON.stringify({name:TEST_AGENT,description:'aqeelOS deploy check (test agent, not a real one)',clone_from_default:false,no_skills:true}),signal:AbortSignal.timeout(120000)});
 if(!r.ok)throw Error('could not make the test agent ('+r.status+')');
 const m=await readConfig('default').catch(()=>null);if(pick(m||{},'model.provider')){await setKey(TEST_AGENT,'model.provider',pick(m,'model.provider'));await setKey(TEST_AGENT,'model.default',pick(m,'model.default'))}
 return 'made'}
async function checkAgent(){const key=process.env.API_SERVER_KEY||'';const h={authorization:'Bearer '+key,'content-type':'application/json'};
 const st=await ensureTestAgent();
 // a test agent made just now may need a minute or two before the engine serves it
 let sid=null;for(let i=0;i<(st==='made'?24:3)&&!sid;i++){const s=await fetch(GATE+'/p/'+TEST_AGENT+'/api/sessions',{method:'POST',headers:h,body:'{}',signal:AbortSignal.timeout(60000)}).then(r=>r.json()).catch(()=>({}));sid=s.id||s.session?.id||s.session_id;if(!sid)await sleep(5000)}
 if(!sid)return st==='made'?{skipped:true,why:'the test agent was made now; the engine serves it from the next check'}:{ok:false,why:'the test agent could not start a chat'};
 const nonce='LT'+randomBytes(3).toString('hex').toUpperCase();
 const r=await fetch(GATE+'/p/'+TEST_AGENT+'/api/sessions/'+sid+'/chat/stream',{method:'POST',headers:h,body:JSON.stringify({message:'Deploy check. Reply with exactly this and nothing else: '+nonce}),signal:AbortSignal.timeout(180000)}).catch(e=>({ok:false,status:e.message,text:async()=>''}));
 let reply='',ev='';for(const l of String(await r.text()).split('\n')){if(l.startsWith('event:'))ev=l.slice(6).trim();else if(l.startsWith('data:')&&ev==='assistant.completed'){try{reply=JSON.parse(l.slice(5)).content||''}catch{}}}
 return answered(reply,nonce)?{ok:true,why:'the test agent answered'}:{ok:false,why:'no answer with the check word ('+String(reply).slice(0,80)+')'}}

const CHECKS={tools:checkTools,schedules:checkSchedules,engine:checkEngine,kirimdev:checkKirimdev,agent:checkAgent};

export async function run({since=Date.now()-15*60e3,sha='',only=null}={}){const results=[];
 for(const [name,fn] of Object.entries(CHECKS)){if(only&&!only.includes(name))continue;const t0=Date.now();
  let r;try{r=await fn(since)}catch(e){r={ok:false,why:e.message}}results.push({name,...r,ms:Date.now()-t0})}
 const s=summary(results),rec={at:Date.now(),sha,...s,results};
 const f=path.join(DATA,'live-test.json'),h=await readJson(f,{runs:[]});h.runs=[rec,...(h.runs||[])].slice(0,30);
 await mkdir(DATA,{recursive:true});await writeFile(f+'.tmp',JSON.stringify(h,null,1));await rename(f+'.tmp',f);return rec}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i].replace(/^--/,'')]=a[i+1];
 run({since:Number(o.since)||undefined,sha:o.sha||'',only:o.only?o.only.split(','):null}).then(r=>{
  for(const x of r.results)console.log((x.skipped?'· skipped ':x.ok?'✓ ':'✗ ')+x.name+': '+x.why+' ('+Math.round(x.ms/1000)+' s)');
  console.log(r.ok?'✓ live test passed':'✗ live test failed: '+r.failed.join(' | '));process.exit(r.ok?0:1)}).catch(e=>{console.error('✗ live test could not run: '+e.message);process.exit(1)})}
