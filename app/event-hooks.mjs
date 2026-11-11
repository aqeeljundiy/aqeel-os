// Event hooks (12 Nov 2026). Owner's reason: the two sales-recap schedules (Continue, Biomarkers) woke a model every 5 minutes only to run a
// script and repeat what it printed, 288 runs a day for a few paid orders. Nothing tells aqeelOS when a payment succeeds (the provider is
// asked, paid-labels.mjs polls it every minute), so the moment is when paid-labels.mjs finds a payment PAID and saves it: it tells
// onEvent('payment.paid' / 'order.posted'), and a hook runs the agent's script right then, with NO model:
//   1. the agent's feed folder is refreshed (its own rows of DATA/payments.jsonl and paid-labels.json, what the "orders feed" schedule copied every 2 minutes),
//   2. the script runs as the agent's own Linux user over ssh (the way a script-only schedule runs, agent-care.mjs), in the agent's folder,
//      under one lock per agent (flock) that the slow fallback schedule's wrapper takes too, so two runs never overlap, with a timeout,
//   3. what it prints is delivered to the chat the schedule delivered to (telegram:<chat>[:<topic>]); nothing printed = nothing sent.
// Hooks live in DATA/event-hooks.json (scripts/hooks-wire.mjs writes them):
//   {"<agent>":[{"on":"payment.paid" | ["payment.paid","order.posted"],"run":"python3 -I sales-recap/run.py","deliver":"telegram:-100…:5",
//                "feed":"sales-recap/feed","minGapSec":60,"timeoutSec":300,"keep":"-> OK|ERROR","prefix":"Recap: ","dedupe":true,"id":"sales-recap"}]}
// run: a command inside the agent's folder (a bare path picks the interpreter from .py/.sh/.mjs). keep: only lines matching it are sent.
// dedupe: a line already sent in the last 24 hours is not sent again (a script that repeats an error every run). The first event runs at
// once; more inside minGapSec become one run when the gap is over. A run that fails twice in a row is one health line with the script's error.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {matching} from './event-runs.mjs';

const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/,ID=/^[\w-]{1,64}$/,TOKEN=/^[\w.\/=:@+,-]+$/,TARGET=/^[a-z_]{2,30}:-?[\w.-]{1,80}(:\d{1,12})?$/;
export const GAP=60,TIMEOUT=300,LOCK_WAIT=300,DEDUPE_MS=24*3600e3,LOCK_FILE='.aqeelos-event-hooks.lock',BUSY=75;
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
const sha=s=>createHash('sha1').update(s).digest('hex').slice(0,16);
const base=a=>String(a).split('--')[0];

