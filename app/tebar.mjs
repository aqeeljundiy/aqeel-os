// Tebar webhooks (owner, 11 Nov 2026: Tebar as a first-class app). Tebar (tebar.app, the social media scheduler the
// agents reach through its MCP server, app/tebar-app.mjs) can post its events to aqeelOS: a post that failed, an account
// whose sign-in expired or was disconnected, a new comment, a new Instagram DM. Each agent that uses Tebar may have one
// endpoint: https://<aqeelOS>/hooks/tebar/<agent>, made in Tebar (Integrasi › Tambah webhook, Developer mode) with the
// address aqeelOS shows; Tebar shows its secret (whsec_...) once, and the person pastes it in aqeelOS (Connections ›
// the Tebar row). The secret lives in DATA/tebar-secrets.json (mode 600) and is never sent back or logged.
//
// Tebar signs each delivery: Tebar-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">, 5 minutes
// either way; Tebar-Event names the event and Tebar-Delivery is the delivery's id. It waits 5 seconds for a 2xx, does not
// follow redirects, and retries for about a day (so the same event can come twice: deduped on Tebar-Delivery and the
// event's own id). aqeelOS answers at once and handles the event after:
//  - post.failed, account.expired, account.disconnected: an alert (Health, Bottlenecks, the owner's alert chat), one per
//    post target or account; post.published and account.connected take it away again;
//  - comment.created, message.received and the others picked: a notice in the bell of the agent's owner.
// Text in an event (a comment, a DM) is someone else's words: shown as data, never run as instructions.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';

export const TOLERANCE=300,MAX_BODY=1024*1024;
export const EVENTS=['account.connected','account.expired','account.disconnected','post.published','post.failed','comment.created','comment.replied','comment.hidden',
 'comment.unhidden','comment.deleted','message.received','message.sent','automation.run','profile.deleted'];
export const DEFAULT_EVENTS=['post.failed','account.expired','account.disconnected','comment.created','message.received'];
// what each event means, for the settings panel
export const EVENT_WORDS={'post.failed':'A post failed (alert)','account.expired':'An account’s sign-in expired (alert)','account.disconnected':'An account was disconnected (alert)',
 'comment.created':'A new comment','message.received':'A new Instagram DM','post.published':'A post went out','account.connected':'An account was connected',
 'comment.replied':'A comment was answered','comment.hidden':'A comment was hidden','comment.unhidden':'A comment was shown again','comment.deleted':'A comment was deleted',
 'message.sent':'A DM was sent','automation.run':'An automation ran','profile.deleted':'A profile was deleted'};
const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const okSecret=s=>/^whsec_[A-Za-z0-9_+/=-]{8,200}$/.test(String(s||''));

// the signature over the raw body: any v1 from any saved secret, t within 5 minutes
export function verifySignature(raw,header,secrets,nowS=Date.now()/1000,tol=TOLERANCE){
 if(typeof header!=='string'||!header||header.length>2048||!/^[\x20-\x7e]+$/.test(header))return false;
 let t=null;const v1=[];
 for(const p of header.split(',').map(x=>x.trim()).filter(Boolean)){const i=p.indexOf('=');if(i<1)return false;const k=p.slice(0,i),v=p.slice(i+1);
  if(k==='t'){if(t!==null||!/^\d{1,12}$/.test(v))return false;t=v}else if(k==='v1'){if(!/^[0-9a-fA-F]{64}$/.test(v))continue;v1.push(v.toLowerCase())}}
 if(t===null||!v1.length||v1.length>8||Math.abs(nowS-Number(t))>tol)return false;
 const body=Buffer.isBuffer(raw)?raw:Buffer.from(String(raw));let ok=false;
 for(const s of secrets||[]){if(typeof s!=='string'||!s)continue;const want=Buffer.from(createHmac('sha256',s).update(Buffer.concat([Buffer.from(t+'.'),body])).digest('hex'));
  for(const g of v1){const b=Buffer.from(g);if(b.length===want.length&&timingSafeEqual(b,want))ok=true}}
 return ok}
// a header the way Tebar makes it (tests, and the settings panel's own check)
export const sign=(raw,secret,t=Math.floor(Date.now()/1000))=>'t='+t+',v1='+createHmac('sha256',secret).update(Buffer.concat([Buffer.from(t+'.'),Buffer.isBuffer(raw)?raw:Buffer.from(String(raw))])).digest('hex');

