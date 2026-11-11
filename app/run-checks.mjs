// Standard no-model checks for a schedule's own check hook (run-gates.mjs, point c: <home>/scripts/aqeelos-check-<job id>.sh
// prints, as its last line, {"anythingToDo": false} to stop the run before the AI starts). Each check here answers
// {count|allow, known} without a model. A check that cannot tell (no browser, not signed in, the app did not answer) is
// UNKNOWN, and an unknown never stops a run: combine() says anythingToDo=true then.
//  - unreadDms: unread chats in the agent's own signed-in Chrome, through its DevTools port (Threads has no DM API);
//  - unansweredComments: comments Tebar lists as not answered (REST GET /v1/comments, a Tebar API key);
//  - postingAllowed: the agent's posting limits (posting-limits.mjs: pause file, a day, an hour, gap) say a post may go now.
// Used by scripts/run-check.mjs, which a check script calls.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {decide,clean} from './posting-limits.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getJson=u=>fetch(u,{signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null).catch(()=>null);

// ---- the agent's own Chrome ------------------------------------------------------------------------------------------
// the DevTools port the agent's browser tool drives: browser.cdp_url in its config.yaml (http://127.0.0.1:9600)
export const cdpPortOf=yaml=>{const m=/^\s*cdp_url:\s*['"]?https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})/m.exec(String(yaml||''));return m?+m[1]:null};

// the unread count Threads writes into a page title: "(3) Search • Threads" (notifications and chats together)
export const titleCount=t=>{const m=/^\((\d{1,3})\+?\)/.exec(String(t||'').trim());return m?+m[1]:0};

// run in the inbox page: how many chats show an unread mark (an aria-label or test id saying unread)
export const INBOX_PROBE=`(()=>{if(/\\/(login|accounts)/.test(location.pathname))return {login:true};
 const n=new Set();for(const e of document.querySelectorAll('[aria-label],[data-testid]')){const t=((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase();
  if(/\\bunread\\b/.test(t)&&!/mark.*as unread/.test(t)){n.add(e.closest('[role="row"],[role="listitem"],a[href*="/messages/"]')||e)}}
 return {login:false,count:n.size,title:document.title,rows:document.querySelectorAll('a[href*="/messages/"]').length}})()`;

// one DevTools session on a fresh tab: open it, load the page, look, close it. null when anything fails.
export async function look({port,url,probe,wait=7000,fetchJson=getJson,WS=globalThis.WebSocket}){
 const v=await fetchJson('http://127.0.0.1:'+port+'/json/version');if(!v?.webSocketDebuggerUrl)return null;
 let ws;try{ws=new WS(v.webSocketDebuggerUrl);let i=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}};
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(Error('no answer'));setTimeout(()=>rej(Error('no answer')),4000)});
  const call=(method,params={},sessionId)=>new Promise((res,rej)=>{const id=++i;pend[id]=res;setTimeout(()=>rej(Error('timeout')),15000);ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
  const {result:{targetId}}=await call('Target.createTarget',{url:'about:blank'});
  try{const {result:{sessionId}}=await call('Target.attachToTarget',{targetId,flatten:true});await call('Page.navigate',{url},sessionId);await sleep(wait);
   const r=await call('Runtime.evaluate',{expression:probe,returnByValue:true},sessionId);return r?.result?.result?.value??null}
  finally{await call('Target.closeTarget',{targetId}).catch(()=>{})}}
 catch{return null}finally{try{ws?.close()}catch{}}}

// unread DMs. count=null means unknown. mode: 'title' (a tab's title only, no navigation), 'inbox' (a fresh tab on the
// inbox), 'both' (the default: the larger of the two; unknown only when neither could be read)
export async function unreadDms({port,mode='both',url='https://www.threads.com/messages',fetchJson=getJson,lookFn=look,wait}={}){
 if(!port)return {count:null,known:false,why:'no DevTools port for this agent'};
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
export async function postingAllowed({DATA,WORK,agent,now=Date.now()}){let d;try{d=JSON.parse(await readFile(path.join(DATA,'posting-limits.json'),'utf8'))}catch{return {allow:null,known:false,why:'no posting limits file'}}
 const raw=d?.agents?.[agent];if(!raw?.on)return {allow:null,known:false,why:'posting limits are not on for this agent'};
 let r;try{r=clean(raw)}catch(e){return {allow:null,known:false,why:e.message}}
 let entries=[];try{entries=JSON.parse(await readFile(path.join(DATA,'posting-log',agent+'.json'),'utf8'))}catch{}
 const stopped=!!(r.stopFile&&WORK&&await stat(path.join(WORK,agent,r.stopFile)).then(()=>true,()=>false));
 const x=decide(r,entries,{now,stopped});return {allow:x.allow,known:true,why:x.allow?'room to post ('+x.n+')':x.reason}}

// ---- the answer ----------------------------------------------------------------------------------------------------------
// work = checks that count things to do (any one above zero, or unknown, means there is something); need = checks that
// say whether the work may be done at all (allow=false stops the run; unknown does not).
export function combine({work=[],need=[]}){
 const reasons=[...work.map(w=>w.why),...need.map(n=>n.why)].filter(Boolean);
 const no=need.find(n=>n.known&&n.allow===false);if(no)return {anythingToDo:false,reason:no.why,detail:reasons};
 if(!work.length)return {anythingToDo:true,reason:'no work check given',detail:reasons};
 if(work.some(w=>w.known&&w.count>0))return {anythingToDo:true,reason:'there is something waiting',detail:reasons};
 if(work.some(w=>!w.known))return {anythingToDo:true,reason:'a check could not tell, so the run goes ahead',detail:reasons};
 return {anythingToDo:false,reason:'nothing waiting: '+reasons.join('; '),detail:reasons}}
