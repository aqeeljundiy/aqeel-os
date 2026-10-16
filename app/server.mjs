// aqeelOS — production server. Serves the UI, signs people in, and forwards
// /hapi/* to the Hermes dashboard API and /gapi/* to the Hermes gateway API.
// Hermes credentials stay on this server; the browser only ever holds a session cookie.
// No dependencies. Run: node app/server.mjs (configuration via environment, see README).
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat,writeFile,mkdir,unlink,rename,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createAccounts,setupAgentFn} from './accounts.mjs';
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
import {readdir} from 'node:fs/promises';
import {scryptSync,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const env=process.env;
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
const security={'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY','permissions-policy':'camera=(), geolocation=()','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

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
function liveEnd(key,rec){rec.done=true;for(const r of rec.subs)r.end();rec.subs.clear();setTimeout(()=>{if(LIVE.get(key)===rec)LIVE.delete(key)},120000)}
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
   r.on('data',c=>{rec.chunks.push(c);if(!res.writableEnded&&!res.destroyed)res.write(c);for(const sub of rec.subs)sub.write(c)});
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
const DATA=path.resolve(env.UI_DATA_DIR||path.join(root,'..','hermes-ui-data'));
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
const relay=createRelay({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,SECRET,listAgents:()=>listAgents(),links:{list:a=>links.list(a)},platformsOf:a=>platformsCached(a),nameOf:a=>NAMES[a]||a});
const NAMES={};   // agents' display names (refreshed with the agent context), for messages people read
// agents allowed to send through a shared channel get the "notify me" tool; others lose it
async function syncNotifyTool(){const sh=await relay.shares();const senders=new Set(Object.values(sh).flatMap(v=>v.senders||[]));
 // through the engine's own MCP route, so the running engine picks the tool up (a config edit alone is not noticed)
 const mcp=(a,m,p,b)=>fetch(`${DASH.origin}/api/mcp/servers${p}?profile=${encodeURIComponent(a)}`,{method:m,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>{if(!r.ok&&r.status!==404)throw new Error('MCP '+m+' '+r.status)});
 for(const a of await listAgents()){if(PORT!==4400&&!senders.has(a))continue;   // a test copy only touches the agents it is testing
  const want=senders.has(a)||(await relay.channelsFor(a).catch(()=>[])).length>0;   // any agent with a channel can notify the person
  const url=`http://127.0.0.1:${PORT}/mcp/notify/${a}/${relay.sig(a)}`;const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');
  if(want?y.includes(url):!y.includes('aqeelos-notify'))continue;
  if(y.includes('aqeelos-notify'))await mcp(a,'DELETE','/aqeelos-notify');if(want)await mcp(a,'POST','',{name:'aqeelos-notify',url})}}
/* What each agent should know about aqeelOS: the screens the person can watch and the channel IDs it can
   message them on. Kept in a marked section of AGENTS.md in the agent's own folder (~/workspaces/<agent>),
   which the engine reads with every chat; anything outside the section is left alone. */
async function displayName(a){const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'profile.yaml'),'utf8').catch(()=>'');return (/^display_name:\s*"?([^"\n]+)"?/m.exec(y)||[])[1]?.trim()||(a==='default'?'aqeelOS':a)}
/* The engine tells models that chats from an app are plain text ("no markdown"), so replies came out as flat
   paragraphs although aqeelOS shows formatting. Each agent gets the engine's own override with the truth. */
const CHAT_HINT="You're replying in aqeelOS, a chat app that shows Markdown. Format for easy reading, like a well-written Claude or ChatGPT reply: short answers stay short and conversational; longer ones start with the outcome, then use ## headings for sections, bullet or numbered lists, tables for comparisons, and code blocks for code or commands. Bold the key numbers, names, dates and decisions (for example: UPS **Rp522,328** → **Continue**) so the reply can be skimmed. While working, keep progress notes to one short line each and lead the final answer with the result. File/media delivery: images referenced as MEDIA:/absolute/path tags (.png/.jpg/.jpeg/.gif/.webp/.bmp, up to 5MB) are shown inline in the chat. Non-image files are not shown inline, so state the plain file path instead of a MEDIA: tag.";
async function ensureChatHint(a){const cfgFile=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml');const y=await readFile(cfgFile,'utf8').catch(()=>'');
 if(y.includes('Bold the key numbers'))return;   // already the current wording
 const {execFile}=await import('node:child_process');
 await new Promise(res=>execFile(path.join(homedir(),'.local','bin','hermes'),['-p',a,'config','set','agent.platform_hints.api_server',JSON.stringify({replace:CHAT_HINT}),'--force'],{timeout:60000},()=>res()))}
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
   ...(/connect.composio.dev|rube.app/.test(await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>''))?['','## Apps','',
    'For an outside app (Slack, Gmail, Google Drive, Notion, GitHub…), use that app’s own MCP tool if you have it and it is connected. Otherwise use the Composio tools (composio), which reach 500+ apps through the person’s Composio account. If Composio says an app is not connected yet, give the person the link it returns to connect it, then continue.']:[]),
   '','## Connecting an MCP tool that needs a sign-in','',
   'Do not run “hermes mcp login” and do not use a 127.0.0.1 / localhost callback: the person is not at this server, so that page never opens for them. Add the tool (with its client ID/secret if the service needs its own app), then tell the person to press Sign in on it under Abilities › MCP tools. aqeelOS sets the return address itself: https://ai.elkiya.com/mcp-oauth/api/mcp/oauth/callback/<tool name> (this is what goes in the service’s Redirect URLs).',
   '','## Channels you can message the person on','',
   ch.length?'Use the send_to_person tool with one of these IDs when the person asks to be notified on a channel ("notify me on shop-whatsapp"):':'None yet. The person can connect WhatsApp, Telegram and others on the Channels page.',
   ...ch.map(c=>'- '+c.id+' = '+c.name),'<!-- /aqeelos:context -->'].filter(x=>x!==null).join('\n');
  const dir=path.join(homedir(),'workspaces',a),file=path.join(dir,'AGENTS.md');await mkdir(dir,{recursive:true});
  const cur=await readFile(file,'utf8').catch(()=>'');const re=/<!-- aqeelos:context[\s\S]*?<!-- \/aqeelos:context -->/;
  const next=re.test(cur)?cur.replace(re,()=>body):(cur?cur.replace(/\s*$/,'\n\n'):'')+body+'\n';if(next!==cur)await writeFile(file,next)}catch(e){console.warn('agent context',a,e.message)}}}
