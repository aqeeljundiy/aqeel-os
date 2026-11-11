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
import {providerUnavailable,readHold} from '../app/provider-limits.mjs';

const HOME=homedir(),HERMES_HOME=(process.env.HERMES_HOME||path.join(HOME,'.hermes')).replace(/^~(?=\/|$)/,HOME);
const DATA=path.resolve(process.env.UI_DATA_DIR||path.join(HOME,'apps','hermes-ui-data'));
// run from a shell (box-live.sh, the fixer) the engine's gateway key and dashboard token are not in the environment: read them from the engine's own .env like the app does (else every call answers 401)
{const {engineKeys}=await import('../app/install.mjs');const k=engineKeys();for(const n of ['API_SERVER_KEY','HERMES_DASHBOARD_SESSION_TOKEN'])if(!process.env[n]&&k[n])process.env[n]=k[n]}
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
// the AI provider was not available (rate limit, account used up, no model reachable: "I couldn't reach any of my models just now"): the test says nothing about the deploy. Skipped, not failed, so no rollback; the result says when to try again.
export function providerPause(reply,body,nonce,now=Date.now()){if(answered(reply,nonce))return null;const lim=providerUnavailable(String(reply||'').trim()?reply:body,{now,strict:!!String(reply||'').trim()});
 return lim?{skipped:true,inconclusive:true,resetAt:lim.resetAt,why:'the AI provider is not available ('+lim.kind+'), so the test agent was not checked: '+String(lim.why).slice(0,120)}:null}
export const answered=(reply,nonce)=>String(reply||'').includes(nonce);
// the voice clip says "Deploy check. The word is orange."; the picture is plain red
export const heard=t=>/\borange\b/i.test(String(t||''));
export const sawRed=t=>/\bred\b/i.test(String(t||''));
// why the test agent could not be used. "setup": the test agent itself is not ready (no key, no profile, its model not
// signed in): reported, never a reason to undo a good deploy. "fail": a set-up agent cannot answer: a real failure.
export function startFault(status,text=''){const t=String(text);
 if(status===401||status===403||status===404||/API_SERVER_KEY|gateway_auth_error|profile[^\n]*not found|no (?:such )?profile/i.test(t))return 'setup';
 if(/no (?:model|provider|credentials)|not (?:authenticated|configured|signed in)|unknown provider|plugin[^\n]*not (?:enabled|found)/i.test(t))return 'setup';
 return 'fail'}
// OPS-6 (11 Nov 2026): what rests on a model's choices (the test agent answered, but not with the check word or the
// picture's colour) is reported, never a reason to undo a deploy: such results carry advisory and do not count
export function summary(results){const bad=results.filter(r=>!r.ok&&!r.skipped&&!r.advisory);return {ok:!bad.length,failed:bad.map(r=>r.name+': '+r.why)}}
export const warnings=results=>results.filter(r=>!r.ok&&!r.skipped&&r.advisory).map(r=>r.name+': '+r.why);
// a failed check gets one more try before it counts (10 Nov 2026: misses on a busy box that passed when run alone)
export async function withRetry(fn,arg,{wait=15000}={}){let r;try{r=await fn(arg)}catch(e){r={ok:false,why:e.message}}
 if(r.ok||r.skipped||r.advisory)return r;const first=r.why;await sleep(wait);
 try{r=await fn(arg)}catch(e){r={ok:false,why:e.message}}return {...r,tries:2,...(r.ok?{first}:{})}}

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
// what every new agent gets from aqeelOS's own setup (accounts.mjs): the gateway key in its .env, and the plugin of its model.
// Run each time, so a test agent made before this existed gets them too. Returns true when something was added.
async function equipTestAgent(){const {editEnv,readConfig,pick,hermes}=await import('../app/agentops.mjs');const {cp,mkdir:mk}=await import('node:fs/promises');
 const dir=homeOf(TEST_AGENT),key=process.env.API_SERVER_KEY||'';let changed=false;
 // a parked test agent is not served ("Unknown or unconfigured profile"): on Elkiya a `hermes -p aq-livetest gateway stop`
 // on 9 Nov 2026 left gateway.parked, and every live test since skipped its agent check (OPS-9). The engine's own start
 // takes the marker away and serves the profile from the running engine; nothing restarts.
 if(await stat(path.join(dir,'gateway.parked')).then(()=>true,()=>false)){const r=await hermes(TEST_AGENT,['gateway','start'],{timeout:120000,retries:1});
  if(r?.ok===false||await stat(path.join(dir,'gateway.parked')).then(()=>true,()=>false))throw Error('could not unpark it: '+String(r?.err||r?.out||'').slice(0,120));changed=true}
 if(key&&!/^API_SERVER_KEY=/m.test(await readFile(path.join(dir,'.env'),'utf8').catch(()=>''))){await editEnv(path.join(dir,'.env'),cur=>/^API_SERVER_KEY=/m.test(cur)?null:cur+(cur&&!cur.endsWith('\n')?'\n':'')+'API_SERVER_KEY='+key+'\n');changed=true}
 const main=await readConfig('default').catch(()=>null)||{},me=await readConfig(TEST_AGENT).catch(()=>null)||{},plugins=pick(main,'plugins.enabled')||[],want=String(pick(me,'model.provider')||'');
 const pl=plugins.find(p=>p===want||String(p).startsWith(want));
 if(pl&&!(pick(me,'plugins.enabled')||[]).includes(pl)){await mk(path.join(dir,'plugins'),{recursive:true});await cp(path.join(HERMES_HOME,'plugins',pl),path.join(dir,'plugins',pl),{recursive:true}).catch(()=>{});await cp(path.join(HERMES_HOME,'plugins','.install-metadata.json'),path.join(dir,'plugins','.install-metadata.json')).catch(()=>{});
  const r=await hermes(TEST_AGENT,['plugins','enable',pl],{timeout:150000,retries:2});if(r?.ok===false)throw Error('could not turn the model plugin on: '+String(r.err||'').slice(0,120));changed=true}
 return changed}
