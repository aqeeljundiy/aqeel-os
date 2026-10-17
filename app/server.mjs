// aqeelOS — production server. Serves the UI, signs people in, and forwards
// /hapi/* to the Hermes dashboard API and /gapi/* to the Hermes gateway API.
// Hermes credentials stay on this server; the browser only ever holds a session cookie.
// No dependencies. Run: node app/server.mjs (configuration via environment, see README).
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat,writeFile,mkdir,unlink,rename,realpath,readlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createAccounts,setupAgentFn,export_setups} from './accounts.mjs';
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
import {readdir} from 'node:fs/promises';
import {scryptSync,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const env=process.env;
// every log line starts with the time (UTC), so problems can be matched with the engine's own logs
if(process.argv[2]!=='hash')for(const k of ['log','warn','error']){const f=console[k].bind(console);console[k]=(...a)=>f(new Date().toISOString().slice(0,19).replace('T',' '),...a)}
const PORT=Number(env.UI_PORT)||4400;
const HOST=env.UI_HOST||'127.0.0.1';
const DASH=new URL(env.HERMES_DASH||'http://127.0.0.1:9119');
const GATE=new URL(env.HERMES_API||'http://127.0.0.1:8642');
const HOOKS=new URL(env.HERMES_WEBHOOKS||'http://127.0.0.1:8644');
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
const security={'x-content-type-options':'nosniff','referrer-policy':'same-origin','permissions-policy':'camera=(), geolocation=()','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'self' chrome-extension://jdfbikbihabglfkcckkmmfbmfdpifbgf; base-uri 'none'; form-action 'self'"};

/* ---------- sessions ---------- */
const sign=v=>createHmac('sha256',SECRET).update(v).digest('base64url');
// Cookie: <person id>.<expiry>.<random>.<signature>. Older 3-part cookies (from before People) are the owner's.
function makeCookie(uid='owner'){const exp=Date.now()+SESSION_DAYS*864e5;const v=uid+'.'+exp+'.'+randomBytes(9).toString('base64url');return v+'.'+sign(v)}
function cookieId(req){const m=/(?:^|;\s*)hui=([^;]+)/.exec(req.headers.cookie||'');if(!m)return null;const parts=m[1].split('.');
 let id,exp,v,sig;if(parts.length===3){[exp,,sig]=parts;id='owner';v=parts[0]+'.'+parts[1]}else if(parts.length===4){[id,exp,,sig]=parts;v=parts.slice(0,3).join('.')}else return null;
 const a=Buffer.from(sign(v)),b=Buffer.from(sig);return a.length===b.length&&timingSafeEqual(a,b)&&Number(exp)>Date.now()?id:null}
const validCookie=req=>!!cookieId(req);
const cookieAttrs=max=>`Path=/; HttpOnly; SameSite=Strict; Max-Age=${max}${SECURE_COOKIE?'; Secure':''}`;
function checkPassword(pw){const [kind,salt,hash]=PW_HASH.split(':');if(kind!=='scrypt'||!salt||!hash)return false;const got=scryptSync(String(pw),Buffer.from(salt,'hex'),64);const want=Buffer.from(hash,'hex');return got.length===want.length&&timingSafeEqual(got,want)}

// 5 wrong passwords per address per 10 minutes, then a cool-down.
const attempts=new Map();
function clientIp(req){return (req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'?'}
function limited(ip){const now=Date.now(),a=(attempts.get(ip)||[]).filter(t=>now-t<600e3);attempts.set(ip,a);return a.length>=5}

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
function liveStart(key,user){const rec={user,chunks:[],subs:new Set(),done:false,t:Date.now()};LIVE.set(key,rec);return rec}
function liveEnd(key,rec){rec.done=true;saveThinking(key,rec);for(const r of rec.subs)r.end();rec.subs.clear();setTimeout(()=>{if(LIVE.get(key)===rec)LIVE.delete(key)},120000)}
function proxy(req,res,target,prefix,authHeaders,{transform,body,live}={}){
 const url=new URL(req.url,'http://x');
 // /hapi/status → dashboard /api/status · /gapi/api/sessions → gateway /api/sessions
 const upstreamPath=(prefix==='/hapi'?'/api':'')+url.pathname.slice(prefix.length)+url.search;
 const headers={...req.headers};
 for(const h of ['cookie','host','authorization','x-hermes-session-token','origin','referer','x-forwarded-for','x-forwarded-proto','x-forwarded-host','x-hui'])delete headers[h];
 Object.assign(headers,authHeaders,{host:target.host});
 if(body!==undefined){delete headers['transfer-encoding'];headers['content-length']=String(body.length)}
 const up=httpRequest({hostname:target.hostname,port:target.port,path:upstreamPath,method:req.method,headers},r=>{
  const out={...r.headers};delete out['set-cookie'];delete out['content-security-policy'];
  if(String(r.headers['content-type']||'').includes('text/event-stream')){out['cache-control']='no-cache';out['x-accel-buffering']='no';res.socket?.setNoDelay(true)}
  if(transform&&String(r.headers['content-type']||'').includes('json')){const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',async()=>{let txt=Buffer.concat(chunks).toString('utf8');
    try{if((r.statusCode||500)<300)txt=JSON.stringify(await transform(JSON.parse(txt)))}catch{}delete out['content-length'];delete out['content-encoding'];res.writeHead(r.statusCode||502,{...out,...security});res.end(txt)});return}
  if(live&&(r.statusCode||500)<300&&String(r.headers['content-type']||'').includes('text/event-stream')){
   const rec=liveStart(live.key,live.user);res.writeHead(r.statusCode,{...out,...security});
   r.on('data',c=>{rec.chunks.push(c);if(!rec.runId){const m=/"run_id"\s*:\s*"([^"]+)"/.exec(c.toString('utf8'));if(m)rec.runId=m[1]}if(!res.writableEnded&&!res.destroyed)res.write(c);for(const sub of rec.subs)sub.write(c)});
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
  res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.woff2'||ext==='.svg'||ext==='.png'?'public, max-age=86400':'no-cache',...security});res.end(body)}
 catch{send(res,404,'Not found')}
}

/* ---------- agent identities (name, title, picture) ----------
   Hermes has no avatars and its default profile can't be renamed, so the UI keeps identities itself,
   outside the app folder so deploys never touch them. The name is also written to Hermes'
   profile.yaml (display_name) so Hermes' own tools show it too. */
const DATA=path.resolve(env.UI_DATA_DIR||path.join(root,'..','hermes-ui-data'));initStatus(DATA);
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
const mailer=createMail(DATA);
const usage=createUsage(DASH.origin,DASH_TOKEN);
const explain=createExplain(DATA);
const schedules=createSchedules({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents(),python:enginePython,root,live:()=>LIVE_APP||process.env.SCHED_DESCRIBE==='1'});
setTimeout(()=>schedules.tick(),40000).unref();setInterval(()=>schedules.tick(),10*60000).unref();
const relay=createRelay({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,SECRET,listAgents:()=>listAgents(),links:{list:a=>links.list(a)},platformsOf:a=>platformsCached(a),nameOf:a=>NAMES[a]||a});
const NAMES={};   // agents' display names (refreshed with the agent context), for messages people read
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
const CHAT_HINT="You're replying in aqeelOS, a chat app that shows Markdown. Format for easy reading, like a well-written Claude or ChatGPT reply: short answers stay short and conversational; longer ones start with the outcome, then use ## headings for sections, bullet or numbered lists, tables for comparisons, and code blocks for code or commands. Bold the key numbers, names, dates and decisions (for example: UPS **Rp522,328** → **Continue**) so the reply can be skimmed. Never send more than two plain paragraphs in a row: start a section with a bold lead-in (**Short answer** …, **What changed** …, **Next step** …) and put lists of points in bullets. Write every link as [a short name](url) (for example [Dagadu weekly report](https://docs.google.com/…)), never a bare URL; aqeelOS shows them as small labelled buttons. While working, keep progress notes to one short line each and lead the final answer with the result. File/media delivery: images referenced as MEDIA:/absolute/path tags (.png/.jpg/.jpeg/.gif/.webp/.bmp, up to 5MB) are shown inline in the chat. Non-image files are not shown inline, so state the plain file path instead of a MEDIA: tag.";
async function ensureChatHint(a){const cfgFile=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml');const y=await readFile(cfgFile,'utf8').catch(()=>'');
 if(y.includes('never a bare URL'))return;   // already the current wording
 const r=await setKey(a,'agent.platform_hints.api_server',{replace:CHAT_HINT});if(!r.ok)throw new Error(r.err)}
async function writeAgentContext(){const all=await listAgents();const names={};for(const a of all)names[a]=NAMES[a]=await displayName(a);
 const ads=[];for(const a of all)if(await screens.shared(a).catch(()=>false))ads.push(a);
 for(const a of all){await ensureChatHint(a).catch(e=>console.warn('chat hint',a,e.message));try{const me=names[a],adsNames=ads.map(x=>names[x]+"'s screen").join(' / ')||'the AdsPower screen';
  const own=ads.includes(a)?`You browse through AdsPower, so your browser shows on the shared AdsPower screen, listed as "${me}'s screen".`:`Your own screen is "${me}'s screen". Your browser tool opens pages there; it starts by itself when you browse.`;
  const others=all.filter(x=>x!==a&&!ads.includes(x)).map(x=>'"'+names[x]+"'s screen\"").join(', ');
  const ch=await relay.channelsFor(a).catch(()=>[]);
  const body=['<!-- aqeelos:context (written by aqeelOS and kept up to date; edit outside this block) -->','# Working in aqeelOS','','## Screens','',
   'The person can watch screens live in aqeelOS: the monitor button at the top right, then the screen picker.',
   '- '+own,
   '- AdsPower browsers, opened by any agent, show on the shared AdsPower screen, listed as '+adsNames+'.',
   others?'- Other agents have their own screens: '+others+'.':null,
   'When you start working in a browser or in AdsPower, say which screen to watch, for example: "I am working on '+(ads.includes(a)?me+"'s screen":me+"'s screen")+'." If the person needs to sign in or solve a check themselves, tell them to open that screen and press Take over.',
   '','## Apps and accounts: free ways first','',
   'For an outside app (Slack, Gmail, Google Drive, Notion, GitHub, Google Cloud…), try the free ways first, in this order:',
   '1. That app’s own MCP tool, if you have it (connect it with connect_mcp_tool when it needs a sign-in).',
   '2. A built-in skill that covers it (for example the Google Workspace skill for Gmail, Drive, Calendar, Sheets and Docs).',
   '3. The browser on your screen, where the person can watch and sign in themselves. Good for one-off jobs in a web console (setting something up, inviting someone, changing a setting).',
   'Only when those cannot do it, or the setup needs an app or admin access the person does not have, suggest Composio. Say plainly: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only after the person agrees.',
   'Choosing where it runs: a one-off job can be done in the browser now. Anything that must keep running (schedules, automatic replies, regular reports) needs a tool or skill on this server, so set that up instead of relying on the browser.',
   'Which browser: before your first browser step in a chat, call choose_browser (from aqeelos-notify) with the task and your suggestion: "yours" (the person\'s own Chrome, where they are already signed in) for one-off jobs in web consoles, "server" (your screen on the AI box) for anything scheduled, long-running or done while they are away. Follow their answer for the rest of that chat.',
   '','## Connecting an MCP tool that needs a sign-in','',
   'Never use manage_connections (authorize/install/enable) or “hermes mcp login” for MCP tools, and never a 127.0.0.1 / localhost callback: the person is not at this server, so that page never opens for them. Add the tool (with its client ID/secret if the service needs its own app), then call the connect_mcp_tool tool (from aqeelos-notify) and send the person its steps exactly as written. Never make up steps, addresses or commands for connecting: the people using this are often not technical, so keep it to what the tool says. When the tool recommends Composio, offer that first. aqeelOS sets the return address itself: https://ai.elkiya.com/mcp-oauth/api/mcp/oauth/callback/<tool name> (this is what goes in the service’s Redirect URLs).',
   '','## Keep schedules tidy','',
   'Whenever you create or change a schedule, give it a clear title the person understands without opening it (no codes like "x3"), then call organize_schedule (from aqeelos-notify) with its id, the folder it belongs to (the client or project, for example Dagadu, Personal Finance, Elkiya, AdmissionSight; reuse an existing folder when one fits) and one plain sentence on what it does and why. When asked to tidy up, move, rename or explain schedules, do the same for each one.',
   '','## Passwords, API keys and other secrets','',
   'Never ask the person to type a password, code or API key into the chat, and never ask them to type it on the screen viewer. Call ask_secret (from aqeelos-notify): mode "type" types it into the field you clicked on your screen, mode "save" stores it as a named key. The person can also send you one with the lock button; you then get its name. To enter a saved one, click the field and call type_secret with its name. You never see the values.',
   '','## Channels you can message the person on','',
   'Urgent or important news for the person who owns you (not the people you chat with) goes through a channel marked "to you" with send_to_person. Never send such an alert back to the person you are chatting with, and never tell them you are passing messages on unless they ask you to.',
   ch.length?'Use the send_to_person tool with one of these IDs when the person asks to be notified on a channel ("notify me on shop-whatsapp"):':'None yet. The person can connect WhatsApp, Telegram and others on the Channels page.',
   ...ch.map(c=>'- '+c.id+' = '+c.name),'<!-- /aqeelos:context -->'].filter(x=>x!==null).join('\n');
  const dir=path.join(homedir(),'workspaces',a),file=path.join(dir,'AGENTS.md');await mkdir(dir,{recursive:true});
  const cur=await readFile(file,'utf8').catch(()=>'');const re=/<!-- aqeelos:context[\s\S]*?<!-- \/aqeelos:context -->/;
  const next=re.test(cur)?cur.replace(re,()=>body):(cur?cur.replace(/\s*$/,'\n\n'):'')+body+'\n';if(next!==cur)await writeFile(file,next)}catch(e){console.warn('agent context',a,e.message)}}}
if(PORT===4400){setTimeout(()=>writeAgentContext().catch(()=>{}),25000);setInterval(()=>writeAgentContext().catch(()=>{}),180000).unref()}
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
  if(a!=='default'&&!copy&&setupAgentFn){const s=st[a];if(only||!s||s.ok||Date.now()-(s.t||0)>15*60e3)await setupAgentFn(a).catch(e=>console.warn('setup',a,e.message))}
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
function restartGateway(why,{wait=true}={}){if(gwRestarting)return gwRestarting;if(PORT!==4400){console.log('gateway restart skipped (test copy):',why);return Promise.resolve()}
 gwRestarting=(async()=>{if(wait)for(let i=0;i<120&&liveCount()>0;i++)await new Promise(r=>setTimeout(r,5000));
  console.log('gateway restart:',why);gwStopped=false;lastOwnRestart=Date.now();noteSys('restart',why);
  await shx('hermes -p default gateway stop >/dev/null 2>&1; for i in $(seq 1 30); do p=$(grep -o "[0-9]*" ~/.hermes/gateway.pid 2>/dev/null | head -1); [ -n "$p" ] && kill -0 "$p" 2>/dev/null || break; sleep 1; done; tmux kill-session -t gateway 2>/dev/null; sleep 1; ~/services.sh >/dev/null 2>&1');
  platCache.clear()})().finally(()=>{gwRestarting=null});return gwRestarting}
async function gatewayWatch(){if(gwStopped||gwRestarting)return;
 const pid=await gatewayPid();const inTmux=(await shx('tmux has-session -t gateway')).ok;
 if(pid&&lastGwPid&&pid!==lastGwPid&&Date.now()-lastOwnRestart>180000)noteSys('restart-self','');if(pid)lastGwPid=pid;
 // nothing running at all, twice in a row (so an engine restart in progress is not cut off): start it
 if(!pid&&!inTmux){if(++gwMissing<2)return;gwMissing=0;console.warn('gateway watch: no gateway was running');return restartGateway('no gateway was running',{wait:false})}
 gwMissing=0;if(inTmux||!pid)return;
 const up=Number((await shx('ps -o etimes= -p '+pid)).out.trim())||0;const since=Date.now()-up*1000;
 const log=(await shx('tail -400 ~/.hermes/logs/agent.log')).out.split('\n').filter(l=>/ClaudeCodeLoggedOut|no usable login/.test(l));
 const bad=log.some(l=>{const t=Date.parse(l.slice(0,19).replace(' ','T')+'Z');return t&&t>since+5000&&Date.now()-t<10*60e3});
 if(bad){console.warn('gateway watch: the gateway the engine started cannot reach Claude; restarting it properly');return restartGateway('gateway outside its session cannot reach Claude')}}
if(PORT===4400){setInterval(()=>gatewayWatch().catch(()=>{}),60000).unref()}
/* After an engine update (from the app or by itself), the renames are applied again and, once nothing is in
   progress, the engine restarts once so people see aqeelOS again in channel messages, prompts and errors. */
const engineHead={v:null,t:0};
async function engineWatch(){const r=await shx('git -C ~/.hermes/hermes-agent rev-parse HEAD 2>/dev/null');const h=String(r.out||'').trim();if(!/^[0-9a-f]{40}$/.test(h))return;
 if(engineHead.v===null){engineHead.v=h;return}if(h===engineHead.v)return;engineHead.v=h;console.log('engine updated to',h.slice(0,8),'- applying aqeelOS patches again');
 const {execFile}=await import('node:child_process');const out=await new Promise(res=>execFile(process.execPath,[path.join(root,'scripts','apply-skill-patches.mjs')],{timeout:600000,maxBuffer:8e6},(e,o)=>res(String(o||''))));
 const n=Number((/(\d+) change\(s\)/.exec(out)||[])[1]||0);console.log('engine patches after update:',n,'change(s)');if(n)restartGateway('engine updated: aqeelOS wording applied again').catch(()=>{})}
if(PORT===4400){setInterval(()=>engineWatch().catch(()=>{}),5*60000).unref();setTimeout(()=>engineWatch().catch(()=>{}),20000).unref()}
/* Memory guard. The AI box has a fixed memory limit; when it runs full, the engine or the dashboard is killed.
   Every 2 minutes: above 80% the bell says so (once an hour); above 90%, with no reply, schedule, setup or relay in
   progress, the AdsPower browsers are closed (AdsPower itself stays open and a browser reopens when an agent needs it).
   The Host page shows the numbers in plain words. */
async function memNow(){const n=async f=>Number((await readFile(f,'utf8').catch(()=>'')).trim())||0;
 const cur=await n('/sys/fs/cgroup/memory.current'),max=await n('/sys/fs/cgroup/memory.max');if(cur&&max)return {used:cur,max};
 const m=await readFile('/proc/meminfo','utf8').catch(()=>'');const kb=k=>Number((new RegExp('^'+k+':\\s+(\\d+)','m').exec(m)||[])[1]||0)*1024;return {used:kb('MemTotal')-kb('MemAvailable'),max:kb('MemTotal')}}
let memWarned=0;
async function memGuard(){const {used,max}=await memNow();if(!max)return;const pct=used/max;
 if(pct>0.8&&Date.now()-memWarned>3600e3){memWarned=Date.now();noteSys('memory',Math.round(pct*100)+'% of memory in use ('+(used/1e9).toFixed(1)+' of '+(max/1e9).toFixed(1)+' GB)')}
 if(pct<=0.9)return;if(liveCount()>0||opsBusy()>0||relay.sending()>0||export_setups.running()>0||gwRestarting)return;
 const key=((await readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'')).match(/^ADSPOWER_API_KEY=["']?([^"'\n]+)/m)||[])[1]||'';const h=key?{authorization:'Bearer '+key}:{};
 const act=await fetch('http://127.0.0.1:50325/api/v1/browser/local-active',{headers:h,signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);const list=act?.data?.list||[];let n=0;
 for(const b of list){const id=b.user_id||b.profile_id;if(!id)continue;const r=await fetch('http://127.0.0.1:50325/api/v1/browser/stop?user_id='+encodeURIComponent(id),{headers:h,signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);if(r?.code===0)n++}
 if(n){console.warn('memory guard: memory at',Math.round(pct*100)+'%, closed',n,'AdsPower browser(s)');noteSys('memory-freed','Memory was almost full, so '+n+' AdsPower browser'+(n>1?'s were':' was')+' closed. They reopen when an agent needs them.')}}
if(PORT===4400)setInterval(()=>memGuard().catch(e=>console.warn('memory guard',e.message)),120000).unref();
// the dashboard (settings, channels, sign-ins, dictation) can be killed when the box runs out of memory: if it does
// not answer twice in a row, it is started again (in its managed session, like the engine)
let dashMissing=0;
if(PORT===4400)setInterval(async()=>{const ok=await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(8000)}).then(r=>r.status<500,()=>false);
 if(ok){dashMissing=0;return}if(++dashMissing<2)return;dashMissing=0;console.warn('dashboard watch: the dashboard stopped answering; starting it again');
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
const localBrowser=createLocalBrowser({DATA,GATE:GATE.origin,API_KEY,EXT_DIR:path.join(root,'extension')});
const links=createLinks({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,python:()=>sharing.python(),setupAgent:n=>setupAgentFn?.(n)});
function listAgents(){return agentNames()}   // real agents only (a folder with a config), not extra-number copies
async function listAllProfiles(){return [...await listAgents(),...(await links.list()).map(l=>l.name)]}
async function agentModel(a){const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}}
const users=createUsers(DATA,mailer);
const starters=createStarters(DATA);
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
const MCP_OAUTH_BASE=(env.PUBLIC_URL||'https://ai.elkiya.com').replace(/\/$/,'')+'/mcp-oauth';
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
 const p=fetch(DASH.origin+'/api/messaging/platforms?profile='+encodeURIComponent(k),{headers:{'x-hermes-session-token':DASH_TOKEN}}).then(async r=>{const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.detail||'HTTP '+r.status),{status:r.status});await trueWhatsApp(k,v);await channelAccounts(k,v).catch(()=>{});platCache.set(k,{t:Date.now(),v});return v}).catch(e=>{if(old?.v)platCache.set(k,{t:Date.now()-10000,v:old.v});else platCache.delete(k);throw e});
 if(!old?.v)platCache.set(k,{p});return p}
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
 if(c.paused)return {agent,platform,state:'paused',connected:false,paused:true,account:c.account||null,text:'Paused: still linked'+(c.account?' ('+[c.account.phone||c.account.username,c.account.name].filter(Boolean).join(' · ')+')':'')+', but no agent answers it. Pick an agent under Answered by to turn it back on.'};
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
const waTries=new Map();
async function reconnectOne(ag,pf){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
 const put=on=>fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:on,env:{},profile:ag})}).then(r=>r.json()).catch(()=>({}));
 await put(false);if(pf==='whatsapp')await stopBridges(ag).catch(()=>{});await new Promise(r=>setTimeout(r,2500));const j=await put(true);platCache.delete(ag);attention.t=0;return j}
async function waGuard(){if(gwRestarting)return;
 for(const a of await listAllProfiles()){if(a==='default')continue;
  const st=await checkChannel(a,'whatsapp').catch(()=>null);if(!st||st.state==='missing'||st.paused||st.connected||st.needs_link)continue;
  if(/retrying|connecting|starting/.test(st.state||''))continue;   // already on its way back
  const now=Date.now(),l=(waTries.get(a)||[]).filter(t=>now-t<6*3600e3);if(l.length>=3||l.some(t=>now-t<30*60e3))continue;
  l.push(now);waTries.set(a,l);console.warn('whatsapp guard:',a,'dropped ('+(st.state||'?')+'), reconnecting with its saved login');
  await reconnectOne(a,'whatsapp').catch(e=>console.warn('whatsapp guard:',a,e.message));
  await new Promise(r=>setTimeout(r,20000));const after=await checkChannel(a,'whatsapp').catch(()=>null);console.log('whatsapp guard:',a,after?.connected?'back online':'still not connected ('+(after?.state||'?')+')')}}
async function waBackup(){const {execFile}=await import('node:child_process');const day=new Date().toISOString().slice(0,10);
 for(const a of await listAllProfiles()){const dir=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session');
  if(!await stat(path.join(dir,'creds.json')).catch(()=>null))continue;const to=path.join(DATA,'wa-backup',a);await mkdir(to,{recursive:true});const f=path.join(to,day+'.tgz');if(await stat(f).catch(()=>null))continue;
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
async function saveSecret(base,name,value){const home=base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base);
 await editEnv(path.join(home,'.env'),cur=>{const lines=cur.split('\n').filter(l=>!l.startsWith(name+'='));while(lines.length&&lines[lines.length-1]==='')lines.pop();return [...lines,name+'='+value.replace(/[\r\n]/g,''),''].join('\n')});
 const dir=secretDir(base);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,name),value,{mode:0o600})}
