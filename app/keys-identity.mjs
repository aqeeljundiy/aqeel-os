// Which account each key belongs to (7 Nov 2026, owner: "we have GITHUB_TOKEN but for what account? what user? we
// don't know"). For every key in the agents' .env files: a plain name, the account and scopes it maps to (asked
// read-only from the service: GitHub /user, Slack auth.test, Telegram getMe, Kirimdev /me…), whether it works, the last
// 4 characters, and what uses it (skills, scripts, schedules, instructions, the engine, aqeelOS), from a grep of its name.
// DATA/keys-identity.json keeps names, accounts, scopes and checks only. The secret itself is never written, logged or
// sent anywhere but the service it belongs to.
import {readFile,writeFile,rename,mkdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {homedir} from 'node:os';
import {KEY_SKIP,KEY_SECRET,KEY_BOT,h8} from './access.mjs';

const T=15000;
const get=(url,headers={},o={})=>fetch(url,{headers,signal:AbortSignal.timeout(T),...o});
const st=r=>r.ok?'works':r.status===401||r.status===403?'rejected':'unknown';
const said=r=>r.ok?'':r.status===401||r.status===403?'The service refused this key':'The service answered HTTP '+r.status;

// one check per kind of key: the cheapest read-only call that names the account. A key goes only to the service its name
// says it belongs to (never a guess: a secret sent to the wrong service is a leak). Each returns
// {service, account, scopes, status, detail}; nothing here may send, post or change anything.
export const PROBES=[
 {test:/^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|GITHUB_PERSONAL_ACCESS_TOKEN|GH_PAT)$/,service:'GitHub',async run(v){const r=await get('https://api.github.com/user',{authorization:'Bearer '+v,'user-agent':'aqeelOS','x-github-api-version':'2022-11-28'});
  const j=r.ok?await r.json().catch(()=>({})):{};const sc=r.headers.get('x-oauth-scopes');return {account:j.login||'',scopes:sc==null?(r.ok?'fine-grained token':''):sc||'no scopes',status:st(r),detail:said(r)}}},
 {test:/^(?:[A-Z0-9]+_)?SLACK_.*TOKEN$/,service:'Slack',async run(v){const r=await get('https://slack.com/api/auth.test',{authorization:'Bearer '+v},{method:'POST'});const j=await r.json().catch(()=>({}));
  if(!j.ok)return {account:'',scopes:'',status:/invalid_auth|not_authed|token_revoked|account_inactive/.test(j.error||'')?'rejected':'unknown',detail:j.error?'Slack said '+j.error:said(r)};
  return {account:(j.team||'')+(j.user?' · '+j.user:''),scopes:(r.headers.get('x-oauth-scopes')||'').split(',').filter(Boolean).slice(0,6).join(', '),status:'works',detail:''}}},
 {test:/^(?:[A-Z0-9]+_)?TELEGRAM_(?:[A-Z0-9]+_)?BOT_TOKEN$/,service:'Telegram',async run(v){const r=await get('https://api.telegram.org/bot'+v+'/getMe');const j=await r.json().catch(()=>({}));
  return {account:j.result?.username?'@'+j.result.username:'',scopes:'bot',status:j.ok?'works':r.status===401||r.status===404?'rejected':'unknown',detail:j.ok?'':j.description||said(r)}}},
 {test:/^KIRIMDEV_API_KEY$/,service:'Kirimdev',async run(v){const base=(process.env.KIRIMDEV_API||'https://api.kirimdev.com/v1').replace(/\/+$/,'');const r=await get(base+'/me',{authorization:'Bearer '+v});const j=r.ok?await r.json().catch(()=>({})):{};const d=j.data||j;
  return {account:d.workspace?.name||d.organization?.name||d.name||d.email||'',scopes:'',status:st(r),detail:said(r)}}},
 {test:/^OPENROUTER_API_KEY$/,service:'OpenRouter',async run(v){const r=await get('https://openrouter.ai/api/v1/key',{authorization:'Bearer '+v});const j=r.ok?await r.json().catch(()=>({})):{};const d=j.data||{};
  return {account:d.label||'',scopes:d.limit!=null?'limit $'+d.limit:'',status:st(r),detail:said(r)}}},
 {test:/^OPENAI_API_KEY$/,service:'OpenAI',async run(v){const r=await get('https://api.openai.com/v1/models?limit=1',{authorization:'Bearer '+v});
  return {account:r.headers.get('openai-organization')||'',scopes:r.headers.get('openai-project')||'',status:st(r),detail:said(r)}}},
 {test:/^ANTHROPIC_API_KEY$/,service:'Anthropic',async run(v){const r=await get('https://api.anthropic.com/v1/models?limit=1',{'x-api-key':v,'anthropic-version':'2023-06-01'});
  return {account:r.headers.get('anthropic-organization-id')||'',scopes:'',status:st(r),detail:said(r)}}},
 {test:/^(NOTION_API_KEY|NOTION_TOKEN|NOTION_API_TOKEN)$/,service:'Notion',async run(v){const r=await get('https://api.notion.com/v1/users/me',{authorization:'Bearer '+v,'notion-version':'2022-06-28'});const j=r.ok?await r.json().catch(()=>({})):{};
  return {account:j.bot?.workspace_name||j.name||'',scopes:j.bot?'integration':'',status:st(r),detail:said(r)}}},
 {test:/^ELEVENLABS_API_KEY$/,service:'ElevenLabs',async run(v){const r=await get('https://api.elevenlabs.io/v1/user/subscription',{'xi-api-key':v});const j=r.ok?await r.json().catch(()=>({})):{};
  return {account:'',scopes:j.tier?'plan '+j.tier:'',status:st(r),detail:said(r)}}},
 {test:/^(GEMINI_API_KEY|GOOGLE_API_KEY)$/,service:'Google AI',async run(v){const r=await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',{'x-goog-api-key':v});
  return {account:'',scopes:'',status:r.ok?'works':r.status===400||r.status===401||r.status===403?'rejected':'unknown',detail:said(r)}}}];
