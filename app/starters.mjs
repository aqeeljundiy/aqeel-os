// Starter prompts on the empty chat screen, written from what this person recently did with this agent.
// The engine's own small helper model (whatever LLM you set up, no tools) suggests four next steps; results are
// cached per person and agent for 6 hours, and the defaults show while there's no history yet. The defaults are neutral;
// admins can write their own under System › Branding (DATA/starter-defaults.json, one list for admins, one for members).
import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const TTL=6*3600e3;
const AUTOMATION=/^(cron|webhook|kanban|oneshot|batch)/;
const DEFAULTS={
 admin:[['Plan a schedule','Every weekday at 8, send me a short summary of what needs my attention today.'],['Research','Find three new tools worth trying for my work and say what each one is good for.'],['Write a message','Help me write a clear message. Ask me who it is for and what I want to say.'],['Tidy the box','Find what is using disk space on this box and suggest a safe clean-up.']],
 member:[['Plan my week','Help me plan this week: ask me what is coming up, then make a simple day-by-day list.'],['Dinner ideas','Suggest five easy dinners for this week with a shopping list.'],['Write a message','Help me write a friendly message. Ask me who it is for and what I want to say.'],['Learn something','Explain something interesting in simple words. Ask me what I am curious about first.']],
};

export function createStarters(DATA,{python,root}={}){
 const FILE=path.join(DATA,'starters.json');let cache=null;const busy=new Map();
 const load=async()=>{if(cache)return cache;try{cache=JSON.parse(await readFile(FILE,'utf8'))}catch{cache={}}return cache};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(cache));await rename(FILE+'.tmp',FILE)};
 // the install's own defaults (admins set them in the app); four [title, prompt] pairs per list, else the neutral ones
 const OWN=path.join(DATA,'starter-defaults.json');let own=null;
 const clean=l=>Array.isArray(l)?l.map(x=>Array.isArray(x)?x:[x?.title,x?.prompt]).map(([t,p])=>[String(t||'').trim().slice(0,40),String(p||'').trim().slice(0,220)]).filter(([t,p])=>t&&p).slice(0,4):[];
 async function defaults(){if(!own){try{own=JSON.parse(await readFile(OWN,'utf8'))}catch{own={}}}
  const pick=k=>{const l=clean(own[k]);return l.length?l:DEFAULTS[k]};return {admin:pick('admin'),member:pick('member'),custom:{admin:!!clean(own.admin).length,member:!!clean(own.member).length}}}
 // an empty list goes back to the neutral defaults for that kind of person
 async function setDefaults(b){await defaults();for(const k of ['admin','member'])if(k in (b||{})){const l=clean(b[k]);if(l.length)own[k]=l;else delete own[k]}
  await mkdir(DATA,{recursive:true});await writeFile(OWN+'.tmp',JSON.stringify(own,null,1));await rename(OWN+'.tmp',OWN);return defaults()}
 // same helper as explain.mjs: the prompt goes in on stdin, the answer text comes back
 const ask=prompt=>new Promise(async res=>{const py=python&&await python();if(!py)return res(null);const c=execFile(py,[path.join(root,'scripts','aux-llm.py'),path.join(homedir(),'.hermes','hermes-agent')],{timeout:120000,maxBuffer:1e6,cwd:path.join(homedir(),'.hermes')},(err,out)=>res(err?null:String(out)));c.stdin.end(JSON.stringify({system:'You suggest what a person might ask their AI assistant next. Follow the format asked for exactly.',user:prompt,max_tokens:600}))});

 async function make(recent){
  const list=recent.map((s,i)=>`${i+1}. ${s.title||''}${s.preview?' — '+s.preview:''}`).join('\n');
  const out=await ask(`These are the most recent chats a person had with their AI assistant (newest first):\n${list}\n\nSuggest exactly 4 useful things they might want to ask next: follow-ups, next steps, or related tasks. Each needs a title of 2-4 words and a one-sentence prompt written as the person would type it. Plain everyday words, no jargon, no emojis. Call the assistant aqeelOS, never Hermes. Reply with only JSON: [{"title":"...","prompt":"..."}]`);
  const m=/\[[\s\S]*\]/.exec(out||'');if(!m)return null;
  try{const a=JSON.parse(m[0]).filter(x=>x&&x.title&&x.prompt).slice(0,4).map(x=>[String(x.title).slice(0,40),String(x.prompt).slice(0,220)]);return a.length===4?a:null}catch{return null}}

 // recent: the person's own chats with this agent (already filtered by owner)
 async function get(userKey,role,agent,recent){
  await load();const base=(await defaults())[role==='member'?'member':'admin'];
  const mine=recent.filter(s=>!AUTOMATION.test(s.source||'')&&(s.title||s.preview)).slice(0,12);
  if(mine.length<2)return {prompts:base,source:'default'};
  const key=userKey+':'+agent,sig=createHash('sha1').update(mine.map(s=>s.id).join(',')).digest('hex').slice(0,12);
  const hit=cache[key];if(hit&&hit.sig===sig&&Date.now()-hit.t<TTL)return {prompts:hit.prompts,source:'recent'};
  // stale or for older chats: show it, refresh quietly
  if(hit&&!busy.has(key))refresh(key,sig,mine);
  if(hit)return {prompts:hit.prompts,source:'recent'};
  const fresh=await refresh(key,sig,mine);return fresh?{prompts:fresh,source:'recent'}:{prompts:base,source:'default'};
 }
 function refresh(key,sig,mine){if(busy.has(key))return busy.get(key);
  const p=make(mine).then(async a=>{if(a){cache[key]={t:Date.now(),sig,prompts:a};await save().catch(()=>{})}return a}).finally(()=>busy.delete(key));busy.set(key,p);return p}
 return {get,defaults,setDefaults,DEFAULTS};
}