// the command words of a hook's run, or null: only plain words, a path stays inside the folder (no leading /, no ..)
export function commandOf(run){const t=String(run||'').trim().split(/\s+/).filter(Boolean);
 if(!t.length||t.length>12||t.some(x=>!TOKEN.test(x)||x.startsWith('/')||x.includes('..')||(x.startsWith('-')&&t.indexOf(x)===0)))return null;
 if(/^(python3?|bash|sh|node)$/.test(t[0]))return t.length>1?t:null;
 const ext=/\.(py|sh|mjs|js)$/.exec(t[0])?.[1];return ext?[{py:'python3',sh:'bash',mjs:'node',js:'node'}[ext],...t]:['./'+t[0].replace(/^\.\//,''),...t.slice(1)]}
// what the agent's user runs (after cd into its folder): the per-agent lock, then the timeout. Exit 75 = the lock was not free in time, 124 = timed out.
export function remoteCommand(run,{timeoutSec=TIMEOUT,lockWait=LOCK_WAIT}={}){const c=commandOf(run);if(!c)throw Error('not a command inside the agent\'s folder: '+clip(run,80));
 return 'flock -w '+Math.max(1,Math.round(lockWait))+' -E '+BUSY+' '+LOCK_FILE+' timeout -k 5 '+Math.max(1,Math.round(timeoutSec))+' '+c.join(' ')}

// one hook as written in the file, cleaned, or null
export function cleanHook(h){if(!h||typeof h!=='object')return null;const on=[].concat(h.on||[]).map(String).filter(x=>/^[\w.-]{1,60}$/.test(x));if(!on.length||!commandOf(h.run))return null;
 if(h.deliver!=null&&!TARGET.test(String(h.deliver)))return null;if(h.feed!=null&&!/^[\w.\/-]+$/.test(String(h.feed)))return null;if(h.feed&&(String(h.feed).startsWith('/')||String(h.feed).includes('..')))return null;
 if(h.keep!=null){try{new RegExp(String(h.keep))}catch{return null}}
 const id=ID.test(String(h.id||''))?String(h.id):'h-'+sha(on.join(',')+'|'+h.run).slice(0,10);
 return {id,on,run:String(h.run).trim(),deliver:h.deliver?String(h.deliver):null,feed:h.feed?String(h.feed).replace(/^\.\//,''):null,gap:Number.isFinite(+h.minGapSec)?Math.max(0,+h.minGapSec):GAP,
  timeoutSec:Number.isFinite(+h.timeoutSec)&&+h.timeoutSec>0?Math.min(1800,+h.timeoutSec):TIMEOUT,keep:h.keep!=null?String(h.keep):null,prefix:String(h.prefix||'').slice(0,40),dedupe:h.dedupe===true}}

// the agent's own rows of the payment log and its paid state, written where its scripts read them (what the 2-minute feed schedule did)
export async function writeFeed({DATA,WORK,agent,dir}){const out=path.join(WORK,base(agent),dir),changed=[];await mkdir(out,{recursive:true});
 const pays=(await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(p=>p&&p.agent===agent);
 let done={};try{done=JSON.parse(await readFile(path.join(DATA,'paid-labels.json'),'utf8')).done||{}}catch{}
 const state=Object.fromEntries(Object.entries(done).filter(([k])=>k.startsWith(agent+'|')));
 for(const [name,text] of [['payments.jsonl',pays.map(p=>JSON.stringify(p)+'\n').join('')],['paid-labels.json',JSON.stringify({done:state},null,1)]]){const f=path.join(out,name);
  if((await readFile(f,'utf8').catch(()=>null))===text)continue;const t=f+'.'+process.pid+'.tmp';await writeFile(t,text,{mode:0o640});await rename(t,f);changed.push(name)}
 return changed}

export const fallbackScript=({agent,id,port,sig})=>['#!/bin/bash','# Written by aqeelOS (hooks-wire.mjs): the slow fallback of the event hook "'+id+'". No model: it asks aqeelOS (this box only) for the same run as on a payment.',
 '# aqeelOS refreshes the feed, runs the script as the agent\'s own user and delivers what it printed; this prints nothing unless the run failed.',
 'r=$(curl -s -m 1200 -X POST -w \'\\n%{http_code}\' \'http://127.0.0.1:'+port+'/event-hook/'+agent+'/'+id+'/'+sig+'\')','code=${r##*$\'\\n\'}; body=${r%$\'\\n\'*}','[ "$code" = 200 ] && exit 0',
 'echo "aqeelOS event hook '+id+' did not run: ${body:-no answer} ($code)"','exit 1',''].join('\n');

export function createEventHooks({DATA,WORK,runAs,deliver,problem=async()=>{},solved=async()=>{},enabled=()=>true,now=()=>Date.now(),log=m=>console.log(m),setTimer=(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t}}){
 const CFG=path.join(DATA,'event-hooks.json'),ST=path.join(DATA,'event-hooks-state.json');let cache={at:0,v:{}},st=null;const last=new Map(),pending=new Map(),chains=new Map();
 const config=async()=>{if(now()-cache.at>30e3){let v={};try{v=JSON.parse(await readFile(CFG,'utf8'))}catch{}if(v&&typeof v.hooks==='object'&&!Array.isArray(v.hooks))v=v.hooks;
   cache={at:now(),v:Object.fromEntries(Object.entries(v||{}).filter(([a,l])=>AGENT.test(a)&&Array.isArray(l)).map(([a,l])=>[a,l.map(cleanHook).filter(Boolean)]))}}return cache.v};
 const load=async()=>{if(!st){try{st=JSON.parse(await readFile(ST,'utf8'))}catch{st={}}st.runs||={};st.sent||={};st.held||={}}return st};
 const save=async()=>{const t=now();for(const [k,v] of Object.entries(st.sent))if(t-v>DEDUPE_MS)delete st.sent[k];await mkdir(DATA,{recursive:true});await writeFile(ST+'.tmp',JSON.stringify(st,null,1));await rename(ST+'.tmp',ST)};
 // the text to send: lines kept by the hook's filter, not sent before when the hook dedupes, with its prefix
 const shape=(out,h,s,k)=>{let lines=String(out||'').split('\n').map(l=>l.replace(/\s+$/,'')).filter(l=>l.trim());
  if(h.keep){const re=new RegExp(h.keep);lines=lines.filter(l=>re.test(l))}
  if(h.dedupe)lines=lines.filter(l=>{const at=s.sent[sha(k+'|'+l)];return !at||now()-at>=DEDUPE_MS});
  return {text:lines.map(l=>h.prefix+l).join('\n'),lines}};
 const failText=(r,h)=>r.code===124?'it ran longer than '+h.timeoutSec+' s and was stopped':r.code===BUSY?'another script of this agent held the lock for '+LOCK_WAIT+' s':
  clip(String(r.err||'').trim().split('\n').filter(Boolean).slice(-2).join(' | ')||String(r.out||'').trim().split('\n').filter(Boolean).slice(-1)[0]||('exit '+r.code),240);
 async function execute(agent,h,type){const k=agent+'/'+h.id;last.set(k,now());pending.delete(k);const s=await load(),row=(s.runs[k]||={n:0,fails:0});let err=null,sent=0;
  try{
   if(h.feed)await writeFeed({DATA,WORK,agent,dir:h.feed});
   const r=await runAs(agent,remoteCommand(h.run,{timeoutSec:h.timeoutSec}),(h.timeoutSec+LOCK_WAIT+60)*1000);
   if(!r.ok)throw Error(failText(r,h));
   const {text,lines}=shape(r.out,h,s,k),all=[s.held[k],text].filter(Boolean).join('\n');   // a delivery that failed last time goes out first
   if(all){if(!h.deliver)throw Error('the hook has no deliver target');
    try{await deliver(agent,h.deliver,clip(all,3900))}catch(e){s.held[k]=clip(all,3000);throw Error('not delivered: '+e.message)}
    delete s.held[k];sent=all.split('\n').length;if(h.dedupe)for(const l of lines)s.sent[sha(k+'|'+l)]=now()}
  }catch(e){err=clip(String(e.message||e).replace(/\s+/g,' '),240)}
  row.n++;row.at=now();row.by=type;row.ok=!err;row.sent=sent;
  if(err){row.fails=(row.fails||0)+1;row.error=err;log('event hook: '+k+' failed ('+row.fails+'): '+err);
   if(row.fails===2)await Promise.resolve(problem(agent,'event-hook|'+h.id,'The "'+clip(h.run,50)+'" run on '+h.on.join('/')+' failed twice in a row: '+err,'Look at the script and its folder; the hourly fallback run keeps trying.')).catch(()=>{})}
  else{if(row.fails>=2)await Promise.resolve(solved(agent,'event-hook|'+h.id)).catch(()=>{});row.fails=0;delete row.error;log('event hook: '+k+' ran for '+type+(sent?', '+sent+' line(s) sent':', nothing to send'))}
  await save().catch(()=>{});return err}
 // runs one after another per agent (a later one waits for the one in progress)
 const queue=(agent,h,type)=>{const x=(chains.get(agent)||Promise.resolve()).then(()=>execute(agent,h,type)).catch(e=>log('event hook: '+agent+'/'+h.id+': '+e.message));chains.set(agent,x);return x};
 // an event arrived: run every matching hook (or queue one trailing run inside the gap). Returns the hook ids touched; does not wait for the runs.
 async function fire(agent,ev){if(!AGENT.test(String(agent||''))||!enabled())return [];const hooks=(await config())[agent]||[];if(!hooks.length)return [];
  const ids=new Set(matching({[agent]:hooks.map(h=>({event:h.on,job:h.id}))},agent,ev).map(r=>r.job)),out=[];
  for(const h of hooks.filter(h=>ids.has(h.id))){const k=agent+'/'+h.id,wait=(last.get(k)||0)+h.gap*1000-now();out.push(h.id);
   if(wait<=0){last.set(k,now());queue(agent,h,ev.type)}
   else if(!pending.has(k))pending.set(k,setTimer(()=>{last.set(k,now());pending.delete(k);queue(agent,h,ev.type)},wait))}
  return out}
// the slow fallback schedule asks for the same run (feed, script, delivery, health), at once and in line with the others; resolves to null, or the error text
 async function runNow(agent,id){if(!AGENT.test(String(agent||''))||!enabled())return 'hooks are off here';const h=((await config())[agent]||[]).find(x=>x.id===id);if(!h)return 'no such hook';return (await queue(agent,h,'fallback'))||null}
 const idle=()=>Promise.all([...chains.values()]);
 async function view(){await load();return {hooks:await config(),runs:st.runs}}
 return {fire,runNow,idle,view}}