export const probeFor=name=>PROBES.find(p=>p.test.test(name))||null;
// the service a key belongs to, from its name, when there is no safe check for it
export function serviceOf(name){const p=probeFor(name);if(p)return p.service;const m=/^([A-Z][A-Z0-9]*?)(?:_(?:API|BOT|APP|ACCESS|SECRET|AUTH|PERSONAL))?_(?:KEY|TOKEN|SECRET|PASSWORD|PASS)$/.exec(name)||/^([A-Z][A-Z0-9]*)_/.exec(name);
 const w=(m?.[1]||name).toLowerCase();return w.charAt(0).toUpperCase()+w.slice(1)}
// "GitHub: abel-dev (repo, workflow)"; the account, else the key's own name
export function autoName(name,c={}){const s=serviceOf(name);const acct=c.account?': '+c.account:'';const sc=c.scopes&&c.scopes.length<=40?' ('+c.scopes+')':'';return (s+acct+sc).slice(0,60)||name}
export const last4=v=>{v=String(v||'');return v.length>=12?v.slice(-4):''};   // short values show nothing

// who reads a key without naming it in a file: the engine's model providers and channels
const ENGINE_USE=[[KEY_BOT,'A channel the agent answers on'],[/^(OPENROUTER|ANTHROPIC|OPENAI|GEMINI|GOOGLE|DEEPSEEK|XAI|GROQ|MISTRAL|TOGETHER|FIREWORKS|NOUS|KIMI|MOONSHOT|ZAI|GLM|MINIMAX|DASHSCOPE|HF|HUGGINGFACE|NVIDIA|CEREBRAS)_API_KEY$/,'The engine: an AI model provider']];
// where a file that names a key sits, in plain words
export function whereLabel(file,{HERMES_HOME,root,HOME=homedir()}){const rel=(b)=>path.relative(b,file);
 if(root&&file.startsWith(root+path.sep))return 'aqeelOS’s code';
 if(file.startsWith(path.join(HERMES_HOME,'hermes-agent')+path.sep))return 'The engine’s built-in tools';
 let m=/(?:^|\/)skills\/(?:[^/]+\/)*?([^/]+)\/SKILL\.md$/.exec(file)||/(?:^|\/)skills\/(?:[^/]+\/)?([^/]+)\//.exec(file);if(m)return 'Skill: '+m[1];
 if(/\/cron\/jobs\.json$/.test(file))return 'Schedules';
 if(/\/memories\/|\/(MEMORY|USER)\.md$/.test(file))return 'The agent’s memory';
 if(/\/SOUL\.md$|\/AGENTS\.md$/.test(file))return 'Instructions';
 if(/\/config\.yaml$/.test(file))return 'Settings (config.yaml)';
 if(file.startsWith(path.join(HOME,'workspaces')+path.sep))return 'Workspace file: '+rel(path.join(HOME,'workspaces'));
 return 'Script: '+path.basename(file)}

