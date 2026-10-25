// Code uses agents, one way (25 Oct 2026): a Code run may ask the agents attached to it for things they can reach with
// their own access (Google Docs, Drive and Gmail, Slack, Notion, n8n, WhatsApp…), and their answers (text and files)
// come back into the run's project. An agent never changes a Code project by itself. This module holds the pieces the
// /ui/code routes use: the run ticket (which agents a run may ask), each agent's short introduction, the folder an
// agent saves files into and how they reach the project, the engine runs that may ask, and "Open in Code" requests.
import {readFile,readdir,mkdir,rm,stat,realpath,writeFile,lstat,cp} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

// what comes back from one ask: a few files, none too big (also checked again where they are written)
export const FILES_MAX=12,FILE_MAX=20e6,FILES_TOTAL=40e6;
// a file name as it is saved: no folders, no leading dots, only plain characters
export const safeName=n=>{const b=String(n||'').split(/[\\/]/).pop().normalize('NFC').replace(/[^\p{L}\p{N} ._()-]+/gu,'_').replace(/^[.\s]+/,'').replace(/\s+/g,' ').trim().slice(0,100);return b&&b!=='.'&&b!=='..'?b:'file'};
// a folder inside the project as the coding model may ask for it ("assets/img"): relative, no "..", no drive or root
export const safeRel=p=>{const s=String(p||'').replace(/\\/g,'/').trim();if(!s)return '';if(/^\/|^[A-Za-z]:|(^|\/)\.\.(\/|$)|\0/.test(s))return null;const parts=s.split('/').filter(x=>x&&x!=='.').map(safeName);return parts.length&&parts.length<=8?parts.join('/'):null};
// words that mark a note as holding a secret: such notes never leave in an introduction
const SECRETY=/(api[_ -]?key|password|passwd|secret|token|bearer|private key|sk-[A-Za-z0-9]|ghp_|xox[abp]-|AKIA[0-9A-Z]{8}|[A-Za-z0-9+/_-]{32,})/i;