const secretHow=(base,name)=>'To enter it on your screen, click the field and call type_secret with name '+name+'. In a command use "$(cat ~/workspaces/'+base+'/.secrets/'+name+')". Never print, echo or show the value.';
async function useSecret(rec,value){
 if(rec.mode==='type'){await screens.typeInto(rec.base,value,{enter:rec.enter});return 'Typed it into the focused field on your screen'+(rec.enter?' and pressed Enter':'')+'. You never saw the value; take a screenshot to check the result.'}
 await saveSecret(rec.base,rec.name,value);
 return 'Saved as '+rec.name+' in your settings (the engine and its tools read it from there). '+secretHow(rec.base,rec.name)}
/* "Which browser?" An agent about to work in a browser asks (choose_browser) once per chat: the person's own
   Chrome (one-off jobs where they are already signed in) or the agent's screen on the AI box (anything that must
   keep running). The person answers on a card in the chat; their answer links that chat to their browser or not. */
const browserAsks=new Map();
function askBrowser(agent,a){return new Promise(resolve=>{const id=randomBytes(9).toString('base64url');
 const rec={id,kind:'browser',agent,base:agent.split('--')[0],task:String(a.task||'a browser job').slice(0,160),suggest:a.suggest==='yours'?'yours':'server',why:String(a.why||'').slice(0,220),t:Date.now(),resolve};browserAsks.set(id,rec);
 setTimeout(()=>{if(browserAsks.get(id)===rec){browserAsks.delete(id);resolve({text:'The person did not choose in time. Use your own screen on the AI box and tell them you did.'})}},270000)})}
