// aqeelOS — production server. Serves the UI, signs people in, and forwards
// /hapi/* to the Hermes dashboard API and /gapi/* to the Hermes gateway API.
// Hermes credentials stay on this server; the browser only ever holds a session cookie.
// No dependencies. Run: node app/server.mjs (configuration via environment, see README).
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat,writeFile,mkdir,unlink,rename,realpath,readlink,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createAccounts,setupAgentFn,export_setups,accountHooks} from './accounts.mjs';
import {createAgentDefaults} from './agent-defaults.mjs';
import {createGemini} from './gemini.mjs';
import {createAntigravity} from './antigravity.mjs';
import {withAgent,setKey,readConfig,pick,agentNames,isAgent,busy as opsBusy,initStatus,getStatus,setStatus,editEnv,hermes as hcmd,python as enginePython,LIVE_APP} from './agentops.mjs';
import {createSchedules} from './schedules.mjs';
import {createScreens} from './screens.mjs';
import {createUsers,UNSAFE_TOOLSETS} from './users.mjs';
import {createStarters} from './starters.mjs';
import {createMail} from './mail.mjs';
import {createUsage} from './usage.mjs';
import {createExplain} from './explain.mjs';
import {createChannels} from './channels.mjs';
import {createShare} from './share.mjs';
import {createRelay} from './relay.mjs';
import {boxMemory} from './boxmem.mjs';
import {createLinks,isLink} from './links.mjs';
import {createLocalBrowser} from './localbrowser.mjs';
import {createAccess} from './access.mjs';
import {createAccessRequests} from './access-requests.mjs';
import {startScreenFollow} from './screen-follow.mjs';
import {createN8n} from './n8n.mjs';
import {createCode} from './code.mjs';
import {createCodeOnline} from './code-online.mjs';
import {createBrand} from './brand.mjs';
import {createBottlenecks} from './bottlenecks.mjs';
import {createLive} from './live.mjs';
import {createBackups} from './backup.mjs';
import {readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {scryptSync,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const env=process.env;
// What differs per install (this one is ai.elkiya.com): set in the box's environment; these defaults are this install's.
const PUBLIC_URL=(env.PUBLIC_URL||'https://ai.elkiya.com').replace(/\/$/,''),N8N_URL=(env.N8N_URL||'https://n8n.elkiya.com').replace(/\/$/,'');
const PUBLIC_HOST=new URL(PUBLIC_URL).hostname,SSH_HOST=env.SSH_HOST||PUBLIC_HOST,SSH_PORT=+(env.SSH_PORT||2222);
// every log line starts with the time (UTC), so problems can be matched with the engine's own logs
if(process.argv[2]!=='hash')for(const k of ['log','warn','error']){const f=console[k].bind(console);console[k]=(...a)=>f(new Date().toISOString().slice(0,19).replace('T',' '),...a)}
const PORT=Number(env.UI_PORT)||4400;
const HOST=env.UI_HOST||'127.0.0.1';
const DASH=new URL(env.HERMES_DASH||'http://127.0.0.1:9119');
const GATE=new URL(env.HERMES_API||'http://127.0.0.1:8642');
const HOOKS=new URL(env.HERMES_WEBHOOKS||'http://127.0.0.1:8644');
const WA_CLOUD=new URL(env.HERMES_WA_CLOUD||'http://127.0.0.1:8090');   // the engine's WhatsApp Business listener
const DASH_TOKEN=env.HERMES_DASHBOARD_SESSION_TOKEN||'';
const API_KEY=env.API_SERVER_KEY||'';
const PW_HASH=env.UI_PASSWORD_HASH||'';            // "scrypt:<salt hex>:<hash hex>"
const SECRET=env.UI_SECRET||randomBytes(32).toString('hex');
const SECURE_COOKIE=env.UI_INSECURE_COOKIE!=='1';
const SESSION_DAYS=Number(env.UI_SESSION_DAYS)||30;
// Usage: node app/server.mjs hash <password>  → prints a value for UI_PASSWORD_HASH
if(process.argv[2]==='hash'){const salt=randomBytes(16);console.log('scrypt:'+salt.toString('hex')+':'+scryptSync(process.argv[3]||'',salt,64).toString('hex'));process.exit(0)}
if(!PW_HASH)console.warn('UI_PASSWORD_HASH is not set: nobody can sign in.');
if(!env.UI_SECRET)console.warn('UI_SECRET is not set: sessions end when the server restarts.');

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const security={'x-content-type-options':'nosniff','referrer-policy':'same-origin','permissions-policy':'camera=(), geolocation=()','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob: "+N8N_URL+" http://127.0.0.1:4321 http://localhost:4321 https://"+(env.CODE_HOST||'code.elkiya.com')+" https://"+(env.CODE_PREVIEW_HOST||'code-preview.elkiya.com')+"; frame-ancestors 'self' chrome-extension://jdfbikbihabglfkcckkmmfbmfdpifbgf; base-uri 'none'; form-action 'self'"};

/* ---------- sessions ---------- */
const sign=v=>createHmac('sha256',SECRET).update(v).digest('base64url');
// Cookie: <person id>.<expiry>.<random>.<signature>. Older 3-part cookies (from before People) are the owner's.
function makeCookie(uid='owner'){const exp=Date.now()+SESSION_DAYS*864e5;const v=uid+'.'+exp+'.'+randomBytes(9).toString('base64url');return v+'.'+sign(v)}
function cookieId(req){const m=/(?:^|;\s*)hui=([^;]+)/.exec(req.headers.cookie||'');if(!m)return null;const parts=m[1].split('.');
 let id,exp,v,sig;if(parts.length===3){[exp,,sig]=parts;id='owner';v=parts[0]+'.'+parts[1]}else if(parts.length===4){[id,exp,,sig]=parts;v=parts.slice(0,3).join('.')}else return null;
 const a=Buffer.from(sign(v)),b=Buffer.from(sig);if(!(a.length===b.length&&timingSafeEqual(a,b)&&Number(exp)>Date.now()))return null;
 // "Sign out everywhere": cookies issued before that moment no longer count
 const cut=revoked[id];if(cut&&Number(exp)-SESSION_DAYS*864e5<cut)return null;return id}
async function revokeSessions(uid){revoked[uid]=Date.now();const f=path.join(DATA,'session-revoke.json');await writeFile(f+'.tmp',JSON.stringify(revoked));await rename(f+'.tmp',f)}
const validCookie=req=>!!cookieId(req);
const cookieAttrs=max=>`Path=/; HttpOnly; SameSite=Strict; Max-Age=${max}${SECURE_COOKIE?'; Secure':''}`;
function checkPassword(pw){const [kind,salt,hash]=PW_HASH.split(':');if(kind!=='scrypt'||!salt||!hash)return false;const got=scryptSync(String(pw),Buffer.from(salt,'hex'),64);const want=Buffer.from(hash,'hex');return got.length===want.length&&timingSafeEqual(got,want)}

// 5 wrong passwords per address per 10 minutes, then a cool-down.
const attempts=new Map();
function clientIp(req){const cf=String(req.headers['cf-connecting-ip']||'').trim();if(cf)return cf;const l=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(Boolean);return l[l.length-1]||req.socket.remoteAddress||'?'}
function limited(ip){const now=Date.now(),a=(attempts.get(ip)||[]).filter(t=>now-t<600e3);if(a.length)attempts.set(ip,a);else attempts.delete(ip);if(attempts.size>5000)for(const k of [...attempts.keys()].slice(0,1000))attempts.delete(k);return a.length>=5}

/* ---------- helpers ---------- */
function send(res,status,body,headers={}){const data=typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body);res.writeHead(status,{'content-type':typeof body==='object'&&!Buffer.isBuffer(body)?'application/json; charset=utf-8':'text/plain; charset=utf-8','cache-control':'no-store',...security,...headers});res.end(data)}
async function readRaw(req,limit=1e6){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Error('too large');chunks.push(c)}return Buffer.concat(chunks)}
async function readBody(req,limit=1e6){return (await readRaw(req,limit)).toString('utf8')}

// transform(json) rewrites a JSON answer before it reaches the browser (used to keep people's chats apart);
// body is a request body that was already read (to check it) and must be sent on as is.
/* Live replies: a chat reply streams to the page that sent it, and a copy is kept here while it runs, so a
   refreshed page or a second tab on the same chat can pick it up (GET /ui/live). The reply keeps going on
   the engine when the page goes away. Copies are dropped two minutes after the reply ends. */
const LIVE=new Map();
const runOwner=new Map();   // run id → person, so Approve / Stop work as long as the run lives
function liveStart(key,user){const rec={user,chunks:[],size:0,subs:new Set(),done:false,t:Date.now(),last:Date.now()};LIVE.set(key,rec);return rec}
setInterval(()=>{for(const [k,r] of LIVE)if(!r.done&&!r.asking&&Date.now()-r.last>20*60e3){console.warn('live stream idle for 20 min, ending it:',k);liveEnd(k,r)}},60000).unref();
function liveEnd(key,rec){if(rec.done)return;rec.done=true;saveThinking(key,rec);for(const r of rec.subs)r.end();rec.subs.clear();setTimeout(()=>{if(LIVE.get(key)===rec)LIVE.delete(key)},120000)}
function proxy(req,res,target,prefix,authHeaders,{transform,body,live}={}){
 const url=new URL(req.url,'http://x');
 // /hapi/status → dashboard /api/status · /gapi/api/sessions → gateway /api/sessions
 const upstreamPath=(prefix==='/hapi'?'/api':'')+url.pathname.slice(prefix.length)+url.search;
 const headers={...req.headers};
 for(const h of ['cookie','host','authorization','x-hermes-session-token','origin','referer','x-forwarded-for','x-forwarded-proto','x-forwarded-host','x-hui'])delete headers[h];
 Object.assign(headers,authHeaders,{host:target.host});
 if(body!==undefined){delete headers['transfer-encoding'];headers['content-length']=String(body.length)}
 if(transform)delete headers['accept-encoding'];
 const up=httpRequest({hostname:target.hostname,port:target.port,path:upstreamPath,method:req.method,headers},r=>{
  const out={...r.headers};delete out['set-cookie'];delete out['content-security-policy'];
  if(String(r.headers['content-type']||'').includes('text/event-stream')){out['cache-control']='no-cache';out['x-accel-buffering']='no';res.socket?.setNoDelay(true)}
  if(transform&&String(r.headers['content-type']||'').includes('json')){const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',async()=>{let txt=Buffer.concat(chunks).toString('utf8');
    if((r.statusCode||500)<300){try{txt=JSON.stringify(await transform(JSON.parse(txt)))}catch{res.writeHead(502,{'content-type':'application/json',...security});return res.end('{"error":"Could not check what you may see. Try again."}')}}delete out['content-length'];delete out['content-encoding'];res.writeHead(r.statusCode||502,{...out,...security});res.end(txt)});return}
  if(live&&(r.statusCode||500)<300&&String(r.headers['content-type']||'').includes('text/event-stream')){
   const rec=liveStart(live.key,live.user);res.writeHead(r.statusCode,{...out,...security});
   r.on('data',c=>{rec.last=Date.now();rec.size+=c.length;rec.chunks.push(c);if(rec.size>8e6){const head=rec.chunks.slice(0,40);let tail=[],sz=0;for(let i=rec.chunks.length-1;i>=40&&sz<4e6;i--){tail.unshift(rec.chunks[i]);sz+=rec.chunks[i].length}rec.chunks=[...head,...tail];rec.size=rec.chunks.reduce((a,b)=>a+b.length,0)}{const t=c.toString('utf8');if(!rec.runId){const m=/"run_id"\s*:\s*"([^"]+)"/.exec(t);if(m){rec.runId=m[1];runOwner.set(m[1],{user:rec.user,t:Date.now()});if(runOwner.size>2000)for(const k of [...runOwner.keys()].slice(0,500))runOwner.delete(k)}}if(/approval\.request/.test(t))rec.asking=true;if(/approval\.responded/.test(t))rec.asking=false}if(!res.writableEnded&&!res.destroyed)res.write(c);for(const sub of rec.subs)sub.write(c)});
   r.on('end',()=>{liveEnd(live.key,rec);if(!res.writableEnded)res.end()});r.on('error',()=>{liveEnd(live.key,rec);res.end()});live.started=true;return}
  res.writeHead(r.statusCode||502,{...out,...security});r.pipe(res);
 });
 up.on('error',e=>{if(!res.headersSent)send(res,502,{error:'The aqeelOS engine is not reachable',detail:e.code||e.message});else res.end()});
 req.on('aborted',()=>{if(!live?.started)up.destroy()});res.on('close',()=>{if(!res.writableEnded&&!live?.started)up.destroy()});
 if(body!==undefined)up.end(body);else req.pipe(up);
}

async function serveFile(res,rel){
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||/\.(mjs|env|md)$|[\\/]\./i.test(rel))return send(res,404,'Not found');
 try{const st=await stat(file);if(!st.isFile())throw 0;const body=await readFile(file);const ext=path.extname(file);
  const etag='"'+st.size.toString(36)+'-'+Math.round(st.mtimeMs).toString(36)+'"';if(res.req?.headers?.['if-none-match']===etag){res.writeHead(304,{etag,'cache-control':'no-cache'});return res.end()}
  res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.woff2'||ext==='.svg'||ext==='.png'?'public, max-age=86400':'no-cache',etag,...security});res.end(body)}
 catch{send(res,404,'Not found')}
}

/* ---------- agent identities (name, title, picture) ----------
   Hermes has no avatars and its default profile can't be renamed, so the UI keeps identities itself,
   outside the app folder so deploys never touch them. The name is also written to Hermes'
   profile.yaml (display_name) so Hermes' own tools show it too. */
const DATA=path.resolve(env.UI_DATA_DIR||path.join(root,'..','hermes-ui-data'));initStatus(DATA);
let revoked={};readFile(path.join(DATA,'session-revoke.json'),'utf8').then(t=>{revoked=JSON.parse(t)||{}}).catch(()=>{});
const HERMES_HOME=env.HERMES_HOME||path.join(homedir(),'.hermes');
const IDS=path.join(DATA,'identities.json');
const okProfile=n=>/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(n);
async function readIds(){try{return JSON.parse(await readFile(IDS,'utf8'))}catch{return {}}}
async function writeIds(ids){await mkdir(DATA,{recursive:true});await writeFile(IDS+'.tmp',JSON.stringify(ids,null,1));await rename(IDS+'.tmp',IDS)}
async function setDisplayName(profile,name){
 const dir=profile==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',profile);const f=path.join(dir,'profile.yaml');
 let y='';try{y=await readFile(f,'utf8')}catch{}
 const line='display_name: '+JSON.stringify(String(name||''));
 y=/^display_name:.*$/m.test(y)?y.replace(/^display_name:.*$/m,line):(y&&!y.endsWith('\n')?y+'\n':y)+line+'\n';
 try{await writeFile(f,y)}catch(e){console.warn('profile.yaml not written:',e.message)}
}
const IMG={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
async function identities(req,res,p){
 if(p==='/ui/identities'&&req.method==='GET')return send(res,200,await readIds());
 const m=/^\/ui\/(identities|avatar)\/([^/]+)$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
 const profile=decodeURIComponent(m[2]);if(!okProfile(profile))return send(res,400,{error:'Bad profile name'});
 const ids=await readIds();const cur=ids[profile]||{};
 if(m[1]==='identities'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad JSON'})}
  const name=String(b.name||'').trim().slice(0,60),title=String(b.title||'').trim().slice(0,80);
  ids[profile]={...cur,name,title,updated:Date.now()};await writeIds(ids);await setDisplayName(profile,name);return send(res,200,ids[profile])}
 if(m[1]==='avatar'&&req.method==='GET'){if(!cur.avatar)return send(res,404,'No picture');try{const body=await readFile(path.join(DATA,'avatars',cur.avatar));res.writeHead(200,{'content-type':'image/'+(cur.avatar.split('.').pop()==='jpg'?'jpeg':cur.avatar.split('.').pop()),'cache-control':'private, max-age=86400',...security});return res.end(body)}catch{return send(res,404,'No picture')}}
 if(m[1]==='avatar'&&req.method==='PUT'){const type=String(req.headers['content-type']||'').split(';')[0];const ext=IMG[type];if(!ext)return send(res,415,{error:'Use a PNG, JPG, WebP or GIF image.'});
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>2e6)return send(res,413,{error:'Pictures must be under 2 MB.'});chunks.push(c)}
  await mkdir(path.join(DATA,'avatars'),{recursive:true});if(cur.avatar)await unlink(path.join(DATA,'avatars',cur.avatar)).catch(()=>{});
  const file=profile+'-'+Date.now()+'.'+ext;await writeFile(path.join(DATA,'avatars',file),Buffer.concat(chunks));ids[profile]={...cur,avatar:file};await writeIds(ids);return send(res,200,ids[profile])}
 if(m[1]==='avatar'&&req.method==='DELETE'){if(cur.avatar)await unlink(path.join(DATA,'avatars',cur.avatar)).catch(()=>{});delete cur.avatar;ids[profile]=cur;await writeIds(ids);return send(res,200,cur)}
 send(res,405,{error:'Method not allowed'});
}

const accountsApi=createAccounts(DATA);
// every agent's defaults from aqeelOS itself (tools, screen and browser, skills, its own Linux user): at start and for new agents
// the settings an agent may change for itself (my_settings): only everyday ones, never what it can reach
const OWN_SETTINGS=/^(stt|tts)\.[a-z0-9_.]+$|^timezone$|^display\.[a-z0-9_.]+$/;
const agentDefaults=createAgentDefaults({DATA,giveSkills:n=>accountHooks.giveSkills?.(n)});
accountHooks.afterSetup=n=>agentDefaults.added(n).catch(e=>console.warn('agent defaults',n,e.message));
// at start, then every 10 minutes: agents made outside aqeelOS (by Claude, by another agent, from the command line) get them too
const applyDefaults=()=>agentDefaults.all().then(n=>{if(n){console.log('agent defaults: '+n+' settings applied; restarting the agents when idle');restartGateway('agent defaults').catch(()=>{})}}).catch(e=>console.warn('agent defaults:',e.message));
// about every minute: new agents (made any way) get the defaults, every agent gets the main agent's skills it lacks
const defaultsTick=()=>agentDefaults.tick().then(n=>{if(n){console.log('agent defaults: new agent set up; restarting the agents when idle');restartGateway('new agent defaults').catch(()=>{})}}).catch(e=>console.warn('agent defaults tick:',e.message));
// the tab an agent works in comes to the front of its screen (screen-follow.mjs)
if(PORT===4400)startScreenFollow();
if(PORT===4400){setTimeout(applyDefaults,60000);setInterval(applyDefaults,600000).unref();setTimeout(()=>{defaultsTick();setInterval(defaultsTick,60000).unref()},90000)}
const mailer=createMail(DATA);
const usage=createUsage(DASH.origin,DASH_TOKEN);
const explain=createExplain(DATA,{python:enginePython,root});
const schedules=createSchedules({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents(),python:enginePython,root,live:()=>LIVE_APP||process.env.SCHED_DESCRIBE==='1'});
setTimeout(()=>schedules.tick(),40000).unref();setInterval(()=>schedules.tick(),10*60000).unref();
const relay=createRelay({ownerAgent:a=>{const o=users.agentOwner(String(a).split('--')[0]);return !o||o==='owner'},DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,SECRET,listAgents:()=>listAgents(),links:{list:a=>links.list(a)},platformsOf:a=>platformsCached(a),nameOf:a=>NAMES[a]||a,ownerName:()=>users.people()[0]?.name});
const NAMES={};   // agents' display names (refreshed with the agent context), for messages people read
// names and notes people give their Google accounts, "<agent>|<account name>" → {label, note}
const FX={idr:16500,at:0,day:''};   // dollar → rupiah, refreshed by /ui/fx
let GLABELS=null;const googleLabels=async()=>GLABELS??=await readFile(path.join(DATA,'google-accounts.json'),'utf8').then(JSON.parse).catch(()=>({}));
async function writeJsonAtomic(f,v){await mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';await writeFile(t,JSON.stringify(v,null,1));await rename(t,f)}
// the Google accounts an agent has, with what the person called them, for its working notes
async function googleContext(a){const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);const L=await googleLabels();const out=[];
 for(const f of (await readdir(home).catch(()=>[])).sort()){const m=/^google_token(?:_([\w.-]+))?\.json$/.exec(f);if(!m)continue;let email='';try{email=JSON.parse(await readFile(path.join(home,f),'utf8')).account||''}catch{}
  const n=m[1]||'',x=L[a+'|'+n]||{};out.push('- '+(x.label?'"'+x.label+'"':n?'"'+n+'"':'"Main Google account"')+(email?' ('+email+')':'')+': '+(n?'use --account '+n:'the default, no --account flag')+(x.note?'. '+x.note:''))}
 return out}
/* Every agent and every extra-number copy gets the aqeelOS tool (aqeelos-notify): send_to_person, and
   connect_mcp_tool for sign-ins. Its address is signed per agent. A test copy only touches agents it made. */
const madeHere=new Set();
// agents a test copy makes are its own: it lists them here and the live app leaves them alone (no setup, tools or health on them)
const TEST_LIST=path.join(HERMES_HOME,'.aqeelos-test-agents');let testAgents={t:0,v:new Set()};
const isTestAgent=async a=>{if(Date.now()-testAgents.t>20000)testAgents={t:Date.now(),v:new Set((await readFile(TEST_LIST,'utf8').catch(()=>'')).split('\n').filter(Boolean))};return testAgents.v.has(a)};
const noteMade=n=>{madeHere.add(n);if(PORT!==4400)writeFile(TEST_LIST,n+'\n',{flag:'a'}).catch(()=>{})};
let notifyRun=null,notifyAgain=false;
function syncNotifyTool(){if(notifyRun){notifyAgain=true;return notifyRun}
 notifyRun=(async()=>{do{notifyAgain=false;await syncNotifyOnce()}while(notifyAgain)})().finally(()=>{notifyRun=null});return notifyRun}
async function syncNotifyOnce(){
 // through the engine's own MCP route, so the running engine picks the tool up (a config edit alone is not noticed)
 const mcp=(a,m,p,b)=>fetch(`${DASH.origin}/api/mcp/servers${p}?profile=${encodeURIComponent(a)}`,{method:m,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(async r=>{if(!r.ok&&r.status!==404)throw new Error('MCP '+m+' '+r.status+' '+(await r.text().catch(()=>'')).slice(0,120))});
 for(const a of await listAllProfiles()){if(PORT!==4400&&!madeHere.has(a))continue;if(PORT===4400&&await isTestAgent(a))continue;
  try{const url=`http://127.0.0.1:${PORT}/mcp/notify/${a}/${relay.sig(a)}`;const cfg=()=>readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');
   if((await cfg()).includes(url))continue;
   const set=await withAgent(a,async()=>{const y=await cfg();if(!y||y.includes(url))return false;   // read again inside the queue
    if(y.includes('aqeelos-notify'))await mcp(a,'DELETE','/aqeelos-notify');
    try{await mcp(a,'POST','',{name:'aqeelos-notify',url})}catch{await new Promise(r=>setTimeout(r,4000));await mcp(a,'DELETE','/aqeelos-notify').catch(()=>{});await mcp(a,'POST','',{name:'aqeelos-notify',url})}return true});
   if(set)console.log('notify tool set for',a)}catch(e){if(await isAgent(a))console.warn('notify tool',a,e.message)}}}
/* What each agent should know about aqeelOS: the screens the person can watch and the channel IDs it can
   message them on. Kept in a marked section of AGENTS.md in the agent's own folder (~/workspaces/<agent>),
   which the engine reads with every chat; anything outside the section is left alone. */
async function displayName(a){const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'profile.yaml'),'utf8').catch(()=>'');return (/^display_name:\s*"?([^"\n]+)"?/m.exec(y)||[])[1]?.trim()||(a==='default'?'aqeelOS':a)}
/* The engine tells models that chats from an app are plain text ("no markdown"), so replies came out as flat
   paragraphs although aqeelOS shows formatting. Each agent gets the engine's own override with the truth. */
const CHAT_HINT="You're replying in aqeelOS, a chat app that shows Markdown. Format for easy reading, like a well-written Claude or ChatGPT reply: short answers stay short and conversational; longer ones start with the outcome, then use ## headings for sections, bullet or numbered lists, tables for comparisons, and code blocks for code or commands. Bold the key numbers, names, dates and decisions (for example: UPS **Rp522,328** → **Continue**) so the reply can be skimmed. Never send more than two plain paragraphs in a row: start a section with a bold lead-in (**Short answer** …, **What changed** …, **Next step** …) and put lists of points in bullets. Put the one thing the person must do in a quote line that starts with **Next step:**, and a real risk or blocker in a quote line that starts with ⚠️; aqeelOS shows these as soft boxes, so use at most one or two per reply. Write every link as [a short name](url) (for example [Dagadu weekly report](https://docs.google.com/…)), never a bare URL; aqeelOS shows them as small labelled buttons. Put the one main document on a line of its own and it shows as a card. For the state of items in a list, add [[Done]], [[Needs you]] or [[Failed]] after the item; aqeelOS shows these as small coloured labels (use them only for real states, not decoration). While working, keep progress notes to one short line each and lead the final answer with the result. File/media delivery: images referenced as MEDIA:/absolute/path tags (.png/.jpg/.jpeg/.gif/.webp/.bmp, up to 5MB) are shown inline in the chat. Non-image files are not shown inline, so state the plain file path instead of a MEDIA: tag.";
async function ensureChatHint(a){const cfgFile=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml');const y=await readFile(cfgFile,'utf8').catch(()=>'');
 // app chats (api_server) and scheduled runs that show their result in the app (delivered "local") read the same way
 if(y.split('shows these as small coloured labels').length>2)return;   // already the current wording, twice
 for(const k of ['api_server','local']){const r=await setKey(a,'agent.platform_hints.'+k,{replace:CHAT_HINT});if(!r.ok)throw new Error(r.err)}}
