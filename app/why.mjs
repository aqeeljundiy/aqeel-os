// Why an agent asks for something (21 Oct 2026: "it needs to say its purpose and what I asked that led to it").
// When an agent asks for a sign-in, for access, or reports what blocks it, aqeelOS keeps the purpose it gave and the
// chat message that led to it (the newest message a person sent that agent), so whoever decides sees the context.
// It also keeps where each connected app on an agent came from: added by aqeelOS when the agent was set up, asked for
// by the agent in a chat, or added by a person. An app nobody asked for doesn't nag for a sign-in.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

const clean=t=>String(t||'').replace(/^\s*\[[^\]|]{1,40}\|\d+\]\s*/,'').replace(/\[Use these tools for this:[^\]]*\]\s*/g,'').replace(/\[(Image|File) attached[^\]]*\]/g,'').replace(/\[(image|file) received\]/gi,'').replace(/\s+/g,' ').trim().slice(0,280);
export function createWhy({DATA,HERMES_HOME,python}){
 const FILE=path.join(DATA,'why.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.apps||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 // the newest message a person sent this agent (any chat or channel): what the agent was working on when it asked
 async function from(agent){const p=await python().catch(()=>null);if(!p)return null;
  const q=`import sqlite3,sys,json
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
r=c.execute("select m.session_id,m.content,m.timestamp,coalesce(s.title,''),coalesce(s.source,''),coalesce(s.display_name,'') from messages m left join sessions s on s.id=m.session_id where m.role='user' and coalesce(m.content,'')<>'' order by m.id desc limit 5").fetchall()
print(json.dumps(r))`;
  return new Promise(res=>execFile(p,['-c',q,path.join(home(agent),'state.db')],{timeout:10000},(e,o)=>{try{
   const r=JSON.parse(String(o)).find(x=>clean(x[1]));res(r?{chat:r[0],ask:clean(r[1]),at:Math.round(r[2]*1000),title:r[3],source:r[4],who:/^[-\s]*$/.test(r[5])?'':r[5]}:null)}catch{res(null)}}))}
 // where an app on an agent came from; one aqeelOS adds to every agent (Composio) counts as set-up when nothing says otherwise
 async function app(agent,name,url=''){await load();return db.apps[agent+'|'+name]||(/connect\.composio\.dev|rube\.app/.test(url)?{by:'setup'}:null)}
 async function noteApp(agent,name,rec){await load();db.apps[agent+'|'+name]={...rec,at:Date.now()};await save()}
 return {from,app,noteApp,clean}}