if(PORT===4400){setTimeout(()=>writeAgentContext().catch(()=>{}),25000);setInterval(()=>writeAgentContext().catch(()=>{}),180000).unref()}
// only the live app (port 4400) sets agents' tools; a test copy on another port must not repoint them
if(PORT===4400){setTimeout(()=>syncNotifyTool().catch(e=>console.warn('notify tool',e.message)),20000);setInterval(()=>syncNotifyTool().catch(()=>{}),600000).unref()}
const sharing=createShare({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents()});
const channels=createChannels({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAllProfiles(),cached:a=>platformsCached(a)});
const links=createLinks({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,python:()=>sharing.python(),setupAgent:n=>setupAgentFn?.(n)});
async function listAgents(){const n=['default'];try{for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}))if(d.isDirectory()&&!d.name.startsWith('.')&&!isLink(d.name))n.push(d.name)}catch{}return n}
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
 await users.created(u,name);
 await setupAgentFn?.(name).catch(e=>console.warn('setup',name,e.message));
 if(!users.can(u,'unsafe'))for(const t of UNSAFE_TOOLSETS)await fetch(`${DASH.origin}/api/tools/toolsets/${t}?profile=${encodeURIComponent(name)}`,{method:'PUT',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:'{"enabled":false}'}).catch(()=>{});
}
/* The engine's channel list is slow (it checks every connection, 5–20 s), and pages ask for it often.
   Keep each agent's answer for 15 s, share one request between everyone asking at once, and forget it as
   soon as a channel setting changes. */