async function writeAgentContext(){const all=await listAgents();const names={};for(const a of all)names[a]=NAMES[a]=await displayName(a);
 const ads=[];for(const a of all)if(await screens.shared(a).catch(()=>false))ads.push(a);
 for(const a of all){await ensureChatHint(a).catch(e=>console.warn('chat hint',a,e.message));try{const me=names[a],adsNames=ads.map(x=>names[x]+"'s screen").join(' / ')||'the AdsPower screen';
  const own=ads.includes(a)?`You browse through AdsPower, so your browser shows on the shared AdsPower screen, listed as "${me}'s screen".`:`Your own screen is "${me}'s screen". Your browser tool opens pages there; it starts by itself when you browse.`;
  const others=all.filter(x=>x!==a&&!ads.includes(x)).map(x=>'"'+names[x]+"'s screen\"").join(', ');
  const ch=await relay.channelsFor(a).catch(()=>[]);const gacc=await googleContext(a).catch(()=>[]);
  // an agent without terminal and files cannot change its own settings: it says where they change instead of
  // guessing ("an admin has to…", an outside website)
  const cfgA=await readConfig(a).catch(()=>null)||{};const pts=pick(cfgA,'platform_toolsets')||{};
  const narrow=Object.entries(pts).filter(([k,v])=>Array.isArray(v)&&!/^(cli|api_server)$/.test(k)&&!v.some(x=>/^(terminal|hermes-)/.test(x))).map(([k])=>k==='cron'?'scheduled runs':k[0].toUpperCase()+k.slice(1));
  const off=pick(cfgA,'agent.disabled_toolsets')||[];const locked=(Array.isArray(off)?off:String(off).split(',')).map(x=>String(x).trim()).includes('terminal');
  const body=['<!-- aqeelos:context (written by aqeelOS and kept up to date; edit outside this block) -->','# Working in aqeelOS','','## Screens','',
   'The person can watch screens live in aqeelOS: the monitor button at the top right, then the screen picker.',
   '- '+own,
   '- AdsPower browsers, opened by any agent, show on the shared AdsPower screen, listed as '+adsNames+'.',
   others?'- Other agents have their own screens: '+others+'.':null,
   'When you start working in a browser or in AdsPower, say which screen to watch, for example: "I am working on '+(ads.includes(a)?me+"'s screen":me+"'s screen")+'." If the person needs to sign in or solve a check themselves, tell them to open that screen and press Take over.',
   ...(locked?['','## Changing settings','',
    'You have no terminal or file tools, so you cannot change your own settings, and that is on purpose. When someone asks to change how you or your channels behave (notices such as "Redirected current run", your model, what you may use, who may message you), say plainly that you cannot change it yourself and that it is changed in aqeelOS on the Settings page (System › Settings, with "Showing: '+me+'" picked at the top). Who may message you is on Channels › Who can message (that page approves people; which Slack channels you listen to is not on any page yet, so say the aqeelOS owner changes it on the AI box); apps are on Abilities › Connected apps.',
    'Never send anyone to a website or to documentation for this, and never say "an admin" has to do it.']
    // every other agent changes its own settings when asked, and otherwise says the same plain thing
    :['','## Changing settings','',
    'Your settings are yours to change: they live in your own aqeelOS settings and change with `aqeelos -p '+a+' config set <key> <value>` (`aqeelos -p '+a+' config show` lists them). When someone asks to change how you or your channels behave (notices such as "Redirected current run", your model, who may message you), make the change yourself and say in one line what you changed; some settings (such as channel notices) only take effect after the agents restart, so say that and that the person can press Restart agents on System › Health. When the person asks you to change another agent\'s settings, or every agent\'s, do it the same way with that agent\'s name after -p ('+all.map(x=>x+' = '+names[x]).join(', ')+') and say which agents you changed. Without such a request, change only your own.',
    'If something cannot be changed from your side, say plainly where it is changed in aqeelOS: the Settings page (System › Settings, with "Showing: '+me+'" picked at the top), Channels › Who can message, or Abilities › Connected apps. Never send anyone to a website or to documentation for this, and never say "an admin" has to do it.',
    // channels kept to a few tools on purpose (a team Slack, check-ins that read it): there the agent says so plainly
    ...(narrow.length?['On '+narrow.join(' and ')+' you have only a few tools on purpose (no terminal, browser or files). There, say plainly that it is something you do when asked in the aqeelOS app, never that it is impossible.']:[])]),
   // agents of admins fix a missing tool, permission or connection themselves, from any channel, and apply it
   ...(!locked&&!lockedAgent(a,{})?['','## When you are missing a tool, a permission or a connection','',
    'Nothing here waits for a developer. When you (or another agent, when the person asks about it) cannot do something only because of a setting, a missing connection or a missing action in a tool, fix it yourself, then do the job. Never answer that it needs a developer, a code change, Claude, the app instead of Slack, or more permission from the person when you can change it from here:',
    '1. Settings: `aqeelos -p <agent> config show` shows what limits an agent: `platform_toolsets` (tools per channel; a channel should have the same as the app unless the person said otherwise), `agent.disabled_toolsets`, `approvals.mode`, `mcp_servers.<name>.enabled`. Change it with `aqeelos -p <agent> config set <key> <value>`.',
    '2. A connected app another agent already has (n8n, Notion, Slack…): copy its `mcp_servers.<name>` entry into the other agent (`config set mcp_servers.<name> \'<json>\'`) and its sign-in files `mcp-tokens/<name>*.json` (in ~/.hermes or ~/.hermes/profiles/<agent>) into the other agent\'s `mcp-tokens` folder. No new sign-in is needed.',
    '3. A tool that lacks one action (it can update a sheet but not create one): add the action to that tool\'s server, or write a small skill or MCP tool for it, and try it once from the terminal before using it.',
    '4. Then call apply_changes (from aqeelos-notify) once, finish your turn with what you changed, and do the job in the next turn. Never restart the gateway any other way.',
    'Ask the person first only when the change reaches outside the team (sharing with outside people, messaging clients), spends money, or deletes something. Everything else: do it and say in one line what you changed.']:[]),
   '','## Apps and accounts: free ways first','',
   'For an outside app (Slack, Gmail, Google Drive, Notion, GitHub, Google Cloud…), try the free ways first, in this order:',
   '1. That app’s own MCP tool, if you have it (connect it with connect_mcp_tool when it needs a sign-in).',
   '2. A built-in skill that covers it (for example the Google Workspace skill for Gmail, Drive, Calendar, Sheets and Docs).',
   '3. The browser on your screen, where the person can watch and sign in themselves. Good for one-off jobs in a web console (setting something up, inviting someone, changing a setting).',
   'Only when those cannot do it, or the setup needs an app or admin access the person does not have, suggest Composio. Say plainly: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only after the person agrees.',
   'Choosing where it runs: a one-off job can be done in the browser now. Anything that must keep running (schedules, automatic replies, regular reports) needs a tool or skill on this server, so set that up instead of relying on the browser.',
   'Which browser: before your first browser step in a chat, call choose_browser (from aqeelos-notify) with the task and your suggestion: "yours" (the person\'s own Chrome, where they are already signed in) for one-off jobs in web consoles, "server" (your screen on the AI box) for anything scheduled, long-running or done while they are away. Follow their answer for the rest of that chat.',
   '','## Connecting an MCP tool that needs a sign-in','',
   'Never use manage_connections (authorize/install/enable) or “hermes mcp login” for MCP tools, and never a 127.0.0.1 / localhost callback: the person is not at this server, so that page never opens for them. Add the tool (with its client ID/secret if the service needs its own app), then call the connect_mcp_tool tool (from aqeelos-notify) and send the person its steps exactly as written. Never make up steps, addresses or commands for connecting: the people using this are often not technical, so keep it to what the tool says. When the tool recommends Composio, offer that first. aqeelOS sets the return address itself: '+PUBLIC_URL+'/mcp-oauth/api/mcp/oauth/callback/<tool name> (this is what goes in the service’s Redirect URLs).',
   ...(gacc.length?['','## Your Google accounts','',
    'The person named these and said what each is for. When they mention one by its name ("from my Elkiya account") or the job fits its note, use that account with the Google Workspace skill; when it is unclear which one, ask.',...gacc]:[]),
   '','## Keep schedules tidy','',
   'Whenever you create or change a schedule, give it a clear title the person understands without opening it (no codes like "x3"), then call organize_schedule (from aqeelos-notify) with its id, the folder it belongs to (the client or project, for example Dagadu, Personal Finance, Elkiya, AdmissionSight; reuse an existing folder when one fits) and one plain sentence on what it does and why. When asked to tidy up, move, rename or explain schedules, do the same for each one.',
   '','## Your other chats','',
   'Each chat (here, WhatsApp, Telegram, a schedule run) is its own conversation: you do not see the others, and your memory notes keep only what was saved. Before you say you don\'t know something the person says you did or discussed, and before you take back or "correct" something you said earlier, search your past chats with session_search and go by what they show. Never call something a guess without checking.',
   '','## Passwords, API keys and other secrets','',
   'Never ask the person to type a password, code or API key into the chat, and never ask them to type it on the screen viewer. Call ask_secret (from aqeelos-notify): mode "type" types it into the field you clicked on your screen, mode "save" stores it as a named key. The person can also send you one with the lock button; you then get its name. To enter a saved one, click the field and call type_secret with its name. You never see the values.',
   '','## Channels you can message the person on','',
   'Urgent or important news for the person who owns you (not the people you chat with) goes through the channel that says it reaches the owner of aqeelOS, with send_to_person. Never send such an alert back to the person you are chatting with, and never tell them you are passing messages on unless they ask you to.',
   ch.length?'Use the send_to_person tool with one of these IDs when the person asks to be notified on a channel ("notify me on shop-whatsapp"):':'None yet. The person can connect WhatsApp, Telegram and others on the Channels page.',
   ...ch.map(c=>'- '+c.id+' = '+c.name),'<!-- /aqeelos:context -->'].filter(x=>x!==null).join('\n');
  const dir=path.join(homedir(),'workspaces',a),file=path.join(dir,'AGENTS.md');await mkdir(dir,{recursive:true});
  const cur=await readFile(file,'utf8').catch(()=>'');const re=/<!-- aqeelos:context[\s\S]*?<!-- \/aqeelos:context -->/;
  const next=re.test(cur)?cur.replace(re,()=>body):(cur?cur.replace(/\s*$/,'\n\n'):'')+body+'\n';if(next!==cur)await writeFile(file,next)}catch(e){console.warn('agent context',a,e.message)}}}
/* Sign-ins that ran out: every few hours each agent's signed-in apps (OAuth MCP tools) are tested the way the
   Test button does. One with no sign-in, or that fails on its sign-in, is listed for admins, who get a notice with
   a Sign in button instead of finding out when an agent says it cannot reach the app. */
const signinsDue=new Map();let signinsAt=0;
// a connected app in words people know: which service, which account, and what stops working without it
const APP_KINDS=[[/slack\.com/,'Slack','read and post in Slack'],[/notion\.com/,'Notion','read and edit your Notion pages'],[/n8n/,'n8n','find and run your n8n workflows'],
 [/composio/,'App connector (Composio)','use the apps you linked in Composio'],[/github/,'GitHub','work with your GitHub repositories'],[/linear/,'Linear','read and update Linear issues'],[/google|gmail/,'Google','use your Google apps']];
function appInfo(name,url){const k=APP_KINDS.find(([re])=>re.test(String(url||'')+' '+name))||[null,pretty0(name),'use '+pretty0(name)];
 const acct=String(name).toLowerCase().replace(/^(slack|notion|n8n|composio|github|linear|google)[-_]?/,'');const account=acct&&acct!==String(name).toLowerCase()?pretty0(acct):'';
 return {app:k[1],account,label:k[1]+(account?' ('+account+')':''),does:k[2],url:url||''}}
const pretty0=x=>String(x||'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
async function checkSignins(){const h={'x-hermes-session-token':DASH_TOKEN};const seen=new Set();
 for(const a of await listAgents()){let list=[];try{const r=await fetch(DASH.origin+'/api/mcp/servers?profile='+encodeURIComponent(a),{headers:h,signal:AbortSignal.timeout(15000)});list=(await r.json()).servers||[]}catch{continue}
  for(const s of list){if(s.auth!=='oauth'||s.enabled===false)continue;const key=a+'|'+s.name;seen.add(key);
   const tok=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'mcp-tokens',s.name+'.json');let why='';
   if(!await stat(tok).catch(()=>null))why='not signed in';
   else{try{const r=await fetch(DASH.origin+'/api/mcp/servers/'+encodeURIComponent(s.name)+'/test?profile='+encodeURIComponent(a),{method:'POST',headers:h,signal:AbortSignal.timeout(70000)});const j=await r.json();
    if(j.ok===false&&/oauth|unauthori[sz]ed|401|invalid_grant|invalid_token|expired|login/i.test(String(j.error||'')))why='the sign-in ran out'}catch{}}
   if(why){if(!signinsDue.has(key))console.log('sign-in needed:',s.name,'on',a,'('+why+')');signinsDue.set(key,{agent:a,agentName:NAMES[a]||a,name:s.name,why,...appInfo(s.name,s.url),last:(await stat(tok).catch(()=>null))?.mtimeMs||0})}else signinsDue.delete(key)}}
 for(const k of [...signinsDue.keys()])if(!seen.has(k))signinsDue.delete(k);signinsAt=Date.now()}
// cheap: only looks at the token files (the full check above also tests each app, every 3 hours)
async function freshSignins(){for(const [k,x] of [...signinsDue]){const tok=path.join(x.agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',x.agent),'mcp-tokens',x.name+'.json');const st=await stat(tok).catch(()=>null);
  if(st&&st.size>2&&(x.why==='not signed in'||st.mtimeMs>(x.last||0)+1000))signinsDue.delete(k)}}
// every agent gets its own n8n user once n8n is connected (new agents within a few minutes); nothing happens before that
async function n8nForAll(){if(!await n8n.ready())return;for(const a of await listAgents()){if(await isTestAgent(a))continue;try{await n8n.ensure(a)}catch(e){console.warn('n8n for',a,e.message)}}}
if(PORT===4400){setTimeout(()=>n8nForAll().catch(()=>{}),90000);setInterval(()=>n8nForAll().catch(()=>{}),600000).unref()}
// decided 20 Oct (ABIL-64): apps added to an agent but never signed in to use their owner's sign-in. Done once; apps whose
// owner isn't signed in either stay on the sign-in list.
async function useOwnerSigninsOnce(){const flag=path.join(DATA,'once-owner-signins.json');if(await stat(flag).catch(()=>null))return;const l=await access.list('mcp').catch(()=>null);if(!l)return;const done=[];
 for(const x of [...signinsDue.values()]){if(x.why!=='not signed in')continue;const it=l.items.find(y=>y.id===x.name);const own=it&&it.owner!==x.agent&&(it.users||[]).find(u2=>u2.id===it.owner&&u2.signed);if(!own)continue;
  try{await access.grant('mcp',x.name,x.agent);done.push(x.name+' for '+(NAMES[x.agent]||x.agent))}catch(e){console.warn('owner sign-in',x.name,x.agent+':',e.message)}}
 await writeFile(flag,JSON.stringify({at:Date.now(),done},null,1));await freshSignins();console.log('used owners’ sign-ins:',done.join(', ')||'none')}
if(PORT===4400){setTimeout(()=>checkSignins().then(()=>useOwnerSigninsOnce()).catch(()=>{}),120000);setInterval(()=>checkSignins().catch(()=>{}),3*3600e3).unref()}
if(PORT===4400){setTimeout(()=>writeAgentContext().catch(()=>{}),25000);setInterval(()=>writeAgentContext().catch(()=>{}),600000).unref()}
/* Slack: every agent with its own Slack bot answers in any channel it is invited to (private ones too) when a team
   member mentions it, except client channels (ext-…), which stay silent. Once per agent, a fixed channel list
   (SLACK_ALLOWED_CHANNELS) is swapped for that (kept as a comment); after that, client channels made later are
   added here. Either way the agents restart once nobody is mid-reply so it takes effect. */
async function slackClientChannels(){const st=await getStatus().catch(()=>({}));for(const a of await listAgents()){try{
  const envF=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env');const cur=await readFile(envF,'utf8').catch(()=>'');
  const tok=(/^SLACK_BOT_TOKEN=(.+)$/m.exec(cur)||[])[1]?.trim();if(!tok)continue;
  const marked=/kept up to date by aqeelOS/.test(cur);if(!marked&&st[a]?.slackOpen)continue;   // switched back by hand later: left alone
  const have=new Set(((/^SLACK_IGNORED_CHANNELS=(.*)$/m.exec(cur)||[])[1]||'').split(',').map(x=>x.trim()).filter(Boolean));
  const r=await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=1000&exclude_archived=true',{headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(20000)}).then(x=>x.json());
  if(!r.ok)continue;const add=(r.channels||[]).filter(c=>/^ext-/.test(c.name)&&!have.has(c.id));if(marked&&!add.length)continue;
  const next=[...have,...add.map(c=>c.id)].join(',');
  await editEnv(envF,t=>{let s=t.replace(/^SLACK_ALLOWED_CHANNELS=.*$/m,m=>'# was (replaced by SLACK_IGNORED_CHANNELS on '+new Date().toISOString().slice(0,10)+'): '+m);
   if(/^SLACK_IGNORED_CHANNELS=/m.test(s))s=s.replace(/^SLACK_IGNORED_CHANNELS=.*$/m,'SLACK_IGNORED_CHANNELS='+next);else s=s.replace(/\n*$/,'\n')+'SLACK_IGNORED_CHANNELS='+next+'\n';
   if(!/kept up to date by aqeelOS/.test(s))s=s.replace(/^SLACK_IGNORED_CHANNELS=/m,'# client channels (ext-*): never answered, kept up to date by aqeelOS\nSLACK_IGNORED_CHANNELS=');return s});
  if(!marked)await setStatus(a,{slackOpen:Date.now()});
  console.log('slack:',a,marked?'client channels kept silent: '+add.map(c=>'#'+c.name).join(', '):'answers in every channel it is invited to; client channels stay silent');
  restartGateway('Slack channel settings updated for '+a).catch(()=>{})}catch(e){console.warn('slack channels',a,e.message)}}}
if(PORT===4400){setTimeout(()=>slackClientChannels(),60000).unref();setInterval(()=>slackClientChannels(),900000).unref()}
/* Dictation spells your names right: the speech model gets the names it should expect (agents, schedule folders,
   the app itself), kept up to date as they change. */
async function sttVocab(){try{const names=new Set(['aqeelOS']);for(const a of await listAgents())names.add(NAMES[a]||a);
  const meta=await readFile(path.join(DATA,'schedule-meta.json'),'utf8').then(JSON.parse).catch(()=>({jobs:{}}));for(const m of Object.values(meta.jobs||{}))if(m.folder&&m.folder!=='General')names.add(m.folder);
  const want='Names that may come up, '+[...names].filter(Boolean).join(', ')+'.';
  const cur=pick(await readConfig('default')||{},'stt.local.initial_prompt');if(cur===want)return;
  const r=await setKey('default','stt.local.initial_prompt',want);if(r.ok)console.log('dictation knows these names now:',[...names].join(', '))}catch(e){console.warn('dictation names',e.message)}}
if(PORT===4400){setTimeout(()=>sttVocab(),90000).unref();setInterval(()=>sttVocab(),3600e3).unref()}
/* Agent health: every agent (new ones right after they are made, all of them every 5 minutes) gets what it
   needs to work without anyone fixing it: the full setup (each step skipped when already right), the chat
   hint, its screen settings, the public sign-in return address on every sign-in (OAuth) tool, the engine's
   localhost-only connector tool off, and for agents of people without "unsafe tools" those tools locked on
   every channel. Quiet and idempotent; logs only what it repaired. */
async function lockTools(a){const c=await readConfig(a);if(!c)throw new Error('the settings could not be read');
 const cur=pick(c,'agent.disabled_toolsets')||[];const list=Array.isArray(cur)?cur.map(String):String(cur).split(',').map(x=>x.trim()).filter(Boolean);
 if(UNSAFE_TOOLSETS.every(t=>list.includes(t)))return false;
 // the engine applies agent.disabled_toolsets on every channel (aqeelOS chats, WhatsApp, schedules…), not just the command line
 const r=await setKey(a,'agent.disabled_toolsets',[...new Set([...list,...UNSAFE_TOOLSETS])]);if(!r.ok)throw new Error(r.err);
 console.log('health',a,'locked terminal, files, code and computer use on every channel');return true}
const lockedAgent=(a,st)=>{if(st[a]?.safe)return true;const ow=users.agentOwner(a);if(!ow||ow==='owner')return false;const u=users.byId(ow);return !!u&&!users.can(u,'unsafe')};
/* Loop guard. Two agents on WhatsApp that may answer each other reply back and forth until WhatsApp logs both out
   (it happened once). So an extra agent never answers another agent's own WhatsApp number: such a number is taken
   off its allowed and approved lists. The main agent keeps its lists, so the owner can still message it from a
   phone that another agent (like Husband Mode) also runs on. */
async function waIds(a){const c=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session','creds.json'),'utf8').then(JSON.parse).catch(()=>null);
 return [c?.me?.id,c?.me?.lid].filter(Boolean).map(x=>String(x).split('@')[0].split(':')[0].replace(/\D/g,'')).filter(Boolean)}
async function loopGuard(a,all){if(a.split('--')[0]==='default')return;const home=path.join(HERMES_HOME,'profiles',a);
 const others=new Set();for(const b of all)if(b!==a)for(const id of await waIds(b))others.add(id);if(!others.size)return;const removed=[];
 const envF=path.join(home,'.env');
 await editEnv(envF,cur=>{let changed=false;const next=cur.split('\n').map(l=>{const m=/^(WHATSAPP_ALLOWED_USERS=)["']?([^"'\n]*)["']?$/.exec(l);if(!m)return l;
  const keep=m[2].split(',').map(x=>x.trim()).filter(x=>{const d=x.replace(/\D/g,'');if(d&&others.has(d)){removed.push(x);changed=true;return false}return !!x});return m[1]+keep.join(',')});return changed?next.join('\n'):null}).catch(()=>{});
 const apF=path.join(home,'platforms','pairing','whatsapp-approved.json');const ap=await readFile(apF,'utf8').then(JSON.parse).catch(()=>null);
 if(ap&&typeof ap==='object'){let ch=false;for(const k of Object.keys(ap))if(others.has(k.replace(/\D/g,''))){delete ap[k];removed.push(k);ch=true}
  if(ch){await writeFile(apF+'.tmp',JSON.stringify(ap));await rename(apF+'.tmp',apF)}}
 if(removed.length){platCache.delete(a);console.log('loop guard:',a,'no longer answers other agents\' WhatsApp numbers:',removed.join(', '))}}
async function agentHealth(only){const h={'x-hermes-session-token':DASH_TOKEN};const st=await getStatus();await users.load();
 for(const a of only?[only]:await listAllProfiles()){try{
  if(!await isAgent(a)||(PORT===4400&&!only&&await isTestAgent(a)))continue;const copy=a.includes('--');
  // a failing setup is tried again every 15 minutes (a plugin enable is slow and builds an engine environment)
  if(a!=='default'&&!copy&&setupAgentFn){const s=st[a];if(only||!s||Date.now()-(s.t||0)>(s.ok?24*60:15)*60e3)await setupAgentFn(a).catch(e=>console.warn('setup',a,e.message))}
  if(copy&&API_KEY){const envF=path.join(HERMES_HOME,'profiles',a,'.env');
   if(await editEnv(envF,cur=>/^API_SERVER_KEY=/m.test(cur)?null:cur+(cur&&!cur.endsWith('\n')?'\n':'')+'API_SERVER_KEY='+API_KEY+'\n').catch(()=>false))console.log('health',a,'added the gateway key')}
  if(!copy){await ensureChatHint(a).catch(async e=>{if(await isAgent(a))console.warn('chat hint',a,e.message)});await screens.ensure(a).catch(()=>{})}
  if(a!=='default')await loopGuard(a,await listAllProfiles()).catch(e=>console.warn('loop guard',a,e.message));
  if(!copy&&a!=='default'&&lockedAgent(a,st))await lockTools(a).catch(e=>console.warn('lock tools',a,e.message));
  {const cf=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml');const y=await readFile(cf,'utf8').catch(()=>'');
   // every agent can work in the person's own browser when they choose it (the engine's browser-extension control)
   if(y&&!/extension_control:\s*\n\s+enabled:\s*true/.test(y)){const r=await setKey(a,'browser.extension_control.enabled','true');if(r.ok)console.log('health',a,'can now use the person’s own browser when chosen')}
   // the engine's own connector tool only works at this server (localhost); agents that have connect_mcp_tool use that instead
   if(y.includes('aqeelos-notify')&&!/^  connectors:\n(?:    .*\n)*?    enabled: false/m.test(y)){const r=await setKey(a,'tools.connectors.enabled','false');
    if(r.ok)console.log('health',a,'switched off the engine connector tool (agents use connect_mcp_tool)');else if(await isAgent(a))console.warn('health',a,'connector tool:',r.err)}}
  const sv=await fetch(DASH.origin+'/api/mcp/servers?profile='+encodeURIComponent(a),{headers:h}).then(r=>r.json()).catch(()=>({}));
  for(const m of sv.servers||[]){if(!m.url||/127.0.0.1|localhost/.test(m.url))continue;if(m.auth!=='oauth'&&!/connect.composio.dev|rube.app/.test(m.url))continue;
   const r=await sharing.prepareSignin(a,m.name,MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(m.name)).catch(()=>null);if(r?.changed)console.log('health',a,m.name,'set the public sign-in address')}}
  catch(e){if(await isAgent(a))console.warn('health',a,e.message)}}}
/* The engine. aqeelOS restarts it one way only: wait for replies in progress (up to 10 minutes), stop whichever
   gateway runs (also one the engine started by itself), and start it in its managed session with the full
   environment (~/.local/bin on the PATH, so Claude is found). The dashboard keeps running, so sign-ins in
   progress survive. The watch (every minute) starts a gateway when none runs, and replaces one the engine
   started itself only when THAT gateway cannot reach Claude. A deliberate Stop from the app is respected. */
let gwStopped=false,gwRestarting=null,gwMissing=0;
// Thinking survives a refresh: the engine keeps no thinking text for some models (only a sealed signature), so when
// a reply streamed through aqeelOS ends, the thinking it showed is saved per chat and shown again when it is reopened.
async function saveThinking(key,rec){try{const sid=key.split('|').slice(1).join('|');if(!/^[\w.-]{3,120}$/.test(sid))return;
 let user='',think='',secs=0,t0=0,t1=0;
 for(const ev of Buffer.concat(rec.chunks).toString('utf8').split('\n\n')){const name=(/^event: *(.+)$/m.exec(ev)||[])[1];const dl=ev.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).join('');if(!dl)continue;let e;try{e=JSON.parse(dl)}catch{continue}const ty=e.type||name;
  if(ty==='run.started'){const c=e.user_message?.content;user=typeof c==='string'?c:Array.isArray(c)?c.map(x=>x.text||'').join(''):''}
  if(ty==='reasoning.delta'||ty==='assistant.reasoning'||(ty==='tool.progress'&&e.tool_name==='_thinking')){const d=e.delta||e.text||'';if(d){if(!t0)t0=Date.now();think+=d}}}
 if(!think.trim()||!user)return;const f=path.join(DATA,'thinking',sid+'.json');const l=await readFile(f,'utf8').then(JSON.parse).catch(()=>[]);
 l.push({u:user.slice(0,300),think:think.slice(0,20000),by:rec.user,t:Date.now()});await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify(l.slice(-200)))}catch(e){console.warn('save thinking',e.message)}}
