// Claude accounts for aqeelOS: several Claude subscriptions side by side, live plan usage, which agent uses
// which account, and optional automatic switching when an account runs low.
// Each account is its own Claude Code config folder (CLAUDE_CONFIG_DIR); the main one is ~/.claude.
// Hermes' Claude plugin is pointed at an account per agent with its `claude_config_dir` setting.
import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,rm,readdir,cp,access,stat,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {hermes as hq,setKey,readConfig,pick,editEnv,agentNames,setStatus,getStatus,LIVE_APP} from './agentops.mjs';
import {allowed,trim} from './skills-policy.mjs';
import {swr} from './swr.mjs';

const HOME=homedir();
const CLAUDE=process.env.CLAUDE_BIN||path.join(HOME,'.local','bin','claude');
const HERMES_HOME=process.env.HERMES_HOME||path.join(HOME,'.hermes');
const PLUGIN='claude-subscription-directsdk-experimental';
const SETTING=`plugins.entries.${PLUGIN}.settings.claude_config_dir`;
const ACCOUNTS_DIR=path.join(HOME,'.claude-accounts');
const MAIN={id:'main',label:'Main account',dir:path.join(HOME,'.claude')};

// Set up a brand-new agent (plugin, model, gateway key); server.mjs also calls it for agents members create.
export let setupAgentFn=null;
export const export_setups={running:()=>0,wait:()=>Promise.resolve()};   // setups in progress, counted by /healthz so a deploy waits for them
// for agent-defaults.mjs: copying skills, and what runs after a new agent is set up
export const accountHooks={giveSkills:null,trimSkills:null,forgetSkills:null,afterSetup:null,moveOff:null};
export function createAccounts(DATA,{codeRoot=path.join(HOME,'apps','aqeel-code')}={}){
 const FILE=path.join(DATA,'accounts.json');
 const load=async()=>{try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {accounts:[],assign:{},auto:{on:false,threshold:90},events:[]}}};
 // every write is a change applied to a fresh read, one after another, so a slow writer (auto-switch, a sign-in
 // finishing) never saves a stale copy over another's change; each write has its own tmp file; a change that returns false saves nothing
 let saving=Promise.resolve();
 const update=fn=>{const p=saving.then(async()=>{const d=await load();const r=await fn(d);if(r===false)return r;await mkdir(DATA,{recursive:true});const tmp=FILE+'.'+process.pid+'.'+Date.now()+'.'+Math.random().toString(36).slice(2)+'.tmp';await writeFile(tmp,JSON.stringify(d,null,1));await rename(tmp,FILE);return r});saving=p.catch(()=>{});return p};
 const event=(x,e)=>{x.events=[e,...(x.events||[])].slice(0,50)};
 const all=d=>[{...MAIN,label:d.mainLabel||MAIN.label},...d.accounts.filter(a=>a.id!=='main')];
 const run=(cmd,args,env={},timeout=30000)=>new Promise(res=>execFile(cmd,args,{env:{...process.env,...env},timeout,maxBuffer:4e6},(err,stdout,stderr)=>res({ok:!err,out:String(stdout||''),err:String(stderr||err?.message||'')})));

 /* ---------- account details: `claude auth status` (a CLI run) and Anthropic's usage call per account. The last answer
    is used at once and read again behind the scenes after 60 s; sign-in, sign-out, rename and ?fresh=1 read it new.
    With quick (the Accounts page) an account never read yet waits at most 3 s, then shows as not checked yet. ---------- */
 const cache=swr({fresh:60000,cap:3000});
 const details=(a,fresh,quick)=>cache.get(a.id,()=>readDetails(a),{force:!!fresh,partial:quick?()=>({id:a.id,label:a.label,main:a.id==='main',signedIn:false,partial:true}):undefined});
 async function readDetails(a){
  const v={id:a.id,label:a.label,main:a.id==='main',signedIn:false};
  // Read-only: the sign-in file and Claude's own account file, never a CLI run that could renew the login (the engine
  // renews ~/.claude itself under its own lock, so every extra renewer is one more chance to spend the single-use
  // refresh token twice). expiresAt 0 is how Claude marks a login it gave up on. The main account's email is in
  // ~/.claude.json, another account's in <its folder>/.claude.json.
  let creds=null;try{creds=JSON.parse(await readFile(path.join(a.dir,'.credentials.json'),'utf8')).claudeAiOauth}catch{}
  if(creds){const acc=await readFile(a.id==='main'?path.join(HOME,'.claude.json'):path.join(a.dir,'.claude.json'),'utf8').then(t=>JSON.parse(t).oauthAccount||{},()=>({}));
   Object.assign(v,{checked:true,signedIn:!!(creds.accessToken||creds.refreshToken)&&Number(creds.expiresAt)>0,email:acc.emailAddress||'',org:acc.organizationName||'',plan:creds.subscriptionType||''})}
  else{// no file (a keychain login, or a folder that never signed in): ask the CLI, which has nothing here to renew
   const st=await run(CLAUDE,['auth','status'],a.id==='main'?{}:{CLAUDE_CONFIG_DIR:a.dir},20000);
   // checked: the status really answered (a timed-out check is unknown, not "signed out")
   try{const j=JSON.parse(st.out);Object.assign(v,{checked:true,signedIn:!!j.loggedIn,email:j.email||'',org:j.orgName||'',plan:j.subscriptionType||''})}catch{}}
  if(creds){v.plan=v.plan||creds.subscriptionType||'';v.tier=creds.rateLimitTier||'';v.tokenExpires=creds.expiresAt||null}
  if(v.signedIn&&creds?.accessToken){
   try{const r=await fetch('https://api.anthropic.com/api/oauth/usage',{headers:{authorization:'Bearer '+creds.accessToken,'anthropic-beta':'oauth-2025-04-20',accept:'application/json','user-agent':'claude-code/2.1.0'},signal:AbortSignal.timeout(15000)});
    if(r.ok){const u=await r.json();const win=k=>u[k]?{used:Math.round(Number(u[k].utilization)||0),resets:u[k].resets_at||null}:null;
     v.usage={session:win('five_hour'),week:win('seven_day'),opus:win('seven_day_opus'),sonnet:win('seven_day_sonnet')};
     const ex=u.extra_usage;if(ex?.is_enabled)v.extra={used:ex.used_credits,limit:ex.monthly_limit,currency:ex.currency||'USD'}}
    else v.usageError=r.status===401?'Sign-in expired. It refreshes the next time this account is used.':'Usage unavailable ('+r.status+')'}
   catch{v.usageError='Could not reach Anthropic.'}
  }
  return v;
 }
 const headroom=v=>v?.usage?100-Math.max(v.usage.session?.used||0,v.usage.week?.used||0,v.usage.opus?.used||0,v.usage.sonnet?.used||0):-1;

 /* ---------- which agent uses which account ---------- */
 const agents=()=>agentNames();
 async function assign(d,profile,accountId,why){
  const a=all(d).find(x=>x.id===accountId);if(!a)throw new Error('Unknown account');
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile))throw new Error('Bad agent name');
  // Main account: an empty setting falls back to Claude's default sign-in.
  const r=await hq(profile,['config','set',SETTING,a.id==='main'?'':a.dir]);
  if(!r.ok)throw new Error('The engine did not accept the change: '+(r.err||r.out).slice(0,200));
  d.assign[profile]=a.id;await update(x=>{x.assign=x.assign||{};x.assign[profile]=a.id;if(why)event(x,{t:Date.now(),profile,to:a.id,why})});
 }

 /* ---------- adding an account: claude auth login in its own folder ---------- */
 const logins=new Map(); // id → {child,out,state}
 async function startLogin(label){
  const d=await load();const slug=(String(label||'account').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'account').slice(0,32);
  // an id no saved account, sign-in in progress or folder on disk has (two sign-ins at once never share a folder)
  const taken=async id=>all(d).some(a=>a.id===id)||logins.has(id)||await access(path.join(ACCOUNTS_DIR,id)).then(()=>true,()=>false);
  let id=slug,n=2;while(await taken(id)||logins.has(id))id=slug+'-'+n++;logins.set(id,{state:'starting'});
  const dir=path.join(ACCOUNTS_DIR,id);
  // the id is reserved above: a folder or start that fails gives it back (no sign-in is left "starting" for ever)
  try{await mkdir(dir,{recursive:true,mode:0o700})}catch(e){logins.delete(id);throw new Error('Could not start the sign-in: '+e.message)}
  return runLogin(id,{dir,label:String(label||id).slice(0,60)},{CLAUDE_CONFIG_DIR:dir},async()=>{await update(d2=>{if(!d2.accounts.some(a=>a.id===id))d2.accounts.push({id,label:s0(id).label,dir})})});
 }
 const s0=id=>logins.get(id)||{};
 // one `claude auth login` run: output kept for the code step, done() on success, fail() on any other end (cancel,
 // a refused code, the 10-minute limit). env {} = the main account in Claude's default place.
 async function runLogin(id,s,env,done,fail=async()=>{}){let child;
  const e={...process.env,BROWSER:'true',...env};if(!env.CLAUDE_CONFIG_DIR)delete e.CLAUDE_CONFIG_DIR;
  try{child=spawn(CLAUDE,['auth','login'],{env:e,stdio:['pipe','pipe','pipe']})}catch(er){logins.delete(id);await fail().catch(()=>{});throw new Error('Could not start the sign-in: '+er.message)}
  Object.assign(s,{child,out:'',state:'running'});logins.set(id,s);let end;s.closed=new Promise(r=>end=r);
  child.on('error',er=>{s.state='failed';s.out+='\n'+er.message});
  const add=b=>{s.out=(s.out+String(b).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')).slice(-8000)};child.stdout.on('data',add);child.stderr.on('data',add);
  child.on('close',async code=>{try{s.state=code===0?'done':'failed';if(code===0)await done();else await fail()}catch(er){s.state='failed';console.warn('account sign-in',er.message)}finally{cache.drop(id);end()}});
  setTimeout(()=>{if(s.state==='running'){s.state='failed';child.kill()}},10*60000).unref();
  for(let i=0;i<40&&!/https:\/\/\S+/.test(s.out)&&s.state==='running';i++)await new Promise(r=>setTimeout(r,250));
  return {id,url:(/https:\/\/\S+/.exec(s.out)||[])[0]||null,state:s.state}}
 /* ---------- reconnecting an account that is there already: the same sign-in, in that account's own folder (main: Claude's
    default place), so its id, name, priority and agents stay. Its sign-in file is copied to .credentials.json.bak-<time>
    first and put back if the sign-in is cancelled or fails, unless something renewed the login meanwhile. ---------- */
 const credsOf=t=>{try{return JSON.parse(t).claudeAiOauth||null}catch{return null}};
 async function reconnect(id){const d=await load();const a=all(d).find(x=>x.id===id);if(!a)throw new Error('Unknown account');
  // one sign-in per account: an unfinished one (its window closed without Cancel) ends first and puts its copy back
  const old=logins.get(id);if(old?.state==='running'){old.child.kill();await old.closed}
  const f=path.join(a.dir,'.credentials.json'),bak=f+'.bak-'+Date.now();
  const before=await readFile(f,'utf8').catch(()=>null);if(before!==null)await copyFile(f,bak);
  const restore=async()=>{if(before===null)return;const now=await readFile(f,'utf8').catch(()=>null);if(now===before)return;
   const c=credsOf(now),b=credsOf(before);if(c?.refreshToken&&c.refreshToken!==b?.refreshToken&&Number(c.expiresAt)>Date.now()){console.log('reconnect',id,'ended; kept the newer sign-in that appeared meanwhile');return}
   const t=f+'.'+process.pid+'.tmp';await copyFile(bak,t);await rename(t,f);console.log('reconnect',id,'ended without signing in; sign-in file put back')};
  // the five newest copies are kept, older ones go (each is a whole sign-in)
  const prune=async()=>{const l=(await readdir(a.dir).catch(()=>[])).filter(n=>/^\.credentials\.json\.bak-\d+$/.test(n)).sort().reverse();for(const n of l.slice(5))await rm(path.join(a.dir,n),{force:true})};
  return runLogin(id,{dir:a.dir,label:a.label,reconnect:true},a.id==='main'?{}:{CLAUDE_CONFIG_DIR:a.dir},async()=>{console.log('reconnect',id,'signed in');await forget('claude:'+id,true);await prune()},async()=>{await restore();await prune()})}
 const loginState=id=>{const s=logins.get(id);return s?{state:s.state,hint:s.state==='done'?'Signed in.':s.state==='failed'?'Sign-in failed: '+(s.out.split('\n').filter(Boolean).slice(-2).join(' ')||'try again'):''}:{state:'gone'}};
 async function sendCode(id,code){const s=logins.get(id);if(!s||s.state!=='running')throw new Error('This sign-in is not running any more. Start again.');
  if(typeof code!=='string'||!code.trim()||code.length>4096)throw new Error('Paste the code from the sign-in page.');
  s.child.stdin.write(code.trim()+'\n');for(let i=0;i<60&&s.state==='running';i++)await new Promise(r=>setTimeout(r,500));
  if(s.state==='running')return {state:'running',hint:/invalid/i.test(s.out)?'That code was not accepted. Copy the whole code and try again.':'Still checking…'};
  return {state:s.state,hint:s.state==='done'?'Signed in.':'Sign-in failed: '+(s.out.split('\n').filter(Boolean).slice(-2).join(' ')||'try again')}}

 /* ---------- every other signed-in provider (ChatGPT, OpenRouter…) with the limits Hermes reports ----------
    Sign-ins are per agent, so each agent's own gateway is asked (/p/<agent>/…) and cached per agent. */
 const GATE=process.env.HERMES_API||'http://127.0.0.1:8642';
 const SKIP=/^(nous|anthropic|custom)$|claude-subscription/;
 // subscriptions report windows; one that reports none has unknown room (only pay-per-use counts as 0)
 const SUBS=/subscription|codex|antigravity|agy/i;
 const options=profile=>fetch(GATE+(!profile||profile==='default'?'':'/p/'+encodeURIComponent(profile))+'/api/model/options',{headers:{authorization:'Bearer '+(process.env.API_SERVER_KEY||'')},signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw new Error('options '+r.status);return r.json()});
 const provCache=new Map();   // agent → {t,v}
 // null when that agent's gateway did not answer (and nothing was read before): callers skip instead of guessing
 async function providers(fresh,profile='default'){const hit=provCache.get(profile);
  // the last answer at once; one read behind the scenes once it is a minute old
  if(hit&&!fresh){if(Date.now()-hit.t>=60000&&!hit.r){hit.r=1;providers(true,profile).catch(()=>{})}return withPics(hit.v,profile)}
  try{const j=await options(profile);
   const v=(j.providers||[]).filter(p=>p.authenticated&&!SKIP.test(p.slug)&&p.slug!=='gemini-subscription').map(p=>({slug:p.slug,name:p.name,models:p.models||[],
    windows:(p.usage?.windows||[]).map(w=>({label:w.label,used:Math.round(Number(w.used_percent)||0),resets:w.resets_at||null,scope:w.scope||'account'})),details:p.usage?.details||[]}));
   provCache.set(profile,{t:Date.now(),v});return withPics(v,profile)}catch{if(hit)hit.r=0;return hit?withPics(hit.v,profile):null}}
 const worstOf=ws=>Math.max(0,...(ws||[]).filter(w=>w.scope!=='model'&&w.scope!=='image').map(w=>w.used||0));

 /* ---------- the ChatGPT pictures quota: separate from chat use and not in what the gateway reports. The engine logs
    "Codex images API returned HTTP 429" when it runs out; that shows as a Pictures window until a later picture
    works or 5 hours pass. Never counted for switching (scope 'image'). ---------- */
 const PICS_SLUG='openai-codex',picsHit=new Map();   // agent → {at, agent}
 const withPics=(v,profile)=>{const h=picsHit.get(profile);if(!h||Date.now()>h.at+5*3600e3)return v;
  return v.map(p=>p.slug===PICS_SLUG?{...p,windows:[...p.windows,{label:'Pictures',used:100,scope:'image',at:h.at,resets:new Date(h.at+5*3600e3).toISOString()}]}:p)};
 const logT=l=>Date.parse(l.slice(0,19).replace(' ','T')+'Z');   // engine log lines start "YYYY-MM-DD HH:MM:SS" (read as the watchdog does)
 async function tailOf(f,n=262144){try{const st=await stat(f);const {open}=await import('node:fs/promises');const h=await open(f,'r');try{const len=Math.min(n,st.size),b=Buffer.alloc(len);await h.read(b,0,len,st.size-len);return b.toString('utf8')}finally{await h.close()}}catch{return ''}}
 async function picsWatch(){for(const a of await agents()){const dir=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);let hit=0,ok=0;
  for(const f of ['agent.log','errors.log'])for(const l of (await tailOf(path.join(dir,'logs',f))).split('\n')){const t=logT(l);if(!t)continue;
   if(/Codex images API returned HTTP 429/.test(l))hit=Math.max(hit,t);else if(/tool image_generate completed/.test(l))ok=Math.max(ok,t)}
  if(hit>ok&&Date.now()<hit+5*3600e3)picsHit.set(a,{at:hit,agent:a});else picsHit.delete(a)}}
 if(LIVE_APP){setInterval(()=>picsWatch().catch(()=>{}),3*60000).unref();setTimeout(()=>picsWatch().catch(()=>{}),15000).unref()}

 /* ---------- priority: the order accounts are used in, across providers ----------
    Entries: {key:'claude:<account id>'|'p:<provider slug>', model}. An agent moves down the list
    when its current entry passes the threshold, and back up once a higher entry has room again. */
 const PLUGIN_KEY='claude:';
 async function agentRoute(profile){const dir=profile==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',profile);const y=await readFile(path.join(dir,'config.yaml'),'utf8').catch(()=>'');
  const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}}
 async function entryOf(d,profile){const r=await agentRoute(profile);return r.provider===PLUGIN||!r.provider?PLUGIN_KEY+(d.assign[profile]||'main'):'p:'+r.provider}
 const isClaude=m=>/claude|opus|sonnet|haiku/i.test(String(m||''));
 const must=async(p,why)=>{const r=await p;if(!r?.ok)throw new Error(why+': '+String(r?.err||r?.out||'the engine did not accept the change').slice(0,200));return r};
 async function useEntry(d,profile,e,why){
  if(e.key.startsWith(PLUGIN_KEY)){await assign(d,profile,e.key.slice(PLUGIN_KEY.length),why);await must(setKey(profile,'model.provider',PLUGIN),'Could not switch '+profile+' to Claude');
   // a Claude account needs a Claude model: one left from another provider (gpt-5…) would fail every message
   if(!e.model&&!isClaude((await agentRoute(profile)).model)){const pl=await options(profile).then(j=>(j.providers||[]).find(p=>p.slug===PLUGIN)).catch(()=>null);const m=(pl?.models||[]).find(isClaude)||pl?.models?.[0];
    if(!m)throw new Error('The Claude sign-in on '+profile+' offers no model yet');await must(setKey(profile,'model.default',m),'Could not set the Claude model')}}
  else{// only switch an agent to a provider THAT agent is signed in to (sign-ins are per agent)
   const slug=e.key.slice(2);const ok=await options(profile).then(j=>(j.providers||[]).find(p=>p.slug===slug&&p.authenticated)||false).catch(()=>false);
   if(!ok)throw new Error(profile+' is not signed in to '+slug+'; sign in on that agent first');
   await must(setKey(profile,'model.provider',slug),'Could not switch '+profile);
   if(!e.model&&ok.models?.length){const cur=(await agentRoute(profile)).model;if(!ok.models.includes(cur))await must(setKey(profile,'model.default',ok.models[0]),'Could not set the model')}
   await update(x=>event(x,{t:Date.now(),profile,to:e.key,why:why||''}))}
  if(e.model)await must(setKey(profile,'model.default',e.model),'Could not set the model');
 }
 // Claude use for a model: the 5-hour and weekly windows, plus the weekly Opus or Sonnet window when the model is one
 const claudeUsed=(u,model)=>Math.max(u.session?.used||0,u.week?.used||0,/opus/i.test(model||'')?u.opus?.used||0:0,/sonnet/i.test(model||'')?u.sonnet?.used||0:0);
 // null = unknown (a check that failed or timed out, a subscription that reports no windows): never a reason to move,
 // never a target. A Claude account that answered "signed out" has no room (100).
 function usageOf(key,det,prov,model){if(key.startsWith(PLUGIN_KEY)){const v=det[key.slice(PLUGIN_KEY.length)];if(!v?.checked)return null;if(!v.signedIn)return 100;return v.usage?claudeUsed(v.usage,model):null}
  const p=(prov||[]).find(x=>x.slug===key.slice(2));if(!p)return null;const ws=(p.windows||[]).filter(w=>w.scope!=='model'&&w.scope!=='image');
  if(!ws.length)return SUBS.test(p.slug+' '+p.name)?null:0;return worstOf(ws)}

 /* ---------- auto-switch: move agents off an account that is nearly used up, and back once it has room ---------- */
 async function autoTick(){const d=await load();if(!d.auto?.on)return;const th=Number(d.auto.threshold)||90;const accts=all(d);
  const det=Object.fromEntries(await Promise.all(accts.map(async a=>[a.id,await details(a)])));
  if((d.priority||[]).length){
   for(const profile of await agents()){const prov=await providers(false,profile);if(!prov)continue;   // its gateway did not answer: nothing is known this tick
    const cur=await entryOf(d,profile),model=(await agentRoute(profile)).model;const used=usageOf(cur,det,prov,model);const at=d.priority.findIndex(e=>e.key===cur);
    const room=(e,lim)=>{const u=usageOf(e.key,det,prov,e.model||(e.key.startsWith(PLUGIN_KEY)&&!isClaude(model)?'':model));return u!==null&&u<lim};
    // back up the list: a higher entry with room again (10 points under the limit, so it does not flip back and forth);
    // an agent someone moved by hand stays where they put it
    const byHand=(d.events||[]).find(e=>e.profile===profile)?.why==='Chosen by hand';
    const up=at>0&&!byHand?d.priority.slice(0,at).filter(e=>room(e,th-10)):[];
    const down=used!==null&&used>=th?d.priority.filter(e=>e.key!==cur&&!up.includes(e)&&room(e,th)):[];
    for(const e of [...up,...down]){const done=await useEntry(d,profile,e,up.includes(e)?'Back to a higher account with room':`Reached ${used}%`).then(()=>true,er=>{console.warn('auto-switch',er.message);return false});if(done)break}}
   return}
  for(const profile of await agents()){const cur=d.assign[profile]||'main';const v=det[cur];if(!v?.usage)continue;
   const worst=claudeUsed(v.usage,(await agentRoute(profile)).model);if(worst<th)continue;
   const best=accts.filter(a=>a.id!==cur&&det[a.id]?.signedIn&&det[a.id]?.usage).sort((x,y)=>headroom(det[y.id])-headroom(det[x.id]))[0];
   if(best&&headroom(det[best.id])>100-th)await assign(d,profile,best.id,`${v.label||cur} reached ${worst}%`).catch(e=>console.warn('auto-switch',e.message))}}
 if(LIVE_APP)setInterval(()=>autoTick().catch(()=>{}),5*60000).unref();   // a test copy never switches real agents

 /* ---------- signed out: an account that stopped working until someone reconnects it (Bottlenecks, the Models banner).
    A Claude account that answers "signed out" always counts (each one was signed in once). A provider counts when it
    was signed in before (seen) and is gone from the main agent's sign-ins now; signing out on purpose forgets it.
    One entry per account (d.signedOut[key]) until it works again. ---------- */
 async function note(det,prov){const now=Date.now();await update(x=>{const so=x.signedOut||={},seen=x.seen||={};let ch=false;const out=(k,name)=>{if(!so[k]){so[k]={key:k,name,since:now};ch=true;console.log('signed out:',name)}};const back=k=>{if(so[k]){delete so[k];ch=true}};
   for(const a of all(x)){const v=det[a.id],k=PLUGIN_KEY+a.id;if(!v?.checked)continue;if(v.signedIn)back(k);else out(k,x.mainLabel&&a.id==='main'?x.mainLabel:a.label)}
   for(const k of Object.keys(so))if(k.startsWith(PLUGIN_KEY)&&!all(x).some(a=>PLUGIN_KEY+a.id===k))back(k);   // a removed account
   if(prov){for(const p of prov){const k='p:'+p.slug;if(seen[k]?.name!==p.name){seen[k]={name:p.name};ch=true}back(k)}
    for(const [k,s] of Object.entries(seen))if(!prov.some(p=>'p:'+p.slug===k))out(k,s.name)}
   return ch})}
 async function forget(key,keepSeen){await update(x=>{if(x.signedOut)delete x.signedOut[key];if(!keepSeen&&x.seen)delete x.seen[key]})}
 async function signinTick(){const d=await load();const det=Object.fromEntries(await Promise.all(all(d).map(async a=>[a.id,await details(a)])));await note(det,await providers(false,'default'))}
 if(LIVE_APP){setInterval(()=>signinTick().catch(()=>{}),5*60000).unref();setTimeout(()=>signinTick().catch(()=>{}),20000).unref()}
 const signedOut=async()=>Object.values((await load()).signedOut||{});

 /* ---------- HTTP ---------- */
 /* ---------- a new agent gets everything it needs, checked step by step (any model provider) ----------
    One setup per agent at a time (a second call joins the running one). Each step is skipped when already
    right, so the health check can run it again and again; what failed is kept and shown on the Agents page. */
 const DENY=['*gateway stop*','*gateway restart*','*kill-session -t gateway*','*pkill*hermes*','*killall*hermes*','*pkill*gateway*','*kill*bridge.js*','*pkill*node*','*mcp login*','*localhost:3118*','*127.0.0.1:3118*'];
 // the main agent's working settings every agent starts with (copied once; changes made later on that agent stay)
 const QUIET=[['display.busy_ack_enabled',false],['display.busy_steer_ack_enabled',false],['display.busy_ack_detail',false],['display.suppress_warning_notifications',true],['display.long_running_notifications',false]];
 const FROM_MAIN=['timezone','browser.headed','browser.inactivity_timeout','agent.max_turns','agent.reasoning_effort'];
 const setups=new Map();
 // what each agent was given or already had (DATA/skills-given.json, agent → {skill: time}): a skill on that list that is
 // gone now was removed by a person, so it is not copied back. An agent not on it yet (first run, a new agent) is
 // recorded as it is first; a deleted agent's list is dropped, so a new agent with the same name starts fresh.
 const GIVEN=path.join(DATA,'skills-given.json');let given=null,gFirst=null,gSave=Promise.resolve();
 const gLoad=async()=>given||(given=await (gFirst||=readFile(GIVEN,'utf8').then(JSON.parse).catch(()=>({})))) ;
 const gKeep=()=>{const snap=JSON.stringify(given);gSave=gSave.then(async()=>{await mkdir(DATA,{recursive:true});const t=GIVEN+'.'+process.pid+'.tmp';await writeFile(t,snap);await rename(t,GIVEN)}).catch(e=>console.warn('skills given',e.message))};
 // copy each skill folder the agent does not have yet from the main agent (never overwrites its own)
 async function giveSkills(name){const from=path.join(HERMES_HOME,'skills'),to=path.join(HERMES_HOME,'profiles',name,'skills');let n=0;
  await access(path.join(HERMES_HOME,'profiles',name,'config.yaml'));const rec=await gLoad();let ch=!rec[name];const mine=rec[name]||={};
  for(const cat of await readdir(from,{withFileTypes:true}).catch(()=>[])){if(!cat.isDirectory()||cat.name.startsWith('.'))continue;
   for(const sk of await readdir(path.join(from,cat.name),{withFileTypes:true}).catch(()=>[])){if(!sk.isDirectory())continue;const src=path.join(from,cat.name,sk.name),dst=path.join(to,cat.name,sk.name),key=cat.name+'/'+sk.name;
    if(await access(path.join(src,'SKILL.md')).then(()=>false,()=>true))continue;if(!allowed(key,name))continue;
    if(await access(dst).then(()=>true,()=>false)){if(!mine[key]){mine[key]=Date.now();ch=true}continue}
    if(mine[key])continue;   // it had it and someone took it off: it stays off
    await mkdir(path.dirname(dst),{recursive:true});await cp(src,dst,{recursive:true});mine[key]=Date.now();ch=true;n++}}
  if(ch)gKeep();if(n)console.log('gave',n,'skills to',name);return n}
 // skills an agent must not have (see skills-policy.mjs) are moved to <agent>/skills-removed/<date>, never deleted;
 // they leave its given list too, so a later policy that allows them gives them again
 async function trimSkills(name){const root=name==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',name);
  const moved=await trim(path.join(root,'skills'),name,path.join(root,'skills-removed',new Date().toISOString().slice(0,10)));
  if(moved.length){const rec=await gLoad();if(rec[name]){for(const k of moved)delete rec[name][k];gKeep()}console.log('skills: moved',moved.length,'out of',name+':',moved.join(', '))}return moved.length}
 const forgetSkills=async name=>{const rec=await gLoad();if(rec[name]){delete rec[name];gKeep()}};
 function setupAgent(name){if(!setups.has(name))setups.set(name,doSetup(name).finally(()=>setups.delete(name)));return setups.get(name)}
 async function doSetup(name){
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)||name==='default')throw new Error('Unknown agent');
  const dir=path.join(HERMES_HOME,'profiles',name);await access(path.join(dir,'config.yaml'));const done=[],failed=[];
  // a step that collides with another writer of the agent's settings ("configuration changed since this selection was read") tries again
  const step=async(label,fn)=>{for(let i=0;;i++){try{const r=await fn();if(r&&r.ok===false)throw new Error(r.err||'failed');done.push(label);return}catch(e){const m=String(e.message);if(i<3&&/AdmissionRefused|changed since/i.test(m)){await new Promise(r=>setTimeout(r,2000+i*2000));continue}failed.push(label+': '+m.slice(0,200));return}}};
  // the gateway key first: without it the engine refuses every chat (written under the engine's .env lock)
  const KEY=process.env.API_SERVER_KEY;
  if(KEY&&!/^API_SERVER_KEY=/m.test(await readFile(path.join(dir,'.env'),'utf8').catch(()=>'')))
   await step('key',()=>editEnv(path.join(dir,'.env'),cur=>/^API_SERVER_KEY=/m.test(cur)?null:cur+(cur&&!cur.endsWith('\n')?'\n':'')+'API_SERVER_KEY='+KEY+'\n'));
  const c=await readConfig(name),main=await readConfig('default')||{};
  if(!c){failed.push('settings: could not be read');await setStatus(name,{t:Date.now(),ok:false,failed});return {ok:false,done,failed}}
  // the main agent's model sign-ins carry over (aqeelOS works with any model; the Claude sign-in is one plugin among them)
  const mainUses=(pick(main,'plugins.enabled')||[]).includes(PLUGIN);const plug=path.join(dir,'plugins',PLUGIN);
  if(mainUses&&!await access(plug).then(()=>1,()=>0))await step('plugin',async()=>{await mkdir(path.join(dir,'plugins'),{recursive:true});await cp(path.join(HERMES_HOME,'plugins',PLUGIN),plug,{recursive:true});
   await cp(path.join(HERMES_HOME,'plugins','.install-metadata.json'),path.join(dir,'plugins','.install-metadata.json')).catch(()=>{})});
  if(mainUses&&!(pick(c,'plugins.enabled')||[]).includes(PLUGIN))await step('plugin enabled',async()=>{const r=await hq(name,['plugins','enable',PLUGIN],{timeout:150000,retries:3});if(!r.ok)return r;
   if(!(pick(await readConfig(name)||{},'plugins.enabled')||[]).includes(PLUGIN))throw new Error('the engine did not keep the Claude plugin enabled');return r});
  const prov=pick(c,'model.provider')||'';
  // a new agent starts on the main agent's model, whichever provider that is (GPT, Claude, OpenRouter…)
  const mp=pick(main,'model.provider'),md=pick(main,'model.default');
  if((!prov||/^(anthropic|nous)$/.test(prov))&&mp&&md&&prov!==mp)await step('model',async()=>{const r=await setKey(name,'model.provider',String(mp));return r.ok?setKey(name,'model.default',String(md)):r});
  // agents may never stop or kill the gateway (they did once, mid-chat) or sign in through localhost; restarts go through the app
  const deny=pick(c,'approvals.deny')||[];if(DENY.some(x=>!deny.includes(x)))await step('guard',()=>setKey(name,'approvals.deny',[...new Set([...deny,...DENY])]));
  // every agent can reach outside apps through Composio (one sign-in per agent, no app to create)
  if(!Object.values(pick(c,'mcp_servers')||{}).some(v=>/connect.composio.dev/.test(v?.url||'')))
   await step('composio',()=>setKey(name,'mcp_servers.composio',{url:'https://connect.composio.dev/mcp',enabled:true,auth:'oauth',oauth:{redirect_uri:(process.env.PUBLIC_URL||'https://ai.elkiya.com').replace(/\/$/,'')+'/mcp-oauth/api/mcp/oauth/callback/composio'}}));
  const st=(await getStatus())[name]||{};
  // quiet channels: no "steered / queued / redirected" echoes, warning pings, "still working" heartbeats or
  // "gateway restarted" messages. Only settings nobody has chosen yet, so a later choice stays.
  for(const [k,v] of QUIET)if(pick(c,k)===undefined)await step(k,()=>setKey(name,k,String(v)));
  for(const pl of Object.keys(pick(c,'platforms')||{}))if(pick(c,'platforms.'+pl+'.gateway_restart_notification')===undefined&&!/^(webhook|api_server)$/.test(pl))
   await step('quiet '+pl,()=>setKey(name,'platforms.'+pl+'.gateway_restart_notification','false'));
  if(!st.defaults){const before=failed.length;
   for(const k of FROM_MAIN){const v=pick(main,k);if(v===undefined||v===null||v==='')continue;if(JSON.stringify(pick(c,k))===JSON.stringify(v))continue;await step(k,()=>setKey(name,k,typeof v==='object'?v:String(v)))}
   // pictures: the main agent's image maker, when this agent is signed in to it
   const img=pick(main,'image_gen.provider');
   if(img&&!pick(c,'image_gen.provider')){const signed=await fetch(GATE+'/p/'+encodeURIComponent(name)+'/api/model/options',{headers:{authorization:'Bearer '+(KEY||'')},signal:AbortSignal.timeout(20000)}).then(r=>r.json()).then(j=>(j.providers||[]).some(p=>p.slug===img&&p.authenticated)).catch(()=>false);
    if(signed)await step('image maker',()=>setKey(name,'image_gen.provider',String(img)))}
   if(failed.length===before)await setStatus(name,{defaults:Date.now()})}
  // deleted while it was being set up: nothing to report
  if(!await access(path.join(dir,'config.yaml')).then(()=>1,()=>0)){await setStatus(name,null);return {ok:false,gone:true,done,failed}}
  await setStatus(name,{t:Date.now(),ok:!failed.length,failed});
  if(failed.length)console.warn('setup',name,'failed:',failed.join(' | '));else if(done.length)console.log('setup',name,'done:',done.join(', '));
  return {ok:!failed.length,done,failed}}
 export_setups.running=()=>setups.size;export_setups.wait=n=>setups.get(n)||Promise.resolve();

 setupAgentFn=setupAgent;
 accountHooks.giveSkills=giveSkills;accountHooks.trimSkills=trimSkills;accountHooks.forgetSkills=forgetSkills;
 // a provider going away (Google AI Pro signed out): the agent's first priority entry it can really use; null when none
 accountHooks.moveOff=async(profile,key)=>{const d=await load();for(const e of d.priority||[]){if(e.key===key)continue;
  if(e.key.startsWith(PLUGIN_KEY)){const a=all(d).find(x=>x.id===e.key.slice(PLUGIN_KEY.length));if(!a||!(await details(a)).signedIn)continue}
  try{await useEntry(d,profile,e,'Google AI Pro signed out');return e.key}catch(er){console.warn('move off',profile,e.key,er.message)}}return null};
 /* ---------- Code: a run for an agent uses the account that agent is on here ----------
    Claude: the account's folder (main: Claude's default place, so no folder). Another provider: its name only; Code
    has no way to use the engine's own sign-in for it (see codeRoute's caller in server.mjs). */
 async function codeRoute(profile){const d=await load();const r=await agentRoute(profile),e=await entryOf(d,profile);
  if(e.startsWith(PLUGIN_KEY)){const as=all(d),a=as.find(x=>x.id===e.slice(PLUGIN_KEY.length))||as[0];   // a removed account's old choice is the main one, as for the engine
   return {provider:'claude',engine:PLUGIN,model:isClaude(r.model)?r.model:'',account:{key:PLUGIN_KEY+a.id,label:a.label,kind:'claude'},main:a.id==='main',configDir:a.id==='main'?null:a.dir}}
  const slug=e.slice(2),pv=(await providers(false,profile)||[]).find(x=>x.slug===slug);
  return {provider:slug==='openai-codex'?'codex':/^gemini/.test(slug)?'gemini':'',engine:slug,model:r.model,account:{key:e,label:pv?.name||slug,kind:'provider'}}}

 /* ---------- Code's own old sign-ins (<Code>/data/accounts-claude and data/accounts, one folder per profile) ----------
    Code on the AI box now runs on the agents' accounts from here, so the profiles it signed in to itself are listed on
    the Models page to move in or remove. A Claude profile folder is a CLAUDE_CONFIG_DIR, the same layout as an account
    here, so it can be moved in. A Codex profile is a CODEX_HOME, which the engine's ChatGPT sign-in does not read, so
    it can only be removed. Code's "desktop" profile is the default ~/.claude or ~/.codex this box shares: never listed. */
 const CODE_DATA=path.join(codeRoot,'data'),OLD={claude:'accounts-claude',codex:'accounts'},OLD_ID=/^[0-9a-f-]{36}$/;
 const oldFile=k=>path.join(CODE_DATA,OLD[k],'profiles.json');
 const readOld=async k=>{try{return JSON.parse(await readFile(oldFile(k),'utf8'))}catch{return null}};
 // Code reads this file again before each change of its own, so a profile taken out here stays out
 async function dropOld(k,id){const s=await readOld(k);if(!s)return;s.profiles=(s.profiles||[]).filter(p=>p.id!==id);if(s.active===id)s.active='desktop';const t=oldFile(k)+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(s,null,2));await rename(t,oldFile(k))}
 async function oldCode(){const out=[];for(const k of Object.keys(OLD)){const s=await readOld(k);for(const p of s?.profiles||[]){if(p.id==='desktop'||!OLD_ID.test(p.id))continue;const dir=path.join(CODE_DATA,OLD[k],p.id);if(!await access(dir).then(()=>1,()=>0))continue;
   const v={provider:k,id:p.id,label:String(p.label||'Code account').slice(0,60),active:s.active===p.id,signedIn:false,email:''};
   if(k==='claude'){const st=await run(CLAUDE,['auth','status'],{CLAUDE_CONFIG_DIR:dir},20000);try{const j=JSON.parse(st.out);v.signedIn=!!j.loggedIn;v.email=j.email||''}catch{}}
   else v.signedIn=await access(path.join(dir,'auth.json')).then(()=>true,()=>false);
   out.push(v)}}return out}
 async function importOld(id){if(!OLD_ID.test(id))throw new Error('Unknown sign-in');const p=((await readOld('claude'))?.profiles||[]).find(x=>x.id===id);if(!p)throw new Error('That Code sign-in is not there any more.');
  const src=path.join(CODE_DATA,OLD.claude,id),label=String(p.label||'Code account').slice(0,60),d=await load();const slug=(label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'account').slice(0,24);
  let nid='code-'+slug,n=2;while(all(d).some(a=>a.id===nid)||logins.has(nid)||await access(path.join(ACCOUNTS_DIR,nid)).then(()=>true,()=>false))nid='code-'+slug+'-'+n++;
  const dir=path.join(ACCOUNTS_DIR,nid);await mkdir(ACCOUNTS_DIR,{recursive:true,mode:0o700});
  // moved, not copied: two copies of one sign-in would each refresh it and sign the other out
  try{await rename(src,dir)}catch(e){if(e.code!=='EXDEV')throw e;await cp(src,dir,{recursive:true});await rm(src,{recursive:true,force:true})}
  await update(x=>{if(!x.accounts.some(a=>a.id===nid))x.accounts.push({id:nid,label,dir})});await dropOld('claude',id);cache.drop(nid);return {id:nid,label}}
 async function removeOld(k,id){if(!OLD[k]||!OLD_ID.test(id))throw new Error('Unknown sign-in');await dropOld(k,id);await rm(path.join(CODE_DATA,OLD[k],id),{recursive:true,force:true})}

 // see: which agents this person may see (others' private agents are left out of route, assign and events, and can't be moved)
 return Object.assign(async function handle(req,res,p,send,readBody,see=()=>true){
  // Code's old sign-ins (admins only, checked in server.mjs); removing asks the person first on the page
  if(p==='/ui/accounts/old-code'&&req.method==='GET')return send(res,200,{signins:await oldCode()});
  if(p==='/ui/accounts/old-code/import'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await importOld(String(b.id||'')))}catch(e){return send(res,400,{error:e.message})}}
  {const m=/^\/ui\/accounts\/old-code\/(claude|codex)\/([0-9a-f-]{36})$/.exec(p);if(m&&req.method==='DELETE'){try{await removeOld(m[1],m[2]);return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
   if(p.startsWith('/ui/accounts/old-code'))return send(res,404,{error:'Not found'})}
  if(p==='/ui/accounts/setup-agent'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=String(b.name||'');
   // a new agent starts with every skill the main agent has (once, here: skills removed later stay removed)
   if(!b.noSkills&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(n)&&n!=='default')await giveSkills(n).catch(e=>console.warn('skills for',n,e.message));
   try{const r=await setupAgent(n);accountHooks.afterSetup?.(n);return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
  const d=await load();
  if(p==='/ui/accounts'&&req.method==='GET'){const fresh=new URL(req.url,'http://x').searchParams.has('fresh');const list=await Promise.all(all(d).map(a=>details(a,fresh,true)));
   const ag=(await agents()).filter(see);const pv=await providers(fresh),prov=pv||[];
   // what is signed out right now, from what this read already has (the banner and the card's Reconnect)
   await note(Object.fromEntries(list.map(v=>[v.id,v])),pv).catch(e=>console.warn('signed-out note',e.message));const route=Object.fromEntries(await Promise.all(ag.map(async n=>[n,{entry:await entryOf(d,n),...await agentRoute(n)}])));
   return send(res,200,{accounts:list,providers:prov,priority:d.priority||[],labels:d.labels||{},route,assign:Object.fromEntries(ag.map(n=>[n,d.assign[n]||'main'])),auto:d.auto||{on:false,threshold:90},events:(d.events||[]).filter(e=>see(e.profile)),signedOut:await signedOut()})}
  if(p==='/ui/accounts/priority'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
   const pr=(Array.isArray(b.priority)?b.priority:[]).filter(e=>e&&typeof e.key==='string'&&/^(claude:[a-z0-9-]+|p:[a-z0-9_.-]+)$/.test(e.key)).slice(0,20).map(e=>({key:e.key,model:String(e.model||'').slice(0,120)}));
   d.priority=pr;await update(x=>{x.priority=pr});autoTick().catch(()=>{});return send(res,200,{priority:d.priority})}
  if(p==='/ui/accounts/use'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const profile=String(b.profile||'');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile))return send(res,400,{error:'Bad agent name'});if(!see(profile))return send(res,403,{error:'This agent is private to its owner.'});
   try{await useEntry(d,profile,{key:String(b.key||''),model:String(b.model||'')},'Chosen by hand');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
  if(p==='/ui/accounts'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await startLogin(b.label))}catch(e){return send(res,500,{error:e.message})}}
  if(p==='/ui/accounts/assign'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}if(!see(String(b.profile||'')))return send(res,403,{error:'This agent is private to its owner.'});try{await assign(d,String(b.profile||''),String(b.account||''),b.why||'');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
  if(p==='/ui/accounts/auto'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const au={on:!!b.on,threshold:Math.min(99,Math.max(50,Number(b.threshold)||90))};d.auto=au;await update(x=>{x.auto=au});autoTick().catch(()=>{});return send(res,200,d.auto)}
  // a provider's own name here (a Claude account is renamed with PATCH below): an empty name goes back to the provider's
  if(p==='/ui/accounts/label'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=String(b.key||'');if(!/^p:[a-z0-9_.-]+$/.test(k))return send(res,400,{error:'Unknown account'});
   const l=String(b.label||'').trim().slice(0,60);await update(x=>{x.labels||={};if(l)x.labels[k]=l;else delete x.labels[k]});return send(res,200,{ok:true})}
  // a provider that signed out and is not coming back: its card and banner go (signing in again brings it back)
  if(p==='/ui/accounts/forget'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=String(b.key||'');if(!/^p:[a-z0-9_.-]+$/.test(k))return send(res,400,{error:'Unknown account'});
   await forget(k);await update(x=>{if(x.labels)delete x.labels[k];if(x.priority)x.priority=x.priority.filter(e=>e.key!==k)});return send(res,200,{ok:true})}
  let m=/^\/ui\/accounts\/([a-z0-9-]+)\/code$/.exec(p);if(m&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}try{return send(res,200,await sendCode(m[1],b.code))}catch(e){return send(res,400,{error:e.message})}}
  // Reconnect (admins only, checked in server.mjs too): the same sign-in for an account that is there already
  m=/^\/ui\/accounts\/([a-z0-9-]+)\/reconnect$/.exec(p);if(m&&req.method==='POST'){try{return send(res,200,await reconnect(m[1]))}catch(e){return send(res,400,{error:e.message})}}
  m=/^\/ui\/accounts\/([a-z0-9-]+)\/login$/.exec(p);if(m&&req.method==='GET')return send(res,200,loginState(m[1]));
  // a reconnect's folder is the account's own: only a new account's half-made folder is removed (the copy goes back by itself)
  m=/^\/ui\/accounts\/([a-z0-9-]+)\/cancel$/.exec(p);if(m&&req.method==='POST'){const s=logins.get(m[1]);if(s?.state==='running'){s.child.kill();s.state='failed'}if(!s?.reconnect&&!all(d).some(a=>a.id===m[1]))await rm(path.join(ACCOUNTS_DIR,m[1]),{recursive:true,force:true});return send(res,200,{ok:true})}
  m=/^\/ui\/accounts\/([a-z0-9-]+)$/.exec(p);
  if(m&&req.method==='DELETE'){const id=m[1];if(id==='main')return send(res,400,{error:'The main account can’t be removed.'});const a=d.accounts.find(x=>x.id===id);if(!a)return send(res,404,{error:'Not found'});
   // only agents that still exist count: a deleted agent's old choice is dropped
   const live=new Set(await agents());if(Object.entries(d.assign).some(([n,v])=>v===id&&live.has(n)))return send(res,409,{error:'An agent still uses this account. Move it to another account first.'});
   await update(x=>{for(const n of Object.keys(x.assign||{}))if(!live.has(n))delete x.assign[n]});
   await run(CLAUDE,['auth','logout'],{CLAUDE_CONFIG_DIR:a.dir},20000);await rm(a.dir,{recursive:true,force:true});await update(x=>{x.accounts=x.accounts.filter(y=>y.id!==id)});cache.drop(id);return send(res,200,{ok:true})}
  if(m&&req.method==='PATCH'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const id=m[1];await update(x=>{const a=x.accounts.find(y=>y.id===id);if(id==='main')x.mainLabel=String(b.label||'').slice(0,60);else if(a)a.label=String(b.label||a.label).slice(0,60)});cache.drop(m[1]);return send(res,200,{ok:true})}
  send(res,404,{error:'Not found'});
 },{codeRoute,signedOut,forget});
}
