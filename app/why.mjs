// Why an agent asks for something (21 Oct 2026: "it needs to say its purpose and what I asked that led to it").
// When an agent asks for a sign-in, for access, or reports what blocks it, aqeelOS keeps the purpose it gave and the
// chat message that led to it (the newest message a person sent that agent), so whoever decides sees the context.
// It also keeps where each connected app on an agent came from: added by aqeelOS when the agent was set up, asked for
// by the agent in a chat, or added by a person. An app nobody asked for doesn't nag for a sign-in.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

const clean=t=>String(t||'').replace(/^\s*\[[^\]|]{1,40}\|\d+\]\s*/,'').replace(/\[Use these tools for this:[^\]]*\]\s*/g,'').replace(/\[(Image|File) attached[^\]]*\]/g,'').replace(/\[(image|file) received\]/gi,'').replace(/\s+/g,' ').trim().slice(0,280);
// an app's own "who am I" tool: no required input, named like get-self / whoami / read_user_profile / get_me / current_user
const SELF=/(^|[-_.])(get[-_]?self|self|whoami|who[-_]?am[-_]?i|read[-_]?user[-_]?profile|get[-_]?me|me|current[-_]?user|my[-_]?profile|get[-_]?profile|get[-_]?account|account[-_]?info|auth[-_]?test|viewer)$/i;
async function whoAmI(url,tok){let sid='';
 const rpc=async(method,params,id)=>{const r=await fetch(url,{method:'POST',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+tok,'content-type':'application/json',accept:'application/json, text/event-stream',...(sid?{'mcp-session-id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(id?{id}:{}),method,params})});
  sid=r.headers.get('mcp-session-id')||sid;const t=await r.text();const d=t.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).pop()||t;try{return JSON.parse(d)}catch{return null}};
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'aqeelOS',version:'1'}},1);await rpc('notifications/initialized',{});
 const tools=(await rpc('tools/list',{},2))?.result?.tools||[];
 const t=tools.find(x=>SELF.test(x.name)&&!(x.inputSchema?.required||[]).length);if(!t)return null;
 const res=(await rpc('tools/call',{name:t.name,arguments:{}},3))?.result;if(!res||res.isError)return null;
 return readAccount((res.content||[]).map(c=>c.text||'').join('\n'))}
// workspace / organization and user out of whatever the app answered (JSON, or "Key: Value" lines)
function readAccount(text){const flat={};
 const walk=(o,pre)=>{if(o&&typeof o==='object')for(const [k,v] of Object.entries(o))walk(v,pre?pre+'.'+k:k);else if(o!=null&&String(o).trim())flat[pre.toLowerCase()]=String(o).trim()};
 try{const j=JSON.parse(text);walk(typeof j==='object'&&j?.result&&typeof j.result==='string'?{}:j,'');if(typeof j?.result==='string')text=j.result}catch{}
 for(const l of String(text).split('\n')){const m=l.match(/^\s*([A-Za-z][\w .]{1,40}):\s*(.+?)\s*$/);if(m)flat[m[1].toLowerCase()]=m[2]}
 const get=re=>{const k=Object.keys(flat).find(x=>re.test(x));return k?flat[k]:''};
 const workspace=get(/^(workspace|organization|organisation|org|team|company|tenant|account)(\.| )?(name)?$|^(workspace|team|organization|org)\.name$|organization name|workspace name|team name/);
 const user=get(/(^|\.)real ?name$/)||get(/(^|\.)display ?name$/)||get(/^(user\.)?(full ?name|name)$/)||get(/(^|\.)(username|login)$/);const email=get(/(^|\.)email$/);
 return workspace||user||email?{workspace,user,email}:null}
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
 // where an app on an agent came from
 async function app(agent,name,url=''){await load();return db.apps[agent+'|'+name]||null}
 async function noteApp(agent,name,rec){await load();const k=agent+'|'+name;db.apps[k]={...rec,account:db.apps[k]?.account,at:Date.now()};await save()}
 // which account a sign-in is (workspace or organization, and the user), asked of the app itself while the sign-in works
 // and kept for when it stops, so a notice says WHICH Slack or Notion. Any app (MCP server) works the same way: aqeelOS
 // calls its own "who am I" tool (notion-get-self, slack_read_user_profile, a future app's whoami…) with the sign-in.
 async function learnAccount(agent,name,url,tokFile){await load();const k=agent+'|'+name;const cur=db.apps[k]?.account;
  if(!url||(cur&&Date.now()-(cur.at||0)<7*86400e3))return cur||null;
  let tok='';try{tok=JSON.parse(await readFile(tokFile,'utf8')).access_token||''}catch{}if(!tok)return cur||null;
  const found=await whoAmI(url,tok).catch(()=>null);if(!found)return cur||null;
  const account={...found,at:Date.now()};db.apps[k]={...(db.apps[k]||{}),account};await save();return account}
 const accountOf=async(agent,name)=>{await load();return db.apps[agent+'|'+name]?.account||null};
 return {from,app,noteApp,learnAccount,accountOf,clean}}
