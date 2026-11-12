// One-time secret links (4 Nov 2026): when an agent needs a token, password or API key and the person is on their phone
// (Telegram, WhatsApp), it asks for a link (request_secret_link) and sends it. The person opens it outside aqeelOS, pastes
// the value and presses Save; it is saved the way ask_secret's "save" does (the agent's .env and its .secrets lock box).
// The token is the only credential: 32 random bytes, only its SHA-256 is kept, one use, 30 minutes, one key on one agent.
// The page is write-only: nothing stored is ever shown or returned. Values are never logged; the audit keeps agent, key and time.
// An agent also talks to strangers (a support bot's customers), so whoever opens a link may not be the owner: a link only
// ever adds a NEW key, never one that changes how programs run, and the owner hears about every link (review, 4 Nov 2026).
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';

export const LIFE=30*60e3;
export const NAME=/^[A-Z][A-Z0-9_]{1,59}$/;
export const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_VALUE=4096;
// only names that are plainly a secret (a block list of risky names is never complete: review, 4 Nov 2026); TEST_SECRET_LINK
// is the end-to-end test's dummy key
export const SECRETISH=/(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSPHRASE|_PAT)$|^TEST_SECRET_LINK$/;
// names a program reads to decide how it runs (shell start-up, libraries, interpreters, proxies, certificates, git/ssh),
// and the model providers' own keys: never through a link, whatever the agent was told
export const RISKY=/^(BASH_ENV|ENV|SHELL|SHELLOPTS|BASHOPTS|PROMPT_COMMAND|PATH|HOME|USER|LOGNAME|TMPDIR|TEMP|TMP|LANG|LANGUAGE|TZ|IFS|PS[1-4]|EDITOR|VISUAL|PAGER|BROWSER|DISPLAY|TERM)$|^(LC|LD|DYLD|PYTHON|PIP|UV|CONDA|VIRTUAL|NODE|NPM|YARN|PNPM|BUN|DENO|GIT|SSH|GPG|GNUPG|PERL|RUBY|GEM|BUNDLE|JAVA|JDK|MAVEN|GRADLE|CARGO|RUST|GO|DOCKER|KUBE|XDG|SSL|OPENSSL|CURL|WGET|REQUESTS|HTTPLIB|AWS|AZURE|GCLOUD|CLOUDSDK|OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE|OPENROUTER|GROQ|MISTRAL|DEEPSEEK|XAI|COHERE|TOGETHER|FIREWORKS|PERPLEXITY|OLLAMA|LITELLM|HF|HUGGINGFACE|KIMI|MOONSHOT|ZAI|GLM|ZHIPU|MINIMAX|NOUS|DASHSCOPE|QWEN|ALIBABA|NVIDIA|NIM|VERTEX|BEDROCK|REPLICATE|CEREBRAS|SAMBANOVA|LMSTUDIO|VLLM|AI21|VOYAGE|JINA|HERMES|GH|GITHUB_COPILOT|COPILOT)_|^(PYTHON|PERL|RUBY|JAVA|NODE|GIT|SSH)[A-Z0-9]*$|_PROXY$|_CA_BUNDLE$|_CA_CERTS?$|_BASE_URL$|_ENDPOINT$|_HOST$/;
const hash=t=>createHash('sha256').update(String(t)).digest('hex');
// the token goes after # in the link: browsers never send that part, so it is in no server or proxy log and link previews cannot use it
export const TOKEN=/^[A-Za-z0-9_-]{43}$/;