const liveCount=()=>[...LIVE.values()].filter(r=>!r.done).length;
const shx=async c=>{const {execFile}=await import('node:child_process');return new Promise(r=>execFile('bash',['-c',c],{timeout:150000,env:{...process.env,PATH:homedir()+'/.local/bin:'+process.env.PATH}},(e,o)=>r({ok:!e,out:String(o||'')})))};
async function gatewayPid(){const t=await readFile(path.join(HERMES_HOME,'gateway.pid'),'utf8').catch(()=>'');const pid=Number((/\d+/.exec(t)||[])[0]);if(!pid)return 0;try{process.kill(pid,0);return pid}catch{return 0}}
// Every engine restart is noted (ours with the reason, and ones the engine does by itself), so the bell can say why
// Slack or WhatsApp dropped for a moment instead of it being a mystery.
let sysEvents=[],lastGwPid=0,lastOwnRestart=0;
function noteSys(kind,why){sysEvents.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),t:Date.now(),kind,why:String(why||'').slice(0,160)});sysEvents=sysEvents.slice(-50)}
let autoRestarts=[];
function restartGateway(why,{wait=true,auto=false}={}){if(gwRestarting)return gwRestarting;if(auto){autoRestarts=autoRestarts.filter(t=>Date.now()-t<30*60e3);if(autoRestarts.length>=3){if(Date.now()-(globalThis.__rf||0)>30*60e3){globalThis.__rf=Date.now();noteSys('restart-failed','The engine kept stopping, so it was left off. Open System › Host and press Start.')}return Promise.resolve()}autoRestarts.push(Date.now())}if(PORT!==4400){console.log('gateway restart skipped (test copy):',why);return Promise.resolve()}
 gwRestarting=(async()=>{if(wait)for(let i=0;i<120&&liveCount()>0;i++)await new Promise(r=>setTimeout(r,5000));
  console.log('gateway restart:',why);gwStopped=false;lastOwnRestart=Date.now();noteSys('restart',why);
  await shx('hermes -p default gateway stop >/dev/null 2>&1; for i in $(seq 1 30); do p=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1); [ -n "$p" ] && kill -0 "$p" 2>/dev/null || break; sleep 1; done; tmux kill-session -t gateway 2>/dev/null; sleep 1; ~/services.sh >/dev/null 2>&1');
  platCache.clear()})().finally(()=>{gwRestarting=null});return gwRestarting}
async function gatewayWatch(){if(gwStopped||gwRestarting)return;
 const pid=await gatewayPid();const inTmux=(await shx('tmux has-session -t gateway')).ok;
 if(pid&&lastGwPid&&pid!==lastGwPid&&Date.now()-lastOwnRestart>180000)noteSys('restart-self','');if(pid)lastGwPid=pid;
 // nothing running at all, twice in a row (so an engine restart in progress is not cut off): start it
 if(!pid&&!inTmux){if(++gwMissing<2)return;gwMissing=0;console.warn('gateway watch: no gateway was running');return restartGateway('no gateway was running',{wait:false,auto:true})}
 gwMissing=0;if(inTmux||!pid)return;
 const up=Number((await shx('ps -o etimes= -p '+pid)).out.trim())||0;const since=Date.now()-up*1000;
 const log=(await shx('tail -400 ~/.hermes/logs/agent.log')).out.split('\n').filter(l=>/ClaudeCodeLoggedOut|no usable login/.test(l));
 const bad=log.some(l=>{const t=Date.parse(l.slice(0,19).replace(' ','T')+'Z');return t&&t>since+5000&&Date.now()-t<10*60e3});
 if(bad){console.warn('gateway watch: the gateway the engine started cannot reach Claude; restarting it properly');return restartGateway('gateway outside its session cannot reach Claude',{auto:true})}}
if(PORT===4400){setInterval(()=>gatewayWatch().catch(()=>{}),60000).unref()}
/* After an engine update (from the app or by itself), the renames are applied again and, once nothing is in
   progress, the engine restarts once so people see aqeelOS again in channel messages, prompts and errors. */
const engineHead={v:null,t:0};
async function engineWatch(){const r=await shx('git -C ~/.hermes/hermes-agent rev-parse HEAD 2>/dev/null');const h=String(r.out||'').trim();if(!/^[0-9a-f]{40}$/.test(h))return;
 const clean=(await shx('git -C ~/.hermes/hermes-agent diff --quiet && echo clean')).out.trim()==='clean';
 if(engineHead.v===null){engineHead.v=h;if(!clean)return}else if(h===engineHead.v&&!clean)return;if(h===engineHead.v)return;engineHead.v=h;console.log('engine updated to',h.slice(0,8),'- applying aqeelOS patches again');
 const {execFile}=await import('node:child_process');const out=await new Promise(res=>execFile(process.execPath,[path.join(root,'scripts','apply-skill-patches.mjs')],{timeout:600000,maxBuffer:8e6},(e,o)=>res(String(o||''))));
 const n=Number((/(\d+) change\(s\)/.exec(out)||[])[1]||0);console.log('engine patches after update:',n,'change(s)');if(n)restartGateway('engine updated: aqeelOS wording applied again').catch(()=>{})}
if(PORT===4400){setInterval(()=>engineWatch().catch(()=>{}),5*60000).unref();setTimeout(()=>engineWatch().catch(()=>{}),20000).unref()}
/* Memory guard. The AI box has a fixed memory limit; when it runs full, the engine or the dashboard is killed.
   Every 2 minutes: above 80% the bell says so (once an hour); above 90%, with no reply, schedule, setup or relay in
   progress, the AdsPower browsers are closed (AdsPower itself stays open and a browser reopens when an agent needs it).
   The Host page shows the numbers in plain words. */
async function memNow(){const n=async f=>Number((await readFile(f,'utf8').catch(()=>'')).trim())||0;
 const cur=await n('/sys/fs/cgroup/memory.current'),max=await n('/sys/fs/cgroup/memory.max');if(cur&&max){const st=await readFile('/sys/fs/cgroup/memory.stat','utf8').catch(()=>'');const cache=Number((/^inactive_file (\d+)/m.exec(st)||[])[1]||0);return {used:Math.max(0,cur-cache),max}}
 const m=await readFile('/proc/meminfo','utf8').catch(()=>'');const kb=k=>Number((new RegExp('^'+k+':\\s+(\\d+)','m').exec(m)||[])[1]||0)*1024;return {used:kb('MemTotal')-kb('MemAvailable'),max:kb('MemTotal')}}
let memWarned=0,memActed=0;
async function memGuard(){const {used,max}=await memNow();if(!max)return;const pct=used/max;
 if(pct>0.8&&Date.now()-memWarned>3600e3){memWarned=Date.now();noteSys('memory',Math.round(pct*100)+'% of memory in use ('+(used/1e9).toFixed(1)+' of '+(max/1e9).toFixed(1)+' GB)')}
 if(pct<=0.9||Date.now()-memActed<30*60e3)return;const eng=await fetch(DASH.origin+'/api/status',{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);if(!eng||Number(eng.active_sessions||0)>0)return;if(liveCount()>0||opsBusy()>0||relay.sending()>0||export_setups.running()>0||gwRestarting)return;
 const key=((await readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'')).match(/^ADSPOWER_API_KEY=["']?([^"'\n]+)/m)||[])[1]||'';const h=key?{authorization:'Bearer '+key}:{};
 const act=await fetch('http://127.0.0.1:50325/api/v1/browser/local-active',{headers:h,signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);const list=act?.data?.list||[];let n=0;
 for(const b of list){const id=b.user_id||b.profile_id;if(!id)continue;const r=await fetch('http://127.0.0.1:50325/api/v1/browser/stop?user_id='+encodeURIComponent(id),{headers:h,signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);if(r?.code===0)n++}
 if(n)memActed=Date.now();if(n){console.warn('memory guard: memory at',Math.round(pct*100)+'%, closed',n,'AdsPower browser(s)');noteSys('memory-freed','Memory was almost full, so '+n+' AdsPower browser'+(n>1?'s were':' was')+' closed. They reopen when an agent needs them.')}}
if(PORT===4400)setInterval(()=>memGuard().catch(e=>console.warn('memory guard',e.message)),120000).unref();
// the dashboard (settings, channels, sign-ins, dictation) can be killed when the box runs out of memory: if it does
// not answer twice in a row, it is started again (in its managed session, like the engine)
let dashMissing=0,dashRestarted=0,dashTries=0;
if(PORT===4400)setInterval(async()=>{const ok=await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(8000)}).then(r=>r.status<500,()=>false);
 if(ok){dashMissing=0;dashTries=0;return}if(Date.now()-dashRestarted<Math.min(60,5*2**dashTries)*60e3)return;if(++dashMissing<2)return;dashMissing=0;dashRestarted=Date.now();dashTries++;console.warn('dashboard watch: the dashboard stopped answering; starting it again');
 await shx('tmux kill-session -t dashboard 2>/dev/null; ~/services.sh >/dev/null 2>&1')},60000).unref();
// only the live app (port 4400) sets agents' tools; a test copy on another port must not repoint them
if(PORT===4400){setTimeout(()=>agentHealth().catch(()=>{}),30000);setInterval(()=>agentHealth().catch(()=>{}),300000).unref()}
if(PORT===4400){setTimeout(()=>syncNotifyTool().catch(e=>console.warn('notify tool',e.message)),20000);setInterval(()=>syncNotifyTool().catch(()=>{}),600000).unref()}
// old engine environments (each plugin enable builds one, ~400 MB): the engine's own cleanup once a day; it keeps the one in use, any still held, and any less than a day old
if(PORT===4400){const gc=()=>shx('timeout 900 hermes pm gc >/dev/null 2>&1').catch(()=>{});setTimeout(gc,30*60e3).unref();setInterval(gc,24*3600e3).unref()}
// leftovers of deleted agents: a folder with only logs/ (a command still ran during the delete) is removed
const sweepGhosts=async()=>{for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[])){if(!d.isDirectory()||d.name.startsWith('.'))continue;
 const dir=path.join(HERMES_HOME,'profiles',d.name);if(await isAgent(d.name))continue;const st=await stat(dir).catch(()=>null);const inside=await readdir(dir).catch(()=>['?']);
 if(st&&Date.now()-st.mtimeMs>10*60e3&&inside.every(x=>['logs','plugin-update-checks','cache','sandboxes','plugins'].includes(x))){const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true}).catch(()=>{});console.log('removed the leftover folder of deleted agent',d.name)}}};
if(PORT===4400){setTimeout(()=>sweepGhosts().catch(()=>{}),40000);setInterval(()=>sweepGhosts().catch(()=>{}),30*60e3).unref()}
const sharing=createShare({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents()});
const channels=createChannels({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAllProfiles(),cached:a=>platformsCached(a),restart:why=>restartGateway(why),paused:()=>pausedLoad()});
const access=createAccess({HERMES_HOME,DATA,listAgents:()=>listAgents(),readConfig,setKey,hermes:hcmd,editEnv,names:a=>NAMES[a]||(a==='default'?'aqeelOS':a),writeJson:(f,v)=>writeJsonAtomic(f,v),restart:why=>restartGateway(why).catch(()=>{}),
 own:{n8n:{owner:'aqeelOS',note:'every agent has its own n8n user',grant:a=>n8n.ensure(a)}},
 dash:(method,p)=>fetch(DASH.origin+p,{method,headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(r=>r.json().catch(()=>({})))});
const accessAsk=createAccessRequests({DATA,access,listAgents:()=>listAgents(),names:a=>NAMES[a]||(a==='default'?'aqeelOS':a)});
const n8n=createN8n({BASE:N8N_URL,readConfig,removeMcp:(a,name)=>fetch(DASH.origin+'/api/mcp/servers/'+encodeURIComponent(name)+'?profile='+encodeURIComponent(a),{method:'DELETE',headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok&&r.status!==404)throw new Error('Could not remove the tool ('+r.status+')');return true}),DATA,setKey,restart:why=>restartGateway(why).catch(()=>{}),names:a=>NAMES[a]||a});
const code=createCode({DATA,SRC:path.join(homedir(),'apps','aqeel-code'),PUBLIC_URL,ROOT:root});
// the box's own Code copy (online projects) is paired with this aqeelOS by itself, and again if its key is lost
if(LIVE_APP)setTimeout(async()=>{try{const f=path.join(homedir(),'apps','aqeel-code','data','aqeelos.json');let l={};try{l=JSON.parse(await readFile(f,'utf8'))}catch{}if(l.token&&await code.who(l.token))return;
 const token=await code.pair('owner','AI box · online');await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify({base:'http://127.0.0.1:'+PORT,token,user:'Aqeel',pairedAt:Date.now()},null,1),{mode:0o600});console.log('code: paired the online copy')}catch(e){console.warn('code: online pairing',e.message)}},8000).unref();
// After the server was off: tell the owner on the main agent's channel how long (it cannot report while it is off;
// a check from outside, .github/workflows/uptime.yml, emails while it is down). A heartbeat every minute marks it alive.
if(LIVE_APP){const HB=path.join(DATA,'heartbeat.json');readFile(HB,'utf8').then(t=>JSON.parse(t).t||0).catch(()=>0).then(last=>{const beat=()=>writeFile(HB,JSON.stringify({t:Date.now()})).catch(()=>{});beat();setInterval(beat,60000).unref();
 const gap=Date.now()-last;if(!last||gap<5*60e3)return;setTimeout(async()=>{try{const ch=await relay.channelsFor('default');const c=ch.find(x=>x.platform==='whatsapp')||ch[0];if(!c)return;
  const at=t=>new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}),mins=Math.round(gap/60000);
  await bottlenecks.event('down','aqeelOS was off for '+mins+' min','From about '+at(last)+' to '+at(Date.now())+' (Jakarta time). Everything started again by itself. If it happens often, check the server in the Contabo panel.').catch(()=>{});
  await relay.sendAs('default',c.owner,c.platform,'aqeelOS was off from about '+at(last)+' to '+at(Date.now())+' (Jakarta time, '+mins+' min). It is running again.',null,{toYou:true});console.log('told the owner about '+mins+' min off')}catch(e){console.warn('downtime note:',e.message)}},120000).unref()})}
const brand=createBrand({DATA});
const backups=createBackups({DATA,HOME:homedir(),HERMES_HOME,notify:(t,d)=>bottlenecks.event('backup',t,d+' Open System › Health to try again.').catch(()=>{})});if(PORT===4400)backups.schedule();
const live=createLive({DATA,DOMAIN:env.LIVE_DOMAIN||'app.elkiya.com'});
const bottlenecks=createBottlenecks({DATA,listAgents:()=>listAgents(),names:a=>NAMES[a]||a,dash:p=>fetch(DASH.origin+'/api'+p,{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)}).then(r=>r.json())});brand.name().then(n=>{globalThis.AQ_BRAND=n}).catch(()=>{});
const codeOnline=createCodeOnline({SECRET,SECURE:SECURE_COOKIE,users:()=>users,revokedAt:uid=>revoked[uid]||0,HOST:env.CODE_HOST||'code.elkiya.com',PREVIEW_HOST:env.CODE_PREVIEW_HOST||'code-preview.elkiya.com',HOME:PUBLIC_URL||'https://ai.elkiya.com'});
const localBrowser=createLocalBrowser({DATA,GATE:GATE.origin,API_KEY,EXT_DIR:path.join(root,'extension'),NAMES,PUBLIC_URL});
const links=createLinks({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,python:()=>sharing.python(),setupAgent:n=>setupAgentFn?.(n)});
function listAgents(){return agentNames()}   // real agents only (a folder with a config), not extra-number copies
async function listAllProfiles(){return [...await listAgents(),...(await links.list()).map(l=>l.name)]}
const gemini=createGemini({HERMES_HOME,hcmd,listAgents});
const antigravity=createAntigravity({HERMES_HOME,hcmd,listAgents});
async function agentModel(a){const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}}
const users=createUsers(DATA,mailer);
const starters=createStarters(DATA,{python:enginePython,root});
const me=async req=>{const id=cookieId(req);return id?await users.user(id):null};
// The agent a call is for: /gapi/p/<agent>/… or ?profile=<agent> (none = the main agent).
const agentOf=(p,q)=>{const m=/^\/gapi\/p\/([^/]+)/.exec(p);return m?decodeURIComponent(m[1]):q.get('profile')||q.get('agent')||'default'};

/* ---------- a person's call to Hermes: allowed? which chats come back? ---------- */
// An agent a member just created: they own it, it can chat (plugin, model, gateway key), and unless they
// may use the unsafe tools, terminal / files / code / computer use are switched off.
async function memberAgent(u,name){
 await users.created(u,name);noteMade(name);
 await setupAgentFn?.(name).catch(e=>console.warn('setup',name,e.message));
 if(!users.can(u,'unsafe'))await lockTools(name).catch(e=>console.warn('lock tools',name,e.message));
}
/* The engine's channel list is slow (it checks every connection, 5–20 s), and pages ask for it often.
   Keep each agent's answer for 15 s, share one request between everyone asking at once, and forget it as
   soon as a channel setting changes. */
// where MCP sign-ins come back: the public site (the engine is told this, see ensurePublicUrl)
const MCP_OAUTH_BASE=PUBLIC_URL+'/mcp-oauth';
// where each service keeps its redirect URLs, so the steps an agent gives are exact
const APP_SETTINGS={slack:['Slack','api.slack.com/apps → your app → OAuth & Permissions → Redirect URLs → Add New Redirect URL','Save URLs'],
 google:['Google','console.cloud.google.com/apis/credentials → your OAuth client (Web application) → Authorized redirect URIs → Add URI','Save'],
 github:['GitHub','github.com/settings/developers → OAuth Apps → your app → Authorization callback URL','Update application'],
 notion:['Notion','notion.so/my-integrations → your integration → Redirect URIs','Save changes'],
 microsoft:['Microsoft','portal.azure.com → App registrations → your app → Authentication → Web → Redirect URIs','Save'],
 hubspot:['HubSpot','developers.hubspot.com → your app → Auth → Redirect URLs','Save']};
const appSettings=(tool,url)=>{const k=Object.keys(APP_SETTINGS).find(k=>tool.toLowerCase().includes(k)||String(url||'').includes(k));return k?APP_SETTINGS[k]:[tool.charAt(0).toUpperCase()+tool.slice(1),'your '+tool+' app’s OAuth settings → Redirect URLs','Save']};
// agent|tool → open sign-in flow id, kept across restarts (the engine keeps the flow open meanwhile)
const FLOWS_FILE=path.join(DATA,'signin-flows.json');let signinFlows=new Map();
readFile(FLOWS_FILE,'utf8').then(t=>{signinFlows=new Map(Object.entries(JSON.parse(t)))}).catch(()=>{});
const saveFlows=()=>writeFile(FLOWS_FILE,JSON.stringify(Object.fromEntries(signinFlows))).catch(()=>{});
/* A sign-in started inside the chat engine (its own connector) waits on a private local listener; the public return
   page reaches it by trying the gateway's local listening ports (the listener checks the one-time state itself). */
async function deliverToGateway(search){try{const pid=JSON.parse(await readFile(path.join(HERMES_HOME,'gateway.pid'),'utf8')).pid;
  const inodes=new Set();for(const fd of await readdir('/proc/'+pid+'/fd').catch(()=>[])){const l=await readlink('/proc/'+pid+'/fd/'+fd).catch(()=>'');const m=/^socket:\[(\d+)\]$/.exec(l);if(m)inodes.add(m[1])}
  const ports=[];for(const line of (await readFile('/proc/net/tcp','utf8')).split('\n').slice(1)){const c=line.trim().split(/\s+/);if(c[3]==='0A'&&c[1]?.startsWith('0100007F:')&&inodes.has(c[9])){const port=parseInt(c[1].split(':')[1],16);if(![8642,8644,9119].includes(port))ports.push(port)}}
  for(const port of ports){const r=await fetch('http://127.0.0.1:'+port+'/callback'+search,{signal:AbortSignal.timeout(4000)}).catch(()=>null);if(r&&r.ok){console.log('sign-in delivered to the chat engine on',port);return true}}}catch(e){console.warn('deliverToGateway',e.message)}return false}
const linkSeen=new Map();   // flow|link → when that link was first handed out
async function startSignin(agent,tool){const k=agent+'|'+tool,prev=signinFlows.get(k),h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
 // a link still open is given again, but only while it is young: each link works for 5 minutes, after which the
 // engine quietly makes a new one, so an older link would fail when the person opens it
 if(prev){const f=await fetch(DASH.origin+'/api/mcp/oauth/flows/'+encodeURIComponent(prev),{headers:h}).then(r=>r.ok?r.json():null).catch(()=>null);
  const seen=linkSeen.get(prev+'|'+(f?.authorization_url||''));
  if(f&&f.authorization_url&&/authorization_required|pending/.test(f.status||'')&&seen&&Date.now()-seen<240e3)return f;
  if(f&&/authorization_required|pending/.test(f.status||''))await fetch(DASH.origin+'/api/mcp/oauth/flows/'+encodeURIComponent(prev),{method:'DELETE',headers:h}).catch(()=>{})}
 // a sign-in starts by deleting the saved tokens; keep a copy and put it back if this one doesn't finish
 const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),tok=path.join(home,'mcp-tokens',tool+'.json'),bak=tok+'.aqbak';
 await readFile(tok).then(b=>writeFile(bak,b,{mode:0o600})).catch(()=>{});
 setTimeout(async()=>{const has=await stat(tok).then(()=>true,()=>false);if(!has&&await stat(bak).then(()=>true,()=>false)){await rename(bak,tok).catch(()=>{});console.log('sign-in',agent,tool,'did not finish; put the earlier tokens back')}},6.5*60e3).unref?.();
 // the engine frees a cancelled sign-in a moment later, so retry briefly while it says "already in progress"
 let r,j;for(let i=0;i<8;i++){r=await fetch(DASH.origin+'/api/mcp/servers/'+encodeURIComponent(tool)+'/auth?profile='+encodeURIComponent(agent),{method:'POST',headers:h,body:'{}'});j=await r.json().catch(()=>({}));
  if(!/already in progress/i.test(j.detail||j.error||''))break;await new Promise(res=>setTimeout(res,1500))}
 if(/already in progress/i.test(j.detail||j.error||''))j.error='A sign-in for '+tool+' is already open. Use the link given a moment ago, or try again in a few minutes.';
 if(j.flow_id){signinFlows.set(k,j.flow_id);saveFlows();if(j.authorization_url)linkSeen.set(j.flow_id+'|'+j.authorization_url,Date.now())}if(!r.ok&&!j.error)j.error=j.detail||('HTTP '+r.status);return j}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOk=new Set();   // agents checked for their gateway key
const platCache=new Map();
/* The engine reports WhatsApp on any agent but the main one as "not set up", even when linked and connected (its
   check needs env keys WhatsApp doesn't have). The truth: switched on + a saved login (creds.json) = set up, and the
   live state the gateway records for "<agent>:whatsapp". */
async function trueWhatsApp(agent,v){const list=v?.platforms||v;if(!Array.isArray(list))return;const w=list.find(x=>x.id==='whatsapp');if(!w||(w.configured&&agent==='default'))return;
 const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent);
 const env=await readFile(path.join(home,'.env'),'utf8').catch(()=>'');const on=/^WHATSAPP_ENABLED=["']?true/im.test(env);
 const linked=await stat(path.join(home,'platforms','whatsapp','session','creds.json')).then(()=>true,()=>false);
 if(!(on&&linked))return;w.configured=true;w.enabled=true;
 try{const g=JSON.parse(await readFile(path.join(HERMES_HOME,'gateway_state.json'),'utf8'));const st=g.platforms?.[agent==='default'?'whatsapp':agent+':whatsapp'];
  if(st){w.state=st.state||w.state;w.error_message=st.error_message||null;w.error_code=st.error_code||null}else if(w.state==='not_configured')w.state='starting'}catch{}}
/* Which account each channel is: the WhatsApp number and name from its saved login, the Telegram bot's
   @username (asked from Telegram once an hour). A WhatsApp whose login WhatsApp ended (logged out on the phone,
   or the bridge stopped) is marked needs_link, so every screen offers the same "Link again". */
const PAUSED_FILE=path.join(DATA,'channel-paused.json');
const pausedLoad=async()=>{try{return JSON.parse(await readFile(PAUSED_FILE,'utf8'))}catch{return {}}};
const pausedSave=async v=>{await writeFile(PAUSED_FILE+'.tmp',JSON.stringify(v,null,1));await rename(PAUSED_FILE+'.tmp',PAUSED_FILE)};
/* Pause / resume a channel: the engine's own on/off (an explicit "off" beats a saved login or token), so a paused
   WhatsApp keeps its link and a paused Telegram its bot; picking an agent again turns it on with no new QR. */
async function setChannelOn(agent,platform,on){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
 const r=await fetch(DASH.origin+'/api/messaging/platforms/'+encodeURIComponent(platform)+'?profile='+encodeURIComponent(agent),{method:'PUT',headers:h,body:JSON.stringify({enabled:on,env:{},profile:agent})});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||'The engine did not accept the change.');
 const ps=await pausedLoad();const k=agent+'|'+platform;if(on)delete ps[k];else ps[k]={t:Date.now()};await pausedSave(ps);platCache.clear();attention.t=0;
 const afterOff=()=>platform==='whatsapp'&&!on?stopBridges(agent).catch(()=>{}):null;   // its connection stops too; the login stays
 if(!j.hot_served)restartGateway((on?'resumed ':'paused ')+platform+' on '+agent).then(afterOff).catch(()=>{});else setTimeout(afterOff,3000);
 console.log('channel',platform,'on',agent,on?'resumed':'paused');return {ok:true,paused:!on,restarting:!j.hot_served,waiting:liveCount()}}
const tgNames=new Map();
/* The engine reports "gateway stopped" for apps on a second agent although the shared engine serves them (it only
   records live state for the main agent). The truth is in the engine's own log: its last "✓ <app> connected /
   disconnected (profile: <agent>)" line for that agent. */
let gwLog={t:0,text:''};
async function gatewayLog(){if(Date.now()-gwLog.t>8000){const {execFile}=await import('node:child_process');gwLog={t:Date.now(),text:await new Promise(r=>execFile('tail',['-n','4000',path.join(HERMES_HOME,'logs','gateway.log')],{maxBuffer:8e6},(e,o)=>r(String(o||''))))}}return gwLog.text}
async function trueStates(agent,v){const list=v?.platforms||v;if(!Array.isArray(list)||agent==='default')return;const log=await gatewayLog();
 for(const c of list){if(c.id==='whatsapp'||['api_server','webhook'].includes(c.id)||!/stopped|not_running|starting|pending_restart|restart/.test(String(c.state||'')))continue;
  const esc_=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp('✓ '+esc_(c.id)+' (connected|disconnected)[^\\n]*\\(profile: '+esc_(agent)+'\\)|✗ '+esc_(c.id)+' failed to connect \\(profile: '+esc_(agent)+'\\)','g');
  let last=null,m;while((m=re.exec(log)))last=m;if(!last)continue;
  const p=await gatewayPid();if(!p)continue;   // the engine is not running at all: keep what it says
  c.state=last[1]==='connected'?'connected':last[1]==='disconnected'?'disconnected':'failed';if(c.state==='connected'){c.configured=true;c.enabled=true}}}
