// Automations guard (25 Oct 2026). On 24 Oct an engine update removed the Python that two tool environments were built
// on (Pixel's own tool server and the PDF tool). After the next engine restart the engine parked Pixel's tool server and
// never tried again, so Pixel's hourly job failed 8 times in a row before anyone saw it. This watches for that kind of
// break and fixes it by itself:
//   - every 2 minutes: new lines in every agent's agent.log (a tool server parked or failing to connect, an agent calling
//     a tool of a tool server it no longer has) and new scheduled job replies that say a tool was not there;
//   - every 15 minutes: every tool server that runs as a program on the box can still start (its program is there and
//     may run, the Python it starts still exists), and no Python environment under ~/.hermes points at a Python that is gone;
//   - the fix, one at a time per agent and at most once per tool server per 30 min, waiting (up to 10 min) while agents
//     are at work: a broken Python environment is built again with the engine's current Python and the same package
//     versions (the old one is kept as <name>.broken-<old version>-<date>), then the engine is made to connect the tool
//     server again: removed and added back through its dashboard, the only thing that makes it try a parked one again
//     (switching it off and on does not). The engine's own Test checks it after;
//   - a tool server that needs a person to sign in is reported once and never retried by aqeelOS;
//   - the owner hears about it: every problem and fix rings the bell, a fix that failed also goes to WhatsApp at once,
//     and the day's fixes come as one short WhatsApp message in the daytime. System › Health shows it all with Fix now
//     and Run now (a schedule that failed because of the tool server is offered again, never run by itself).
// Engine updates (engine-updates.mjs) and aqeelOS's own engine restarts run the full check too (fullCheck).
// The parts that only decide (log lines, scripts, package lists, when to try or tell again) are exported and tested in
// scripts/automation-guard.test.mjs. The engine's own files are never changed; only agents' config.yaml (through the
// engine's dashboard, with a backup first) and the broken Python environments.
import {readFile,writeFile,mkdir,rename,readdir,stat,lstat,realpath,access,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile,spawn} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';

/* ---------- the parts that only decide (tested) ---------- */
const TS=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:,(\d{1,3}))?\s/;
const AUTHY=/oauth|unauthori[sz]ed|\b401\b|invalid_grant|invalid_token|hermes mcp login|sign[- ]?in/i;
const names=s=>[...String(s||'').matchAll(/'([^']+)'/g)].map(m=>m[1]);
// "a (why); b (why (more))": the names, split only where the brackets are closed
export function splitFailed(s){const out=[];let d=0,cur='';for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='(')d++;else if(ch===')')d--;
  if(d===0&&ch===';'){out.push(cur);cur='';continue}cur+=ch}if(cur.trim())out.push(cur);
 return out.map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf(' (');return i<0?{server:p,reason:''}:{server:p.slice(0,i),reason:p.slice(i+2).replace(/\)$/,'')}})}
// one engine log line (UTC time) as what it says about tool servers; [] when nothing
export function parseLogLine(l){const m=TS.exec(l||'');if(!m)return [];const t=Date.parse(m[1]+'T'+m[2]+'.'+(m[3]||'0').padEnd(3,'0')+'Z');let x;
 if((x=/MCP server '([^']+)' failed initial authentication/.exec(l))||(x=/MCP OAuth setup failed for '([^']+)'/.exec(l)))return [{t,kind:'signin',server:x[1],reason:'needs someone to sign in'}];
 if(x=/MCP server '([^']+)' failed initial .*?parking (?:until a reconnect is requested|without retries)(?:[^(]*\(state: [^)]*\))?(?::\s*(.*))?$/.exec(l))return [{t,kind:'parked',server:x[1],reason:(x[2]||'').slice(0,200)}];
 if(x=/MCP server '([^']+)' failed after \d+ reconnection attempts, parking; will self-probe/.exec(l))return [{t,kind:'probing',server:x[1]}];
 if((x=/MCP server '([^']+)': revived/.exec(l))||(x=/MCP server '([^']+)' \(\w+\): registered \d+ tool/.exec(l)))return [{t,kind:'ok',server:x[1]}];
 if(x=/Failed to connect to MCP server '([^']+)'(?: \(command=[^)]*\))?: (.*)$/.exec(l))return [{t,kind:AUTHY.test(x[2])?'signin':'failed',server:x[1],reason:x[2].slice(0,200)}];
 if(x=/MCP: (?:registered )?\d+ tool\(s\) from \d+ server\(s\) \(\d+ failed: (.*)\)\s*$/.exec(l))return splitFailed(x[1]).map(f=>({t,kind:AUTHY.test(f.reason)?'signin':'failed',server:f.server,reason:f.reason.slice(0,200)}));
 if(x=/MCP servers reconciled with config \(([^)]*)\): removed=\[([^\]]*)\] added=\[([^\]]*)\]/.exec(l))return [{t,kind:'reconciled',label:x[1],removed:names(x[2]),added:names(x[3])}];
 if(x=/'([^']+)' is not a known tool name/.exec(l))return [{t,kind:'unknown-tool',tool:x[1]}];
 return []}
// which tool server a tool belongs to: its mcp__<server>__ name, or the tool names the engine keeps per server
export function serverOfTool(tool,byServer){const m=/^mcp__(.+?)__/.exec(tool||'');if(m&&byServer[m[1]])return m[1];
 for(const [s,l] of Object.entries(byServer||{}))if(l.includes(tool)||l.includes(String(tool).replace(/^mcp__.+?__/,'')))return s;return null}
