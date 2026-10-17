// Plain names and one-line "what it does" for plugins, skills, MCP servers and built-in tools.
// The engine's own names are technical ("browser-firecrawl", "baoyu-infographic"); Haiku rewrites each one
// once, in everyday words, and the result is kept in DATA/explain.json (redone only when the text changes).
// It uses the engine's own small helper model (whatever LLM you set up, no tools at all), never a particular vendor's CLI.
import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const KINDS={plugin:'a plugin that extends the assistant app itself',skill:'a skill (reusable know-how the assistant can use)',mcp:'an outside tool the assistant can call (MCP server)',tool:'a built-in tool group of the assistant'};

export function createExplain(DATA,{python,root}={}){
 const FILE=path.join(DATA,'explain.json');let cache=null;const busy=new Set();
 const load=async()=>{if(cache)return cache;try{cache=JSON.parse(await readFile(FILE,'utf8'))}catch{cache={}}return cache};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(cache));await rename(FILE+'.tmp',FILE)};
 const key=(kind,it)=>kind+':'+it.id+':'+createHash('sha1').update(String(it.name||'')+'|'+String(it.desc||'')).digest('hex').slice(0,10);
 const ask=prompt=>new Promise(async res=>{const py=python&&await python();if(!py)return res(null);const c=execFile(py,[path.join(root,'scripts','aux-llm.py'),'.'],{timeout:120000,maxBuffer:2e6,cwd:'/tmp'},(err,out)=>res(err?null:String(out)));c.stdin.end(JSON.stringify({system:'You write short, plain explanations for a non-technical person. Follow the format asked for exactly.',user:prompt,max_tokens:1800}))});

 async function write(kind,items){
  const list=items.map((it,i)=>`${i+1}. id=${it.id} | name=${it.name||it.id} | description=${String(it.desc||'').replace(/\s+/g,' ').slice(0,400)}`).join('\n');
  const out=await ask(`Each line below is ${KINDS[kind]||'a feature'} in an AI assistant app called aqeelOS.\n${list}\n\nFor each, write:\n- title: a plain name of 1-4 words that says what it is (e.g. "Infographic designer", "Firecrawl cloud browser", "Password sign-in").\n- summary: one short sentence (max 14 words) saying what it does for the person, in everyday words. No jargon, no emojis, never say Hermes or Nous.\nKeep any language-neutral; write English. Reply with only JSON: [{"id":"...","title":"...","summary":"..."}]`);
  const m=/\[[\s\S]*\]/.exec(out||'');if(!m)return;let arr=[];try{arr=JSON.parse(m[0])}catch{return}
  const by=Object.fromEntries(items.map(it=>[String(it.id),it]));
  for(const x of arr){const it=by[String(x.id)];if(it&&x.title)cache[key(kind,it)]={title:String(x.title).slice(0,60),summary:String(x.summary||'').slice(0,160)}}
  await save().catch(()=>{})}

 // returns what is known now; missing ones are written in the background (the page asks again a bit later)
 async function get(kind,items,{write:canWrite=true}={}){await load();items=(items||[]).filter(it=>it&&it.id).slice(0,300);const out={},missing=[];
  for(const it of items){const v=cache[key(kind,it)];if(v)out[it.id]=v;else missing.push(it)}
  const todo=missing.filter(it=>!busy.has(key(kind,it)));
  if(todo.length&&canWrite){todo.forEach(it=>busy.add(key(kind,it)));(async()=>{for(let i=0;i<todo.length;i+=30)await write(kind,todo.slice(i,i+30)).catch(()=>{});todo.forEach(it=>busy.delete(key(kind,it)))})()}
  return {items:out,pending:missing.length}}
 return {get};
}
