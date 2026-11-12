// Standard no-model checks for a schedule's own check hook (run-gates.mjs, point c: <home>/scripts/aqeelos-check-<job id>.sh
// prints, as its last line, {"anythingToDo": false} to stop the run before the AI starts). Each check here answers
// {count|allow, known} without a model. A check that cannot tell (no browser, not signed in, the app did not answer) is
// UNKNOWN, and an unknown never stops a run: combine() says anythingToDo=true then.
//  - unreadDms: unread chats in the agent's own signed-in Chrome, through its DevTools port (Threads has no DM API);
//  - unansweredComments: comments Tebar lists as not answered (REST GET /v1/comments, a Tebar API key);
//  - postingAllowed: the agent's posting limits (posting-limits.mjs: pause file, a day, an hour, gap) say a post may go now.
// Used by scripts/run-check.mjs, which a check script calls.
import {readFile,stat,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {decide,clean,ruleFor,entriesOf,hasSubjects,jobDecision,defaultKind,KIND_NAME} from './posting-limits.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getJson=u=>fetch(u,{signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null).catch(()=>null);

// A sleeping browser (OPS-19: scripts/agent-users.sh, scripts/wake-proxy.mjs): the first plain connection to the agent's port wakes it
// and the proxy holds that connection until Chrome answers (up to 90 s). A check that needs the browser asks first and waits for
// that answer, so it never reads a sleeping browser as 'not signed in'. fetchJson answers null when it did not come up.
export async function wakeBrowser({port,fetchJson=u=>fetch(u,{signal:AbortSignal.timeout(100000)}).then(r=>r.ok?r.json():null).catch(()=>null)}){
 if(!port)return false;const v=await fetchJson('http://127.0.0.1:'+port+'/json/version');return !!v?.webSocketDebuggerUrl}

// ---- the agent's own Chrome ------------------------------------------------------------------------------------------
// the DevTools port the agent's browser tool drives: browser.cdp_url in its config.yaml (http://127.0.0.1:9600)
export const cdpPortOf=yaml=>{const m=/^\s*cdp_url:\s*['"]?https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})/m.exec(String(yaml||''));return m?+m[1]:null};

// the unread count Threads writes into a page title: "(3) Search • Threads" (notifications and chats together)
export const titleCount=t=>{const m=/^\((\d{1,3})\+?\)/.exec(String(t||'').trim());return m?+m[1]:0};

// run in the inbox page: how many chats show an unread mark (an aria-label or test id saying unread)
export const INBOX_PROBE=`(()=>{if(/\\/(login|accounts)/.test(location.pathname))return {login:true};
 const n=new Set();for(const e of document.querySelectorAll('[aria-label],[data-testid]')){const t=((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase();
  if(/\\bunread\\b/.test(t)&&!/mark.*as unread/.test(t)){n.add(e.closest('[role="row"],[role="listitem"],a[href*="/messages/"]')||e)}}
 // Threads' own web page has no unread label (12 Nov: 104 chat links, none): an unread chat shows a small filled dot in its row
 for(const a of [...document.querySelectorAll('a[href*="/messages/"]')].slice(0,60)){for(const e of a.querySelectorAll('div,span')){const w=e.getBoundingClientRect();
  if(w.width>=5&&w.width<=14&&Math.abs(w.width-w.height)<2){const c=getComputedStyle(e);if(parseFloat(c.borderTopLeftRadius)>=w.width/2-1&&c.backgroundColor!=='rgba(0, 0, 0, 0)'){n.add(a);break}}}}
 return {login:false,count:n.size,title:document.title,rows:document.querySelectorAll('a[href*="/messages/"]').length}})()`;

// one DevTools session on a fresh tab: open it, load the page, look, close it. null when anything fails.
export async function look({port,url,probe,wait=7000,fetchJson=getJson,WS=globalThis.WebSocket}){
 const v=await fetchJson('http://127.0.0.1:'+port+'/json/version');if(!v?.webSocketDebuggerUrl)return null;
 let ws;try{ws=new WS(v.webSocketDebuggerUrl);let i=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}};
  await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('no answer')),4000);ws.onopen=()=>{clearTimeout(t);res()};ws.onerror=()=>{clearTimeout(t);rej(Error('no answer'))}});
  // each call's timer is cleared when it answers: they kept the process alive 15 s after the answer (12 Nov: a check took 22 s of the gate's 30)
  const call=(method,params={},sessionId)=>new Promise((res,rej)=>{const id=++i,t=setTimeout(()=>rej(Error('timeout')),15000);pend[id]=m=>{clearTimeout(t);res(m)};ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
  const {result:{targetId}}=await call('Target.createTarget',{url:'about:blank'});
  try{const {result:{sessionId}}=await call('Target.attachToTarget',{targetId,flatten:true});await call('Page.navigate',{url},sessionId);await sleep(wait);
   const r=await call('Runtime.evaluate',{expression:probe,returnByValue:true},sessionId);return r?.result?.result?.value??null}
  finally{await call('Target.closeTarget',{targetId}).catch(()=>{})}}
 catch{return null}finally{try{ws?.close()}catch{}}}