// one server's record after one log event: state ok / failing / parked / probing / missing / signin
export function apply(rec,ev){
 if(ev.kind==='ok'){rec.conn='up';if(rec.state!=='ok'){rec.state='ok';rec.since=0;rec.reason=''}rec.okAt=ev.t;return rec}
 if(ev.kind==='signin'){rec.conn='down';if(rec.state!=='signin'){rec.state='signin';rec.since=ev.t}rec.reason=ev.reason||'needs someone to sign in';return rec}
 if(ev.kind==='parked'){rec.conn='down';if(rec.state!=='parked')rec.since=ev.t;rec.state='parked';rec.reason=ev.reason||rec.reason||'';return rec}
 if(ev.kind==='probing'){rec.conn='down';if(!['parked','probing'].includes(rec.state)){rec.state='probing';rec.since=ev.t}return rec}
 if(ev.kind==='failed'){rec.conn='down';if(!rec.state||rec.state==='ok'||rec.state==='missing'){rec.state='failing';rec.since=ev.t}rec.reason=ev.reason||rec.reason||'';return rec}
 // an agent asked for one of its tools: a problem only when the server is not known to be connected (a model that
 // misspells a tool of a working server is not one)
 if(ev.kind==='unknown-tool'){rec.toolAt=ev.t;rec.tool=ev.tool;if(rec.conn!=='up'&&(!rec.state||rec.state==='ok')){rec.state='missing';rec.since=ev.t;rec.reason='an agent called '+ev.tool+' and it was not there'}return rec}
 return rec}
// what to do about one server now: nothing, a fix, tell that it needs a sign-in, or wait (tried less than 30 min ago)
export function nextStep(rec,now,{stdio=false,every=30*60e3}={}){if(!rec?.state||rec.state==='ok')return 'none';if(rec.state==='signin')return 'signin';
 const age=now-(rec.since||now),due=rec.state==='parked'||rec.state==='missing'||rec.state==='broken'||rec.state==='failing'&&age>=(stdio?10:30)*60e3||rec.state==='probing'&&age>=30*60e3;
 if(!due)return 'none';return mayTry(rec,now,every)?'repair':'wait'}