// where MCP sign-ins come back: the public site (the engine is told this, see ensurePublicUrl)
const MCP_OAUTH_BASE=(env.PUBLIC_URL||'https://ai.elkiya.com').replace(/\/$/,'')+'/mcp-oauth';
const platCache=new Map();
function platformsCached(agent){const k=agent||'default';const c=platCache.get(k);if(c&&(c.p||Date.now()-c.t<15000))return c.p||Promise.resolve(c.v);
 const p=fetch(DASH.origin+'/api/messaging/platforms?profile='+encodeURIComponent(k),{headers:{'x-hermes-session-token':DASH_TOKEN}}).then(async r=>{const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.detail||'HTTP '+r.status),{status:r.status});platCache.set(k,{t:Date.now(),v});return v}).catch(e=>{platCache.delete(k);throw e});
 platCache.set(k,{p});return p}
async function hermesCall(req,res,u,url){
 const p=url.pathname,q=url.searchParams,agent=agentOf(p,q);
 const no=users.gate(u,p,req.method,q,agent);if(no)return send(res,no.status,{error:no.error});
 if(p==='/hapi/messaging/platforms'&&req.method==='GET'){try{return send(res,200,await platformsCached(q.get('profile')||'default'))}catch(e){return send(res,e.status||502,{error:e.message})}}
 if(p.startsWith('/hapi/messaging/')&&req.method!=='GET')platCache.clear();
 let body;
 // a member's file calls must stay in their own folder
 if(!users.isAdmin(u)&&p.startsWith('/hapi/files')){
  if(req.method==='GET'){if(!users.filePathOk(u,q.get('path')||users.home(u)))return send(res,403,{error:'That folder is not yours.'})}
  else{const raw=await readRaw(req,p.endsWith('upload-stream')?200e6:65536);body=raw;
   let fp=null;if(p.endsWith('upload-stream'))fp=(/name="path"\r\n\r\n([^\r\n]*)/.exec(raw.toString('latin1'))||[])[1];else{try{fp=JSON.parse(raw.toString('utf8')).path}catch{}}
   if(!users.filePathOk(u,fp))return send(res,403,{error:'That folder is not yours.'})}}
 // a member's message: within their daily limit, and only on models they may use
 const chatM=/^\/gapi(?:\/p\/[^/]+)?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p);
 if(chatM&&!users.isAdmin(u)&&req.method==='POST'){
  const lim=users.limitOf(u);if(lim?.tokens){const t=await usage.today(await listAgents(),u.id,users.ownerOf);if(t.tokens>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
  const allowed=users.allowedModels(u);if(allowed){let b={};try{b=JSON.parse((await readRaw(req,40e6)).toString('utf8'))}catch{}
   if(b.model){if(!users.modelOk(u,b.provider||'',b.model))return send(res,403,{error:'You can\'t use that model. Ask the owner.'})}
   else{const d=await agentModel(agent);if(!users.modelOk(u,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');if(m.length){b.provider=pv;b.model=m.join('|')}else b.model=pv}}
   body=Buffer.from(JSON.stringify(b))}}
 let relayTarget=undefined,relayJob=null;
 const cronM=/^\/hapi\/cron\/jobs(?:\/([^/]+))?$/.exec(p);
 if(cronM&&(req.method==='POST'&&!cronM[1]||req.method==='PUT'&&cronM[1])&&!body){let b={};try{b=JSON.parse((await readRaw(req,262144)).toString('utf8'))}catch{}
  const holder=req.method==='PUT'?(b.updates||{}):b;const dv=String(holder.deliver||'');
  if(dv.startsWith('relay:')){const [owner,platform]=dv.slice(6).split('|');relayTarget={owner,platform};holder.deliver='local'}else if('deliver' in holder)relayTarget=null;
  relayJob=cronM[1]||null;body=Buffer.from(JSON.stringify(b))}
 // deleting an agent: keep a full copy first (30 days), so it can be restored from Agents › Recently deleted
 const delM=/^\/hapi\/profiles\/([^/]+)$/.exec(p);
 if(delM&&req.method==='DELETE'){const name=decodeURIComponent(delM[1]);if(name!=='default'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)&&!/^(rl|nt|lk|dp|kp|sh-a|sh-b)-/.test(name)){
   const dir=path.join(HERMES_HOME,'profiles',name),trash=path.join(DATA,'agent-trash');await mkdir(trash,{recursive:true});
   const file=path.join(trash,name+'__'+new Date().toISOString().replace(/[:.]/g,'-')+'.tgz');const {execFile}=await import('node:child_process');
   const ok=await new Promise(r=>execFile('tar',['-czf',file,'--exclude=./cache','--exclude=./sandboxes','-C',dir,'.'],{timeout:180000,maxBuffer:1e6},e=>r(!e)));
   if(!ok)return send(res,500,{error:'Could not save a backup of this agent first, so it was not deleted.'})}}
 let made=null;
 if(!users.isAdmin(u)&&req.method==='POST'&&(p==='/hapi/mcp/servers'||p==='/hapi/profiles')){
  let b={};try{b=JSON.parse((await readRaw(req,65536)).toString('utf8'))}catch{}
  // an MCP server started by command runs code on the box: same rule as the terminal
  if(p==='/hapi/mcp/servers'&&b.command&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
  // a member's new agent starts empty: copying the main agent would copy its keys and memory
  if(p==='/hapi/profiles'){b.clone_from_default=false;b.clone_all=false;made=String(b.name||'')}
  body=Buffer.from(JSON.stringify(b))}
 const transform=/^\/hapi\/(sessions|sessions\/search|profiles|cron\/jobs)$/.test(p)&&req.method==='GET'?d=>users.filter(u,p,d,agent)
  :/^\/gapi(\/p\/[^/]+)?\/api\/model\/options$/.test(p)&&users.allowedModels(u)?d=>({...d,providers:(d.providers||[]).map(pv=>({...pv,models:(pv.models||[]).filter(m=>users.modelOk(u,pv.slug,m))})).filter(pv=>pv.models.length)})
  :/^\/gapi(\/p\/[^/]+)?\/api\/sessions$/.test(p)&&req.method==='POST'?async d=>{await users.own(d.id||d.session?.id||d.session_id,u);return d}
  :made?async d=>{await memberAgent(u,made);return d}
  :relayTarget!==undefined?async d=>{const id=relayJob||(d.job||d).id;if(id)await relay.setJobRelay(agent,id,relayTarget);return d}:undefined;
 if(p.startsWith('/hapi/'))return proxy(req,res,DASH,'/hapi',{'x-hermes-session-token':DASH_TOKEN},{transform,body});
 const live=chatM&&req.method==='POST'?{key:agent+'|'+decodeURIComponent(chatM[1]),user:u.id}:undefined;
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
  if(p==='/healthz')return send(res,200,{ok:true,build:BUILD,live:[...LIVE.values()].filter(r=>!r.done).length});
  // the "notify me" tool agents call (from this box only; each agent's address is signed)
  const mn=/^\/mcp\/notify\/([\w-]+)\/([\w-]+)$/.exec(p);
  if(mn){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method==='GET')return send(res,405,'POST only');
   let msg={};try{msg=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'})}const out=await relay.mcp(mn[1],mn[2],msg);if(out.body==null){res.writeHead(out.status);return res.end()}return send(res,out.status,out.body)}
  // Incoming webhooks (GitHub, Stripe…) reach Hermes' webhook listener here. No sign-in: each
  // subscription checks its own secret signature, and nothing but POST /webhooks/<name> passes.
  if(/^\/webhooks\/[\w.-]{1,64}$/.test(p)&&req.method==='POST')return proxy(req,res,HOOKS,'',{});
  // MCP sign-in (OAuth) returns here from Slack, Notion…; the engine checks the one-time state. No sign-in needed.
  if(p.startsWith('/mcp-oauth/api/mcp/oauth/callback/')&&req.method==='GET'){
   const r=await fetch(DASH.origin+p.slice('/mcp-oauth'.length)+url.search).catch(()=>null);if(r)await r.text();const ok=!!r&&r.ok;
   res.writeHead(r?.status||502,{'content-type':'text/html; charset=utf-8',...security});
   return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;text-align:center;color:#111"><h2>${ok?'Signed in':'Sign-in did not finish'}</h2><p>${ok?'You can close this tab and go back to aqeelOS.':'Go back to aqeelOS and press Sign in again.'}</p></body>`)}
  if(p.startsWith('/screen/')){if(!validCookie(req))return send(res,401,'Sign in first.');return screenHttp(req,res)}
  if(p==='/ui/screen/browser'||p.startsWith('/ui/screens')){const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'});if(req.method!=='GET'&&req.headers['x-hui']!=='1')return send(res,403,{error:'Sign in first.'});
   const sm=/^\/ui\/screens\/([^/]+)/.exec(p);if(p==='/ui/screens'&&!users.isAdmin(u))return send(res,200,{screens:[]});
   const no=users.gate(u,p,req.method,url.searchParams,sm?decodeURIComponent(sm[1]):agentOf(p,url.searchParams));if(no)return send(res,no.status,{error:no.error});
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
   if(p==='/ui/agent-restore'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');const m=/^([a-z0-9][a-z0-9_-]{0,63})__[\w-]+\.tgz$/.exec(f);if(!m)return send(res,400,{error:'Unknown backup.'});
    const dir=path.join(HERMES_HOME,'profiles',m[1]);if(await stat(dir).catch(()=>null))return send(res,409,{error:'An agent with that name exists already.'});
    await mkdir(dir,{recursive:true});const {execFile}=await import('node:child_process');
    const ok=await new Promise(r=>execFile('tar',['-xzf',path.join(DATA,'agent-trash',f),'-C',dir],{timeout:180000},e=>r(!e)));if(!ok)return send(res,500,{error:'Could not unpack the backup.'});
    await fetch(DASH.origin+'/api/gateway/restart?profile=default',{method:'POST',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:'{}'}).catch(()=>{});
    return send(res,200,{ok:true,agent:m[1]})}
   if(p==='/ui/box'&&req.method==='GET')return send(res,200,await boxMemory());
   if(p==='/ui/live'&&req.method==='GET'){const rec=LIVE.get((url.searchParams.get('agent')||'default')+'|'+(url.searchParams.get('session')||''));
    if(!rec||rec.done||rec.user!==u.id)return send(res,url.searchParams.has('peek')?200:204,url.searchParams.has('peek')?{live:false}:'');
    if(url.searchParams.has('peek'))return send(res,200,{live:true,since:rec.t});
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
    for(const c of rec.chunks)res.write(c);rec.subs.add(res);res.on('close',()=>rec.subs.delete(res));return}
   if(p==='/ui/gateway/restart'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can restart the gateway.'});
    const {exec}=await import('node:child_process');exec('tmux kill-session -t gateway 2>/dev/null; tmux kill-session -t dashboard 2>/dev/null; sleep 1; ~/services.sh',{timeout:60000,shell:'/bin/bash'},()=>{});return send(res,200,{ok:true})}
   // abilities across agents: who has what, copy to other agents, rename an MCP tool (admins, or owners of both agents)
   if(p==='/ui/share/used'&&req.method==='GET'){const kind=url.searchParams.get('kind')||'';const all=await sharing.usedBy(kind);if(!users.isAdmin(u)){for(const k of Object.keys(all))all[k]=all[k].filter(a=>users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)===null)}return send(res,200,all)}
   if(p==='/ui/share'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||''),to=(Array.isArray(b.to)?b.to:[]).map(String);
    const may=a=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null;if(!may(from)||!to.every(may))return send(res,403,{error:'You can only share between agents you can edit.'});
    if(!users.isAdmin(u)&&b.kind==='mcp')return send(res,403,{error:'Only admins can copy MCP tools between agents.'});
    try{return send(res,200,await sharing.share(String(b.kind||''),String(b.name||''),from,to))}catch(e){return send(res,400,{error:e.message})}}
   // a provider without automatic registration (Slack, Google…): its app's client ID/secret, and the return address to give it
   if(p==='/ui/mcp/oauth-client'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set this.'});let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{return send(res,200,await sharing.setOauthClient(String(b.agent||'default'),String(b.name||''),String(b.client_id||'').trim(),String(b.client_secret||'').trim(),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||''))))}catch(e){return send(res,400,{error:e.message})}}
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
   if(p==='/ui/channels/whatsapp-reset'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can relink WhatsApp.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const ag=String(b.agent||'default');if(!(await listAgents()).includes(ag))return send(res,400,{error:'Unknown agent'});
    const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');// a bridge left running by the gateway keeps the login and its port; stop every bridge using this login first
    const {execFile}=await import('node:child_process');const out=await new Promise(r=>execFile('ps',['-eo','pid=,args='],(e,o)=>r(String(o||''))));
    const pids=out.split('\n').filter(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)).map(l=>+l.trim().split(/\s+/)[0]).filter(Boolean);
    for(const pid of pids){try{process.kill(pid,'SIGTERM')}catch{}}if(pids.length)await new Promise(r=>setTimeout(r,1500));for(const pid of pids){try{process.kill(pid,'SIGKILL')}catch{}}
    const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true});return send(res,200,{ok:true,stopped:pids.length})}
   if(p==='/ui/channels/shares'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share channels.'});
    if(req.method==='GET'){const sh=await relay.shares();return send(res,200,{shares:sh})}
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const v=await relay.setShare(String(b.owner||''),String(b.platform||''),b);syncNotifyTool().catch(e=>console.warn('notify tool',e.message));return send(res,200,{share:v})}}
   if(p==='/ui/channels/recipients'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,{recipients:await relay.recipients(url.searchParams.get('owner')||'default',url.searchParams.get('platform')||'')})}
   if(p==='/ui/channels/send'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const from=String(b.from||b.owner||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+from,'GET',new URLSearchParams(),from))return send(res,403,{error:'You can only send as an agent you use.'});
    try{return send(res,200,await relay.sendAs(from,String(b.owner||''),String(b.platform||''),String(b.text||''),b.chat?String(b.chat):null))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/for'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,{channels:await relay.channelsFor(a)})}   // its own, its extra connections and shared ones, each with an ID
   if(p==='/ui/channels/job-relays'&&req.method==='GET')return send(res,200,await relay.jobRelays());
   if(p==='/ui/channels/move'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can move channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await channels.move(String(b.platform||''),String(b.from||''),String(b.to||'')))}catch(e){return send(res,400,{error:e.message})}}
   // QR codes (WhatsApp linking…): drawn here with the qrcode library that ships with the engine
   if(p==='/ui/qr'&&req.method==='GET'){const d=String(url.searchParams.get('d')||'');if(!d||d.length>2000)return send(res,400,'bad');
    try{const mod=await import(path.join(HERMES_HOME,'hermes-agent','node_modules','qrcode','lib','index.js'));const QR=mod.default||mod;const svg=await QR.toString(d,{type:'svg',margin:1,errorCorrectionLevel:'M',color:{dark:'#0b0c10',light:'#ffffff'}});
     res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(svg)}catch(e){return send(res,500,{error:'QR could not be drawn: '+e.message})}}
   if(p==='/ui/explain'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,300000))}catch{}return send(res,200,await explain.get(String(b.kind||''),Array.isArray(b.items)?b.items:[]))}
   if(p==='/ui/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const all=await usage.breakdown(await listAgents(),days,users.ownerOf);
    const people=Object.fromEntries(users.people().map(x=>[x.id,{name:x.name,avatar:x.avatar?'/ui/people/avatar/'+x.id:null,limit:x.limit||null}]));
    if(!users.isAdmin(u))return send(res,200,{days,byPerson:{[u.id]:all.byPerson[u.id]||null},people:{[u.id]:people[u.id]},today:await usage.today(await listAgents(),u.id,users.ownerOf)});
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
 if(p!=='/screen/websockify'||!validCookie(req)||!sameOrigin(req)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
 const agent=new URL(req.url,'http://x').searchParams.get('agent');
 me(req).then(u=>{if(!u||users.gate(u,'/ui/screens/'+(agent||'default'),'GET',new URLSearchParams(),agent||'default')){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  // screen=ads: the shared AdsPower screen, whichever agent is driving it (admins only)
  const ads=new URL(req.url,'http://x').searchParams.get('screen')==='ads';if(ads&&!users.isAdmin(u)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  return screens.upgrade(req,sock,headBuf,ads?null:agent)}).catch(()=>sock.destroy());
});
server.listen(PORT,HOST,()=>console.log(`aqeelOS on http://${HOST}:${PORT} → dashboard ${DASH.origin}, gateway ${GATE.origin}`));