// can Tebar reach this address: https on 443, a public name
export function publicReach(u){let x;try{x=new URL(String(u||''))}catch{return {ok:false,why:'aqeelOS has no public address yet (System › Settings › Your address), so Tebar cannot reach it.'}}
 const h=x.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(/^(localhost|.*\.(localhost|local|test|internal|lan|home)|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1?)$/.test(h)||!/\./.test(h)&&!h.includes(':'))
  return {ok:false,why:'aqeelOS runs at '+x.origin+', which Tebar cannot reach from the internet.'};
 if(x.protocol!=='https:'||x.port&&x.port!=='443')return {ok:false,why:'Tebar only sends to https on the normal port, and aqeelOS is at '+x.origin+'.'};
 return {ok:true}}

const clip=(s,n)=>{s=String(s??'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const PLATFORM={threads:'Threads',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',youtube:'YouTube',linkedin:'LinkedIn',x:'X',telegram:'Telegram',discord:'Discord',pinterest:'Pinterest'};
const plat=p=>PLATFORM[String(p||'').toLowerCase()]||(p?String(p):'');
const acctName=a=>a?clip((a.username?'@'+String(a.username).replace(/^@/,''):a.name||a.display_name||a.id||'')+(a.platform?' ('+plat(a.platform)+')':''),80):'an account';

// what one event becomes: an alert (problem), the end of one (ok), or a notice (note); null for nothing
export function describe(ev,who='The agent'){const d=ev?.data||{},type=String(ev?.type||'');
 switch(type){
  case 'post.failed':return {problem:{topic:'tebar|post|'+(d.post_id||'')+'|'+(d.target_id||d.account_id||''),title:who+': a Tebar post failed'+(d.platform?' on '+plat(d.platform):''),
   fix:clip((d.error_message?'Tebar says: '+d.error_message+(d.error_code?' ('+d.error_code+')':'')+'. ':'')+'Post '+(d.post_id||'unknown')+'. Fix what it says, then ask '+who+' to retry it (retry_post), or retry it in Tebar.',400)}};
  case 'post.published':return {ok:'tebar|post|'+(d.post_id||'')+'|'+(d.target_id||d.account_id||''),note:{title:who+': a Tebar post went out'+(d.platform?' on '+plat(d.platform):''),text:d.permalink||''}};
  case 'account.expired':case 'account.disconnected':{const a=d.account||{};return {problem:{topic:'tebar|account|'+(a.id||d.account_id||''),
   title:who+': Tebar account '+acctName(a)+(type==='account.expired'?' needs signing in again':' was disconnected'),fix:'Open Tebar (tebar.app), Akun, and connect '+acctName(a)+' again. Until then posts to it fail.'}}}
  case 'account.connected':{const a=d.account||{};return {ok:'tebar|account|'+(a.id||d.account_id||''),note:{title:who+': Tebar account '+acctName(a)+' connected',text:''}}}
  case 'comment.created':return {note:{title:who+': new comment'+(d.platform?' on '+plat(d.platform):'')+(d.author_username?' from @'+String(d.author_username).replace(/^@/,''):''),text:clip(d.text,240)}};
  case 'message.received':return {note:{title:who+': new Instagram DM'+(d.participant_username?' from @'+String(d.participant_username).replace(/^@/,''):''),text:clip(d.text||(d.attachments?.length?'(a photo or file)':''),240)}};
  case 'automation.run':return {note:{title:who+': a Tebar automation ran'+(d.status?' ('+d.status+')':''),text:clip(d.reason,240)}};
  case 'webhook.test':return {note:{title:who+': the Tebar webhook works',text:'Tebar’s test event arrived and its signature checked out.'}};
  default:return EVENTS.includes(type)?{note:{title:who+': Tebar '+type.replace('.',' '),text:''}}:null}}

export function createTebar({DATA,publicUrl=()=>'',problem=async()=>{},solved=async()=>{},notice=async()=>{},onEvent=async()=>{},nameOf=a=>a,log=m=>console.log(m),now=()=>Date.now()}){
 const CONF=path.join(DATA,'tebar.json'),SEC=path.join(DATA,'tebar-secrets.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async(f,v,mode=0o600)=>{await mkdir(DATA,{recursive:true});const t=f+'.'+process.pid+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode});await rename(t,f)};
 let chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 let conf=null;const load=async()=>{if(!conf){conf=await readJson(CONF,{});conf.hooks||={};conf.seen||=[]}return conf};
 const save=()=>queue(async()=>{await load();conf.seen=conf.seen.slice(-2000);await put(CONF,conf,0o644)});
 const secretsOf=async a=>((await readJson(SEC,{}))[a]?.secrets)||[];
 const urlOf=a=>publicUrl().replace(/\/+$/,'')+'/hooks/tebar/'+a;

 // POST /hooks/tebar/<agent>: checked and answered at once; the event is handled after the answer (handle())
 async function receive(agent,headers,raw){if(!AGENT.test(String(agent||'')))return {status:404,body:{error:'Unknown hook'}};await load();const h=conf.hooks[agent];
  if(!h)return {status:404,body:{error:'Unknown hook'}};
  if(raw.length>MAX_BODY)return {status:413,body:{error:'Too large'}};
  const secrets=await secretsOf(agent);if(!secrets.length)return {status:401,body:{error:'No secret saved yet'}};
  if(!verifySignature(raw,headers['tebar-signature'],secrets,now()/1000))return {status:401,body:{error:'Invalid signature'}};
  let ev;try{ev=JSON.parse(raw.toString('utf8'))}catch{return {status:400,body:{error:'Bad JSON'}}}
  const type=String(headers['tebar-event']||ev?.type||''),delivery=String(headers['tebar-delivery']||'').slice(0,100),id=String(ev?.id||'').slice(0,100);
  const keys=[delivery&&'d|'+agent+'|'+delivery,id&&'e|'+agent+'|'+id].filter(Boolean);
  if(keys.some(k=>conf.seen.includes(k)))return {status:200,body:{duplicate:true}};conf.seen.push(...keys);
  const picked=type==='webhook.test'||(h.events||DEFAULT_EVENTS).includes(type);
  h.recent=[{at:now(),type,picked},...(h.recent||[])].slice(0,10);await save();
  return {status:200,body:{ok:true,...(picked?{}:{ignored:type})},after:picked?()=>handle(agent,{...ev,type}):null}}
 async function handle(agent,ev){const x=describe(ev,nameOf(agent));if(!x)return;
  try{if(x.problem)await problem(agent,x.problem.topic,x.problem.title,x.problem.fix);if(x.ok)await solved(agent,x.ok);if(x.note)await notice(agent,x.note.title,x.note.text,ev.type)}
  catch(e){log('tebar '+agent+': '+ev.type+' not passed on: '+e.message)}
  // an event can also start the agent's matching schedule at once (event-runs.mjs); never stops the notice above
  try{await onEvent(agent,ev)}catch(e){log('tebar '+agent+': '+ev.type+' did not start a run: '+e.message)}}

 // the settings panel (Connections › the Tebar row): the address, whether a secret is saved, the events, the last ones
 async function view(agent){await load();const h=conf.hooks[agent]||null,s=await secretsOf(agent),url=urlOf(agent);
  return {agent,url,reach:publicReach(url),set:!!h,hasSecret:s.length>0,events:h?.events||DEFAULT_EVENTS,all:EVENTS.map(e=>({id:e,words:EVENT_WORDS[e]||e})),recent:h?.recent||[],at:h?.at||null}}
 async function set(agent,{secret,events}={}){if(!AGENT.test(String(agent||'')))throw Object.assign(Error('Unknown agent'),{status:400});await load();
  const h=conf.hooks[agent]||{at:now(),events:DEFAULT_EVENTS};
  if(events!==undefined){if(!Array.isArray(events))throw Object.assign(Error('Pick the events as a list.'),{status:400});const l=[...new Set(events.map(String))].filter(e=>EVENTS.includes(e));if(!l.length)throw Object.assign(Error('Pick at least one event.'),{status:400});h.events=l}
  if(secret!==undefined&&secret!==''){const s=String(secret).trim();if(!okSecret(s))throw Object.assign(Error('That is not a Tebar webhook secret. It starts with whsec_ and Tebar shows it once, when the webhook is made.'),{status:400});
   const all=await readJson(SEC,{});all[agent]={secrets:[s,...((all[agent]?.secrets)||[]).filter(x=>x!==s)].slice(0,2),at:now()};await put(SEC,all);
   log('tebar '+agent+': webhook secret saved (ending '+s.slice(-4)+')')}
  conf.hooks[agent]=h;await save();return view(agent)}
 async function remove(agent){await load();delete conf.hooks[agent];await save();const all=await readJson(SEC,{});if(all[agent]){delete all[agent];await put(SEC,all)}return {removed:true}}
 return {receive,handle,view,set,remove,urlOf}}