async function channelAccounts(agent,v){await trueStates(agent,v).catch(()=>{});const list=v?.platforms||v;if(!Array.isArray(list))return;const ps=await pausedLoad();for(const c of list)if(ps[agent+'|'+c.id]){c.paused=true;c.state='paused'}const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent);
 const w=list.find(x=>x.id==='whatsapp');
 if(w){try{const c=JSON.parse(await readFile(path.join(home,'platforms','whatsapp','session','creds.json'),'utf8'));const id=String(c.me?.id||c.me?.lid||'');const digits=id.split('@')[0].split(':')[0].replace(/\D/g,'');
   w.account={phone:digits?'+'+digits:null,name:c.me?.name||c.me?.verifiedName||null}}catch{}
  const err=(w.error_code||'')+' '+(w.error_message||'');const log=await readFile(path.join(home,'platforms','whatsapp','bridge.log'),'utf8').then(t=>t.slice(-3000)).catch(()=>'');
  const lastOut=log.lastIndexOf('Logged out'),lastOk=log.lastIndexOf('WhatsApp connected');
  w.needs_link=!w.paused&&w.state!=='connected'&&(!!w.account||w.configured)&&(/logged out|died|exit|bridge_exited|unlinked/i.test(err)||lastOut>lastOk)}
 const t=list.find(x=>x.id==='telegram');
 if(t&&(t.configured||t.state==='connected')){const tok=((await readFile(path.join(home,'.env'),'utf8').catch(()=>'')).match(/^TELEGRAM_BOT_TOKEN=["']?([^"'\n]+)/m)||[])[1];
  if(tok){let n=tgNames.get(tok);if(!n||Date.now()-n.t>3600e3){const j=await fetch('https://api.telegram.org/bot'+tok+'/getMe',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);n={t:Date.now(),v:j?.ok?{username:'@'+j.result.username,name:j.result.first_name||null}:n?.v||null};tgNames.set(tok,n)}
   if(n.v)t.account=n.v}}
 // Slack: which workspace, and whether it posts as a bot app or as a person's own Slack account
 const sl=list.find(x=>x.id==='slack');
 if(sl&&(sl.configured||sl.state==='connected')){const envT=await readFile(path.join(home,'.env'),'utf8').catch(()=>'');const tok=(envT.match(/^SLACK_BOT_TOKEN=["']?([^"'\n]+)/m)||envT.match(/^SLACK_USER_TOKEN=["']?([^"'\n]+)/m)||[])[1];
  if(tok){let n=tgNames.get(tok);if(!n||Date.now()-n.t>3600e3){const j=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);n={t:Date.now(),v:j?.ok?{username:j.user?'@'+j.user:null,name:j.team||null,kind:tok.startsWith('xoxp-')?'person':'bot'}:n?.v||null};tgNames.set(tok,n)}
   if(n.v)sl.account=n.v}}
 // what kind of account each one is: a bot, or someone's own account
 for(const c of list){if(!c.account)continue;c.account.kind??=c.id==='whatsapp'?'person':/^(telegram|discord)$/.test(c.id)?'bot':undefined}
 const notes=await readFile(path.join(DATA,'channel-notes.json'),'utf8').then(JSON.parse).catch(()=>({}));for(const c of list){const n=notes[agent+'|'+c.id];if(n)c.note=n}}
// The main agent's list takes seconds (each channel is checked), and many screens ask for it, so the last answer
// is used at once and refreshed behind the scenes (a change on the Channels page clears it, so that stays exact).
function platformsCached(agent){const k=agent||'default';const c=platCache.get(k);if(c&&(c.p||Date.now()-c.t<15000))return c.p||Promise.resolve(c.v);
 if(c?.v&&Date.now()-c.t<600000){if(!c.r){c.r=1;platformsFresh(k).catch(()=>{})}return Promise.resolve(c.v)}
 return platformsFresh(k)}
function platformsFresh(k){const old=platCache.get(k);
 const p=fetch(DASH.origin+'/api/messaging/platforms?profile='+encodeURIComponent(k),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(async r=>{const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.detail||'HTTP '+r.status),{status:r.status});await trueWhatsApp(k,v);await channelAccounts(k,v).catch(()=>{});platCache.set(k,{t:Date.now(),v});return v}).catch(e=>{if(old?.v)platCache.set(k,{t:Date.now()-10000,v:old.v});else platCache.delete(k);throw e});
 if(!old?.v)platCache.set(k,{p});return p}
/* An agent's skills: the engine reads every skill folder on each ask (1 to 3 s, longer when several agents are asked
   at once), and Skills asks every agent. The last answer is used while the skill folders and config.yaml are unchanged
   (a new, removed or switched skill shows at once); after a minute it is refreshed behind the scenes for edited text. */
const skCache=new Map();
async function skillsStamp(a){const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),dir=path.join(home,'skills');
 const t=async f=>(await stat(f).catch(()=>null))?.mtimeMs||0;const subs=await readdir(dir,{withFileTypes:true}).catch(()=>[]);
 return [await t(path.join(home,'config.yaml')),await t(dir),...await Promise.all(subs.filter(d=>d.isDirectory()||d.isSymbolicLink()).map(d=>t(path.join(dir,d.name))))].join(',')}
async function skillsCached(a){const c=skCache.get(a),stamp=await skillsStamp(a);
 if(c?.v&&c.stamp===stamp&&Date.now()-c.t<600000){if(Date.now()-c.t>60000&&!c.r){c.r=1;skillsFresh(a,stamp).catch(()=>{})}return c.v}
 return skillsFresh(a,stamp)}
function skillsFresh(a,stamp){const c=skCache.get(a);if(c?.p&&c.stamp===stamp)return c.p;
 const p=fetch(DASH.origin+'/api/skills?profile='+encodeURIComponent(a),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(async r=>{const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.detail||'HTTP '+r.status),{status:r.status});
  if(skCache.get(a)?.p===p)skCache.set(a,{t:Date.now(),v,stamp});return v}).catch(e=>{const n=skCache.get(a);if(n?.p===p){if(n.v)skCache.set(a,{t:n.t,v:n.v,stamp:n.stamp});else skCache.delete(a)}throw e});
 skCache.set(a,{...(c?.stamp===stamp?c:{}),p,stamp});return p}
/* A WhatsApp just paired: stop the pairing connection first (two connections on one login make WhatsApp end
   it), switch the channel on with the engine's own save, and restart the engine the proper way only if the
   running engine cannot pick it up by itself (extra agents are picked up live; the main agent needs a restart). */
async function finishWhatsAppLink(agent,pid,b){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};const pq='?profile='+encodeURIComponent(agent);
 const st=await fetch(DASH.origin+'/api/messaging/whatsapp/onboarding/'+encodeURIComponent(pid),{headers:h}).then(r=>r.json()).catch(()=>({}));
 if(st.status!=='connected')throw Object.assign(new Error('WhatsApp is not linked yet. Scan the code first.'),{status:409});
 await fetch(DASH.origin+'/api/messaging/whatsapp/onboarding/'+encodeURIComponent(pid),{method:'DELETE',headers:h}).catch(()=>{});
 await stopBridges(agent,{pairOnly:true});
 const env={WHATSAPP_ENABLED:'true',WHATSAPP_MODE:String(b.mode||st.mode||'bot'),WHATSAPP_DM_POLICY:'pairing'};if(b.allowed_users)env.WHATSAPP_ALLOWED_USERS=String(b.allowed_users);
 const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp'+pq,{method:'PUT',headers:h,body:JSON.stringify({enabled:true,env,profile:agent})});const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.detail||j.error||'Could not switch WhatsApp on.');
 platCache.clear();const waiting=liveCount();
 if(!j.hot_served)restartGateway('WhatsApp linked on '+agent).catch(()=>{});
 console.log('whatsapp linked on',agent,st.account_phone?'(+'+st.account_phone+')':'',j.hot_served?'· picked up live':'· engine restarting');
 setTimeout(()=>syncNotifyTool().catch(()=>{}),20000);
 return {ok:true,hot_served:!!j.hot_served,restarting:!j.hot_served,waiting,account:{phone:st.account_phone?'+'+st.account_phone:null,name:st.account_name||null}}}
// every bridge.js using this agent's WhatsApp login (or only the pairing one)
async function stopBridges(agent,{pairOnly=false}={}){const dir=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'platforms','whatsapp','session');
 const {execFile}=await import('node:child_process');const out=await new Promise(r=>execFile('ps',['-eo','pid=,args='],(e,o)=>r(String(o||''))));
 const pids=out.split('\n').filter(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)&&(!pairOnly||l.includes('--pair-only'))).map(l=>+l.trim().split(/\s+/)[0]).filter(Boolean);
 for(const pid of pids){try{process.kill(pid,'SIGTERM')}catch{}}if(pids.length)await new Promise(r=>setTimeout(r,1500));for(const pid of pids){try{process.kill(pid,'SIGKILL')}catch{}}return pids.length}
/* Channel checks. "Check connection" asks the engine fresh and, for WhatsApp, also looks for its running bridge.
   Every 2 hours (live app) every agent's channels are checked the same way; a logged-out or failing one is listed
   in /ui/channels/attention, which the app shows as a pop-up with Link again / Remove. */
async function checkChannel(agent,platform){platCache.delete(agent);const pl=await platformsCached(agent);const c=(pl?.platforms||pl||[]).find(x=>x.id===platform);
 if(!c)return {state:'missing',connected:false,text:'This channel is not set up on '+(NAMES[agent]||agent)+'.'};
 if(c.paused)return {agent,platform,state:'paused',connected:false,paused:true,account:c.account||null,text:'Paused: still linked'+(c.account?' ('+[c.account.phone||c.account.username,c.account.name].filter(Boolean).join(' · ')+')':'')+', but no agent answers it. Pick an agent under Owned by to turn it back on.'};
 let bridge=true;if(platform==='whatsapp'){const dir=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'platforms','whatsapp','session');
  const {execFile}=await import('node:child_process');const out=await new Promise(r=>execFile('ps',['-eo','args='],(e,o)=>r(String(o||''))));bridge=out.split('\n').some(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)&&!l.includes('--pair-only'))}
 const connected=c.state==='connected'&&bridge;const acct=c.account?' ('+[c.account.phone||c.account.username,c.account.name].filter(Boolean).join(' · ')+')':'';
 const text=connected?'Connected'+acct+'. Messages are coming in.':c.needs_link?'Logged out'+acct+': the phone removed this linked device, or WhatsApp ended the link. Link it again with a fresh QR code, or remove it.':
  c.state==='connected'&&!bridge?'The engine says connected, but the WhatsApp connection is not running. Restart the engine, or link it again.':
  /retrying|connecting|starting/.test(c.state||'')?'Reconnecting right now. Check again in a minute.':(c.enabled===false?'Switched off.':'Not connected'+(c.error_message?': '+String(c.error_message).replace(/\s*\(see \/[^)]*\)/,'').slice(0,160):'.'));
 return {agent,platform,state:c.state,connected,needs_link:!!c.needs_link,account:c.account||null,text}}
let attention={t:0,list:[]};
async function channelAttention(fresh){if(!fresh&&Date.now()-attention.t<10*60e3)return attention.list;const list=[];
 for(const a of await listAllProfiles()){if(fresh)platCache.delete(a);const pl=await platformsCached(a).catch(()=>null);
  for(const c of (pl?.platforms||pl||[])){if(['api_server','webhook'].includes(c.id)||!(c.configured||c.account))continue;
   if(!c.paused&&(c.needs_link||(c.enabled&&/fatal|error|failed/.test(c.state||''))))list.push({agent:a,base:a.split('--')[0],id:c.id,name:c.name,account:c.account||null,needs_link:!!c.needs_link,state:c.state})}}
 const before=new Set(attention.list.map(x=>x.agent+'|'+x.id));for(const x of list)if(!before.has(x.agent+'|'+x.id))console.warn('channel check:',x.name,'on',x.agent,x.needs_link?'is logged out':'is '+x.state);
 attention={t:Date.now(),list};return list}
if(PORT===4400){setTimeout(()=>channelAttention(true).catch(()=>{}),90e3);setInterval(()=>channelAttention(true).catch(()=>{}),2*3600e3).unref()}
/* WhatsApp that stays connected. Every 10 minutes (live app) a linked number that dropped is reconnected on its own,
   with its saved login (no new QR): only that number's connection restarts, never the engine. The main agent's own
   channels live inside the engine, so those are only reported (the pop-up and the bell say so). A number is tried at
   most 3 times in 6 hours; after that it waits for a person. Once a day every WhatsApp login is backed up (last 3 kept),
   so a damaged login can be put back instead of linking again. */
const waTries=new Map(),waLinking=new Map();   // agent → when someone last started linking its WhatsApp
async function reconnectOne(ag,pf){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
 const put=on=>fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:on,env:{},profile:ag})}).then(r=>r.json()).catch(()=>({}));
 await put(false);if(pf==='whatsapp')await stopBridges(ag).catch(()=>{});await new Promise(r=>setTimeout(r,2500));const j=await put(true);platCache.delete(ag);attention.t=0;return j}
async function waGuard(){if(gwRestarting)return;
 for(const a of await listAllProfiles()){if(a==='default')continue;
  const sess=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session');if(!await stat(path.join(sess,'creds.json')).catch(()=>null))continue;
  if(Date.now()-(waLinking.get(a)||0)<20*60e3)continue;{const ps=(await shx('ps -eo args')).out||'';if(ps.split('\n').some(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--pair-only')&&l.includes(sess)))continue}
  const st=await checkChannel(a,'whatsapp').catch(()=>null);if(!st||st.state==='missing'||st.paused||st.connected||st.needs_link)continue;
  if(/retrying|connecting|starting/.test(st.state||''))continue;   // already on its way back
  const now=Date.now(),l=(waTries.get(a)||[]).filter(t=>now-t<6*3600e3);if(l.length>=3||l.some(t=>now-t<30*60e3))continue;
  l.push(now);waTries.set(a,l);console.warn('whatsapp guard:',a,'dropped ('+(st.state||'?')+'), reconnecting with its saved login');
  await reconnectOne(a,'whatsapp').catch(e=>console.warn('whatsapp guard:',a,e.message));
  await new Promise(r=>setTimeout(r,20000));const after=await checkChannel(a,'whatsapp').catch(()=>null);console.log('whatsapp guard:',a,after?.connected?'back online':'still not connected ('+(after?.state||'?')+')')}}
async function waBackup(){const {execFile}=await import('node:child_process');const day=new Date().toISOString().slice(0,10);
 for(const a of await listAllProfiles()){const dir=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session');
  if(!await stat(path.join(dir,'creds.json')).catch(()=>null))continue;const to=path.join(DATA,'wa-backup',a);await mkdir(to,{recursive:true});const f=path.join(to,day+'.tgz');if(await stat(f).catch(()=>null))continue;
  try{JSON.parse(await readFile(path.join(dir,'creds.json'),'utf8'))}catch{continue}
  const ok=await new Promise(r=>execFile('tar',['-czf',f,'-C',dir,'.'],{timeout:120000},e=>r(!e)));if(!ok){await unlink(f).catch(()=>{});continue}
  const old=(await readdir(to)).filter(x=>/^\d{4}-\d\d-\d\d\.tgz$/.test(x)).sort().slice(0,-3);for(const x of old)await unlink(path.join(to,x)).catch(()=>{});console.log('whatsapp login backed up for',a)}}
if(PORT===4400){setInterval(()=>waGuard().catch(e=>console.warn('whatsapp guard',e.message)),10*60e3).unref();setTimeout(()=>waBackup().catch(()=>{}),5*60e3).unref();setInterval(()=>waBackup().catch(()=>{}),6*3600e3).unref()}
/* Secrets the agent asks for (ask_secret): the person types them into a protected field in the chat, and the value
   goes straight where it is needed (typed into the agent's screen, or saved as a key). It never enters the
   conversation, the logs or the agent's context. A request waits about 4½ minutes (the engine gives a tool call 5). */
const secretAsks=new Map();
function askSecret(agent,a){return new Promise(resolve=>{const id=randomBytes(9).toString('base64url');
 const rec={id,agent,base:agent.split('--')[0],label:String(a.label||'A password or key').slice(0,140),mode:a.mode==='save'?'save':'type',name:String(a.name||'').trim().toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,60),enter:!!a.press_enter,t:Date.now(),resolve};
 if(rec.mode==='save'&&!/^[A-Z][A-Z0-9_]{1,59}$/.test(rec.name))return resolve({text:'For mode "save", give the key a name in capitals, like OPENAI_API_KEY, and ask again.',isError:true});
 secretAsks.set(id,rec);console.log('secret asked by',agent+':',rec.label,'('+rec.mode+')');
 setTimeout(()=>{if(secretAsks.get(id)===rec){secretAsks.delete(id);resolve({text:'The person did not fill in the protected field in time. Ask again if you still need it.',isError:true})}},270000)})}
const secretDir=base=>path.join(homedir(),'workspaces',base,'.secrets');
const RESERVED_KEY=/^(API_SERVER_|HERMES_|TELEGRAM_|WHATSAPP_|SLACK_|DISCORD_|SIGNAL_|MATRIX_|EMAIL_|SMS_|TWILIO_|GATEWAY_|DASHBOARD_|UI_)|_BASE_URL$|^(PATH|HOME|NODE_OPTIONS|PYTHONPATH|LD_PRELOAD)$/;
async function saveSecret(base,name,value,{admin=false}={}){if(!admin&&RESERVED_KEY.test(name))throw new Error(name+' is part of how aqeelOS itself is wired; pick another name for this secret.');const home=base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base);
 await editEnv(path.join(home,'.env'),cur=>{const lines=cur.split('\n').filter(l=>!l.startsWith(name+'='));while(lines.length&&lines[lines.length-1]==='')lines.pop();return [...lines,name+'='+value.replace(/[\r\n]/g,''),''].join('\n')});
 const dir=secretDir(base);await mkdir(dir,{recursive:true,mode:0o770});await writeFile(path.join(dir,name),value,{mode:0o660})}   // group-shared: an agent with its own user reads its own lock box; still closed to other agents
const secretHow=(base,name)=>'To enter it on your screen, click the field and call type_secret with name '+name+'. In a command use "$(cat ~/workspaces/'+base+'/.secrets/'+name+')". Never print, echo or show the value.';
async function useSecret(rec,value,{admin=false}={}){
 if(rec.mode==='type'){await screens.typeInto(rec.base,value,{enter:rec.enter});return 'Typed it into the focused field on your screen'+(rec.enter?' and pressed Enter':'')+'. You never saw the value; take a screenshot to check the result.'}
 await saveSecret(rec.base,rec.name,value,{admin});
 return 'Saved as '+rec.name+' in your settings (the engine and its tools read it from there). '+secretHow(rec.base,rec.name)}
/* "Which browser?" An agent about to work in a browser asks (choose_browser) once per chat: the person's own
   Chrome (one-off jobs where they are already signed in) or the agent's screen on the AI box (anything that must
   keep running). The person answers on a card in the chat; their answer links that chat to their browser or not. */
const browserAsks=new Map();
function askBrowser(agent,a){return new Promise(resolve=>{const id=randomBytes(9).toString('base64url');
 const rec={id,kind:'browser',agent,base:agent.split('--')[0],task:String(a.task||'a browser job').slice(0,160),suggest:a.suggest==='yours'?'yours':'server',why:String(a.why||'').slice(0,220),t:Date.now(),resolve};browserAsks.set(id,rec);
 setTimeout(()=>{if(browserAsks.get(id)===rec){browserAsks.delete(id);resolve({text:'The person did not choose in time. Use your own screen on the AI box and tell them you did.'})}},270000)})}
// a web address that ends up inside the box or on a private network, however it is spelled (user@host, numeric,
// IPv6-mapped, a name that resolves privately): refused for tools a member adds
async function privateAddress(u){let url;try{url=new URL(String(u))}catch{return true}if(!/^https?:$/.test(url.protocol))return true;
 const host=url.hostname.replace(/^\[|\]$/g,'');const {lookup}=await import('node:dns/promises');const {isIP}=await import('node:net');
 let addrs=[];try{addrs=isIP(host)?[{address:host}]:await lookup(host,{all:true,verbatim:true})}catch{return true}
 const bad=a=>{a=String(a).toLowerCase();const m=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);if(m)a=m[1];
  const h=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);if(h){const x=parseInt(h[1],16),y=parseInt(h[2],16);a=[x>>8,x&255,y>>8,y&255].join('.')}
  if(/^\d+\.\d+\.\d+\.\d+$/.test(a)){const [x,y]=a.split('.').map(Number);return x===0||x===10||x===127||(x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&y===168)||(x===100&&y>=64&&y<=127)||x>=224}
  return a==='::'||a==='::1'||/^f[cd]/.test(a)||/^fe[89ab]/.test(a)};
 return !addrs.length||addrs.some(x=>bad(x.address))}
