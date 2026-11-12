// Route order (12 Nov 2026, cost review): a run asked for one model must not quietly end up on another vendor's.
// Elkiya, 9 to 12 Nov: 9 of 34 fixer runs that asked for Claude ran on GPT or Gemini (about $15.77), and agents' chats and schedules did the
// same (241 replies answered on a fallback). The engine's fallback list fired on the first failed call, whatever it was: a short "Server is
// temporarily limiting requests (not your usage limit)" 429, a timeout, an engine error. The order is now always:
//   (a) the same model on another signed-in account of the pool that has room (accounts.mjs poolRoom; the agent is moved there),
//   (b) a background run waits when the reset is near (route.waitMinutes, default 15),
//   (c) the owner's explicit fallback list (Models > If an account fails), in its order, only when the ACCOUNT failed,
//   (d) otherwise it stops, with the reason in the reply.
// The engine enforces it (engine/patches/2026-11-12-route-order.patch, agent/aqeelos_route.py) from a policy file this app writes per
// agent (every 5 minutes, backup-models.mjs) and writes one line per switch or refusal to <agent home>/logs/route-switches.jsonl. This
// file is the app's side: the policy it writes, reading and summing the records, "an agent has been on a fallback for N hours", and the
// route of one fixer run. All of it is pure, so it is tested (scripts/route-order.test.mjs).
import {readFile,appendFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';

export const FILE='route-switches.jsonl';   // DATA: every agent's records, as the app read them
export const DEFAULTS={waitMinutes:15,fallbackHours:3};
const clamp=(v,lo,hi,def)=>{const n=Number(v);return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):def};
// route.waitMinutes: a background run waits when the account is back within this many minutes (0: never waits)
// route.fallbackHours: one Health item when an agent has been answering on a fallback this long
export const settingsOf=pol=>({waitMinutes:clamp(pol?.route?.waitMinutes,0,240,DEFAULTS.waitMinutes),fallbackHours:clamp(pol?.route?.fallbackHours,1,72,DEFAULTS.fallbackHours)});

// the vendor family a person means by "the same model": Claude, GPT, Gemini, else the model's first word
export function familyOf(model){const m=String(model||'').toLowerCase();
 if(/claude|opus|sonnet|haiku|fable/.test(m))return 'claude';if(/gpt|codex|\bo[134]\b/.test(m))return 'gpt';if(/gemini/.test(m))return 'gemini';
 return m.split(/[-_/:.\s]/)[0]||''}
const FAMILY_NAME={claude:'Claude',gpt:'GPT',gemini:'Gemini'};
export const familyName=f=>FAMILY_NAME[f]||f||'another model';

// the file the engine reads (agent/aqeelos_route.py load_policy): what the app knows that the engine cannot
// room: {sameModelRoom, keys} from accounts.mjs poolRoom
export const policyFor=(room,{waitMinutes=DEFAULTS.waitMinutes,now=Date.now()}={})=>({v:1,at:now,waitMinutes,pool:{sameModelRoom:!!room?.sameModelRoom,keys:(room?.keys||[]).slice(0,5)}});
export const samePolicy=(a,b)=>JSON.stringify([a?.waitMinutes,a?.pool])===JSON.stringify([b?.waitMinutes,b?.pool]);

// one record: {at, agent, kind chat|schedule|fixer, platform, session, asked, actual?, candidate?, reason, step, why, denied?}
export function parseSwitches(text,agent=''){const out=[];
 for(const l of String(text||'').split('\n')){if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}
  if(!r||typeof r!=='object'||!Number.isFinite(Number(r.at)))continue;
  out.push({at:Number(r.at),agent:String(r.agent||agent),kind:['chat','schedule','fixer'].includes(r.kind)?r.kind:'chat',platform:String(r.platform||''),session:String(r.session||''),
   asked:String(r.asked||''),...(r.denied?{denied:true,candidate:String(r.candidate||'')}:{actual:String(r.actual||'')}),reason:String(r.reason||''),step:String(r.step||''),why:String(r.why||'').slice(0,300)})}
 return out}
// a switch that really left the asked model's vendor (a refusal never did)
export const crossed=r=>!r.denied&&!!familyOf(r.asked)&&!!familyOf(r.actual)&&familyOf(r.asked)!==familyOf(r.actual);

