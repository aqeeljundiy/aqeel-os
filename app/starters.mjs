// Starter prompts on the empty chat screen, written from what this person recently did with this agent.
// The engine's own small helper model (whatever LLM you set up, no tools) suggests four next steps; results are
// cached per person and agent for 6 hours, and the defaults show while there's no history yet.
import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const TTL=6*3600e3;
const AUTOMATION=/^(cron|webhook|kanban|oneshot|batch)/;
const DEFAULTS={
 admin:[['Check my sites','See if every site on the VPS is up, and tell me if anything is slow.'],['Plan a schedule','Every weekday at 8, send me a short report on how my sites are doing.'],['Tidy the server','Find what is using disk space on this box and suggest a safe clean-up.'],['Research','Find three new AI tools worth trying this week and say what each one is good for.']],
 member:[['Plan my week','Help me plan this week: ask me what is coming up, then make a simple day-by-day list.'],['Dinner ideas','Suggest five easy dinners for this week with a shopping list.'],['Write a message','Help me write a friendly message. Ask me who it is for and what I want to say.'],['Learn something','Explain something interesting in simple words. Ask me what I am curious about first.']],
};

export function createStarters(DATA,{python,root}={}){
 const FILE=path.join(DATA,'starters.json');let cache=null;const busy=new Map();
 const load=async()=>{if(cache)return cache;try{cache=JSON.parse(await readFile(FILE,'utf8'))}catch{cache={}}return cache};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(cache));await rename(FILE+'.tmp',FILE)};
 // same helper as explain.mjs: the prompt goes in on stdin, the answer text comes back
 const ask=prompt=>new Promise(async res=>{const py=python&&await python();if(!py)return res(null);const c=execFile(py,[path.join(root,'scripts','aux-llm.py'),path.join(homedir(),'.hermes','hermes-agent')],{timeout:120000,maxBuffer:1e6,cwd:path.join(homedir(),'.hermes')},(err,out)=>res(err?null:String(out)));c.stdin.end(JSON.stringify({system:'You suggest what a person might ask their AI assistant next. Follow the format asked for exactly.',user:prompt,max_tokens:600}))});

 async function make(recent){
  const list=recent.map((s,i)=>`${i+1}. ${s.title||''}${s.preview?' — '+s.preview:''}`).join('\n');
  const out=await ask(`These are the most recent chats a person had with their AI assistant (newest first):\n${list}\n\nSuggest exactly 4 useful things they might want to ask next: follow-ups, next steps, or related tasks. Each needs a title of 2-4 words and a one-sentence prompt written as the person would type it. Plain everyday words, no jargon, no emojis. Call the assistant aqeelOS, never Hermes. Reply with only JSON: [{"title":"...","prompt":"..."}]`);
  const m=/\[[\s\S]*\]/.exec(out||'');if(!m)return null;
  try{const a=JSON.parse(m[0]).filter(x=>x&&x.title&&x.prompt).slice(0,4).map(x=>[String(x.title).slice(0,40),String(x.prompt).slice(0,220)]);return a.length===4?a:null}catch{return null}}

 // recent: the person's own chats with this agent (already filtered by owner)
 async function get(userKey,role,agent,recent){
  await load();const base=DEFAULTS[role==='member'?'member':'admin'];
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
 return {get,DEFAULTS};
}