export function createKeysIdentity({DATA,HERMES_HOME,root,listAgents,live=()=>true}){
 const FILE=path.join(DATA,'keys-identity.json');let db=null,busy=false;const HOME=homedir();
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items??={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(db,null,1),{mode:0o600});await rename(t,FILE)};
 // the keys as they are now: one entry per name and value (the same key on several agents is one entry)
 async function current(){const out=new Map();for(const a of await listAgents()){const env=await readFile(path.join(home(a),'.env'),'utf8').catch(()=>'');
   for(const l of env.split('\n')){const m=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);if(!m||KEY_SKIP.test(m[1])||!KEY_SECRET.test(m[1]))continue;const v=m[2].trim().replace(/^["']|["']$/g,'');if(!v)continue;
    const id=m[1]+'@'+h8(v);const x=out.get(id)||{id,name:m[1],agents:[],value:v};x.agents.push(a);out.set(id,x)}}
  return out}
 // one grep over the places a key can be named, for every name at once
 // only where an agent's own work names a key (a whole-home grep took minutes on a busy box): each agent's instructions,
 // settings, schedules, skills and scripts, the shared skills and scripts, its workspace scripts, and aqeelOS's app folder
 async function places(){const out=[];const add=p=>stat(p).then(()=>out.push(p)).catch(()=>{});const ws=a=>path.join(HOME,'workspaces',a.split('--')[0]);
  for(const a of await listAgents()){const h=home(a);for(const f of ['SOUL.md','AGENTS.md','config.yaml','cron/jobs.json','skills','scripts','memories'])await add(path.join(h,f));
   for(const f of ['AGENTS.md','scripts','automations','.tools'])await add(path.join(ws(a),f))}
  for(const p of [path.join(HERMES_HOME,'scripts'),path.join(HERMES_HOME,'skills'),root&&path.join(root,'app'),root&&path.join(root,'scripts')])if(p)await add(p);
  return [...new Set(out)]}
 function grepNames(names){return new Promise(async res=>{if(!names.length)return res({});const dirs=await places();if(!dirs.length)return res({});
  const args=['-rIowE','--exclude-dir=node_modules','--exclude-dir=.git','--exclude-dir=venv','--exclude-dir=.venv','--exclude-dir=__pycache__','--exclude-dir=tests','--exclude-dir=sessions','--exclude-dir=logs','--exclude-dir=checkpoints','--exclude-dir=backups','--exclude-dir=installs','--exclude-dir=worktrees','--exclude-dir=website','--exclude-dir=docs','--exclude-dir=i18n','--exclude-dir=skills-removed','--exclude-dir=dist','--exclude-dir=plugins-removed','--exclude=*cache*','--exclude-dir=*cache*','--exclude=*.env','--exclude=*.bak*',
   '--include=*.md','--include=*.py','--include=*.sh','--include=*.js','--include=*.mjs','--include=*.ts','--include=*.json','--include=*.yaml','--include=*.yml','--exclude=.env*','--exclude=keys-identity.json','--exclude=*.jsonl',names.join('|'),...dirs];
  execFile('nice',['-n','10','grep',...args],{timeout:60000,maxBuffer:2e7},(e,o)=>{const by={};for(const l of String(o||'').split('\n')){const i=l.lastIndexOf(':');if(i<0)continue;const f=l.slice(0,i),n=l.slice(i+1);
    if(/\/\.env|\.bak|\/profiles\/[^/]+\/\.env/.test(f))continue;(by[n]??=[]).push({w:whereLabel(f,{HERMES_HOME,root,HOME}),a:ownerOf(f)})}
   res(by)})})}
 // whose work a file is: an agent's home or workspace, else shared (aqeelOS, the shared scripts)
 function ownerOf(f){let m=/\/profiles\/([^/]+)\//.exec(f.startsWith(HERMES_HOME)?f.slice(HERMES_HOME.length):'');if(m)return m[1].split('--')[0];
  m=new RegExp('^'+path.join(HOME,'workspaces').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/([^/]+)/').exec(f);if(m)return m[1];
  if(f.startsWith(HERMES_HOME+path.sep)&&!f.startsWith(path.join(HERMES_HOME,'scripts')+path.sep))return 'default';return '*'}
 // what uses a key: files of the agents that hold it, and shared ones; the engine's channels and model providers by name
 function usedBy(name,found,agents=[]){const own=new Set(agents.map(a=>a.split('--')[0]));const l=[...new Set((found[name]||[]).filter(x=>x.a==='*'||own.has(x.a)).map(x=>x.w))].sort();
  for(const [re,what] of ENGINE_USE)if(re.test(name)&&!l.includes(what))l.unshift(what);return l}
 // ask the service who this key is; never throws, never keeps the value
 async function probe(name,value){const p=probeFor(name);if(!p)return {service:serviceOf(name),account:'',scopes:'',status:'unknown',detail:'No safe way to ask '+serviceOf(name)+' who this key belongs to'};
  try{const r=await p.run(value);return {service:p.service,...r}}catch(e){return {service:p.service,account:'',scopes:'',status:'unknown',detail:e.name==='TimeoutError'?p.service+' did not answer in time':p.service+' could not be reached'}}}
 async function check(id,{keys,found}={}){await load();keys=keys||await current();const k=keys.get(id);if(!k)throw Object.assign(new Error('That key is gone. Reload the page.'),{status:404});
  found=found||await grepNames([k.name]);const c=await probe(k.name,k.value);
  const prev=db.items[id]||{};db.items[id]={name:k.name,service:c.service,account:c.account||'',scopes:c.scopes||'',status:c.status,detail:c.detail||'',last4:last4(k.value),agents:k.agents,usedBy:usedBy(k.name,found,k.agents),checkedAt:new Date().toISOString(),...(prev.firstSeen?{firstSeen:prev.firstSeen}:{firstSeen:new Date().toISOString()})};
  await save();return view(id,db.items[id])}
 const view=(id,x)=>{const{...v}=x;v.id=id;v.label=db.notes?.[x.name]?.name||autoName(x.name,x);v.note=db.notes?.[x.name]||null;v.unused=!x.usedBy?.length;return v};
 // what an agent said a key is for when it asked for it (ask_secret, request_secret_link): kept by the key's name, since
 // the value is not known yet; the account is filled in by the next check, minutes after the key is saved
 async function note(name,{label,description,agent}={}){await load();name=String(name||'').toUpperCase().trim();if(!/^[A-Z][A-Z0-9_]{1,80}$/.test(name))return;
  (db.notes??={})[name]={name:String(label||'').trim().slice(0,60),description:String(description||'').trim().slice(0,200),by:agent||'',at:new Date().toISOString()};await save()}
 // the list for the Keys page: every key now, with what is known; one with the same account as another says so
 async function list(){await load();const keys=await current();const out=[];
  for(const [id,k] of keys){const x=db.items[id];out.push(x?view(id,{...x,agents:k.agents}):{id,name:k.name,service:serviceOf(k.name),agents:k.agents,last4:last4(k.value),status:'unchecked',label:db.notes?.[k.name]?.name||serviceOf(k.name),note:db.notes?.[k.name]||null,usedBy:null})}
  const by={};for(const x of out)if(x.account)(by[x.service+'|'+x.account]??=[]).push(x.id);
  for(const x of out){const g=x.account&&by[x.service+'|'+x.account];if(g&&g.length>1){x.group=x.service+'|'+x.account;x.sameAs=g.filter(i=>i!==x.id)}}
  // the same secret under two names (PINE_SLACK_BOT_TOKEN and SLACK_BOT_TOKEN): one key, said so
  const byV={};for(const x of out)(byV[x.id.split('@')[1]]??=[]).push(x.id);
  for(const x of out){const g=byV[x.id.split('@')[1]];if(g.length>1){x.sameKey=g.filter(i=>i!==x.id);x.group??='same|'+x.id.split('@')[1]}}
  return {items:out.sort((a,b)=>(a.group||a.service||'').localeCompare(b.group||b.service||'')||a.name.localeCompare(b.name))}}
 // keys never checked, or checked over a day ago: one at a time, in the background
 // (a new key is checked within minutes of being saved: the ticks are often and cost nothing when all are fresh)
 async function tick({force=false}={}){if(busy||!live())return;busy=true;try{await load();const keys=await current();
   const todo=[...keys.keys()].filter(id=>{const x=db.items[id];return force||!x||Date.now()-Date.parse(x.checkedAt||0)>=20*3600e3});
   const found=todo.length?await grepNames([...new Set([...keys.values()].map(k=>k.name))]):{};
   for(const id of todo)await check(id,{keys,found}).catch(e=>console.warn('key check',id.split('@')[0],e.message));
   // forget keys that are gone
   let gone=false;for(const id of Object.keys(db.items))if(!keys.has(id)){delete db.items[id];gone=true}if(gone)await save()}finally{busy=false}}
 // Connections rows of keys (key:<id>) that nobody named: the account name instead of the env name
 async function decorate(x){await load();const one=r=>{if(!r||r.labelled||!String(r.key||'').startsWith('key:'))return r;const v=db.items[r.key.slice(4)];if(!v)return r;
   return {...r,rawName:r.rawName||r.name,name:autoName(v.name,v),what:[v.account&&'Account '+v.account,v.status==='rejected'?'Rejected by '+v.service:'',!v.usedBy?.length?'Not used by anything':''].filter(Boolean).join(' · ')||r.what}};
  if(x&&Array.isArray(x.rows))return {...x,rows:x.rows.map(one)};return one(x)}
 return {list,check,tick,current,decorate,note,_probe:probe,_grep:grepNames,file:FILE}}
