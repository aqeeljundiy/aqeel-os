// An agent's own scripts call the tools it has connected (17 Nov 2026). Fakhri Agent's daily Airtable → Sheet sync on P&P needed
// about 6,000 Airtable records with 22 fields each and 17,400 record ids. Its Airtable connection (Airtable's own MCP server, signed in
// with OAuth) and its Google tools could only be called in the conversation, so every record had to pass through the model, which does
// not fit, and its terminal runs as its own Linux user (ag-<agent>), which cannot read any sign-in. It refused rightly and asked for an
// Airtable key. A key per service per schedule is the wrong fix: every agent hits the same wall with every connection.
// Now a script calls POST http://127.0.0.1:<port>/tool-call/<agent>/<signature> (this box only, signed per agent like /agent-ops/):
//   {op:"list"}                                    the servers and tools this agent may call from a script
//   {server, tool, arguments}                      one call; the answer is {ok, isError, text, structured}
//   server "google" + a google_* tool               the same Google tools as in chat (google-tools.mjs), with the same rules
//   any other server                                an MCP server in this agent's config.yaml, called with the engine's own MCP client
//                                                  (scripts/tool-bridge.py): the agent's own sign-in, renewed through the engine's
//                                                  refresh lock, the server's tool include/exclude kept, no browser sign-in started
// Nothing new is granted: a script can call exactly what the agent can call in chat. aqeelOS's own loopback servers are not offered
// (their tools need a conversation), except Google. A worker per agent and server stays up for two idle minutes, so a paging loop does
// not reconnect each time (Airtable takes about 7 s to connect). The app writes .tools/aqtool and .tools/aqtools.py in each agent's
// folder (ensureClients); the skill productivity/script-tools tells the agent how to use them.
import {readFile,writeFile,rename,chmod,mkdir,stat} from 'node:fs/promises';
import {spawn as nodeSpawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {homeOf as engineHomeOf} from './agentops.mjs';
import {readFileSync} from 'node:fs';

// how an agent learns it: a tool in aqeelos-notify, which every agent has (17 Nov 2026: the repo's skills are off on installs made before
// them, so the skill alone never reached Fakhri Agent). Its answer is the skill's text, so there is one how-to.
const SKILL=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','skills','productivity','script-tools','SKILL.md');
export const SCRIPT_TOOL={name:'script_tools',description:'Call this BEFORE a job that moves more data than fits in the chat (hundreds or thousands of rows or records, a sync between Airtable, Google Sheets, n8n or another connected app, a diff, a schedule that copies data), and before asking anyone for an API token: your own scripts can call every tool you have connected, through aqeelOS, with no key. It returns how.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}};
export function scriptToolText(){try{return readFileSync(SKILL,'utf8').replace(/^---[\s\S]*?---\s*/,'')}catch{return 'Your scripts call your connected tools with .tools/aqtool in your workspace (aqtool list; aqtool <server> <tool> \'<json arguments>\') or .tools/aqtools.py (call(server, tool, arguments)); the server "google" is your google_* tools.'}}
const LOOPBACK=/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i;
const MAX_LINE=32e6;
// the servers a script may use: enabled, not one of aqeelOS's own loopback servers
export function scriptServers(config){return Object.entries(config?.mcp_servers||{}).filter(([n,e])=>e&&typeof e==='object'&&e.enabled!==false&&!/^aqeelos-/.test(n)&&!(e.url&&LOOPBACK.test(String(e.url)))).map(([n])=>n)}
export function createToolBridge({HERMES_HOME,WORK,PORT,sig,python,readConfig,googleTools=null,homeOf=engineHomeOf,
 root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),spawn=nodeSpawn,idleMs=120e3,readyMs=90e3,maxWorkers=4,log=m=>console.log(m)}){
 const url=a=>`http://127.0.0.1:${PORT}/tool-call/${a}/${sig(a)}`;
 const fail=(status,error)=>({status,json:{ok:false,error}});
 const pool=new Map();   // agent|server -> worker
 function stop(w){clearTimeout(w.idle);pool.delete(w.key);try{w.child.stdin.end()}catch{}setTimeout(()=>{try{w.child.kill()}catch{}},5000).unref?.()}
 async function worker(agent,server){const key=agent+'|'+server;let w=pool.get(key);if(w)return w.ready;
  if([...pool.values()].filter(x=>x.agent===agent).length>=maxWorkers)throw Object.assign(Error('Too many tool servers open for this agent at once; try again in a minute.'),{status:429});
  const py=await python();if(!py)throw Object.assign(Error('aqeelOS could not find the engine to call tools with.'),{status:503});
  const env={...process.env,HERMES_HOME:homeOf(agent)};delete env.DISPLAY;
  const child=spawn(py,[path.join(root,'scripts','tool-bridge.py'),path.join(HERMES_HOME,'hermes-agent'),server],{env,stdio:['pipe','pipe','pipe']});
  w={key,agent,server,child,wait:new Map(),n:0,buf:''};pool.set(key,w);
  w.ready=new Promise((ok,no)=>{const t=setTimeout(()=>{no(Object.assign(Error(server+' did not answer within '+readyMs/1000+' s.'),{status:504}));stop(w)},readyMs);
   child.stdout.on('data',d=>{w.buf+=d;if(w.buf.length>MAX_LINE){no(Error('answer too big'));stop(w);return}let i;while((i=w.buf.indexOf('\n'))>=0){const line=w.buf.slice(0,i);w.buf=w.buf.slice(i+1);let j;try{j=JSON.parse(line)}catch{continue}
    if('ready' in j&&!('id' in j)){clearTimeout(t);if(j.ready){w.tools=j.tools||[];ok(w)}else{no(Object.assign(Error(j.error||'could not connect'),{status:502}));stop(w)}continue}
    const p=w.wait.get(j.id);if(p){w.wait.delete(j.id);p(j)}}});
   child.stderr.on('data',()=>{});
   child.on('exit',()=>{clearTimeout(t);pool.delete(key);no(Object.assign(Error(server+' stopped.'),{status:502}));for(const p of w.wait.values())p({ok:false,error:server+' stopped during the call.'});w.wait.clear()});
   child.on('error',e=>{clearTimeout(t);pool.delete(key);no(e)})});
  w.ready.catch(()=>{});return w.ready}
 function send(w,tool,args,timeout){clearTimeout(w.idle);const id=++w.n;
  return new Promise(res=>{w.wait.set(id,j=>{w.idle=setTimeout(()=>stop(w),idleMs);w.idle.unref?.();res(j)});w.child.stdin.write(JSON.stringify({id,tool,arguments:args||{},timeout})+'\n')})}
 async function call(agent,body){const a=String(agent||'').split('--')[0],server=String(body?.server||'').trim(),tool=String(body?.tool||'').trim();
  const cfg=await readConfig(a).catch(()=>null);if(!cfg)return fail(404,'No agent '+a+'.');
  const servers=scriptServers(cfg);
  if(body?.op==='list'){const out={google:googleTools?googleTools.TOOLS.map(t=>t.name):[]};for(const s of servers){try{out[s]=(await worker(a,s)).tools}catch(e){out[s]={error:e.message}}}return {status:200,json:{ok:true,servers:out}}}
  if(!server||!tool)return fail(400,'Say which server and tool: {"server":"airtable","tool":"list_records_for_table","arguments":{…}}, or {"op":"list"}.');
  const args=body.arguments&&typeof body.arguments==='object'?body.arguments:{},timeout=Math.min(Math.max(Number(body.timeout)||120,5),600);
  if(server==='google'){if(!googleTools||!googleTools.TOOLS.some(t=>t.name===tool))return fail(404,'Google tools: '+(googleTools?googleTools.TOOLS.map(t=>t.name).join(', '):'none'));
   const r=await googleTools.call(a,tool,args,{full:true});log('tool bridge: '+a+' google.'+tool+(r.isError?' (refused or failed)':''));return {status:200,json:{ok:true,isError:!!r.isError,text:r.text,structured:null}}}
  if(!servers.includes(server))return fail(404,server+' is not a tool server this agent can call from a script. Yours: '+(servers.join(', ')||'none')+', and google.');
  let w;try{w=await worker(a,server)}catch(e){return fail(e.status||502,e.message)}
  if(!w.tools.includes(tool))return fail(404,server+' has no tool '+tool+' for this agent. Its tools: '+w.tools.join(', '));
  const r=await send(w,tool,args,timeout);log('tool bridge: '+a+' '+server+'.'+tool+(r.ok?(r.isError?' (the tool said no)':''):' failed'));
  return r.ok?{status:200,json:{ok:true,isError:!!r.isError,text:r.text||'',structured:r.structured??null,...(r.other?.length?{other:r.other}:{})}}:fail(502,r.error||'the call failed')}
 // the helpers in the agent's own folder: aqtool (command line) and aqtools.py (import in a script). Written by aqeelOS; edits are replaced.
 const MOD=u=>`"""aqeelOS: call the tools this agent has connected (Airtable, Google, n8n…) from a script, so big data never goes through
the chat. Written by aqeelOS; edits are replaced.
    import sys; sys.path.insert(0, "<this folder>"); from aqtools import call, tools
    tools()                                  # {server: [tool names]}
    call("airtable", "list_records_for_table", {...})   # the tool's answer: its structured data, else its text
    call("google", "google_sheets", {"action": "read", "spreadsheet": "<id>", "range": "Leads!A1:D"})
A refusal or failure raises ToolError with the reason."""
import json,urllib.request,urllib.error
U=${JSON.stringify(u)}
class ToolError(Exception):pass
def _post(req,timeout):
    try:return json.loads(urllib.request.urlopen(urllib.request.Request(U,json.dumps(req).encode(),{"content-type":"application/json"}),timeout=timeout+30).read().decode())
    except urllib.error.HTTPError as x:
        try:raise ToolError(json.loads(x.read().decode()).get("error") or str(x))
        except ValueError:raise ToolError(str(x))
    except OSError as x:raise ToolError("aqeelOS could not be reached: "+str(x))
def raw(server,tool,arguments=None,timeout=120):return _post({"server":server,"tool":tool,"arguments":arguments or {},"timeout":timeout},timeout)
def call(server,tool,arguments=None,timeout=120):
    r=raw(server,tool,arguments,timeout)
    if r.get("isError"):raise ToolError(r.get("text") or "the tool said no")
    if r.get("structured") is not None:return r["structured"]
    t=r.get("text") or ""
    try:return json.loads(t)
    except ValueError:return t
def tools():return _post({"op":"list"},120).get("servers",{})
`;
 const CLI=`#!/usr/bin/env python3
# aqeelOS: call this agent's connected tools from the terminal. Written by aqeelOS; edits are replaced.
# usage: aqtool list | aqtool <server> <tool> ['<json arguments>']   (server "google" for the google_* tools)
import json,os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from aqtools import raw,tools,ToolError
a=sys.argv[1:]
try:
    if a[:1]==["list"]:print(json.dumps(tools(),indent=1));sys.exit(0)
    if len(a)<2:print("usage: aqtool list | aqtool <server> <tool> ['<json arguments>']",file=sys.stderr);sys.exit(2)
    r=raw(a[0],a[1],json.loads(a[2]) if len(a)>2 else {})
    print(json.dumps(r.get("structured"),ensure_ascii=False) if r.get("structured") is not None else r.get("text",""))
    sys.exit(1 if r.get("isError") else 0)
except ToolError as x:print(str(x),file=sys.stderr);sys.exit(1)
`;
 async function put(f,want,mode){if((await readFile(f,'utf8').catch(()=>''))===want)return 0;const t=f+'.'+process.pid+'.tmp';await writeFile(t,want);await chmod(t,mode);await rename(t,f);return 1}
 async function ensureClients(agents){let n=0;for(const a of agents){if(a.includes('--'))continue;const ws=path.join(WORK,a);if(!(await stat(ws).catch(()=>null))?.isDirectory())continue;
   const dir=path.join(ws,'.tools');if(!await stat(dir).catch(()=>null)){await mkdir(dir);await chmod(dir,0o2775)}   // the app's umask is 077: the agent's own user reads it through the folder's ACL
const m=await put(path.join(dir,'aqtools.py'),MOD(url(a)),0o664)+await put(path.join(dir,'aqtool'),CLI,0o775);
   if(m)log('tool bridge: script helpers set for '+a);n+=m}
  return n}
 function close(){for(const w of [...pool.values()])stop(w)}
 return {call,ensureClients,close,url,_pool:pool}}
