// Claude accounts for aqeelOS: several Claude subscriptions side by side, live plan usage, which agent uses
// which account, and optional automatic switching when an account runs low.
// Each account is its own Claude Code config folder (CLAUDE_CONFIG_DIR); the main one is ~/.claude.
// Hermes' Claude plugin is pointed at an account per agent with its `claude_config_dir` setting.
import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,rm,readdir,cp,appendFile,access,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {hermes as hq,setKey,readConfig,pick,editEnv,agentNames,setStatus,getStatus,LIVE_APP} from './agentops.mjs';

const HOME=homedir();
const CLAUDE=process.env.CLAUDE_BIN||path.join(HOME,'.local','bin','claude');
const HERMES=process.env.HERMES_BIN||path.join(HOME,'.local','bin','hermes');
const HERMES_HOME=process.env.HERMES_HOME||path.join(HOME,'.hermes');
const PLUGIN='claude-subscription-directsdk-experimental';
const SETTING=`plugins.entries.${PLUGIN}.settings.claude_config_dir`;
const ACCOUNTS_DIR=path.join(HOME,'.claude-accounts');
const MAIN={id:'main',label:'Main account',dir:path.join(HOME,'.claude')};

// Set up a brand-new agent (plugin, model, gateway key); server.mjs also calls it for agents members create.
export let setupAgentFn=null;
export const export_setups={running:()=>0,wait:()=>Promise.resolve()};   // setups in progress, counted by /healthz so a deploy waits for them
export function createAccounts(DATA){
 const FILE=path.join(DATA,'accounts.json');
 const load=async()=>{try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {accounts:[],assign:{},auto:{on:false,threshold:90},events:[]}}};
 const save=async d=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(d,null,1));await rename(FILE+'.tmp',FILE)};
 const all=d=>[{...MAIN,label:d.mainLabel||MAIN.label},...d.accounts.filter(a=>a.id!=='main')];
 const run=(cmd,args,env={},timeout=30000)=>new Promise(res=>execFile(cmd,args,{env:{...process.env,...env},timeout,maxBuffer:4e6},(err,stdout,stderr)=>res({ok:!err,out:String(stdout||''),err:String(stderr||err?.message||'')})));

 /* ---------- account details (cached briefly) ---------- */
 const cache=new Map();
 async function details(a,fresh){
  const hit=cache.get(a.id);if(hit&&!fresh&&Date.now()-hit.t<60000)return hit.v;
  const v={id:a.id,label:a.label,main:a.id==='main',signedIn:false};
  // The main account lives in Claude's default place (its email is kept in ~/.claude.json), so no CLAUDE_CONFIG_DIR for it.
  const st=await run(CLAUDE,['auth','status'],a.id==='main'?{}:{CLAUDE_CONFIG_DIR:a.dir},20000);
  try{const j=JSON.parse(st.out);Object.assign(v,{signedIn:!!j.loggedIn,email:j.email||'',org:j.orgName||'',plan:j.subscriptionType||''})}catch{}
  let creds=null;try{creds=JSON.parse(await readFile(path.join(a.dir,'.credentials.json'),'utf8')).claudeAiOauth}catch{}
  if(creds){v.plan=v.plan||creds.subscriptionType||'';v.tier=creds.rateLimitTier||'';v.tokenExpires=creds.expiresAt||null}
  if(v.signedIn&&creds?.accessToken){
   try{const r=await fetch('https://api.anthropic.com/api/oauth/usage',{headers:{authorization:'Bearer '+creds.accessToken,'anthropic-beta':'oauth-2025-04-20',accept:'application/json','user-agent':'claude-code/2.1.0'},signal:AbortSignal.timeout(15000)});
    if(r.ok){const u=await r.json();const win=k=>u[k]?{used:Math.round(Number(u[k].utilization)||0),resets:u[k].resets_at||null}:null;
     v.usage={session:win('five_hour'),week:win('seven_day'),opus:win('seven_day_opus'),sonnet:win('seven_day_sonnet')};
     const ex=u.extra_usage;if(ex?.is_enabled)v.extra={used:ex.used_credits,limit:ex.monthly_limit,currency:ex.currency||'USD'}}
    else v.usageError=r.status===401?'Sign-in expired. It refreshes the next time this account is used.':'Usage unavailable ('+r.status+')'}
   catch{v.usageError='Could not reach Anthropic.'}
  }
  cache.set(a.id,{t:Date.now(),v});return v;
 }
 const headroom=v=>v?.usage?100-Math.max(v.usage.session?.used||0,v.usage.week?.used||0):-1;

 /* ---------- which agent uses which account ---------- */
 const agents=()=>agentNames();
 async function assign(d,profile,accountId,why){
  const a=all(d).find(x=>x.id===accountId);if(!a)throw new Error('Unknown account');
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile))throw new Error('Bad agent name');
  // Main account: an empty setting falls back to Claude's default sign-in.
  const r=await hq(profile,['config','set',SETTING,a.id==='main'?'':a.dir]);
  if(!r.ok)throw new Error('The engine did not accept the change: '+(r.err||r.out).slice(0,200));
  d.assign[profile]=a.id;if(why)d.events.unshift({t:Date.now(),profile,to:a.id,why});d.events=d.events.slice(0,50);await save(d);
 }

 /* ---------- adding an account: claude auth login in its own folder ---------- */
 const logins=new Map(); // id → {child,out,state}
 async function startLogin(label){
  const d=await load();const slug=(String(label||'account').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'account').slice(0,32);
  let id=slug,n=2;while(all(d).some(a=>a.id===id))id=slug+'-'+n++;
  const dir=path.join(ACCOUNTS_DIR,id);await mkdir(dir,{recursive:true,mode:0o700});
  const child=spawn(CLAUDE,['auth','login'],{env:{...process.env,CLAUDE_CONFIG_DIR:dir,BROWSER:'true'},stdio:['pipe','pipe','pipe']});
  const s={child,out:'',state:'running',dir,label:String(label||id).slice(0,60)};logins.set(id,s);
  const add=b=>{s.out=(s.out+String(b).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')).slice(-8000)};child.stdout.on('data',add);child.stderr.on('data',add);
  child.on('close',async code=>{try{s.state=code===0?'done':'failed';if(code===0){const d2=await load();if(!d2.accounts.some(a=>a.id===id))d2.accounts.push({id,label:s.label,dir});await save(d2);cache.delete(id)}}catch(e){s.state='failed';console.warn('account sign-in',e.message)}});
  setTimeout(()=>{if(s.state==='running'){s.state='failed';child.kill()}},10*60000).unref();
  for(let i=0;i<40&&!/https:\/\/\S+/.test(s.out);i++)await new Promise(r=>setTimeout(r,250));
  return {id,url:(/https:\/\/\S+/.exec(s.out)||[])[0]||null,state:s.state};
 }
 async function sendCode(id,code){const s=logins.get(id);if(!s||s.state!=='running')throw new Error('This sign-in is not running any more. Start again.');
  if(typeof code!=='string'||!code.trim()||code.length>4096)throw new Error('Paste the code from the sign-in page.');
  s.child.stdin.write(code.trim()+'\n');for(let i=0;i<60&&s.state==='running';i++)await new Promise(r=>setTimeout(r,500));
  if(s.state==='running')return {state:'running',hint:/invalid/i.test(s.out)?'That code was not accepted. Copy the whole code and try again.':'Still checking…'};
  return {state:s.state,hint:s.state==='done'?'Signed in.':'Sign-in failed: '+(s.out.split('\n').filter(Boolean).slice(-2).join(' ')||'try again')}}

 /* ---------- every other signed-in provider (ChatGPT, OpenRouter…) with the limits Hermes reports ---------- */
 const GATE=process.env.HERMES_API||'http://127.0.0.1:8642';
 const SKIP=/^(nous|anthropic|custom)$|claude-subscription/;
 let provCache={t:0,v:[]};
 async function providers(fresh){if(!fresh&&Date.now()-provCache.t<60000)return provCache.v;
  try{const r=await fetch(GATE+'/api/model/options',{headers:{authorization:'Bearer '+(process.env.API_SERVER_KEY||'')},signal:AbortSignal.timeout(20000)});const j=await r.json();
   const gem=await stat(path.join(homedir(),'.gemini','oauth_creds.json')).then(()=>true,()=>false);
   provCache={t:Date.now(),v:(j.providers||[]).filter(p=>p.authenticated&&!SKIP.test(p.slug)&&p.slug!=='gemini-subscription'&&(gem||true)).map(p=>({slug:p.slug,name:p.name,models:p.models||[],
    windows:(p.usage?.windows||[]).map(w=>({label:w.label,used:Math.round(Number(w.used_percent)||0),resets:w.resets_at||null,scope:w.scope||'account'})),details:p.usage?.details||[]}))}}catch{}
  return provCache.v}
 const worstOf=ws=>Math.max(0,...(ws||[]).filter(w=>w.scope!=='model').map(w=>w.used||0));

 /* ---------- priority: the order accounts are used in, across providers ----------
    Entries: {key:'claude:<account id>'|'p:<provider slug>', model}. An agent moves down the list
    when its current entry passes the threshold. */
 const PLUGIN_KEY='claude:';
 async function agentRoute(profile){const dir=profile==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',profile);const y=await readFile(path.join(dir,'config.yaml'),'utf8').catch(()=>'');
  const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}}
 async function entryOf(d,profile){const r=await agentRoute(profile);return r.provider===PLUGIN||!r.provider?PLUGIN_KEY+(d.assign[profile]||'main'):'p:'+r.provider}
 async function useEntry(d,profile,e,why){
  if(e.key.startsWith(PLUGIN_KEY)){await assign(d,profile,e.key.slice(PLUGIN_KEY.length),why);await setKey(profile,'model.provider',PLUGIN);}
  else{// only switch an agent to a provider THAT agent is signed in to (sign-ins are per agent)
   const slug=e.key.slice(2);const ok=await fetch(GATE+(profile==='default'?'':'/p/'+encodeURIComponent(profile))+'/api/model/options',{headers:{authorization:'Bearer '+(process.env.API_SERVER_KEY||'')},signal:AbortSignal.timeout(20000)}).then(r=>r.json()).then(j=>(j.providers||[]).some(p=>p.slug===slug&&p.authenticated)).catch(()=>false);
   if(!ok)throw new Error(profile+' is not signed in to '+slug+'; sign in on that agent first');
   const r=await setKey(profile,'model.provider',slug);if(!r.ok)throw new Error('The engine did not accept the change');
   d.events.unshift({t:Date.now(),profile,to:e.key,why:why||''});d.events=d.events.slice(0,50);await save(d)}
  if(e.model)await setKey(profile,'model.default',e.model);
 }
 async function usageOf(d,key,det,prov){if(key.startsWith(PLUGIN_KEY)){const v=det[key.slice(PLUGIN_KEY.length)];return v?.signedIn?(v.usage?Math.max(v.usage.session?.used||0,v.usage.week?.used||0):0):null}
  const p=prov.find(x=>x.slug===key.slice(2));return p?worstOf(p.windows):null}

 /* ---------- auto-switch: move agents off an account that is nearly used up ---------- */
 async function autoTick(){const d=await load();if(!d.auto?.on)return;const th=Number(d.auto.threshold)||90;const accts=all(d);
  const det=Object.fromEntries(await Promise.all(accts.map(async a=>[a.id,await details(a)])));
  if((d.priority||[]).length){const prov=await providers();
   for(const profile of await agents()){const cur=await entryOf(d,profile);const used=await usageOf(d,cur,det,prov);if(used!==null&&used<th)continue;
    for(const e of d.priority){if(e.key===cur)continue;const u=await usageOf(d,e.key,det,prov);if(u===null||u>=th)continue;
     await useEntry(d,profile,e,used===null?'Previous account not available':`Reached ${used}%`).catch(er=>console.warn('auto-switch',er.message));break}}
   return}
  for(const profile of await agents()){const cur=d.assign[profile]||'main';const v=det[cur];if(!v?.usage)continue;
   const worst=Math.max(v.usage.session?.used||0,v.usage.week?.used||0);if(worst<th)continue;
   const best=accts.filter(a=>a.id!==cur&&det[a.id]?.signedIn&&det[a.id]?.usage).sort((x,y)=>headroom(det[y.id])-headroom(det[x.id]))[0];
   if(best&&headroom(det[best.id])>100-th)await assign(d,profile,best.id,`${v.label||cur} reached ${worst}%`).catch(e=>console.warn('auto-switch',e.message))}}
 if(LIVE_APP)setInterval(()=>autoTick().catch(()=>{}),5*60000).unref();   // a test copy never switches real agents

 /* ---------- HTTP ---------- */
 /* ---------- a new agent gets everything it needs, checked step by step (any model provider) ----------
    One setup per agent at a time (a second call joins the running one). Each step is skipped when already
    right, so the health check can run it again and again; what failed is kept and shown on the Agents page. */
 const DENY=['*gateway stop*','*gateway restart*','*kill-session -t gateway*','*pkill*hermes*','*killall*hermes*','*pkill*gateway*','*kill*bridge.js*','*pkill*node*','*mcp login*','*localhost:3118*','*127.0.0.1:3118*'];
 // the main agent's working settings every agent starts with (copied once; changes made later on that agent stay)
 const QUIET=[['display.busy_ack_enabled',false],['display.busy_steer_ack_enabled',false],['display.busy_ack_detail',false],['display.suppress_warning_notifications',true],['display.long_running_notifications',false]];
 const FROM_MAIN=['timezone','browser.headed','browser.inactivity_timeout','agent.max_turns','agent.reasoning_effort'];
 const setups=new Map();
 // copy each skill folder the agent does not have yet from the main agent (never overwrites its own)
 async function giveSkills(name){const from=path.join(HERMES_HOME,'skills'),to=path.join(HERMES_HOME,'profiles',name,'skills');let n=0;
  await access(path.join(HERMES_HOME,'profiles',name,'config.yaml'));
  for(const cat of await readdir(from,{withFileTypes:true}).catch(()=>[])){if(!cat.isDirectory()||cat.name.startsWith('.'))continue;
   for(const sk of await readdir(path.join(from,cat.name),{withFileTypes:true}).catch(()=>[])){if(!sk.isDirectory())continue;const src=path.join(from,cat.name,sk.name),dst=path.join(to,cat.name,sk.name);
    if(await access(path.join(src,'SKILL.md')).then(()=>false,()=>true))continue;if(await access(dst).then(()=>true,()=>false))continue;
    await mkdir(path.dirname(dst),{recursive:true});await cp(src,dst,{recursive:true});n++}}
  if(n)console.log('gave',n,'skills to',name);return n}
 function setupAgent(name){if(!setups.has(name))setups.set(name,doSetup(name).finally(()=>setups.delete(name)));return setups.get(name)}
 async function doSetup(name){
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)||name==='default')throw new Error('Unknown agent');
  const dir=path.join(HERMES_HOME,'profiles',name);await access(path.join(dir,'config.yaml'));const done=[],failed=[];
  const step=async(label,fn)=>{try{const r=await fn();if(r&&r.ok===false)throw new Error(r.err||'failed');done.push(label)}catch(e){failed.push(label+': '+String(e.message).slice(0,200))}};
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
 return async function handle(req,res,p,send,readBody){
  if(p==='/ui/accounts/setup-agent'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=String(b.name||'');
   // a new agent starts with every skill the main agent has (once, here: skills removed later stay removed)
   if(!b.noSkills&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(n)&&n!=='default')await giveSkills(n).catch(e=>console.warn('skills for',n,e.message));
   try{return send(res,200,await setupAgent(n))}catch(e){return send(res,400,{error:e.message})}}
  const d=await load();
  if(p==='/ui/accounts'&&req.method==='GET'){const fresh=new URL(req.url,'http://x').searchParams.has('fresh');const list=await Promise.all(all(d).map(a=>details(a,fresh)));
   const ag=await agents();const prov=await providers(fresh);const route=Object.fromEntries(await Promise.all(ag.map(async n=>[n,{entry:await entryOf(d,n),...await agentRoute(n)}])));
   return send(res,200,{accounts:list,providers:prov,priority:d.priority||[],route,assign:Object.fromEntries(ag.map(n=>[n,d.assign[n]||'main'])),auto:d.auto||{on:false,threshold:90},events:d.events||[]})}
  if(p==='/ui/accounts/priority'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
   d.priority=(Array.isArray(b.priority)?b.priority:[]).filter(e=>e&&typeof e.key==='string'&&/^(claude:[a-z0-9-]+|p:[a-z0-9_.-]+)$/.test(e.key)).slice(0,20).map(e=>({key:e.key,model:String(e.model||'').slice(0,120)}));
   await save(d);autoTick().catch(()=>{});return send(res,200,{priority:d.priority})}
  if(p==='/ui/accounts/use'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const profile=String(b.profile||'');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile))return send(res,400,{error:'Bad agent name'});
   try{await useEntry(d,profile,{key:String(b.key||''),model:String(b.model||'')},'Chosen by hand');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
  if(p==='/ui/accounts'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,await startLogin(b.label))}
  if(p==='/ui/accounts/assign'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{await assign(d,String(b.profile||''),String(b.account||''),b.why||'');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
  if(p==='/ui/accounts/auto'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}d.auto={on:!!b.on,threshold:Math.min(99,Math.max(50,Number(b.threshold)||90))};await save(d);autoTick().catch(()=>{});return send(res,200,d.auto)}
  let m=/^\/ui\/accounts\/([a-z0-9-]+)\/code$/.exec(p);if(m&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}try{return send(res,200,await sendCode(m[1],b.code))}catch(e){return send(res,400,{error:e.message})}}
  m=/^\/ui\/accounts\/([a-z0-9-]+)\/cancel$/.exec(p);if(m&&req.method==='POST'){const s=logins.get(m[1]);if(s?.state==='running'){s.child.kill();s.state='failed'}if(!d.accounts.some(a=>a.id===m[1]))await rm(path.join(ACCOUNTS_DIR,m[1]),{recursive:true,force:true});return send(res,200,{ok:true})}
  m=/^\/ui\/accounts\/([a-z0-9-]+)$/.exec(p);
  if(m&&req.method==='DELETE'){const id=m[1];if(id==='main')return send(res,400,{error:'The main account can’t be removed.'});const a=d.accounts.find(x=>x.id===id);if(!a)return send(res,404,{error:'Not found'});
   if(Object.values(d.assign).includes(id))return send(res,409,{error:'An agent still uses this account. Move it to another account first.'});
   await run(CLAUDE,['auth','logout'],{CLAUDE_CONFIG_DIR:a.dir},20000);await rm(a.dir,{recursive:true,force:true});d.accounts=d.accounts.filter(x=>x.id!==id);await save(d);cache.delete(id);return send(res,200,{ok:true})}
  if(m&&req.method==='PATCH'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const a=d.accounts.find(x=>x.id===m[1]);if(m[1]==='main'){d.mainLabel=String(b.label||'').slice(0,60)}else if(a)a.label=String(b.label||a.label).slice(0,60);await save(d);cache.delete(m[1]);return send(res,200,{ok:true})}
  send(res,404,{error:'Not found'});
 };
}