// 12 Nov 2026: when the app already knows the AI provider is unavailable (DATA/provider-hold.json, app/provider-limits.mjs), the test
// agent is not asked: that call would start a model only to learn what is known. Skipped and inconclusive, never a failure.
export const holdSkip=(h,now=Date.now())=>h&&h.until>now?{skipped:true,inconclusive:true,resetAt:h.until,why:'the AI provider is on hold ('+String(h.why||h.kind||'unavailable').slice(0,100)+') until '+new Date(h.until).toISOString().slice(11,16)+' UTC, so the test agent was not asked'}:null;
async function checkAgent(){{const s=holdSkip(readHold(DATA));if(s)return s}const key=process.env.API_SERVER_KEY||'';const h={authorization:'Bearer '+key,'content-type':'application/json'};
 const st=await ensureTestAgent();let fresh=st==='made';
 try{if(await equipTestAgent())fresh=true}catch(e){return {skipped:true,setup:true,why:'the test agent is not set up: '+e.message}}
 // a test agent made or equipped just now may need a minute or two before the engine serves it
 let sid=null,last={status:0,text:''};for(let i=0;i<(fresh?24:3)&&!sid;i++){const x=await fetch(GATE+'/p/'+TEST_AGENT+'/api/sessions',{method:'POST',headers:h,body:'{}',signal:AbortSignal.timeout(60000)}).catch(e=>({status:0,text:async()=>e.message}));
  const t=await x.text();last={status:x.status,text:t};let j={};try{j=JSON.parse(t)}catch{}sid=j.id||j.session?.id||j.session_id;if(!sid)await sleep(5000)}
 if(!sid){const why=' ('+(last.status||'no answer')+': '+String(last.text).slice(0,120)+')';return fresh||startFault(last.status,last.text)==='setup'?{skipped:true,setup:true,why:'the test agent is not set up'+why}:{ok:false,why:'the test agent could not start a chat'+why}}
 const nonce='LT'+randomBytes(3).toString('hex').toUpperCase(),png=(await readFile(new URL('./fixtures/live-test-red.png',import.meta.url))).toString('base64');
 // one short reply, on the chat route that takes a picture: the check word and the picture's colour
 const r=await fetch(GATE+'/p/'+TEST_AGENT+'/v1/chat/completions',{method:'POST',headers:h,signal:AbortSignal.timeout(180000),body:JSON.stringify({model:'default',stream:false,messages:[{role:'user',content:[
  {type:'text',text:'Deploy check. Reply with exactly two words and nothing else: '+nonce+' and then the main colour of this picture.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+png}}]}]})}).catch(e=>({ok:false,status:e.message,json:async()=>({})}));
 const body=await r.text().catch(()=>'');let reply='';try{reply=JSON.parse(body).choices?.[0]?.message?.content||''}catch{}
 {const p=providerPause(reply,body,nonce);if(p)return p}
 if(!r.ok&&startFault(r.status,body)==='setup')return {skipped:true,setup:true,why:'the test agent is not set up ('+r.status+': '+body.slice(0,120)+')'};
 if(answered(reply,nonce)&&!sawRed(reply))return {ok:false,advisory:true,why:'the test agent answered but did not name the colour of the picture ('+String(reply).slice(0,80)+')'};
 if(answered(reply,nonce))return {ok:true,why:'the test agent answered and saw the picture'};
 // an answer without the check word is the model's choice (reported); no answer at all is a real failure
 return String(reply).trim()?{ok:false,advisory:true,why:'the test agent answered without the check word ('+String(reply).slice(0,80)+')'}:{ok:false,why:'the test agent gave no answer ('+r.status+': '+body.slice(0,80)+')'}}

// voice notes and photos (8 Nov 2026, with the stability fix): the engine's media fixes are in place and no download failed
// since the deploy (media-check.sh); the engine's own tests for a replied-to voice note and the download retries pass;
// and a real voice clip (fixtures/live-test-voice.wav, "Deploy check. The word is orange.") transcribes with the engine's
// local whisper (no tokens). The photo goes to the test agent with its one reply (checkAgent).
async function checkMedia(since){const {execFile}=await import('node:child_process');const {python}=await import('../app/agentops.mjs');
 const run=(c,a,o={})=>new Promise(res=>execFile(c,a,{timeout:300000,maxBuffer:4e6,...o},(e,out,err)=>res({ok:!e,out:String(out||'')+String(err||'')})));
 const here=path.dirname(new URL(import.meta.url).pathname),E=path.join(HERMES_HOME,'hermes-agent'),py=await python();if(!py)return {ok:false,why:'the engine’s Python was not found'};
 const t=new Date(since).toISOString().slice(0,16).replace('T',' ');
 const mc=await run('bash',[path.join(here,'media-check.sh'),t]);if(!mc.ok)return {ok:false,why:'media-check: '+mc.out.split('\n').filter(l=>/✗|failed for good: [1-9]/.test(l)).join('; ').slice(0,300)};
 const ut=await run(py,['-I',path.join(here,'engine-fixes.test.py')],{env:{...process.env,ENGINE_FIXED:E}});if(!ut.ok)return {ok:false,why:'engine media tests failed: '+ut.out.split('\n').slice(-4).join(' ').slice(0,300)};
 const tx=await run(py,['-c','import sys,json;sys.path.insert(0,sys.argv[1]);from tools.transcription_tools import transcribe_audio;print(json.dumps(transcribe_audio(sys.argv[2])))',E,path.join(here,'fixtures','live-test-voice.wav')],{cwd:E});
 let j={};try{j=JSON.parse(tx.out.split('\n').filter(l=>l.trim().startsWith('{')).pop())}catch{}   // stderr comes along: take the JSON line, not the last line
 return heard(j.transcript)?{ok:true,why:'media fixes in place, engine media tests pass, a voice note transcribes ("'+String(j.transcript).slice(0,60)+'")'}:{ok:false,why:'the voice note did not transcribe ('+String(j.transcript||j.error||tx.out).slice(0,120)+')'}}

const CHECKS={tools:checkTools,schedules:checkSchedules,engine:checkEngine,media:checkMedia,kirimdev:checkKirimdev,agent:checkAgent};

export async function run({since=Date.now()-15*60e3,sha='',only=null}={}){const results=[];
 for(const [name,fn] of Object.entries(CHECKS)){if(only&&!only.includes(name))continue;const t0=Date.now();
  const r=await withRetry(fn,since);results.push({name,...r,ms:Date.now()-t0})}
 const s=summary(results),rec={at:Date.now(),sha,...s,warned:warnings(results),inconclusive:results.filter(r=>r.inconclusive).map(r=>r.name+': '+r.why),retryAfter:Math.max(0,...results.filter(r=>r.inconclusive&&r.resetAt).map(r=>r.resetAt))||undefined,setup:results.filter(r=>r.setup).map(r=>r.why),results};
 const f=path.join(DATA,'live-test.json'),h=await readJson(f,{runs:[]});h.runs=[rec,...(h.runs||[])].slice(0,30);
 await mkdir(DATA,{recursive:true});await writeFile(f+'.tmp',JSON.stringify(h,null,1));await rename(f+'.tmp',f);return rec}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i].replace(/^--/,'')]=a[i+1];
 run({since:Number(o.since)||undefined,sha:o.sha||'',only:o.only?o.only.split(','):null}).then(r=>{
  for(const x of r.results)console.log((x.setup?'! setup ':x.skipped?'· skipped ':x.ok?'✓ ':x.advisory?'! reported, not counted: ':'✗ ')+x.name+': '+x.why+(x.tries?(x.ok?' (second try; first: '+String(x.first).slice(0,120)+')':' (tried twice)'):'')+' ('+Math.round(x.ms/1000)+' s)');
  console.log(r.ok?'✓ live test passed':'✗ live test failed: '+r.failed.join(' | '));process.exit(r.ok?0:1)}).catch(e=>{console.error('✗ live test could not run: '+e.message);process.exit(1)})}