export const mayTry=(rec,now,every=30*60e3)=>!rec?.lastTry||now-rec.lastTry>=every;
// tell the owner about the same thing once per `every` (sign-ins: once, until it works again)
export function shouldTell(told,key,now,every=6*3600e3){const t=told?.[key];return !t||every!==Infinity&&now-t>=every}
// the Pythons a start script runs: its #! line (not /usr/bin/env) and every absolute path it execs or names as a Python
export function scriptInterpreters(text){const out=new Set(),lines=String(text||'').split('\n');
 const she=/^#!\s*(\S+)/.exec(lines[0]||'');if(she&&!/\/env$/.test(she[1]))out.add(she[1]);
 for(const l0 of lines){const l=l0.replace(/#.*$/,'').trim();if(!l)continue;
  const e=/(?:^|[;&|]\s*)(?:\w+=\S*\s+)*exec\s+(?:\w+=\S*\s+)*(\/\S+)/.exec(l);if(e)out.add(e[1].replace(/["']/g,''));
  for(const m of l.matchAll(/(\/[\w.+\/-]+\/bin\/python[\d.]*)\b/g))out.add(m[1])}
 return [...out]}
// the packages of an old environment, from its *.dist-info folder names, as exact pins
export function requirementsFromDistInfo(dirs){const seen=new Map();
 for(const d of dirs||[]){const m=/^(.+)-([^-]+)\.dist-info$/.exec(d);if(!m)continue;const n=m[1].replace(/_/g,'-').toLowerCase();if(!seen.has(n))seen.set(n,n+'=='+m[2])}
 return [...seen.values()].sort()}
// the newest of the engine's managed tools ("python-3.14.9+20261021-linux-x64", "uv-0.13.5-linux-x64")
export function newestTool(list,prefix){const v=n=>(n.slice(prefix.length+1).match(/\d+/g)||[]).map(Number);
 return (list||[]).filter(n=>n.startsWith(prefix+'-')&&/\d/.test(n.charAt(prefix.length+1))).sort((a,b)=>{const x=v(a),y=v(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d}return 0}).pop()||null}
// a scheduled job's reply (the "## Response" part of its output file) that says a tool was not there
export const responseOf=md=>{const i=String(md||'').search(/^## Response\s*$/m);return i<0?'':String(md).slice(i).replace(/^## Response\s*/,'')};
const TOOLISH=/\btools?\b|\bMCP\b|server|mcp__|\w+_\w+/i;
export function toolFailed(reply){const r=String(reply||'');if(!r.trim())return null;
 const m=/is not a known tool|failed to connect|gagal jalan|tidak tersedia|not available|unavailable/i.exec(r);if(!m)return null;
 if(/tidak tersedia|not available|unavailable|gagal jalan/i.test(m[0])&&!TOOLISH.test(r))return null;
 const i=Math.max(0,m.index-120);return r.slice(i,m.index+120).replace(/\s+/g,' ').trim()}

/* ---------- the guard ---------- */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=(cmd,args,{timeout=600000,env,cwd}={})=>new Promise(res=>execFile(cmd,args,{timeout,maxBuffer:16e6,env:env||process.env,cwd:cwd||homedir()},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||'')})));
const lastLine=s=>String(s||'').trim().split('\n').filter(Boolean).pop()?.slice(0,200)||'';
const FIRST=1e6;   // the first look at a log reads its last 1 MB

export function createAutomationGuard({DATA,HERMES_HOME,LIVE,listAgents,readConfig,withAgent,setKey,dash,busy=()=>0,paused=()=>false,tell=async()=>{},zone=async()=>'UTC',nameOf=a=>a,readOnly=false,isDaytime=()=>true,localDate=ms=>new Date(ms).toISOString().slice(0,10)}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const FILE=path.join(DATA,'automation-guard.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}for(const k of ['offsets','servers','jobs','venvs','told'])db[k]||={};db.digest||=[]}return db};
 // fixes run side by side (one per agent), so writes take turns
 let saving=Promise.resolve();const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)}).catch(e=>console.warn('automations: saving',e.message));
 const key=(a,s)=>a+'|'+s;
 const rec=(a,s)=>db.servers[key(a,s)]||=({agent:a,name:s,state:'ok'});
 const say=async(k,text,o={})=>{if(!shouldTell(db.told,k,Date.now(),o.every))return;db.told[k]=Date.now();console.log('automations:',text,o.detail?'('+o.detail.slice(0,160)+')':'');
  if(!LIVE||readOnly)return;await tell(text,o).catch(e=>console.warn('automations: telling the owner',e.message))};
 const forget=prefix=>{for(const k of Object.keys(db.told))if(k.startsWith(prefix))delete db.told[k]};

 /* ---------- facts ---------- */
 const servers=async a=>{const c=await readConfig(a).catch(()=>null);const m=c?.mcp_servers;return m&&typeof m==='object'?m:{}};
 const enabled=c=>c&&c.enabled!==false&&c.enabled!=='false';
 async function toolsOf(a){try{const j=JSON.parse(await readFile(path.join(homeOf(a),'cache','mcp_schema_cache.json'),'utf8'));const out={};
   for(const [s,v] of Object.entries(j||{}))out[s]=(Array.isArray(v?.tools)?v.tools:[]).map(t=>t?.name).filter(Boolean);return out}catch{return {}}}
 async function readRange(f,from,to){const h=await open(f,'r').catch(()=>null);if(!h)return Buffer.alloc(0);try{const n=Math.max(0,Math.min(to-from,8e6)),b=Buffer.alloc(n);await h.read(b,0,n,from);return b}finally{await h.close()}}
 // the log lines written since the last look; a log that was rotated: the rest of agent.log.1 first. A line still being
 // written waits for the next look.
 async function readNew(f){const st=await stat(f).catch(()=>null);if(!st)return '';const o=db.offsets[f];let pre=Buffer.alloc(0),from;
  if(!o)from=Math.max(0,st.size-FIRST);
  else if(o.ino!==st.ino||st.size<o.pos){const old=await stat(f+'.1').catch(()=>null);if(old&&old.ino===o.ino&&old.size>o.pos){pre=await readRange(f+'.1',o.pos,old.size);pre=pre.subarray(0,pre.lastIndexOf(10)+1)}from=0}
  else from=o.pos;
  let b=await readRange(f,from,st.size);if(!o&&from>0){const i=b.indexOf(10)+1;b=b.subarray(i);from+=i}
  const cut=b.lastIndexOf(10)+1;db.offsets[f]={ino:st.ino,pos:from+cut};return pre.toString('utf8')+b.subarray(0,cut).toString('utf8')}
 const which=async(cmd)=>{if(path.isAbsolute(cmd))return cmd;const tools=path.join(HERMES_HOME,'tools');const extra=[];for(const d of await readdir(tools).catch(()=>[]))extra.push(path.join(tools,d,'bin'));
  for(const d of [...String(process.env.PATH||'').split(':'),path.join(homedir(),'.local','bin'),'/usr/local/bin','/usr/bin','/bin',...extra].filter(Boolean)){const p=path.join(d,cmd);if(await stat(p).catch(()=>null))return p}return null};
 // a path that should run: there (or a link to nothing), and which Python environment it belongs to
 async function resolve(p){const l=await lstat(p).catch(()=>null);if(!l)return {path:p,ok:false,why:'missing'};let target=null;try{target=await realpath(p)}catch{}
  const dir=/\/bin\/python[\d.]*$/.test(p)?path.dirname(path.dirname(p)):null,venv=dir&&await stat(path.join(dir,'pyvenv.cfg')).catch(()=>null)?dir:null;
  return target?{path:p,ok:true,target,venv}:{path:p,ok:false,why:'points at something that is gone',venv}}
 // one tool server that runs as a program: its program, the Pythons it starts, the file it runs
 async function inspect(c){const out={command:c.command,interps:[],problems:[],venvs:[]};const cmd=await which(String(c.command));
  if(!cmd){out.problems.push('its program '+c.command+' is not on the box');return out}
  const r=await resolve(cmd);if(!r.ok){out.problems.push('its program '+cmd+' '+r.why);if(r.venv)out.venvs.push(r.venv);out.interps.push(r);return out}
  if(!await access(cmd,constants.X_OK).then(()=>true,()=>false))out.problems.push('its program '+cmd+' may not be run (not executable)');
  const st=await stat(cmd).catch(()=>null);let text='';if(st&&st.size<256e3){const b=await readFile(cmd).catch(()=>Buffer.alloc(0));if(b.subarray(0,2).toString()==='#!')text=b.toString('utf8')}
  for(const p of scriptInterpreters(text)){const x=await resolve(p);out.interps.push(x);if(!x.ok){out.problems.push('it starts '+p+', which '+x.why);if(x.venv)out.venvs.push(x.venv)}}
  if(r.venv)out.interps.push(r);
  for(const a of c.args||[])if(typeof a==='string'&&path.isAbsolute(a)&&/\.(py|sh|js|mjs|cjs)$/.test(a)&&!await stat(a).catch(()=>null))out.problems.push('the file it runs, '+a+', is not there');
  out.venvs=[...new Set(out.venvs)];return out}
 // every Python environment straight under ~/.hermes (*venv*/ and */venv/), except the kept broken ones
 async function venvScan(){const out=[];for(const d of await readdir(HERMES_HOME,{withFileTypes:true}).catch(()=>[])){if(!d.isDirectory()||d.name.startsWith('.')||/\.broken/.test(d.name))continue;
   for(const v of [/venv/.test(d.name)?path.join(HERMES_HOME,d.name):null,path.join(HERMES_HOME,d.name,'venv')].filter(Boolean)){const py=path.join(v,'bin','python');if(!await lstat(py).catch(()=>null)||!await stat(path.join(v,'pyvenv.cfg')).catch(()=>null))continue;
    const r=await resolve(py);out.push({dir:v,ok:r.ok,target:r.target||null})}}return out}

 /* ---------- looking ---------- */
 async function scanLogs(){const all=await listAgents();for(const a of all){const cfg=await servers(a);const lines=(await readNew(path.join(homeOf(a),'logs','agent.log'))).split('\n');let tools=null;
   for(const l of lines){if(!/MCP|not a known tool name/.test(l))continue;for(const ev of parseLogLine(l)){
    if(ev.kind==='reconciled')continue;
    if(ev.kind==='unknown-tool'){tools||=await toolsOf(a);const s=serverOfTool(ev.tool,tools);if(!s||!cfg[s]||!enabled(cfg[s]))continue;apply(rec(a,s),ev);continue}
    if(!cfg[ev.server]||!enabled(cfg[ev.server]))continue;const r=rec(a,ev.server);const was=r.state;apply(r,ev);if(r.state==='ok'&&was!=='ok')forget('srv|'+key(a,ev.server)+'|')}}}}
 // programs, Pythons, environments: true problems are set on the record as "broken" (cleared again when they are fine)
 async function staticCheck(){const found=[];for(const a of await listAgents())for(const [s,c] of Object.entries(await servers(a))){if(!enabled(c)||!c.command)continue;const x=await inspect(c);const r=rec(a,s);r.stdio=true;r.interps=x.interps.map(i=>({path:i.path,target:i.target||null}));r.venvs=x.venvs;
   if(x.problems.length){if(r.state!=='broken'){r.state='broken';r.since=Date.now()}r.staticBad=true;r.reason=x.problems.join('; ');found.push(r)}else if(r.staticBad){r.staticBad=false;if(r.state==='broken'){r.state='ok';r.since=0;r.reason='';forget('srv|'+key(a,s)+'|')}}}
  for(const v of await venvScan()){const x=db.venvs[v.dir]||={};if(!v.ok){if(x.state!=='broken')x.since=Date.now();x.state='broken'}else if(x.state==='broken'){x.state='ok';forget('venv|'+v.dir)}}
  db.staticAt=Date.now();return found}
 async function scanJobs(){const now=Date.now();for(const a of await listAgents()){const dir=path.join(homeOf(a),'cron');let list=[];try{const j=JSON.parse(await readFile(path.join(dir,'jobs.json'),'utf8'));list=Array.isArray(j)?j:j.jobs||[]}catch{continue}
   const cfg=await servers(a);let tools=null;
   for(const job of list){if(!job?.id)continue;const od=path.join(dir,'output',job.id);const f=(await readdir(od).catch(()=>[])).filter(x=>x.endsWith('.md')).sort().pop();if(!f)continue;const k=key(a,job.id),was=db.jobs[k];if(was?.file===f)continue;
    const st=await stat(path.join(od,f)).catch(()=>null);const reply=responseOf(await readFile(path.join(od,f),'utf8').catch(()=>''));const why=toolFailed(reply);
    let linked=[];if(why){tools||=await toolsOf(a);for(const s of Object.keys(cfg))if(new RegExp('\\b'+s.replace(/[.*+?^${}()|[\]\\-]/g,'\\$&')+'\\b','i').test(reply)||(tools[s]||[]).some(t=>reply.includes(t)))linked.push(s)}
    db.jobs[k]={agent:a,id:job.id,name:job.name||job.id,file:f,at:st?.mtimeMs||now,fail:!!why,reason:why||'',servers:linked,deliver:job.deliver||''};
    if(why&&now-(st?.mtimeMs||now)<6*3600e3)await say('job|'+k,nameOf(a)+': the schedule "'+(job.name||job.id)+'" said a tool was not there',{detail:why+(linked.length?' (tool server '+linked.join(', ')+')':''),every:6*3600e3});
    // the agent said its tools were missing: the tool server it named is looked at in the next fix pass
    for(const s of linked){const r=rec(a,s);if(r.conn!=='up'&&(!r.state||r.state==='ok')&&why&&now-(st?.mtimeMs||now)<6*3600e3){r.state='missing';r.since=st?.mtimeMs||now;r.reason='the schedule "'+(job.name||job.id)+'" could not use it'}}}}}

 /* ---------- fixing ---------- */
 const lanes=new Map();const lane=(a,fn)=>{const p=(lanes.get(a)||Promise.resolve()).then(fn,fn);lanes.set(a,p.catch(()=>{}));return p};   // one fix at a time per agent
 let venvLane=Promise.resolve();const oneVenv=fn=>{const p=venvLane.then(fn,fn);venvLane=p.catch(()=>{});return p};
 async function quiet(){for(let i=0;i<40&&busy()>0;i++)await sleep(15000)}   // agents at work: wait, but not more than 10 min
 const tools=async(prefix)=>{const d=path.join(HERMES_HOME,'tools');const n=newestTool(await readdir(d).catch(()=>[]),prefix);return n?path.join(d,n):null};
 // a Python environment built again: the same packages and versions, with the engine's newest Python (the old one kept)
 async function rebuildVenv(dir,{imports=true}={}){return oneVenv(async()=>{const v=db.venvs[dir]||={};if(v.rebuiltAt&&Date.now()-v.rebuiltAt<30*60e3&&v.state==='repaired')return {ok:true,already:true};
  const pyR=await resolve(path.join(dir,'bin','python'));if(pyR.ok)return {ok:true,already:true};
  const pyHome=await tools('python'),uvHome=await tools('uv');if(!pyHome||!uvHome)return {ok:false,why:'the engine’s own Python or uv was not found'};
  const py=path.join(pyHome,'bin','python3'),uv=path.join(uvHome,'uv');const cfg=await readFile(path.join(dir,'pyvenv.cfg'),'utf8').catch(()=>'');
  const oldV=(/^version_info\s*=\s*(\S+)/m.exec(cfg)||/^version\s*=\s*(\S+)/m.exec(cfg)||[])[1]||'old',sys=/include-system-site-packages\s*=\s*true/i.test(cfg);
  const lib=path.join(dir,'lib');let dist=[];for(const p of await readdir(lib).catch(()=>[]))dist.push(...(await readdir(path.join(lib,p,'site-packages')).catch(()=>[])).filter(x=>x.endsWith('.dist-info')));
  const reqs=requirementsFromDistInfo(dist);if(readOnly)return {ok:false,why:'read only',reqs};
  const day=new Date().toISOString().slice(0,10).replace(/-/g,'');let old=dir+'.broken-'+oldV+'-'+day;if(await lstat(old).catch(()=>null))old+='-'+Date.now().toString(36);
  await rename(dir,old);const reqF=path.join(old,'guard-requirements.txt');await writeFile(reqF,reqs.join('\n')+'\n');
  const back=async why=>{await rm(dir,{recursive:true,force:true}).catch(()=>{});await rename(old,dir).catch(()=>{});return {ok:false,why}};
  const env={...process.env,VIRTUAL_ENV:'',PYTHONPATH:''};
  const a=await run(uv,['venv',...(sys?['--system-site-packages']:[]),'--python',py,dir],{env,timeout:300000});if(!a.ok)return back('making the environment failed: '+lastLine(a.err||a.out));
  if(reqs.length){const b=await run(uv,['pip','install','--python',path.join(dir,'bin','python'),'-r',reqF],{env,timeout:1200000});if(!b.ok)return back('installing its packages failed: '+lastLine(b.err||b.out))}
  if(imports){const c=await importCheck(dir);if(!c.ok)return back('its packages do not load: '+c.why)}
  v.state='repaired';v.rebuiltAt=Date.now();v.old=old;v.packages=reqs.length;await save();console.log('automations: rebuilt',dir,'with',path.basename(pyHome),'('+reqs.length+' packages; old one kept as',path.basename(old)+')');return {ok:true,old,packages:reqs.length}})}
 // every package's top-level module loads in the new environment
 async function importCheck(dir){const py=path.join(dir,'bin','python');const lib=path.join(dir,'lib');const mods=new Set();
  for(const p of await readdir(lib).catch(()=>[])){const sp=path.join(lib,p,'site-packages');for(const d of (await readdir(sp).catch(()=>[])).filter(x=>x.endsWith('.dist-info'))){for(const m of (await readFile(path.join(sp,d,'top_level.txt'),'utf8').catch(()=>'')).split('\n').map(x=>x.trim()))if(/^[A-Za-z]\w*$/.test(m)&&!/^(tests?|docs?|examples?)$/.test(m))mods.add(m)}}
  const r=await run(py,['-c','import importlib,json,sys\nbad=[]\nfor m in sys.argv[1:]:\n    try: importlib.import_module(m)\n    except Exception as e: bad.append(m+": "+str(e)[:80])\nprint(json.dumps(bad))',...mods],{timeout:120000});
  if(!r.ok)return {ok:false,why:lastLine(r.err)||'Python does not start'};let bad=[];try{bad=JSON.parse(lastLine(r.out))}catch{}return bad.length?{ok:false,why:bad.slice(0,3).join('; ')}:{ok:true,mods:mods.size}}
 // the tool server itself answers: started the way the engine starts it, it must answer "initialize" within 15 s
 function handshake(a,c,ms=15000){return new Promise(res=>{let done=false,buf='';const fin=v=>{if(done)return;done=true;try{process.kill(-p.pid,'SIGKILL')}catch{try{p.kill('SIGKILL')}catch{}}res(v)};let p;
  try{p=spawn(String(c.command),(c.args||[]).map(String),{env:{...process.env,HERMES_HOME:homeOf(a),...Object.fromEntries(Object.entries(c.env||{}).map(([k,v])=>[k,String(v)]))},stdio:['pipe','pipe','pipe'],detached:true,cwd:homedir()})}catch(e){return res({ok:false,why:e.message})}
  p.on('error',e=>fin({ok:false,why:e.message}));p.on('exit',code=>setTimeout(()=>fin({ok:false,why:'it stopped (code '+code+')'}),50));
  p.stdout.on('data',d=>{buf+=d;for(const l of buf.split('\n')){try{const j=JSON.parse(l);if(j.id===1)return fin(j.result?{ok:true,server:j.result.serverInfo?.name||''}:{ok:false,why:j.error?.message||'it refused'})}catch{}}});
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'aqeelos-guard',version:'1'}}})+'\n');setTimeout(()=>fin({ok:false,why:'no answer within '+ms/1000+' s'}),ms)})}
 const q=a=>'?profile='+encodeURIComponent(a);
 const test=async(a,s)=>{try{const r=await dash('POST','/api/mcp/servers/'+encodeURIComponent(s)+'/test'+q(a),{});return r.ok&&r.j?.ok?{ok:true,tools:(r.j.tools||[]).length}:{ok:false,why:String(r.j?.error||r.j?.detail||'HTTP '+r.status).slice(0,200)}}catch(e){return {ok:false,why:e.message}}};
 // a line in the agent's log since `from` (bytes) that says the engine removed or added the server
 async function waitLog(a,from,s,what,ms){const f=path.join(homeOf(a),'logs','agent.log');const end=Date.now()+ms;
  while(Date.now()<end){await sleep(5000);const st=await stat(f).catch(()=>null);if(!st)continue;const b=await readRange(f,st.size<from?0:from,st.size);
   for(const l of b.toString('utf8').split('\n'))for(const ev of parseLogLine(l))if(ev.kind==='reconciled'&&ev[what].includes(s))return true}return false}
 const logSize=async a=>(await stat(path.join(homeOf(a),'logs','agent.log')).catch(()=>null))?.size||0;
 // the engine connects the server again: removed (and seen gone), then added back with exactly its settings
 async function reconnect(a,s,c){const cf=path.join(homeOf(a),'config.yaml');const bak=cf+'.bak-guard-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,'')+'Z';
  await writeFile(bak,await readFile(cf));
  // the dashboard keeps only these on an add; anything else is written back exactly as it was, through the engine's own config set
  const own=c.command?{name:s,command:String(c.command),args:(c.args||[]).map(String),env:Object.fromEntries(Object.entries(c.env||{}).map(([k,v])=>[k,String(v)])),profile:a}:{name:s,url:c.url,...(c.auth==='oauth'?{auth:'oauth'}:{}),profile:a};
  const kept=new Set(c.command?['command','args','env']:['url','auth']),extra=Object.keys(c).filter(k=>!kept.has(k)&&!(k==='args'&&!c.args?.length)&&!(k==='env'&&!Object.keys(c.env||{}).length));
  let at=await logSize(a);
  const del=await withAgent(a,()=>dash('DELETE','/api/mcp/servers/'+encodeURIComponent(s)+q(a)));if(!del.ok&&del.status!==404)return {ok:false,why:'the engine would not remove it ('+del.status+')',bak};
  const gone=await waitLog(a,at,s,'removed',150000);at=await logSize(a);
  let add;if(extra.length){add=await setKey(a,'mcp_servers.'+s,c);add={ok:add.ok,why:add.err}}
  else{const r=await withAgent(a,()=>dash('POST','/api/mcp/servers'+q(a),own));add={ok:r.ok,why:String(r.j?.detail||'HTTP '+r.status)}}
  if(!add.ok){const back=await setKey(a,'mcp_servers.'+s,c);return {ok:false,why:'adding it back failed: '+add.why+(back.ok?' (its settings were put back)':' (its settings are in '+path.basename(bak)+')'),bak}}
  const back=await waitLog(a,at,s,'added',150000);return {ok:true,gone,added:back,bak}}
 // the whole fix for one server; returns what happened (and tells the owner)
 function repair(a,s,{force=false,why=''}={}){return lane(a,async()=>{await load();const r=rec(a,s),now=Date.now();
  if(!force&&!mayTry(r,now))return {ok:false,why:'tried less than 30 min ago',wait:true};
  const c=(await servers(a))[s];if(!c)return {ok:false,why:'it is no longer in the agent’s settings'};
  if(readOnly)return {ok:false,why:'read only'};if(c.auth==='oauth'&&r.state==='signin'&&!force)return {ok:false,signin:true,why:'needs someone to sign in'};
  r.lastTry=now;r.tries=(r.tries||0)+1;await save();if(!force){await quiet();await scanLogs();if(r.state==='ok')return {ok:true,already:true,steps:[]}}const steps=[];
  // 1. a broken Python environment under it
  if(c.command){const x=await inspect(c);for(const v of x.venvs){const b=await rebuildVenv(v,{imports:false});if(!b.ok)return fail(a,s,'its Python environment '+v+' could not be built again: '+b.why,steps);if(!b.already)steps.push('rebuilt '+v+' ('+b.packages+' packages)')}
   const left=(await inspect(c)).problems;if(left.length)return fail(a,s,left.join('; '),steps);
   if(steps.length){const h=await handshake(a,c);if(!h.ok)return fail(a,s,'it still does not start: '+h.why,steps);steps.push('it answers again')}}
  // 2. the engine's own Test (a fresh copy); the live one may still be parked
  const t=await test(a,s);if(!t.ok){if(AUTHY.test(t.why)){r.state='signin';r.reason=t.why;await save();return {ok:false,signin:true,why:t.why}}return fail(a,s,'the engine’s Test fails: '+t.why,steps)}
  // 3. the engine connects it again
  const rc=await reconnect(a,s,c);if(!rc.ok)return fail(a,s,rc.why,steps);steps.push('reconnected'+(rc.added?'':' (the engine did not confirm it yet)'));
  const t2=await test(a,s);if(!t2.ok)return fail(a,s,'after reconnecting, the engine’s Test fails: '+t2.why,steps);
  r.state='ok';r.since=0;r.reason='';r.conn='up';r.repairedAt=Date.now();r.fixed=steps.join(', ');r.tries=0;forget('srv|'+key(a,s)+'|');
  for(const j of Object.values(db.jobs))if(j.agent===a&&j.fail&&j.servers?.includes(s)&&Date.now()-j.at<6*3600e3)j.offer=true;   // a schedule that failed because of it is offered again
  db.digest.push({at:Date.now(),text:nameOf(a)+': '+s+' ('+steps.join(', ')+')'});await save();
  await say('fixed|'+key(a,s)+'|'+r.repairedAt,nameOf(a)+': the tool server "'+s+'" works again',{detail:'aqeelOS '+steps.join(', ')+'. '+(why?'It had: '+why+'. ':'')+'The engine’s Test passes ('+t2.tools+' tools).',every:Infinity});
  return {ok:true,steps,tools:t2.tools}})}
 async function fail(a,s,why,steps){const r=rec(a,s);r.state=r.state==='ok'?'broken':r.state;r.failedAt=Date.now();r.failWhy=why;await save();
  await say('srv|'+key(a,s)+'|failed',nameOf(a)+': the tool server "'+s+'" is broken and the automatic fix did not work',{detail:String(why).replace(/\.$/,'')+(steps.length?' (done so far: '+steps.join(', ')+')':'')+'. Open System › Health to try again.',whatsapp:true,every:6*3600e3});
  return {ok:false,why,steps}}
 // a Python environment that no tool server names (the PDF tool's): rebuilt, nothing to reconnect
 async function repairVenv(dir){const x=db.venvs[dir]||={};const now=Date.now();if(!mayTry(x,now))return {ok:false,wait:true};x.lastTry=now;await save();await quiet();
  const b=await rebuildVenv(dir);if(b.ok){if(!b.already){db.digest.push({at:Date.now(),text:'rebuilt '+dir});await save();await say('venv|'+dir+'|fixed|'+Date.now(),'The Python environment '+path.basename(dir)+' was built again',{detail:dir+' pointed at a Python the engine removed. It now uses the engine’s current Python with the same '+b.packages+' packages; the old one is kept as '+path.basename(b.old)+'.',every:Infinity})}return b}
  x.failWhy=b.why;await save();await say('venv|'+dir+'|failed','The Python environment '+path.basename(dir)+' is broken and could not be built again',{detail:String(b.why).replace(/\.$/,'')+'. Open System › Health to try again.',whatsapp:true});return b}

 /* ---------- the passes ---------- */
 async function fixPass(){const now=Date.now();const out=[];
  for(const r of Object.values(db.servers)){const st=nextStep(r,now,{stdio:!!r.stdio});
   if(st==='signin'){await say('srv|'+key(r.agent,r.name)+'|signin',nameOf(r.agent)+': "'+r.name+'" needs someone to sign in',{detail:'Its tools stay off until then: '+(r.reason||'').slice(0,160)+'. Sign in under Bottlenecks or System › Health. aqeelOS will not retry it by itself.',every:Infinity});continue}
   if(st!=='repair')continue;
   await say('srv|'+key(r.agent,r.name)+'|found|'+(r.since||0),nameOf(r.agent)+': the tool server "'+r.name+'" '+(r.state==='broken'?'is broken':r.state==='missing'?'is missing its tools':'stopped connecting'),{detail:String(r.reason||'').replace(/\.$/,'')+'. aqeelOS is fixing it.',every:Infinity});
   out.push(repair(r.agent,r.name,{why:r.reason}).catch(e=>({ok:false,why:e.message})))}
  for(const [dir,v] of Object.entries(db.venvs))if(v.state==='broken'&&!Object.values(db.servers).some(r=>r.venvs?.includes(dir))&&mayTry(v,now))out.push(repairVenv(dir).catch(e=>({ok:false,why:e.message})));
  return Promise.all(out)}
 // the fixes of earlier days, once a day in the daytime (today's wait for tomorrow)
 async function digest(){if(!db.digest.length)return;const now=Date.now(),tz=await zone(),day=localDate(now,tz);if(db.digestDay===day||!isDaytime(now,tz))return;
  const l=db.digest.filter(x=>localDate(x.at,tz)<day);if(!l.length)return;db.digest=db.digest.filter(x=>!l.includes(x));db.digestDay=day;await save();
  if(LIVE&&!readOnly)await tell('Yesterday aqeelOS fixed '+l.length+' automation'+(l.length>1?'s':'')+' by itself: '+l.map(x=>x.text).join('; ')+'. Everything is working again.',{bell:false,whatsapp:true}).catch(e=>console.warn('automations: day summary',e.message))}
 let ticking=null;
 // a look (and, live, the fixes): logs and replies every time, programs and environments every 15 min
 function tick({fix=true,deep=false}={}){if(ticking)return ticking;ticking=(async()=>{await load();await scanLogs();await scanJobs();if(deep||Date.now()-(db.staticAt||0)>=15*60e3)await staticCheck();db.at=Date.now();await save();
   if(fix&&!readOnly&&!paused())await fixPass();await digest()})().finally(()=>{ticking=null});return ticking}
 if(LIVE&&!readOnly){setInterval(()=>tick().catch(e=>console.warn('automations',e.message)),2*60e3).unref();setTimeout(()=>tick().catch(e=>console.warn('automations',e.message)),45000).unref()}

 /* Everything checked now (after an engine update, a restart): every enabled tool server that runs as a program passes
    the engine's Test, nothing parked since `since`, every environment resolves; broken ones are fixed first when
    repair is on. `before` (a snapshot) leaves out what was already broken then. problems: what is still wrong. */
 async function fullCheck({repair:fix=true,since=0,before=null,why=''}={}){await tick({fix:false,deep:true});const was=new Set(before?.bad||[]),probs=[],fixed=[],signin=[];
  for(const a of await listAgents())for(const [s,c] of Object.entries(await servers(a))){if(!enabled(c))continue;const r=rec(a,s),k=key(a,s);
   if(r.state==='signin'){signin.push(k);continue}
   let bad=['parked','missing','broken'].includes(r.state)||['failing','probing'].includes(r.state)&&since>0&&(r.since||0)>=since;
   if(!bad&&c.command){const t=await test(a,s);if(!t.ok){if(AUTHY.test(t.why)){signin.push(k);continue}bad=true;r.reason=t.why;if(r.state==='ok'){r.state='broken';r.since=Date.now()}}}
   if(!bad)continue;
   if(fix&&!readOnly){const x=await repair(a,s,{force:true,why:why||r.reason});if(x.ok){fixed.push(nameOf(a)+' '+s);continue}if(x.signin){signin.push(k);continue}}
   if(!was.has(k))probs.push(nameOf(a)+': tool server '+s+': '+(r.failWhy||r.reason||'it does not work'))}
  for(const [dir,v] of Object.entries(db.venvs)){if(v.state!=='broken')continue;if(fix&&!readOnly){const b=await repairVenv(dir);if(b.ok){fixed.push(dir);continue}}if(!was.has('venv|'+dir))probs.push('the Python environment '+dir+' points at a Python that is gone')}
  await save();return {problems:probs,fixed,signin}}
 // before an engine update: every tool server that runs as a program and the Pythons it starts, and what is already broken
 async function snapshot(){await load();await staticCheck();await save();const list=[];
  for(const r of Object.values(db.servers))if(r.stdio)list.push({agent:r.agent,name:r.name,interps:r.interps||[]});
  return {servers:list,bad:[...Object.values(db.servers).filter(r=>r.state!=='ok').map(r=>key(r.agent,r.name)),...Object.entries(db.venvs).filter(([,v])=>v.state==='broken').map(([d])=>'venv|'+d)]}}
 // Fix now runs in the background (it can take minutes: the engine removes and adds the server on its own clock); the
 // card shows "Fixing" until it is done
 const fixing=new Set();
 function startFix(a,s){const k=key(a,s);if(fixing.has(k))return {started:true};fixing.add(k);fixNow(a,s).catch(e=>({ok:false,why:e.message})).then(r=>{if(!r.ok)console.log('automations: Fix now',k,r.why||'');}).finally(()=>fixing.delete(k));return {started:true}}
 async function status(){await load();if(!LIVE&&Date.now()-(db.at||0)>2*60e3)await tick({fix:false}).catch(()=>{});const agents=[],now=Date.now();
  for(const a of await listAgents()){const cfg=await servers(a);const sv=[];for(const [s,c] of Object.entries(cfg)){if(!enabled(c))continue;const r=db.servers[key(a,s)]||{state:'ok'};
    const state=r.state==='signin'?'signin':r.state==='ok'?(r.repairedAt&&now-r.repairedAt<24*3600e3?'repaired':'ok'):r.state==='failing'||r.state==='probing'?(nextStep(r,now,{stdio:!!c.command})==='none'?'ok':'broken'):'broken';
    sv.push({name:s,state:fixing.has(key(a,s))?'fixing':state,repairedAt:r.repairedAt||null,fixed:r.fixed||'',reason:state==='broken'?(r.failWhy||r.reason||''):state==='signin'?r.reason||'':'',program:!!c.command})}
   const jobs=Object.values(db.jobs).filter(j=>j.agent===a&&j.fail&&now-j.at<24*3600e3).map(j=>({id:j.id,name:j.name,at:j.at,reason:j.reason,servers:j.servers,offer:!j.ranAt&&now-j.at<6*3600e3&&(!!j.offer||j.servers.length>0&&j.servers.every(s=>{const r=db.servers[key(a,s)];return !r||r.state==='ok'&&Math.max(r.repairedAt||0,r.okAt||0)>j.at}))}));
   if(sv.length||jobs.length)agents.push({agent:a,name:nameOf(a),servers:sv,jobs})}
  const used=new Set(Object.values(db.servers).flatMap(r=>r.venvs||[]));
  const venvs=Object.entries(db.venvs).filter(([d,v])=>!used.has(d)&&(v.state==='broken'||v.rebuiltAt&&now-v.rebuiltAt<24*3600e3)).map(([dir,v])=>({dir,state:fixing.has(key('default',dir))?'fixing':v.state==='broken'?'broken':'repaired',at:v.rebuiltAt||null,why:v.failWhy||''}));
  return {at:db.at||null,agents,venvs}}
 // "Run now" for a schedule that failed because of a tool server: the engine's own run-now
 async function runJob(a,id){await load();const j=db.jobs[key(a,id)];const r=await dash('POST','/api/cron/jobs/'+encodeURIComponent(id)+'/trigger'+q(a),{});if(!r.ok)throw new Error(String(r.j?.detail||'The engine did not start it ('+r.status+')'));if(j){j.offer=false;j.ranAt=Date.now();await save()}return {ok:true}}
 async function fixNow(a,s){await load();if(s.startsWith('/')){if(!db.venvs[s])return {ok:false,why:'aqeelOS does not know that environment'};const b=await rebuildVenv(s);if(b.ok&&db.venvs[s])db.venvs[s].state=b.already?'ok':'repaired';await save();return b}return repair(a,s,{force:true,why:'Fix now'})}
 return {tick,fullCheck,snapshot,status,runJob,fixNow,startFix,repair,_db:async()=>load(),_handshake:handshake,_inspect:inspect}}