// per agent and kind: switches to another vendor, refusals, in a window. Newest first in `recent`.
export function summarize(records,{now=Date.now(),days=7,agents=null}={}){const from=now-days*864e5,rows=new Map(),recent=[];let refused=0,total=0;
 for(const r of records||[]){if(r.at<from||r.at>now+6e4||(agents&&!agents.includes(r.agent)))continue;
  if(r.denied){refused++;recent.push(r);const k=r.agent+'|'+r.kind+'|stay';const x=rows.get(k)||{agent:r.agent,kind:r.kind,asked:familyOf(r.asked),actual:'',n:0,refused:0,reasons:{},last:0};x.refused++;x.last=Math.max(x.last,r.at);rows.set(k,x);continue}
  recent.push(r);if(!crossed(r))continue;total++;
  const k=r.agent+'|'+r.kind+'|'+familyOf(r.asked)+'>'+familyOf(r.actual),x=rows.get(k)||{agent:r.agent,kind:r.kind,asked:familyOf(r.asked),actual:familyOf(r.actual),n:0,refused:0,reasons:{},last:0};
  x.n++;x.reasons[r.reason||'unknown']=(x.reasons[r.reason||'unknown']||0)+1;x.last=Math.max(x.last,r.at);rows.set(k,x)}
 return {days,total,refused,rows:[...rows.values()].sort((a,b)=>b.n-a.n||b.refused-a.refused||b.last-a.last),recent:recent.sort((a,b)=>b.at-a.at).slice(0,30)}}

// agents that are answering on another vendor's model now, and since when. One streak = switches less than `gapMs` apart (the engine goes
// back to the asked model every turn, so "on a fallback" means it keeps having to leave it). hours = how long the streak has lasted.
export function onFallback(records,{now=Date.now(),hours=DEFAULTS.fallbackHours,gapMs=60*60e3}={}){const by=new Map();
 for(const r of records||[]){if(!crossed(r))continue;(by.get(r.agent)||by.set(r.agent,[]).get(r.agent)).push(r)}
 const out=[];
 for(const [agent,l] of by){l.sort((a,b)=>a.at-b.at);let since=l[0].at,last=since,n=1,reason=l[0].reason,actual=l[0].actual,asked=l[0].asked;
  for(const r of l.slice(1)){if(r.at-last>gapMs){since=r.at;n=0}last=r.at;n++;reason=r.reason;actual=r.actual;asked=r.asked}
  if(now-last>gapMs)continue;   // not on one any more
  const h=(last-since)/3600e3;out.push({agent,since,last,hours:Math.round(h*10)/10,n,reason,asked,actual,due:h>=hours})}
 return out.sort((a,b)=>b.hours-a.hours)}

// the Health text for one agent on a fallback
export const fallbackText=(f,name)=>({text:name+' has been answering on '+familyName(familyOf(f.actual))+' instead of '+familyName(familyOf(f.asked))+' for '+(f.hours<1?'under an hour':Math.round(f.hours)+' hours'),
 detail:'Its '+familyName(familyOf(f.asked))+' account kept failing ('+(f.reason||'unknown')+'), so replies went to the next model in the fallback list on Models. '+f.n+' replies so far. Check the account on Models › AI accounts: a sign-in that ran out, or every account of the pool used up.'});

// one fixer run: asked what, ran on what. asked = the model it was told to use, else what the engine recorded. Undefined when it stayed.
export function runRoute(run,rec=null){const asked=run?.model||rec?.asked||'',actual=run?.usage?.model||'';
 if(!asked||!actual||familyOf(asked)===familyOf(actual))return undefined;
 return {asked,actual,...(rec?{reason:rec.reason,step:rec.step,why:rec.why}:{})}}
// the record the engine wrote for a run of this kind in this time window (newest switch)
export const recordFor=(records,{kind,from,to})=>(records||[]).filter(r=>!r.denied&&r.kind===kind&&crossed(r)&&r.at>=from-60e3&&r.at<=to+60e3).sort((a,b)=>b.at-a.at)[0]||null;

/* ---------- the records on disk (DATA/route-switches.jsonl: appended as the app reads each agent's file; the last MAX bytes are read) ---------- */
const MAX=1_500_000;
export async function appendRecords(DATA,recs){if(!DATA||!recs.length)return;await mkdir(DATA,{recursive:true});await appendFile(path.join(DATA,FILE),recs.map(r=>JSON.stringify(r)).join('\n')+'\n')}
export async function readRecords(DATA,{now=Date.now(),days=7}={}){if(!DATA)return [];const f=path.join(DATA,FILE);const st=await stat(f).catch(()=>null);if(!st)return [];
 let t=await readFile(f,'utf8').catch(()=>'');if(t.length>MAX)t=t.slice(t.indexOf('\n',t.length-MAX)+1);
 return parseSwitches(t).filter(r=>r.at>=now-days*864e5)}