async function hermesCall(req,res,u,url){
 const p=url.pathname,q=url.searchParams,agent=agentOf(p,q);
 if(['profile','path','name','agent'].some(k=>q.getAll(k).length>1))return send(res,400,{error:'Each setting may appear only once.'});
 const no=users.gate(u,p,req.method,q,agent);if(no)return send(res,no.status,{error:no.error});
 {const rm=/\/v1\/runs\/([^/]+)/.exec(p);if(rm&&!users.isAdmin(u)){const own=runOwner.get(decodeURIComponent(rm[1]));if(!own||own.user!==u.id)return send(res,403,{error:'That reply is not yours.'})}}
 if(p.startsWith('/gapi/p/')&&agent&&agent!=='default'&&!keyOk.has(agent)){const envF=path.join(HERMES_HOME,'profiles',agent,'.env');const e=await readFile(envF,'utf8').catch(()=>null);
  if(e!==null){if(!/^API_SERVER_KEY=/m.test(e)&&API_KEY){await writeFile(envF,(e&&!e.endsWith('\n')?e+'\n':e)+'API_SERVER_KEY='+API_KEY+'\n',{mode:0o600});console.log('added the missing gateway key for',agent);await new Promise(r=>setTimeout(r,1500))}keyOk.add(agent)}}
 if(p==='/hapi/messaging/platforms'&&req.method==='GET'){try{return send(res,200,await platformsCached(q.get('profile')||'default'))}catch(e){return send(res,e.status||502,{error:e.message})}}
 if(p.startsWith('/hapi/messaging/')&&req.method!=='GET')platCache.clear();
 if(p==='/hapi/skills'&&req.method==='GET'&&/^[\w-]+$/.test(agent||'default')){try{return send(res,200,await skillsCached(agent||'default'))}catch(e){return send(res,e.status||502,{error:e.message})}}
 if(/^\/hapi\/(skills|config)/.test(p)&&req.method!=='GET')skCache.clear();
 if(/^\/hapi\/messaging\/whatsapp\/onboarding/.test(p)&&req.method==='POST')waLinking.set(q.get('profile')||'default',Date.now());   // someone is linking: the WhatsApp guard stays away
 {const am=/^\/hapi\/messaging\/whatsapp\/onboarding\/([^/]+)\/apply$/.exec(p);
  if(am&&req.method==='POST'){const ag=q.get('profile')||'default';let b={};try{b=JSON.parse((await readRaw(req,65536)).toString('utf8')||'{}')}catch{}
   try{return send(res,200,await finishWhatsAppLink(ag,decodeURIComponent(am[1]),b))}catch(e){return send(res,e.status||400,{error:e.message})}}}
 // channel set-up (WhatsApp QR, Telegram bot…) reads the agent from the request BODY, not the address; without it
 // the engine pairs the main agent instead (Husband Mode's WhatsApp "never paired"). Always pass it along.
 let body;
 // Same for every change the engine scopes by body (pairing approvals, chat import/update…): if the address names the
 // agent and the JSON body doesn't, the body gets it too. Uploads and non-JSON bodies are left alone.
 // An engine update starts from the engine's own files: aqeelOS's renames (aqeelOS instead of Hermes in what people
 // read) are put back to the original first, so the update never clashes with them; they are applied again after it.
 if(p==='/hapi/hermes/update'&&req.method==='POST'&&users.isAdmin(u)){const r=await shx('git -C ~/.hermes/hermes-agent checkout -- . 2>&1');console.log('engine update: renamed files reset first',r.ok?'':'('+String(r.out||'').slice(0,120)+')');engineHead.v=null;setTimeout(()=>engineWatch().catch(()=>{}),120000)}
 if(p.startsWith('/hapi/')&&req.method!=='GET'&&q.get('profile')&&/json/.test(String(req.headers['content-type']||''))&&!p.startsWith('/hapi/files')){let b=null,raw;
  // the body is read up front, so a bad one is answered here (passing it on would forward a body that is already gone)
  try{raw=(await readRaw(req,30e6)).toString('utf8')}catch{return send(res,413,{error:'That is too large to send.'})}try{b=raw?JSON.parse(raw):{}}catch{return send(res,400,{error:'The request body is not valid JSON.'})}
  if(b&&typeof b==='object'&&!Array.isArray(b)&&(!b.profile||!users.isAdmin(u)))b.profile=q.get('profile');if(b!==null)body=Buffer.from(JSON.stringify(b))}
 // a member's JSON body without ?profile= may not name another agent either
 if(!users.isAdmin(u)&&!q.get('profile')&&p.startsWith('/hapi/')&&req.method!=='GET'&&body===undefined&&/json/.test(String(req.headers['content-type']||''))&&!p.startsWith('/hapi/files')){const raw=await readRaw(req,30e6);body=raw;try{const b=JSON.parse(raw.toString('utf8')||'null');if(b&&typeof b==='object'&&!Array.isArray(b)&&b.profile&&b.profile!==(agent||'default'))return send(res,403,{error:'That agent is not shared with you.'})}catch{}}
 // a member's file calls must stay in their own folder
 if(!users.isAdmin(u)&&p.startsWith('/hapi/files')){
  if(req.method==='GET'){if(!users.filePathOk(u,q.get('path')||users.home(u)))return send(res,403,{error:'That folder is not yours.'})}
  else{const raw=await readRaw(req,p.endsWith('upload-stream')?200e6:65536);body=raw;
   let fp=null;if(p.endsWith('upload-stream')){const t=raw.toString('latin1');if((t.match(/name="path"/g)||[]).length!==1)return send(res,400,{error:'Upload one file location at a time.'});fp=(/name="path"\r\n\r\n([^\r\n]*)/.exec(t)||[])[1]}else{try{fp=JSON.parse(raw.toString('utf8')).path}catch{}}
   if(!users.filePathOk(u,fp))return send(res,403,{error:'That folder is not yours.'})}}
 // a member's message: within their daily limit, and only on models they may use
 const chatM=/^\/gapi(?:\/p\/[^/]+)?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p);
 if(chatM&&!users.isAdmin(u)&&req.method==='POST'){
  const lim=users.limitOf(u);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),u.id,users.ownerOf);if(t.tokens+await code.usedToday(u.id)>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
  const allowed=users.allowedModels(u);if(allowed){let b={};try{b=JSON.parse((await readRaw(req,40e6)).toString('utf8'))}catch{}
   if(b.model){if(!users.modelOk(u,b.provider||'',b.model))return send(res,403,{error:'You can\'t use that model. Ask the owner.'})}
   else{const d=await agentModel(agent);if(!users.modelOk(u,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');if(m.length){b.provider=pv;b.model=m.join('|')}else b.model=pv}}
   body=Buffer.from(JSON.stringify(b))}}
 let relayTarget=undefined,relayJob=null;
 const cronM=/^\/hapi\/cron\/jobs(?:\/([^/]+))?$/.exec(p);
 if(cronM&&(req.method==='POST'&&!cronM[1]||req.method==='PUT'&&cronM[1])){let b={};try{b=JSON.parse((body||await readRaw(req,262144)).toString('utf8'))}catch{}
  const holder=req.method==='PUT'?(b.updates||{}):b;const dv=String(holder.deliver||'');
  if(dv.startsWith('relay:')){const [owner,platform]=dv.slice(6).split('|');relayTarget={owner,platform};holder.deliver='local'}else if('deliver' in holder)relayTarget=null;
  relayJob=cronM[1]||null;body=Buffer.from(JSON.stringify(b))}
 // deleting an agent: keep a full copy first (30 days), so it can be restored from Agents › Recently deleted
 const delM=/^\/hapi\/profiles\/([^/]+)$/.exec(p);
 // a delete waits for the agent's setup and settings changes to finish (a command running during a delete leaves a ghost folder)
 if(delM&&req.method==='DELETE'){const n=decodeURIComponent(delM[1]);await export_setups.wait(n).catch(()=>{});await withAgent(n,()=>{})}
 if(delM&&req.method==='DELETE'){const name=decodeURIComponent(delM[1]);if(name!=='default'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)&&!/^(rl|nt|lk|dp|kp|sh-a|sh-b)-/.test(name)){
   const dir=path.join(HERMES_HOME,'profiles',name),trash=path.join(DATA,'agent-trash');await mkdir(trash,{recursive:true});
   const file=path.join(trash,name+'__'+new Date().toISOString().replace(/[:.]/g,'-')+'.tgz');const {execFile}=await import('node:child_process');
   // tar exits 1 when a file changed while it was read (a busy agent); the backup is still good if it was written
   const ok=await new Promise(r=>execFile('tar',['-czf',file,'--warning=no-file-changed','--ignore-failed-read','--exclude=./cache','--exclude=./sandboxes','-C',dir,'.'],{timeout:180000,maxBuffer:1e6},e=>r(!e||e.code===1)))&&(await stat(file).then(x=>x.size>0,()=>false));
   if(!ok)return send(res,500,{error:'Could not save a backup of this agent first, so it was not deleted.'})}}
 if(p==='/hapi/gateway/stop'&&req.method==='POST'&&(q.get('profile')||'default')==='default')gwStopped=true;   // a deliberate stop: the watch leaves it stopped
 // deleting an agent also removes its extra numbers (copies) and takes it out of channel sharing
 if(delM&&req.method==='DELETE'){const gone=decodeURIComponent(delM[1]);if(!gone.includes('--')){for(const l of await links.list(gone).catch(()=>[]))await links.remove(l.name).catch(e=>console.warn('remove copy',l.name,e.message));
  setTimeout(async()=>{if(await isAgent(gone))return;await users.dropAgent(gone).catch(()=>{});const {rm}=await import('node:fs/promises');
   // anything the engine left behind (a bare logs/ folder) and an agent folder holding only aqeelOS's own notes
   await rm(path.join(HERMES_HOME,'profiles',gone),{recursive:true,force:true}).catch(()=>{});
   const ws=path.join(homedir(),'workspaces',gone);if((await readdir(ws).catch(()=>['?'])).every(x=>x==='AGENTS.md'))await rm(ws,{recursive:true,force:true}).catch(()=>{});
   await setStatus(gone,null);const sh=await relay.shares().catch(()=>({}));
   for(const [k,v] of Object.entries(sh)){const [owner,platform]=k.split('|');if(owner===gone)await relay.setShare(owner,platform,{senders:[],chat:''}).catch(()=>{});else if((v.senders||[]).includes(gone))await relay.setShare(owner,platform,{senders:v.senders.filter(x=>x!==gone),chat:v.chat}).catch(()=>{})}
   syncNotifyTool().catch(()=>{});if(PORT===4400)writeAgentContext().catch(()=>{});console.log('cleaned up after deleting',gone)},20000)}}
 {const whM=/^\/hapi\/webhooks(?:\/([^/]+))?(\/enabled)?$/.exec(p),wa=q.get('profile')||'default';
  // one webhook list serves every agent (the main agent's); each entry is bound to the agent it runs as
  if(whM&&!wa.includes('--')&&req.method==='GET'&&!whM[1]){const h={'x-hermes-session-token':DASH_TOKEN};
   const d=await fetch(DASH.origin+'/api/webhooks?profile=default',{headers:h}).then(r=>r.json()).catch(()=>({}));
   let store={};try{store=JSON.parse(await readFile(path.join(HERMES_HOME,'webhook_subscriptions.json'),'utf8'))}catch{}
   const subs=(d.subscriptions||[]).map(x=>{const ag=(store[x.name]?.profile)||'default';return {...x,agent:ag,url_path:ag==='default'?'/webhooks/'+x.name:'/webhooks/'+ag+'/'+x.name}}).filter(x=>x.agent===wa);
   return send(res,200,{...d,subscriptions:subs})}
  // turning webhooks on is for the one shared listener (the main agent's)
  if(whM&&whM[1]==='enable'&&req.method==='POST'&&wa!=='default'){req.url=req.url.replace(/([?&]profile=)[^&]*/,'$1default');let b={};try{b=JSON.parse((body||Buffer.from('{}')).toString('utf8')||'{}')}catch{}b.profile='default';body=Buffer.from(JSON.stringify(b))}
  if(whM&&wa!=='default'&&!wa.includes('--')){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
   if(req.method==='POST'&&!whM[1]){let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}
    const name=String(b.name||'').trim().toLowerCase().replace(/ /g,'-');if(!/^[a-z0-9][a-z0-9_-]*$/.test(name))return send(res,400,{error:'Use lowercase letters, numbers, - or _.'});
    const secret=b.secret||randomBytes(24).toString('hex');const args=['-p','default','webhook','subscribe',name,'--route-profile',wa,'--secret',secret];
    if(b.prompt)args.push('--prompt',String(b.prompt));if(b.description)args.push('--description',String(b.description));if(b.events?.length)args.push('--events',b.events.join(','));
    if(b.skills?.length)args.push('--skills',b.skills.join(','));if(b.deliver)args.push('--deliver',String(b.deliver));if(b.deliver_chat_id)args.push('--deliver-chat-id',String(b.deliver_chat_id));
    if(b.deliver_only)args.push('--deliver-only');if(b.script)args.push('--script',String(b.script));
    const {execFile}=await import('node:child_process');const r=await new Promise(d=>execFile(path.join(homedir(),'.local','bin','hermes'),args,{timeout:90000},(e,o,er)=>d({ok:!e,out:String(o||'')+String(er||'')})));
    const er=/^Error:\s*(.+)$/m.exec(r.out)||(/not enabled|webhook channel/i.test(r.out)&&['','Turn on webhooks first.']);
    if(!r.ok||er)return send(res,400,{error:((er&&er[1])||r.out.trim().split('\n').pop()||'Could not create the webhook').slice(0,300)});
    return send(res,200,{name,secret,route_profile:wa,url_path:'/webhooks/'+wa+'/'+name})}
   if(whM[1]&&(req.method==='DELETE'||req.method==='PUT')){let store={};try{store=JSON.parse(await readFile(path.join(HERMES_HOME,'webhook_subscriptions.json'),'utf8'))}catch{}
    if(store[decodeURIComponent(whM[1])]?.profile!==wa)return send(res,404,{error:'No webhook with that name on this agent.'});const r=await fetch(DASH.origin+'/api/webhooks/'+whM[1]+(whM[2]||'')+'?profile=default',{method:req.method,headers:h,body:req.method==='PUT'?(body||await readRaw(req,65536)):undefined});
    const t=await r.text();res.writeHead(r.status,{'content-type':'application/json',...security});return res.end(t)}}}
 let made=null;
 if(!users.isAdmin(u)&&(req.method==='POST'&&(p==='/hapi/mcp/servers'||p==='/hapi/profiles')||/^(PUT|PATCH)$/.test(req.method)&&/^\/hapi\/mcp\/servers\/[^/]+$/.test(p))){
  let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}
  // an MCP server started by command runs code on the box: same rule as the terminal
  if(/^\/hapi\/mcp\/servers(\/[^/]+)?$/.test(p)&&/^(POST|PUT|PATCH)$/.test(req.method)&&(b.command||b.args||b.transport==='stdio')&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
  // a member's tool address may not point inside the box or at a cloud's metadata service
  if(/^\/hapi\/mcp\/servers/.test(p)&&b.url&&await privateAddress(b.url))return send(res,403,{error:'Tools must use a public web address.'});
  // a member's new agent starts empty: copying the main agent would copy its keys and memory
  if(p==='/hapi/profiles'){b.clone_from_default=false;b.clone_all=false;if(b.clone_from&&users.level(u,String(b.clone_from))!=='owner')delete b.clone_from;made=String(b.name||'')}
  body=Buffer.from(JSON.stringify(b))}
 const transform=/^\/hapi\/(sessions|sessions\/search|profiles|cron\/jobs)$/.test(p)&&req.method==='GET'?d=>users.filter(u,p,d,agent)
  :/^\/gapi(\/p\/[^/]+)?\/api\/model\/options$/.test(p)&&users.allowedModels(u)?d=>({...d,providers:(d.providers||[]).map(pv=>({...pv,models:(pv.models||[]).filter(m=>users.modelOk(u,pv.slug,m))})).filter(pv=>pv.models.length)})
  :/^\/gapi(\/p\/[^/]+)?\/api\/sessions$/.test(p)&&req.method==='POST'?async d=>{await users.own(d.id||d.session?.id||d.session_id,u);return d}
  :made?async d=>{await memberAgent(u,made);return d}
  :p==='/hapi/profiles'&&req.method==='POST'?async d=>{const n=d?.name||d?.profile?.name;if(n){noteMade(n);(setupAgentFn?setupAgentFn(n):Promise.resolve()).catch(e=>console.warn('setup',n,e.message)).finally(async()=>{await agentHealth(n).catch(()=>{});await syncNotifyTool().catch(()=>{});if(PORT===4400)writeAgentContext().catch(()=>{});
   const {execFile}=await import('node:child_process');execFile(process.execPath,[path.join(root,'scripts','apply-skill-patches.mjs')],{timeout:180000},e=>{if(e)console.warn('skill patches',n,e.message)})})}return d}
  :relayTarget!==undefined?async d=>{const id=relayJob||(d.job||d).id;if(id)await relay.setJobRelay(agent,id,relayTarget);return d}:undefined;
 if(p.startsWith('/hapi/'))return proxy(req,res,DASH,'/hapi',{'x-hermes-session-token':DASH_TOKEN},{transform,body});
 const live=chatM&&req.method==='POST'?{key:agent+'|'+decodeURIComponent(chatM[1]),user:u.id}:undefined;
 // a steer: sent to the engine, then added to the live reply so other tabs on the same chat show it too
 {const sm=/^\/gapi(\/p\/[^/]+)?\/v1\/runs\/([^/]+)\/steer$/.exec(p);
  if(sm&&req.method==='POST'){const raw=body||await readRaw(req,65536);
   const r=await fetch(GATE.origin+(sm[1]||'')+'/v1/runs/'+sm[2]+'/steer',{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},body:raw}).catch(e=>({ok:false,status:502,text:async()=>JSON.stringify({error:e.message})}));const t=await r.text();
   if(r.ok){let text='';try{text=String(JSON.parse(raw.toString('utf8')).text||'')}catch{}
    for(const rec of LIVE.values())if(rec.runId===sm[2]&&!rec.done){const c=Buffer.from('event: aqeelos.steer\ndata: '+JSON.stringify({type:'aqeelos.steer',text,run_id:sm[2],from:u.id})+'\n\n');rec.chunks.push(c);for(const sub of rec.subs)sub.write(c)}}
   res.writeHead(r.status,{'content-type':'application/json',...security});return res.end(t)}}
 return proxy(req,res,GATE,'/gapi',{authorization:'Bearer '+API_KEY},{transform,body,live});
}

/* ---------- service logos: fetched once per domain, cached on the box, served from this origin ---------- */
const LOGOS=path.join(DATA,'logos');
const letterSvg=(d)=>{const l=(d||'?')[0].toUpperCase();return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#0b0c10"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${l}</text></svg>`};
// what kind of image a logo file really is (Google sometimes answers with JPEG or ICO)
const imgType=b=>b[0]===0x89&&b[1]===0x50?'image/png':b[0]===0xff&&b[1]===0xd8?'image/jpeg':b.slice(0,3).toString()==='GIF'?'image/gif':b.slice(8,12).toString()==='WEBP'?'image/webp':'image/x-icon';
async function logo(req,res){
 const d=String(new URL(req.url,'http://x').searchParams.get('d')||'').toLowerCase();
 if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)||d.length>80)return send(res,400,'bad domain');
 const file=path.join(LOGOS,d+'.png'),miss=path.join(LOGOS,d+'.miss');
 const hdr={'cache-control':'public, max-age=604800','x-content-type-options':'nosniff'};
 try{const b=await readFile(file);res.writeHead(200,{'content-type':imgType(b),...hdr});return res.end(b)}catch{}
 const short={'cache-control':'private, max-age=300','x-content-type-options':'nosniff'};   // a letter is a stand-in: let browsers ask again soon
 try{await stat(miss);res.writeHead(200,{'content-type':'image/svg+xml',...short});return res.end(letterSvg(d))}catch{}
 // Google answers unknown domains with a generic 16 px globe, so a logo counts only when the PNG is at least
 // 48 px wide (read from its header; small files can still be real logos). DuckDuckGo is the second source.
 const pngWidth=b=>b.length>24&&b.readUInt32BE(0)===0x89504e47?b.readUInt32BE(16):0;
 for(const [url,ok] of [[`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`,b=>pngWidth(b)>=48],[`https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`,b=>pngWidth(b)>=32||(b.length>1500&&b[0]===0&&b[2]===1)||(b.length>1500&&b.slice(8,12).toString()==='WEBP')]]){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});const buf=Buffer.from(await r.arrayBuffer());
   if(r.ok&&ok(buf)){await mkdir(LOGOS,{recursive:true});await writeFile(file,buf);res.writeHead(200,{'content-type':imgType(buf),...hdr});return res.end(buf)}}catch{}}
 await mkdir(LOGOS,{recursive:true}).catch(()=>{});await writeFile(miss,'').catch(()=>{});
 res.writeHead(200,{'content-type':'image/svg+xml',...short});res.end(letterSvg(d));
}

