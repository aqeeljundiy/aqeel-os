// A map of each agent's own knowledge, and a small tool to search it (owner, 11 Nov 2026: "graphify on all agents,
// efficient, also for non-coding agents").
// Why: every reply sends the agent's instructions and memory in full (continue-threads 43 KB, continue-support 33 KB,
// a second support agent 30 KB on Elkiya), and graphify's skill is another ~12k tokens whenever it is used. So:
//  1. The tool: graphify's own MCP server (`python -m graphify.serve <graph.json>`, stdio) is added to the agent's
//     mcp_servers as "graphify", cut to three tools (search, one node, its neighbours): the list of tools is sent with
//     every call too. It is added only once the agent has a map, because the server exits when there is no graph.
//  2. The map: built from the agent's workspace documents and code plus its "reference" folder (what a person agreed to
//     move out of its instructions), never from anything that can hold a secret: dot folders (except .tools), .env,
//     auth, tokens, credentials, sessions, logs, databases, and any file whose text looks like a key. Only an allowed
//     copy of the files is ever shown to graphify (graph/corpus), so the exclusion is ours and tested, not a pattern
//     list graphify has to honour. Code is mapped without a model (`graphify update`); documents need one
//     (`graphify extract`), once, then only the files that changed (graphify keeps a manifest). At most 30 changed
//     documents per run, one agent per pass, a pass every 20 minutes, an agent looked at every 6 hours at most, and
//     never while the agent is replying (checked before, and every 20 s during: the run is stopped and retried).
//  3. Lean instructions: size() measures what is sent on every call (SOUL.md + memories) against a budget; propose()
//     lists sections that are clearly reference (a price table, a glossary), as a file for a person to accept. accept()
//     is the only thing that rewrites SOUL.md, only on a person's request, after a backup, and it leaves a one-line
//     pointer where the section was. Nothing here changes an agent's instructions by itself.
// Which model reads the documents (owner, 11 Nov 2026: the FREE Gemini route, never a paid key, never forced Claude):
// graph-relay.mjs, a loopback relay that exists only while a run lasts and answers graphify's OpenAI-style calls through
// the owner's Google AI plan (Antigravity's agy), with a Gemini model (DATA/agent-graph/model.json {"model":"gemini-..."}
// changes it, {"route":"none"} turns documents off). graphify is run with a bare environment, so no key that happens to
// be in the server's environment can ever be picked up. When the plan says its limit is reached, documents wait 6 hours
// and code is still mapped. Without agy or its sign-in, the same: code only.
// Until a person turns the rest on (DATA/agent-graph/enabled.json, setEnabled), only a pilot agent is mapped, because each
// agent with a map adds a tool process (~1 to 1.5 GB for all agents on Elkiya).
import {writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,readdir,lstat,stat,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {homedir} from 'node:os';
import {createRelay,FREE_MODEL,isFreeModel} from './graph-relay.mjs';

export const SIZE_BUDGET=16*1024;                 // bytes sent on every call before Health warns
export const TOOL='graphify';
export const TOOL_NAMES=['query_graph','get_node','get_neighbors'];
export const PILOT=['sesa'];   // one small agent (a document and no code on Elkiya, 11 Nov); pepclub-social has nothing to map
export const PASS_MS=20*60e3,GAP_MS=6*3600e3,MAX_DOCS_PER_RUN=30,RUN_MS=40*60e3,BUSY_POLL_MS=20e3;
export const LIMITS={docBytes:400e3,codeBytes:300e3,files:1500,depth:8,scan:20000};

/* ---------- what may be mapped (tested) ---------- */
const DOC_EXT=/\.(md|markdown|txt|rst)$/i;
const CODE_EXT=/\.(py|js|mjs|cjs|ts|tsx|jsx|sh|go|rb|php|java|rs|c|h|cpp|sql)$/i;
// folders never entered; every dot folder is skipped too, except the one the agents keep their own scripts in
const SKIP_DIR=/^(node_modules|__pycache__|venv|env|dist|build|target|vendor|sessions?|logs?|cache|caches|state|vault|mcp-tokens|secrets?|credentials?|tokens?|tmp|temp|backups?|archive|attachments|downloads|exports?|chats?|images|audio_cache|image_cache|composer-pastes|pending|platforms|plugins|screen|browser|profile-exports)$/i;
const DOT_OK=new Set(['.tools']);
// files never read: secrets by name, the instructions and memory (always sent already), databases, backups
const SKIP_FILE=/^(\.env.*|.*\.env|auth\.json|auth\.lock|.*credentials?.*|.*secrets?.*|.*tokens?.*|.*passwords?.*|.*\.(pem|key|p12|pfx|db|db-wal|db-shm|sqlite|log|lock|runlog))$|^(SOUL|AGENTS|MEMORY|USER)\.md$|\.bak/i;
export function kindOf(name){if(SKIP_FILE.test(name))return null;return DOC_EXT.test(name)?'doc':CODE_EXT.test(name)?'code':null}
export const dirOk=name=>name.startsWith('.')?DOT_OK.has(name):!SKIP_DIR.test(name);
// text that looks like a key or password: the whole file stays out of the map
const SECRET_RE=[/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/\bsk-[A-Za-z0-9_-]{20,}/,/\bAKIA[0-9A-Z]{16}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/\bxox[abpr]-[A-Za-z0-9-]{10,}/,/\bAIza[0-9A-Za-z_-]{30,}/,
 /\bBearer\s+[A-Za-z0-9._~+/-]{30,}/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./,/\b(api[_-]?key|secret|token|passw(or)?d|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{16,}/i];
export const looksSecret=text=>SECRET_RE.some(r=>r.test(String(text)));

/* ---------- the size of what is sent every time (tested) ---------- */
// level: ok under the budget, warn above it
export function sizeOf({soul=0,memory=0},budget=SIZE_BUDGET){const total=soul+memory;return {soul,memory,total,budget,over:Math.max(0,total-budget),level:total>budget?'warn':'ok'}}

/* ---------- sections that are clearly reference (tested) ---------- */
const REF_HEAD=/\b(reference|glossary|faq|frequently asked|appendix|catalog(ue)?|price ?list|prices|pricing|product ?list|products|sku|directory|contacts?|lookup|cheat ?sheet|templates?|examples?|samples?|history|changelog|background|specs?|specifications|data dictionary|links|resources|index)\b/i;
const RULE_HEAD=/\b(rules?|polic(y|ies)|never|must|identity|persona|role|tone|voice|safety|security|escalat\w*|boundar\w*|guardrails?|hard|priority|override|decisions?|do not|don'?t|workflow|process|steps|checklist|instructions?|goals?|mission)\b/i;
const RULE_WORD=/\b(never|always|must|must not|do not|don'?t|shall|forbidden|prohibited|required|mandatory|only when|escalate|refuse)\b/gi;
export function headings(text){const lines=String(text).split('\n'),hs=[];let fence=false;
 lines.forEach((l,i)=>{if(/^\s*```/.test(l))fence=!fence;if(fence)return;const m=/^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);if(m)hs.push({level:m[1].length,title:m[2],start:i})});
 for(const h of hs){const next=hs.find(x=>x.start>h.start&&x.level<=h.level);h.end=next?next.start:lines.length}return {lines,hs}}
// sections to propose: reference by heading (or mostly a table), no rule in the heading, few rule words, at least 800 bytes
export function referenceSections(soulText){const {lines,hs}=headings(soulText),out=[];let last=-1;
 for(const h of hs){if(h.start<last)continue;const body=lines.slice(h.start,h.end).join('\n'),bytes=Buffer.byteLength(body);if(bytes<800)continue;
  if(RULE_HEAD.test(h.title)||looksSecret(body))continue;
  const rows=lines.slice(h.start+1,h.end).filter(l=>l.trim()),table=rows.length?rows.filter(l=>/^\s*\|/.test(l)).length/rows.length:0;
  const rules=(body.match(RULE_WORD)||[]).length/(bytes/1024);if(rules>3)continue;
  const byHead=REF_HEAD.test(h.title);if(!byHead&&table<0.6)continue;
  out.push({id:createHash('sha1').update(h.title+'\n'+body).digest('hex').slice(0,10),title:h.title,level:h.level,start:h.start,end:h.end,bytes,text:body,
   reason:byHead?'The heading "'+h.title+'" names reference material, and it holds few rules.':'It is mostly a table, with few rules.'});last=h.end}
 return out}
const slug=t=>String(t).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'section';
// the instructions with the chosen sections replaced by a one-line pointer (a section is replaced whole, last first)
export function withPointers(soulText,chosen,file=s=>'reference/'+slug(s.title)+'.md'){const lines=String(soulText).split('\n');
 for(const s of [...chosen].sort((a,b)=>b.start-a.start))lines.splice(s.start,s.end-s.start,'#'.repeat(s.level)+' '+s.title,'Moved to your map ('+file(s)+'). Look it up with the graph tool (query_graph) when you need it.','');
 return lines.join('\n')}

/* ---------- the tool entry (tested) ---------- */
export const toolEntry=({py,graph})=>({command:py,args:['-m','graphify.serve',graph],env:{GRAPHIFY_NO_AUTO_REFRESH:'1'},tools:{include:[...TOOL_NAMES]},enabled:true});
export const sameEntry=(a,b)=>!!a&&!!b&&a.command===b.command&&JSON.stringify(a.args||[])===JSON.stringify(b.args||[])&&JSON.stringify([].concat(a.tools?.include||[]).sort())===JSON.stringify([...TOOL_NAMES].sort());

// the arguments of the graphify run: documents (a model, only the changed files) or code only (none)
export function runArgs({corpus,docs,first,backend,model}){
 if(docs)return ['extract',corpus,'--max-concurrency','1',...(backend?['--backend',backend]:[]),...(model?['--model',model]:[])];
 return first?['extract',corpus,'--code-only']:['update',corpus]}

const sha=t=>createHash('sha1').update(String(t)).digest('hex');
const posix=p=>p.split(path.sep).join('/');

export function createAgentGraph({HERMES_HOME,DATA,home0=homedir(),readConfig,setKey,pick,agents=async()=>[],skip=async()=>false,busy=async()=>false,paused=()=>false,writeSoul=null,
 run=null,relay=null,now=()=>Date.now(),log=m=>console.log(m),env=process.env,nice=process.platform==='linux',budget=SIZE_BUDGET,limits=LIMITS,busyPoll=BUSY_POLL_MS}){
 // skip may answer at once or later (a test copy gave a plain false, and Health's agent maps failed with a 500)
 const skipOk=a=>Promise.resolve().then(()=>skip(a)).catch(()=>false);
 const PY=path.join(home0,'workspaces','.aqeelos-python'),bin=path.join(PY,'bin','graphify'),py=path.join(PY,'bin','python');
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const wsOf=a=>path.join(home0,'workspaces',a);
 const gdir=a=>path.join(homeOf(a),'graph'),corpusOf=a=>path.join(gdir(a),'corpus'),graphOf=a=>path.join(corpusOf(a),'graphify-out','graph.json'),refOf=a=>path.join(homeOf(a),'reference');
 const D=path.join(DATA,'agent-graph'),STATE=path.join(D,'state.json'),propFile=a=>path.join(D,'proposals',a+'.json');
 const has=p=>stat(p).then(()=>true,()=>false);
 const exec=run||((cmd,args,o={})=>new Promise((res,rej)=>execFile(cmd,args,o,(e,out,er)=>e?rej(new Error(String(er||e.message).trim().split('\n').slice(-3).join(' '))):res(String(out)))));
 const wjson=async(f,v)=>{await mkdir(path.dirname(f),{recursive:true});await writeStore(f,JSON.stringify(v,null,1))};
 const rjson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 let st=null,running=false,backendAt=0,backendIs=null;
 const startRelay=relay||(o=>createRelay({home:home0,env,log}).start(o));
 // graphify runs with this and nothing else: no key from the server's own environment can reach it
 const bare=(extra={})=>({PATH:env.PATH||'/usr/bin:/bin',HOME:home0,LANG:env.LANG||'C.UTF-8',GRAPHIFY_NO_AUTO_REFRESH:'1',...extra});
 const load=async()=>{if(!st){st=await rjson(STATE,{});st.agents||={}}return st};
 const save=()=>wjson(STATE,st);
 const off=()=>has(path.join(HERMES_HOME,'.aqeelos-graph-off'));
 // no answer counts as busy: nothing is started on a guess
 const isBusy=async a=>{try{return !!await busy(a)}catch{return true}};

 // graphify installed with its MCP extra (graphify.mjs), and the Python that runs it
 const toolReady=async()=>await has(bin)&&await exec(py,['-c','import mcp, graphify.serve'],{timeout:30e3}).then(()=>true,()=>false);
 // the model for documents: the free Gemini route when agy is there and signed in, and not in a limit pause; null means
 // documents wait (code is still mapped). Checked at most once an hour.
 async function backend(){await load();if(st.quotaUntil>now())return null;if(backendAt&&now()-backendAt<3600e3)return backendIs;backendAt=now();
  const own=await rjson(path.join(D,'model.json'),{});const model=String(own.model||FREE_MODEL);
  if(own.route==='none'||!isFreeModel(model)||st?.quotaUntil>now()){backendIs=null;return null}
  const ok=await has(path.join(home0,'.gemini','antigravity-cli'))&&await exec(path.join(home0,'.local','bin','agy'),['--version'],{timeout:30e3,env:bare({PATH:path.join(home0,'.local','bin')+':'+(env.PATH||'/usr/bin:/bin')})}).then(()=>true,()=>false);
  backendIs=ok?{name:'openai',model,named:true,free:true}:null;return backendIs}
 // who has a map: the pilot until a person turns on the rest
 const sw=()=>rjson(path.join(D,'enabled.json'),{});
 async function isOn(a){const e=await sw();return e.all===true||(Array.isArray(e.agents)?e.agents:PILOT).includes(a)}
 async function setEnabled({all,agents:list}){const e=await sw();if(typeof all==='boolean')e.all=all;if(Array.isArray(list))e.agents=list.map(String).filter(x=>/^[a-z0-9][a-z0-9_-]{0,80}$/.test(x));await wjson(path.join(D,'enabled.json'),e);return {all:e.all===true,agents:e.agents||PILOT}}

 /* ---------- the size of what is sent every time ---------- */
 async function size(a){const soul=await readFile(path.join(homeOf(a),'SOUL.md')).then(b=>b.length,()=>0);let memory=0;
  for(const f of await readdir(path.join(homeOf(a),'memories')).catch(()=>[]))if(/\.md$/i.test(f))memory+=await stat(path.join(homeOf(a),'memories',f)).then(s=>s.size,()=>0);
  // AGENTS.md in the agent's folder is read into the prompt too; shown, not counted in the budget the owner set
  const agentsMd=await stat(path.join(wsOf(a),'AGENTS.md')).then(s=>s.size,()=>0);
  return {...sizeOf({soul,memory},budget),agentsMd}}

 /* ---------- the files that may be mapped ---------- */
 // every allowed file of the workspace and of the reference folder: {rel (under corpus), abs, size, mtime, kind}
 async function walk(a){const out=[];let seen=0;
  async function go(dir,rel,prefix,depth){if(depth>limits.depth||seen>limits.scan)return;
   for(const d of await readdir(dir,{withFileTypes:true}).catch(()=>[])){seen++;const abs=path.join(dir,d.name),r=rel?rel+'/'+d.name:d.name;
    if(d.isSymbolicLink())continue;
    if(d.isDirectory()){if(dirOk(d.name))await go(abs,r,prefix,depth+1);continue}
    if(!d.isFile())continue;const kind=kindOf(d.name);if(!kind)continue;
    const s=await lstat(abs).catch(()=>null);if(!s||s.size===0||s.size>(kind==='doc'?limits.docBytes:limits.codeBytes))continue;
    out.push({rel:prefix+'/'+r,abs,size:s.size,mtime:Math.round(s.mtimeMs),kind})}}
  await go(wsOf(a),'','workspace',0);
  // the reference folder holds what a person agreed to move out of the instructions: documents only, whatever the name
  for(const d of await readdir(refOf(a),{withFileTypes:true}).catch(()=>[]))if(d.isFile()&&DOC_EXT.test(d.name)){const abs=path.join(refOf(a),d.name),s=await lstat(abs).catch(()=>null);
   if(s&&s.size>0&&s.size<=limits.docBytes)out.push({rel:'reference/'+d.name,abs,size:s.size,mtime:Math.round(s.mtimeMs),kind:'doc',ref:true})}
  // too many: the newest stay
  return out.sort((x,y)=>y.mtime-x.mtime).slice(0,limits.files)}

 /* ---------- one agent's map ---------- */
 // stop a run when the agent starts replying; resolves {stopped}
 function watch(a,ac){let dead=false;const t=setInterval(async()=>{if(dead)return;if(await isBusy(a)){ac.stopped=true;ac.abort()}},busyPoll);t.unref?.();return ()=>{dead=true;clearInterval(t)}}
 async function refresh(a,{force=false}={}){await load();const s=(st.agents[a]||={});const t=now();
  if(!force&&await isBusy(a))return {skipped:'busy'};
  const be=await backend();const files=await walk(a);
  const manifest=await rjson(path.join(gdir(a),'staged.json'),{});
  const first=!await has(graphOf(a));
  // what is new or changed, and gone; documents only when a model is there, and only a few at a time
  const want=new Map(files.filter(f=>f.kind==='code'||be).map(f=>[f.rel,f]));
  const changed=[...want.values()].filter(f=>{const m=manifest[f.rel];return !m||m.size!==f.size||m.mtime!==f.mtime});
  const present=new Set(files.map(f=>f.rel)),gone=Object.keys(manifest).filter(k=>!present.has(k));   // not documents that only wait for a model
  const docs=changed.filter(f=>f.kind==='doc').slice(0,MAX_DOCS_PER_RUN),code=changed.filter(f=>f.kind==='code'),later=changed.length-docs.length-code.length;
  const stage=[...docs,...code];
  s.lastTry=t;s.files={docs:files.filter(f=>f.kind==='doc').length,code:files.filter(f=>f.kind==='code').length};s.model=be?be.model:null;
  if(!stage.length&&!gone.length&&!first){s.state=later>0?'building':'ready';s.waiting=later>0?later:0;await save();return {skipped:'nothing changed'}}
  // nothing to build from yet: no files at all, or only documents and no model to read them
  if(first&&!stage.length){s.state=files.length?'needs-model':'nothing';s.error=null;await save();return {skipped:'nothing to map'}}
  if(await isBusy(a)&&!force)return {skipped:'busy'};
  // copy the allowed files in, last chance for a secret to be caught by its text
  const next={...manifest};let secret=0;await mkdir(corpusOf(a),{recursive:true});
  for(const f of stage){const to=path.join(corpusOf(a),...f.rel.split('/'));
   const text=await readFile(f.abs,'utf8').catch(()=>null);
   if(text===null)continue;if(looksSecret(text)){secret++;next[f.rel]={size:f.size,mtime:f.mtime,secret:true};await rm(to,{force:true}).catch(()=>{});continue}
   await mkdir(path.dirname(to),{recursive:true});await copyFile(f.abs,to);next[f.rel]={size:f.size,mtime:f.mtime,kind:f.kind}}
  for(const k of gone){await rm(path.join(corpusOf(a),...k.split('/')),{force:true}).catch(()=>{});delete next[k]}
  s.skippedSecret=Object.values(next).filter(x=>x.secret).length;
  const needDocs=!!be&&(docs.length>0||gone.some(k=>manifest[k]?.kind==='doc'));
  const args=runArgs({corpus:corpusOf(a),docs:needDocs,first,backend:needDocs?be.name:null,model:needDocs?be.model:null});
  const ac=new AbortController(),unwatch=watch(a,ac);s.state=first?'building':'updating';s.error=null;await save();let rl=null;
  try{let genv=bare();
   if(needDocs){rl=await startRelay({model:be.model,onQuota:()=>{ac.quota=true;ac.abort()}});genv=bare({GRAPHIFY_BACKEND:'openai',OPENAI_BASE_URL:rl.url,OPENAI_API_KEY:rl.key,OPENAI_MODEL:be.model})}
   const [cmd,cargs]=nice?['nice',['-n','19',bin,...args]]:[bin,args];
   await exec(cmd,cargs,{timeout:RUN_MS,maxBuffer:16e6,cwd:corpusOf(a),env:genv,signal:ac.signal});
   unwatch();await rl?.stop?.();rl=null;if(!await has(graphOf(a)))throw new Error('graphify wrote no graph');
   await wjson(path.join(gdir(a),'staged.json'),next);
   const g=await stat(graphOf(a));s.state=later>0?'building':'ready';s.waiting=Math.max(0,later);s.lastOk=t;s.error=null;s.fails=0;s.graphBytes=g.size;s.fp=sha(JSON.stringify(Object.entries(next)));
   const nodes=g.size<30e6?await rjson(graphOf(a),null):null;s.nodes=Array.isArray(nodes?.nodes)?nodes.nodes.length:null;
   await save();const added=await ensureTool(a).catch(e=>{log('graph: tool for '+a+': '+e.message);return false});
   log('graph: '+a+' map '+(first?'built':'updated')+' ('+stage.length+' files'+(gone.length?', '+gone.length+' gone':'')+')');return {ok:true,tool:added}}
  catch(e){unwatch();await rl?.stop?.().catch(()=>{});
   // the free plan's limit: documents wait 6 hours, nothing is marked failed, no other route is tried
   if(ac.quota||rl?.stats?.quota){st.quotaUntil=now()+6*3600e3;backendIs=null;for(const f of docs)if(!manifest[f.rel])await rm(path.join(corpusOf(a),...f.rel.split('/')),{force:true}).catch(()=>{});s.state=s.lastOk?'ready':'waiting';s.error=null;s.notice='The free Gemini plan\u2019s limit was reached; documents wait about 6 hours.';await save();log('graph: '+a+': the free Gemini plan\u2019s limit was reached, documents wait 6 hours');return {skipped:'quota'}}
   if(ac.stopped){s.state=s.lastOk?'ready':'waiting';s.error=null;await save();log('graph: '+a+' started replying, map run stopped (retried later)');return {skipped:'busy'}}
   s.state='failed';s.fails=(s.fails||0)+1;s.error=String(e.message||e).slice(0,300);await save();log('graph: '+a+': '+s.error);return {error:s.error}}}

 // the agent's tool entry, once it has a map; a person's own choice (switched off, or changed) stays
 async function ensureTool(a){if(!await has(graphOf(a)))return false;const c=await readConfig(a).catch(()=>null);if(!c)return false;
  const have=pick(c,'mcp_servers.'+TOOL),want=toolEntry({py,graph:graphOf(a)});
  if(have&&(have.enabled===false||String(have.command||'')!==py))return false;   // switched off, or someone else's tool of that name
  if(sameEntry(have,want))return false;const r=await setKey(a,'mcp_servers.'+TOOL,want);if(!r?.ok)throw new Error(r?.err||'could not save');return true}

 /* ---------- the rhythm ---------- */
 // one pass: the agent longest without a look, if its time has come; an agent with nothing new costs one folder scan
 async function tick(){if(running||paused()||await off())return null;running=true;
  try{await load();if(!await toolReady())return null;
   const names=[];for(const a of await agents().catch(()=>[]))if(!await skipOk(a)&&await has(homeOf(a))&&await isOn(a))names.push(a);
   const due=names.filter(a=>{const s=st.agents[a]||{};return !s.lastTry||now()-s.lastTry>=GAP_MS*Math.min(4,2**(s.fails||0))||s.state==='building'&&now()-s.lastTry>=PASS_MS}).sort((x,y)=>(st.agents[x]?.lastTry||0)-(st.agents[y]?.lastTry||0));
   const changed=[];let looked=0;
   for(const a of due){if(looked++>=4)break;const r=await refresh(a);if(r.ok){if(r.tool)changed.push(a);break}if(r.error||r.skipped==='busy'||r.skipped==='quota')break}
   // an agent that already has a map but lost its tool entry (a new copy of its settings) gets it back
   for(const a of names)if((st.agents[a]?.lastOk)&&await ensureTool(a).catch(()=>false))changed.push(a);
   for(const k of Object.keys(st.agents))if(!await has(homeOf(k)))delete st.agents[k];
   await save();return {changed:[...new Set(changed)]}}
  finally{running=false}}

 /* ---------- lean instructions: a proposal for a person ---------- */
 // written when the instructions are over the budget and have clearly-reference sections; a person accepts (accept) or dismisses it
 async function propose(a){const soul=await readFile(path.join(homeOf(a),'SOUL.md'),'utf8').catch(()=>null);if(soul===null)return null;
  const z=await size(a),h=sha(soul),old=await rjson(propFile(a),null);
  if(old&&old.soulSha===h&&!old.accepted)return old;
  if(z.level==='ok')return null;
  const sections=referenceSections(soul);if(!sections.length)return null;
  const p={agent:a,at:now(),soulSha:h,soulBytes:z.soul,total:z.total,budget:z.budget,saves:sections.reduce((n,s)=>n+s.bytes,0),sections,dismissed:false,accepted:false};
  await wjson(propFile(a),p);log('graph: proposal for '+a+': '+sections.length+' section(s), '+p.saves+' bytes');return p}
 async function proposal(a){return rjson(propFile(a),null)}
 async function dismiss(a){const p=await proposal(a);if(!p)return false;p.dismissed=true;await wjson(propFile(a),p);return true}
 // a person said yes to these sections (ids): backup, write them into the agent's reference folder, pointer in their place
 async function accept(a,ids,{by='a person'}={}){const p=await proposal(a);if(!p||p.accepted)throw new Error('There is nothing to accept for this agent.');
  const chosen=p.sections.filter(s=>(ids||[]).includes(s.id));if(!chosen.length)throw new Error('Choose at least one section.');
  const file=path.join(homeOf(a),'SOUL.md'),soul=await readFile(file,'utf8').catch(()=>null);if(soul===null)throw new Error('This agent has no instructions file.');
  if(sha(soul)!==p.soulSha)throw new Error('The instructions changed since this was proposed. A new proposal will follow.');
  // the moved text has to be findable: a model must be there to map documents, and the agent must have its tool
  if(!await backend())throw new Error('Documents cannot be mapped yet: the free Gemini route is not available right now. Nothing was moved.');
  const stamp=new Date(now()).toISOString().replace(/[-:]/g,'').replace(/\..*/,'').replace('T','-');
  await mkdir(path.join(D,'backups',a),{recursive:true});await writeFile(path.join(D,'backups',a,'SOUL-'+stamp+'.md'),soul);await writeFile(path.join(homeOf(a),'SOUL.md.bak-'+stamp+'-graph'),soul);
  await mkdir(refOf(a),{recursive:true});
  for(const s of chosen)await writeFile(path.join(refOf(a),slug(s.title)+'.md'),'# '+s.title+'\n\n(Moved out of the instructions on '+new Date(now()).toISOString().slice(0,10)+'.)\n\n'+s.text.split('\n').slice(1).join('\n').trim()+'\n');
  const next=withPointers(soul,chosen);
  if(writeSoul)await writeSoul(a,next,{kind:'graph',by,why:'Moved '+chosen.length+' reference section(s) into the agent\'s map: '+chosen.map(s=>s.title).join(', ')});else await writeFile(file,next);
  p.accepted=true;p.acceptedAt=now();p.acceptedBy=by;p.moved=chosen.map(s=>s.id);await wjson(propFile(a),p);
  await load();(st.agents[a]||={}).lastTry=0;await save();   // the map takes the new files at the next pass
  log('graph: '+a+': '+chosen.length+' section(s) moved into its map by '+by);
  return {moved:chosen.map(s=>s.title),saved:chosen.reduce((n,s)=>n+s.bytes,0),backup:'SOUL.md.bak-'+stamp+'-graph'}}

 // Health: per agent, the size sent every time, the map, and any proposal waiting
 async function view(){await load();const out={};
  for(const a of await agents().catch(()=>[])){if(await skipOk(a)||!await has(homeOf(a)))continue;
   const s=st.agents[a]||{},p=await proposal(a),z=await size(a);
   out[a]={size:z,map:{state:s.state||'waiting',nodes:s.nodes??null,files:s.files||null,lastOk:s.lastOk||null,waiting:s.waiting||0,error:s.error||null,notice:s.notice||null,model:s.model??null,on:await isOn(a),skippedSecret:s.skippedSecret||0},
    proposal:p&&!p.dismissed&&!p.accepted?{saves:p.saves,sections:p.sections.map(x=>({id:x.id,title:x.title,bytes:x.bytes,reason:x.reason}))}:null}}
  return {budget,enabled:{...(await sw()),all:(await sw()).all===true,agents:(await sw()).agents||PILOT},quotaUntil:st.quotaUntil>now()?st.quotaUntil:null,agents:out}}
 return {tick,refresh,setEnabled,isOn,ensureTool,size,propose,proposal,dismiss,accept,view,walk,backend,toolReady,corpusOf,graphOf}}