export function createSecretLinks({DATA,save,reserved=()=>false,exists=async()=>false,isAgent=async()=>true,nameOf=a=>a,tell=async()=>{},PUBLIC_URL,now=()=>Date.now(),random=n=>randomBytes(n)}){
 const FILE=path.join(DATA,'secret-links.json');let db=null,loading=null,chain=Promise.resolve();
 // read once (the first caller's promise is shared); a link that was being saved when aqeelOS stopped stays closed
 const load=()=>db?Promise.resolve(db):loading||=(async()=>{let d=await readStore(FILE);d.links||={};d.audit||=[];
  db=d;for(const r of Object.values(d.links))if(r.state==='saving'){r.state='interrupted';r.done=now();log(r,'interrupted')}return d})();
 const write=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1),{mode:0o600})};
 // every change, and every write, one at a time: two taps on Save cannot both get through, and writes never overlap
 const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const log=(rec,event,extra={})=>{db.audit.unshift({at:now(),agent:rec.base,name:rec.name,label:rec.label,event,...extra});db.audit.length=Math.min(db.audit.length,200)};
 // links past their 30 minutes become "expired" (in the audit too); finished ones are dropped after a day
 const tidy=()=>{const t=now();let changed=false;
  for(const [h,r] of Object.entries(db.links)){if(r.state==='open'&&t>=r.exp){r.state='expired';r.done=r.exp;log(r,'expired');changed=true}
   if(r.state!=='open'&&r.state!=='saving'&&t-(r.done||r.at)>24*3600e3){delete db.links[h];changed=true}}
  return changed};
 const fresh=()=>queue(async()=>{await load();if(tidy())await write().catch(()=>{});return db});
 const view=r=>({id:r.id,agent:r.base,agentName:nameOf(r.base),name:r.name,label:r.label,by:r.by,at:r.at,exp:r.exp,state:r.state,done:r.done||null});

 // agent: the agent the key is for; by: who asked (an agent id)
 const create=({agent,name,label,by})=>queue(async()=>{await load();tidy();
  const base=String(agent||'').trim();name=String(name||'').trim().toUpperCase();label=String(label||'').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
  if(!AGENT.test(base)||base.includes('--'))throw Error('There is no agent called '+base.slice(0,64)+'.');
  if(!NAME.test(name))throw Error('Give the key a name in capitals, like OPENAI_API_KEY.');
  if(!SECRETISH.test(name))throw Error('A link can only save a key whose name ends in _KEY, _TOKEN, _SECRET or _PASSWORD (for example SHOPIFY_API_KEY). Pick such a name.');
  if(reserved(name)||RISKY.test(name))throw Error(name+' changes how aqeelOS or its programs run, so a link cannot set it. Ask the owner to set it on Keys and secrets in aqeelOS.');
  if(!label)throw Error('Give a label the person recognises, like "Support Telegram bot token".');
  if(!await isAgent(base))throw Error('There is no agent called '+base+'.');
  if(await exists(base,name))throw Error(name+' is already set for this agent, and a link only adds new keys. To replace it, ask the owner to change it on Keys and secrets in aqeelOS.');
  const open=Object.values(db.links).filter(r=>r.state==='open');
  if(open.filter(r=>r.base===base).length>=5)throw Error('This agent already has 5 open links. Wait for them to be used or to expire (30 minutes).');
  // a new link for the same key replaces the old one, so only the newest link works
  for(const r of open)if(r.base===base&&r.name===name){r.state='replaced';r.done=now();log(r,'replaced')}
  const token=random(32).toString('base64url'),id=random(6).toString('base64url'),t=now();
  const rec={id,base,name,label,by:String(by||base).split('--')[0],at:t,exp:t+LIFE,state:'open'};db.links[hash(token)]=rec;log(rec,'created',{by:rec.by});await write();
  tell(nameOf(rec.by)+' made a secret link for '+name+(rec.by!==base?' on '+nameOf(base):''),'"'+label+'". It works once, for 30 minutes. If you did not expect it, cancel it on Keys and secrets.').catch(()=>{});
  return {url:PUBLIC_URL+'/secret#'+token,exp:rec.exp,link:view(rec)}});

 // what the page shows before saving: never a value
 async function peek(token){if(typeof token!=='string'||!TOKEN.test(token))return null;await fresh();const r=db.links[hash(token)];if(!r||r.state!=='open')return null;
  return {label:r.label,agentName:nameOf(r.base),name:r.name,exp:r.exp}}

 // the link is used up (on disk too) before the value is written; if writing fails, it opens again so the person can retry
 const consume=(token,value)=>queue(async()=>{if(typeof token!=='string'||!TOKEN.test(token))return {ok:false,gone:true};await load();if(tidy())await write().catch(()=>{});
  const r=db.links[hash(token)];if(!r||r.state!=='open')return {ok:false,gone:true};
  value=typeof value==='string'?value.trim():'';
  if(!value)return {ok:false,error:'Paste the value first.'};
  if(value.length>MAX_VALUE)return {ok:false,error:'That is longer than a key can be ('+MAX_VALUE+' characters).'};
  if(/[\u0000-\u001f\u007f\u2028\u2029]/.test(value))return {ok:false,error:'A key is one line of plain text. Paste it again without line breaks or tabs.'};
  if(await exists(r.base,r.name).catch(()=>true))return {ok:false,error:'This key was set another way meanwhile, so the link no longer can. Ask for a new one if it is wrong.'};
  r.state='saving';try{await write()}catch(e){r.state='open';console.warn('secret link: record',e.message);return {ok:false,error:'It could not be saved. Try again in a moment.'}}
  try{await save(r.base,r.name,value)}catch(e){console.warn('secret link: saving',r.name,'for',r.base,'failed:',String(e.message||e).slice(0,160));r.state='open';await write().catch(()=>{});return {ok:false,error:'It could not be saved. Try again in a moment.'}}
  r.state='saved';r.done=now();log(r,'saved');await write().catch(e=>console.warn('secret link: record',e.message));
  tell(nameOf(r.base)+': '+r.name+' was saved through a secret link','"'+r.label+'". The value was never shown to anyone.').catch(()=>{});
  return {ok:true,agentName:nameOf(r.base),name:r.name}});

 // for the agent: did the person save it? (newest link for that key wins)
 async function status(agent,name){await fresh();const base=String(agent||'').trim();name=String(name||'').trim().toUpperCase();
  const r=Object.values(db.links).filter(x=>x.base===base&&x.name===name).sort((a,b)=>b.at-a.at)[0];return r?view(r):null}
 // wait up to ms for a save (the engine gives a tool call 5 minutes)
 async function wait(agent,name,ms=240e3){const end=now()+ms;let r=await status(agent,name);
  while((r?.state==='open'||r?.state==='saving')&&now()<end){await new Promise(z=>setTimeout(z,3000));r=await status(agent,name)}return r}
 // Keys and secrets: open links (to cancel) and the recent history; never a value
 async function list(){await fresh();
  return {open:Object.values(db.links).filter(r=>r.state==='open').sort((a,b)=>b.at-a.at).map(view),audit:db.audit.slice(0,30).map(x=>({...x,agentName:nameOf(x.agent)}))}}
 const cancel=(id,by)=>queue(async()=>{await load();tidy();const r=Object.values(db.links).find(x=>x.id===id&&x.state==='open');if(!r)return false;r.state='cancelled';r.done=now();log(r,'cancelled',{by});await write();return true});
 return {create,peek,consume,status,wait,list,cancel}}

// a simple per-address limit for the public page: max hits in 10 minutes
export function createLimiter(max=30,win=600e3,now=()=>Date.now()){const m=new Map();
 return ip=>{const t=now(),a=(m.get(ip)||[]).filter(x=>t-x<win);if(a.length<=max)a.push(t);m.set(ip,a);if(m.size>5000)for(const k of [...m.keys()].slice(0,1000))m.delete(k);return a.length>max}}