// unread DMs. count=null means unknown. mode: 'title' (a tab's title only, no navigation), 'inbox' (a fresh tab on the
// inbox), 'both' (the default: the larger of the two; unknown only when neither could be read)
export async function unreadDms({port,mode='both',url='https://www.threads.com/messages',fetchJson=getJson,lookFn=look,wait,wake=fetchJson===getJson?wakeBrowser:async()=>true}={}){
 if(!port)return {count:null,known:false,why:'no DevTools port for this agent'};
 if(!await wake({port}))return {count:null,known:false,why:'the browser was asleep and did not wake up'};
 const parts=[];
 if(mode!=='inbox'){const pages=await fetchJson('http://127.0.0.1:'+port+'/json/list');
  if(Array.isArray(pages)){const t=pages.filter(p=>p.type==='page'&&/threads\.(com|net)/.test(p.url||'')).map(p=>titleCount(p.title));if(t.length)parts.push({src:'title',n:Math.max(...t)})}}
 if(mode!=='title'){const r=await lookFn({port,url,probe:INBOX_PROBE,wait});if(r&&!r.login&&Number.isFinite(r.count)&&(r.rows>0||r.count>0))parts.push({src:'inbox',n:r.count})}
 if(!parts.length)return {count:null,known:false,why:'the browser did not answer or is not signed in'};
 const n=Math.max(...parts.map(p=>p.n));return {count:n,known:true,why:parts.map(p=>p.src+' '+p.n).join(', ')}}

// ---- Tebar comments --------------------------------------------------------------------------------------------------
// comments not yet answered. Tebar's REST API: GET /v1/comments?reply_status=...&account_id=... with a Bearer API key.
// The reply_status values are not in its public docs: the filter is sent, and each item is checked too (anything whose
// reply_status says it was answered is not counted).
const ANSWERED=/^(replied|answered|done|handled|hidden|deleted)$/i;
export const listOf=j=>Array.isArray(j)?j:Array.isArray(j?.data)?j.data:Array.isArray(j?.comments)?j.comments:Array.isArray(j?.items)?j.items:null;
export async function unansweredComments({key,accountId,platform,status='unreplied',base='https://api.tebar.app/v1',fetchFn=fetch}={}){
 if(!key)return {count:null,known:false,why:'no Tebar API key'};
 try{const u=new URL(base+'/comments');if(status)u.searchParams.set('reply_status',status);if(accountId)u.searchParams.set('account_id',accountId);
  const r=await fetchFn(u,{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});if(!r.ok)return {count:null,known:false,why:'Tebar answered '+r.status};
  const l=listOf(await r.json());if(!l)return {count:null,known:false,why:'Tebar answered with something that is not a list of comments'};
  const open=l.filter(c=>!ANSWERED.test(String(c?.reply_status||''))&&(!platform||String(c?.platform||'').toLowerCase()===String(platform).toLowerCase()));
  return {count:open.length,known:true,why:open.length+' unanswered comments'}}
 catch(e){return {count:null,known:false,why:'Tebar did not answer ('+e.message+')'}}}

// ---- posting limits ----------------------------------------------------------------------------------------------------
// may this agent post now: the same decision as the posting gate (app/posting-limits.mjs), read from DATA. allow=null:
// limits not switched on for this agent, so they say nothing.
export async function postingAllowed({DATA,WORK,agent,kinds=[],now=Date.now()}){let d;try{d=JSON.parse(await readFile(path.join(DATA,'posting-limits.json'),'utf8'))}catch{return {allow:null,known:false,why:'no posting limits file'}}
 const raw=d?.agents?.[agent];if(!raw?.on)return {allow:null,known:false,why:'posting limits are not on for this agent'};
 let r;try{r=clean(raw)}catch(e){return {allow:null,known:false,why:e.message}}
 let entries=[];try{entries=JSON.parse(await readFile(path.join(DATA,'posting-log',agent+'.json'),'utf8'))}catch{}
 const stopped=!!(r.stopFile&&WORK&&await stat(path.join(WORK,agent,r.stopFile)).then(()=>true,()=>false));
 // limits per kind: the run may start while any of the kinds it posts (kinds, else every kind with a rule) has room
 const ks=kinds.length?kinds:hasSubjects(r)?Object.keys(r.subjects):[defaultKind(r)],list=[];
 for(const kind of ks){const rk=ruleFor(r,kind);if(!rk){list.push({kind,d:{allow:false,n:0,reason:'there is no Run rule for '+(KIND_NAME[kind]||kind)+'.'}});continue}
  const st=!!(rk.stopFile&&WORK&&await stat(path.join(WORK,agent,rk.stopFile)).then(()=>true,()=>false));list.push({kind,d:decide(rk,entriesOf(r,entries,kind),{now,stopped:st})})}
 const j=jobDecision(list);return {allow:j.allow,known:true,why:j.allow?'room to post ('+Math.max(...list.map(x=>x.d.n))+')':list.length===1?list[0].d.reason:j.reason}}