export function createCodeAgents({HERMES_HOME,DATA,sign,readIds,outboxAccess}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const ws=a=>path.join(homedir(),'workspaces',a);
 const same=(x,y)=>{const a=Buffer.from(String(x)),b=Buffer.from(String(y));return a.length===b.length&&timingSafeEqual(a,b)};
 /* The run ticket: which agents one Code run (a message in a project) may ask, signed here for the person who sent it.
    Code asks for it when the run starts; the person must be allowed to chat with each agent then, and is checked again
    on every ask. It is good for 12 hours, the longest a run goes on. */
 function ticket(uid,agents,project){const exp=Date.now()+12*3600e3,list=agents.join(','),pr=String(project||'').replace(/[^\w-]/g,'').slice(0,80);return [uid,exp,list,pr,sign('code-run:'+uid+'|'+exp+'|'+list+'|'+pr)].map(encodeURIComponent).join('.')}
 // the agents on a ticket, when it is this person's and still good (null otherwise)
 function ticketAgents(t,uid){const [u,exp,list,pr,sg]=String(t||'').split('.').map(x=>{try{return decodeURIComponent(x)}catch{return ''}});
  if(!u||u!==uid||!(Number(exp)>Date.now())||!sg||!same(sg,sign('code-run:'+u+'|'+exp+'|'+list+'|'+pr)))return null;return {agents:list.split(',').filter(Boolean),project:pr}}
 /* An agent introduces itself to the coding model: what it is for, the skills it has (names only) and, for the person
    who owns it, a short digest of its notes about its work. Notes that look like they hold a secret are left out, and
    the digest stays short (about 900 characters). Never a key value, never what it knows about the person. */
 async function intro(a,{memory}={}){const ids=await readIds().catch(()=>({}));const y=await readFile(path.join(home(a),'profile.yaml'),'utf8').catch(()=>'');
  const about=[ids[a]?.title,(/^description:\s*"?([^"\n]+)"?/m.exec(y)||[])[1]].map(x=>String(x||'').trim()).filter(Boolean).join('. ').slice(0,300);
  const skills=[];for(const cat of await readdir(path.join(home(a),'skills'),{withFileTypes:true}).catch(()=>[])){if(!cat.isDirectory()||cat.name.startsWith('.'))continue;
   for(const k of await readdir(path.join(home(a),'skills',cat.name),{withFileTypes:true}).catch(()=>[]))if(k.isDirectory()&&!k.name.startsWith('.'))skills.push(k.name);if(skills.length>=40)break}
  let mem='';if(memory){const t=await readFile(path.join(home(a),'memories','MEMORY.md'),'utf8').catch(()=>'');
   for(const n of t.split(/\n\s*§\s*\n|^\s*§\s*$/m).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)){if(SECRETY.test(n))continue;const line='- '+n.slice(0,200);if(mem.length+line.length>900)break;mem+=(mem?'\n':'')+line}}
  return {about,skills:[...new Set(skills)].slice(0,25),memory:mem}}
 /* Files back: before an ask, the agent gets a folder of its own (its workspace's code-outbox/<id>) to save files in
    (documents exported as files, pictures, attachments). Afterwards the files there, and pictures it handed over as
    MEDIA:<path> inside its own workspace or its picture cache (never a hidden file such as .secrets or .env), are read (a few, none too big) and the folder is removed. */
 async function outbox(a){const id=Date.now().toString(36)+randomBytes(6).toString('hex'),dir=path.join(ws(a),'code-outbox',id);await mkdir(dir,{recursive:true,mode:0o770});await outboxAccess?.(a,dir).catch(()=>{});return dir}
 async function collect(a,dir,text){const out=[],seen=new Set();let total=0;const roots=await Promise.all([ws(a),path.join(home(a),'cache')].map(r=>realpath(r).then(x=>x+path.sep,()=>r+path.sep)));
  const take=async f=>{if(out.length>=FILES_MAX)return;let real;try{real=await realpath(f)}catch{return}const root=roots.find(r=>real.startsWith(r));if(seen.has(real)||!root||real.slice(root.length).split(path.sep).some(x=>x.startsWith('.')))return;   // never hidden files or folders (.secrets, .env)
  const st=await stat(real).catch(()=>null);
   if(!st?.isFile()||st.size>FILE_MAX||total+st.size>FILES_TOTAL)return;const lst=await lstat(f).catch(()=>null);if(!lst||lst.isSymbolicLink())return;seen.add(real);total+=st.size;out.push({name:safeName(path.basename(real)),data:await readFile(real)})};
  for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){if(e.isFile())await take(path.join(dir,e.name));else if(e.isDirectory())for(const x of await readdir(path.join(dir,e.name),{withFileTypes:true}).catch(()=>[]))if(x.isFile())await take(path.join(dir,e.name,x.name))}
  for(const m of String(text||'').matchAll(/MEDIA:\s*(\/[^\s)'"`]+)/g))await take(m[1]);
  await rm(dir,{recursive:true,force:true}).catch(()=>{});return out}
 // the files written into a project folder: <dir>/<to or from-agents/<agent>>/<name>, never outside it, never over a
 // file that is there already (a number is added); the paths come back relative to the project
 async function saveInto(dir,agentName,files,to){const rel=to?safeRel(to):'';if(rel===null)throw Error('Save files to a folder inside the project, for example from-agents or assets.');
  const base=path.join(dir,rel||path.join('from-agents',safeName(agentName).toLowerCase().replace(/\s+/g,'-'))),root=await realpath(dir);await mkdir(base,{recursive:true});const real=await realpath(base);
  if(real!==root&&!real.startsWith(root+path.sep))throw Error('That folder is outside the project.');const saved=[];
  for(const f of files.slice(0,FILES_MAX)){if(!Buffer.isBuffer(f.data)||f.data.length>FILE_MAX)continue;const nm=safeName(f.name),x=path.extname(nm),stem=nm.slice(0,nm.length-x.length);let to2=path.join(real,nm);
   for(let i=2;await lstat(to2).then(()=>true,()=>false)&&i<100;i++)to2=path.join(real,stem+'-'+i+x);await writeFile(to2,f.data,{flag:'wx'});saved.push(path.relative(root,to2).split(path.sep).join('/'))}return saved}
 /* Engine runs that may ask agents (aqeelOS models): the agent doing the run gets code_ask_agent while it runs, for the
    other agents attached to it. Kept per run, by the agent doing it; the ask goes to the run of that agent whose
    attached agents include the one asked (several such runs at once by different people: refused, it can't tell). */
 const engineRuns=new Map();
 function runStart(agent,r){const k=randomBytes(9).toString('hex');engineRuns.set(k,{...r,agent,t:Date.now()});return ()=>engineRuns.delete(k)}
 const runsOf=agent=>[...engineRuns.values()].filter(r=>r.agent===agent&&r.agents.length>1);
 function runFor(agent,target){if(!runsOf(agent).length)return {error:'This only works during an aqeelOS Code run that has other agents attached.'};const l=runsOf(agent).filter(r=>r.agents.includes(target));if(!l.length)return {error:'That agent is not attached to this Code run. Only the agents attached in Code can be asked.'};
  if(new Set(l.map(r=>r.user)).size>1)return {error:'Several people have Code runs going with you right now, so this ask cannot be matched to one of them. Answer without it.'};return {run:l.sort((x,y)=>y.t-x.t)[0]}}
 /* Plan only on the engine (any model): the turn works in a copy of the project (next to it, .plan-<id>), which the
    agent may only read (its user gets read entries; aqeelOS removes the copy after the turn), so whatever it tries to
    change never reaches the project. Dependencies, builds and git history are left out; a copy over 300 MB is refused. */
 async function planCopy(dir,area){const to=path.join(area,'.plan-'+randomBytes(6).toString('hex'));let n=0;
  try{await cp(dir,to,{recursive:true,verbatimSymlinks:true,filter:async src=>{const b=path.basename(src);if(src!==dir&&/^(node_modules|\.git|dist|build|\.next|\.cache|\.venv|__pycache__)$/.test(b))return false;
    const st=await lstat(src).catch(()=>null);if(st?.isSymbolicLink())return false;if(st?.isFile()&&(n+=st.size)>300e6)throw Error('The project is over 300 MB without its dependencies, too big to plan in a copy.');return true}})}
  catch(e){await rm(to,{recursive:true,force:true}).catch(()=>{});throw e}return to}
 const planDrop=to=>/[\/]\.plan-[0-9a-f]{12}$/.test(to)?rm(to,{recursive:true,force:true}).catch(()=>{}):Promise.resolve();
 /* "Open in Code" from a chat: an agent keeps the request here (7 days) and gives a link; Code opens with it filled in
    and that agent attached, and nothing runs until the person sends it. Only a person who may chat with the agent can
    open it. */
 const HF=path.join(DATA,'code-handoffs.json');let hdb=null;
 const hload=async()=>{if(hdb)return hdb;try{hdb=JSON.parse(await readFile(HF,'utf8'))}catch{hdb={}}return hdb};
 async function handoff(agent,text){const d=await hload();const now=Date.now();for(const [k,v] of Object.entries(d))if(now-v.t>7*864e5)delete d[k];
  const id=randomBytes(12).toString('base64url');d[id]={agent,text:String(text).slice(0,12000),t:now};await mkdir(DATA,{recursive:true});await writeFile(HF,JSON.stringify(d),{mode:0o600});return id}
 async function handoffGet(id){const d=await hload();const v=/^[\w-]{10,40}$/.test(String(id||''))?d[id]:null;return v&&Date.now()-v.t<7*864e5?v:null}
 return {ticket,ticketAgents,intro,outbox,collect,saveInto,runStart,runsOf,runFor,planCopy,planDrop,handoff,handoffGet}}