async function hermesCall(req,res,u,url){
 const p=url.pathname,q=url.searchParams,agent=agentOf(p,q);
 const no=users.gate(u,p,req.method,q,agent);if(no)return send(res,no.status,{error:no.error});
 if(p.startsWith('/gapi/p/')&&agent&&agent!=='default'&&!keyOk.has(agent)){const envF=path.join(HERMES_HOME,'profiles',agent,'.env');const e=await readFile(envF,'utf8').catch(()=>null);
  if(e!==null){if(!/^API_SERVER_KEY=/m.test(e)&&API_KEY){await writeFile(envF,(e&&!e.endsWith('\n')?e+'\n':e)+'API_SERVER_KEY='+API_KEY+'\n',{mode:0o600});console.log('added the missing gateway key for',agent);await new Promise(r=>setTimeout(r,1500))}keyOk.add(agent)}}
 if(p==='/hapi/messaging/platforms'&&req.method==='GET'){try{return send(res,200,await platformsCached(q.get('profile')||'default'))}catch(e){return send(res,e.status||502,{error:e.message})}}
 if(p.startsWith('/hapi/messaging/')&&req.method!=='GET')platCache.clear();
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
 if(p==='/hapi/hermes/update'&&req.method==='POST'&&users.isAdmin(u)){const r=await shx('git -C ~/.hermes/hermes-agent checkout -- . 2>&1');console.log('engine update: renamed files reset first',r.ok?'':'('+String(r.out||'').slice(0,120)+')');engineHead.t=0}
 if(p.startsWith('/hapi/')&&req.method!=='GET'&&q.get('profile')&&/json/.test(String(req.headers['content-type']||''))&&!p.startsWith('/hapi/files')){let b=null;try{const raw=(await readRaw(req,30e6)).toString('utf8');b=raw?JSON.parse(raw):{}}catch{}
  if(b&&typeof b==='object'&&!Array.isArray(b)&&!b.profile)b.profile=q.get('profile');if(b!==null)body=Buffer.from(JSON.stringify(b))}
 // a member's file calls must stay in their own folder
 if(!users.isAdmin(u)&&p.startsWith('/hapi/files')){
  if(req.method==='GET'){if(!users.filePathOk(u,q.get('path')||users.home(u)))return send(res,403,{error:'That folder is not yours.'})}
  else{const raw=await readRaw(req,p.endsWith('upload-stream')?200e6:65536);body=raw;
   let fp=null;if(p.endsWith('upload-stream'))fp=(/name="path"\r\n\r\n([^\r\n]*)/.exec(raw.toString('latin1'))||[])[1];else{try{fp=JSON.parse(raw.toString('utf8')).path}catch{}}
   if(!users.filePathOk(u,fp))return send(res,403,{error:'That folder is not yours.'})}}
 // a member's message: within their daily limit, and only on models they may use
 const chatM=/^\/gapi(?:\/p\/[^/]+)?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p);
 if(chatM&&!users.isAdmin(u)&&req.method==='POST'){
  const lim=users.limitOf(u);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),u.id,users.ownerOf);if(t.tokens>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
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
  setTimeout(async()=>{if(await isAgent(gone))return;const {rm}=await import('node:fs/promises');
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
 if(!users.isAdmin(u)&&req.method==='POST'&&(p==='/hapi/mcp/servers'||p==='/hapi/profiles')){
  let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}
  // an MCP server started by command runs code on the box: same rule as the terminal
  if(p==='/hapi/mcp/servers'&&b.command&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
  // a member's new agent starts empty: copying the main agent would copy its keys and memory
  if(p==='/hapi/profiles'){b.clone_from_default=false;b.clone_all=false;made=String(b.name||'')}
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
  if(p==='/healthz')return send(res,200,{ok:true,build:BUILD,live:liveCount(),busy:liveCount()+export_setups.running()+opsBusy()+relay.sending()+(gwRestarting?1:0)});
  // the "notify me" tool agents call (from this box only; each agent's address is signed)
  const mn=/^\/mcp\/notify\/([\w-]+)\/([\w-]+)$/.exec(p);
  if(mn){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method==='GET')return send(res,405,'POST only');
   let msg={};try{msg=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'})}// connect_mcp_tool: the right way for an agent to start a sign-in (public return address, never localhost)
   const signed=mn[2]===relay.sig(mn[1]);
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
   const out=await relay.mcp(mn[1],mn[2],msg);
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'choose_browser',description:'Before a browser job in a chat, ask the person once where to do it: their own Chrome ("yours": a separate window on their computer, with the sign-ins they already have; best for one-off jobs such as Google Cloud or admin consoles) or your screen on the AI box ("server": keeps working when their computer is off; needed for anything scheduled or long-running). Give your suggestion. Wait for the answer, then follow it for the rest of the chat.',inputSchema:{type:'object',properties:{task:{type:'string',description:'What you will do in the browser, in a few words'},suggest:{type:'string',enum:['yours','server']},why:{type:'string',description:'One short reason for your suggestion'}},required:['task','suggest']}},{name:'type_secret',description:'Type a secret the person saved for you (a password, code or key) into the field that has focus on your screen, without seeing it. Click the field first. Saved secrets: '+((await readdir(secretDir(mn[1].split('--')[0])).catch(()=>[])).join(', ')||'none yet (ask with ask_secret)')+'.',inputSchema:{type:'object',properties:{name:{type:'string',description:'The saved name, e.g. GMAIL_PASSWORD'},press_enter:{type:'boolean'}},required:['name']}},{name:'ask_secret',description:'Ask the person for a password, API key or other secret through a protected field in their aqeelOS chat. You never see the value. mode "type": it is typed into the field that has focus on your screen (click the field first; set press_enter to submit). mode "save": it is stored as a named key (name in capitals, e.g. OPENAI_API_KEY) that the engine and your commands can use. Never ask for a secret in plain chat or on the screen viewer; always use this.',inputSchema:{type:'object',properties:{label:{type:'string',description:'What it is, e.g. "Gmail password for ops@company.com"'},mode:{type:'string',enum:['type','save']},name:{type:'string',description:'For save: the key name in capitals'},press_enter:{type:'boolean',description:'For type: press Enter after typing'}},required:['label','mode']}},{name:'organize_schedule',description:'File one of your schedules so the person understands it at a glance: put it in a folder (the project or client it is for, e.g. Dagadu, Personal Finance), give it a clear title and a one-sentence description of what it does and why. Use it right after you create or change a schedule, and when the person asks you to tidy, move or rename schedules.',inputSchema:{type:'object',properties:{job_id:{type:'string',description:'The schedule id (from cronjob list)'},folder:{type:'string',description:'Folder name, 1-2 words'},title:{type:'string',description:'Clear title, max 6 words (optional)'},description:{type:'string',description:'One plain sentence: what it does and why'}},required:['job_id']}},{name:'connect_mcp_tool',description:'Start the sign-in for one of your MCP tools (slack, composio, notion…) and get the link to give the person. Always use this to connect an MCP tool; never a command-line login or a localhost callback.',inputSchema:{type:'object',properties:{tool:{type:'string',description:'The MCP tool name as listed, e.g. "slack" or "composio"'}},required:['tool']}});
   if(out.body==null){res.writeHead(out.status);return res.end()}return send(res,out.status,out.body)}
  // Incoming webhooks (GitHub, Stripe…) reach Hermes' webhook listener here. No sign-in: each
  // subscription checks its own secret signature, and nothing but POST /webhooks/<name> passes.
  if(/^\/webhooks\/[\w.-]{1,64}$/.test(p)&&req.method==='POST')return proxy(req,res,HOOKS,'',{});
  {const wm=/^\/webhooks\/([a-z0-9][a-z0-9_-]{0,63})\/([\w.-]{1,64})$/.exec(p);if(wm&&req.method==='POST'){req.url='/p/'+wm[1]+'/webhooks/'+wm[2]+url.search;return proxy(req,res,HOOKS,'',{})}}
  // MCP sign-in (OAuth) returns here from Slack, Notion…; the engine checks the one-time state. No sign-in needed.
  // Google sign-ins (Google Workspace skill with a Web-application client) return here, and aqeelOS finishes them:
  // it finds the agent and account whose pending sign-in has this state and runs the skill's --auth-code step.
  if(p==='/google-oauth/callback'&&req.method==='GET'){const st=url.searchParams.get('state')||'';
   const page=(t,m)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><body style="font-family:system-ui;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${t}</h2><p>${m}</p></body>`)};
   if(url.searchParams.get('error'))return page('Not connected','You clicked Cancel (or Google said no). Ask your agent for a new link if you want to connect.');
   let hit=null;for(const a of await listAllProfiles()){const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    for(const fn of await readdir(home).catch(()=>[])){const m=/^google_oauth_pending(?:_(.+))?\.json$/.exec(fn);if(!m)continue;
     try{const j=JSON.parse(await readFile(path.join(home,fn),'utf8'));if(j.state&&j.state===st){hit={a,home,acct:m[1]||''};break}}catch{}}if(hit)break}
   if(!hit)return page('This link has expired','A newer link replaced it, or it was already used. Ask your agent for a new Google sign-in link and open it right away.');
   const py=await sharing.python();const script=path.join(hit.home,'skills','productivity','google-workspace','scripts','setup.py');const {execFile}=await import('node:child_process');
   const r=await new Promise(done=>execFile(py,[script,...(hit.acct?['--account',hit.acct]:[]),'--auth-code','https://ai.elkiya.com/google-oauth/callback'+url.search],{timeout:90000,env:{...process.env,HERMES_HOME:hit.home}},(e,o,er)=>done({ok:!e,out:String(o||'')+String(er||'')})));
   if(!r.ok||/ERROR/.test(r.out))return page('Google sign-in did not finish',esc((r.out.trim().split('\n').filter(Boolean).pop()||'Unknown error').slice(0,300))+' Ask your agent for a new link.');
   return page('Google account connected',(hit.acct?'<b>'+esc(hit.acct)+'</b> is ':'Your Google account is ')+'connected to '+esc(NAMES[hit.a]||hit.a)+'. You can close this tab and go back to aqeelOS.')}
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
   return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><body style="font-family:system-ui;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${title}</h2><p>${msg}</p></body>`)}
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
    restartGateway('restored '+m[1]).then(()=>agentHealth(m[1])).catch(()=>{});
    return send(res,200,{ok:true,agent:m[1]})}
   // plugins on/off for ONE agent (the engine's own plugin routes always change the main agent)
   if(p==='/ui/plugins/toggle'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),name=String(b.name||'');
    if(!/^[\w.@-]{1,80}$/.test(name))return send(res,400,{error:'Unknown plugin'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    const r=await hcmd(ag,['plugins',b.enabled?'enable':'disable',name],{timeout:150000});
    return r.ok?send(res,200,{ok:true,restart_required:/restart/i.test(r.out)}):send(res,400,{error:(r.err||'Could not change the plugin').slice(0,300)})}
   if(p==='/ui/box'&&req.method==='GET')return send(res,200,await boxMemory());
   // Google accounts an agent can use (the Google Workspace skill keeps one sign-in per account); never the tokens themselves
   if(p==='/ui/google-accounts'){const a=String(url.searchParams.get('agent')||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    if(req.method==='GET'){const out=[];for(const f of await readdir(home).catch(()=>[])){const m=/^google_token(?:_([\w.-]+))?\.json$/.exec(f);if(!m)continue;
      try{const j=JSON.parse(await readFile(path.join(home,f),'utf8'));out.push({name:m[1]||'',email:j.account||'',scopes:(j.scopes||[]).map(s=>String(s).split('/').pop()),renews:!!j.refresh_token,expiry:j.expiry||null})}catch{}}
     return send(res,200,{accounts:out})}
    if(req.method==='DELETE'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can remove a Google account.'});const n=String(url.searchParams.get('name')||'');if(n&&!/^[\w.-]{1,60}$/.test(n))return send(res,400,{error:'Unknown account'});
     await unlink(path.join(home,'google_token'+(n?'_'+n:'')+'.json')).catch(()=>{});console.log('removed google account',n||'(main)','from',a);return send(res,200,{ok:true})}}
   // Who can reach the AI box over SSH: one public key per device or AI tool, added and removed here (admins only).
   // Only public keys are ever handled; the key aqeelOS's own builder uses cannot be removed from here.
   if(p==='/ui/ssh-keys'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can manage access to the AI box.'});
    const f=path.join(homedir(),'.ssh','authorized_keys');const lines=(await readFile(f,'utf8').catch(()=>'')).split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#'));
    const {createHash}=await import('node:crypto');const fp=l=>{const b=l.trim().split(/\s+/)[1]||'';try{return 'SHA256:'+createHash('sha256').update(Buffer.from(b,'base64')).digest('base64').replace(/=+$/,'')}catch{return ''}};
    const list=()=>lines.map(l=>{const [type,,...c]=l.trim().split(/\s+/);return {type,name:c.join(' ')||'(no name)',fp:fp(l),protected:/^windows-pc$/.test(c.join(' '))}});
    if(req.method==='GET')return send(res,200,{keys:list(),host:'ai.elkiya.com',port:2222,user:'claude'});
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
     await mkdir(path.dirname(f),{recursive:true});const t=f+'.tmp';await writeFile(t,JSON.stringify(cur));await rename(t,f);return send(res,200,{ok:true})}}
   if(p==='/ui/agent-approvals'){const ag=req.method==='GET'?(url.searchParams.get('agent')||'default'):null;let b={};if(req.method==='PUT'){try{b=JSON.parse(await readBody(req,2048))}catch{}}
    const a=ag||String(b.agent||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    if(req.method==='GET'){const c=await readConfig(a);return send(res,200,{mode:pick(c,'approvals.mode')||'manual'})}
    if(req.method==='PUT'){const mode=b.mode==='smart'?'smart':'manual';const r=await setKey(a,'approvals.mode',mode);if(!r.ok)return send(res,500,{error:r.err||'Could not save'});console.log('approvals for',a,'→',mode);return send(res,200,{mode})}}
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
   if(p==='/ui/mcp/start-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),tool=String(b.name||'');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'});
    try{const pr=await sharing.prepareSignin(ag,tool,MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(tool));if(pr.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,await startSignin(ag,tool))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/mcp/prepare-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'});
    try{const r=await sharing.prepareSignin(ag,String(b.name||''),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||'')));if(r.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/mcp/oauth-redirect'&&req.method==='GET')return send(res,200,{redirect:MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(url.searchParams.get('name')||'')});
   if(p==='/ui/share/duplicate'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
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
    await saveSecret(base,name,value);console.log('secret saved for',base,'('+name+')');
    return send(res,200,{ok:true,name,message:'🔒 '+label+' — saved for you as '+name+'. You cannot see the value. '+secretHow(base,name)})}
   if(p==='/ui/secrets/pending'&&req.method==='GET'){const ag=String(url.searchParams.get('agent')||'default').split('--')[0];
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+ag,'GET',new URLSearchParams(),ag))return send(res,200,{items:[]});
    return send(res,200,{items:[...[...secretAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,label:x.label,mode:x.mode,name:x.name,enter:x.enter,t:x.t,expires:x.t+270000})),
     ...[...browserAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,kind:'browser',task:x.task,suggest:x.suggest,why:x.why,t:x.t,expires:x.t+270000,connected:localBrowser.connected(u.id)}))]})}
   if(p==='/ui/local-browser/pair'&&req.method==='POST')return send(res,200,{token:await localBrowser.pair(u.id)});
   if(p==='/ui/local-browser/status'&&req.method==='GET')return send(res,200,{connected:localBrowser.connected(u.id),session:url.searchParams.get('session')?localBrowser.linked(url.searchParams.get('session')):undefined});
   if(p==='/ui/local-browser/extension.zip'&&req.method==='GET'){const z=await localBrowser.zip();res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="aqeelos-browser.zip"','content-length':z.length,...security});return res.end(z)}
   if(p==='/ui/local-browser/frame'&&req.method==='GET'){const r=await localBrowser.ask(u.id,'frame');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...security});return res.end(JSON.stringify({connected:!r.offline,...r,type:undefined,id:undefined}))}
   if(p==='/ui/local-browser/focus'&&req.method==='POST')return send(res,200,await localBrowser.ask(u.id,'focus'));
   if(p==='/ui/local-browser/off'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,{ok:localBrowser.unlink(String(b.session||''))})}
   {const bm=/^\/ui\/browser-choice\/([\w-]+)$/.exec(p);if(bm&&req.method==='POST'){const rec=browserAsks.get(bm[1]);if(!rec)return send(res,404,{error:'This question has ended. Ask the agent again.'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'});
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const session=String(b.session||'');
    if(b.where==='yours'){if(!session)return send(res,400,{error:'Open the chat the agent is working in, then choose.'});
     try{await localBrowser.link(u.id,rec.base,session)}catch(e){return send(res,409,{error:e.message})}
     browserAsks.delete(rec.id);rec.resolve({text:'The person chose their own browser. Its tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_press, browser_scroll, browser_back) are added from your next turn and run in their Chrome, in a separate window they can watch, with the sign-ins they already have there. End this turn now with one short line saying you are ready; aqeelOS then tells you to go ahead. In this chat do not use browser_exec (that one runs on the AI box). Screenshots and browser_vision are not available in their browser; read pages with browser_snapshot. Ask before you submit anything that sends, pays, deletes or invites.'});return send(res,200,{ok:true})}
    if(session)localBrowser.unlink(session);browserAsks.delete(rec.id);rec.resolve({text:'The person chose your screen on the AI box. Use your browser as usual there.'});return send(res,200,{ok:true})}}
   {const sm=/^\/ui\/secrets\/([\w-]+)$/.exec(p);if(sm&&req.method==='POST'){const rec=secretAsks.get(sm[1]);if(!rec)return send(res,404,{error:'This request has ended. Ask the agent again.'});
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'});
    let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}
    if(b.cancel){secretAsks.delete(rec.id);rec.resolve({text:'The person chose not to give it. Do not ask again unless they say so.',isError:true});return send(res,200,{ok:true})}
    const value=String(b.value||'');if(!value||value.length>8000)return send(res,400,{error:'Type or paste the value first.'});
    try{const text=await useSecret(rec,value);secretAsks.delete(rec.id);rec.resolve({text});console.log('secret given to',rec.agent,'('+rec.mode+(rec.name?' '+rec.name:'')+')');return send(res,200,{ok:true,text:rec.mode==='type'?'Typed into the screen.':'Saved as '+rec.name+'.'})}
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
   if((p==='/ui/channels/whatsapp/prepare'||p==='/ui/channels/whatsapp-reset')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
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
    try{return send(res,200,await relay.sendAs(from,String(b.owner||''),String(b.platform||''),String(b.text||''),b.chat?String(b.chat):null))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/for'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,{channels:await relay.channelsFor(a)})}   // its own, its extra connections and shared ones, each with an ID
   // Schedules: folders, plain descriptions, recipients by name and what each run cost
   if(p==='/ui/schedules/info'&&req.method==='GET'){try{const d=await schedules.info();if(!users.isAdmin(u)){const ok=a=>!users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a);for(const k of Object.keys(d.meta))if(!ok(k.split('|')[0]))delete d.meta[k];for(const k of Object.keys(d.runs))if(!ok(k.split('|')[0]))delete d.runs[k]}return send(res,200,d)}catch(e){return send(res,500,{error:e.message})}}
   if(p==='/ui/schedules/detail'&&req.method==='GET'){const a=url.searchParams.get('profile')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    try{return send(res,200,await schedules.detail(a,url.searchParams.get('id')||''))}catch(e){return send(res,404,{error:e.message})}}
   if(p==='/ui/schedules/meta'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const a=String(b.profile||'default');if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,await schedules.setMeta(a,String(b.id||''),b))}
   if(p==='/ui/schedules/folder'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await schedules.folderOp(b))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/job-relays'&&req.method==='GET')return send(res,200,await relay.jobRelays());
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
   if(p==='/ui/explain'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,300000))}catch{}return send(res,200,await explain.get(String(b.kind||''),Array.isArray(b.items)?b.items:[]))}
   if(p==='/ui/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const all=await usage.breakdown(await listAllProfiles(),days,users.ownerOf);
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
  return screens.upgrade(req,sock,headBuf,ads?null:agent)}).catch(()=>sock.destroy());
});
server.listen(PORT,HOST,()=>console.log(`aqeelOS on http://${HOST}:${PORT} → dashboard ${DASH.origin}, gateway ${GATE.origin}`));