// ---- the answer ----------------------------------------------------------------------------------------------------------
// work = checks that count things to do (any one above zero, or unknown, means there is something); need = checks that
// say whether the work may be done at all (allow=false stops the run; unknown does not).
export function combine({work=[],need=[]}){
 const reasons=[...work.map(w=>w.why),...need.map(n=>n.why)].filter(Boolean);
 const no=need.find(n=>n.known&&n.allow===false);if(no)return {anythingToDo:false,reason:no.why,detail:reasons};
 if(!work.length)return {anythingToDo:true,reason:need.length?'allowed to run: '+need.map(n=>n.why).filter(Boolean).join('; '):'no work check given',detail:reasons};
 if(work.some(w=>w.known&&w.count>0))return {anythingToDo:true,reason:'there is something waiting',detail:reasons};
 if(work.some(w=>!w.known))return {anythingToDo:true,reason:'a check could not tell, so the run goes ahead',detail:reasons};
 return {anythingToDo:false,reason:'nothing waiting: '+reasons.join('; '),detail:reasons}}

// ---- has the source changed since the last run ----------------------------------------------------------------------------
// For a schedule that every few minutes runs a script over data that only now and then changes (Continue Sales Recap and
// Biomarkers sales recap read sales-recap/feed/payments.jsonl and paid-labels.json, written when an order is paid). The
// fingerprint of each source is kept per job; a change is work. A run that failed would not come back by itself, so after a
// change the check also says go for the next `retries` calls; maxIdleMin is the safety run when nothing changed for that long.
export async function fingerprint(src,{read=readFile}={}){const f=String(src).replace(/^file:/,'');
 try{const b=await read(f);return createHash('sha1').update(b).digest('hex').slice(0,16)+':'+b.length}catch{return null}}
// state: {fp:{source:fingerprint}, left:retries still to go, lastGo:ms}. Returns {count,known,why,next}: next is the state to save.
export async function newSince({sources=[],state={},now=Date.now(),retries=3,maxIdleMin=0,fp=fingerprint}={}){
 if(!sources.length)return {count:null,known:false,why:'no source given',next:state};
 const cur={};for(const x of sources)cur[x]=await fp(x);
 const bad=sources.filter(x=>cur[x]==null);if(bad.length)return {count:null,known:false,why:'could not read '+bad.map(x=>String(x).replace(/^file:/,'').split('/').slice(-2).join('/')).join(', '),next:state};
 const old=state.fp||null,changed=old?sources.filter(x=>old[x]!==cur[x]):sources,next={fp:cur,left:state.left||0,lastGo:state.lastGo||0},many=sources.length>1?'s':'';
 if(changed.length){next.left=retries;next.lastGo=now;return {count:changed.length,known:true,why:old?changed.length+' of '+sources.length+' source'+many+' changed':'first look at '+sources.length+' source'+many,next}}
 if(next.left>0){next.left--;next.lastGo=now;return {count:1,known:true,why:'retry after the last change ('+next.left+' more)',next}}
 if(maxIdleMin>0&&now-next.lastGo>=maxIdleMin*60e3){next.lastGo=now;return {count:1,known:true,why:'nothing new for '+maxIdleMin+' min, a safety run',next}}
 return {count:0,known:true,why:'nothing new since the last run',next}}
// a safety run for any check: when the answer was "nothing" for maxIdleMin minutes, the next one says go (used where a check cannot be
// proven against a real positive, such as the DM dot). state.lastGo is when a check last said go.
export function idleSafety(result,{state={},now=Date.now(),maxIdleMin=0}={}){
 if(result.anythingToDo){return {result,next:{...state,lastGo:now}}}
 if(maxIdleMin>0&&state.lastGo&&now-state.lastGo>=maxIdleMin*60e3)return {result:{...result,anythingToDo:true,reason:'nothing waiting for '+maxIdleMin+' min, a safety run'},next:{...state,lastGo:now}};
 return {result,next:{...state,lastGo:state.lastGo||now}}}