/* ---------- live screens: the shared one (noVNC on 127.0.0.1:6080) and one per agent (screens.mjs) ---------- */
const screens=createScreens();
const SCREEN=new URL(env.UI_SCREEN||'http://127.0.0.1:6080');
const BUILD=String(Date.now());
const sameOrigin=req=>{const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host}catch{return false}};
function screenHttp(req,res){
 const url=new URL(req.url,'http://x');const up=httpRequest({hostname:SCREEN.hostname,port:SCREEN.port,path:url.pathname.replace(/^\/screen/,'')||'/',method:'GET',headers:{host:SCREEN.host}},r=>{
  res.writeHead(r.statusCode||502,{'content-type':r.headers['content-type']||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','content-security-policy':"frame-ancestors 'self'",'referrer-policy':'same-origin'});r.pipe(res)});
 up.on('error',()=>{if(!res.headersSent)send(res,502,'The screen is not running on the box.')});up.end();
}
// Spare browser window on the screen for manual use (aqeelOS's own browser opens itself when it browses).
async function openBrowser(res,agent){
 const {spawn}=await import('node:child_process');const {existsSync,readdirSync}=await import('node:fs');
 const tools=path.join(HERMES_HOME,'tools');const dir=existsSync(tools)?readdirSync(tools).find(d=>d.startsWith('chromium')):null;
 const bin=dir?path.join(tools,dir,'chrome-linux64','chrome'):'chromium';
 // An agent with its own screen: open the window there, on the same browser profile the agent uses.
 let disp={DISPLAY:env.DISPLAY||':99'},udd=path.join(homedir(),'.config','aqeelos-browser');
 if(agent&&await screens.valid(agent)&&(await screens.status(agent)).kind==='desktop'){const e=await screens.displayEnv(agent);if(!e.DISPLAY)return send(res,409,{error:"This agent's screen is off. Start it first."});disp=e;udd=path.join(screens.homeOf(agent),'bot-desktop','browser-profile')}
 // --no-sandbox: Chrome's own sandbox can't start inside this container (Hermes' browser runs the same way);
 // the container plus the network lock are the isolation here.
 const p=spawn(bin,['--no-sandbox','--test-type','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--start-maximized','--user-data-dir='+udd,'about:blank'],{env:{...process.env,...disp},detached:true,stdio:'ignore'});
 p.on('error',()=>{});p.unref();send(res,200,{ok:true});
}

/* ---------- routes ---------- */
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x');const p=url.pathname;
 try{
  await users.load();   // people (owners, shares) are read before any route uses them, also right after a restart
  if(codeOnline.handle(req,res))return;   // code.elkiya.com and code-preview.elkiya.com: Code online, behind sign-in
  if(p==='/healthz')return send(res,200,{ok:true,build:BUILD,live:liveCount(),busy:liveCount()+export_setups.running()+opsBusy()+relay.sending()+(gwRestarting?1:0)});
  // the "notify me" tool agents call (from this box only; each agent's address is signed)
  const mn=/^\/mcp\/notify\/([\w-]+)\/([\w-]+)$/.exec(p);
  if(mn){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method==='GET')return send(res,405,'POST only');
   let msg={};try{msg=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'})}// connect_mcp_tool: the right way for an agent to start a sign-in (public return address, never localhost)
   const signed=(()=>{const a=Buffer.from(String(mn[2])),b=Buffer.from(String(relay.sig(mn[1])));return a.length===b.length&&timingSafeEqual(a,b)})();
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='connect_mcp_tool'){const tool=String(msg.params?.arguments?.tool||'').trim();const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    const redirect=MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(tool);
    const ag=mn[1].split('--')[0];
    try{const pr=await sharing.prepareSignin(ag,tool,redirect);if(pr.changed)await new Promise(r=>setTimeout(r,2500));const [svc,where,save]=appSettings(tool,pr.url);
     const j=await startSignin(ag,tool);
     // the answer is written for anyone on the team: the easy way first, exact steps only when an app of their own is involved
     if(j.authorization_url&&!pr.own)return reply(`Send the person exactly this (no technical steps needed):\n\nTo connect ${svc}, open this link and click Allow: ${j.authorization_url}\nYou'll land on a page that says "Signed in". That's it.\n\n(Open it within 5 minutes; after that, ask again for a fresh link.)`);
     if(j.authorization_url)return reply(`${svc} is connected through the person's own ${svc} app, so that app must list aqeelOS's address first. Send exactly this:\n\n1. Open ${where}.\n2. Add this address exactly: ${redirect}\n3. Click ${save}. (It doesn't work until it's saved.)\n4. Then open this link and click Allow: ${j.authorization_url}\n5. You'll land on a page that says "Signed in".\n\nIf ${svc} says "redirect_uri did not match", steps 2–3 weren't saved: redo them, then open the link again. Only an admin of that ${svc} app can do steps 1–3. If the person is not one and cannot ask one, offer Composio as the fallback and tell them: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only if they agree.`);
     const err=j.error||j.detail||'no link came back';
     if(/client registration|client_id|client id/i.test(err))return reply(`${svc} needs an app of the person's own (a one-time setup, free). Offer to walk them through it, or do it with them in the browser: create an app at ${where.split(' → ')[0]}, add this Redirect URL: ${redirect}, then they paste its Client ID and Client Secret with the lock button (or in Abilities › MCP tools › ${tool} › Sign in). If they cannot (no admin access) or do not want to, offer Composio as the fallback and tell them: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only if they agree.`,true);
     return reply('Could not start the sign-in: '+err,true)}catch(e){return reply('Could not start the sign-in: '+e.message,true)}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='organize_schedule'){const r=await schedules.organize(mn[1],msg.params?.arguments||{}).catch(e=>({isError:true,text:e.message}));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='choose_browser'){const r=await askBrowser(mn[1],msg.params?.arguments||{});return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}]}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='type_secret'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const name=String(a.name||'').trim().toUpperCase();
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    if(!/^[A-Z][A-Z0-9_]{1,59}$/.test(name))return reply('Give the name of a saved secret, like GMAIL_PASSWORD.',true);
    const value=await readFile(path.join(secretDir(base),name),'utf8').catch(()=>null);
    if(value===null){const have=await readdir(secretDir(base)).catch(()=>[]);return reply('No saved secret called '+name+'.'+(have.length?' Saved ones: '+have.join(', ')+'.':' Ask the person with ask_secret.'),true)}
    try{await screens.typeInto(base,value,{enter:!!a.press_enter});return reply('Typed '+name+' into the focused field on your screen'+(a.press_enter?' and pressed Enter':'')+'. You did not see it; take a screenshot to check the result.')}catch(e){return reply('Could not type it: '+e.message,true)}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='ask_secret'){const r=await askSecret(mn[1],msg.params?.arguments||{});return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   // apply_changes: an agent that changed settings, tools or skills (its own or another agent's) makes them take
   // effect itself, through the same careful restart as the Restart agents button: after every reply in progress
   // (its own included) has finished. Only agents of people who may use the unsafe tools.
   const mayApply=!lockedAgent(mn[1].split('--')[0],{});
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='apply_changes'){if(!mayApply)return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'Only agents of admins can restart the agents. Ask an admin to press Restart agents on System › Health.'}]}});
    const why=String(msg.params?.arguments?.why||'settings changed').slice(0,120);restartGateway(why+' (asked by '+(NAMES[mn[1].split('--')[0]]||mn[1])+')').catch(()=>{});
    return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'aqeelOS restarts the agents as soon as no reply is in progress, this one included: usually within a minute after you finish. Finish your turn now with one short line saying the change is applied in a minute and what the person can try then. Do not check or test it in this turn.'}]}})}
   // access between agents: see what the others have (names only), ask for it, offer what you have; an admin decides
   if(signed&&msg.method==='tools/call'&&['access_list','request_access','offer_access'].includes(msg.params?.name)){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    try{if(msg.params.name==='access_list'){const [o,m,q]=await Promise.all([accessAsk.others(base),accessAsk.mine(base),accessAsk.of(base)]);const nm=x=>NAMES[x]||x;
      return reply('You have:\n'+(m.map(x=>'- '+x.what+' '+x.label+' (kind '+x.kind+', id '+x.id+')'+(x.owner===base?', you own it':', shared by '+x.ownerName)).join('\n')||'- nothing shared yet')+'\n\nOther agents have (you can see these exist but not use them; ask with request_access):\n'+(o.map(x=>'- '+x.what+' '+x.label+' (kind '+x.kind+', id '+x.id+'), owned by '+x.ownerName).join('\n')||'- nothing else')+(q.length?'\n\nYour requests:\n'+q.map(r=>'- '+r.label+' for '+nm(r.to)+': '+(r.done?(r.ok?'allowed':'declined'):'waiting for an admin')).join('\n'):''))}
     if(!a.kind||!a.id)return reply('Give kind (mcp, google, plugin or key) and id, from access_list.',true);
     const r=msg.params.name==='request_access'?await accessAsk.ask({kind:String(a.kind),id:String(a.id),to:base,by:base,dir:'get',why:a.why}):await accessAsk.ask({kind:String(a.kind),id:String(a.id),to:String(a.to||''),by:base,dir:'give',why:a.why});
     console.log('access asked by agent',base,msg.params.name,a.kind,a.id);return reply(r.already?r.text:'Asked. It shows under Bottlenecks in aqeelOS; nothing is shared until an admin allows it. Tell the person in one line what you asked for and why, then go on without it.')}catch(e){return reply(e.message,true)}}
   // report_bottleneck: an agent says what blocks it (missing access, a sign-in, a permission, something only the person can give)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='report_bottleneck'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};try{await bottlenecks.report(base,{what:a.what,missing:a.missing,fix:a.fix});console.log('bottleneck reported by',base+':',String(a.missing).slice(0,80));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'Reported. The person sees it under Bottlenecks with what would fix it. Tell them briefly in your reply too, then carry on with anything you can still do.'}]}})}catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   // aqeelOS Code: the projects this agent may work on, and doing work in one (on the computer or the box that has it)
   if(signed&&msg.method==='tools/call'&&['code_projects','code_work'].includes(msg.params?.name)){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    if(msg.params.name==='code_projects'){const l=code.projectsFor(base);return reply(l.length?l.map(x=>'- '+x.name+' (project: '+x.project+', '+x.where+(x.owner?', yours':', shared with you')+')').join('\n'):'No Code projects are linked to you, or their computer is off. A project is linked in Code › project settings › Agent.')}
    if(!a.project||!a.task)return reply('Give project (from code_projects) and task.',true);
    try{const r=await code.work(base,NAMES[base]||await displayName(base),String(a.project),String(a.task));console.log('code: '+base+' worked on',String(a.project).split(':')[1],'→',r.state);
     return reply((r.state==='complete'?'Done. ':r.state==='running'?'':'It did not finish ('+(r.state||'failed')+'). ')+(r.text||'')+(r.files?.length?'\n\nChanged files: '+r.files.slice(0,30).join(', '):''),r.state!=='complete'&&r.state!=='running')}catch(e){return reply(e.message,true)}}
   // an agent changes its own everyday settings (voice notes, voice, time zone, how replies show) instead of sending the
   // person to the owner; nothing here widens what it can reach (no tools, keys, terminal, browser or access settings)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='my_settings'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{},key=String(a.key||'').trim();
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    if(!OWN_SETTINGS.test(key))return reply('Only these can be changed this way: stt.* (voice notes, e.g. stt.language: "" = detect each time, "id", "en"), tts.* (your voice), timezone and display.*. Anything else goes through report_bottleneck.',true);
    if(a.value===undefined){const c=await readConfig(base).catch(()=>null);return reply(key+' = '+JSON.stringify(pick(c,key)??null))}
    const r=await setKey(base,key,a.value===null?'':a.value).catch(e=>({ok:false,out:e.message}));if(!r.ok)return reply('Could not change it: '+String(r.out||'').trim().slice(-300),true);
    console.log('own settings: '+base+' set '+key);restartGateway(base+' changed its own '+key).catch(()=>{});
    return reply('Saved '+key+' = '+JSON.stringify(a.value)+'. It takes effect from your next message (aqeelOS reloads the agents once no reply is running).')}
   // the guarded browser in aqeelOS Code on the agent owner's own computer (no extension; only the sites allowed there)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='computer_browser'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const owner=users.agentOwner(base)||'owner';
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    try{const r=await code.browse([owner],{action:String(a.action||''),url:a.url,ref:a.ref,text:a.text,key:a.key,submit:!!a.submit});return reply(r.text||'(no answer)',r.state==='failed')}catch(e){return reply(e.message,true)}}
   const out=await relay.mcp(mn[1],mn[2],msg);
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&mayApply)out.body.result.tools.push({name:'apply_changes',description:'Make settings changes take effect: after you changed an agent\'s config (yours or another agent\'s), added or shared an MCP tool or connected app, a skill, a plugin or a toolset, call this once. aqeelOS restarts the agents safely when no reply is running. Never restart the gateway any other way.',inputSchema:{type:'object',properties:{why:{type:'string',description:'What changed, in a few words'}},required:['why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'choose_browser',description:'Before a browser job in a chat, ask the person once where to do it: their own Chrome ("yours": a separate window on their computer, with the sign-ins they already have; best for one-off jobs such as Google Cloud or admin consoles) or your screen on the AI box ("server": keeps working when their computer is off; needed for anything scheduled or long-running). When you also have computer_browser, there is a third choice: the guarded browser in aqeelOS Code on their computer ("computer": no extension needed, they watch it live in Code, only the sites they allowed there). Give your suggestion. Wait for the answer, then follow it for the rest of the chat.',inputSchema:{type:'object',properties:{task:{type:'string',description:'What you will do in the browser, in a few words'},suggest:{type:'string',enum:['yours','server']},why:{type:'string',description:'One short reason for your suggestion'}},required:['task','suggest']}},{name:'type_secret',description:'Type a secret the person saved for you (a password, code or key) into the field that has focus on your screen, without seeing it. Click the field first. Saved secrets: '+((await readdir(secretDir(mn[1].split('--')[0])).catch(()=>[])).join(', ')||'none yet (ask with ask_secret)')+'.',inputSchema:{type:'object',properties:{name:{type:'string',description:'The saved name, e.g. GMAIL_PASSWORD'},press_enter:{type:'boolean'}},required:['name']}},{name:'ask_secret',description:'Ask the person for a password, API key or other secret through a protected field in their aqeelOS chat. You never see the value. mode "type": it is typed into the field that has focus on your screen (click the field first; set press_enter to submit). mode "save": it is stored as a named key (name in capitals, e.g. OPENAI_API_KEY) that the engine and your commands can use. Never ask for a secret in plain chat or on the screen viewer; always use this.',inputSchema:{type:'object',properties:{label:{type:'string',description:'What it is, e.g. "Gmail password for ops@company.com"'},mode:{type:'string',enum:['type','save']},name:{type:'string',description:'For save: the key name in capitals'},press_enter:{type:'boolean',description:'For type: press Enter after typing'}},required:['label','mode']}},{name:'organize_schedule',description:'File one of your schedules so the person understands it at a glance: put it in a folder (the project or client it is for, e.g. Dagadu, Personal Finance), give it a clear title and a one-sentence description of what it does and why. Use it right after you create or change a schedule, and when the person asks you to tidy, move or rename schedules.',inputSchema:{type:'object',properties:{job_id:{type:'string',description:'The schedule id (from cronjob list)'},folder:{type:'string',description:'Folder name, 1-2 words'},title:{type:'string',description:'Clear title, max 6 words (optional)'},description:{type:'string',description:'One plain sentence: what it does and why'}},required:['job_id']}},{name:'connect_mcp_tool',description:'Start the sign-in for one of your MCP tools (slack, composio, notion…) and get the link to give the person. Always use this to connect an MCP tool; never a command-line login or a localhost callback.',inputSchema:{type:'object',properties:{tool:{type:'string',description:'The MCP tool name as listed, e.g. "slack" or "composio"'}},required:['tool']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push(
    {name:'access_list',description:'What you have (apps, Google accounts, plugins, keys) and what the other agents have that you cannot use yet (names only, never values), plus your open access requests.',inputSchema:{type:'object',properties:{}}},
    {name:'request_access',description:'Ask to use something another agent has (from access_list): an app, a Google account, a plugin or a key. An admin decides under Bottlenecks; it is never shared without that. Use it when the work needs it, not just in case.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['mcp','google','plugin','key']},id:{type:'string',description:'id from access_list'},why:{type:'string',description:'one line: what you need it for'}},required:['kind','id','why']}},
    {name:'offer_access',description:'Offer something you have (from access_list) to another agent that needs it. An admin decides under Bottlenecks.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['mcp','google','plugin','key']},id:{type:'string'},to:{type:'string',description:'the other agent id'},why:{type:'string'}},required:['kind','id','to','why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'my_settings',description:'Read or change your own everyday settings yourself, without asking the owner: voice notes (stt.language: "" detects the language each time, or a code like "id" or "en"; stt.*), your voice (tts.*), your time zone (timezone, e.g. Asia/Jakarta) and how replies show (display.*). Leave value out to read the current value. Do this when the person asks for such a change or a setting clearly gets in their way.',inputSchema:{type:'object',properties:{key:{type:'string',description:'e.g. stt.language, tts.provider, timezone'},value:{description:'the new value; leave out to read'}},required:['key']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'report_bottleneck',description:'When you cannot do something because a person has to act first, report it once: access you are missing (a folder, a sheet, an account, a channel), a sign-in, a permission or a setting, or information only they have. Not for ordinary errors you can fix or work around yourself. Say what you were trying to do, what is missing, and what would fix it. It appears under Bottlenecks in aqeelOS with a fix button.',inputSchema:{type:'object',properties:{what:{type:'string',description:'What you were trying to do, in a few words'},missing:{type:'string',description:'What is missing, plainly (for example: access to the Finance folder in Google Drive)'},fix:{type:'string',description:'What would fix it (for example: share the folder with me, or connect Drive for me)'}},required:['missing']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&code.projectsFor(mn[1].split('--')[0]).length)out.body.result.tools.push(
    {name:'code_projects',description:'List the aqeelOS Code projects (apps, websites, decks, docs) you may work on, and where each lives.',inputSchema:{type:'object',properties:{}}},
    {name:'code_work',description:'Change or build something in one of those Code projects: a coding AI does it in the project with your abilities and replies with what it did and which files changed (it can take a few minutes). Example: "change the hero text on the home page to …". Tell the person the result when it is done.',inputSchema:{type:'object',properties:{project:{type:'string',description:'The project id from code_projects'},task:{type:'string',description:'What to change or build, in plain words'}},required:['project','task']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&code.computerOf([users.agentOwner(mn[1].split('--')[0])||'owner']))out.body.result.tools.push({name:'computer_browser',description:'Browse in the guarded browser of aqeelOS Code on the person\'s own computer (no extension needed; the person sees it live in Code › Browser and can take over). It only opens their computer\'s own pages and the sites they allowed there; anything else is refused with the list, and a robot check is handed to them. Actions: open (url), snapshot (the page and its numbered elements), click (ref from snapshot), type (ref, text, submit), press (key), read (the page text), back.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['open','snapshot','click','type','press','read','back']},url:{type:'string'},ref:{type:'string'},text:{type:'string'},key:{type:'string'},submit:{type:'boolean'}},required:['action']}});
   if(out.body==null){res.writeHead(out.status);return res.end()}return send(res,out.status,out.body)}
  // Incoming webhooks (GitHub, Stripe…) reach Hermes' webhook listener here. No sign-in: each
  // subscription checks its own secret signature, and nothing but POST /webhooks/<name> passes.
  if(/^\/webhooks\/[\w.-]{1,64}$/.test(p)&&req.method==='POST')return proxy(req,res,HOOKS,'',{});
  {const wm=/^\/webhooks\/([a-z0-9][a-z0-9_-]{0,63})\/([\w.-]{1,64})$/.exec(p);if(wm&&req.method==='POST'){req.url='/p/'+wm[1]+'/webhooks/'+wm[2]+url.search;return proxy(req,res,HOOKS,'',{})}}
  // WhatsApp Business (Meta's Cloud API) calls here: GET is Meta's address check, POST the messages. No sign-in:
  // the engine checks Meta's signature with the app secret. The main agent's listener serves every agent (/p/<agent>/…).
  {const cm=/^\/whatsapp-cloud(?:\/([a-z0-9][a-z0-9_-]{0,63}))?$/.exec(p);if(cm&&(req.method==='GET'||req.method==='POST')){req.url=(cm[1]&&cm[1]!=='default'?'/p/'+cm[1]:'')+'/whatsapp/webhook'+url.search;return proxy(req,res,WA_CLOUD,'',{})}}
  // MCP sign-in (OAuth) returns here from Slack, Notion…; the engine checks the one-time state. No sign-in needed.
  // Google sign-ins (Google Workspace skill with a Web-application client) return here, and aqeelOS finishes them:
  // it finds the agent and account whose pending sign-in has this state and runs the skill's --auth-code step.
  if(p==='/google-oauth/callback'&&req.method==='GET'){const st=url.searchParams.get('state')||'';
   const page=(t,m)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${t}</h2><p>${m}</p></body>`)};
   if(url.searchParams.get('error'))return page('Not connected','You clicked Cancel (or Google said no). Ask your agent for a new link if you want to connect.');
   let hit=null;for(const a of await listAllProfiles()){const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    for(const fn of await readdir(home).catch(()=>[])){const m=/^google_oauth_pending(?:_(.+))?\.json$/.exec(fn);if(!m)continue;
     try{const j=JSON.parse(await readFile(path.join(home,fn),'utf8'));if(j.state&&j.state===st){hit={a,home,acct:m[1]||''};break}}catch{}}if(hit)break}
   if(!hit)return page('This link has expired','A newer link replaced it, or it was already used. Ask your agent for a new Google sign-in link and open it right away.');
   const py=await sharing.python();const script=path.join(hit.home,'skills','productivity','google-workspace','scripts','setup.py');const {execFile}=await import('node:child_process');
   const r=await new Promise(done=>execFile(py,[script,...(hit.acct?['--account',hit.acct]:[]),'--auth-code',PUBLIC_URL+'/google-oauth/callback'+url.search],{timeout:90000,env:{...process.env,HERMES_HOME:hit.home}},(e,o,er)=>done({ok:!e,out:String(o||'')+String(er||'')})));
   if(!r.ok||/ERROR/.test(r.out))return page('Google sign-in did not finish',esc((r.out.trim().split('\n').filter(Boolean).pop()||'Unknown error').slice(0,300))+' Ask your agent for a new link.');
   return page('Google account connected',(hit.acct?'<b>'+esc(hit.acct)+'</b> is ':'Your Google account is ')+'connected to '+esc(NAMES[hit.a]||hit.a)+'. You can close this tab and go back to aqeelOS.')}
  // aqeelOS Code (the desktop app) calls these with the key it got when it was paired; nothing else may
  if(p.startsWith('/ui/code/')&&/^Bearer aqc_/.test(req.headers.authorization||'')){const dev=await code.who(String(req.headers.authorization).slice(7));if(!dev)return send(res,401,{error:'This computer is not paired any more. Open Code in aqeelOS to pair it again.'});
   const who=users.byId(dev.user);if(!who)return send(res,401,{error:'The person this computer was paired for no longer exists.'});
   const mine=a=>!users.gate(who,'/gapi/api/model/options','GET',new URLSearchParams(),a);   // the agents this person may chat with (shared, owned, not someone's private one)
   if(p==='/ui/code/whoami')return send(res,200,{name:who.name||who.id,user:who.id});
   if(p==='/ui/code/agents'){const out=[];for(const a of await listAgents()){if(!mine(a)||await isTestAgent(a))continue;const c=await readConfig(a).catch(()=>null)||{};out.push({id:a,name:NAMES[a]||await displayName(a),apps:Object.keys(c.mcp_servers||{}).filter(n=>n!=='aqeelos-notify'),google:(await googleContext(a).catch(()=>[])).length})}return send(res,200,{agents:out})}
   if(p==='/ui/code/ask'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}const a=String(b.agent||'default');if(!(await listAgents()).includes(a)||!mine(a))return send(res,403,{error:'You can’t ask that agent.'});
    const task=String(b.task||'').slice(0,20000);if(!task)return send(res,400,{error:'Say what the agent should do.'});const pre=a!=='default'?'/p/'+encodeURIComponent(a):'';
    // a member: within their daily limit (Chat and Code together) and on a model they may use, as in Chat
    let model='default';if(!users.isAdmin(who)){const lim=users.limitOf(who);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),who.id,users.ownerOf);if(t.tokens+await code.usedToday(who.id)>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
     const allowed=users.allowedModels(who);if(allowed){const d=await agentModel(a);if(!users.modelOk(who,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');model=m.length?m.join('|'):pv}}}
    try{const r=await fetch(GATE.origin+pre+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},signal:AbortSignal.timeout(900000),
      body:JSON.stringify({model,stream:false,messages:[{role:'user',content:'(Asked from aqeelOS Code by '+(who.name||who.id)+(b.project?', project '+String(b.project).slice(0,80):'')+'. Do it with your own tools and reply with exactly what was asked for.)\n\n'+task}]})});
     const j=await r.json().catch(()=>({}));if(!r.ok)return send(res,502,{error:j.error?.message||j.error||'The agent did not answer ('+r.status+').'});
     if(j.usage?.total_tokens)await code.addUsage(who.id,j.usage.total_tokens);console.log('code: '+(who.name||who.id)+' asked',a,'from aqeelOS Code');return send(res,200,{agent:a,agentName:NAMES[a]||await displayName(a),text:j.choices?.[0]?.message?.content||''})}catch(e){return send(res,504,{error:'The agent took too long: '+e.message})}}
   if(p==='/ui/code/version')return send(res,200,{version:await code.version()});
   // Live: Code publishes a project as a zip (the body), as the person this computer is paired for
   if(p==='/ui/code/publish'&&req.method==='POST'){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>90e6)return send(res,413,{error:'The project is over 90 MB. Leave big files (videos, data) out of it.'});chunks.push(c)}
    const q=url.searchParams;try{const a=await live.publish(who,{name:q.get('name'),slug:q.get('slug'),repo:q.get('repo'),database:q.get('db')==='1',zip:Buffer.concat(chunks)});console.log('live: '+(who.name||who.id)+' published',a.slug);return send(res,200,a)}catch(e){return send(res,400,{error:e.message})}}
   // the people an online project can be shared with (names only)
   if(p==='/ui/code/people'&&req.method==='GET')return send(res,200,{people:users.people().filter(x=>x&&x.id&&!x.disabled).map(x=>({id:x.id,name:x.name||x.username||'Someone',username:x.username||''}))});
   if(p==='/ui/code/report'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.report(dev,b);return send(res,200,{ok:true})}
   if(p==='/ui/code/run-usage'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.addRun(dev,b);return send(res,200,{ok:true})}
   if(p==='/ui/code/update'){const u=await code.update();res.writeHead(200,{'content-type':'application/zip','content-length':u.zip.length,'x-code-version':u.version,'cache-control':'no-store'});return res.end(u.zip)}
   if(p==='/ui/code/poll'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,262144))}catch{}const allowedA=new Set((await listAgents()).filter(mine));const job=await code.poll(dev,(Array.isArray(b.projects)?b.projects:[]).map(x=>({...x,agent:allowedA.has(x?.agent)?x.agent:'',agents:(Array.isArray(x?.agents)?x.agents:[]).filter(a=>allowedA.has(a))})));return send(res,200,{job})}
   if(p==='/ui/code/done'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,262144))}catch{}return send(res,200,{ok:code.done(dev,b.id,{state:String(b.state||''),text:String(b.text||'').slice(0,20000),files:(b.files||[]).slice(0,200).map(String),chat:String(b.chat||'')})})}
   return send(res,404,{error:'Not found'})}
  if(p==='/ui/brand'&&req.method==='GET')return send(res,200,await brand.get());
  if(p==='/ui/brand/logo'&&req.method==='GET'){const l=await brand.logo();if(!l){res.writeHead(302,{location:'/assets/elkiya-mark.svg'});return res.end()}res.writeHead(200,{'content-type':l.type,'cache-control':'public, max-age=86400','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'",'x-content-type-options':'nosniff'});return res.end(l.data)}
  if(p==='/aqeelos-login'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});return res.end(n8n.page())}
  if(p==='/aqeelos-login/go'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
   try{const set=await n8n.go(b.t,b.b);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','set-cookie':set});return res.end('{"ok":true}')}catch(e){return send(res,400,{error:e.message})}}
  if(p.startsWith('/mcp-oauth/api/mcp/oauth/callback/')&&req.method==='GET'){
   const tool=decodeURIComponent(p.split('/').pop()||'');let r=await fetch(DASH.origin+p.slice('/mcp-oauth'.length)+url.search).catch(()=>null);if(r)await r.text();
   if(r&&r.status===404&&url.searchParams.get('code')){const g=await deliverToGateway(url.search);if(g)r={ok:true,status:200,viaGateway:true}}
   // say what really happened: wait for the engine to finish trading the code, then report it plainly
   let title='Signed in',msg='You can close this tab and go back to aqeelOS.';
   if(url.searchParams.get('error'))[title,msg]=['Not connected','You clicked Cancel (or the service said no). Go back to aqeelOS and press Sign in again if you want to connect.'];
   else if(!r)[title,msg]=['aqeelOS is not reachable','Try again in a minute.'];
   else if(r.status===404)[title,msg]=['This link has expired','It was replaced by a newer one or is older than a few minutes. Go back to aqeelOS, press Sign in (or ask your agent to connect it) and use the newest link right away.'];
   else if(!r.ok)[title,msg]=['Sign-in did not finish','The service sent back something unexpected. Press Sign in again.'];
   else{const ids=[...signinFlows.entries()].filter(([k])=>k.endsWith('|'+tool)).map(([,v])=>v);const h={'x-hermes-session-token':DASH_TOKEN};let st=null;
    for(let i=0;i<20&&ids.length;i++){for(const id of ids){const f=await fetch(DASH.origin+'/api/mcp/oauth/flows/'+encodeURIComponent(id),{headers:h}).then(x=>x.ok?x.json():null).catch(()=>null);if(f&&!/authorization_required|pending|exchang|connecting/i.test(f.status||'')){st=f;break}}if(st)break;await new Promise(x=>setTimeout(x,750))}
    if(st&&/error|fail/i.test(st.status||''))[title,msg]=['Sign-in did not finish',esc(String(st.error||'The service refused the sign-in.').slice(0,300))+' Press Sign in again; if it keeps happening, ask your agent to connect it through Composio.'];
    else if(st&&st.tools?.length)msg=`${esc(tool)} is connected with ${st.tools.length} tools. You can close this tab and go back to aqeelOS.`}
   res.writeHead(r?.status&&r.status<500?200:502,{'content-type':'text/html; charset=utf-8',...security});
   return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${title}</h2><p>${msg}</p></body>`)}
  if(p.startsWith('/screen/')){if(!validCookie(req))return send(res,401,'Sign in first.');return screenHttp(req,res)}
  if(p==='/ui/screen/browser'||p.startsWith('/ui/screens')){const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'});if(req.method!=='GET'&&req.headers['x-hui']!=='1')return send(res,403,{error:'Sign in first.'});
   const sm=/^\/ui\/screens\/([^/]+)/.exec(p);if(p==='/ui/screens'&&!users.isAdmin(u))return send(res,200,{screens:[]});
   const no=users.gate(u,p,req.method,url.searchParams,sm?decodeURIComponent(sm[1]):agentOf(p,url.searchParams));if(no)return send(res,no.status,{error:no.error});
   if(/\/type$/.test(p)&&url.searchParams.get('screen')==='ads'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can type into the shared screen.'});
   return p==='/ui/screen/browser'?openBrowser(res,url.searchParams.get('agent')):screens.handle(req,res,p,send)}
  if(p==='/auth/login'&&req.method==='POST'){
   const ip=clientIp(req);if(limited(ip))return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
   const u=await users.login(b.name,b.password||'',pw=>!!PW_HASH&&checkPassword(pw));
   if(!u){(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now());return send(res,401,{error:b.name?'That name and password do not match.':'That password is not right.'})}
   attempts.delete(ip);
   // two-step: the password was right; now a code goes to their confirmed email
   if(u.twoStep&&u.emailVerified){try{return send(res,200,{needCode:true,key:await users.loginCode(u),to:u.email.replace(/^(.).*(@.*)$/,'$1•••$2')})}catch(e){return send(res,502,{error:'Your sign-in code could not be sent: '+e.message})}}
   return send(res,200,{ok:true},{'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)});
  }
  if(p==='/auth/code'&&req.method==='POST'){const ip=clientIp(req);if(limited(ip))return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const v=users.finishLogin(b.key,b.code);
   if(v.error){(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now());return send(res,401,{error:v.error})}
   return send(res,200,{ok:true},{'set-cookie':'hui='+makeCookie(v.user.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}
  if(p==='/auth/logout'&&req.method==='POST')return send(res,200,{ok:true},{'set-cookie':'hui=; '+cookieAttrs(0)});
  if(p==='/auth/logout-all'&&req.method==='POST'){const id=cookieId(req);if(!id)return send(res,401,{error:'Sign in first.'});await revokeSessions(id);console.log('signed out everywhere:',id);return send(res,200,{ok:true},{'set-cookie':'hui=; '+cookieAttrs(0)})}
  if(p==='/auth/me'){const u=await me(req);return send(res,u?200:401,{signedIn:!!u,name:u?.name,role:u?.role})}
  // Invite links: /#invite/<code> asks for a name and password, then signs the new person in.
  if(p==='/auth/invite'&&req.method==='GET'){const i=await users.inviteInfo(url.searchParams.get('code')||'');return send(res,i?200:404,i||{error:'This invite link has expired or was already used.'})}
  if(p==='/auth/accept'&&req.method==='POST'){const ip=clientIp(req);if(limited(ip))return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
   try{const u=await users.accept(String(b.code||''),b.name,b.password,b.username);return send(res,200,{ok:true,name:u.name},{'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}
   catch(e){(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now());return send(res,400,{error:e.message})}}
  if(p.startsWith('/ui/')){
   const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'},{'x-hui-auth':'required'});
   if(req.method!=='GET'&&req.headers['x-hui']!=='1')return send(res,403,{error:'Missing request header.'});
   // a new password signs out every other browser and phone; this one gets a fresh sign-in
   if(p==='/ui/me/password'&&req.method==='PUT')return users.api(u,req,res,p,async(r,code,data,h)=>{if(code===200){await revokeSessions(u.id);return send(r,code,data,{...(h||{}),'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}return send(r,code,data,h)},readBody);
   if(p==='/ui/me'||p.startsWith('/ui/me/')||p.startsWith('/ui/people')||p.startsWith('/ui/agents')||p.startsWith('/ui/mail')||p.startsWith('/ui/roles'))return users.api(u,req,res,p,send,readBody);
   // A true gateway restart (stop and start the service). The engine's own restart only reloads agents inside
   // the running process, so things read at startup (shell hooks) would not change.
   // extra connections of one app for one agent (WhatsApp 2…): admins, or whoever may edit that agent
   if(p.startsWith('/ui/channels')&&req.method!=='GET'){platCache.clear();setTimeout(()=>syncNotifyTool().catch(()=>{}),20000)}
   if(p==='/ui/channels/links'){const a=url.searchParams.get('agent')||'';
    if(req.method==='GET')return send(res,200,{links:(await links.list(a||null)).filter(l=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+l.agent+'/soul','PUT',new URLSearchParams(),l.agent)===null)});
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||a);
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only add connections to agents you may edit.'});
    try{if(req.method==='POST')return send(res,200,await links.create(ag,String(b.platform||'')));
     if(req.method==='DELETE'){const l=(await links.list()).find(x=>x.name===b.name&&x.agent===ag);if(!l)throw new Error('Unknown connection.');await links.remove(l.name);return send(res,200,{ok:true})}
     if(req.method==='PUT'){const l=(await links.list()).find(x=>x.name===b.name&&x.agent===ag);if(!l)throw new Error('Unknown connection.');return send(res,200,await links.rename(l.name,b.label))}}
    catch(e){return send(res,400,{error:e.message})}}
   // pictures agents make (MEDIA:/…/cache/generated/…): served to signed-in people, nothing outside those folders
   if(p==='/ui/media'&&req.method==='GET'){const want=String(url.searchParams.get('path')||'');const ext=(/\.(png|jpe?g|gif|webp|bmp)$/i.exec(want)||[])[1];
    let real='';try{real=await realpath(want)}catch{}
    const okDir=real&&(real.startsWith(HERMES_HOME+'/')||real.startsWith(path.join(homedir(),'workspaces')+'/'))&&/\/cache\/generated\/|\/workspaces\//.test(real);
    if(!ext||!okDir)return send(res,404,{error:'Not found'});
    if(!users.isAdmin(u)){const m=/\/workspaces\/([^/]+)\/|\/profiles\/([^/]+)\//.exec(real);const ag=(m&&(m[1]||m[2])||'default').split('--')[0];if(users.gate(u,'/ui/screens/'+ag,'GET',new URLSearchParams(),ag))return send(res,404,{error:'Not found'})}
    try{const buf=await readFile(real);res.writeHead(200,{'content-type':'image/'+(ext.toLowerCase()==='jpg'?'jpeg':ext.toLowerCase()),'cache-control':'private, max-age=86400',...security});return res.end(buf)}catch{return send(res,404,{error:'Not found'})}}
   // recently deleted agents (backups) and restoring one
   if(p==='/ui/agent-trash'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});const trash=path.join(DATA,'agent-trash');const out=[];
    for(const f of await readdir(trash).catch(()=>[])){const m=/^(.+)__(.+)\.tgz$/.exec(f);if(!m)continue;const st=await stat(path.join(trash,f)).catch(()=>null);if(!st)continue;
     if(Date.now()-st.mtimeMs>30*864e5){await unlink(path.join(trash,f)).catch(()=>{});continue}out.push({file:f,agent:m[1],deleted:st.mtimeMs,size:st.size})}
    return send(res,200,{items:out.sort((a,b)=>b.deleted-a.deleted)})}
   if(p==='/ui/agent-trash/purge'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');if(!/^[\w.-]+__[\w.-]+\.tgz$/.test(f)||f.includes('..'))return send(res,400,{error:'Unknown backup'});await unlink(path.join(DATA,'agent-trash',f)).catch(()=>{});console.log('deleted the kept backup',f);return send(res,200,{ok:true})}
   if(p==='/ui/agent-restore'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');const m=/^([a-z0-9][a-z0-9_-]{0,63})__[\w-]+\.tgz$/.exec(f);if(!m)return send(res,400,{error:'Unknown backup.'});
    const dir=path.join(HERMES_HOME,'profiles',m[1]);if(await stat(dir).catch(()=>null))return send(res,409,{error:'An agent with that name exists already.'});
    await mkdir(dir,{recursive:true});const {execFile}=await import('node:child_process');
    const ok=await new Promise(r=>execFile('tar',['-xzf',path.join(DATA,'agent-trash',f),'-C',dir],{timeout:180000},e=>r(!e)));if(!ok)return send(res,500,{error:'Could not unpack the backup.'});
    await users.restoreAgent(m[1]).catch(()=>{});restartGateway('restored '+m[1]).then(()=>agentHealth(m[1])).catch(()=>{});
    return send(res,200,{ok:true,agent:m[1]})}
   // plugins on/off for ONE agent (the engine's own plugin routes always change the main agent)
   if(p==='/ui/plugins/toggle'&&req.method==='POST'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can turn plugins on or off.'});
   if(p==='/ui/plugins/toggle'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),name=String(b.name||'');
    if(!/^[\w.@-]{1,80}$/.test(name))return send(res,400,{error:'Unknown plugin'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    const r=await hcmd(ag,['plugins',b.enabled?'enable':'disable',name],{timeout:150000});
    return r.ok?send(res,200,{ok:true,restart_required:/restart/i.test(r.out)}):send(res,400,{error:(r.err||'Could not change the plugin').slice(0,300)})}
   // today's US dollar → rupiah rate, so costs can be shown in rupiah (fetched twice a day, last good one kept)
   // Gemini through the Google AI subscription: status for everyone, signing in and out for admins
   // Google AI Pro through Antigravity (Google's agy tool): same flow as Gemini had
   if(p.startsWith('/ui/antigravity/')){const act=p.slice(16);if(act==='status'&&req.method==='GET')return send(res,200,await antigravity.status(url.searchParams.has('fresh')));
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect Google AI Pro.'});if(req.method!=='POST')return send(res,405,{error:'POST only'});
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{if(act==='start')return send(res,200,await antigravity.start());if(act==='code')return send(res,200,await antigravity.code(b.code));if(act==='logout')return send(res,200,await antigravity.logout())}catch(e){return send(res,400,{error:e.message})}
    return send(res,404,{error:'Unknown'})}
   if(p.startsWith('/ui/gemini/')){const act=p.slice(11);if(act==='status'&&req.method==='GET')return send(res,200,await gemini.status());
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect Gemini.'});if(req.method!=='POST')return send(res,405,{error:'POST only'});
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{if(act==='start')return send(res,200,await gemini.start());if(act==='code')return send(res,200,await gemini.code(b.code));if(act==='logout')return send(res,200,await gemini.logout())}catch(e){return send(res,400,{error:e.message})}
    return send(res,404,{error:'Unknown'})}
   if(p==='/ui/fx'&&req.method==='GET'){if(!FX.at||Date.now()-FX.at>12*3600e3){try{const r=await fetch('https://open.er-api.com/v6/latest/USD',{signal:AbortSignal.timeout(8000)});const j=await r.json();const v=+j?.rates?.IDR;if(v>1000&&v<100000)Object.assign(FX,{idr:v,at:Date.now(),day:(j.time_last_update_utc||'').slice(5,16)})}catch{}}
    return send(res,200,{IDR:FX.idr,updated:FX.day||null})}
   if(p==='/ui/box'&&req.method==='GET')return send(res,200,await boxMemory());
   // Google accounts an agent can use (the Google Workspace skill keeps one sign-in per account); never the tokens themselves
   if(p==='/ui/google-accounts'){const a=String(url.searchParams.get('agent')||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    if(req.method==='GET'){const out=[];for(const f of await readdir(home).catch(()=>[])){const m=/^google_token(?:_([\w.-]+))?\.json$/.exec(f);if(!m)continue;
      try{const j=JSON.parse(await readFile(path.join(home,f),'utf8'));const L=(await googleLabels())[a+'|'+(m[1]||'')]||{};out.push({name:m[1]||'',email:j.account||'',label:L.label||'',note:L.note||'',scopes:(j.scopes||[]).map(s=>String(s).split('/').pop()),renews:!!j.refresh_token,expiry:j.expiry||null})}catch{}}
     return send(res,200,{accounts:out})}
    // the name people see and a note on what the account is for; the agent is told both (see writeAgentContext).
    // The skill's own account name (google_token_<name>.json) never changes, so nothing has to sign in again.
    if(req.method==='PUT'){if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
     let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad request'})}const n=String(b.name||'');if(n&&!/^[\w.-]{1,60}$/.test(n))return send(res,400,{error:'Unknown account'});
     const all=await googleLabels();const k=a+'|'+n;const label=String(b.label||'').replace(/[\r\n"]+/g,' ').trim().slice(0,60),note=String(b.note||'').replace(/[\r\n]+/g,' ').trim().slice(0,400);
     if(label||note)all[k]={label,note};else delete all[k];await writeJsonAtomic(path.join(DATA,'google-accounts.json'),all);GLABELS=all;
     if(PORT===4400)writeAgentContext().catch(()=>{});return send(res,200,{ok:true,label,note})}
    if(req.method==='DELETE'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can remove a Google account.'});const n=String(url.searchParams.get('name')||'');if(n&&!/^[\w.-]{1,60}$/.test(n))return send(res,400,{error:'Unknown account'});
     await unlink(path.join(home,'google_token'+(n?'_'+n:'')+'.json')).catch(()=>{});console.log('removed google account',n||'(main)','from',a);return send(res,200,{ok:true})}}
   // WhatsApp Business (Meta's Cloud API) for one agent: the keys from Meta's app go in the agent's own .env, aqeelOS
   // makes the check word (verify token) and gives the address to paste into Meta. Values are never sent back.
   if(p==='/ui/channels/wa-cloud'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set up WhatsApp Business.'});
    const a=String(url.searchParams.get('agent')||'default');if(!(await listAllProfiles()).includes(a)||a.includes('--'))return send(res,400,{error:'Unknown agent'});
    const envF=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env');const KEYS={phone_number_id:'WHATSAPP_CLOUD_PHONE_NUMBER_ID',access_token:'WHATSAPP_CLOUD_ACCESS_TOKEN',app_secret:'WHATSAPP_CLOUD_APP_SECRET',app_id:'WHATSAPP_CLOUD_APP_ID',waba_id:'WHATSAPP_CLOUD_WABA_ID'};
    const read=async()=>{const t=await readFile(envF,'utf8').catch(()=>'');const v=k=>(new RegExp('^'+k+'=["\']?([^"\'\\n]*)','m').exec(t)||[])[1]||'';return {v,t}};
    const callback=PUBLIC_URL+'/whatsapp-cloud'+(a==='default'?'':'/'+a);
    if(req.method==='GET'){const {v}=await read();return send(res,200,{callback,verify_token:v('WHATSAPP_CLOUD_VERIFY_TOKEN'),set:Object.fromEntries(Object.entries(KEYS).map(([k,e])=>[k,!!v(e)]))})}
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{return send(res,400,{error:'Bad request'})}
     const put={};for(const [k,e] of Object.entries(KEYS)){const x=String(b[k]||'').trim();if(!x)continue;if(/[\s"'\\]/.test(x)||x.length>600)return send(res,400,{error:'That '+k.replace(/_/g,' ')+' does not look right.'});put[e]=x}
     if(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID&&!/^\d{6,30}$/.test(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID))return send(res,400,{error:'The phone number ID is the long number Meta shows under API Setup, not the phone number itself.'});
     const {v}=await read();if(!v('WHATSAPP_CLOUD_VERIFY_TOKEN'))put.WHATSAPP_CLOUD_VERIFY_TOKEN=randomBytes(18).toString('base64url');
     if(!(put.WHATSAPP_CLOUD_PHONE_NUMBER_ID||v(KEYS.phone_number_id))||!(put.WHATSAPP_CLOUD_ACCESS_TOKEN||v(KEYS.access_token)))return send(res,400,{error:'The phone number ID and the access token are both needed.'});
     await editEnv(envF,cur=>{const lines=cur.split('\n').filter(l=>!Object.keys(put).some(k=>l.startsWith(k+'=')));while(lines.length&&lines[lines.length-1]==='')lines.pop();return [...lines,...Object.entries(put).map(([k,x])=>k+'='+x),''].join('\n')});
     console.log('whatsapp business set up for',a,Object.keys(put).map(k=>k.replace('WHATSAPP_CLOUD_','')).join(' '));
     let on=true;try{await setChannelOn(a,'whatsapp_cloud',true)}catch(e){on=false;console.warn('whatsapp business on',a,e.message)}
     const r=await read();return send(res,200,{ok:true,on,callback,verify_token:r.v('WHATSAPP_CLOUD_VERIFY_TOKEN')})}}
   // Who can reach the AI box over SSH: one public key per device or AI tool, added and removed here (admins only).
   // Only public keys are ever handled; the key aqeelOS's own builder uses cannot be removed from here.
   if(p==='/ui/ssh-keys'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can manage access to the AI box.'});
    const f=path.join(homedir(),'.ssh','authorized_keys');const lines=(await readFile(f,'utf8').catch(()=>'')).split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#'));
    const {createHash}=await import('node:crypto');const fp=l=>{const b=l.trim().split(/\s+/)[1]||'';try{return 'SHA256:'+createHash('sha256').update(Buffer.from(b,'base64')).digest('base64').replace(/=+$/,'')}catch{return ''}};
    const list=()=>lines.map(l=>{const [type,,...c]=l.trim().split(/\s+/);return {type,name:c.join(' ')||'(no name)',fp:fp(l),protected:/^windows-pc$/.test(c.join(' '))}});
    if(req.method==='GET')return send(res,200,{keys:list(),host:SSH_HOST,port:SSH_PORT,user:'claude'});
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
    if(req.method==='POST'){const k=String(b.key||'').trim().replace(/\s+/g,' ');const name=String(b.name||'').trim().replace(/[^\w .@-]/g,'').slice(0,60);
     const m=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com) ([A-Za-z0-9+/=]{60,}) ?(.*)$/.exec(k);if(!m)return send(res,400,{error:'That is not an SSH public key. It starts with ssh-ed25519 (or ssh-rsa) and is one line. Never paste a private key.'});
     if(!name)return send(res,400,{error:'Give it a name, like “Aqeel’s MacBook” or “Codex on the office PC”.'});
     if(lines.some(l=>l.split(/\s+/)[1]===m[2]))return send(res,400,{error:'That key already has access.'});
     await mkdir(path.dirname(f),{recursive:true,mode:0o700});await writeFile(f,[...lines,m[1]+' '+m[2]+' '+name.replace(/\s+/g,'-')].join('\n')+'\n',{mode:0o600});console.log('ssh access added:',name,'by',u.name||u.id);return send(res,200,{keys:(lines.push(m[1]+' '+m[2]+' '+name.replace(/\s+/g,'-')),list())})}
    if(req.method==='DELETE'){const i=list().findIndex(x=>x.fp===b.fp);if(i<0)return send(res,404,{error:'No such key'});if(list()[i].protected)return send(res,400,{error:'This key is how aqeelOS itself is maintained; it stays.'});
     const name=list()[i].name;lines.splice(i,1);await writeFile(f,lines.join('\n')+'\n',{mode:0o600});console.log('ssh access removed:',name,'by',u.name||u.id);return send(res,200,{keys:list()})}}
   if(p==='/ui/memory'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});return send(res,200,await memNow())}
   if(p==='/ui/system-events'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{events:[]});return send(res,200,{events:sysEvents})}
   if(p==='/ui/thinking'&&req.method==='GET'){const sid=String(url.searchParams.get('session')||'');if(!/^[\w.-]{3,120}$/.test(sid))return send(res,200,{items:[]});const l=await readFile(path.join(DATA,'thinking',sid+'.json'),'utf8').then(JSON.parse).catch(()=>[]);return send(res,200,{items:l.filter(x=>users.isAdmin(u)||x.by===u.id).map(({u:q,think})=>({u:q,think}))})}
   if(p==='/ui/live'&&req.method==='GET'){const rec=LIVE.get((url.searchParams.get('agent')||'default')+'|'+(url.searchParams.get('session')||''));
    if(!rec||rec.done||rec.user!==u.id)return send(res,url.searchParams.has('peek')?200:204,url.searchParams.has('peek')?{live:false}:'');
    if(url.searchParams.has('peek'))return send(res,200,{live:true,since:rec.t});
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
    for(const c of rec.chunks)res.write(c);rec.subs.add(res);res.on('close',()=>rec.subs.delete(res));return}
   if(p==='/ui/gateway/restart'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can restart the gateway.'});
    const waiting=liveCount();restartGateway('restart from the app ('+(u.name||u.id)+')').catch(()=>{});return send(res,200,{ok:true,waiting})}
   // each agent's setup result, for the Agents page (what failed, so it can be finished with one click)
   if(p==='/ui/agent-setup'&&req.method==='GET'){const st=await getStatus();const out={};for(const [a,v] of Object.entries(st))if(users.isAdmin(u)||users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)===null)out[a]={ok:v.ok!==false,failed:v.failed||[],t:v.t||0};return send(res,200,{agents:out})}
   // an agent for someone who must not have terminal, files, code or computer use: locked on every channel, and kept so
   // how an agent handles commands that need approval: ask (manual) or Smart (an AI reviewer passes safe ones and asks you about the rest)
   // each person's own settings (drafts, Allow all per chat, folded sections, filters, notifications), kept on the
   // box so they are the same on every device; values are the browser's own strings, capped in size
   if(p==='/ui/prefs'){const id=String(u?.id||'owner').replace(/[^\w-]/g,'_');const f=path.join(DATA,'prefs',id+'.json');
    const cur=await readFile(f,'utf8').then(JSON.parse).catch(()=>({}));
    if(req.method==='GET')return send(res,200,{prefs:cur});
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,600000))}catch{return send(res,400,{error:'Bad settings'})}
     for(const [k,v] of Object.entries(b.set||{}))if(/^(hui-|draft:|cronSeen:|chAlert:|cronFail:)/.test(k)&&k.length<200)cur[k]=String(v).slice(0,40000);
     for(const k of b.del||[])delete cur[k];
     // keep it small: drop the oldest seen-markers first
     const keys=Object.keys(cur);if(JSON.stringify(cur).length>500000)for(const k of keys.filter(k=>/^(cronFail:|chAlert:|draft:)/.test(k)).slice(0,Math.ceil(keys.length/4)))delete cur[k];
     await mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';await writeFile(t,JSON.stringify(cur));await rename(t,f);return send(res,200,{ok:true})}}
   if(p==='/ui/agent-approvals'){const ag=req.method==='GET'?(url.searchParams.get('agent')||'default'):null;let b={};if(req.method==='PUT'){try{b=JSON.parse(await readBody(req,2048))}catch{}}
    const a=ag||String(b.agent||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    if(req.method==='GET'){const c=await readConfig(a);return send(res,200,{mode:pick(c,'approvals.mode')||'manual'})}
    if(req.method==='PUT'){if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a))return send(res,403,{error:'You can chat with this agent but not change how it asks for approval.'});const mode=b.mode==='smart'?'smart':'manual';const r=await setKey(a,'approvals.mode',mode);if(!r.ok)return send(res,500,{error:r.err||'Could not save'});console.log('approvals for',a,'→',mode);return send(res,200,{mode})}}
   if(p==='/ui/agent-safe'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'');
    if(!await isAgent(ag)||ag==='default')return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    try{await setStatus(ag,{safe:true});await lockTools(ag);return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
   // abilities across agents: who has what, copy to other agents, rename an MCP tool (admins, or owners of both agents)
   if(p==='/ui/share/used'&&req.method==='GET'){const kind=url.searchParams.get('kind')||'';const all=await sharing.usedBy(kind);if(!users.isAdmin(u)){for(const k of Object.keys(all))all[k]=all[k].filter(a=>users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)===null)}return send(res,200,all)}
   if(p==='/ui/share'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||''),to=(Array.isArray(b.to)?b.to:[]).map(String);
    const may=a=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null;if(!may(from)||!to.every(may))return send(res,403,{error:'You can only share between agents you can edit.'});
    if(!users.isAdmin(u)&&b.kind==='mcp')return send(res,403,{error:'Only admins can copy MCP tools between agents.'});
    try{return send(res,200,await sharing.share(String(b.kind||''),String(b.name||''),from,to))}catch(e){return send(res,400,{error:e.message})}}
   // a provider without automatic registration (Slack, Google…): its app's client ID/secret, and the return address to give it
   if(p==='/ui/mcp/oauth-client'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set this.'});let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{return send(res,200,await sharing.setOauthClient(String(b.agent||'default'),String(b.name||''),String(b.client_id||'').trim(),String(b.client_secret||'').trim(),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||''))))}catch(e){return send(res,400,{error:e.message})}}
   // every agent's model and the account it runs on, for "All agents" on Agents' models
   if(p==='/ui/n8n/status'&&req.method==='GET'){const a=String(url.searchParams.get('agent')||'default');
    // every agent's n8n address is for admins only; a member sees an agent's own only when they have that agent
    // (the n8n page always asks for the main agent, so no access still answers, just without the address)
    const s=await n8n.status(a);if(!users.isAdmin(u)){delete s.users;if(users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))s.user=null}return send(res,200,s)}
   if(p==='/ui/code/pair'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,{token:await code.pair(u.id,b.name)})}
   if(p==='/ui/code/online'&&req.method==='GET'){return send(res,200,{url:codeOnline.url(u.id),origin:new URL(codeOnline.url(u.id)).origin})}
   // Files: search a folder and everything inside it (names only), and which of the quick places exist
   if(p==='/ui/files/search'&&req.method==='GET'){const root=path.resolve(url.searchParams.get('path')||homedir()),q=String(url.searchParams.get('q')||'').trim().toLowerCase(),hid=url.searchParams.get('hidden')==='1';
    if(!q)return send(res,200,{results:[]});if(!users.filePathOk(u,root))return send(res,403,{error:'You can only search your own files.'});
    const SKIP=new Set(['node_modules','.git','__pycache__','.venv','venv','.cache','.npm','.local','browser-profile']);const out=[];let seen=0;const queue=[[root,0]];
    const t0=Date.now();while(queue.length&&seen<300000&&Date.now()-t0<4000&&out.length<200){const [dir,depth]=queue.shift();let list=[];try{list=await readdir(dir,{withFileTypes:true})}catch{continue}
     for(const e of list){seen++;if(!hid&&e.name.startsWith('.'))continue;const fp=path.join(dir,e.name);const isDir=e.isDirectory();
      if(e.name.toLowerCase().includes(q)){let st=null;try{st=await stat(fp)}catch{}out.push({name:e.name,path:fp,is_directory:isDir,size:st?.size||0,mtime:st?Math.floor(st.mtimeMs/1000):0,rel:path.relative(root,dir)||'.'});if(out.length>=200)break}
      if(isDir&&!SKIP.has(e.name)&&depth<8)queue.push([fp,depth+1])}}
    return send(res,200,{results:out,more:out.length>=200||queue.length>0})}
   if(p==='/ui/files/exist'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const ok=[];for(const x of (Array.isArray(b.paths)?b.paths:[]).slice(0,20)){const fp=path.resolve(String(x));if(!users.filePathOk(u,fp))continue;try{if((await stat(fp)).isDirectory())ok.push(String(x))}catch{}}return send(res,200,{exist:ok})}
   if(p.startsWith('/ui/brand')&&req.method!=='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins change the branding.'});
    try{let r;if(p==='/ui/brand'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}r=await brand.setName(b.name)}
     else if(p==='/ui/brand/logo'&&req.method==='POST')r=await brand.setLogo(await readRaw(req,600*1024),String(req.headers['content-type']||''));
     else if(p==='/ui/brand/logo'&&req.method==='DELETE')r=await brand.clearLogo();else return send(res,404,{error:'Not found'});
     globalThis.AQ_BRAND=r.name;console.log('branding changed by',u.name||u.id,'→',r.name);return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/code/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const d=await code.runs(days,users.isAdmin(u)?null:u.id);const people={};for(const id of Object.keys(d.byPerson)){const x=users.byId(id);people[id]={name:x?.name||id,avatar:x?.avatar?'/ui/people/avatar/'+id:null}}return send(res,200,{...d,people})}
   // Bottlenecks: what is stuck until a person acts (admins also see what aqeelOS itself noticed)
   // Live: every published app (everyone sees them; publisher or admin takes one offline; admins connect the server)
   // Connected apps › Code (admins): every computer's Code with its GitHub accounts and tool servers, and Live's server
   if(p==='/ui/code/connected'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const names=Object.fromEntries(users.people().map(x=>[x.id,x.name||x.username||'Someone']));
    return send(res,200,{devices:(await code.allDevices()).map(d=>({...d,person:names[d.user]||'Someone'})),live:{connected:(await live.list(u,true)).connected}})}
   // backups to Google Drive (admins): the state, back up now, a restore test, and the key that unlocks them
   if(p.startsWith('/ui/backups')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(p==='/ui/backups'&&req.method==='GET')return send(res,200,await backups.status());
    if(p==='/ui/backups/key'&&req.method==='GET')return send(res,200,{key:await backups.key()});
    if(p==='/ui/backups/run'&&req.method==='POST'){backups.run('by hand').catch(()=>{});return send(res,200,{started:true})}
    if(p==='/ui/backups/test'&&req.method==='POST'){try{return send(res,200,await backups.test())}catch(e){return send(res,400,{error:e.message})}}}
   // which aqeelOS app version is current (the app offers to update itself when it is older)
   if(p==='/ui/code/app-version'&&req.method==='GET'){let v={};try{v=JSON.parse(await readFile(path.join(DATA,'desktop','version.json'),'utf8'))}catch{}return send(res,200,v)}
   // company-wide defaults (the currency for people who never picked one): everyone reads them, admins set them
   if(p==='/ui/defaults'){const F=path.join(DATA,'defaults.json');let d={};try{d=JSON.parse(await readFile(F,'utf8'))}catch{}
    if(req.method==='GET')return send(res,200,d);if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
    if(b.currency!==undefined){if(!['USD','IDR'].includes(b.currency))return send(res,400,{error:'Pick USD or IDR.'});d.currency=b.currency}await writeFile(F,JSON.stringify(d,null,1));return send(res,200,d)}
   if(p==='/ui/apps'&&req.method==='GET')return send(res,200,{...await live.list(u,users.isAdmin(u)),admin:users.isAdmin(u)});
   if(p.startsWith('/ui/apps/')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{if(p==='/ui/apps/check'){const a=await live.check(String(b.id||''));return send(res,200,{status:a.status,error:a.error||''})}
     if(p==='/ui/apps/remove')return send(res,200,await live.remove(u,users.isAdmin(u),String(b.id||'')));
     if(p==='/ui/apps/connect'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,await live.connect(b))}}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/bottlenecks'&&req.method==='GET'){const admin=users.isAdmin(u);if(admin)await freshSignins();const items=await bottlenecks.list({admin,mayUse:a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a),signins:admin?[...signinsDue.values()]:[],invites:admin?users.expiredInvites():[]});const mayU=a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);items.push(...await accessAsk.open(admin?()=>true:mayU).catch(()=>[]));return send(res,200,{items})}
   if((p==='/ui/bottlenecks/done'||p==='/ui/bottlenecks/later')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const id=String(b.id||'');if(!id)return send(res,400,{error:'Which one?'});if(!users.isAdmin(u)&&!id.startsWith('report|'))return send(res,403,{error:'Only admins.'});await (p.endsWith('done')?bottlenecks.done(id):bottlenecks.later(id));return send(res,200,{ok:true})}
   if(p==='/ui/code/devices'&&req.method==='GET')return send(res,200,{devices:await code.devices(u.id)});
   if(p==='/ui/code/unpair'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}await code.unpair(u.id,String(b.id||''));return send(res,200,{ok:true})}
   {const dm=/^\/ui\/code\/download\/(windows|mac)$/.exec(p);if(dm&&req.method==='GET'){
    // the aqeelOS app installer (Windows: aqeelOS-Setup.exe, Mac: aqeelOS.dmg). ?check=1 says whether it is there; without one
    // there is nothing to give (the older zip ran Code outside the app, which the browser no longer opens)
    {const f=path.join(DATA,'desktop',dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS-Setup.exe');const st=await stat(f).catch(()=>null);
     if(url.searchParams.get('check'))return send(res,200,{ok:Boolean(st)});
     if(st){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+(dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS Setup.exe')+'"','content-length':st.size,...security});return createReadStream(f).pipe(res)}}
    return send(res,404,{error:'The aqeelOS app for '+(dm[1]==='mac'?'Mac':'Windows')+' isn’t ready yet.'})}}
   if(p==='/ui/n8n/spaces'&&req.method==='GET'){const mine=users.isAdmin(u)?null:new Set((await listAgents()).filter(a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a)));const l=(await n8n.spaces()).filter(x=>!mine||mine.has(x.agent));
    return send(res,200,{spaces:l.map(x=>({...x,name:NAMES[x.agent]||x.agent,shared:x.shared.filter(a=>!mine||mine.has(a))})),agents:(await listAgents()).filter(a=>!mine||mine.has(a)).map(a=>({id:a,name:NAMES[a]||a})),canEdit:users.isAdmin(u)})}
   if(p==='/ui/n8n/share'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share an agent’s n8n.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await n8n.share(String(b.space||''),String(b.agent||''),!!b.on))}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/n8n/owner'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect n8n.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{await n8n.setOwner(String(b.email||'').trim(),String(b.password||''));console.log('n8n: owner login saved');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/n8n/open'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const a=String(b.agent||'default');
    // admins can open n8n as its owner, to see every agent's workflows
    if(b.owner){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can open n8n as its owner.'});if(!await n8n.ready())return send(res,409,{error:'n8n is not connected yet.'});const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket('__owner')})}if(!(await listAgents()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    try{const r=await n8n.ensure(a);const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket(a),email:r.email})}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/models/agents'&&req.method==='GET'){const out=[];for(const a of await listAgents()){if(!users.isAdmin(u)&&!users.byId(u.id)?.agents?.[a])continue;const c=await readConfig(a).catch(()=>null)||{};
     out.push({id:a,name:NAMES[a]||await displayName(a),model:c.model?.default||'',provider:c.model?.provider||''})}return send(res,200,{agents:out})}
   // Access: who owns each connection and which agents may use it (see access.mjs). Admins only.
   // asking for access: anyone may see what the other agents have (names only) and ask for it for an agent they use; admins decide
   if(p==='/ui/access/others'&&req.method==='GET'){const agent=String(url.searchParams.get('agent')||'default');const mayU=a=>users.isAdmin(u)||!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);if(!mayU(agent))return send(res,403,{error:'Not your agent.'});
    return send(res,200,{items:await accessAsk.others(agent),asked:(await accessAsk.of(agent)).filter(r=>!r.done).map(r=>r.kind+'|'+r.id)})}
   if(p==='/ui/access/ask'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const to=String(b.agent||''),by=String(b.by||to);const mayU=a=>users.isAdmin(u)||!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);
    if(!mayU(b.dir==='give'?by:to))return send(res,403,{error:'Not your agent.'});try{const r=await accessAsk.ask({kind:String(b.kind||''),id:String(b.id||''),to,by,dir:b.dir==='give'?'give':'get',why:b.why,person:u.name||u.email||''});console.log('access asked:',b.dir||'get',b.kind,b.id,'for',to);return send(res,200,{ok:true,...r})}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/access/decide'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can allow access.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{const r=await accessAsk.decide(String(b.rid||''),!!b.ok,u.name||u.email||'');console.log('access request',r.rid,r.ok?'allowed':'declined');return send(res,200,{ok:true,...r})}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/access'||p==='/ui/access/owner'){const KINDS=['mcp','google','plugin','key'];
    // everyone sees the agents they may use (admins: every agent); only admins change who uses what, and see keys
    if(req.method==='GET'){const kind=String(url.searchParams.get('kind')||'');if(!KINDS.includes(kind))return send(res,400,{error:'Unknown kind'});
     if(users.isAdmin(u))return send(res,200,{...await access.list(kind),canEdit:true});if(kind==='key')return send(res,403,{error:'Only admins can see keys.'});
     return send(res,200,{...await access.list(kind,new Set((await listAgents()).filter(a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a)))),canEdit:false})}
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change who uses a connection.'});
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const kind=String(b.kind||''),id=String(b.id||''),agent=String(b.agent||'');
     if(!KINDS.includes(kind)||!id||!(await listAgents()).includes(agent))return send(res,400,{error:'Bad request'});
     try{const r=p==='/ui/access/owner'?await access.setOwner(kind,id,agent):b.on?await access.grant(kind,id,agent,b.from?String(b.from):undefined):await access.revoke(kind,id,agent);console.log('access:',kind,id,p==='/ui/access/owner'?'owner →':b.on?'on for':'off for',agent);return send(res,200,{ok:true,...r})}catch(e){return send(res,409,{error:e.message})}}}
   if(p==='/ui/mcp/signins'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{items:[]});await freshSignins();
    // for each, the other agents that are signed in to the same app (their sign-in can be used instead)
    const l=await access.list('mcp').catch(()=>({items:[]}));
    return send(res,200,{checked:signinsAt,items:[...signinsDue.values()].map(x=>{const it=l.items.find(y=>y.id===x.name);return {...x,others:(it?.users||[]).filter(u2=>u2.signed&&u2.id!==x.agent).map(u2=>({id:u2.id,name:u2.name}))}})})}
   // "Use on other agents": a connected app (its settings and its sign-in) copied to other agents, so a second
   // agent can use n8n, Notion… without signing in again. The agents restart once nobody is mid-reply.
   if(p==='/ui/mcp/share'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share connected apps between agents.'});
    const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);const all=await listAgents();
    if(req.method==='GET'){const from=String(url.searchParams.get('from')||'default'),name=String(url.searchParams.get('name')||'');
     const out=[];for(const a of all){if(a===from)continue;const c=await readConfig(a).catch(()=>null);out.push({id:a,name:NAMES[a]||await displayName(a),has:!!pick(c||{},'mcp_servers.'+name)})}return send(res,200,{agents:out})}
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||'default'),name=String(b.name||'');const to=(Array.isArray(b.to)?b.to:[]).map(String).filter(a=>all.includes(a)&&a!==from);
     if(!/^[\w.-]{1,64}$/.test(name)||name==='aqeelos-notify')return send(res,400,{error:'This app can’t be shared.'});
     const src=pick(await readConfig(from).catch(()=>null)||{},'mcp_servers.'+name);if(!src||typeof src!=='object')return send(res,404,{error:'That app isn’t set up on this agent.'});
     const tokDir=path.join(homeOf(from),'mcp-tokens');const toks=(await readdir(tokDir).catch(()=>[])).filter(f=>f===name+'.json'||f.startsWith(name+'.')&&/\.(meta|client)\.json$/.test(f));
     const done=[];for(const a of to){const r=await setKey(a,'mcp_servers.'+name,src);if(!r.ok)return send(res,500,{error:(NAMES[a]||a)+': '+(r.err||'could not save')});
      const dst=path.join(homeOf(a),'mcp-tokens');await mkdir(dst,{recursive:true,mode:0o700});for(const f of toks)await copyFile(path.join(tokDir,f),path.join(dst,f)).catch(()=>{});done.push(NAMES[a]||a)}
     if(done.length){console.log('connected app',name,'from',from,'now also on',done.join(', '));restartGateway('connected app '+name+' shared').catch(()=>{})}
     return send(res,200,{ok:true,agents:done})}}
   if(p==='/ui/mcp/start-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),tool=String(b.name||'');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'});
    try{const pr=await sharing.prepareSignin(ag,tool,MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(tool));if(pr.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,await startSignin(ag,tool))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/mcp/prepare-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'});
    try{const r=await sharing.prepareSignin(ag,String(b.name||''),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||'')));if(r.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/mcp/oauth-redirect'&&req.method==='GET')return send(res,200,{redirect:MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(url.searchParams.get('name')||'')});
   if(p==='/ui/share/duplicate'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(b.kind==='schedule'&&!users.isAdmin(u)&&!users.can(u,'schedules'))return send(res,403,{error:'Your role does not include schedules.'});
    if(b.kind==='mcp'&&!users.can(u,'unsafe')&&!users.isAdmin(u))return send(res,403,{error:'Ask an admin to duplicate MCP tools.'});
    try{return send(res,200,await sharing.duplicate(String(b.kind||''),ag,String(b.name||''),String(b.to||'')))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/share/rename-mcp'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can rename MCP tools.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await sharing.renameMcp(String(b.agent||'default'),String(b.from||''),String(b.to||'')))}catch(e){return send(res,400,{error:e.message})}}
   // channels across all agents (admins), and handing one to another agent
   if(p==='/ui/channels'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can see every channel.'});return send(res,200,{channels:await channels.list()})}
   // WhatsApp: clear a login that WhatsApp has ended, so a fresh QR can link the phone again
   if(p==='/ui/secrets/give'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}const base=String(b.agent||'default').split('--')[0];
    if(!(await listAgents()).includes(base))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+base,'GET',new URLSearchParams(),base))return send(res,403,{error:'Not your agent.'});
    const label=String(b.label||'').trim().slice(0,140),value=String(b.value||'');if(!label)return send(res,400,{error:'Say what it is, so the agent knows when to use it.'});if(!value||value.length>8000)return send(res,400,{error:'Type or paste the value.'});
    let name=String(b.name||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);if(!/^[A-Z]/.test(name))name='SECRET_'+name;if(name.length<3)name='SECRET_'+Date.now().toString(36).toUpperCase();
    if(RESERVED_KEY.test(name)&&!users.isAdmin(u))name='SECRET_'+name;
    // a member who may only chat cannot replace a key that already exists and was not given as a secret
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)){const envT=await readFile(path.join(base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base),'.env'),'utf8').catch(()=>'');if(new RegExp('^'+name+'=','m').test(envT)&&!await stat(path.join(secretDir(base),name)).catch(()=>null))name='SECRET_'+name}
    try{await saveSecret(base,name,value,{admin:users.isAdmin(u)})}catch(e){return send(res,400,{error:e.message})}console.log('secret saved for',base,'('+name+')');
    return send(res,200,{ok:true,name,message:'🔒 '+label+' — saved for you as '+name+'. You cannot see the value. '+secretHow(base,name)})}
   if(p==='/ui/secrets/pending'&&req.method==='GET'){const ag=String(url.searchParams.get('agent')||'default').split('--')[0];
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+ag,'GET',new URLSearchParams(),ag))return send(res,200,{items:[]});
    return send(res,200,{items:[...[...secretAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,label:x.label,mode:x.mode,name:x.name,enter:x.enter,t:x.t,expires:x.t+270000})),
     ...[...browserAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,kind:'browser',task:x.task,suggest:x.suggest,why:x.why,t:x.t,expires:x.t+270000,connected:localBrowser.connected(u.id)}))]})}
   if(p==='/ui/local-browser/pair'&&req.method==='POST')return send(res,200,{token:await localBrowser.pair(u.id)});
   if(p==='/ui/local-browser/version'&&req.method==='GET')return send(res,200,{latest:await localBrowser.latest()});
   if(p==='/ui/local-browser/status'&&req.method==='GET')return send(res,200,{connected:localBrowser.connected(u.id),version:localBrowser.version(u.id),latest:await localBrowser.latest(),session:url.searchParams.get('session')?localBrowser.linked(url.searchParams.get('session')):undefined});
   if(p==='/ui/local-browser/extension.zip'&&req.method==='GET'){const z=await localBrowser.zip();res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="aqeelos-browser.zip"','content-length':z.length,...security});return res.end(z)}
   if(p==='/ui/local-browser/frame'&&req.method==='GET'){const ses=url.searchParams.get('session')||'';if(ses)localBrowser.retitle(ses,url.searchParams.get('title')||'');const r=await localBrowser.ask(u.id,'frame',6000,ses?{session:ses}:{});res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...security});return res.end(JSON.stringify({connected:!r.offline,...r,type:undefined,id:undefined}))}
   if(p==='/ui/local-browser/focus'&&req.method==='POST'){const ses=url.searchParams.get('session')||'';return send(res,200,await localBrowser.ask(u.id,'focus',6000,ses?{session:ses}:{}))}
   if(p==='/ui/local-browser/off'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,{ok:localBrowser.unlink(String(b.session||''),users.isAdmin(u)?null:u.id)})}
   {const bm=/^\/ui\/browser-choice\/([\w-]+)$/.exec(p);if(bm&&req.method==='POST'){const rec=browserAsks.get(bm[1]);if(!rec)return send(res,404,{error:'This question has ended. Ask the agent again.'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'});
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const session=String(b.session||'');
    // the chat named must be the caller's own, whichever browser they pick
    if(session&&!users.isAdmin(u)&&users.ownerOf(session)!==u.id)return send(res,403,{error:'That chat is not yours.'});
    if(b.where==='yours'){if(!session)return send(res,400,{error:'Open the chat the agent is working in, then choose.'});
     try{await localBrowser.link(u.id,rec.base,session,String(b.title||''))}catch(e){return send(res,409,{error:e.message})}
     browserAsks.delete(rec.id);rec.resolve({text:'The person chose their own browser. Its tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_press, browser_scroll, browser_back) are added from your next turn and run in their Chrome, in a separate window they can watch, with the sign-ins they already have there. End this turn now with one short line saying you are ready; aqeelOS then tells you to go ahead. In this chat do not use browser_exec (that one runs on the AI box). Screenshots and browser_vision are not available in their browser; read pages with browser_snapshot. Ask before you submit anything that sends, pays, deletes or invites.'});return send(res,200,{ok:true})}
    if(session)localBrowser.unlink(session,users.isAdmin(u)?null:u.id);browserAsks.delete(rec.id);rec.resolve({text:'The person chose your screen on the AI box. Use your browser as usual there.'});return send(res,200,{ok:true})}}
   {const sm=/^\/ui\/secrets\/([\w-]+)$/.exec(p);if(sm&&req.method==='POST'){const rec=secretAsks.get(sm[1]);if(!rec)return send(res,404,{error:'This request has ended. Ask the agent again.'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'});
    let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}
    if(b.cancel){secretAsks.delete(rec.id);rec.resolve({text:'The person chose not to give it. Do not ask again unless they say so.',isError:true});return send(res,200,{ok:true})}
    const value=String(b.value||'');if(!value||value.length>8000)return send(res,400,{error:'Type or paste the value first.'});
    try{const text=await useSecret(rec,value,{admin:users.isAdmin(u)});secretAsks.delete(rec.id);rec.resolve({text});console.log('secret given to',rec.agent,'('+rec.mode+(rec.name?' '+rec.name:'')+')');return send(res,200,{ok:true,text:rec.mode==='type'?'Typed into the screen.':'Saved as '+rec.name+'.'})}
    catch(e){return send(res,409,{error:e.message})}}}   // stays open: the person can fix it (open the screen) and send again
   if(p==='/ui/channels/check'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),pf=String(b.platform||'');
    if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf))return send(res,400,{error:'Unknown channel'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+ag.split('--')[0],'GET',new URLSearchParams(),ag.split('--')[0]))return send(res,403,{error:'Not your agent.'});
    const r=await checkChannel(ag,pf);attention.t=0;return send(res,200,r)}
   if(p==='/ui/channels/attention'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{items:[]});return send(res,200,{items:await channelAttention(url.searchParams.has('fresh'))})}
   // removing a WhatsApp that is no longer wanted: its connection stops, the ended login is set aside, the channel is switched off
   if(p==='/ui/channels/remove'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||''),pf=String(b.platform||'');
    if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook','whatsapp'].includes(pf))return send(res,400,{error:'Unknown channel'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(ag.includes('--')){await links.remove(ag).catch(()=>{});platCache.clear();attention.t=0;return send(res,200,{ok:true})}
    const pl=await platformsCached(ag).catch(()=>null);const c=(pl?.platforms||pl||[]).find(x=>x.id===pf);const keys=(c?.env_vars||[]).map(v=>v.key).filter(Boolean);
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
    const r=await fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{},clear_env:keys,profile:ag})});const j=await r.json().catch(()=>({}));
    if(!r.ok)return send(res,400,{error:j.detail||j.error||'The engine did not accept it.'});
    const ps=await pausedLoad();if(ps[ag+'|'+pf]){delete ps[ag+'|'+pf];await pausedSave(ps)}
    platCache.clear();attention.t=0;if(!j.hot_served&&ag==='default')restartGateway(pf+' removed from '+ag).catch(()=>{});console.log('channel',pf,'removed from',ag);return send(res,200,{ok:true})}
   if(p==='/ui/channels/whatsapp/remove'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(ag.includes('--')){await links.remove(ag).catch(()=>{});platCache.clear();attention.t=0;return send(res,200,{ok:true,removed:'extra'})}
    await stopBridges(ag);const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    if(await stat(dir).then(()=>true,()=>false))await rename(dir,dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-')).catch(()=>{});
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
    const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{WHATSAPP_ENABLED:'false'},profile:ag})}).then(r=>r.json()).catch(()=>({}));
    platCache.clear();attention.t=0;if(!r.hot_served&&ag==='default')restartGateway('WhatsApp removed from '+ag).catch(()=>{});console.log('whatsapp removed from',ag);return send(res,200,{ok:true})}
   if((p==='/ui/channels/whatsapp/prepare'||p==='/ui/channels/whatsapp-reset')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}waLinking.set(String(b.agent||'default'),Date.now());
    const ag=String(b.agent||'default');if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only link channels of agents you may edit.'});
    const home=ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),dir=path.join(home,'platforms','whatsapp','session');
    platCache.delete(ag);const pl=await platformsCached(ag).catch(()=>null);const w=(pl?.platforms||pl||[]).find?.(x=>x.id==='whatsapp');
    // a working link is never thrown away by accident: replacing it (another phone) has to be asked for
    if(w?.state==='connected'&&!b.replace)return send(res,409,{error:'This WhatsApp is connected'+(w.account?.phone?' ('+w.account.phone+')':'')+'. To link a different phone, choose “Link a different phone”.',connected:true,account:w.account||null});
    // the engine still retrying the old login would fight the new QR on the same files: switch it off first
    if(w&&/retrying|reconnecting|connecting|starting/.test(w.state||'')){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
     const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{},profile:ag})}).then(r=>r.json()).catch(()=>({}));
     if(!r.hot_served)await restartGateway('stopping WhatsApp retries on '+ag+' before linking')}
    const stopped=await stopBridges(ag);
    let kept=null;if(await stat(dir).then(()=>true,()=>false)){const keep=dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-');kept=path.basename(keep);await rename(dir,keep).catch(async()=>{const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true})});
     const parent=path.dirname(dir);const old=(await readdir(parent).catch(()=>[])).filter(n=>n.startsWith('session.unlinked-')).sort().reverse().slice(2);   // keep the last two ended logins only
     const {rm}=await import('node:fs/promises');for(const o of old)await rm(path.join(parent,o),{recursive:true,force:true}).catch(()=>{})}
    platCache.clear();console.log('whatsapp: cleared the ended login of',ag,stopped?'(stopped '+stopped+' bridge)':'');return send(res,200,{ok:true,was:w?.account||null,kept})}
   // the QR window closed before a phone was linked: the ended login goes back, so the channel still shows (Logged out · Link again)
   if(p==='/ui/channels/whatsapp/restore'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),kept=String(b.kept||'');
    if(!(await listAllProfiles()).includes(ag)||!/^session\.unlinked-[\w-]+$/.test(kept))return send(res,400,{error:'Nothing to restore'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'Not your agent.'});
    const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    if(await stat(path.join(dir,'creds.json')).then(()=>true,()=>false))return send(res,200,{ok:true,restored:false});   // a new phone got linked after all
    await stopBridges(ag,{pairOnly:true});const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true});await rename(path.join(path.dirname(dir),kept),dir).catch(()=>{});platCache.clear();return send(res,200,{ok:true,restored:true})}
   if(p==='/ui/channels/shares'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share channels.'});
    if(req.method==='GET'){const sh=await relay.shares();return send(res,200,{shares:sh})}
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const v=await relay.setShare(String(b.owner||''),String(b.platform||''),b);syncNotifyTool().catch(e=>console.warn('notify tool',e.message));return send(res,200,{share:v})}}
   if(p==='/ui/channels/recipients'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,{recipients:await relay.recipients(url.searchParams.get('owner')||'default',url.searchParams.get('platform')||'')})}
   if(p==='/ui/channels/send'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const from=String(b.from||b.owner||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+from,'GET',new URLSearchParams(),from))return send(res,403,{error:'You can only send as an agent you use.'});
    try{return send(res,200,await relay.sendAs(from,String(b.owner||''),String(b.platform||''),String(b.text||''),b.chat?String(b.chat):null,{person:!users.isAdmin(u)}))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/for'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,{channels:await relay.channelsFor(a)})}   // its own, its extra connections and shared ones, each with an ID
   // Schedules: folders, plain descriptions, recipients by name and what each run cost
   if(p==='/ui/schedules/info'&&req.method==='GET'){try{const d0=await schedules.info();const d={...d0,meta:{...d0.meta},runs:{...d0.runs},names:{...d0.names}};if(!users.isAdmin(u)){d.names={};const ok=a=>!users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a);for(const k of Object.keys(d.meta))if(!ok(k.split('|')[0]))delete d.meta[k];for(const k of Object.keys(d.runs))if(!ok(k.split('|')[0]))delete d.runs[k]}return send(res,200,d)}catch(e){return send(res,500,{error:e.message})}}
   if(p==='/ui/schedules/detail'&&req.method==='GET'){const a=url.searchParams.get('profile')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    try{return send(res,200,await schedules.detail(a,url.searchParams.get('id')||''))}catch(e){return send(res,404,{error:e.message})}}
   if(p==='/ui/schedules/meta'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const a=String(b.profile||'default');if(!users.isAdmin(u)&&users.gate(u,'/hapi/cron/jobs','POST',new URLSearchParams('profile='+a),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,await schedules.setMeta(a,String(b.id||''),b))}
   if(p==='/ui/schedules/folder'&&req.method==='POST'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can rename folders.'});
   if(p==='/ui/schedules/folder'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}try{return send(res,200,await schedules.folderOp(b))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/job-relays'&&req.method==='GET'){const all=await relay.jobRelays();if(users.isAdmin(u))return send(res,200,all);const out={};for(const [k,v] of Object.entries(all||{})){const a=k.split('|')[0];if(!users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))out[k]=v}return send(res,200,out)}
   // reconnect ONE channel: a second agent's channel is switched off and on by itself (no engine restart);
   // the main agent's channels live in the engine itself, so for those the proper restart is the only way
   // a short note on a channel (what it is for), shown on its row
   if(p==='/ui/channels/note'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=String(b.agent||'')+'|'+String(b.platform||'');const f=path.join(DATA,'channel-notes.json');const all=await readFile(f,'utf8').then(JSON.parse).catch(()=>({}));const v=String(b.note||'').trim().slice(0,120);if(v)all[k]=v;else delete all[k];await writeFile(f,JSON.stringify(all,null,1));platCache.clear();return send(res,200,{ok:true})}
   if(p==='/ui/channels/reconnect'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can reconnect channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const ag=String(b.agent||''),pf=String(b.platform||'');if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf))return send(res,400,{error:'Unknown channel'});
    if(ag==='default'){restartGateway('reconnect '+pf+' (main agent)').catch(()=>{});return send(res,200,{ok:true,restarting:true,waiting:liveCount()})}
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};const put=on=>fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:on,env:{},profile:ag})}).then(r=>r.json()).catch(()=>({}));
    await put(false);if(pf==='whatsapp')await stopBridges(ag).catch(()=>{});await new Promise(r=>setTimeout(r,2500));const j=await put(true);platCache.clear();attention.t=0;
    console.log('reconnected',pf,'on',ag,j.hot_served?'(live)':'');return send(res,200,{ok:true,restarting:false})}
   if(p==='/ui/channels/pause'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can pause channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const ag=String(b.agent||''),pf=String(b.platform||'');if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook'].includes(pf))return send(res,400,{error:'Unknown channel'});
    try{return send(res,200,await setChannelOn(ag,pf,b.on===true))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/move'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can move channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{const pf=String(b.platform||''),from=String(b.from||''),to=String(b.to||'');const r=await channels.move(pf,from,to);
     const ps=await pausedLoad();if(ps[from+'|'+pf]||ps[to+'|'+pf]){delete ps[from+'|'+pf];delete ps[to+'|'+pf];await pausedSave(ps)}return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
   // QR codes (WhatsApp linking…): drawn here with the qrcode library that ships with the engine
   if(p==='/ui/qr'&&req.method==='GET'){const d=String(url.searchParams.get('d')||'');if(!d||d.length>2000)return send(res,400,'bad');
    try{const mod=await import(path.join(HERMES_HOME,'hermes-agent','node_modules','qrcode','lib','index.js'));const QR=mod.default||mod;const svg=await QR.toString(d,{type:'svg',margin:1,errorCorrectionLevel:'M',color:{dark:'#0b0c10',light:'#ffffff'}});
     res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(svg)}catch(e){return send(res,500,{error:'QR could not be drawn: '+e.message})}}
   if(p==='/ui/explain'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,300000))}catch{}const items=(Array.isArray(b.items)?b.items:[]).slice(0,300).map(x=>({id:String(x?.id||'').slice(0,120),name:String(x?.name||'').slice(0,160),desc:String(x?.desc||'').slice(0,600)}));return send(res,200,await explain.get(String(b.kind||''),items,{write:users.isAdmin(u)}))}
   if(p==='/ui/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const ag=String(url.searchParams.get('agent')||''),every=await listAllProfiles();
    const all=await usage.breakdown(ag&&ag!=='all'?every.filter(x=>x===ag||x.startsWith(ag+'--')):every,days,users.ownerOf);
    const people=Object.fromEntries(users.people().map(x=>[x.id,{name:x.name,avatar:x.avatar?'/ui/people/avatar/'+x.id:null,limit:x.limit||null}]));
    if(!users.isAdmin(u))return send(res,200,{days,byPerson:{[u.id]:all.byPerson[u.id]||null},people:{[u.id]:people[u.id]},today:await usage.today(await listAllProfiles(),u.id,users.ownerOf)});
    return send(res,200,{...all,people})}
   if(p==='/ui/starters'){const agent=url.searchParams.get('agent')||'default';if(users.gate(u,'/ui/screens/'+agent,'GET',new URLSearchParams(),agent))return send(res,403,{error:'That agent is not shared with you.'});
    let recent=[];try{const r=await fetch(`${DASH.origin}/api/sessions?limit=60${agent==='default'?'':'&profile='+encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':DASH_TOKEN}});recent=users.filter(u,'/hapi/sessions',await r.json()).sessions||[]}catch{}
    return send(res,200,await starters.get(u.id,users.isAdmin(u)?'admin':'member',agent,recent))}
   const no=users.gate(u,p,req.method,url.searchParams,'default');if(no)return send(res,no.status,{error:no.error});
   if(p.startsWith('/ui/accounts'))return accountsApi(req,res,p,send,readBody);
   if(p==='/ui/logo')return logo(req,res);
   return identities(req,res,p);
  }
  if(p.startsWith('/hapi/')||p.startsWith('/gapi/')){
   const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'},{'x-hui-auth':'required'});
   // Cross-site requests can't add custom headers, so this blocks CSRF on writes.
   if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers['x-hui']!=='1')return send(res,403,{error:'Missing request header.'});
   return hermesCall(req,res,u,url);
  }
  if(p.startsWith('/assets/'))return serveFile(res,p.slice(1));
  if(p.startsWith('/app/'))return serveFile(res,p.slice(1));
  if(p==='/sw.js'||p==='/manifest.webmanifest')return serveFile(res,'app'+p);
  if((p.startsWith('/mockup')||p.startsWith('/backlog')||p==='/data/development.json')&&validCookie(req)&&!users.isAdmin(await me(req)))return send(res,302,'',{location:'/'});
  if(p==='/mockup'||p==='/mockup/')return validCookie(req)?serveFile(res,'mockup/index.html'):send(res,302,'',{location:'/'});
  if(p.startsWith('/mockup/'))return validCookie(req)?serveFile(res,p.slice(1)):send(res,401,'Sign in first.');
  if(p==='/backlog'||p==='/backlog/')return validCookie(req)?serveFile(res,'backlog/index.html'):send(res,302,'',{location:'/'});
  if(p==='/backlog/board.js')return validCookie(req)?serveFile(res,'backlog/board.js'):send(res,401,'Sign in first.');
  if(p==='/data/development.json')return validCookie(req)?serveFile(res,'data/development.json'):send(res,401,{error:'Sign in first.'});
  if(req.method==='GET'||req.method==='HEAD'){
   // Cloudflare makes browsers keep .js/.css for hours, so every start gets fresh file addresses.
   const html=(await readFile(path.join(root,'app','index.html'),'utf8')).replace(/(\.(?:js|css))"/g,`$1?v=${BUILD}"`).replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta name="build" content="${BUILD}">`);
   res.writeHead(200,{'content-type':types['.html'],'cache-control':'no-store',...security});return res.end(req.method==='HEAD'?undefined:html)}
  send(res,404,'Not found');
 }catch(e){console.error(e);if(!res.headersSent)send(res,500,{error:'Server error'})}
});
// The screen's live connection is a WebSocket: same login, and only from this site (no cross-site hijacking).
server.on('upgrade',(req,sock,headBuf)=>{
 const p=new URL(req.url,'http://x').pathname;
 if(p==='/ui/local-browser/ws'){localBrowser.upgrade(req,sock,headBuf).catch(()=>sock.destroy());return}
 if(p!=='/screen/websockify'||!validCookie(req)||!sameOrigin(req)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
 const agent=new URL(req.url,'http://x').searchParams.get('agent');
 me(req).then(u=>{if(!u||users.gate(u,'/ui/screens/'+(agent||'default'),'GET',new URLSearchParams(),agent||'default')){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  // screen=ads: the shared AdsPower screen, whichever agent is driving it (admins only)
  const ads=new URL(req.url,'http://x').searchParams.get('screen')==='ads';if(ads&&!users.isAdmin(u)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  return screens.upgrade(req,sock,headBuf,ads?null:agent,users.isAdmin(u))}).catch(()=>sock.destroy());
});
server.listen(PORT,HOST,()=>console.log(`aqeelOS on http://${HOST}:${PORT} → dashboard ${DASH.origin}, gateway ${GATE.origin}`));
// Skills and Schedules show at once from the first visit: their slow engine answers are asked for once, one agent at a time
setTimeout(async()=>{schedules.info().catch(()=>{});try{for(const a of await listAgents())await skillsCached(a).catch(()=>{})}catch{}},3000).unref();

process.on('unhandledRejection',e=>console.error('unhandled:',e?.stack||e));process.on('uncaughtException',e=>console.error('uncaught:',e?.stack||e));