// the per-job state file: <DATA>/run-checks/<job>.json
export const stateFile=(DATA,key)=>path.join(DATA,'run-checks',String(key).replace(/[^\w.-]+/g,'_')+'.json');
export async function loadState(DATA,key){try{return JSON.parse(await readFile(stateFile(DATA,key),'utf8'))}catch{return {}}}
export async function saveState(DATA,key,st){const f=stateFile(DATA,key);await mkdir(path.dirname(f),{recursive:true});await writeFile(f+'.tmp',JSON.stringify(st));await rename(f+'.tmp',f)}

// ---- a command that prints when there is work (12 Nov 2026) --------------------------------------------------------------
// Many schedules start the AI only to run a script that prints nothing most of the time (P&P meeting watcher, the Elkiya Close stages, the
// 4-hour check-in). The script moves in front of the model: --cmd runs it here, --agent-cmd runs it as the agent's own user inside its
// folder (the way a script-only schedule does, event-hooks.mjs). Anything printed is work; nothing printed is no work. A command that fails or
// times out is UNKNOWN (the run goes ahead). once: the same output as at the last go is not work again (a blocker already reported).
// The words of a command are plain (no shell): the check script is written by the person, never by an agent.
const WORD=/^[\w.\/=:@+,~-]+$/;
export const wordsOf=cmd=>{const t=String(cmd||'').trim().split(/\s+/).filter(Boolean);return t.length&&t.length<=16&&t.every(x=>WORD.test(x))?t:null};
export async function runCommand({cmd,as=null,timeoutSec=20,exec=null}={}){const t=wordsOf(cmd);if(!t)return {ok:false,out:'',why:'not a plain command'};
 const {execFile}=await import('node:child_process');const run=exec||((f,a,o)=>new Promise(res=>execFile(f,a,o,(e,out,err)=>res({ok:!e,out:out||'',err:err||(e?e.message:''),code:e?(e.killed?124:typeof e.code==='number'?e.code:1):0}))));
 let r;
 if(as){   // as: {user,key,dir}: ssh to the agent's own user, cd into its folder, a timeout inside as well
  const within=t.every(x=>!x.startsWith('/')&&!x.includes('..'));if(!within)return {ok:false,out:'',why:'an agent command stays inside its folder'};
  if(!/^ag-[\w-]+$/.test(String(as.user||'')))return {ok:false,out:'',why:'this agent has no own user'};
  const x=/^(python3?|bash|sh|node)$/.test(t[0])?t:[/\.py$/.test(t[0])?'python3':/\.mjs$|\.js$/.test(t[0])?'node':/\.sh$/.test(t[0])?'bash':'./'+t[0],...(/\.(py|mjs|js|sh)$/.test(t[0])?t:t.slice(1))];
  r=await exec_(exec,run,'ssh',['-i',as.key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10',as.user+'@127.0.0.1',"cd '"+as.dir+"' && timeout -k 3 "+Math.max(1,timeoutSec-3)+' '+x.join(' ')],timeoutSec)}
 else r=await exec_(exec,run,t[0],t.slice(1),timeoutSec);
 return r.ok?{ok:true,out:String(r.out||'')}:{ok:false,out:'',why:r.code===124?'it took longer than '+timeoutSec+' s':'it failed ('+String(r.err||'').trim().split('\n').pop().slice(0,120)+')'}}
const exec_=(_,run,f,a,sec)=>run(f,a,{timeout:sec*1000,encoding:'utf8',maxBuffer:2e6});
const hash=s=>createHash('sha1').update(s).digest('hex').slice(0,16);
// {count,known,why,next}: next.cmd[label] is what the state keeps for once
export async function commandWork({label,cmd,as=null,once=false,state={},timeoutSec,exec}={}){const mem={...(state.cmd||{})};
 const r=await runCommand({cmd,as,timeoutSec,exec});if(!r.ok)return {count:null,known:false,why:'the command could not tell ('+r.why+')',next:mem};
 const lines=r.out.split('\n').map(l=>l.trim()).filter(Boolean);
 if(!lines.length){delete mem[label];return {count:0,known:true,why:'the command printed nothing',next:mem}}
 const fp=hash(lines.join('\n'));
 if(once&&mem[label]===fp)return {count:0,known:true,why:'the same as at the last run, already reported',next:mem};
 mem[label]=fp;return {count:lines.length,known:true,why:'the command printed '+lines.length+' line'+(lines.length>1?'s':''),next:mem}}
