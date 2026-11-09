import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
// aqeelOS — production server. Serves the UI, signs people in, and forwards
// /hapi/* to the Hermes dashboard API and /gapi/* to the Hermes gateway API.
// Hermes credentials stay on this server; the browser only ever holds a session cookie.
// No dependencies. Run: node app/server.mjs (configuration via environment, see README).
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat,writeFile,mkdir,unlink,rename,realpath,readlink,copyFile} from 'node:fs/promises';
import {homedir,userInfo} from 'node:os';
import {createAccounts,setupAgentFn,export_setups,accountHooks} from './accounts.mjs';
import {allowed as skillAllowed,setRule as setSkillRule,rules as skillRules} from './skills-policy.mjs';
import {createAgentDefaults} from './agent-defaults.mjs';
import {createWhy} from './why.mjs';
import {createChatHistory} from './chat-history.mjs';
import {createIssues} from './issues.mjs';
import {createTeamSettings} from './team-settings.mjs';
import {createCodeChanges} from './code-changes.mjs';
import {createEscalations} from './escalations.mjs';
import {createConnect,firstModelFor} from './connect.mjs';
import {createOptins,COMPOSIO as COMPOSIO_URL,appNames,solvedIssues} from './agent-optins.mjs';
import {isConnector as isConnectorEntry} from './connectors.mjs';
import {createAntigravity} from './antigravity.mjs';
import {createSlackQuiet,slackQuietPlan} from './slack-quiet.mjs';
import {holdWrites,withAgent,withFlock,setKey,readConfig,pick,agentNames,isAgent,busy as opsBusy,initStatus,getStatus,setStatus,editEnv,hermes as hcmd,python as enginePython,LIVE_APP,HELP_AGENT} from './agentops.mjs';
import {createSchedules} from './schedules.mjs';
import {createScreens} from './screens.mjs';
import {createAgentAdspower} from './agent-adspower.mjs';
import {createUsers,UNSAFE_TOOLSETS} from './users.mjs';
import {createStarters} from './starters.mjs';
import {createMail} from './mail.mjs';
import {createUsage} from './usage.mjs';
import {createExplain} from './explain.mjs';
import {createLabels} from './labels.mjs';
import {agentNameFrom,prettyId} from './agent-name.mjs';
import {createKeysIdentity} from './keys-identity.mjs';
import {createBuiltinSkills} from './builtin-skills.mjs';   // Built in or added on this OS (7 Nov 2026)
import {nameRefusal,addNameFields,namesMissing,namesPrompt,okName,okDesc} from './name-rules.mjs';   // a plain name and one line for everything an agent makes   // which account each key belongs to (7 Nov 2026)   // names and descriptions people remember (7 Nov 2026)
import {createChannels} from './channels.mjs';
import {swr,limiter} from './swr.mjs';
import {createShare} from './share.mjs';
import {createConnectors,notConnected,contextLines as connectLines,isConnector} from './connectors.mjs';
import {createRelay} from './relay.mjs';
import {boxMemory} from './boxmem.mjs';
import {createLinks} from './links.mjs';
import {createLocalBrowser} from './localbrowser.mjs';
import {createEngineConsole} from './engine-console.mjs';
import {createAccess} from './access.mjs';
import {createAccessRequests} from './access-requests.mjs';
import {startScreenFollow} from './screen-follow.mjs';
import {createN8n} from './n8n.mjs';
import {createCode} from './code.mjs';
import {createCodeAgents,safeRel} from './code-agents.mjs';
import {createCodeBridge} from './code-bridge.mjs';
import {createCodeOnline} from './code-online.mjs';
import {createTeamFolders} from './team-folders.mjs';
import {createBrand} from './brand.mjs';
import {createAccountAuth} from './account-auth.mjs';   // first-run owner, forgot password, recovery code (7 Nov 2026)
import {createBottlenecks,forPopup,memberCan} from './bottlenecks.mjs';
import {createInstructions} from './instructions.mjs';
import {createNews,eveningLine} from './news.mjs';
import {createMorning} from './morning.mjs';
import {mayStartAgents,busyTotal,guardPaused} from './busy.mjs';
import {stopGatewayCmd,stopTimeoutMs} from './gateway-stop.mjs';
import {createRestartLater,inQuiet} from './restart-later.mjs';
import {createHelp} from './help.mjs';
import {createLive} from './live.mjs';
import {createBackups} from './backup.mjs';
import {createGoogleConnect} from './google-connect.mjs';   // Connect Google in the app (7 Nov 2026)
import {createMcpEdit} from './mcp-edit.mjs';   // edit an app that is already added, its key (7 Nov 2026)
import {createPluginHost} from './plugin-host.mjs';
import {createEngineUpdates} from './engine-updates.mjs';
import {createAutomationGuard} from './automation-guard.mjs';
import {createAgentHealth} from './agent-health.mjs';
import {createQuiet,holdActive} from './alert-quiet.mjs';
import {createConnectedAccounts} from './connected-accounts.mjs';
import {createSharing,createSecretAccess,LEVELS as SHARE_LEVELS} from './sharing.mjs';
import {createAgentAccess,MAIN_RULE_LINES} from './agent-access.mjs';
import {createConnections} from './connections.mjs';
import {createSecretLinks,createLimiter} from './secret-links.mjs';
import {createGoogleShares} from './google-shares.mjs';
import {createGoogleFiles} from './google-files.mjs';
import {createKirimdev,publicReach,LABEL_NEVER} from './kirimdev.mjs';
import {createKirimdevAgent,createImageReader} from './kirimdev-agent.mjs';
import {createPostingLimits} from './posting-limits.mjs';
import {createTeamGroups,contextLines as teamContext,ROLES as TEAM_ROLES} from './team-group.mjs';
import {execFile} from 'node:child_process';
import {createSelfRuns,judge as srJudge,safeLock,fp as srFp,AGENT as SR_AGENT,MAX_MIN as SR_MAX,DEFAULT_MIN as SR_DEF,PRETTY as SR_PRETTY} from './self-runs.mjs';
import {createSelfRunsBox,placement as srPlacement} from './self-runs-box.mjs';
import {createBackupModels,engineProbe,RULES as BM_RULES} from './backup-models.mjs';
import {isDaytime as dayNow,local as localAt,clock as clockAt} from './engine-update-rules.mjs';
import {readdir} from 'node:fs/promises';
import {createReadStream,readFileSync,readdirSync} from 'node:fs';
import {scryptSync,randomBytes,createHmac,createHash,timingSafeEqual} from 'node:crypto';
import net from 'node:net';
// Node gives up on each connection attempt after 250 ms; from the box a connect takes 2-4 s, so calls like Anthropic's usage
// check failed with ETIMEDOUT while curl worked (found 24 Oct 2026). A longer limit costs nothing when the connect is fast.
net.setDefaultAutoSelectFamilyAttemptTimeout(4000);
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAgentVersions,VERSION_TOOLS} from './agent-versions.mjs';   // self-repair kit (workstream E)
import {createAgentLive} from './agent-live.mjs';
import {sysTz,localParts,zoneName} from './tz.mjs';
import {engineKeys,ensureEngineKeys,uiSecret,PUBLIC_URL_REF,PUBLIC_HOST_REF,urlRef,hostSetting,installTz,applyTz,validTz,createInstallRoutes} from './install-routes.mjs';   // the box's time zone (7 Nov 2026: was Asia/Jakarta in code)   // live context each message + traceback guard (7 Nov 2026)
import {createAgentCare} from './agent-care.mjs';
import {createPaidLabels} from './paid-labels.mjs';   // Customer and S- labels once a payment is confirmed paid (8 Nov 2026)
import {createCustomerTools,DEFAULT_CARD_MAX} from './customer-tools.mjs';   // customer-run sandbox (7 Nov 2026)   // old setup, checks after changes, script-only schedules (7 Nov 2026)
import {readPicture,emojiSlugs,emojiAuto,AVATAR_TYPES} from './avatar-file.mjs';
import {parseEnv,setEnvLine,channelWho,globalWho,removePerson,engineChange,approvedWithout,samePerson as allowSame} from './allowlist.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const env=process.env;
// What differs per install: set in the box's environment (~/apps/hermes-ui.env). Neutral defaults for a fresh install.
// the engine's gateway key and dashboard token come from its own ~/.hermes/.env when this env does not set them (install.mjs)
{const added=process.argv[2]==='hash'?[]:ensureEngineKeys();if(added.length)console.warn('engine keys added to the engine\'s .env ('+added.join(', ')+'): restart the engine once so it uses them');
 const k=engineKeys();for(const n of ['API_SERVER_KEY','HERMES_DASHBOARD_SESSION_TOKEN'])if(!env[n]&&k[n])env[n]=k[n]}
// Your address: env PUBLIC_URL, else the owner's setting on System › Settings; reads the current one wherever it is used (install.mjs)
const PUBLIC_URL=PUBLIC_URL_REF,N8N_URL=(env.N8N_URL||'http://localhost:5678').replace(/\/$/,'');
const CODE_HOST=hostSetting('codeHost'),CODE_PREVIEW_HOST=hostSetting('codePreviewHost'),OWNER_CONTACT=env.OWNER_CONTACT||'the owner of this aqeelOS install';
const PUBLIC_HOST=PUBLIC_HOST_REF,SSH_HOST=env.SSH_HOST||PUBLIC_HOST,SSH_PORT=+(env.SSH_PORT||2222);
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
const SECRET=process.argv[2]==='hash'?'':uiSecret().secret;   // env UI_SECRET, else made once and kept in DATA/ui-secret (install.mjs)
const SECURE_COOKIE=env.UI_INSECURE_COOKIE!=='1';
const SESSION_DAYS=Number(env.UI_SESSION_DAYS)||30;
// Usage: node app/server.mjs hash <password>  → prints a value for UI_PASSWORD_HASH
if(process.argv[2]==='hash'){const salt=randomBytes(16);console.log('scrypt:'+salt.toString('hex')+':'+scryptSync(process.argv[3]||'',salt,64).toString('hex'));process.exit(0)}
if(!PW_HASH)console.log('UI_PASSWORD_HASH is not set: the owner password is the one saved in the app (a new install asks for it on first open).');

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const security={'x-content-type-options':'nosniff','referrer-policy':'same-origin','permissions-policy':'camera=(), geolocation=()','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob: "+N8N_URL+" http://127.0.0.1:4321 http://localhost:4321 https://"+CODE_HOST+" https://"+CODE_PREVIEW_HOST+"; frame-ancestors 'self' chrome-extension://jdfbikbihabglfkcckkmmfbmfdpifbgf; base-uri 'none'; form-action 'self'"};

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
// every "path" field of a multipart upload, however its Content-Disposition spells it (quoted or not, any case);
// null when the body cannot be read the strict way, so nothing the engine might read differently gets past
function formPaths(raw,ct){const bm=/boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(ct||''));if(!bm)return null;const t=raw.toString('latin1'),parts=t.split('--'+(bm[1]||bm[2]));if(parts.length<3||!parts.at(-1).startsWith('--'))return null;const out=[];
 for(const pt of parts.slice(1,-1)){const x=pt.replace(/^\r\n/,''),i=x.indexOf('\r\n\r\n');if(i<0)return null;const cds=x.slice(0,i).split('\r\n').filter(l=>/^\s*content-disposition\s*:/i.test(l));if(cds.length!==1||/;\s*name\*/i.test(cds[0]))return null;
  const nms=[...cds[0].matchAll(/[;:]\s*name\s*=\s*(?:"([^"]*)"|([^;\s]*))/gi)];if(nms.length>1)return null;const nm=nms[0];if(nm&&String(nm[1]??nm[2]).trim().toLowerCase()==='path')out.push(Buffer.from(x.slice(i+4).replace(/\r\n$/,''),'latin1').toString('utf8'))}
 return out}
async function readRaw(req,limit=1e6){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Error('too large');chunks.push(c)}return Buffer.concat(chunks)}
async function readBody(req,limit=1e6){return (await readRaw(req,limit)).toString('utf8')}

// transform(json) rewrites a JSON answer before it reaches the browser (used to keep people's chats apart);
// body is a request body that was already read (to check it) and must be sent on as is.
/* Live replies: a chat reply streams to the page that sent it, and a copy is kept here while it runs, so a
   refreshed page or a second tab on the same chat can pick it up (GET /ui/live). The reply keeps going on
   the engine when the page goes away. Copies are dropped two minutes after the reply ends. */
const LIVE=new Map();
const runOwner=new Map();   // run id → person, so Approve / Stop work as long as the run lives
const codeRuns=new Map();   // Code's engine runs (aqeelOS models): handle → agent, run id, person, for Stop and approvals
// fetch cuts a response body silent for 5 minutes (undici's bodyTimeout): an engine turn waiting on an approval is read
// through a copy of fetch's own client without that limit (none made yet, or another Node: the default one)
let longOne=null;const longFetch=()=>{if(!longOne){const d=globalThis[Symbol.for('undici.globalDispatcher.1')];try{if(d?.constructor)longOne=new d.constructor({bodyTimeout:0})}catch{}}return longOne?{dispatcher:longOne}:{}};
// a provider's name as the chat's model menu shows it (core.js provLabel)
const codeProvName=p=>{const s=String(p?.slug||''),n=String(p?.name||s);if(s==='moa')return 'Team of models';if(/claude-subscription|^claude-code/.test(s))return 'Claude';if(/codex/.test(s))return 'ChatGPT';if(s==='openrouter')return 'OpenRouter';if(/gemini/.test(s))return 'Gemini';return n.replace(/\s*\((experimental|beta)\)$/i,'')};
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
 try{const st=await stat(file);if(!st.isFile())throw 0;let body=await readFile(file);const ext=path.extname(file);if(ext==='.html'&&rel.startsWith('assets/'))body=Buffer.from(legalFill(body.toString('utf8').replaceAll('{{OWNER_CONTACT}}',(globalThis.AQ_CONTACT||OWNER_CONTACT).replace(/[<>&"]/g,c=>'&#'+c.charCodeAt(0)+';'))));
  const etag='"'+st.size.toString(36)+'-'+Math.round(st.mtimeMs).toString(36)+'"';if(res.req?.headers?.['if-none-match']===etag){res.writeHead(304,{etag,'cache-control':'no-cache'});return res.end()}
  res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.png'&&rel.startsWith('assets/emoji/')?'public, max-age=604800':ext==='.woff2'||ext==='.svg'||ext==='.png'?'public, max-age=86400':'no-cache',etag,...security});res.end(body)}
 catch{send(res,404,'Not found')}
}

/* ---------- agent identities (name, title, picture) ----------
   Hermes has no avatars and its default profile can't be renamed, so the UI keeps identities itself,
   outside the app folder so deploys never touch them. The name is also written to Hermes'
   profile.yaml (display_name) so Hermes' own tools show it too. */
const DATA=path.resolve(env.UI_DATA_DIR||path.join(root,'..','hermes-ui-data'));initStatus(DATA);
// who runs this install, on About, Privacy and Terms: DATA/legal.json {"name","org","site"} (this install's own data,
// never in git; 7 Nov 2026, open source). Without it the pages say "the owner of this install".
// the same owner, for the desktop app's screens (public, like the About page): null when legal.json has none
function legalOwner(){let l={};try{l=JSON.parse(readFileSync(path.join(DATA,'legal.json'),'utf8'))}catch{}const t=v=>String(v||'').replace(/[<>"`]/g,'').slice(0,120);return l.name||l.org?{name:t(l.name),org:t(l.org),site:t(l.site)}:null}
function legalFill(t){if(!t.includes('{{OWNER_'))return t;let l={};try{l=JSON.parse(readFileSync(path.join(DATA,'legal.json'),'utf8'))}catch{}const e=v=>String(v||'').replace(/[<>&"]/g,c=>'&#'+c.charCodeAt(0)+';');
 if(!l.site)t=t.replaceAll(', {{OWNER_SITE}}','');if(!l.org)t=t.replaceAll(' ({{OWNER_ORG}})','');
 return t.replaceAll('{{OWNER_NAME}}',e(l.name||'the owner of this install')).replaceAll('{{OWNER_ORG}}',e(l.org)).replaceAll('{{OWNER_SITE}}',e(l.site))}
let revoked={};readFile(path.join(DATA,'session-revoke.json'),'utf8').then(t=>{revoked=JSON.parse(t)||{}}).catch(()=>{});
const HERMES_HOME=(env.HERMES_HOME||path.join(homedir(),'.hermes')).replace(/^~(?=\/|$)/,homedir()); // --env-file does not expand ~
const IDS=path.join(DATA,'identities.json');
const okProfile=n=>/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(n);
async function readIds(){try{return JSON.parse(await readFile(IDS,'utf8'))}catch{return {}}}
// for a change: missing is empty, but a file that does not parse stops it (never saved over, so nobody's identity is lost)
async function readIdsForWrite(){let t;try{t=await readFile(IDS,'utf8')}catch(e){if(e.code==='ENOENT')return {};throw e}const j=JSON.parse(t);if(!j||typeof j!=='object'||Array.isArray(j))throw Error('not an object');return j}
async function writeIds(ids){await mkdir(DATA,{recursive:true});const t=IDS+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(t,JSON.stringify(ids,null,1));await rename(t,IDS)}
// one change at a time, each on the file as it is then (read inside the queue, after its upload is in)
let idsChain=Promise.resolve();const withIds=fn=>{const r=idsChain.then(async()=>{let ids;try{ids=await readIdsForWrite()}catch(e){throw Object.assign(Error('The agents’ names and pictures could not be read, so nothing was changed. Try again, or ask an admin to check identities.json.'),{status:500,cause:e})}return fn(ids)});idsChain=r.catch(()=>{});return r};
async function setDisplayName(profile,name){
 const dir=profile==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',profile);const f=path.join(dir,'profile.yaml');
 let y='';try{y=await readFile(f,'utf8')}catch{}
 const line='display_name: '+JSON.stringify(String(name||''));
 y=/^display_name:.*$/m.test(y)?y.replace(/^display_name:.*$/m,line):(y&&!y.endsWith('\n')?y+'\n':y)+line+'\n';
 try{await writeFile(f,y)}catch(e){console.warn('profile.yaml not written:',e.message)}
}
// agent pictures: a photo (cropped to 256x256 in the browser, checked by its first bytes, one file per agent) or an emoji
// from assets/emoji (avatar-file.mjs). The two replace each other. With neither, the agent gets an automatic emoji from its
// id. avatarV changes with every new photo, so /ui/avatar/<agent>?v= shows the new one everywhere at once
async function identities(req,res,p,u){
 if(p==='/ui/identities'&&req.method==='GET'){const ids=await readIds();for(const a of await listAgents().catch(()=>[])){const n=String(ids[a]?.name||'').trim();if(!n)ids[a]={...(ids[a]||{}),name:NAMES[a]||await displayName(a)}}return send(res,200,ids)}
 const m=/^\/ui\/(identities|avatar)\/([^/]+)$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
 const profile=decodeURIComponent(m[2]);if(!okProfile(profile))return send(res,400,{error:'Bad profile name'});
 const dropPhoto=async(cur,x)=>{if(cur.avatar)await unlink(path.join(DATA,'avatars',cur.avatar)).catch(()=>{});delete x.avatar;delete x.avatarV};
 const fail=e=>send(res,e.status||500,{error:e.message});
 if(m[1]==='identities'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad JSON'})}
  if('emoji' in b){const e=String(b.emoji||'');if(e&&!(await emojiSlugs()).includes(e))return send(res,400,{error:'Pick one of the listed emoji.'})}
  return withIds(async ids=>{const cur=ids[profile]||{};
   const name='name' in b?String(b.name||'').trim().slice(0,60):cur.name||'',title='title' in b?String(b.title||'').trim().slice(0,80):cur.title||'';   // a body with only the emoji keeps the name
   const next={...cur,name,title,updated:Date.now()};
   if('emoji' in b){const e=String(b.emoji||'');if(!e)delete next.emoji;else{next.emoji=e;await dropPhoto(cur,next)}}   // an emoji replaces the photo
   ids[profile]=next;await writeIds(ids);await setDisplayName(profile,name);return send(res,200,ids[profile])}).catch(fail)}
 // no photo: send the agent's emoji (chosen or automatic) so anything outside the app that asks for the picture still gets one.
 // A private agent the person may not open shows only its automatic emoji, never its photo or chosen picture.
 if(m[1]==='avatar'&&req.method==='GET'){const cur=(await readIds())[profile]||{},base=profile.split('--')[0],ow=users.byId(users.agentOwner(base));
  const hidden=!!u&&!!ow&&!users.isAdmin(ow)&&!users.level(u,base);
  if(!cur.avatar||hidden){const l=await emojiSlugs(),e=!hidden&&l.includes(cur.emoji)?cur.emoji:emojiAuto(profile,l);if(!e)return send(res,404,'No picture');res.writeHead(302,{location:'/assets/emoji/'+e+'.png','cache-control':'private, max-age=300',...security});return res.end()}
  try{const body=await readFile(path.join(DATA,'avatars',cur.avatar));res.writeHead(200,{'content-type':AVATAR_TYPES[cur.avatar.split('.').pop()]||'application/octet-stream','cache-control':'private, max-age=86400',...security});return res.end(body)}catch{return send(res,404,'No picture')}}
 if(m[1]==='avatar'&&req.method==='PUT'){const r=await readPicture(req);if(r.error)return send(res,r.status,{error:r.error});
  return withIds(async ids=>{const cur=ids[profile]||{};
   const dir=path.join(DATA,'avatars'),file=profile+'.'+r.ext,tmp=path.join(dir,file+'.'+randomBytes(4).toString('hex')+'.tmp');await mkdir(dir,{recursive:true});await writeFile(tmp,r.buf);await rename(tmp,path.join(dir,file));
   if(cur.avatar&&cur.avatar!==file)await unlink(path.join(dir,cur.avatar)).catch(()=>{});   // one file per agent
   const {emoji:_e,...rest}=cur;ids[profile]={...rest,avatar:file,avatarV:Date.now()};await writeIds(ids);return send(res,200,ids[profile])}).catch(fail)}   // a photo replaces the emoji
 if(m[1]==='avatar'&&req.method==='DELETE')return withIds(async ids=>{const cur=ids[profile]||{};await dropPhoto(cur,cur);ids[profile]=cur;await writeIds(ids);return send(res,200,cur)}).catch(fail);   // back to its emoji, or the automatic one
 send(res,405,{error:'Method not allowed'});
}

const accountsApi=createAccounts(DATA);
// every agent's defaults from aqeelOS itself (tools, screen and browser, skills, its own Linux user): at start and for new agents
// the settings an agent may change for itself (my_settings): only everyday ones, never what it can reach
const OWN_SETTINGS=/^(stt|tts)\.[a-z0-9_.]+$|^timezone$|^display\.[a-z0-9_.]+$/;
const whyOf=createWhy({DATA,HERMES_HOME,python:enginePython});
// locked agents (owner without "unsafe", or the admin's safe lock) keep terminal, files and code off through the defaults too
// F: only agents of admins may run as the box's main user; the lead of an admin does (aqeelOS itself is theirs), and goes
// back to its own user when its person is made a member again
const agentDefaults=createAgentDefaults({DATA,isTest:a=>isTestAgent(a),mayTrust:async a=>{await users.load();return users.tierOf(a)==='admin'},adminLeads:async()=>{await users.load();return users.people().map(x=>users.leadOf(x.id)).filter(a=>a&&a!=='default'&&users.tierOf(a)==='admin')},giveSkills:n=>accountHooks.giveSkills?.(n),trimSkills:n=>accountHooks.trimSkills?.(n),locked:async a=>{await users.load();return a!=='default'&&lockedAgent(a,await getStatus())}});
accountHooks.afterSetup=n=>agentDefaults.added(n).catch(e=>console.warn('agent defaults',n,e.message));
// at start, then every 10 minutes: agents made outside aqeelOS (by Claude, by another agent, from the command line) get them too
const applyDefaults=()=>agentDefaults.all().then(n=>{if(n){console.log('agent defaults: '+n+' settings applied; restarting the agents when idle');restartLater('agent defaults')}}).catch(e=>console.warn('agent defaults:',e.message));
// about every minute: new agents (made any way) get the defaults, every agent gets the main agent's skills it lacks
const defaultsTick=()=>agentDefaults.tick().then(n=>{if(n){console.log('agent defaults: new agent set up; restarting the agents when idle');restartLater('new agent defaults')}}).catch(e=>console.warn('agent defaults tick:',e.message));
// the tab an agent works in comes to the front of its screen (screen-follow.mjs)
if(LIVE_APP)startScreenFollow();
if(LIVE_APP){setTimeout(applyDefaults,60000);setInterval(applyDefaults,600000).unref();setTimeout(()=>{defaultsTick();setInterval(defaultsTick,60000).unref()},90000)}
const mailer=createMail(DATA);
const usage=createUsage(DASH.origin,DASH_TOKEN,DATA);
const explain=createExplain(DATA,{python:enginePython,root});
const pluginDescs=new Map();
function pluginDesc(id){if(!/^[\w.-]{1,80}$/.test(id))return '';if(pluginDescs.has(id))return pluginDescs.get(id);let d='';
 for(const dir of [path.join(HERMES_HOME,'plugins',id),path.join(HERMES_HOME,'hermes-agent','plugins',id),path.join(root,'engine',id)]){try{const y=readFileSync(path.join(dir,'plugin.yaml'),'utf8');d=(/^description:\s*"?(.+?)"?\s*$/m.exec(y)||[])[1]||'';if(d)break}catch{}}
 d=d.replace(/\s*[\u2014\u2013]\s*/g,': ').split(/(?<=[.;])\s/)[0].replace(/;$/,'.').slice(0,160);pluginDescs.set(id,d);return d}
const labels=createLabels(DATA,{pluginDesc});
const builtins=createBuiltinSkills({root,HERMES_HOME,DATA});
if(LIVE_APP)setTimeout(()=>builtins.install({log:m=>console.log(m)}).catch(e=>console.warn('built-in skills',e.message)),180000).unref();
const keysId=createKeysIdentity({DATA,HERMES_HOME,root,listAgents:()=>listAgents(),live:()=>LIVE_APP});
if(LIVE_APP){setTimeout(()=>keysId.tick().catch(e=>console.warn('key checks',e.message)),120000).unref();setInterval(()=>keysId.tick().catch(()=>{}),10*60000).unref()}
const schedules=createSchedules({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents(),python:enginePython,root,live:()=>LIVE_APP||process.env.SCHED_DESCRIBE==='1',relays:()=>relay.jobRelays()});
setTimeout(()=>schedules.tick(),40000).unref();setInterval(()=>schedules.tick(),10*60000).unref();
const relay=createRelay({ownerAgent:a=>{const o=users.agentOwner(String(a).split('--')[0]);return !o||o==='owner'},DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,SECRET,listAgents:()=>listAgents(),links:{list:a=>links.list(a)},platformsOf:a=>platformsCached(a),nameOf:a=>NAMES[a]||a,ownerName:()=>users.people()[0]?.name});
const NAMES={};   // agents' display names (refreshed with the agent context), for messages people read
const agentName=agentNameFrom(NAMES);   // agent-name.mjs: display names everywhere, never a profile id
// names and notes people give their Google accounts, "<agent>|<account name>" → {label, note}
const FX={rates:{IDR:16500},at:0,day:''};   // dollar → every currency, refreshed by /ui/fx (7 Nov 2026: not only rupiah)
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
// n8n's restart reason names the agent as shown ("Mb-z4b1u"): a deploy check's throwaway agent restarts nothing (7 Nov 2026)
const testAgentShown=why=>{const n=String(why).replace(/^n8n connected for /,'').toLowerCase();return [...testAgents.v].some(a=>a.toLowerCase()===n)||/^(mb|dp|pc|lk|sc|ms|nt|rl|ky|wd|wa|sh-[ab]|lt-sub|role-a|owner-test|creator-test|controls-check)-/.test(n)};
const isTestAgent=async a=>{if(Date.now()-testAgents.t>20000)testAgents={t:Date.now(),v:new Set((await readFile(TEST_LIST,'utf8').catch(()=>'')).split('\n').filter(Boolean))};return testAgents.v.has(a)};
const noteMade=n=>{madeHere.add(n);if(!LIVE_APP)writeFile(TEST_LIST,n+'\n',{flag:'a'}).catch(()=>{})};
let notifyRun=null,notifyAgain=false;
function syncNotifyTool(){if(notifyRun){notifyAgain=true;return notifyRun}
 notifyRun=(async()=>{do{notifyAgain=false;await syncNotifyOnce()}while(notifyAgain)})().finally(()=>{notifyRun=null});return notifyRun}
async function syncNotifyOnce(){
 // through the engine's own MCP route, so the running engine picks the tool up (a config edit alone is not noticed)
 const mcp=(a,m,p,b)=>fetch(`${DASH.origin}/api/mcp/servers${p}?profile=${encodeURIComponent(a)}`,{method:m,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(async r=>{if(!r.ok&&r.status!==404)throw new Error('MCP '+m+' '+r.status+' '+(await r.text().catch(()=>'')).slice(0,120))});
 for(const a of await listAllProfiles()){if(!LIVE_APP&&!madeHere.has(a))continue;   // test agents get it too: they must be able to test my_settings/undo; alert-quiet keeps their alerts from the owner
  try{const url=`http://127.0.0.1:${PORT}/mcp/notify/${a}/${relay.sig(a)}`;const cfg=()=>readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');
   // the code bridge (aqeelos-code) too, the same way (app/code-bridge.mjs)
   if(!(await cfg()).includes(codeBridge.url(a))&&await withAgent(a,async()=>codeBridge.ensure(a,await cfg(),mcp)).catch(e=>{console.warn('code bridge tool',a,e.message);return false}))console.log('code bridge tool set for',a);
   // run_self (aqeelos-self): every agent with its own Linux user, now and made later; kept off customer channels
   await srEnsure(a,cfg,mcp).catch(e=>console.warn('self-run tool',a,e.message));
   if((await cfg()).includes(url))continue;
   const set=await withAgent(a,async()=>{const y=await cfg();if(!y||y.includes(url))return false;   // read again inside the queue
    if(y.includes('aqeelos-notify'))await mcp(a,'DELETE','/aqeelos-notify');
    try{await mcp(a,'POST','',{name:'aqeelos-notify',url})}catch{await new Promise(r=>setTimeout(r,4000));await mcp(a,'DELETE','/aqeelos-notify').catch(()=>{});await mcp(a,'POST','',{name:'aqeelos-notify',url})}return true});
   if(set)console.log('notify tool set for',a)}catch(e){if(await isAgent(a))console.warn('notify tool',a,e.message)}}}
/* What each agent should know about aqeelOS: the screens the person can watch and the channel IDs it can
   message them on. Kept in a marked section of AGENTS.md in the agent's own folder (~/workspaces/<agent>),
   which the engine reads with every chat; anything outside the section is left alone. */
// the same name the page shows (core.js ident): the identity's name, then profile.yaml, then the folder name capitalised
// (Sela has neither, and messages said "sela" while the page said "Sela"; 2 Nov 2026)
async function displayName(a){const i=String((await readIds())[a]?.name||'').trim();if(i)return i;const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'profile.yaml'),'utf8').catch(()=>'');return (/^display_name:\s*"?([^"\n]+)"?/m.exec(y)||[])[1]?.trim()||(a==='default'?'Main agent':prettyId(a))}
/* The engine tells models that chats from an app are plain text ("no markdown"), so replies came out as flat
   paragraphs although aqeelOS shows formatting. Each agent gets the engine's own override with the truth. */
const CHAT_HINT="You're replying in aqeelOS, a chat app that shows Markdown. Format for easy reading, like a well-written Claude or ChatGPT reply: short answers stay short and conversational; longer ones start with the outcome, then use ## headings for sections, bullet or numbered lists, tables for comparisons, and code blocks for code or commands. Bold the key numbers, names, dates and decisions (for example: UPS **$120 → **Acme**) so the reply can be skimmed. Never send more than two plain paragraphs in a row: start a section with a bold lead-in (**Short answer** …, **What changed** …, **Next step** …) and put lists of points in bullets. Put the one thing the person must do in a quote line that starts with **Next step:**, and a real risk or blocker in a quote line that starts with ⚠️; aqeelOS shows these as soft boxes, so use at most one or two per reply. Write every link as [a short name](url) (for example [Weekly sales report](https://docs.google.com/…)), never a bare URL; aqeelOS shows them as small labelled buttons. Put the one main document on a line of its own and it shows as a card. For the state of items in a list, add [[Done]], [[Needs you]] or [[Failed]] after the item; aqeelOS shows these as small coloured labels (use them only for real states, not decoration). While working, keep progress notes to one short line each and lead the final answer with the result. File/media delivery: images referenced as MEDIA:/absolute/path tags (.png/.jpg/.jpeg/.gif/.webp/.bmp, up to 5MB) are shown inline in the chat. Non-image files are not shown inline, so state the plain file path instead of a MEDIA: tag.";
async function ensureChatHint(a){const cfgFile=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml');const y=await readFile(cfgFile,'utf8').catch(()=>'');
 // app chats (api_server) and scheduled runs that show their result in the app (delivered "local") read the same way
 if(y.split('shows these as small coloured labels').length>2)return;   // already the current wording, twice
 for(const k of ['api_server','local']){const r=await setKey(a,'agent.platform_hints.'+k,{replace:CHAT_HINT});if(!r.ok)throw new Error(r.err)}}
async function writeAgentContext(){const all=await listAgents();const names={};for(const a of all)names[a]=NAMES[a]=await displayName(a);
 for(const a of all){await ensureChatHint(a).catch(e=>console.warn('chat hint',a,e.message));try{const me=names[a];
  // every agent has its own screen and its own AdsPower on it (1 Nov 2026: the AdsPower copy agents shared is gone)
  const own=`Your own screen is "${me}'s screen". Your browser tool opens pages there; it starts by itself when you browse.`;
  const peers=adminTier(a)?all:all.filter(x=>users.agentMayManage(a,x));   // F: a member's agents hear only of their person's agents
  const others=peers.filter(x=>x!==a).map(x=>'"'+names[x]+"'s screen\"").join(', ');
  const ch=await relay.channelsFor(a).catch(()=>[]);const gacc=await googleContext(a).catch(()=>[]);
  // an agent without terminal and files cannot change its own settings: it says where they change instead of
  // guessing ("an admin has to…", an outside website)
  const cfgA=await readConfig(a).catch(()=>null)||{};const pts=pick(cfgA,'platform_toolsets')||{};
  const connTok=new Set();for(const n of Object.keys(cfgA.mcp_servers||{}))if(await stat(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'mcp-tokens',n+'.json')).catch(()=>null))connTok.add(n);
  const narrow=Object.entries(pts).filter(([k,v])=>Array.isArray(v)&&!/^(cli|api_server)$/.test(k)&&!v.some(x=>/^(terminal|hermes-)/.test(x))).map(([k])=>k==='cron'?'scheduled runs':k[0].toUpperCase()+k.slice(1));
  const off=pick(cfgA,'agent.disabled_toolsets')||[];const locked=(Array.isArray(off)?off:String(off).split(',')).map(x=>String(x).trim()).includes('terminal');
  const body=['<!-- aqeelos:context (written by aqeelOS and kept up to date; edit outside this block) -->','# Working in aqeelOS','','## Screens','',
   'The person can watch screens live in aqeelOS: the monitor button at the top right, then the screen picker.',
   '- '+own,
   '- Your AdsPower is your own: it runs on your own screen with its own sign-in, and its browsers open there.',   // each agent's own AdsPower (1 Nov 2026); the shared copy is gone
   others?'- Other agents have their own screens: '+others+'.':null,
   'When you start working in a browser or in AdsPower, say which screen to watch, for example: "I am working on '+me+"'s screen"+'." If the person needs to sign in or solve a check themselves, tell them to open that screen and press Take over.',
   // F: what this agent's person's role lets it do (read live from People; a promotion or demotion changes it at once)
   ...((pw=>pw.tier==='member'?['','## Your power','','You act for '+pw.person.name+' and your power is their role in aqeelOS, never more: aqeelOS checks it on every call. You may run and change yourself and the agents '+pw.person.name+' owns (manage_agent'+(pw.lead?', you are their lead agent':'')+')'+(pw.maxAgents!=null?'; they may own up to '+pw.maxAgents+' agents':'')+(pw.models?'; only the models their role allows':'')+'. You cannot change aqeelOS itself (its code, the web app), deploy websites, touch other people\'s agents, see the owner\'s keys or accounts unless shared with you, change permissions or sharing levels, spend money or delete anything outside your person\'s agents. When asked for one of those, say plainly that it is for the owner of aqeelOS.']:[])(users.powerOf(a))),
   ...(locked?['','## Changing settings','',
    'You have no terminal or file tools, so you cannot change your own settings, and that is on purpose. When someone asks to change how you or your channels behave (notices such as "Redirected current run", your model, what you may use, who may message you), say plainly that you cannot change it yourself and that it is changed in aqeelOS on the Settings page (System › Settings, with "Showing: '+me+'" picked at the top). Who may message you is on Channels › Who can message (that page approves people; which Slack channels you listen to is not on any page yet, so say the aqeelOS owner changes it on the AI box); apps are on Abilities › Connected apps.',
    'Never send anyone to a website or to documentation for this, and never say "an admin" has to do it.']
    // every other agent changes its own settings when asked, and otherwise says the same plain thing
    :['','## Changing settings','',
    'Your settings are yours to change: they live in your own aqeelOS settings and change with `aqeelos -p '+a+' config set <key> <value>` (`aqeelos -p '+a+' config show` lists them). When someone asks to change how you or your channels behave (notices such as "Redirected current run", your model, who may message you), make the change yourself and say in one line what you changed; some settings (such as channel notices) only take effect after the agents restart, so say that and that the person can press Restart agents on System › Health. When the person asks you to change another agent\'s settings, or every agent\'s, do it the same way with that agent\'s name after -p ('+peers.map(x=>x+' = '+names[x]).join(', ')+') and say which agents you changed. Without such a request, change only your own.',
    'If something cannot be changed from your side, say plainly where it is changed in aqeelOS: the Settings page (System › Settings, with "Showing: '+me+'" picked at the top), Channels › Who can message, or Abilities › Connections. Never send anyone to a website or to documentation for this, and never say "an admin" has to do it.',
    // channels kept to a few tools on purpose (a team Slack, check-ins that read it): there the agent says so plainly
    ...(narrow.length?['On '+narrow.join(' and ')+' you have only a few tools on purpose (no terminal, browser or files). There, say plainly that it is something you do when asked in the aqeelOS app, never that it is impossible.']:[])]),
   // agents of admins fix a missing tool, permission or connection themselves, from any channel, and apply it
   ...(!locked&&!lockedAgent(a,{})?['','## When you are missing a tool, a permission or a connection','',
    'Nothing here waits for a developer. When you (or another agent, when the person asks about it) cannot do something only because of a setting, a missing connection or a missing action in a tool, fix it yourself, then do the job. Never answer that it needs a developer, a code change, Claude, the app instead of Slack, or more permission from the person when you can change it from here:',
    '1. Settings: `aqeelos -p <agent> config show` shows what limits an agent: `platform_toolsets` (tools per channel; a channel should have the same as the app unless the person said otherwise), `agent.disabled_toolsets`, `approvals.mode`, `mcp_servers.<name>.enabled`. Change it with `aqeelos -p <agent> config set <key> <value>`.',
    '2. A connected app another agent already has (Notion, Slack, Composio…): aqeelOS gives every agent a plain copy of each app, not signed in. Sign in your own with connect_mcp_tool, or ask the owner to share theirs with you (Abilities › Access, sharing levels). Never copy another agent’s `mcp-tokens` sign-in files or app keys: that would act as them.',
    '3. A tool that lacks one action (it can update a sheet but not create one): add the action to that tool\'s server, or write a small skill or MCP tool for it, and try it once from the terminal before using it.',
    '4. Then call apply_changes (from aqeelos-notify) once, finish your turn with what you changed, and do the job in the next turn. Never restart the gateway any other way.',
    'Ask the person first only when the change reaches outside the team (sharing with outside people, messaging clients), spends money, or deletes something. Everything else: do it and say in one line what you changed.']:[]),
   // the main agent rule (agent-access.mjs): give another agent what it lacks so it fixes its own work; others: the agents shared with them
   ...(a===agentAccess.MAIN?MAIN_RULE_LINES:await agentAccess.managed(a).then(m=>m.length?['','## Agents you look after','','You may look after these agents with manage_agent, at the level shown: '+m.map(x=>(names[x.agent]||x.agent)+' ('+x.agent+', '+x.level+')').join(', ')+'. Viewer reads its setup and logs; editor also changes its instructions, skills and schedules; manager also its settings and who else may look after it. Their keys are never shown to you.']:[]).catch(()=>[])),
   '','## Apps and accounts: free ways first','',
   'For an outside app (Slack, Gmail, Google Drive, Notion, GitHub, Google Cloud…), try the free ways first, in this order:',
   '1. That app’s own MCP tool, if you have it (connect it with connect_mcp_tool when it needs a sign-in).',
   '2. A built-in skill that covers it (for example the Google Workspace skill for Gmail, Drive, Calendar, Sheets and Docs).',
   '3. The browser on your screen, where the person can watch and sign in themselves. Good for one-off jobs in a web console (setting something up, inviting someone, changing a setting).',
   'Only when those cannot do it, or the setup needs an app or admin access the person does not have, suggest Composio. Say plainly: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only after the person agrees.',
   'Choosing where it runs: a one-off job can be done in the browser now. Anything that must keep running (schedules, automatic replies, regular reports) needs a tool or skill on this server, so set that up instead of relying on the browser.',
   'Which browser: before your first browser step in a chat, call choose_browser (from aqeelos-notify) with the task and your suggestion: "yours" (the person\'s own Chrome, where they are already signed in) for one-off jobs in web consoles, "server" (your screen on the AI box) for anything scheduled, long-running or done while they are away. Follow their answer for the rest of that chat.',
   ...connectLines(notConnected(cfgA,n=>connTok.has(n))),
   '','## Connecting an MCP tool that needs a sign-in','',
   'Never use manage_connections (authorize/install/enable) or “hermes mcp login” for MCP tools, and never a 127.0.0.1 / localhost callback: the person is not at this server, so that page never opens for them. Add the tool (with its client ID/secret if the service needs its own app), then call the connect_mcp_tool tool (from aqeelos-notify) and send the person its steps exactly as written. Never make up steps, addresses or commands for connecting: the people using this are often not technical, so keep it to what the tool says. When the tool recommends Composio, offer that first. aqeelOS sets the return address itself: '+PUBLIC_URL+'/mcp-oauth/api/mcp/oauth/callback/<tool name> (this is what goes in the service’s Redirect URLs).',
   '','## Logins that act as the person','',
   'When you create a login that acts as the person (their own Google account, a Slack or Notion sign-in as them, their personal Telegram account, anything where what you do goes out under their name), call register_account (from aqeelos-notify) right after, with what it is, what they agreed you may do (read, draft, send) and where the credential is stored. Bots and services (n8n, Composio, API keys) are not this. The owner sees these under Abilities › Connections and can pause or disconnect them; a paused account says so when you use it: then stop and tell the person.',
   ...(gacc.length?['','## Your Google accounts','',
    'The person named these and said what each is for. When they mention one by its name ("from my work account") or the job fits its note, use that account with the Google Workspace skill; when it is unclear which one, ask.',...gacc]:[]),
   '','## Your instructions','',
   'Your standing instructions are your SOUL. When the person who owns you gives you a new rule, limit, target or correction, change it with change_instructions (from aqeelos-notify): edit the rule where it is written, so each rule is said once. Never append an "override" section, never edit SOUL.md directly, and never keep rules, caps or limits in memory or in a separate decisions file: aqeelOS keeps the history of your instructions with who decided what and when, and that is the one place for decisions. Run reports and logs go to your log channel, not into your instructions.',
   '','## Keep schedules tidy','',
   'Whenever you create or change a schedule, give it a clear title the person understands without opening it (no codes like "x3"), then call organize_schedule (from aqeelos-notify) with its id, the folder it belongs to (the client or project, for example a client name, Personal Finance or a product; reuse an existing folder when one fits) and one plain sentence on what it does and why. When asked to tidy up, move, rename or explain schedules, do the same for each one.',
   '','## Your other chats','',
   'Each chat (here, WhatsApp, Telegram, a schedule run) is its own conversation: you do not see the others, and your memory notes keep only what was saved. Before you say you don\'t know something the person says you did or discussed, and before you take back or "correct" something you said earlier, search your past chats with session_search and go by what they show. Never call something a guess without checking.',
   '','## Passwords, API keys and other secrets','',
   'Never ask the person to type a password, code or API key into the chat, and never ask them to type it on the screen viewer. Call ask_secret (from aqeelos-notify): mode "type" types it into the field you clicked on your screen, mode "save" stores it as a named key. The person can also send you one with the lock button; you then get its name. To enter a saved one, click the field and call type_secret with its name. You never see the values. When the person is talking to you anywhere but the aqeelOS app (Telegram, WhatsApp, Slack, any other channel, or a schedule run) and you need a password, code or key saved (they may call it the lock box link), call request_secret_link (from aqeelos-notify) instead and send them the link it gives: they open it on their phone and paste it there. It saves a new key; to log in somewhere with it afterwards, click the field and call type_secret with that name. Then call secret_link_status with wait true (or when they say it is saved) and carry on.',
   '','## Look it up first','',
   'Before you ask anyone a question (the team, the owner, a group), find the answer yourself from what you already have, in this order: your knowledge sheet and decisions/briefing files; your past chats (session_search)'+(await chatHistory.has(a).catch(()=>false)?'; your own line\'s past customer chats with past_chats (how our staff answered it before). A product or how-it-works question (how many per vial, how long it lasts, how to use it, where a link comes from) that your sheet does not answer MUST be searched with past_chats before you ask anyone: our staff have answered most of them already':'')+'; the API or docs of every service you hold a key or tool for (call it: a payment provider, a messaging API, a shop, n8n); your own workspace files. Only ask people for a real business decision (a price, a promise, a rule that does not exist yet) or what no source has. When you do ask, say in one line what you already checked and what you found, and ask one precise question.',
   '','## Reports and requests from your team','',
   'When the owner or a team member reports a problem or asks for something in your chat or topic, you handle it yourself in that same chat: never answer only "logged" or "noted", and never send them to another agent. 1) Look it up (above) and find the cause. 2) If it is in your own scope (your answers, knowledge sheet, decisions, instructions, your own tools and scripts in your workspace, your own schedules), change it, test it'+(await srEligible(a).catch(()=>false)?' (run_self re-runs you to check it)':'')+', and say what you changed and what the test showed. 3) If the cause is outside your own files (the sending code, aqeelOS, the engine, a tool server, another agent), file it with report_bottleneck system true, with evidence and a proposed fix: aqeelOS fixes it by itself, or asks the owner first when it touches other teams, keys, permissions, money or deleting data, and the answer comes back to this chat. Tell them in one line which of these happened. Nobody should need to message another agent about your problems.',
   '','## When something is broken outside your own files','',
   'If the cause of a problem is outside your own files and tools (the engine, aqeelOS, the sending code, a channel or bridge, another agent, a server), call report_bottleneck (from aqeelos-notify) with system true, evidence and proposed_fix. It becomes an issue that the aqeelOS fixer on this server fixes by itself and proves with the original check; nobody approves it and nobody needs to be messaged. my_issues shows where it is. Tell the person plainly that it is filed and not fixed yet. Never say "fixed", "logged" or "done" for something you have not checked works: say what you did, and what is still open.',
   ...(a!=='default'?['','## What you can do (checked from your real settings)','',...await versions.capabilities(a).catch(e=>['Could not be read just now ('+e.message+'); call my_health.'])]:[]),
   '','## Your team group','',...teamContext(await teamGroups.get(a).catch(()=>null)),
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
   const origin=why?await whyOf.app(a,s.name,s.url):null;if(why==='not signed in'&&origin?.by==='setup'){signinsDue.delete(key);continue}
   // which account it is (kept while the sign-in works), and the agent's other sign-ins to the same app, so a notice says WHICH Slack
   if(!why){await whyOf.learnAccount(a,s.name,s.url,tok).catch(()=>{});signinsDue.delete(key);continue}
   const host=u=>String(u||'').replace(/^https?:\/\//,'').split('/')[0],siblings=[];
   for(const o of list)if(o.name!==s.name&&host(o.url)&&host(o.url)===host(s.url))siblings.push({name:o.name,account:await whyOf.accountOf(a,o.name)});
   if(!signinsDue.has(key))console.log('sign-in needed:',s.name,'on',a,'('+why+')');signinsDue.set(key,{agent:a,agentName:NAMES[a]||a,name:s.name,why,origin,account:await whyOf.accountOf(a,s.name),siblings,...appInfo(s.name,s.url),last:(await stat(tok).catch(()=>null))?.mtimeMs||0})}}
 for(const k of [...signinsDue.keys()])if(!seen.has(k))signinsDue.delete(k);signinsAt=Date.now()}
// cheap: only looks at the token files (the full check above also tests each app, every 3 hours)
async function freshSignins(){for(const [k,x] of [...signinsDue]){const tok=path.join(x.agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',x.agent),'mcp-tokens',x.name+'.json');const st=await stat(tok).catch(()=>null);
  if(st&&st.size>2&&(x.why==='not signed in'||st.mtimeMs>(x.last||0)+1000))signinsDue.delete(k)}}
// every agent gets its own n8n user once n8n is connected (new agents within a few minutes); nothing happens before that
async function n8nForAll(){if(!await n8n.ready())return;for(const a of await listAgents()){if(await isTestAgent(a))continue;try{await n8n.ensure(a)}catch(e){console.warn('n8n for',a,e.message)}}}
if(LIVE_APP){setTimeout(()=>n8nForAll().catch(()=>{}),90000);setInterval(()=>n8nForAll().catch(()=>{}),600000).unref()}
// decided 20 Oct (ABIL-64): apps added to an agent but never signed in to use their owner's sign-in. Done once; apps whose
// owner isn't signed in either stay on the sign-in list.
async function useOwnerSigninsOnce(){const flag=path.join(DATA,'once-owner-signins.json');if(await stat(flag).catch(()=>null))return;const l=await access.list('mcp').catch(()=>null);if(!l)return;const done=[];
 for(const x of [...signinsDue.values()]){if(x.why!=='not signed in')continue;const it=l.items.find(y=>y.id===x.name);const own=it&&it.owner!==x.agent&&(it.users||[]).find(u2=>u2.id===it.owner&&u2.signed);if(!own)continue;
  try{await access.grant('mcp',x.name,x.agent);done.push(x.name+' for '+(NAMES[x.agent]||x.agent))}catch(e){console.warn('owner sign-in',x.name,x.agent+':',e.message)}}
 await writeFile(flag,JSON.stringify({at:Date.now(),done},null,1));await freshSignins();console.log('used owners’ sign-ins:',done.join(', ')||'none')}
if(LIVE_APP){setTimeout(()=>checkSignins().then(()=>useOwnerSigninsOnce()).catch(()=>{}),120000);setInterval(()=>checkSignins().catch(()=>{}),3*3600e3).unref()}
if(LIVE_APP){setTimeout(()=>writeAgentContext().catch(()=>{}),25000);setInterval(()=>writeAgentContext().catch(()=>{}),600000).unref()}
/* Slack: every agent with its own Slack bot answers in any channel it is invited to (private ones too) when a team
   member mentions it, except quiet channels: a name prefix set per Slack workspace (slack-quiet.mjs), e.g. ext- for client
   channels in one company's Slack. Other workspaces answer normally. Once per agent, a fixed channel list
   (SLACK_ALLOWED_CHANNELS) is swapped for that (kept as a comment); after that, quiet channels made later are added and
   ones no longer quiet are taken off. The agent restarts once nobody is mid-reply so it takes effect. */
const slackEnvOf=a=>path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env');
const slackBotTok=t=>(/^SLACK_BOT_TOKEN=(.+)$/m.exec(t)||[])[1]?.trim()||null;
async function slackTeamOf(tok){const j=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(15000)}).then(r=>r.json());return j.ok?{id:j.team_id,name:j.team||''}:null}
const slackQuiet=createSlackQuiet({DATA,
 teamsNow:async()=>{const out=[];for(const a of await listAgents()){const tok=slackBotTok(await readFile(slackEnvOf(a),'utf8').catch(()=>''));if(tok){const t=await slackTeamOf(tok).catch(()=>null);if(t)out.push(t)}}return out},
 legacy:async()=>{for(const a of await listAgents().catch(()=>[]))if(/kept up to date by aqeelOS/.test(await readFile(slackEnvOf(a),'utf8').catch(()=>'')))return 'ext-';return ''}});
async function slackClientChannels(){const st=await getStatus().catch(()=>({}));if((await slackQuiet.load()).pending)return;const was=await slackQuiet.was();for(const a of await listAgents()){try{
  const envF=slackEnvOf(a);const cur=await readFile(envF,'utf8').catch(()=>'');const tok=slackBotTok(cur);if(!tok)continue;
  const marked=/kept up to date by aqeelOS/.test(cur);if(!marked&&st[a]?.slackOpen)continue;   // switched back by hand later: left alone
  const team=await slackTeamOf(tok).catch(()=>null);if(!team)continue;const pre=await slackQuiet.prefixOf(team.id),oldPre=st[a]?.slackQuietPre??(marked?was:'');
  const have=new Set(((/^SLACK_IGNORED_CHANNELS=(.*)$/m.exec(cur)||[])[1]||'').split(',').map(x=>x.trim()).filter(Boolean));
  const r=await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=1000&exclude_archived=true',{headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(20000)}).then(x=>x.json());
  if(!r.ok)continue;const {add,remove,next}=slackQuietPlan({have,channels:r.channels||[],pre,oldPre});
  if(marked&&!add.length&&!remove.length){if(st[a]?.slackQuietPre!==pre)await setStatus(a,{slackQuietPre:pre});continue}
  if(remove.length)await copyFile(envF,envF+'.bak-slack-quiet-'+Date.now()).catch(()=>{});   // taking channels off the quiet list: the old file is kept
  await editEnv(envF,t=>{let s=t.replace(/^SLACK_ALLOWED_CHANNELS=.*$/m,m=>'# was (replaced by SLACK_IGNORED_CHANNELS on '+new Date().toISOString().slice(0,10)+'): '+m);
   if(/^SLACK_IGNORED_CHANNELS=/m.test(s))s=s.replace(/^SLACK_IGNORED_CHANNELS=.*$/m,'SLACK_IGNORED_CHANNELS='+next.join(','));else s=s.replace(/\n*$/,'\n')+'SLACK_IGNORED_CHANNELS='+next.join(',')+'\n';
   if(!/kept up to date by aqeelOS/.test(s))s=s.replace(/^SLACK_IGNORED_CHANNELS=/m,'# quiet channels (names starting with the prefix set for this Slack workspace under Channels): never answered, kept up to date by aqeelOS\nSLACK_IGNORED_CHANNELS=');return s});
  await setStatus(a,{...(marked?{}:{slackOpen:Date.now()}),slackQuietPre:pre});
  console.log('slack:',a,'in',team.name||team.id+':',add.length?'quiet now: '+add.length+' channel(s)':'',remove.length?'answering again: '+remove.length+' channel(s)':'',!marked?'answers in every channel it is invited to':'');
  restartGateway('Slack channel settings updated for '+a).catch(()=>{})}catch(e){console.warn('slack channels',a,e.message)}}}
if(LIVE_APP){setTimeout(()=>slackClientChannels(),60000).unref();setInterval(()=>slackClientChannels(),900000).unref()}
/* Dictation spells your names right: the speech model gets the names it should expect (agents, schedule folders,
   the app itself), kept up to date as they change. */
async function sttVocab(){try{const names=new Set(['aqeelOS']);for(const a of await listAgents())names.add(NAMES[a]||a);
  const meta=await readFile(path.join(DATA,'schedule-meta.json'),'utf8').then(JSON.parse).catch(()=>({jobs:{}}));for(const m of Object.values(meta.jobs||{}))if(m.folder&&m.folder!=='General')names.add(m.folder);
  const want='Names that may come up, '+[...names].filter(Boolean).join(', ')+'.';
  const cur=pick(await readConfig('default')||{},'stt.local.initial_prompt');if(cur===want)return;
  const r=await setKey('default','stt.local.initial_prompt',want);if(r.ok)console.log('dictation knows these names now:',[...names].join(', '))}catch(e){console.warn('dictation names',e.message)}}
if(LIVE_APP){setTimeout(()=>sttVocab(),90000).unref();setInterval(()=>sttVocab(),3600e3).unref()}
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
/* Lead agents and tiers (workstream F). Every person has a lead agent; its power is that person's role (users.mjs), checked
   here on every privileged call, never by the prompt: tier admin (owner, admins) = everything; tier member = itself and
   the agents its person owns. leadScope: may agent `me` do `part` on agent `t` through manage_agent? null = yes. */
function leadScope(me,t,part){me=String(me).split('--')[0];t=String(t).split('--')[0];if(users.tierOf(me)==='admin')return null;
 if(me===t)return part==='share'?'Changing who has access to an agent is for its person in aqeelOS (Edit agent › Sharing), not for an agent of a member.':null;
 if(!users.agentMayManage(me,t))return (NAMES[t]||t)+' belongs to someone else. You can only look after the agents your own person owns.';
 if(part==='share')return 'Changing sharing levels is for admins. Your person can share their agents in aqeelOS (Edit agent › Sharing).';return null}
// may this agent touch aqeelOS itself (its code, the web app, deploys, other people's agents, keys, permissions)? admins' agents only
const adminTier=a=>users.tierOf(String(a).split('--')[0])==='admin';
// the other way (Unlock): terminal, files, code and computer use back on for this agent, where its owner may have them
async function unlockTools(a){const c=await readConfig(a);if(!c)throw new Error('the settings could not be read');
 const cur=pick(c,'agent.disabled_toolsets')||[];const list=Array.isArray(cur)?cur.map(String):String(cur).split(',').map(x=>x.trim()).filter(Boolean);
 if(!UNSAFE_TOOLSETS.some(t=>list.includes(t)))return false;const r=await setKey(a,'agent.disabled_toolsets',list.filter(t=>!UNSAFE_TOOLSETS.includes(t)));if(!r.ok)throw new Error(r.err);return true}
const lockedAgent=(a,st)=>{if(st[a]?.safe)return true;const ow=users.agentOwner(a);if(!ow||ow==='owner')return false;const u=users.byId(ow);return !!u&&!users.can(u,'unsafe')};
/* Loop guard. Two agents on WhatsApp that may answer each other reply back and forth until WhatsApp logs both out
   (it happened once). So an extra agent never answers another agent's own WhatsApp number: such a number is taken
   off its allowed and approved lists. The main agent keeps its lists, so the owner can still message it from a
   phone that another agent (like Husband Mode) also runs on. */
async function waIds(a){const c=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session','creds.json'),'utf8').then(JSON.parse).catch(()=>null);
 return [c?.me?.id,c?.me?.lid].filter(Boolean).map(x=>String(x).split('@')[0].split(':')[0].replace(/\D/g,'')).filter(Boolean)}
/* One .env change at a time inside aqeelOS (1 Nov 2026): the WhatsApp loop guard and Who can message's removals both
   read, change and write an agent's lists; each also holds the engine's own .env lock while it writes (editEnv). */
const envQueues=new Map();
function envQueue(file,fn){const prev=envQueues.get(file)||Promise.resolve();const run=prev.then(fn,fn);const tail=run.catch(()=>{});envQueues.set(file,tail);tail.then(()=>{if(envQueues.get(file)===tail)envQueues.delete(file)});return run}
// an agent's WhatsApp lid-mapping files, read only as asked for (the main agent has over 2,000), in the folder the engine
// uses (gateway/whatsapp_identity.py, hermes_constants.get_hermes_dir: the old whatsapp/session when it has files, else
// platforms/whatsapp/session); one reader per request, remembering what it read
function waMapping(home){const old=path.join(home,'whatsapp','session');let dir;try{dir=readdirSync(old).length?old:null}catch{}dir||=path.join(home,'platforms','whatsapp','session');
 const seen=new Map();return n=>{if(!/^lid-mapping-[A-Za-z0-9@.+\-]+\.json$/.test(n))return null;if(!seen.has(n)){let t=null;try{t=readFileSync(path.join(dir,n),'utf8')}catch{}seen.set(n,t)}return seen.get(n)}}
// an agent's own pairing store folder (gateway/pairing.py: the old pairing/ when it has files, else platforms/pairing)
function pairingDir(home){const old=path.join(home,'pairing');try{if(readdirSync(old).length)return old}catch{}return path.join(home,'platforms','pairing')}
async function loopGuard(a,all){if(a.split('--')[0]==='default')return;const home=path.join(HERMES_HOME,'profiles',a);
 const others=new Set();for(const b of all)if(b!==a)for(const id of await waIds(b))others.add(id);if(!others.size)return;const removed=[];
 const envF=path.join(home,'.env');
  await envQueue(envF,()=>editEnv(envF,cur=>{let changed=false;const next=cur.split('\n').map(l=>{const m=/^(WHATSAPP_ALLOWED_USERS=)["']?([^"'\n]*)["']?$/.exec(l);if(!m)return l;
  const keep=m[2].split(',').map(x=>x.trim()).filter(x=>{const d=x.replace(/\D/g,'');if(d&&others.has(d)){removed.push(x);changed=true;return false}return !!x});return m[1]+keep.join(',')});return changed?next.join('\n'):null})).catch(()=>{});
 const apF=path.join(home,'platforms','pairing','whatsapp-approved.json');const ap=await readFile(apF,'utf8').then(JSON.parse).catch(()=>null);
 if(ap&&typeof ap==='object'){let ch=false;for(const k of Object.keys(ap))if(others.has(k.replace(/\D/g,''))){delete ap[k];removed.push(k);ch=true}
  if(ch){await writeFile(apF+'.tmp',JSON.stringify(ap));await rename(apF+'.tmp',apF)}}
 if(removed.length){platCache.delete(a);console.log('loop guard:',a,'no longer answers other agents\' WhatsApp numbers:',removed.join(', '))}}
async function agentHealth(only){const h={'x-hermes-session-token':DASH_TOKEN};const st=await getStatus();await users.load();
 for(const a of only?[only]:await listAllProfiles()){try{
  if(!await isAgent(a)||(LIVE_APP&&!only&&await isTestAgent(a)))continue;const copy=a.includes('--');
  // a failing setup is tried again every 15 minutes (a plugin enable is slow and builds an engine environment)
  if(a!=='default'&&!copy&&setupAgentFn){const s=st[a];if(only||!s||Date.now()-(s.t||0)>(s.ok?24*60:15)*60e3)await setupAgentFn(a).catch(e=>console.warn('setup',a,e.message))}
  if(copy&&API_KEY){const envF=path.join(HERMES_HOME,'profiles',a,'.env');
   if(await editEnv(envF,cur=>/^API_SERVER_KEY=/m.test(cur)?null:cur+(cur&&!cur.endsWith('\n')?'\n':'')+'API_SERVER_KEY='+API_KEY+'\n').catch(()=>false))console.log('health',a,'added the gateway key')}
  if(!copy){await ensureChatHint(a).catch(async e=>{if(await isAgent(a))console.warn('chat hint',a,e.message)});await screens.ensure(a).catch(()=>{})}
  if(a!=='default')await loopGuard(a,await listAllProfiles()).catch(e=>console.warn('loop guard',a,e.message));
  // a copy (agent--2) is locked with its agent: the same tools stay off on it
  if(a.split('--')[0]!=='default'&&lockedAgent(a.split('--')[0],st))await lockTools(a).catch(e=>console.warn('lock tools',a,e.message));
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
let gwStopped=false,gwRestarting=null,gwMissing=0,sshLock=Promise.resolve(),restoreBusy=()=>false;   // restoreBusy: backups.busy() once it exists (a restore copies the agents' files)   // sshLock: authorized_keys changes, one at a time
// Thinking survives a refresh: the engine keeps no thinking text for some models (only a sealed signature), so when
// a reply streamed through aqeelOS ends, the thinking it showed is saved per chat and shown again when it is reopened.
async function saveThinking(key,rec){try{const sid=key.split('|').slice(1).join('|');if(!/^[\w.-]{3,120}$/.test(sid))return;
 let user='',think='';
 for(const ev of Buffer.concat(rec.chunks).toString('utf8').split('\n\n')){const name=(/^event: *(.+)$/m.exec(ev)||[])[1];const dl=ev.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).join('');if(!dl)continue;let e;try{e=JSON.parse(dl)}catch{continue}const ty=e.type||name;
  if(ty==='run.started'){const c=e.user_message?.content;user=typeof c==='string'?c:Array.isArray(c)?c.map(x=>x.text||'').join(''):''}
  if(ty==='reasoning.delta'||ty==='assistant.reasoning'||(ty==='tool.progress'&&e.tool_name==='_thinking')){const d=e.delta||e.text||'';if(d)think+=d}}
 if(!think.trim()||!user)return;const f=path.join(DATA,'thinking',sid+'.json');const l=await readFile(f,'utf8').then(JSON.parse).catch(()=>[]);
 l.push({u:user.slice(0,300),think:think.slice(0,20000),by:rec.user,t:Date.now()});await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify(l.slice(-200)))}catch(e){console.warn('save thinking',e.message)}}
const liveCount=()=>[...LIVE.values()].filter(r=>!r.done).length;
/* Agents the engine itself has mid-turn (a long task, a job from WhatsApp or a schedule, not only replies aqeelOS proxies).
   Read from the same /api/status the watchdog uses; kept 4 s so loops don't hammer it; 0 when the engine does not answer,
   so a restart is never blocked by an engine that is down. The engine's own restart drain is off (restart_drain_timeout 0). */
let engAgents={t:0,n:0};
async function engineAgents(){if(Date.now()-engAgents.t<4000)return engAgents.n;let n=0;
 try{const r=await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(5000)});n=Number((await r.json()).active_agents)||0}catch{}
 engAgents={t:Date.now(),n};return n}
const waitingNow=async()=>Math.max(liveCount(),await engineAgents());
const shx=async(c,ms=150000)=>{const {execFile}=await import('node:child_process');return new Promise(r=>execFile('bash',['-c',c],{timeout:ms,env:{...process.env,PATH:homedir()+'/.local/bin:'+process.env.PATH}},(e,o)=>r({ok:!e,out:String(o||'')})))};
async function gatewayPid(){const t=await readFile(path.join(HERMES_HOME,'gateway.pid'),'utf8').catch(()=>'');const pid=Number((/\d+/.exec(t)||[])[0]);if(!pid)return 0;try{process.kill(pid,0);return pid}catch{return 0}}
// Every engine restart is noted (ours with the reason, and ones the engine does by itself), so the bell's list can say why
// Slack or WhatsApp dropped for a moment instead of it being a mystery.
let sysEvents=[],lastGwPid=0,lastOwnRestart=0;
function noteSys(kind,why){if(kind==='restart-failed')bottlenecks.event('down','The agents kept stopping and were left off',String(why||''),{topic:'engine-off'}).catch(()=>{});else if(kind==='restart')bottlenecks.resolve('engine-off').catch(()=>{});sysEvents.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),t:Date.now(),kind,why:String(why||'').slice(0,160)});sysEvents=sysEvents.slice(-50)}
let autoRestarts=[],gwRun=null,gwAgain=null;
/* A request while a restart runs: before that restart has stopped the engine it is simply part of it (its bridges:true is
   merged in); after, one more pass is queued (all such requests share it), so a change saved meanwhile is not lost. */
let heldRestart=null;
// A request that comes before the new engine starts is covered by that start (it reads every setting then): no
// second restart a minute later (7 Nov 2026: 01:05 and 01:06 UTC). Only a WhatsApp bridge stop already done needs a pass.
function restartGateway(why,{wait=true,waitMax=360,auto=false,bridges=false,restore=false}={}){
 // aqeelos:restart-hold: while a long build runs (DATA/restart-hold.json {until,why}), automatic engine restarts wait.
 // The build removes the file and restarts once at the end. An expired hold is ignored, so it can never block for good.
 try{const h=JSON.parse(readFileSync(path.join(DATA,'restart-hold.json'),'utf8'));if(holdActive(h)){heldRestart=why;console.log('engine restart held ('+(h.why||'build running')+'):',why);return Promise.resolve()}}catch{}
 // never during a restore: every caller (Restart, Start, a hook or channel change, the watches) waits for its end, and the
 // restore starts the agents itself when it is done (busy.mjs)
 if(!mayStartAgents({restoring:restoreBusy(),forRestore:restore})){console.log('gateway restart left for after the restore:',why);return Promise.resolve()}
 if(gwRestarting){if(!gwRun.started&&!(bridges&&gwRun.bridgesDone)){gwRun.bridges||=bridges;return gwRestarting}
  gwAgain={why:gwAgain?.why||why,bridges:!!(gwAgain?.bridges||bridges)};return gwRestarting.then(()=>{if(!gwAgain)return gwRestarting||undefined;const a=gwAgain;gwAgain=null;return restartGateway(a.why,{bridges:a.bridges})})}if(auto){autoRestarts=autoRestarts.filter(t=>Date.now()-t<30*60e3);if(autoRestarts.length>=3){if(Date.now()-(globalThis.__rf||0)>30*60e3){globalThis.__rf=Date.now();noteSys('restart-failed','The engine kept stopping, so it was left off. Open System › Host and press Start.')}return Promise.resolve()}autoRestarts.push(Date.now())}if(!LIVE_APP){console.log('gateway restart skipped (test copy):',why);return Promise.resolve()}
 const run=gwRun={bridges,stopping:false};gwRestarting=(async()=>{if(wait){let said=false;for(let i=0;i<waitMax&&(liveCount()>0||await engineAgents()>0);i++){if(!said&&i===12){said=true;console.log('gateway restart: still waiting for',Math.max(liveCount(),engAgents.n),'agent(s) at work:',why);
   // no new scheduled runs meanwhile (engine fix aqeelos:hold-cron-for-restart), so the agents at work finish and none start: the quiet moment comes
   await writeFile(path.join(HERMES_HOME,'aqeelos-hold-cron'),JSON.stringify({why,at:Date.now()})).catch(()=>{})}await new Promise(r=>setTimeout(r,5000))}
   await unlink(path.join(HERMES_HOME,'aqeelos-hold-cron')).catch(()=>{})}
  console.log('gateway restart:',why);gwStopped=false;lastOwnRestart=Date.now();noteSys('restart',why);run.stopping=true;
  // --yes: the engine refuses to stop while chats are live, and then nothing restarted at all (5 Nov 2026: a gateway the
  // engine started kept running without a Claude login for an hour); the wait above already gave them their time
  // the engine needs 30 to 45 s to shut down cleanly; it is waited for before its window closes (gateway-stop.mjs)
  {const t0=Date.now(),st=await shx(stopGatewayCmd(),stopTimeoutMs());console.log('gateway restart: engine stopped after',Math.round((Date.now()-t0)/1000)+' s'+(/FORCED/.test(st.out)?' (it did not stop by itself in time and was closed)':' (clean)'))}
  // a WhatsApp bridge is its own process and reads its settings only when it starts: when channel settings changed, stop them so the engine starts fresh ones
  if(run.bridges)for(const a of await listAllProfiles().catch(()=>[]))await stopBridges(a).catch(()=>{});
  run.bridgesDone=true;run.started=true;later.covered().catch(()=>{});await shx('~/services.sh >/dev/null 2>&1');
  platCache.clear();hapiStatus.drop();hapiLists.drop();guardAfterRestart(Date.now())})().finally(()=>{gwRestarting=null});return gwRestarting}
// restarts that can wait go to the quiet hours (restart-later.mjs); an immediate one covers them
const later=createRestartLater({DATA,restart:why=>restartGateway(why),tz:()=>installTz()||process.env.TZ||''});
const restartLater=why=>later.add(why).catch(e=>console.warn('restart later',e.message));
if(LIVE_APP)setInterval(()=>later.tick().catch(e=>console.warn('quiet-hours restart',e.message)),5*60e3).unref();
// a minute after aqeelOS restarted the engine, every tool server is checked and fixed (automation-guard.mjs); an engine
// update runs its own check after its restarts
let guardT=null;function guardAfterRestart(since){if(!LIVE_APP)return;clearTimeout(guardT);guardT=setTimeout(()=>{if(engineUpd.busy())return;guard.fullCheck({repair:true,since,why:'checked after an engine restart'}).then(r=>{if(r.problems.length||r.fixed.length)console.log('automations after restart: fixed',r.fixed.join(', ')||'nothing','· still wrong:',r.problems.join('; ')||'nothing')}).catch(e=>console.warn('automations after restart',e.message))},60000);guardT.unref?.()}
async function gatewayWatch(){if(gwStopped||gwRestarting)return;
 const pid=await gatewayPid();const inTmux=(await shx('tmux has-session -t gateway')).ok;
 if(pid&&lastGwPid&&pid!==lastGwPid&&Date.now()-lastOwnRestart>180000)noteSys('restart-self','');if(pid)lastGwPid=pid;
 // nothing running at all, twice in a row (so an engine restart in progress is not cut off): start it
 if(!pid&&!inTmux){if(++gwMissing<2)return;gwMissing=0;console.warn('gateway watch: no gateway was running');return restartGateway('no gateway was running',{wait:false,auto:true})}
 gwMissing=0;if(inTmux||!pid)return;
 // an engine a chat run started while the engine was down (audit, 5 Nov 2026): with the tools' home (~/.hermes/home)
 // it has no Claude login and every agent falls back to another model; it is replaced at once (replies at work get 2 minutes)
 const gwHome=(await readFile('/proc/'+pid+'/environ','latin1').catch(()=>'')).split('\0').find(x=>x.startsWith('HOME='))?.slice(5);
 if(gwHome&&path.resolve(gwHome)!==path.resolve(homedir())){console.warn('gateway watch: the running engine has the home',gwHome,'(no Claude login there); restarting it properly');return restartGateway('an engine was started with the wrong home folder (no Claude login there)',{auto:true,waitMax:24})}
 const up=Number((await shx('ps -o etimes= -p '+pid)).out.trim())||0;const since=Date.now()-up*1000;
 const log=(await shx('tail -400 ~/.hermes/logs/agent.log')).out.split('\n').filter(l=>/ClaudeCodeLoggedOut|no usable login/.test(l));
 const bad=log.some(l=>{const t=Date.parse(l.slice(0,19).replace(' ','T')+'Z');return t&&t>since+5000&&Date.now()-t<10*60e3});
 if(bad){console.warn('gateway watch: the gateway the engine started cannot reach Claude; restarting it properly');return restartGateway('gateway outside its session cannot reach Claude',{auto:true})}}
if(LIVE_APP){setInterval(()=>gatewayWatch().catch(()=>{}),60000).unref()}
/* After an engine update (from the app or by itself), the renames are applied again and, once nothing is in
   progress, the engine restarts once so people see aqeelOS again in channel messages, prompts and errors. */
const engineHead={v:null,t:0};
async function engineWatch(){if(engineUpd.busy())return;   // an update aqeelOS runs or follows (engine-updates.mjs) applies them itself, then checks the engine
 const r=await shx('git -C ~/.hermes/hermes-agent rev-parse HEAD 2>/dev/null');const h=String(r.out||'').trim();if(!/^[0-9a-f]{40}$/.test(h))return;
 const clean=(await shx('git -C ~/.hermes/hermes-agent diff --quiet && echo clean')).out.trim()==='clean';
 if(engineHead.v===null){engineHead.v=h;if(!clean)return}else if(h===engineHead.v&&!clean)return;if(h===engineHead.v)return;console.log('engine updated to',h.slice(0,8),'- applying aqeelOS patches again');
 const n=await enginePatches();if(n)restartGateway('engine updated: aqeelOS wording applied again').catch(()=>{})}
// the patch step on its own: the version it was applied to is noted, so the watch above does not apply it a second time
async function enginePatches(){const h=String((await shx('git -C ~/.hermes/hermes-agent rev-parse HEAD 2>/dev/null')).out||'').trim();if(/^[0-9a-f]{40}$/.test(h))engineHead.v=h;
 const {execFile}=await import('node:child_process');const out=await new Promise(res=>execFile(process.execPath,[path.join(root,'scripts','apply-skill-patches.mjs')],{timeout:600000,maxBuffer:8e6},(e,o)=>res(String(o||''))));
 const n=Number((/(\d+) change\(s\)/.exec(out)||[])[1]||0);console.log('engine patches after update:',n,'change(s)');return n}
// an engine update starts from the engine's own files (see /hapi/hermes/update)
async function engineReset(){const r=await shx('git -C ~/.hermes/hermes-agent checkout -- . 2>&1');console.log('engine update: renamed files reset first',r.ok?'':'('+String(r.out||'').slice(0,120)+')');engineHead.v=null}
if(LIVE_APP){setInterval(()=>engineWatch().catch(()=>{}),5*60000).unref();setTimeout(()=>engineWatch().catch(()=>{}),20000).unref()}
// tabs agents left open: closed after 3 idle hours, every hour (app/browser-tidy.mjs)
{const {createBrowserTidy}=await import('./browser-tidy.mjs');
 const tidy=createBrowserTidy({lastActive:async a=>{const r=await fetch(DASH.origin+'/api/sessions?limit=5&profile='+encodeURIComponent(a),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)});if(!r.ok)return null;
   const l=(await r.json())?.sessions||[];return l.length?Math.max(...l.map(x=>Math.max(Number(x.last_active)||0,Number(x.started_at)||0)))*1000:0}});
 // every 15 minutes: an agent's extra tabs go once it has been quiet 10 minutes, so a busy agent gets a chance often enough
if(LIVE_APP){setInterval(()=>tidy.tick().catch(e=>console.warn('browser tidy',e.message)),15*60e3).unref();setTimeout(()=>tidy.tick().catch(()=>{}),10*60e3).unref()}}
/* Memory guard. The AI box has a fixed memory limit; when it runs full, the engine or the dashboard is killed.
   Every 2 minutes: above 80% the bell's list says so (once an hour); above 90%, with no reply, schedule, setup or relay in
   progress, the AdsPower browsers are closed (AdsPower itself stays open and a browser reopens when an agent needs it).
   The Host page shows the numbers in plain words. */
async function memNow(){const n=async f=>Number((await readFile(f,'utf8').catch(()=>'')).trim())||0;
 const cur=await n('/sys/fs/cgroup/memory.current'),max=await n('/sys/fs/cgroup/memory.max');if(cur&&max){const st=await readFile('/sys/fs/cgroup/memory.stat','utf8').catch(()=>'');const cache=Number((/^inactive_file (\d+)/m.exec(st)||[])[1]||0);return {used:Math.max(0,cur-cache),max}}
 const m=await readFile('/proc/meminfo','utf8').catch(()=>'');const kb=k=>Number((new RegExp('^'+k+':\\s+(\\d+)','m').exec(m)||[])[1]||0)*1024;return {used:kb('MemTotal')-kb('MemAvailable'),max:kb('MemTotal')}}
let memWarned=0,memActed=0;
async function memGuard(){const {used,max}=await memNow();if(!max)return;const pct=used/max;
 if(pct>0.8&&Date.now()-memWarned>3600e3){memWarned=Date.now();noteSys('memory',Math.round(pct*100)+'% of RAM in use ('+(used/1e9).toFixed(1)+' of '+(max/1e9).toFixed(1)+' GB)')}
 if(pct<=0.9||Date.now()-memActed<30*60e3)return;const eng=await fetch(DASH.origin+'/api/status',{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);if(!eng||Number(eng.active_sessions||0)>0)return;if(liveCount()>0||opsBusy()>0||relay.sending()>0||export_setups.running()>0||gwRestarting)return;
 const key=((await readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'')).match(/^ADSPOWER_API_KEY=["']?([^"'\n]+)/m)||[])[1]||'';const h=key?{authorization:'Bearer '+key}:{};
 const act=await fetch('http://127.0.0.1:50325/api/v1/browser/local-active',{headers:h,signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);const list=act?.data?.list||[];let n=0;
 for(const b of list){const id=b.user_id||b.profile_id;if(!id)continue;const r=await fetch('http://127.0.0.1:50325/api/v1/browser/stop?user_id='+encodeURIComponent(id),{headers:h,signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);if(r?.code===0)n++}
 if(n)memActed=Date.now();if(n){console.warn('memory guard: memory at',Math.round(pct*100)+'%, closed',n,'AdsPower browser(s)');noteSys('memory-freed','RAM was almost full, so '+n+' AdsPower browser'+(n>1?'s were':' was')+' closed. They reopen when an agent needs them.')}}
if(LIVE_APP)setInterval(()=>memGuard().catch(e=>console.warn('memory guard',e.message)),120000).unref();
// the dashboard (settings, channels, sign-ins, dictation) can be killed when the box runs out of memory: if it does
// not answer twice in a row, it is started again (in its managed session, like the engine)
let dashMissing=0,dashRestarted=0,dashTries=0,dashStopped=false;   // dashStopped: a restore stopped it on purpose
if(LIVE_APP)setInterval(async()=>{if(dashStopped)return;const ok=await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(8000)}).then(r=>r.status<500,()=>false);
 if(ok){dashMissing=0;dashTries=0;return}if(Date.now()-dashRestarted<Math.min(60,5*2**dashTries)*60e3)return;if(++dashMissing<2)return;dashMissing=0;dashRestarted=Date.now();dashTries++;console.warn('dashboard watch: the dashboard stopped answering; starting it again');
 await shx('tmux kill-session -t dashboard 2>/dev/null; ~/services.sh >/dev/null 2>&1')},60000).unref();
// only the live app (isLive, install.mjs) sets agents' tools; a test copy on another port must not repoint them
if(LIVE_APP){setTimeout(()=>agentHealth().catch(()=>{}),30000);setInterval(()=>agentHealth().catch(()=>{}),300000).unref()}
if(LIVE_APP){setTimeout(()=>syncNotifyTool().catch(e=>console.warn('notify tool',e.message)),20000);setInterval(()=>syncNotifyTool().catch(()=>{}),600000).unref()}
// old engine environments (each plugin enable builds one, ~400 MB): the engine's own cleanup once a day; it keeps the one in use, any still held, and any less than a day old
if(LIVE_APP){const gc=()=>shx('timeout 900 hermes pm gc >/dev/null 2>&1').catch(()=>{});setTimeout(gc,30*60e3).unref();setInterval(gc,24*3600e3).unref()}
// leftovers of deleted agents: a folder with only logs/ (a command still ran during the delete) is removed
const sweepGhosts=async()=>{for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[])){if(!d.isDirectory()||d.name.startsWith('.'))continue;
 const dir=path.join(HERMES_HOME,'profiles',d.name);if(await isAgent(d.name))continue;const st=await stat(dir).catch(()=>null);const inside=await readdir(dir).catch(()=>['?']);
 if(st&&Date.now()-st.mtimeMs>10*60e3&&inside.every(x=>['logs','plugin-update-checks','cache','sandboxes','plugins'].includes(x))){const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true}).catch(()=>{});console.log('removed the leftover folder of deleted agent',d.name)}}};
if(LIVE_APP){setTimeout(()=>sweepGhosts().catch(()=>{}),40000);setInterval(()=>sweepGhosts().catch(()=>{}),30*60e3).unref()}
const sharing=createShare({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAgents()});
// every sign-in-page app any agent has, on every agent, not signed in (connectors.mjs): each signs in its own or the owner shares
/* AdsPower and Composio per agent (agent-optins.mjs, 7 Nov 2026): off unless switched on in Edit agent › Abilities; the first
   start keeps each only for agents that ran its tools in the last 14 days. Copies follow their agent. */
const optins=createOptins({DATA,HERMES_HOME,listAgents:()=>agentNames({copies:true}),readConfig,python:enginePython,live:LIVE_APP,
 note:(t,d)=>bottlenecks.event('abilities',t,d,{info:true}),log:m=>console.log(m)});
// Composio entries of agents switched off for it go (through the engine's MCP route, so the running engine follows)
// sign-in app entries an agent has switched off go (Composio by its own switch, every other sign-in app by its name), through
// the engine's MCP route so the running engine follows; one pass for every agent, then nothing more to remove
const keepNewApp=async(a,n)=>{if(await optins.appOffOnPurpose(a,n))return false;if(a.split('--')[0]==='default')return true;
 const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);return !!await stat(path.join(home,'mcp-tokens',n+'.json')).catch(()=>null)};
async function composioOff(only){for(const a of await agentNames({copies:true})){if(only&&a.split('--')[0]!==only)continue;
 const c=await readConfig(a).catch(()=>null)||{};for(const [n,e] of Object.entries(c.mcp_servers||{})){if(!e)continue;
  const comp=COMPOSIO_URL.test(String(e.url||''));if(comp?await optins.on('composio',a):!isConnectorEntry(e)||await optins.appOn(a,n))continue;
  // a sign-in app added after the first count (7 Nov 2026: Higgsfield) stays where it is wanted: on the main agent (the
  // owner's own), or on an agent that signed in to it itself; never one switched off on purpose. Elsewhere it goes, so no
  // agent nags for a sign-in it never asked for.
  if(!comp&&await keepNewApp(a,n)){await optins.setApp(a,n,true).catch(()=>{});console.log('abilities: '+n+' kept on '+a+' (main agent or signed in)');continue}
  await withAgent(a,()=>fetch(DASH.origin+'/api/mcp/servers/'+encodeURIComponent(n)+'?profile='+encodeURIComponent(a),{method:'DELETE',headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(60000)}))
   .then(r=>console.log('abilities: '+n+' removed from '+a+(r.ok?'':' failed: '+r.status)),er=>console.warn('abilities: '+n+' '+a+': '+er.message))}}}
// its own reports about sign-ins for apps that are now off for it are solved: closed with a note (7 Nov 2026)
async function closeSolvedSignins(){const l=(await issues.list().catch(()=>({items:[]}))).items||[];
 const stillOn=async(a,w)=>{if(w==='composio'||w==='rube')return optins.on('composio',a);if(w==='*'&&await optins.on('composio',a))return true;const c=await readConfig(a).catch(()=>null)||{};for(const n of appNames(c))if((w==='*'||n.toLowerCase().includes(w))&&await optins.appOn(a,n))return true;return false};
 for(const id of await solvedIssues(l,stillOn)){await issues.close(id,'aqeelOS: the app is switched off for this agent, so no sign-in is needed').catch(()=>{});console.log('abilities: closed solved sign-in issue',id)}}
// the sign-in apps an agent can switch: its own, and every one in the catalog (one per address) it could get
async function knownApps(a){const own=appNames(await readConfig(a).catch(()=>null)||{});let cat=[];try{cat=(await connectors.plan()).catalog.map(x=>x.name).filter(n=>!/composio/i.test(n))}catch{}return [...new Set([...own,...cat])].sort()}
const connectors=createConnectors({listAgents:()=>listAgents(),readConfig,setKey,allow:async(a,e,n)=>COMPOSIO_URL.test(String(e?.url||''))?await optins.on('composio',a):await optins.appOn(a,n),redirect:n=>MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(n),
 hasEnv:async(a,v)=>new RegExp('^'+v.replace(/[^\w]/g,'')+'=.+','m').test(await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env'),'utf8').catch(()=>'')),
 noteApp:(a,n,r)=>whyOf.noteApp(a,n,r),origin:(a,n,u)=>whyOf.app(a,n,u),eligible:async(a,c)=>!await isTestAgent(a)&&!!c?.mcp_servers?.['aqeelos-notify'],log:(...x)=>console.log(...x)});
if(LIVE_APP){setTimeout(()=>optins.migrate().then(async r=>{const ra=await optins.migrateApps().catch(e=>{console.warn('abilities: sign-in apps count',e.message);return null});if(r||ra)composioOff().then(()=>closeSolvedSignins()).catch(()=>{});if(r){agentAds.tick().catch(()=>{});agentAds.tools().catch(()=>{})}}).catch(e=>console.warn('abilities: first-start count',e.message)),60000).unref()}
if(LIVE_APP){const run=()=>composioOff().catch(()=>{}).then(()=>closeSolvedSignins()).catch(()=>{}).then(()=>connectors.ensureAll()).then(r=>{if(r.changed)console.log('connectors added (apply at the next agent restart):',r.added.join(', '))}).catch(e=>console.warn('connectors',e.message));setTimeout(run,100000);setInterval(run,600000).unref()}
const channels=createChannels({DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,listAgents:()=>listAllProfiles(),cached:a=>platformsCached(a),restart:why=>restartGateway(why),paused:()=>pausedLoad(),pendingOf:(a,id)=>id==='whatsapp'?waSettingsPending(a):false,stop:a=>stopBridges(a),
 // after a move: a pause, the sharing, schedules relayed through it and its note follow the channel to its new agent
 moved:async(pf,from,to)=>{const ps=await pausedLoad();if(ps[from+'|'+pf]||ps[to+'|'+pf]){delete ps[from+'|'+pf];delete ps[to+'|'+pf];await pausedSave(ps)}
  if(await relay.moveOwner(from,to,pf).catch(()=>false))syncNotifyTool().catch(()=>{});
  const nf=path.join(DATA,'channel-notes.json'),notes=await readFile(nf,'utf8').then(JSON.parse).catch(()=>null);if(notes?.[from+'|'+pf]){notes[to+'|'+pf]=notes[from+'|'+pf];delete notes[from+'|'+pf];await writeJsonAtomic(nf,notes)}
  platCache.clear();attention.t=0},
 notify:(title,detail)=>bottlenecks.event('channel',title,detail).catch(()=>{})});
// shared Google logins as short-lived limited keys (google-shares.mjs); the level is the agent's in Connections
// an agent locked to its own Google files (google-files.mjs) holds no key; aqeelOS calls Google for it, signed per agent
const gfLevel=async(email,agent)=>{const l=await connAccounts.levelFor?.(email,agent).catch(()=>null);return l||'edit'};
const googleFiles=createGoogleFiles({HERMES_HOME,WORK:path.join(homedir(),'workspaces'),PORT,sig:a=>sign('google-files:'+a).slice(0,32),levelOf:gfLevel,token:(email,level)=>googleShares.keyFor(email,level)});
const googleShares=createGoogleShares({HERMES_HOME,DATA,WORK:path.join(homedir(),'workspaces'),agents:()=>agentNames(),levelOf:gfLevel,held:a=>googleFiles.locked(a)});
if(LIVE_APP){const t=()=>googleFiles.ensureClients().catch(e=>console.warn('google files',e.message));setTimeout(t,30e3).unref();setInterval(t,5*60e3).unref()}
if(LIVE_APP){const t=()=>googleShares.renew().then(r=>{if(r.renewed||r.removed)console.log('google shares: renewed',r.renewed,'removed',r.removed)}).catch(e=>console.warn('google shares',e.message));setInterval(t,5*60e3).unref();setTimeout(t,60e3).unref()}
const access=createAccess({googleShares,HERMES_HOME,DATA,listAgents:()=>listAgents(),readConfig,setKey,hermes:hcmd,editEnv,names:a=>agentName(a),writeJson:(f,v)=>writeJsonAtomic(f,v),restart:why=>restartGateway(why).catch(()=>{}),
 own:{n8n:{owner:'aqeelOS',note:'every agent has its own n8n user',grant:a=>n8n.ensure(a)}},
 dash:(method,p)=>fetch(DASH.origin+p,{method,headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(r=>r.json().catch(()=>({})))});
const accessAsk=createAccessRequests({DATA,access,listAgents:()=>listAgents(),names:a=>agentName(a)});
const n8n=createN8n({BASE:N8N_URL,readConfig,removeMcp:(a,name)=>fetch(DASH.origin+'/api/mcp/servers/'+encodeURIComponent(name)+'?profile='+encodeURIComponent(a),{method:'DELETE',headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok&&r.status!==404)throw new Error('Could not remove the tool ('+r.status+')');return true}),DATA,setKey,restart:why=>{if(/^n8n connected for /.test(why)&&testAgentShown(why))return;restartLater(why)},names:a=>NAMES[a]||a});
const code=createCode({DATA,SRC:path.join(homedir(),'apps','aqeel-code'),PUBLIC_URL,ROOT:root});
// team folders (Plan 4): Code project folders shared with team members, one bare git repo each, served only through here
const teamFolders=createTeamFolders({DATA,names:uid=>{const x=users.byId(uid);return x?.name||x?.username||'Someone'},known:uid=>{const x=users.byId(uid);return !!x&&!x.disabled}});
const codeAgents=createCodeAgents({HERMES_HOME,DATA,sign,readIds,outboxAccess:(a,d)=>agentDefaults.outboxAccess(a,d)});
// every aqeelOS model for Code projects on a person's computer: the engine reaches the project through this bridge only
const codeBridge=createCodeBridge({PORT,DATA,sign,code,mayUse:(uid,a)=>{const w=users.byId(uid);return !!w&&!users.gate(w,'/gapi/api/model/options','GET',new URLSearchParams(),a)},workspaces:a=>path.join(homedir(),'workspaces',a),access:(a,d)=>agentDefaults.outboxAccess(a,d)});
/* A Code run asks one of its attached agents (aqeelos_ask in Code, code_ask_agent on the engine): one chat turn for
   that agent, as the person who sent the run (their daily limit and the models they may use, as in Chat), with a
   folder of its own to save files in. The answer's text and files come back; where the files go is the caller's. */
async function codeAsk(who,a,task,{project='',plan=false}={}){const pre=a!=='default'?'/p/'+encodeURIComponent(a):'';
 let model='default';if(!users.isAdmin(who)){const lim=users.limitOf(who);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),who.id,users.ownerOf);if(t.tokens+await code.usedToday(who.id)>=lim.tokens)throw Object.assign(Error('You reached today\'s limit. It resets at midnight.'),{status:429})}
  const allowed=users.allowedModels(who);if(allowed){const d=await agentModel(a);if(!users.modelOk(who,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');model=m.length?m.join('|'):pv}}}
 const box=await codeAgents.outbox(a).catch(()=>'');
 const note='(Asked from aqeelOS Code by '+(who.name||who.id)+(project?', project '+String(project).slice(0,80):'')+'. Do it with your own tools and reply with exactly what was asked for. You cannot change the Code project yourself.'+(box?' If the answer includes files (a document exported as a file, pictures, attachments), save each one in '+box+' and name them in your reply'+(plan?'':'; they are copied into the project')+'. Never put passwords or keys in a file or in the reply.':'')+')';
 try{const r=await fetch(GATE.origin+pre+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},signal:AbortSignal.timeout(900000),body:JSON.stringify({model,stream:false,messages:[{role:'user',content:note+'\n\n'+String(task).slice(0,20000)}]})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error?.message||j.error||'The agent did not answer ('+r.status+').'),{status:502});
  if(j.usage?.total_tokens)await code.addUsage(who.id,j.usage.total_tokens);const text=j.choices?.[0]?.message?.content||'';
  return {agent:a,agentName:NAMES[a]||await displayName(a),text,files:box?await codeAgents.collect(a,box,text):[]}}
 catch(e){if(box)await codeAgents.collect(a,box,'').catch(()=>{});if(e.status)throw e;throw Object.assign(Error('The agent took too long: '+e.message),{status:504})}}
// the box's own Code copy (online projects) is paired with this aqeelOS by itself, and again if its key is lost
if(LIVE_APP)setTimeout(async()=>{try{const f=path.join(homedir(),'apps','aqeel-code','data','aqeelos.json');let l={};try{l=JSON.parse(await readFile(f,'utf8'))}catch{}if(l.token&&await code.who(l.token)){await code.markBox(l.token);return}
 const token=await code.pair('owner','AI box · online',{box:true});await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify({base:'http://127.0.0.1:'+PORT,token,user:users.people?.()?.[0]?.name||'Owner',pairedAt:Date.now()},null,1),{mode:0o600});console.log('code: paired the online copy')}catch(e){console.warn('code: online pairing',e.message)}},8000).unref();
// After the server was off: tell the owner on the main agent's channel how long (it cannot report while it is off;
// a check from outside, .github/workflows/uptime.yml, emails while it is down). A heartbeat every minute marks it alive.
if(LIVE_APP){const HB=path.join(DATA,'heartbeat.json');readFile(HB,'utf8').then(t=>JSON.parse(t).t||0).catch(()=>0).then(last=>{const beat=()=>writeFile(HB,JSON.stringify({t:Date.now()})).catch(()=>{});beat();setInterval(beat,60000).unref();
 const gap=Date.now()-last;if(!last||gap<5*60e3)return;setTimeout(async()=>{try{const ch=await relay.channelsFor('default');const c=ch.find(x=>x.platform==='whatsapp')||ch[0];if(!c)return;
  const at=t=>new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:tzNow}),mins=Math.round(gap/60000);
  // it started again by itself, so a short break is not something to act on (31 Oct 2026); an hour or more is shown
  await bottlenecks.event('down','aqeelOS was off for '+mins+' min','From about '+at(last)+' to '+at(Date.now())+' ('+zoneName(tzNow)+' time). Everything started again by itself. If it happens often, check the server at your hosting provider.',{info:mins<60}).catch(()=>{});
  await relay.sendAs('default',c.owner,c.platform,'aqeelOS was off from about '+at(last)+' to '+at(Date.now())+' ('+zoneName(tzNow)+' time, '+mins+' min). It is running again.',null,{toYou:true});console.log('told the owner about '+mins+' min off')}catch(e){console.warn('downtime note:',e.message)}},120000).unref()})}
const brand=createBrand({DATA,contactFallback:OWNER_CONTACT});
const backups=createBackups({DATA,HOME:homedir(),HERMES_HOME,tz:()=>tzNow,notify:(t,d)=>bottlenecks.event('backup',t,d+' Open System › Health to try again.',{topic:'backup'}).catch(()=>{}),solved:()=>bottlenecks.resolve('backup').catch(()=>{}),
 restored:(ok,text,detail)=>(ok?bottlenecks.resolve('restore').then(()=>bottlenecks.event('backup',text,detail,{info:true})):bottlenecks.event('backup',text,detail,{topic:'restore'})).catch(()=>{}),   // done: the bell; failed: Bottlenecks
 // a restore stops the agents and the engine's dashboard (it keeps the chats database and settings open too), and the
 // watches leave both alone until it starts them again (services.sh starts both)
 stopEngine:async()=>{while(gwRestarting)await gwRestarting.catch(()=>{});   // a restart already under way finishes first (new ones wait for the restore)
  gwStopped=true;dashStopped=true;await shx(stopGatewayCmd({dashboard:true,yes:false}),stopTimeoutMs());
  for(let i=0;i<30&&await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(2000)}).then(()=>true,()=>false);i++)await new Promise(r=>setTimeout(r,1000));
  if(await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(2000)}).then(()=>true,()=>false))throw Error('the engine dashboard still answers after 30 s')},
 startEngine:async()=>{dashStopped=false;gwStopped=false;await restartGateway('agents restored from a backup',{wait:false,bridges:true,restore:true})}});restoreBusy=()=>backups.busy();holdWrites(()=>backups.writesHeld());if(LIVE_APP)backups.schedule();
const live=createLive({DATA,DOMAIN:hostSetting('liveDomain'),SECRET,PUBLIC_URL,auto:LIVE_APP});
// This install's own settings (System › Settings): Your address, time zone, hosts, agent users, Claude sign-in (install-routes.mjs)
const install=createInstallRoutes({send,readBody,isAdmin:u=>users.isAdmin(u),listAgents:()=>listAgents(),readConfig,setKey,hermes:hcmd,engineProbe:async()=>{const d=await fetch(DASH.origin+'/api/status',{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(5000)}).catch(()=>null);if(!d)return 'down';if(d.status===401||d.status===403)return 'auth';const g=await fetch(GATE.origin+'/api/model/options',{headers:{authorization:'Bearer '+API_KEY},signal:AbortSignal.timeout(5000)}).catch(()=>null);return !g?'down':g.status===401||g.status===403?'auth':'ok'},claudeOn:async()=>(pick(await readConfig('default')||{},'plugins.enabled')||[]).includes('claude-subscription-directsdk-experimental'),onTz:z=>{tzNow=z;SR_TZ=z}});
if(LIVE_APP){setTimeout(()=>install.tick(),120000).unref();setInterval(()=>install.tick(),15*60e3).unref()}
const homeOfAgent=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
const gconnect=createGoogleConnect({HERMES_HOME,DATA,PUBLIC_URL:()=>String(PUBLIC_URL),homeOf:homeOfAgent,log:m=>console.log(m)});
// a sign-in made here is the owner's own: registered at once (Connections never flags it), and the agents are told
async function googleConnected(r,who=''){if(!r?.ok)return;connAccounts.register(r.agent,{kind:'google',label:'Google, '+(r.email||r.name||'main'),where:path.join(homeOfAgent(r.agent),r.file)},{owner:who}).catch(e=>console.warn('google: register',e.message));if(LIVE_APP)writeAgentContext().catch(()=>{})}
const mcpEdit=createMcpEdit({readConfig,setKey,readEnv:a=>readFile(path.join(homeOfAgent(a),'.env'),'utf8').catch(()=>''),editEnv:(a,f)=>editEnv(path.join(homeOfAgent(a),'.env'),f),restart:why=>restartGateway(why),log:m=>console.log(m)});
// two places for what aqeelOS tells (1 Nov 2026): Bottlenecks is the to-do list (needs someone), the bell's list (news.mjs)
// the history (done, fixed, works again). Every event goes to one of them, never both: info:true means the bell
const news=createNews({DATA});
// "Needs you" (7 Nov 2026): the Bottlenecks person items, one list shown in two places, the Bottlenecks popup and the
// bell; only what truly needs a person (forPopup), each once
async function needsFor(u){const admin=users.isAdmin(u);if(admin)await freshSignins();const items=await bottlenecks.list({admin,uid:admin?null:u.id,mayUse:a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a),signins:admin?[...signinsDue.values()]:[],invites:admin?users.expiredInvites():[],accounts:admin?await accountsApi.signedOut().catch(()=>[]):[],channels:admin?await channelAttention(false).catch(()=>[]):[]});const mayU=a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);items.push(...await accessAsk.open(admin?()=>true:mayU).catch(()=>[]));items.push(...await help.items(u).catch(()=>[]));
    for(const {a,p:pr} of await instructions.openProposals(await listAgents()).catch(()=>[]))if(admin||users.agentOwner(a)===u.id)items.push({id:'instr|'+a+'|'+pr.id,kind:'instructions',agent:a,pid:pr.id,title:(NAMES[a]||a)+': new instructions wait for your approval',detail:pr.why,created:pr.at,from:null});
    // the message that led to it is from the agent's newest chat, whoever's: a member sees it only when that chat is theirs
    // a member sees (and counts) only what they can act on themselves (7 Nov 2026, clean-install test: members saw the
    // count of admin-only items they could not do anything about)
    const shown=forPopup(items).filter(x=>admin||memberCan(x));return admin?shown:shown.map(x=>x.from&&users.ownerOf(x.from.chat)!==u.id?{...x,from:null}:x)}
// the optional evening line in the bell (System › Settings › Notifications, off by default): once a day at 19:00 local
// time, how many things fixed themselves today and whether anything needs you
const notifySettings=async()=>({daily:false,...await readFile(path.join(DATA,'notify.json'),'utf8').then(JSON.parse).catch(()=>({}))});
if(LIVE_APP)setInterval(async()=>{try{if(!(await notifySettings()).daily)return;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tzNow,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  if(Number(parts.hour)<19)return;const day=parts.year+'-'+parts.month+'-'+parts.day,start=Date.now()-(Number(parts.hour)*3600e3);
  const l=await issues.list().catch(()=>({items:[]})),fixed=l.items.filter(i=>i.state==='fixed'&&(i.fixed||0)>=start).length;
  const needs=(await needsFor({id:'owner',role:'owner'}).catch(()=>[])).length;
  await news.add({aud:'admins',key:'daily|'+day,started:true,icon:needs?'alert':'check',kind:needs?'warn':'ok',title:eveningLine(fixed,needs),text:'',go:needs?'/system/health':'/system/activity',label:needs?'Health':'Activity'})}catch(e){console.warn('evening line:',e.message)}},10*60e3).unref();
// the morning line (8 Nov 2026, owner's stability plan): at 07:30 local time the main agent tells the owner, through the
// alert route, "Yesterday: everything worked." or exactly what broke and whether it fixed itself. Code only, no model.
const morning=createMorning({DATA,tz:()=>tzNow,send:text=>ownerSend(text,'telegram'),
 collect:async()=>{await isTestAgent('-');const tests=testAgents.v;
  return {issues:(await issues._db().catch(()=>({items:[]}))).items,events:await bottlenecks.events().catch(()=>[]),activity:await news.activity({id:'owner'},true,{limit:300}).catch(()=>[]),isTest:a=>tests.has(a),names:a=>NAMES[a]||a}}});
if(LIVE_APP)setInterval(()=>morning.tick().catch(e=>console.warn('morning line:',e.message)),5*60e3).unref();
const newsInfo=(kind,text,detail)=>{const ok=/works again|fixed|back on|working again|passed/i.test(text);return news.add({aud:'admins',group:'ev|'+kind+'|'+String(text).replace(/\(.*?\)|[0-9]+/g,'#').replace(/\s+/g,' ').trim().slice(0,100),icon:kind==='down'?'activity':ok?'check':'refresh',kind:ok?'ok':'blue',title:text,text:detail,go:'/system/health',label:'Health'})};
const bottlenecks=createBottlenecks({DATA,onInfo:newsInfo,listAgents:()=>listAgents(),names:a=>NAMES[a]||a,dash:p=>fetch(DASH.origin+'/api'+p,{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)}).then(r=>r.json())});brand.name().then(n=>{globalThis.AQ_BRAND=n}).catch(()=>{});
// agents' instructions with a history, contradiction flags and approval for rewrites (instructions.mjs)
const instructions=createInstructions({DATA,HERMES_HOME,DASH:DASH.origin,DASH_TOKEN,python:enginePython,root,names:a=>agentName(a),live:LIVE_APP});
if(LIVE_APP){setTimeout(()=>listAgents().then(l=>instructions.tick(l)).catch(()=>{}),150000).unref();setInterval(()=>listAgents().then(l=>instructions.tick(l)).catch(()=>{}),30*60000).unref()}
// the owner on the main agent's WhatsApp (as when the server was off, or after a night update)
// Automatic updates (scripts/auto-update.mjs) on a Docker box; installer installs use a systemd timer. Checked every 15 minutes;
// the script itself keeps to the quiet hours. A failed or refused update goes under Bottlenecks once.
if(LIVE_APP&&existsSync(path.join(homedir(),'services.sh'))){const tick=()=>{try{spawn(process.execPath,[path.join(root,'scripts','auto-update.mjs')],{detached:true,stdio:'ignore',env:process.env}).unref()}catch{}};setTimeout(tick,120000).unref();setInterval(tick,15*60000).unref()}
if(LIVE_APP)setInterval(async()=>{const f=path.join(DATA,'auto-update.json');let a;try{a=JSON.parse(await readFile(f,'utf8'))}catch{return}const l=a.last;if(!l||!/failed|refused/.test(l.result)||a.told===l.at)return;a.told=l.at;await writeFile(f,JSON.stringify(a,null,1)).catch(()=>{});await bottlenecks.event('update',l.result==='refused'?'An automatic update was skipped':'An automatic update failed',l.why).catch(()=>{})},5*60000).unref();
// The desktop app for everyone: the public GitHub release (.github/workflows/desktop-app.yml). DESKTOP_RELEASES points elsewhere for a
// private build; files in DATA/desktop are used when they are newer, or when no release can be reached.
const DESKTOP_RELEASES=(env.DESKTOP_RELEASES||'https://github.com/aqeeljundiy/aqeel-os/releases/latest/download').replace(/\/$/,'');
const localAppVersions=()=>readFile(path.join(DATA,'desktop','version.json'),'utf8').then(JSON.parse).catch(()=>({}));
let appRelease={t:0,v:null};
async function releaseAppVersions(){if(Date.now()-appRelease.t<36e5)return appRelease.v;appRelease.t=Date.now();try{const r=await fetch(DESKTOP_RELEASES+'/version.json',{signal:AbortSignal.timeout(15000)});if(r.ok)appRelease.v=await r.json()}catch{}return appRelease.v}
const newerApp=(a,b)=>{if(!a)return false;if(!b)return true;const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)}return false};
// Plug and play settings (System › Teams, team-settings.mjs): the team policy, where owner alerts go, Pause alerts, test agents
const teamSettings=createTeamSettings({DATA,HERMES_HOME,listAgents:()=>listAgents()});
const codeChanges=createCodeChanges({DATA});   // live code changes git lacks: deploy drift and fixer patches (System › Health)
// Where owner alerts go: the channel and chat chosen on System › Teams; else the main agent's own chat (Telegram first for
// its reports, WhatsApp first for the rest). No channel at all, or the send fails: the bell, so an alert is never lost.
async function ownerChannel(prefer){const ch=await relay.channelsFor('default').catch(()=>[]),t=await teamSettings.alertTarget();
 if(t){const c=ch.find(x=>x.id===t.channel);if(c)return {...c,chat:t.chat||null}}
 return ch.find(x=>x.platform===prefer&&x.owner==='default')||ch.find(x=>x.owner==='default')||ch[0]||null}
async function ownerSend(text,prefer){const c=await ownerChannel(prefer);
 // with no channel: a message that needs the owner (the fixer's "needs a person" or "could not fix") is a Bottlenecks
 // item, in the bell's Needs you; anything else is Activity (7 Nov 2026), and the Send test the owner pressed is theirs
 const first=String(text).split('\n')[0].slice(0,140),need=/needs a person|What is needed|could not fix this by itself|What is needed from you/i.test(text);
 const bell=why=>(need?bottlenecks.event('alerts',first,String(text)+'\n\n'+why,{topic:'alerts|'+String(text).slice(0,60)}):
  news.add({aud:'admins',started:/^Test from /.test(text),group:'alerts|'+first.replace(/[0-9]+/g,'#'),icon:'bell',title:first,text:String(text).slice(first.length).trim()+' '+why,go:'/system/teams',label:'Teams'})).catch(()=>{});
 if(!c){await bell('No channel to you is set up yet, so this alert waits here. Pick one under Alerts go to on System › Teams.');return {bell:true}}
 try{await relay.sendAs('default',c.owner,c.platform,text,c.chat||null,{toYou:true});return {sent:c.name}}catch(e){await bell('Not sent on '+c.name+': '+e.message);throw e}}
async function toOwner(text){return ownerSend(text,'whatsapp')}
/* Automations guard (automation-guard.mjs, 25 Oct 2026): tool servers that stop connecting or whose Python went away
   are fixed by themselves; problems go to Bottlenecks and fixes to the bell's list, a failed fix also goes to WhatsApp at once. Agent copies
   (agent--2) have their own tool servers and logs, so they are watched too. */
const alertQuiet=createQuiet({DATA,HERMES_HOME});
const guard=createAutomationGuard({DATA,HERMES_HOME,LIVE:LIVE_APP,quiet:alertQuiet,readConfig,withAgent,setKey,listAgents:()=>agentNames({copies:true}),nameOf:a=>agentName(a),
 dash:(method,p,body)=>fetch(DASH.origin+p,{method,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:body&&method!=='GET'&&method!=='DELETE'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)}).then(async r=>({ok:r.ok,status:r.status,j:await r.json().catch(()=>({}))})),
 busy:()=>liveCount()+engAgents.n,paused:()=>guardPaused({engineUpdate:engineUpd.busy(),gwRestarting:!!gwRestarting,restore:backups.busy()}),zone:async()=>installTz()||(await readConfig('default').catch(()=>null))?.timezone||sysTz(),isDaytime:dayNow,localDate:(ms,tz)=>localAt(ms,tz).date,
 tell:async(text,{detail,whatsapp,bell=true,topic,info,resolve}={})=>{if(resolve)await bottlenecks.resolve(resolve).catch(()=>{});if(!text)return;if(bell)await bottlenecks.event('automations',text,detail||'',{topic,info,told:!!whatsapp}).catch(()=>{});if(whatsapp)await toOwner(text+(detail?'\n'+detail:''))}});
/* Backup models (backup-models.mjs, 30 Oct 2026): every agent's engine backup list from the Models page order, and the
   outage switch when one provider keeps failing replies (agents move to their first backup and back once it works).
   Its alerts go the way the automations guard's do: Bottlenecks (or the bell's list once it is automatic or over) and WhatsApp. Only the live app writes and moves agents
   (a copy on another port with its own engine home may, for testing: BACKUP_MODELS_TEST=1). */
let tzNow=applyTz()||sysTz();   // the install's own time zone (System › Settings) wins over the engine's
// the engine's configured time zone is the whole app's zone (posting limits, backups, notices): read at start and every
// 10 minutes; a box without one uses its system zone (7 Nov 2026: Asia/Jakarta was written in the code)
{const zt=()=>readConfig('default').then(c=>{const z=installTz()||String(c?.timezone||'');if(z&&z!==process.env.TZ){try{new Intl.DateTimeFormat('en',{timeZone:z});process.env.TZ=z;tzNow=z}catch{}}}).catch(()=>{});zt();setInterval(zt,600e3).unref()}
const bmTest=!LIVE_APP&&env.BACKUP_MODELS_TEST==='1'&&path.resolve(HERMES_HOME)!==path.join(homedir(),'.hermes');
const backupModels=createBackupModels({DATA,HERMES_HOME,live:LIVE_APP||bmTest,...(bmTest&&env.BACKUP_MODELS_RULES?{R:{...BM_RULES,...JSON.parse(env.BACKUP_MODELS_RULES)}}:{}),   // a test copy may shorten the times
 agents:async()=>{const l=await agentNames({copies:true});if(await isAgent(HELP_AGENT))l.push(HELP_AGENT);return l},acc:accountsApi.backup,readConfig,setKey,ready:async()=>{await users.load();const c=await readConfig('default').catch(()=>null);const z=installTz()||c?.timezone;if(z)tzNow=z},
 // an agent a member owns gets only backups that member's role allows (people's "models", users.mjs)
 modelOk:(a,p,m)=>{const o=users.byId(users.agentOwner(String(a).split('--')[0]));return !o||users.modelOk(o,p,m)},
 probe:engineProbe({python:enginePython,root,engine:path.join(HERMES_HOME,'hermes-agent')}),nameOf:a=>agentName(a),clock:ms=>clockAt(ms,tzNow),
 tell:async(text,{detail,whatsapp,bell=true,topic,info,resolve}={})=>{if(resolve)await bottlenecks.resolve(resolve).catch(()=>{});if(!text)return;if(bell)await bottlenecks.event('automations',text,detail||'',{topic,info,told:!!whatsapp}).catch(()=>{});if(whatsapp)await toOwner(text+(detail?'\n'+detail:''))}});
accountHooks.held=k=>backupModels.held(k);accountHooks.backupSync=why=>backupModels.soon(why);
// every automatic model move is told to the owner: moves within 30 seconds go in one message (6 Nov 2026: seven agents
// moved to GPT and nobody heard of it)
{let movesQ=[],movesT=null;accountHooks.tell=e=>{if(!LIVE_APP)return;movesQ.push(e);clearTimeout(movesT);movesT=setTimeout(async()=>{const l=movesQ;movesQ=[];
 const to=k=>{const m=/^claude:(.+)$/.exec(k||'');return m?'Claude ('+m[1]+')':String(k||'').replace(/^p:/,'')};
 const text='Model change'+(l.length>1?'s ('+l.length+')':'')+':\n'+l.map(x=>'- '+(NAMES[x.profile]||x.profile)+' → '+to(x.to)+(x.why?' ('+x.why+')':'')).join('\n')+'\nModels › AI accounts shows the history.';
 await bottlenecks.event('models',l.length+' model change(s)',text,{info:true}).catch(()=>{});await srToOwner(text).catch(err=>console.warn('model moves: owner not told',err.message))},30e3)}}
/* Connected accounts (connected-accounts.mjs, 31 Oct 2026): every login where an agent acts as the owner (Google, Slack
   and Notion sign-ins, a personal Telegram session), with Pause, allowed actions and Disconnect. Only the live app looks
   by itself and adds a Bottlenecks item; a copy on another port with its own engine home may, for testing (ACCOUNTS_TEST=1, and
   ACCOUNTS_SLACK_API / ACCOUNTS_GOOGLE_REVOKE point the provider calls at a stub). */
const caTest=!LIVE_APP&&env.ACCOUNTS_TEST==='1'&&path.resolve(HERMES_HOME)!==path.join(userInfo().homedir,'.hermes');   // the account's own home, even when HOME points at a fake one
// Sharing levels (sharing.mjs): one owner agent per resource, shared at manager/editor/viewer; off until switched on
// (DATA/sharing.json enabled, or SHARING_LEVELS=1), so the live box is unchanged until the owner turns it on
const shareLevels=createSharing({DATA,listAgents:()=>agentNames({copies:false}),onChange:async r=>{if(r.type==='account')await connAccounts.levelsChanged(r.id).catch(e=>console.warn('sharing: account',e.message))}});
// agents as a shared resource (agent-access.mjs): manage_agent checks the caller's level on the target agent on every call;
// changes go to the agent-versions hook (agent-versions.mjs, when it exports recordAgentChange) so they are attributed and undoable
const cronApi=(t,p,o={})=>fetch(DASH.origin+'/api/cron/jobs'+p+(p.includes('?')?'&':'?')+'profile='+encodeURIComponent(t),{...o,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},signal:AbortSignal.timeout(60000)}).then(async r=>{const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.detail||'HTTP '+r.status);return j});
const agentAccess=createAgentAccess({sharing:shareLevels,HERMES_HOME,MAIN:env.MAIN_AGENT||'default',
 // F (lead agents): a lead's power is its person's role, read live: an admin's lead acts as the main agent; any other agent
 // may only manage agents its own person owns (never someone else's, whatever level was shared), and never change sharing
 mainLike:a=>users.leadPerson(a)!==null&&users.tierOf(a)==='admin',
 scope:(me,t,part)=>leadScope(me,t,part),
 ownerLike:(me,t)=>users.leadPerson(me)!==null&&users.agentMayManage(me,t),instructions:{change:(...a)=>instructions.change(...a)},readConfig,setKey,names:a=>NAMES[a]||a,
 reload:why=>{console.log('agent-access: D RELOAD NEEDED',why);return Promise.resolve()},   // a settings change waits for the next agents reload (never restarted from here)
 versions:{record:async e=>{const m=await import('./agent-versions.mjs').catch(()=>null);return m?.recordAgentChange?.(e)}},
 cron:{list:async t=>{const l=await cronApi(t,'');return (Array.isArray(l)?l:l.jobs||[]).filter(j=>(j.profile||t)===t)},create:(t,b)=>cronApi(t,'',{method:'POST',body:JSON.stringify(b)}),
  update:(t,id,u)=>cronApi(t,'/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({updates:u})}),pause:(t,id)=>cronApi(t,'/'+encodeURIComponent(id)+'/pause',{method:'POST'}),
  resume:(t,id)=>cronApi(t,'/'+encodeURIComponent(id)+'/resume',{method:'POST'}),remove:(t,id)=>cronApi(t,'/'+encodeURIComponent(id),{method:'DELETE'})}});
const connAccounts=createConnectedAccounts({sharing:shareLevels,DATA,HERMES_HOME,active:LIVE_APP||caTest,listAgents:()=>agentNames({copies:true}),readConfig,setKey,withAgent,python:enginePython,access,whyOf,nameOf:a=>agentName(a),
 ...(caTest?{WORK:env.ACCOUNTS_WORK||path.join(path.dirname(HERMES_HOME),'workspaces'),ends:{slack:env.ACCOUNTS_SLACK_API,revoke:env.ACCOUNTS_GOOGLE_REVOKE},STEP:1000}:{}),
 googleLabel:async(a,n)=>((await googleLabels())[a+'|'+n]||{}).label||'',signinNeeded:(a,n)=>signinsDue.has(a+'|'+n),
 dash:(method,p,body)=>fetch(DASH.origin+p,{method,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:body&&method!=='GET'&&method!=='DELETE'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)}).then(async r=>({ok:r.ok,status:r.status,j:await r.json().catch(()=>({}))})),
 bell:(text,detail,o)=>bottlenecks.event('accounts',text,detail||'',o||{}),solve:id=>bottlenecks.resolve(id?'accounts|'+id:'accounts')});
// planned changes put in DATA/apply-on-start/ are carried out once at start (apply-on-start.mjs): share levels,
// moving an agent's own copy of a Google sign-in to a share
if(LIVE_APP)setTimeout(()=>{import('./apply-on-start.mjs').then(({applyOnStart})=>applyOnStart({DATA,ops:{
 level:async({email,agent,level})=>{const L={read:['read'],edit:['read','edit'],draft:['read','edit','draft'],full:['read','edit','draft','send']}[level];if(!L)throw Error('level is read, edit, draft or full');
  const db=await connAccounts._db();const x=Object.values(db.accounts||{}).find(y=>y.kind==='google'&&String(y.identity||'').toLowerCase()===String(email).toLowerCase());if(!x)throw Error('no Google login '+email);
  return (await connAccounts.setAgentCan(x.id,agent,L)).can},
 share:({email,agent})=>googleShares.share(email,agent),
 migrate:({agent,file,email})=>googleShares.migrate(agent,file,email),
 // names and descriptions people remember (labels.mjs, 7 Nov 2026): display fields only, never an id
 label:({kind,id,name,description})=>labels.set(kind,id,{name,description}),
 scheduleDescription:({profile,id,summary})=>schedules.setMeta(String(profile||'default'),String(id),{summary:String(summary||'')}).then(m=>m.summary),
 scheduleName:async({profile,id,name})=>{name=String(name||'').trim().slice(0,120);if(!name||!/^[\w]+$/.test(String(id)))throw Error('name and id needed');
  const r=await fetch(DASH.origin+'/api/cron/jobs/'+encodeURIComponent(id)+'?profile='+encodeURIComponent(profile||'default'),{method:'PUT',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:JSON.stringify({updates:{name}}),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('the engine said HTTP '+r.status);return name},
 agentName:async({agent,name})=>{agent=String(agent||'');name=String(name||'').trim().slice(0,60);if(!okProfile(agent)||!name)throw Error('agent and name needed');if(!(await listAgents()).includes(agent)&&agent!==HELP_AGENT)throw Error('no agent '+agent);
  await withIds(async ids=>{ids[agent]={...(ids[agent]||{}),name,title:ids[agent]?.title||'',updated:Date.now()};await writeIds(ids)});await setDisplayName(agent,name);NAMES[agent]=name;return name},
 // one standing line in an agent's instructions, through the instructions history (a version, undoable); once only
 instructionLine:async({agent,text,marker})=>{agent=String(agent||'');text=String(text||'').trim();marker=String(marker||text.slice(0,40));if(!okProfile(agent)||!text)throw Error('agent and text needed');
  const r=await fetch(DASH.origin+'/api/profiles/'+encodeURIComponent(agent)+'/soul',{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('the engine said HTTP '+r.status);
  const cur=String((await r.json().catch(()=>({}))).content||'');if(!cur.trim())throw Error('no instructions to add to');if(cur.includes(marker))return 'already there';
  const x=await instructions.write(agent,cur.replace(/\s*$/,'')+'\n\n'+text+'\n',{kind:'change',by:'aqeelOS',why:'Owner rule (7 Nov 2026): everything an agent makes gets a plain name and a one-line description'});return 'version '+x.v},
 agentDescription:async({agent,description})=>{const r=await fetch(DASH.origin+'/api/profiles/'+encodeURIComponent(String(agent||''))+'/description',{method:'PUT',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:JSON.stringify({description:String(description||'').trim().slice(0,240)}),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('the engine said HTTP '+r.status);return true}}})).catch(e=>console.warn('apply-on-start',e.message))},45000).unref();

/* Abilities › Connections (connections.mjs, 1 Nov 2026): every app, login as you, skill, plugin and key in one list, who
   owns it, who may use it and how much (Read, Read & draft, Full; On or Off). AdsPower and Code come in when asked. */
const connections=createConnections({DATA,access,accounts:connAccounts,listAgents:()=>listAgents(),listCopies:()=>agentNames({copies:true}),names:a=>agentName(a),sharing,
 engine:(method,p,body)=>fetch(DASH.origin+p,{method,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:body&&method!=='GET'&&method!=='DELETE'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)}).then(async r=>({ok:r.ok,status:r.status,j:await r.json().catch(()=>({}))})),
 ads:()=>agentAds.list(),code:async()=>{const nm=Object.fromEntries(users.people().map(x=>[x.id,x.name||x.username||'Someone']));return {devices:(await code.allDevices()).map(d=>({...d,person:nm[d.user]||'Someone'})),live:{connected:(await live.list(null,true)).connected}}}});
// engine updates at night, checked after; the owner is told on the main agent's channel (as when the server was off)
const engineUpd=createEngineUpdates({guard,DATA,HERMES_HOME,PORT,LIVE:LIVE_APP,readConfig,python:enginePython,patches:enginePatches,restartGateway,resetForUpdate:engineReset,
 dash:(p,o={})=>fetch(DASH.origin+'/api'+p,{...o,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},signal:AbortSignal.timeout(60000)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||'HTTP '+r.status);return j}),
 busy:()=>liveCount()+export_setups.running()+opsBusy()+relay.sending()+(gwRestarting?1:0)+(backups.busy()?1:0),   // never during a restore
 stopGateway:async()=>{gwStopped=true;await shx(stopGatewayCmd({yes:false}),stopTimeoutMs())},
 tellOwner:async(text,{bell,kind,detail}={})=>{if(bell||/failed|rolled-back/.test(kind||''))await bottlenecks.event('update',text,detail||'').catch(()=>{});else await bottlenecks.event('update',text,detail||'',{info:true}).catch(()=>{});if(bell)return;await toOwner(text)}});
const codeOnline=createCodeOnline({SECRET,SECURE:SECURE_COOKIE,users:()=>users,revokedAt:uid=>revoked[uid]||0,HOST:CODE_HOST,PREVIEW_HOST:CODE_PREVIEW_HOST,HOME:PUBLIC_URL});
const localBrowser=createLocalBrowser({DATA,GATE:GATE.origin,API_KEY,EXT_DIR:path.join(root,'extension'),NAMES,PUBLIC_URL});
const engineConsole=createEngineConsole({DASH,DASH_TOKEN});
const links=createLinks({DATA,DASH:DASH.origin,TOKEN:DASH_TOKEN,HERMES_HOME,python:()=>sharing.python(),setupAgent:n=>setupAgentFn?.(n)});
const cfgLimit=limiter(4);   // per-agent config reads on a page: a few side by side, never a burst of Pythons
function listAgents(){return agentNames()}   // real agents only (a folder with a config), not extra-number copies
async function listAllProfiles(){return [...await listAgents(),...(await links.list()).map(l=>l.name)].filter(n=>!String(n).startsWith('.'))}   // never profiles/.deleted and the like
// API keys for model accounts: tested before saving and every 5 minutes after (connect.mjs, 25 Oct)
// the first model account on a fresh install: agents with no model yet (the main agent first) get its model, so new
// agents ("Same as the main agent") and Models never sit on an empty "Default" (clean-install test, 7 Nov 2026)
async function adoptFirstModel(slug){const agents=['default',...(await listAgents().catch(()=>[])).filter(a=>a!=='default')];
 const bare=[];for(const a of agents){const c=await readConfig(a).catch(()=>null);if(c&&!pick(c,'model.default'))bare.push(a)}if(!bare.length)return;
 const o=await fetch(GATE.origin+'/api/model/options',{headers:{authorization:'Bearer '+API_KEY},signal:AbortSignal.timeout(20000)}).then(r=>r.ok?r.json():null).catch(()=>null);
 const m=firstModelFor(o?.providers,slug);if(!m)return;
 for(const a of bare){await setKey(a,'model.provider',m.provider);await setKey(a,'model.default',m.model)}console.log('first model account: '+m.provider+' / '+m.model+' for '+bare.join(', '))}
const connect=createConnect({HERMES_HOME,DASH,DASH_TOKEN,live:LIVE_APP,afterSave:slug=>adoptFirstModel(slug)});accountHooks.keyStatus=()=>connect.status();accountHooks.keyCheck=()=>connect.checkAll();
const antigravity=createAntigravity({HERMES_HOME,hcmd,listAgents,moveOff:(a,k)=>accountHooks.moveOff?accountHooks.moveOff(a,k):null});
async function agentModel(a){const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}}
const users=createUsers(DATA,mailer,{ownerCheck:pw=>!!PW_HASH&&checkPassword(pw),envOwner:()=>!!PW_HASH,brandName:()=>brand.name(),relaxed:!LIVE_APP});
users.hooks.revoke=id=>revokeSessions(id);
const accountAuth=createAccountAuth({users,send,readBody,publicUrl:()=>String(PUBLIC_URL),revoke:id=>revokeSessions(id),signIn:id=>({'set-cookie':'hui='+makeCookie(id)+'; '+cookieAttrs(SESSION_DAYS*86400)}),
 limited:req=>limited(clientIp(req)),miss:req=>{const ip=clientIp(req);(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now())}});
// Help: the person's own help chat (help.mjs); account usage is read through the Accounts page's own handler, as that person
const help=createHelp({DATA,root,DASH:DASH.origin,DASH_TOKEN,GATE:GATE.origin,API_KEY,users,listAgents:()=>listAgents(),names:a=>agentName(a),platforms:a=>platformsCached(a),signins:()=>[...signinsDue.values()],agentModel:a=>agentModel(a),security,send,readBody,
 accounts:u=>new Promise(r=>Promise.resolve(accountsApi({method:'GET',url:'/ui/accounts',headers:{}},null,'/ui/accounts',(x,code,data)=>r(code===200?data:null),readBody,a=>!!users.level(u,a))).catch(()=>r(null)))});
const starters=createStarters(DATA,{python:enginePython,root});
const me=async req=>{const id=cookieId(req);return id?await users.user(id):null};
// The agent a call is for: /gapi/p/<agent>/… or ?profile=<agent> (none = the main agent).
const agentOf=(p,q)=>{const m=/^\/gapi\/p\/([^/]+)/.exec(p);return m?decodeURIComponent(m[1]):q.get('profile')||q.get('agent')||'default'};

/* ---------- a person's call to Hermes: allowed? which chats come back? ---------- */
// An agent a member just created: they own it, it can chat (plugin, model, gateway key), and unless they
// may use the unsafe tools, terminal / files / code / computer use are switched off.
/* A person's lead agent (F): made when they join (users.hooks.onJoin) or by an admin later (POST /ui/people/<id>/lead).
   Blank (no copy of the main agent), owned by them, set up like any agent they make: its own Linux user, the standard set
   (agent defaults), terminal/files/code only when their role allows "unsafe". Its power is their role, read live. */
async function makeLead(u){await users.load();if(users.leadOf(u.id))return users.leadOf(u.id);const all=await agentNames({copies:true});
 const slug=String(u.username||u.name||'person').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'person';
 let id=slug+'-lead',n=2;while(all.includes(id)||id===HELP_AGENT)id=slug+'-lead-'+n++;
 const soul='# '+(u.name||'My')+"'s lead agent\n\nYou are the lead agent of "+(u.name||'this person')+' in aqeelOS. You work for them and look after the agents they own (manage_agent). What you may do is exactly what their role in aqeelOS allows; aqeelOS checks it on every call. When something is outside that, say so plainly and ask them or the owner of aqeelOS.\n';
 const r=await fetch(DASH.origin+'/api/profiles',{method:'POST',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:JSON.stringify({name:id,clone_from_default:false,no_skills:false,soul,description:'Lead agent of '+(u.name||'a person')})});
 if(!r.ok)throw new Error('engine '+r.status+' '+(await r.text().catch(()=>'')).slice(0,160));
 await users.setLead(u.id,id);await withIds(async ids=>{ids[id]={...(ids[id]||{}),name:(u.name||'My')+"'s lead",title:'Lead agent',updated:Date.now()};await writeIds(ids)}).catch(()=>{});
 await memberAgent(u,id);syncNotifyTool().catch(()=>{});console.log('lead agent',id,'made for',u.name||u.id);return id}
// only the live app makes lead agents: a test copy (deploy checks on :4402) shares the live engine, so a lead it made was a
// real agent on the live Agents page (five "Controls-check-…-lead" agents by 7 Nov 2026)
users.hooks.onJoin=u=>LIVE_APP?makeLead(u):(console.log('test copy: no lead agent made for',u.name||u.id),null);
async function memberAgent(u,name){
 await users.created(u,name);noteMade(name);
 // a person's first own agent becomes their lead when they have none yet (made before leads existed)
 if(!users.leadOf(u.id))await users.setLead(u.id,name).catch(()=>{});
 await setupAgentFn?.(name).catch(e=>console.warn('setup',name,e.message));
 if(!users.can(u,'unsafe'))await lockTools(name).catch(e=>console.warn('lock tools',name,e.message));
}
/* The engine's channel list is slow (it checks every connection, 5–20 s), and pages ask for it often.
   Keep each agent's answer for 15 s, share one request between everyone asking at once, and forget it as
   soon as a channel setting changes. */
// where MCP sign-ins come back: the public site (the engine is told this, see ensurePublicUrl)
const MCP_OAUTH_BASE=urlRef('/mcp-oauth');   // follows Your address
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
 if(/already in progress/i.test(j.detail||j.error||''))j.error='A sign-in for '+tool+' was started a moment ago outside aqeelOS and is still open. It ends by itself within 5 minutes; try again then.';
 if(j.flow_id){signinFlows.set(k,j.flow_id);saveFlows();if(j.authorization_url)linkSeen.set(j.flow_id+'|'+j.authorization_url,Date.now())}if(!r.ok&&!j.error)j.error=j.detail||('HTTP '+r.status);return j}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOk=new Set();   // agents checked for their gateway key
/* The channel lists, per agent. clear()/delete() also move a stamp on, so a slow refresh that started before a change
   never stores what it read from before it (platformsFresh only keeps its answer while the stamp is the same).
   Any change also forgets the whole team list (chList), so Channels shows it right after. */
class PlatCache extends Map{all=0;g=new Map();clear(){this.all++;chList.drop();return super.clear()}delete(k,quiet){this.g.set(k,(this.g.get(k)||0)+1);if(!quiet)chList.drop();return super.delete(k)}stamp(k){return this.all+':'+(this.g.get(k)||0)}}
/* /ui/channels (every agent's channels) took 15 s cold: the engine checks each connection, then each bot is asked who it is.
   The last list answers at once and is read again behind the scenes after 20 s; only the first ask waits, at most 3 s,
   then shows the agents read so far ({partial:true}, the rest in loading) while the others finish for the next ask. */
const chList=swr({fresh:20000,cap:3000});
const channelList=fresh=>chList.get('all',()=>channels.list(),{force:fresh,partial:()=>channels.list({wait:0})}).then(d=>channels.live(d));
const platCache=new PlatCache();
const hapiStatus=swr({fresh:5000});   // GET /hapi/status, per query
// an agent's tool groups (measured 11.7 s on the box) and skills list (up to 4.4 s): the All agents views ask every agent,
// so the last answer (20 s) comes at once and is read again behind the scenes; any engine change drops it
const hapiLists=swr({fresh:20000});
// the slow status reads are read once soon after start (read-only), so even the first page that asks answers from them
setTimeout(()=>{channelList(false).catch(()=>{});antigravity.status().catch(()=>{});n8n.spaces().catch(()=>{})},15000).unref();
// System › Usage's engine reports (last 7 days, and the 62 the Spending overview needs) for every agent, once after start, so
// even the first visit answers at once; after that each visit refreshes them behind the scenes (usage.mjs, 1 Nov 2026). Only the live app (isLive): a test copy reads nothing it is not asked for
if(LIVE_APP)setTimeout(async()=>{for(const a of [...await listAgents().catch(()=>[]),HELP_AGENT])for(const [k,d] of [['usage',7],['usage',62],['models',7]])usage.report(k,a,d).catch(()=>{})},25000).unref();
/* The engine reports WhatsApp on any agent but the main one as "not set up", even when linked and connected (its
   check needs env keys WhatsApp doesn't have). The truth: switched on + a saved login (creds.json) = set up, and the
   live state the gateway records for "<agent>:whatsapp". */
async function trueWhatsApp(agent,v){const list=v?.platforms||v;if(!Array.isArray(list))return;const w=list.find(x=>x.id==='whatsapp');if(!w||(w.configured&&agent==='default'))return;
 const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent);
 const env=await readFile(path.join(home,'.env'),'utf8').catch(()=>'');const on=/^WHATSAPP_ENABLED=["']?true/im.test(env);
 const linked=await stat(path.join(home,'platforms','whatsapp','session','creds.json')).then(()=>true,()=>false);
 if(!(on&&linked))return;w.configured=true;w.enabled=true;
 try{const g=JSON.parse(await readFile(path.join(HERMES_HOME,'gateway_state.json'),'utf8'));const st=g.platforms?.[agent==='default'?'whatsapp':agent+':whatsapp'];
  if(st){w.state=st.state||w.state;w.error_message=st.error_message||null;w.error_code=st.error_code||null;w.updated_at=st.updated_at||w.updated_at||null}else if(w.state==='not_configured')w.state='starting'}catch{}}
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
 console.log('channel',platform,'on',agent,on?'resumed':'paused');return {ok:true,paused:!on,restarting:!j.hot_served,waiting:await waitingNow()}}
// one .env reader for channel settings: `export KEY=…`, quotes, trailing spaces, \r and an inline # comment (after a space)
function envParse(t){const o={};for(const raw of String(t||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw.replace(/\r$/,''));if(!m)continue;
 let v=m[2].trim();const q=/^(["'])(.*?)\1/.exec(v);v=q?q[2]:v.replace(/(^|\s+)#.*$/,'').trim().replace(/^["']/,'');o[m[1]]=v}return o}
const envOf=async a=>envParse(await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env'),'utf8').catch(()=>''));
/* Which account a channel is. Bots are asked from the service itself (Telegram getMe, Slack auth.test, Discord /users/@me);
   email, Signal, SMS and Matrix show the address the engine is set to use (Mattermost saves only a server and a token, so none).
   Kept in channel-identity.json per agent|platform: a good answer 6 h, a failure 10 min, asked again at once when the token
   changes (fp). A token the service rejects clears the account and says why on the row, instead of failing silently. */
const IDENT_FILE=path.join(DATA,'channel-identity.json');let identDb=null,identLoad=null;
const IDENT_CFG={email:['EMAIL_ADDRESS','username'],signal:['SIGNAL_ACCOUNT','phone'],sms:['TWILIO_PHONE_NUMBER','phone'],matrix:['MATRIX_USER_ID','username']};
async function channelIdentity(agent,c,env){const cfg=IDENT_CFG[c.id];
 // only a setting the engine lists for this channel (its env_vars), never a guessed name
 if(cfg){if(Array.isArray(c.env_vars)&&!c.env_vars.some(v=>v.key===cfg[0]))return null;return env[cfg[0]]?{account:{[cfg[1]]:env[cfg[0]],name:null}}:null}
 const tok=c.id==='telegram'?env.TELEGRAM_BOT_TOKEN:c.id==='slack'?(env.SLACK_BOT_TOKEN||env.SLACK_USER_TOKEN):c.id==='discord'?env.DISCORD_BOT_TOKEN:null;if(!tok)return null;
 const k=agent+'|'+c.id,fp=createHash('sha1').update(tok).digest('hex').slice(0,8);identDb||=await (identLoad||=readFile(IDENT_FILE,'utf8').then(JSON.parse).catch(()=>({})));const s=identDb[k];   // one load for every channel asked at once (each its own copy lost the others' answers)
 if(s&&s.fp===fp&&Date.now()-s.t<(s.err||s.miss?10*60e3:6*3600e3)&&!(c.id==='slack'&&s.v&&!s.v.team))return {account:s.v||null,error:s.err||null};
 const bad=m=>Object.assign(new Error(m),{bad:true}),sig=AbortSignal.timeout(6000);let v=null,err=null,miss=false;
 try{if(c.id==='telegram'){const j=await fetch('https://api.telegram.org/bot'+tok+'/getMe',{signal:sig}).then(r=>r.json());if(!j.ok)throw bad('Telegram rejected the bot token ('+(j.description||j.error_code||'refused')+')');v={username:'@'+j.result.username,name:j.result.first_name||null,kind:'bot'}}
  else if(c.id==='slack'){const j=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{authorization:'Bearer '+tok},signal:sig}).then(r=>r.json());if(!j.ok)throw bad('Slack rejected the token ('+(j.error||'refused')+')');v={username:j.user?'@'+j.user:null,name:j.team||null,team:j.team_id||null,kind:tok.startsWith('xoxp-')?'person':'bot'}}
  else{const r=await fetch('https://discord.com/api/v10/users/@me',{headers:{authorization:'Bot '+tok},signal:sig});const j=await r.json().catch(()=>({}));if(!r.ok)throw bad('Discord rejected the bot token ('+(j.message||'HTTP '+r.status)+')');v={username:'@'+j.username,name:j.global_name||null,kind:'bot'}}}
 // a rejected token is reported; the service not answering (a network blip) keeps the last good answer and asks again in 10 min
 catch(e){if(e.bad)err=e.message;else{miss=true;v=s?.fp===fp?s.v||null:null}}
 identDb[k]={fp,v,err,miss,t:Date.now()};await writeJsonAtomic(IDENT_FILE,identDb).catch(()=>{});return {account:v,error:err}}
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
  c.state=last[1]==='connected'?'connected':last[1]==='disconnected'?'disconnected':'failed';if(c.state==='connected'){c.configured=true;c.enabled=true}
  // when: the timestamp that line starts with (the same "YYYY-MM-DD HH:MM:SS" gatewayWatch reads)
  const ls=log.lastIndexOf('\n',last.index)+1,t=Date.parse(log.slice(ls,ls+19).replace(' ','T')+'Z');if(t)c.updated_at=new Date(t).toISOString()}}
async function channelAccounts(agent,v){await trueStates(agent,v).catch(()=>{});const list=v?.platforms||v;if(!Array.isArray(list))return;const ps=await pausedLoad();for(const c of list)if(ps[agent+'|'+c.id]){c.paused=true;c.state='paused'}const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent);
 const w=list.find(x=>x.id==='whatsapp');
 if(w){try{const c=JSON.parse(await readFile(path.join(home,'platforms','whatsapp','session','creds.json'),'utf8'));const id=String(c.me?.id||c.me?.lid||'');const digits=id.split('@')[0].split(':')[0].replace(/\D/g,'');
   w.account={phone:digits?'+'+digits:null,name:c.me?.name||c.me?.verifiedName||null}}catch{}
  const err=(w.error_code||'')+' '+(w.error_message||'');const log=await readFile(path.join(home,'platforms','whatsapp','bridge.log'),'utf8').then(t=>t.slice(-3000)).catch(()=>'');
  const lastOut=log.lastIndexOf('Logged out'),lastOk=log.lastIndexOf('WhatsApp connected');
  w.needs_link=!w.paused&&w.state!=='connected'&&(!!w.account||w.configured)&&(/logged out|died|exit|bridge_exited|unlinked/i.test(err)||lastOut>lastOk)}
 // every other channel: the bot or address it is (Slack also says whether it posts as a bot app or a person's own account)
 const env=await envOf(agent);
 await Promise.all(list.map(async c=>{if(c.id==='whatsapp'||['api_server','webhook'].includes(c.id)||!(c.configured||c.state==='connected'||c.paused))return;
  const r=await channelIdentity(agent,c,env).catch(()=>null);if(!r)return;c.account=r.account||null;if(r.error)c.identity_error=r.error}));
 // what kind of account each one is: a bot, or someone's own account
 for(const c of list){if(!c.account)continue;c.account.kind??=c.id==='whatsapp'?'person':/^(telegram|discord)$/.test(c.id)?'bot':undefined}
 const notes=await readFile(path.join(DATA,'channel-notes.json'),'utf8').then(JSON.parse).catch(()=>({}));for(const c of list){const n=notes[agent+'|'+c.id];if(n)c.note=n}}
// The main agent's list takes seconds (each channel is checked), and many screens ask for it, so the last answer
// is used at once and refreshed behind the scenes (a change on the Channels page clears it, so that stays exact).
function platformsCached(agent){const k=agent||'default';const c=platCache.get(k);if(c&&(c.p||Date.now()-c.t<15000))return c.p||Promise.resolve(c.v);
 if(c?.v&&Date.now()-c.t<600000){if(!c.r){c.r=1;platformsFresh(k).catch(()=>{})}return Promise.resolve(c.v)}
 return platformsFresh(k)}
function platformsFresh(k){const old=platCache.get(k),at=platCache.stamp(k);
 const p=fetch(DASH.origin+'/api/messaging/platforms?profile='+encodeURIComponent(k),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(async r=>{const v=await r.json();if(!r.ok)throw Object.assign(new Error(v.detail||'HTTP '+r.status),{status:r.status});await trueWhatsApp(k,v);await channelAccounts(k,v).catch(()=>{});if(platCache.stamp(k)===at)platCache.set(k,{t:Date.now(),v});return v}).catch(e=>{if(platCache.stamp(k)===at){if(old?.v)platCache.set(k,{t:Date.now()-10000,v:old.v});else platCache.delete(k,true)}throw e});   // a failed read is no change: the team list stays
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
 // who may write stays as chosen: "ask first" (pairing) only when no policy was ever saved
 const env={WHATSAPP_ENABLED:'true',WHATSAPP_MODE:String(b.mode||st.mode||'bot')};if(!(await envOf(agent)).WHATSAPP_DM_POLICY)env.WHATSAPP_DM_POLICY='pairing';if(b.allowed_users)env.WHATSAPP_ALLOWED_USERS=String(b.allowed_users);
 const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp'+pq,{method:'PUT',headers:h,body:JSON.stringify({enabled:true,env,profile:agent})});const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.detail||j.error||'Could not switch WhatsApp on.');
 platCache.clear();waPrepOff.delete(agent);const waiting=await waitingNow();
 if(!j.hot_served)restartGateway('WhatsApp linked on '+agent).catch(()=>{});
 console.log('whatsapp linked on',agent,st.account_phone?'(+'+st.account_phone+')':'',j.hot_served?'· picked up live':'· engine restarting');
 setTimeout(()=>syncNotifyTool().catch(()=>{}),20000);
 return {ok:true,hot_served:!!j.hot_served,restarting:!j.hot_served,waiting,account:{phone:st.account_phone?'+'+st.account_phone:null,name:st.account_name||null}}}
// the process list, read once for everyone asking within 3 s: the channel list ran ps per WhatsApp channel, and every
// check and the guard ran it again (lines: "pid etime args"). Killing something forgets it.
let psHit=null;
function psList(){if(psHit&&Date.now()-psHit.t<3000)return psHit.p;const p=import('node:child_process').then(({execFile})=>new Promise(r=>execFile('ps',['-eo','pid=,etime=,args='],{maxBuffer:8e6},(e,o)=>r(String(o||'')))));psHit={t:Date.now(),p};return p}
// every bridge.js using this agent's WhatsApp login (or only the pairing one)
async function stopBridges(agent,{pairOnly=false}={}){const dir=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'platforms','whatsapp','session');
 const {execFile}=await import('node:child_process');const out=await new Promise(r=>execFile('ps',['-eo','pid=,args='],(e,o)=>r(String(o||''))));
 const pids=out.split('\n').filter(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)&&(!pairOnly||l.includes('--pair-only'))).map(l=>+l.trim().split(/\s+/)[0]).filter(Boolean);
 for(const pid of pids){try{process.kill(pid,'SIGTERM')}catch{}}if(pids.length)await new Promise(r=>setTimeout(r,1500));for(const pid of pids){try{process.kill(pid,'SIGKILL')}catch{}}if(pids.length)psHit=null;return pids.length}
/* Has this agent's WhatsApp setting changed since its bridge started? The bridge reads WHATSAPP_* once, at start.
   Most exact (Linux): the running bridge's own environment (/proc/<pid>/environ) against the .env now. Otherwise a bridge
   process seen for the first time takes the WHATSAPP_* lines as they are now as its baseline (other .env writes, such as a
   Slack or key sync, never count), and only a later change to those lines is pending until it restarts (Reconnect).
   Remembered per agent in bridge-env.json: the process and the hash of its WHATSAPP_* settings (wa). */
const BRIDGE_ENV=path.join(DATA,'bridge-env.json');let bridgeEnv=null;
async function bridgeInfo(agent){const dir=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'platforms','whatsapp','session');
 const out=await psList();
 const l=out.split('\n').find(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)&&!l.includes('--pair-only'));const m=l&&/^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s/.exec(l);   // etime is [[dd-]hh:]mm:ss on Linux and macOS alike
 return m?{pid:+m[1],start:Date.now()-((+(m[2]||0)*24+ +(m[3]||0))*60+ +m[4])*60000-(+m[5])*1000}:null}
async function waSettingsPending(agent){try{
 const info=await bridgeInfo(agent);if(!info)return false;
 const file=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'.env');const text=await readFile(file,'utf8').catch(()=>null);if(text==null)return false;
 const now=Object.fromEntries(Object.entries(envParse(text)).filter(([k])=>k.startsWith('WHATSAPP_')));
 // what the bridge really started with: a setting it was given that now differs is pending. Only keys it has count: the
 // rest (WHATSAPP_DM_POLICY and the like) are read by the engine, not handed to the bridge, so they never wait on it
 const envi=await readFile('/proc/'+info.pid+'/environ','utf8').catch(()=>null);
 if(envi){const run={};for(const kv of envi.split('\0')){const i=kv.indexOf('=');if(i>0&&kv.startsWith('WHATSAPP_'))run[kv.slice(0,i)]=kv.slice(i+1)}
  // a list (allowed users, group lists) is the same list in another order or spacing: the engine reorders it when it starts the bridge
  const same=(a,b)=>{const n=x=>String(x).split(/[,;\s]+/).map(y=>y.trim()).filter(Boolean).sort().join(',');return a===b||n(a)===n(b)};
  if(Object.keys(run).length)return Object.entries(now).some(([k,v])=>k in run&&!same(run[k],v))}
 const hash=createHash('sha1').update(Object.keys(now).sort().map(k=>k+'='+now[k]).join('\n')).digest('hex');
 bridgeEnv||=await readFile(BRIDGE_ENV,'utf8').then(JSON.parse).catch(()=>({}));const s=bridgeEnv[agent];
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(BRIDGE_ENV+'.tmp',JSON.stringify(bridgeEnv));await rename(BRIDGE_ENV+'.tmp',BRIDGE_ENV)};
 if(!s||s.pid!==info.pid||Math.abs(s.start-info.start)>5000||!s.wa){bridgeEnv[agent]={pid:info.pid,start:info.start,wa:hash};await save();return false}   // first sight (or a record from before this rule): its baseline
 return s.wa!==hash}catch{return false}}
/* Channel checks. "Check connection" asks the engine fresh and, for WhatsApp, also looks for its running bridge.
   Every 2 hours (live app) every agent's channels are checked the same way; a logged-out or failing one is listed
   in /ui/channels/attention, which the app shows as a pop-up with Link again / Remove. */
// which account a channel is, in the app's words (accountText in core.js): its name · its handle
const acctText=a=>a?[a.name,a.phone||a.username||a.email].filter(Boolean).join(' · '):'';
async function checkChannel(agent,platform){platCache.delete(agent);const pl=await platformsCached(agent);const c=(pl?.platforms||pl||[]).find(x=>x.id===platform);
 if(!c)return {state:'missing',connected:false,text:'This channel is not set up on '+(NAMES[agent]||agent)+'.'};
 if(c.paused)return {agent,platform,state:'paused',connected:false,paused:true,account:c.account||null,text:'Paused: still linked'+(c.account?' ('+acctText(c.account)+')':'')+', but no agent answers it. Pick an agent under Owned by to turn it back on.'};
 let bridge=true;if(platform==='whatsapp'){const dir=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'platforms','whatsapp','session');
  const out=await psList();bridge=out.split('\n').some(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--session '+dir)&&!l.includes('--pair-only'))}
 const connected=c.state==='connected'&&bridge;const pending=platform==='whatsapp'&&connected&&await waSettingsPending(agent);const acct=c.account?' ('+acctText(c.account)+')':'';
 const text=connected?'Connected'+acct+'. Messages are coming in.'+(pending?' WhatsApp settings changed after this connection started: reconnect it to apply them.':''):c.needs_link?'Logged out'+acct+': the phone removed this linked device, or WhatsApp ended the link. Link it again with a fresh QR code, or remove it.':
  c.state==='connected'&&!bridge?'The engine says connected, but the WhatsApp connection is not running. Restart the engine, or link it again.':
  /retrying|connecting|starting/.test(c.state||'')?'Reconnecting right now. Check again in a minute.':(c.enabled===false?'Switched off.':'Not connected'+(c.error_message?': '+String(c.error_message).replace(/\s*\(see \/[^)]*\)/,'').slice(0,160):'.'));
 return {agent,platform,state:c.state,connected,pending,needs_link:!!c.needs_link,account:c.account||null,text}}
/* Approve a person before they message: the engine keeps each agent's approved people in
   <home>/platforms/pairing/<platform>-approved.json ({<id>: {user_name, approved_at}}) and re-reads it when the file changes
   (its cache is keyed on the file itself, so a replaced file is seen on the next message). There is no engine call to add one
   without a pairing code, so the engine's own store does it (its file lock, its ID rules, its allowlist mirror); only if that
   cannot run is the file written here in the same shape (tmp + rename, one write at a time, other entries kept as they are).
   Who added whom, with the note, is kept in approvals-added.json for the "Added by hand" mark. */
const ADDED_FILE=path.join(DATA,'approvals-added.json');
// one change at a time (two adds at once each read the old file and one was lost); a file that does not parse is left alone
let addedChain=Promise.resolve();const editAdded=fn=>{const r=addedChain.then(async()=>{const all=await readFile(ADDED_FILE,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return {};throw e});if(!all||typeof all!=='object'||Array.isArray(all))throw Error('approvals-added.json is not in the expected shape');if(fn(all)!==false)await writeJsonAtomic(ADDED_FILE,all)});addedChain=r.catch(()=>{});return r};
const PERSON_HELP={whatsapp:'WhatsApp',telegram:'Telegram',slack:'Slack',discord:'Discord',email:'Email'};
function personId(pf,raw){let v=String(raw||'').trim();if(!v)throw new Error('Type their ID first.');
 if(pf==='whatsapp'){v=v.replace(/[\s().-]/g,'');if(/^0(?!0)/.test(v))throw new Error('Add the country code instead of the leading 0, for example the country code then the number, e.g. 15551234567.');
  v=v.startsWith('+')?v.slice(1):v.startsWith('00')?v.slice(2):v;if(!/^\d{8,15}$/.test(v))throw new Error('Type the WhatsApp number with its country code, digits only, for example 6281234567890.');return v}
 if(pf==='telegram'){if(v.startsWith('@')||/[a-z]/i.test(v))throw new Error('A Telegram bot cannot look up an @username before that person has written to it. Use their numeric user ID: ask them to message @userinfobot, which replies with it.');
  if(!/^\d{5,15}$/.test(v))throw new Error('A Telegram user ID is a number, like 123456789.');return v}
 if(pf==='slack'){v=v.toUpperCase();if(!/^[UW][A-Z0-9]{6,20}$/.test(v))throw new Error('A Slack member ID starts with U or W, like U0123ABCD. In Slack: their profile, ⋮, Copy member ID.');return v}
 if(pf==='discord'){if(!/^\d{15,21}$/.test(v))throw new Error('A Discord user ID is a long number. In Discord: Settings, Advanced, switch on Developer Mode, then right-click the person and Copy User ID.');return v}
 if(pf==='email'){v=v.toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new Error('Type a full email address, like name@example.com.');return v}
 throw new Error('Adding people by hand works for WhatsApp, Telegram, Slack, Discord and email.')}
const samePerson=allowSame;   // allowlist.mjs (1 Nov 2026)
let approveChain=Promise.resolve();
async function approvePerson(agent,pf,id,name){const home=agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent);
 const run=approveChain.then(async()=>{const py=await enginePython().catch(()=>null);
  if(py){const {execFile}=await import('node:child_process');const code='import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom gateway.pairing import PairingStore\ns=PairingStore(sys.argv[2] or None)\nwith (s._locked() if hasattr(s,"_locked") else s._lock):\n    s._approve_user(sys.argv[3],sys.argv[4],sys.argv[5])\nprint(json.dumps({"ok":True,"dir":str(s._dir)}))';
   const out=await new Promise(r=>execFile(py,['-c',code,path.join(HERMES_HOME,'hermes-agent'),agent==='default'?'':agent,pf,id,name],{timeout:30000,cwd:path.join(HERMES_HOME,'hermes-agent'),env:{...process.env,HERMES_HOME:HERMES_HOME}},(e,o,er)=>{if(e)return r({err:String(er||e.message).trim().split('\n').pop()});let d=null;try{d=JSON.parse(String(o).trim().split('\n').pop())}catch{}r({ok:true,dir:String(d?.dir||'')})}));
   // only when the engine's store wrote into this agent's own pairing folder (a wrong one would approve them elsewhere)
   const want=path.join(home,'platforms','pairing'),got=out.ok&&out.dir?await realpath(out.dir).catch(()=>out.dir):'';
   if(out.ok&&got&&(got===want||got===await realpath(want).catch(()=>want)))return 'engine';
   console.warn('approve person: '+(out.ok?'the engine store used '+(out.dir||'no folder')+', not '+want:'the engine store did not run ('+out.err+')')+', writing the file directly')}
  const f=path.join(home,'platforms','pairing',pf+'-approved.json');await mkdir(path.dirname(f),{recursive:true});
  const cur=await readFile(f,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return {};throw new Error('The approved list for '+pf+' could not be read, so nothing was changed.')});
  if(!cur||typeof cur!=='object'||Array.isArray(cur))throw new Error('The approved list for '+pf+' is not in the shape expected, so nothing was changed.');
  cur[id]={user_name:name,approved_at:Date.now()/1000};const t=f+'.'+process.pid+'.'+Date.now().toString(36)+'.tmp';await writeFile(t,JSON.stringify(cur,null,2),{mode:0o600});await rename(t,f);return 'file'});
 approveChain=run.catch(()=>{});return run}
let attention={t:0,list:[]};
async function channelAttention(fresh){if(!fresh&&Date.now()-attention.t<10*60e3)return attention.list;const list=[];
 for(const a of await listAllProfiles()){if(fresh)platCache.delete(a);const pl=await platformsCached(a).catch(()=>null);
  for(const c of (pl?.platforms||pl||[])){if(['api_server','webhook'].includes(c.id)||!(c.configured||c.account))continue;
   if(!c.paused&&(c.needs_link||(c.enabled&&/fatal|error|failed/.test(c.state||''))))list.push({agent:a,base:a.split('--')[0],id:c.id,name:c.name,account:c.account||null,needs_link:!!c.needs_link,state:c.state})}}
 // since: when it first went wrong (Bottlenecks keys on it), kept on disk so a restart of aqeelOS does not bring Cleared items back
 const SF=path.join(DATA,'channel-since.json'),was=await readFile(SF,'utf8').then(JSON.parse).catch(()=>({})),now={};for(const x of list){const k=x.agent+'|'+x.id;x.since=was[k]||Date.now();now[k]=x.since}
 if(JSON.stringify(now)!==JSON.stringify(was))await writeFile(SF,JSON.stringify(now)).catch(()=>{});
 const before=new Map(attention.list.map(x=>[x.agent+'|'+x.id,x]));
 for(const x of list)if(!before.has(x.agent+'|'+x.id))console.warn('channel check:',x.name,'on',x.agent,x.needs_link?'is logged out':'is '+x.state);
 attention={t:Date.now(),list};return list}
if(LIVE_APP){setTimeout(()=>channelAttention(true).catch(()=>{}),90e3);setInterval(()=>channelAttention(true).catch(()=>{}),2*3600e3).unref()}
/* WhatsApp that stays connected. Every 10 minutes (live app) a linked number that dropped is reconnected on its own,
   with its saved login (no new QR): only that number's connection restarts, never the engine. The main agent's own
   channels live inside the engine, so those are only reported (a pop-up and Bottlenecks say so). A number is tried at
   most 3 times in 6 hours; after that it waits for a person. Once a day every WhatsApp login is backed up (last 3 kept),
   so a damaged login can be put back instead of linking again. */
const waTries=new Map(),waLinking=new Map(),reconnectAsked=new Map(),waPrepOff=new Map();   // waPrepOff: agent → the login set aside by a prepare that switched WhatsApp off   // agent → when someone last started linking its WhatsApp
async function reconnectOne(ag,pf){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
 // a paused channel stays off: switching it on would answer while the page still says Paused
 if((await pausedLoad())[ag+'|'+pf])throw new Error('This channel is paused. Pick who answers it under Owned by first.');
 // the engine's answer counts, not just that it answered: a refused off or on is an error, not "reconnected"
 const put=on=>fetch(DASH.origin+'/api/messaging/platforms/'+pf+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:on,env:{},profile:ag}),signal:AbortSignal.timeout(30000)}).then(async r=>({ok:r.ok,j:await r.json().catch(()=>({}))}),e=>({ok:false,j:{detail:e.message}}));
 const why=x=>x.j.detail||x.j.error||'no answer';
 const off=await put(false);if(!off.ok)throw new Error('The engine did not switch '+pf+' off ('+why(off)+'), so nothing changed.');
 if(pf==='whatsapp')await stopBridges(ag).catch(()=>{});await new Promise(r=>setTimeout(r,2500));
 let on=await put(true);if(!on.ok){await new Promise(r=>setTimeout(r,3000));on=await put(true)}platCache.delete(ag);attention.t=0;   // the on is tried twice
 if(!on.ok)throw new Error(pf+' was switched off, but the engine did not switch it back on ('+why(on)+'). Press Reconnect again.');return on.j}
async function waGuard(){if(gwRestarting)return;
 for(const a of await listAllProfiles()){if(a==='default')continue;
  const sess=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'platforms','whatsapp','session');if(!await stat(path.join(sess,'creds.json')).catch(()=>null))continue;
  if(Date.now()-(waLinking.get(a)||0)<20*60e3)continue;{const ps=await psList();if(ps.split('\n').some(l=>/whatsapp-bridge\/bridge\.js/.test(l)&&l.includes('--pair-only')&&l.includes(sess)))continue}
  const st=await checkChannel(a,'whatsapp').catch(()=>null);if(!st||st.state==='missing'||st.state==='not_configured'||st.paused||st.connected||st.needs_link)continue;
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
if(LIVE_APP){setInterval(()=>waGuard().catch(e=>console.warn('whatsapp guard',e.message)),10*60e3).unref();setTimeout(()=>waBackup().catch(()=>{}),5*60e3).unref();setInterval(()=>waBackup().catch(()=>{}),6*3600e3).unref()}
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
const secretAccess=createSecretAccess({sharing:shareLevels,secretDir,exists:async f=>!!await stat(f).catch(()=>null)});
const RESERVED_KEY=/^(API_SERVER_|HERMES_|TELEGRAM_|WHATSAPP_|SLACK_|DISCORD_|SIGNAL_|MATRIX_|EMAIL_|SMS_|TWILIO_|GATEWAY_|DASHBOARD_|UI_)|_BASE_URL$|^(PATH|HOME|NODE_OPTIONS|PYTHONPATH|LD_PRELOAD)$/;
async function saveSecret(base,name,value,{admin=false}={}){if(!admin&&RESERVED_KEY.test(name))throw new Error(name+' is part of how aqeelOS itself is wired; pick another name for this secret.');const home=base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base);
 await editEnv(path.join(home,'.env'),cur=>{const lines=cur.split('\n').filter(l=>!l.startsWith(name+'='));while(lines.length&&lines[lines.length-1]==='')lines.pop();return [...lines,name+'='+value.replace(/[\r\n]/g,''),''].join('\n')});
 const dir=secretDir(base);await mkdir(dir,{recursive:true,mode:0o770});await writeFile(path.join(dir,name),value,{mode:0o660});await secretAccess.saved(base,name)?.catch(()=>{})}   // group-shared: an agent with its own user reads its own lock box; still closed to other agents
const secretHow=(base,name)=>'To enter it on your screen, click the field and call type_secret with name '+name+'. In a command use "$(cat ~/workspaces/'+base+'/.secrets/'+name+')". Never print, echo or show the value.';
async function useSecret(rec,value,{admin=false}={}){
 if(rec.mode==='type'){await screens.typeInto(rec.base,value,{enter:rec.enter,secret:true});return 'Typed it into the focused field on your screen'+(rec.enter?' and pressed Enter':'')+'. You never saw the value; take a screenshot to check the result.'}
 await saveSecret(rec.base,rec.name,value,{admin});
 return 'Saved as '+rec.name+' in your settings (the engine and its tools read it from there). '+secretHow(rec.base,rec.name)}
/* One-time secret links (secret-links.mjs, 4 Nov 2026): request_secret_link gives the agent a link to send on Telegram or
   WhatsApp; the person opens it on their phone, outside aqeelOS, and the value is saved like ask_secret's "save" (never as
   an admin, so the keys that wire aqeelOS stay out of reach). The page (/secret) is public: the token after # is the credential. */
const secretLinks=createSecretLinks({DATA,PUBLIC_URL,save:(base,name,value)=>saveSecret(base,name,value),reserved:n=>RESERVED_KEY.test(n),
 isAgent:async a=>a!==HELP_AGENT&&!a.includes('--')&&await isAgent(a)&&!(LIVE_APP&&await isTestAgent(a)),nameOf:a=>agentName(a),
 exists:async(base,name)=>!!await stat(path.join(secretDir(base),name)).catch(()=>null)||(await readFile(path.join(base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base),'.env'),'utf8').catch(()=>'')).split('\n').some(l=>l.replace(/^\s*export\s+/,'').startsWith(name+'=')),
 tell:(text,detail)=>bottlenecks.event('secrets',text,detail,{info:true})});
const secretHits=createLimiter(30,600e3);
// Kirimdev lines (kirimdev.mjs, audit 5 Nov 2026): the team's WhatsApp CRM, through its API key; not the agents' own
// WhatsApp channel. Replaces the bridge script; live box only
// Team group per agent (team-group.mjs, brief item 8): Telegram group and topics; every change is shown in the bell
const teamGroups=createTeamGroups({DATA,tell:async(a,before,g)=>{const t=x=>x?.chatId?(x.name||x.chatId)+' · '+TEAM_ROLES.map(([k,l])=>l+' '+(x.topics?.[k]??'-')).join(', '):'none';
 await bottlenecks.event('team-group',(NAMES[a]||a)+'’s team group changed','By '+(g.by||'?')+'.\nBefore: '+t(before)+'\nNow: '+t(g),{info:true}).catch(()=>{});if(LIVE_APP)writeAgentContext().catch(()=>{})}});
const kirimdev=createKirimdev({DATA,WORK:path.join(homedir(),'workspaces'),PUBLIC_URL,log:m=>console.log(m),teamGroup:a=>teamGroups.get(a),
 problem:(a,topic,title,detail)=>health.problem(a,String(topic).startsWith('kirimdev|')?'kirimdev':'handoff',title,{topic,fix:detail}),solved:(a,topic)=>health.ok(a,topic),
 // a new API key (checked with Kirimdev first): aqeelOS's copy, and the copy in each line's workspace that its scripts use
 // (.tools/kirim reads .secrets/KIRIMDEV_API_KEY); written in place, so their owner and access stay as they are
 saveKey:async(key,agents)=>{if(!LIVE_APP)throw Error('Only on the live box.');const dir=path.join(HERMES_HOME,'secrets'),f=path.join(dir,'kirimdev.env');await mkdir(dir,{recursive:true,mode:0o700});
  const t=f+'.'+process.pid+'.tmp';await writeFile(t,'KIRIMDEV_API_KEY='+key+'\n',{mode:0o600});await rename(t,f);
  for(const a of agents){const w=path.join(homedir(),'workspaces',a,'.secrets','KIRIMDEV_API_KEY');if(await readFile(w,'utf8').then(()=>true,()=>false))await writeFile(w,key+'\n').catch(e=>console.warn('kirimdev key copy',a,e.message))}
  console.log('kirimdev: a new API key was saved (ending '+key.slice(-4)+')')},
 apiKey:async()=>{if(!LIVE_APP)return null;const t=await readFile(path.join(HERMES_HOME,'secrets','kirimdev.env'),'utf8').catch(()=>'');return (/^KIRIMDEV_API_KEY=["']?([^"'\s]+)/m.exec(t)||[])[1]||null},
 runAgent:createKirimdevAgent({DATA,home:homedir(),live:LIVE_APP,customer:()=>customerTools}),describeImage:createImageReader({home:homedir(),live:LIVE_APP}),
 paidSince:(a,ph,t)=>customerTools.paidSince(a,ph,t),
 telegram:async(a,chatId,threadId,text)=>{const t=await readFile(path.join(HERMES_HOME,'profiles',a,'.env'),'utf8').catch(()=>'');const tok=(/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(t)||[])[1];if(!tok||!LIVE_APP)return false;
  const r=await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,...(threadId?{message_thread_id:threadId}:{}),text:text.slice(0,4000)}),signal:AbortSignal.timeout(30000)}).catch(()=>null);
  const j=r&&r.ok?await r.json().catch(()=>({})):{};return j.ok?(j.result?.message_id||true):false},   // the post's id once Telegram confirmed it
 activity:(a,title,text)=>news.add({aud:'admins',icon:'tag',kind:'blue',title,text,go:'/channels/kirimdev',label:'Kirimdev'}),
 tell:(text,detail)=>bottlenecks.event('kirimdev',text,detail,{info:true})});
if(LIVE_APP)setTimeout(()=>kirimdev.resume().catch(e=>console.warn('kirimdev resume',e.message)),30000).unref();
// a confirmed payment labels the contact (Customer, S-…, no Checkout): code, every minute, on the live box only
// a paid order goes to the line's Orders topic with the same check (8 Nov 2026)
const lineOrders=async a=>{const l=(await kirimdev.lines().catch(()=>({})))[a],o=l?.orders;return o?.chatId?{chatId:o.chatId,threadId:o.threadId||null,persona:l.persona||a,currency:l.payment?.currency||'',context:l.payment?.orderContext||null}:null};
const paidLabels=createPaidLabels({DATA,WORK:path.join(homedir(),'workspaces'),label:(a,o)=>kirimdev.labelContact(a,o),orders:lineOrders,post:(a,t,text)=>kirimdev.teamPost(a,t.chatId,t.threadId,text),failed:(a,topic,title,detail)=>health.problem(a,'handoff',title,{topic,fix:detail})});
if(LIVE_APP)setInterval(()=>paidLabels.tick().catch(e=>console.warn('paid labels',e.message)),60e3).unref();
// the labels a line's agent may set (Line settings) that Kirimdev still has, and Kirimdev's S- labels for create_payment
async function kirimdevLabelRules(a){const l=(await kirimdev.lines().catch(()=>({})))[a];if(!l)return {};const all=await kirimdev.labelList().catch(()=>null);if(!all)return {allowed:l.labels?.allowed||[]};
 const names=new Set(all.map(x=>x.name));return {allowed:(l.labels?.allowed||[]).filter(n=>names.has(n)),sales:all.map(x=>x.name).filter(n=>/^S-/.test(n)).sort()}}
// what the Connect dialog offers (7 Nov 2026): the agents, the Telegram groups this agent is in or another agent's team
// group uses (with the topics known for each), and the payment helpers in the agent's own folder
async function kirimdevSetup(agent){const ags=await listAgents(),L=await kirimdev.lines().catch(()=>({})),TG=await teamGroups.all().catch(()=>({}));
 const test=await Promise.all(ags.map(a=>isTestAgent(a).catch(()=>false))),agents=ags.filter((a,i)=>a!=='default'&&!test[i]).map(a=>({id:a,name:NAMES[a]||a,line:!!L[a]}));
 const groups=new Map(),add=(id,o)=>{const k=String(id);if(!/^-?\d{5,16}$/.test(k))return;const g=groups.get(k)||{chatId:k,name:'',topics:[],own:false};
  if(o.name&&!g.name)g.name=o.name;if(o.own)g.own=true;for(const t of o.topics||[])if(!g.topics.some(x=>x.n===t.n))g.topics.push(t);groups.set(k,g)};
 for(const [a,g] of Object.entries(TG))if(g?.chatId)add(g.chatId,{name:g.name,own:a===agent,topics:Object.entries(g.topics||{}).filter(([,n])=>n).map(([k,n])=>({n:Number(n),label:(TEAM_ROLES.find(r=>r[0]===k)?.[1]||k)+' ('+(NAMES[a]||a)+')'}))});
 let helpers=[],cardHelpers=[];if(agent&&ags.includes(agent)){const home=path.join(HERMES_HOME,'profiles',agent),env=parseEnv(await readFile(path.join(home,'.env'),'utf8').catch(()=>''));
  for(const k of ['TELEGRAM_GROUP_ALLOWED_CHATS','TELEGRAM_GROUP_ALLOWED_USERS'])for(const id of String(env[k]||'').split(/[\s,]+/))if(/^-\d{5,16}$/.test(id))add(id,{own:true});
  const tools=path.join(homedir(),'workspaces',agent,'.tools');helpers=(await readdir(tools,{withFileTypes:true}).catch(()=>[])).filter(e=>e.isFile()&&/^(qris|pay|payment|xendit|invoice)[\w.-]*$/i.test(e.name)).map(e=>({path:'.tools/'+e.name,style:/^pay/i.test(e.name)?'send':'picture'}));cardHelpers=(await readdir(tools,{withFileTypes:true}).catch(()=>[])).filter(e=>e.isFile()&&/^card[\w-]*$/i.test(e.name)).map(e=>({path:'.tools/'+e.name}))}
 // the labels a person can allow the agent: Kirimdev's own, minus the ones only a person or a payment sets
 const labels=(await kirimdev.labelList().catch(()=>[])).map(x=>x.name).filter(n=>!LABEL_NEVER.test(n)).sort((a,b)=>a.localeCompare(b));
 return {agents,labels,cardHelpers,cardMax:DEFAULT_CARD_MAX,groups:[...groups.values()].sort((a,b)=>(b.own-a.own)||String(a.name).localeCompare(b.name)),helpers,team:agent?await teamGroups.get(agent).catch(()=>null):null}}
// after a line is made or removed: the agent's customer tools and its aqeelOS block follow
const kirimdevChanged=()=>{ensureCustomerServer().catch(e=>console.warn('customer tools',e.message));if(LIVE_APP)writeAgentContext().catch(()=>{})};
// customer runs get only these tools (customer-tools.mjs); the payment helper runs as the agent's own user
const custQ=x=>"'"+String(x).replace(/'/g,"'\\''")+"'";
let customerTools=null;
customerTools=createCustomerTools({WORK:path.join(homedir(),'workspaces'),DATA,payments:paidLabels,ordersOf:lineOrders,labelRules:a=>kirimdevLabelRules(a),labelContact:(a,o)=>kirimdev.labelContact(a,o),payRules:async a=>(await kirimdev.lines().catch(()=>({})))[a]?.payment||{},googleCall:(a,req)=>googleFiles.call(a,req),chatFind:(a,q,o)=>chatHistory.find(a,q,o),
 history:async(r,limit)=>{const q=new URLSearchParams({conversation_id:r.conversation,limit:String(limit)});if(!r.conversation)return 'No conversation.';
  const l=((await kirimdev._api(r.line+'/messages?'+q)).data||[]).filter(m=>m.type!=='reaction').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  return l.map(m=>m.created_at.slice(0,16).replace('T',' ')+' '+(m.direction==='inbound'?'CUSTOMER':'YOU')+': '+kirimdev.msgText(m)).join('\n')||'No messages.'},
 runAsAgent:async(a,tool,argv)=>{const c=await readConfig(a).catch(()=>null)||{};const user=String(pick(c,'terminal.ssh_user')||'');if(!/^ag-[\w-]+$/.test(user))return {ok:false,err:'this agent has no own user'};
  const W=path.join(homedir(),'workspaces',a);const {execFile}=await import('node:child_process');
  return new Promise(res=>execFile('ssh',['-i',path.join(HERMES_HOME,'agent-ssh','id_ed25519'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=20',user+'@127.0.0.1',
   'cd '+custQ(W)+' && '+custQ(tool)+' '+argv.map(custQ).join(' ')],{timeout:120e3,encoding:'utf8',maxBuffer:2e6},(e,out,err)=>res({ok:!e,out:out||'',err:err||(e?e.message:'')})))}});
// the support agents (a Kirimdev line) have the customer tool server in their settings; its key comes from each run
async function ensureCustomerServer(){if(!LIVE_APP)return;for(const a of Object.keys(await kirimdev.lines().catch(()=>({})))){const c=await readConfig(a).catch(()=>null);if(!c)continue;
 // no header (7 Nov 2026): the gateway serves customer runs over this one connection; each call carries its run key instead
 const want={url:'http://127.0.0.1:'+PORT+'/mcp/customer/'+a};const have=pick(c,'mcp_servers.aqeelos-customer');
 if(have?.url!==want.url||have?.headers){await setKey(a,'mcp_servers.aqeelos-customer',want);console.log('customer tools: set for',a,'(key per call)')}
 // a support agent never skips the engine's safety stop for scripts (6 Nov: execute_code and "-e/-c" were allowlisted, the two stops that held customer runs)
 const al=[].concat(pick(c,'command_allowlist')||[]);if(al.length){await setKey(a,'command_allowlist',[]);console.log('customer tools: removed the command allowlist of',a,'('+al.join(', ')+')')}}}
if(LIVE_APP)setTimeout(()=>ensureCustomerServer().catch(e=>console.warn('customer tools',e.message)),40000).unref();
/* Run rules (posting-limits.mjs, 5 Nov 2026): per agent, its schedules one at a time (one browser), and posting limits
   with a public, signed-out check of every post. Live box only: the gate script names this app's port, and checks run once */
const postingLimits=createPostingLimits({DATA,WORK:path.join(homedir(),'workspaces'),HERMES_HOME,PORT,live:LIVE_APP,
 reconnect:a=>withAgent(a,async()=>{const m=(x,b)=>fetch(`${DASH.origin}/api/mcp/servers${x}?profile=${encodeURIComponent(a)}`,{method:b?'POST':'DELETE',headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
  await m('/aqeelos-notify');const r=await m('',{name:'aqeelos-notify',url:`http://127.0.0.1:${PORT}/mcp/notify/${a}/${relay.sig(a)}`});if(!r.ok)throw Error('MCP '+r.status)}),sig:a=>relay.sig(a),setKey,readConfig,pick,nameOf:a=>NAMES[a]||a,
 // a post the public cannot see is an agent problem: System › Health, Bottlenecks and one alert to the owner (agent-health.mjs)
 event:(kind,text,detail,o)=>health.problem(o.agent,kind,text,{topic:o.topic,fix:detail}),
 telegram:async(a,chatId,threadId,text)=>{const t=await readFile(path.join(HERMES_HOME,'profiles',a,'.env'),'utf8').catch(()=>'');const tok=(/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(t)||[])[1];if(!tok||!LIVE_APP)return false;
  const r=await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,...(threadId?{message_thread_id:Number(threadId)}:{}),text:text.slice(0,4000),disable_web_page_preview:true}),signal:AbortSignal.timeout(30000)}).catch(()=>null);
  return !!(r&&r.ok&&(await r.json().catch(()=>({}))).ok)}});
if(LIVE_APP){setTimeout(()=>postingLimits.ensure().catch(e=>console.warn('posting gates',e.message)),20000).unref();setInterval(()=>postingLimits.tick(),60000).unref()}
/* "Run myself" (self-runs.mjs, 5 Nov 2026): run_self, run_self_status and run_self_list on their own tool server
   (aqeelos-self, one signed address per agent, from this box only), given to every agent with its own Linux user. The
   agent is the one in the signed address, never one it names; who asked is read from the chat the call is in. Settings,
   trusted people, the audit and Stop/Resume are on Automations › Runs itself. */
let SR_TZ=sysTz();const srTz=()=>readConfig('default').then(c=>{const z=installTz()||c?.timezone;if(z)SR_TZ=z}).catch(()=>{});srTz();setInterval(srTz,600e3).unref();
const srName=a=>agentName(a);
const srBox=createSelfRunsBox({HERMES_HOME,DATA,python:enginePython});
const srSig=a=>sign('self-runs:'+a).slice(0,32),srUrl=a=>`http://127.0.0.1:${PORT}/mcp/self/${a}/${srSig(a)}`;
const srDur=s=>s==null?'':s<60?s+' s':Math.round(s/60)+' min';
const SR_SAY={ok:'finished',failed:'failed',timeout:'ran out of time on',stopped:'stopped',interrupted:'lost (aqeelOS restarted during)'};
const SR_CHAT=new Set(['telegram','whatsapp','slack','discord','signal','matrix','mattermost']);
// the owner hears it where alerts go (ownerSend above), Telegram first when nothing is chosen
async function srToOwner(text){return ownerSend(text,'telegram')}
const selfRuns=createSelfRuns({DATA,nameOf:srName,day:t=>localAt(t,SR_TZ).date,hour:t=>localAt(t,SR_TZ).h,
 launch:srBox.launch,alive:srBox.alive,kill:srBox.kill,readExit:srBox.readExit,readOut:srBox.readOut,
 // the end of a run: in the chat it was asked from (a person's channel), else in the bell
 notify:async(r,answer)=>{const head=r.agentName+' '+(SR_SAY[r.state]||r.state)+' a run it started itself'+(r.secs!=null?' ('+srDur(r.secs)+')':'')+'. Reason: '+r.reason;const b=r.by||{};
  if(SR_CHAT.has(b.platform)&&b.chat){try{await relay.send({owner:r.agent,platform:b.platform,chat:String(b.chat)+(b.thread?':'+b.thread:''),text:head+(answer?'\n\n'+answer.slice(-700):'')});return}catch(e){console.warn('self-run notice',r.agent,e.message)}}
  await bottlenecks.event('selfruns',head,answer?answer.slice(-400):'',{info:true})},
 tellOwner:async(text,{quiet}={})=>{await bottlenecks.event('selfruns',text.split('\n')[0],text,quiet?{info:true}:{topic:'selfruns-'+text.slice(0,40),told:true}).catch(()=>{});await srToOwner(text).catch(e=>console.warn('self-runs: owner not told on a channel:',e.message))},
 bell:(text,detail)=>bottlenecks.event('selfruns',text,detail,{info:true})});
/* Agent health and alerts (agent-health.mjs, brief items 7 and 15, 5 Nov 2026): System › Health shows each agent fine or
   with its problems (the Bottlenecks items, grouped per agent, plus failed messages this week); every 5 minutes the live
   app checks schedules, failed messages and Telegram groups, and tells the owner on Telegram once about each new
   problem. Other features report their own checks with health.problem(agent,kind,text,{topic,fix}) and health.ok(agent,topic). */
// a problem of one agent: that agent fixes it first, in a run of its own (self-runs), before anyone is told (7 Nov 2026)
// names people remember, kept up by the agents themselves (7 Nov 2026): once a week each agent that has a skill or key
// with no plain description gets one run of its own to describe them with name_thing. Silent: nobody is messaged, and
// the owner never sees it unless he opens the agent's runs.
const homeOfA=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
async function ownSkills(a){const out=[];const root=path.join(homeOfA(a),'skills');let l=[];try{l=await readdir(root,{recursive:true})}catch{return out}
 for(const f of l){if(!/(^|\/)SKILL\.md$/.test(f)||/(^|\/)\./.test(f))continue;const t=await readFile(path.join(root,f),'utf8').catch(()=>'');const fm=/^---\s*\n([\s\S]*?)\n---/.exec(t)?.[1]||'';
  const name=(/^name:\s*(.+)$/m.exec(fm)?.[1]||path.basename(path.dirname(path.join(root,f)))).trim().replace(/^["']|["']$/g,'');out.push({name,desc:(/^description:\s*(.+)$/m.exec(fm)?.[1]||'').trim().replace(/^["']|["']$/g,'')})}
 return out}
async function namesTick(){if(!LIVE_APP)return;const F=path.join(DATA,'names-health.json');let st={};try{st=JSON.parse(await readFile(F,'utf8'))}catch{}st.asked??={};
 const [lab,keys]=await Promise.all([labels.all(),keysId.list().then(r=>r.items).catch(()=>[])]);let started=0;
 for(const a of await listAgents()){if(started>=3)break;if(Date.now()-(st.asked[a]||0)<7*86400e3)continue;
  const items=namesMissing({skills:await ownSkills(a),keys:keys.filter(k=>(k.agents||[])[0]===a),labels:lab});if(!items.length)continue;
  // the main agent (and any agent that cannot run itself): the next step of the same ladder, the fixer, still silent
  if(!await srEligible(a).catch(()=>false)){try{await issues.file({agent:a,what:'Things with no plain name or description',missing:items.slice(0,15).map(x=>x.what).join('; '),evidence:namesPrompt(items),proposed_fix:'Call name_thing (aqeelos-notify) for each one with a plain name and one line on what it is for.',origin:{}});st.asked[a]=Date.now();started++}catch(e){console.warn('names check',a,e.message)}continue}
  try{await selfRuns.start({agent:a,args:{prompt:namesPrompt(items),reason:'aqeelOS: name and describe '+items.length+' of your things',timeout_minutes:15},origin:{ok:true,by:{kind:'aqeelos',name:'aqeelOS names check'}},ws:path.join(homedir(),'workspaces',a)});
   st.asked[a]=Date.now();started++;console.log('names: asked',a,'to describe',items.length)}catch(e){console.warn('names check',a,e.message)}}
 await writeFile(F,JSON.stringify(st,null,1)).catch(()=>{})}
if(LIVE_APP){setTimeout(()=>namesTick().catch(e=>console.warn('names check',e.message)),15*60000).unref();setInterval(()=>namesTick().catch(()=>{}),6*3600e3).unref()}
// name_thing: an agent names and describes one of its own things (a skill it has, a key in its .env, an app in its setup)
async function nameThing(base,A){const kind=String(A.kind||''),id=String(A.id||'').trim();
 if(!okName(A.name)||!okDesc(A.description))return {isError:true,text:'Give a plain "name" (3 to 80 letters, not an id like MY_TOKEN) and a one-line "description" of what it is for (for a key, which account or user).'};
 if(kind==='skill'){if(!(await ownSkills(base)).some(s=>s.name===id))return {isError:true,text:'You have no skill called '+id+'.'}}
 else if(kind==='key'){const k=(await keysId.current()).get(id)||[...(await keysId.current()).values()].find(x=>x.name===id&&x.agents.includes(base));if(!k||!k.agents.includes(base))return {isError:true,text:'You have no key '+id+'. Use the id from the list you were given (NAME@code) or the key name.'};A={...A};return labels.set('key',k.id,{name:A.name,description:A.description}).then(()=>({text:'Saved: '+k.name+' is now "'+String(A.name).trim()+'".'}))}
 else if(kind==='mcp'){const c=await readConfig(base).catch(()=>null);if(!c?.mcp_servers?.[id])return {isError:true,text:'You have no app called '+id+'.'}}
 else return {isError:true,text:'kind is skill, key or mcp.'};
 await labels.set(kind,id,{name:A.name,description:A.description});return {text:'Saved: '+id+' is now "'+String(A.name).trim()+'".'}}
const healthFix=async(a,x)=>{if(!await srEligible(a))throw Error('it cannot run itself');
 const prompt='aqeelOS found a problem in your own work and you fix it yourself now, without asking anyone.\n\nProblem: '+String(x.title||'')+(x.detail?'\nDetails: '+String(x.detail).slice(0,3000):'')+
  '\n\nFind the cause (my_health, my_logs, my_runs, my_schedules, your files and scripts), fix it in your own work, and check it works again (run the schedule or script once). Do not message the owner or customers. If the fix needs something only a person can give (a password, a sign-in, a decision), file it with report_bottleneck and stop. End with two lines: what was wrong, what you changed.';
 return selfRuns.start({agent:a,args:{prompt,reason:'aqeelOS health: '+String(x.title||'').slice(0,120),timeout_minutes:20},origin:{ok:true,by:{kind:'aqeelos',name:'aqeelOS health check'}},ws:path.join(homedir(),'workspaces',a)})};
// 7 Nov 2026: Health tells nobody; the agent fixes its own problem first (healthFix), then it is filed for the fixer (issues.mjs)
const health=createAgentHealth({DATA,HERMES_HOME,bottlenecks,quiet:alertQuiet,fixFirst:(a,x)=>healthFix(a,x),fileIssue:o=>issues.file(o),healthGone:k=>issues.healthGone(k),
 // plain-code live checks (no model): the customer tools of each Kirimdev agent answer tools/list on the local route
 kirimdevAgents:async()=>Object.keys(await kirimdev.lines().catch(()=>({}))),
 customerTools:async a=>{const r=await fetch('http://127.0.0.1:'+PORT+'/mcp/customer/'+encodeURIComponent(a),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),signal:AbortSignal.timeout(10000)});const j=await r.json().catch(()=>null);return Array.isArray(j?.result?.tools)?j.result.tools.length:null},python:enginePython,link:PUBLIC_URL+'/#/system/health',
 listAgents:()=>listAgents(),nameOf:a=>agentName(a),
 engineUp:async()=>!gwStopped&&!gwRestarting&&!!await gatewayPid(),
 botToken:async a=>(/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'.env'),'utf8').catch(()=>''))||[])[1]||null,
 items:async()=>bottlenecks.list({admin:true,mayUse:()=>true,signins:[...signinsDue.values()],invites:[],accounts:await accountsApi.signedOut().catch(()=>[]),channels:await channelAttention(false).catch(()=>[])})});
/* Look it up first + issues and the fixer + escalations (chat-history.mjs, issues.mjs, escalations.mjs, 6 Nov 2026):
   an agent searches its own line's past chats (past_chats), files system problems as issues (report_bottleneck with
   system true, or file_issue) that the fixer on this box fixes, reloads and proves by itself, and Health counts how
   often the team still had to go to the main agent. Who is in which team is the team policy (DATA/team-policy.json). */
const chatHistory=createChatHistory({DATA});
async function replyInTopic(i,text){const b=i.by||{};if(!b.chat||!['telegram','whatsapp','slack','discord'].includes(b.platform)){await bottlenecks.event('issues',(NAMES[i.agent]||i.agent)+': '+text.slice(0,180),'',{info:true});return true}
 await relay.send({owner:i.agent,platform:b.platform,chat:String(b.chat)+(b.thread?':'+b.thread:''),text});return true}
/* Owner approvals as Telegram buttons (6 Nov 2026): the main agent's bot sends the question to the owner(s) named in
   the team policy with Approve / Decline buttons. The gateway keeps the only poller on that bot; its plugin
   aqeelos-issue-buttons catches presses ("aqi:…") and posts them to /issue-press here with the key in
   HERMES_HOME/secrets/issue-press.key. False (no bot, no owner id, Telegram refused) = the caller sends the link instead. */
const PRESS_KEY_FILE=path.join(HERMES_HOME,'secrets','issue-press.key');let PRESS_KEY=null;
const pressKey=async()=>{if(PRESS_KEY)return PRESS_KEY;PRESS_KEY=(await readFile(PRESS_KEY_FILE,'utf8').catch(()=>'')).trim();
 if(!PRESS_KEY){PRESS_KEY=randomBytes(24).toString('hex');await mkdir(path.dirname(PRESS_KEY_FILE),{recursive:true,mode:0o700});await writeFile(PRESS_KEY_FILE,PRESS_KEY,{mode:0o600})}return PRESS_KEY};
if(LIVE_APP)pressKey().catch(e=>console.warn('issue buttons: key',e.message));
/* The fixer loop's hooks (issues.mjs, 7 Nov 2026). busyNow = what /healthz reports as busy; a reload only happens at 0.
   A "needs a human" or "stuck" message to a team member goes to the agent's team group (Questions topic, else its own
   topic) with the member named; false when the agent has no team group, so the owner gets it instead. */
const busyNow=()=>busyTotal(   // the same sum as /healthz
 {live:liveCount(),setups:export_setups.running(),ops:opsBusy(),relay:relay.sending(),gwRestarting:!!gwRestarting,engineUpdate:engineUpd.busy(),restore:backups.busy()});
async function issueToTeam(agent,member,text){const g=await teamGroups.get(agent).catch(()=>null);if(!g?.chatId)return false;const topic=g.topics?.questions??g.topics?.own??null;
 const tag=[].concat(member?.telegram_names||[])[0];await relay.send({owner:agent,platform:'telegram',chat:String(g.chatId)+(topic?':'+topic:''),text:(tag?'@'+tag+' ':member?.name?member.name+': ':'')+text});return true}
// aqeelOS's own safe reload paths: the engine through restartGateway (it waits for agents at work, honours a restart hold
// and a restore), the web app through a clean exit (its keeper starts it again); never a raw "gateway restart" or kill
async function issueApply(kind,why){if(kind==='ui'){console.log('restarting the web app after',why);setTimeout(()=>process.exit(0),800);return {ok:true}}
 try{const h=JSON.parse(readFileSync(path.join(DATA,'restart-hold.json'),'utf8'));if(holdActive(h))return {ok:false,why:'restart hold: '+(h.why||'a build runs')}}catch{}
 if(restoreBusy())return {ok:false,why:'a restore runs'};
 await restartGateway(why,{waitMax:120});for(let k=0;k<24&&!await gatewayPid();k++)await new Promise(r=>setTimeout(r,5000));
 return await gatewayPid()?{ok:true}:{ok:false,why:'the engine did not come back yet'}}
const issueEnvFiles=async()=>[path.join(HERMES_HOME,'.env'),...(await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[])).map(a=>path.join(HERMES_HOME,'profiles',a,'.env'))];
const issues=createIssues({DATA,home:homedir(),bin:path.join(homedir(),'.local','bin','aqeelos'),fixerHome:homedir(),nameOf:a=>agentName(a),
 reply:replyInTopic,tellOwner:srToOwner,toTeam:issueToTeam,quiet:alertQuiet,busy:async()=>busyNow(),ready:async()=>!gwStopped&&!gwRestarting&&!!await gatewayPid(),apply:issueApply,engineOk:()=>inQuiet(new Date(),installTz()||process.env.TZ||''),envFiles:issueEnvFiles,
 // a proven fix for an agent's report closes the report too (it stays on Health until then, never in the popup)
 onFixed:async i=>{const k=String(i.healthKey||'');if(k.startsWith('report|'))await bottlenecks.done(k);else if(i.report)await bottlenecks.done('report|'+i.report)},
 // the sweep's checks (issues.mjs whyGone): is the problem an item is about gone by itself?
 checks:{apps:async a=>Object.keys((await readConfig(a).catch(()=>null)||{}).mcp_servers||{}),
  appSignedIn:async(a,n)=>!!await stat(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'mcp-tokens',n+'.json')).catch(()=>null),
  exists:async p=>!!await stat(String(p).replace(/^~(?=\/)/,homedir())).catch(()=>null),
  // the commits the box runs: each deploy writes their history next to the app (.deployed-commits)
  commitLive:async c=>(await readFile(path.join(root,'.deployed-commits'),'utf8').catch(()=>'')).split('\n').some(l=>l&&l.startsWith(c.toLowerCase())),
  // /home/claude/work/labels → the agent's own workspace/work/labels (its user's home is its workspace)
  ownCopy:async(a,p)=>{const rel=path.relative(homedir(),String(p));if(!rel||rel.startsWith('..'))return false;return !!await stat(path.join(homedir(),'workspaces',a,rel)).catch(()=>null)},
  changedSince:async(files,t)=>{for(const f of files){const st=await stat(f).catch(()=>null);if(st&&st.mtimeMs>t)return true}return false},
  activity:async(text)=>news.add({aud:'admins',group:'issues-expired|'+text.slice(0,60),icon:'clock',title:text,go:'/system/health',label:'Health'})},
 codeRoots:[{dir:root,prefix:''},{dir:path.join(HERMES_HOME,'hermes-agent'),prefix:'hermes-agent/'}]});
/* The one model call of the live checks (7 Nov 2026, owner: "save tokens"): once after each deploy (the app's code changed),
   a customer run on a Kirimdev agent whose line is in Test, with nothing sent (the run only returns text), must call
   read_file and answer with a line of the file it read (its greeting template). A failure is a Health problem. */
const smokeWatch=new Map();
async function customerSmoke(){if(!LIVE_APP)return;const F=path.join(DATA,'customer-smoke.json');
 const mark=String(Math.round((await stat(fileURLToPath(import.meta.url))).mtimeMs));const prev=JSON.parse(await readFile(F,'utf8').catch(()=>'{}')||'{}');if(prev.mark===mark)return;
 const L=await kirimdev.lines().catch(()=>({}));const a=Object.keys(L).find(k=>L[k]?.mode==='test');const done=async x=>{await writeFile(F,JSON.stringify({mark,at:Date.now(),agent:a||null,...x},null,1));console.log('customer smoke test:',a||'-',x.ok?'ok':'FAILED',x.detail||'')};
 if(!a)return done({ok:true,detail:'no Kirimdev line in Test, skipped'});
 const calls=[];const wrap={begin:o=>{const t=customerTools.begin(o);smokeWatch.set(t,calls);return t},end:t=>{smokeWatch.delete(t);customerTools.end(t)}};
 const run=createKirimdevAgent({DATA,home:homedir(),live:true,customer:()=>wrap});
 let out='';try{out=await run(a,'aqeelOS check after an update. There is no customer and nothing is sent. A new customer just wrote: "halo kak". Read your greeting template with read_file, then answer with exactly that greeting, word for word, and nothing else.',
  {session:'kirimdev-'+createHash('sha256').update('aqeelos-smoke|'+a+'|'+mark).digest('hex'),run:{line:L[a].phoneNumberId,conversation:'',phone:'',mode:'test'}})}catch(e){out='';calls.push({error:e.message})}
 const reads=calls.filter(c=>c.name==='read_file'&&c.path);let match=false;
 for(const c of reads){const t=await readFile(path.join(homedir(),'workspaces',a,c.path.replace(/^\/home\/[^/]+\/workspaces\/[^/]+\//,'')),'utf8').catch(()=>'');
  if(t.split('\n').map(x=>x.trim().replace(/^[-*>\s"]+|["\s]+$/g,'')).some(x=>x.length>=25&&out.includes(x)))match=true}
 const ok=reads.length>0&&match;
 if(ok){await health.ok(a,'smoke').catch(()=>{});return done({ok:true,detail:'read '+reads.map(c=>c.path).join(', ')})}
 const detail=!reads.length?'The customer run called no read_file ('+(calls.map(c=>c.name||c.error).join(', ')||'no tool calls')+').':'It read '+reads.map(c=>c.path).join(', ')+' but its answer did not use that text: '+out.trim().slice(0,200);
 await health.problem(a,'customer','The customer test after the update failed',{topic:'smoke',fix:detail}).catch(()=>{});return done({ok:false,detail})}
if(LIVE_APP)setTimeout(()=>customerSmoke().catch(e=>console.warn('customer smoke test',e.message)),5*60e3).unref();
const escalations=createEscalations({HERMES_HOME,python:enginePython,policy:()=>issues.policy()});
// the chat a tool call came from (the agent's newest person-chat): who asked, and where to answer
// the chat the waiting call (tool) was made in, and the person whose message started that turn: in a group topic every
// sender shares one chat, and the engine marks each message with "[their name]" in front, so that name decides
const ORIGIN_PY=`import sqlite3,sys,json,time,re
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5);tool=sys.argv[2]
r=c.execute("select session_id,id from messages where role='assistant' and tool_calls like ? and timestamp>? order by id desc limit 1",('%'+tool+'%',time.time()-1800)).fetchone()
if not r: print('null'); sys.exit()
sid,mid=r
u=c.execute("select content from messages where session_id=? and role='user' and id<? order by id desc limit 1",(sid,mid)).fetchone()
s=c.execute("select source,user_id,chat_id,thread_id,origin_json from sessions where id=?",(sid,)).fetchone()
o={}
try: o=json.loads(s[4] or '{}') or {}
except Exception: pass
txt=(u[0] if u else '') or ''
m=re.match(r'\\s*\\[([^\\]\\n]{1,60})\\]',txt)
print(json.dumps({'session':sid,'platform':o.get('platform') or s[0],'uid':s[1],'chat':s[2],'thread':s[3],'who':o.get('user_name'),'sender':m.group(1) if m else None,'text':txt[:300]}))`;
async function originOf(agent,tool='report_bottleneck'){const py=await enginePython().catch(()=>null);if(!py)return {};
 const db=path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'state.db');
 const r=await new Promise(res=>execFile(py,['-c',ORIGIN_PY,db,tool],{timeout:15000},(e,o)=>{try{res(e?null:JSON.parse(o))}catch{res(null)}}));if(!r)return {};
 // "[name]" in front: the sender is whoever the team policy lists with that Telegram name; otherwise the chat's own person
 // only where the engine itself writes the name (group chats on a channel); a typed "[name]" elsewhere means nothing
 if(r.sender&&!['telegram','whatsapp','slack','discord','signal'].includes(r.platform))return {...r,uid:null,who:null};
 if(r.sender){const pol=await issues.policy();const low=String(r.sender).toLowerCase();let hit=null;
  for(const t of pol.teams||[])for(const m of t.members||[])if([m.name,...[].concat(m.telegram_names||[])].some(n=>String(n).toLowerCase()===low))hit=m;
  if(!hit&&[pol.owner?.name,...[].concat(pol.owner?.telegram_names||[])].some(n=>String(n||'').toLowerCase()===low))hit=pol.owner;
  if(hit)return {...r,uid:[].concat(hit[r.platform]||[])[0]||null,who:r.sender};return {...r,uid:null,who:r.sender}}
 return r}
if(LIVE_APP){setTimeout(()=>issues.tick().catch(e=>console.warn('issues',e.message)),60e3).unref();setInterval(()=>issues.tick().catch(e=>console.warn('issues',e.message)),30e3).unref()}
if(LIVE_APP){setTimeout(()=>health.tick().catch(e=>console.warn('health',e.message)),3*60e3).unref();setInterval(()=>health.tick().catch(e=>console.warn('health',e.message)),5*60e3).unref()}
/* Self-repair kit (agent-versions.mjs, workstream E, 6 Nov 2026): each agent's own changes are versions with undo
   (Edit agent › Changes and undo_my_change), a ping run checks it still answers after a self-change and undoes the
   changes by itself when it does not; own-scope tools (my_logs, my_runs, my_health, my_deliveries, my_schedules,
   reconnect_my_connector, create_my_webhook, test_send); anything outside its scope goes to the issues fixer. */
// --source must be one the engine accepts (cli, tui, gui, acp, tool, oneshot): 'health-ping' was refused as invalid_params,
// so every ping "did not answer" and healthy agents were rolled back
const avPing=a=>new Promise(res=>{const f=path.join(DATA,'agent-versions-ping-'+a+'.txt');writeFile(f,'aqeelOS health check after a change you made to yourself. Reply with exactly: OK').then(()=>
 execFile(path.join(homedir(),'.local','bin','aqeelos'),['-p',a,'chat','--oneshot','-Q','--source','tool','--query-file',f],{cwd:path.join(homedir(),'workspaces',a),timeout:240e3,maxBuffer:4e6},(e,o,er)=>res(e?{ok:false,unsure:!!gwRestarting||Date.now()-lastOwnRestart<5*60e3,why:'it did not answer ('+(e.code??e.signal)+'): '+String(er||'').trim().split('\n').pop()}:/\bOK\b/i.test(String(o))?{ok:true}:{ok:false,why:'answered without OK: '+String(o).slice(0,200)}))).catch(e=>res({ok:false,why:e.message}))});
const versions=createAgentVersions({DATA,HERMES_HOME,DASH:DASH.origin,DASH_TOKEN,PUBLIC_URL,listAgents:()=>listAgents(),nameOf:a=>NAMES[a]||a,readConfig,setKey,pick,
 instructions,kirimdev,issues,health,teamGroups,selfRuns,bin:path.join(homedir(),'.local','bin','aqeelos'),ping:avPing,tellOwner:srToOwner,quiet:alertQuiet,live:LIVE_APP,extraHealth:a=>agentLive.healthLines(a)});
// every agent's home gets the engine plugin aqeelos-live (live context each message, tracebacks held back): installed at
// start and every 10 minutes (new agents too); when it was new or changed, the engine reloads once no reply runs
// a Telegram group's current name and the bot's place in it, asked of Telegram with the agent's own bot (10-minute cache)
const chatSeen=new Map();
async function telegramChat(agent,chatId){const k=agent+'|'+chatId,c=chatSeen.get(k);if(c&&Date.now()-c.at<600e3)return c.v;
 const tok=(/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(await readFile(path.join(agent==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',agent),'.env'),'utf8').catch(()=>''))||[])[1];if(!tok)return null;
 const api=(m,b)=>fetch('https://api.telegram.org/bot'+tok+'/'+m,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null);
 const g=await api('getChat',{chat_id:chatId});let v=null;if(g?.ok)v={title:g.result.title||''};else if(/kicked|not a member|chat not found/i.test(g?.description||''))v={title:'',gone:true};
 if(v&&!v.gone){const me=tok.split(':')[0];const m=await api('getChatMember',{chat_id:chatId,user_id:Number(me)});if(m?.ok&&/left|kicked/.test(m.result?.status||''))v.gone=true}
 chatSeen.set(k,{at:Date.now(),v});return v}
const agentLive=createAgentLive({HERMES_HOME,DATA,chatInfo:(a,pf,id)=>pf==='telegram'?telegramChat(a,id):null,
 topicName:async(a,chatId,thread)=>{const g=await teamGroups.get(a).catch(()=>null);if(!g||String(g.chatId)!==String(chatId))return null;const r=Object.entries(g.topics||{}).find(([,v])=>String(v)===String(thread));return r?pretty0(r[0])+' (topic '+thread+')':null},listAgents:()=>listAgents(),readConfig,setKey,pick,capabilities:a=>versions.capabilities(a),policy:()=>issues.policy(),nameOf:a=>NAMES[a]||a,engineDir:path.join(here,'..','engine','aqeelos-live')});
// the engine also reloads when it started before the plugin's files were written (a reload asked for by an earlier run of
// this app is lost when the app restarts)
const liveStale=async()=>{try{const pid=await gatewayPid();if(!pid)return false;const g=(await stat('/proc/'+pid)).mtimeMs;const f=(await stat(path.join(HERMES_HOME,'plugins','aqeelos-live','__init__.py'))).mtimeMs;return g<f}catch{return false}};
if(LIVE_APP){const liveInstall=()=>agentLive.install().then(async c0=>{const c=[];for(const a of c0)if(!await isTestAgent(typeof a==='string'?a:a?.agent||'').catch(()=>false))c.push(a);if(c.length||await liveStale())restartLater('aqeelos-live plugin for '+(c.length||'all')+' agent(s)')}).catch(e=>console.warn('agent-live install',e.message));
 setTimeout(liveInstall,60e3).unref();setInterval(liveInstall,10*60e3).unref()}
// the engine reads each tool server's list once, when it connects: a tool aqeelOS adds later (the lockbox link, the
// self-repair kit) stayed invisible in open chats. The lists are fingerprinted per agent; a change reloads the engine
// once no reply runs (7 Nov 2026)
async function toolSigs(){const out={};for(const a of await agentLive.homes()){if(await isTestAgent(a).catch(()=>false))continue;const c=await readConfig(a).catch(()=>null);const u=String(pick(c||{},'mcp_servers.aqeelos-notify.url')||'');if(!u.startsWith('http://127.0.0.1:'+PORT+'/'))continue;
 try{const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),signal:AbortSignal.timeout(20000)});const j=await r.json();
  // a support agent's customer tools count too (8 Nov 2026: the engine kept the old create_payment, without card, until a restart); not the
  // label lists, which follow Kirimdev and the Line settings
  const cust=pick(c||{},'mcp_servers.aqeelos-customer')?((await customerTools.mcp(a,undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body?.result?.tools||[]).map(t=>t.name+(t.name==='create_payment'?':'+t.inputSchema?.properties?.kind?.enum+t.description:'')).sort().join(','):'';
  out[a]=createHash('sha1').update((j.result?.tools||[]).map(t=>t.name+':'+createHash('sha1').update(JSON.stringify(t.inputSchema||{})+(t.description||'')).digest('hex').slice(0,8)).sort().join(',')+(cust?'|'+cust:'')).digest('hex').slice(0,12)}catch{}}return out}
if(LIVE_APP){const sigFile=path.join(DATA,'agent-live','tool-sigs.json');const toolTick=async()=>{const now=await toolSigs();if(!Object.keys(now).length)return;const old=JSON.parse(await readFile(sigFile,'utf8').catch(()=>'{}')||'{}');
  const changed=Object.keys(now).filter(a=>old[a]!==now[a]);await mkdir(path.dirname(sigFile),{recursive:true});await writeFile(sigFile,JSON.stringify(now));
  if(changed.length&&Object.keys(old).length){console.log('agent tools changed for',changed.join(', '));restartLater('new or changed aqeelOS tools for '+changed.length+' agent(s)')}};
 setTimeout(()=>toolTick().catch(e=>console.warn('tool sigs',e.message)),5*60e3).unref();setInterval(()=>toolTick().catch(e=>console.warn('tool sigs',e.message)),10*60e3).unref()}
const agentCare=createAgentCare({HERMES_HOME,DATA,fpKey:()=>agentLive.key(),teamOf:async a=>((await issues.policy())?.teams||[]).find(t=>(t.agents||[]).includes(a))?.name||null,WORK:path.join(homedir(),'workspaces'),homes:()=>agentLive.homes(),readConfig,pick,jobs:a=>versions.myJobs(a),updateJob:(a,id,up)=>versions.updateJob(a,id,up),
 record:(a,e)=>versions.noteSelfChange(a,{...e,by:'aqeelOS',undoable:false}),notices:agentLive,extraRetired:async()=>JSON.parse(await readFile(path.join(DATA,'retired-setup.json'),'utf8').catch(()=>'[]'))});
if(LIVE_APP){const careTick=()=>agentCare.tick().then(r=>{if(Object.keys(r).length)console.log('agent-care: '+JSON.stringify(r))}).catch(e=>console.warn('agent-care',e.message));
 setTimeout(careTick,3*60e3).unref();setInterval(careTick,2*60e3).unref()}
if(LIVE_APP){setInterval(()=>versions.watchTick().catch(e=>console.warn('agent-versions watch',e.message)),60e3).unref();setTimeout(()=>versions.skillsTick().catch(()=>{}),90e3).unref();setInterval(()=>versions.skillsTick().catch(e=>console.warn('agent-versions skills',e.message)),10*60e3).unref()}
// which agents get it: their own Linux user is set up (commands and files run as ag-<agent>); never the main agent,
// its extra-number copies, the help agent or (on the live app) a test copy's agents
async function srEligible(a){if(!SR_AGENT.test(a)||a==='default'||a.includes('--')||a===HELP_AGENT)return false;if(LIVE_APP&&await isTestAgent(a))return false;if(!await isAgent(a))return false;
 const c=await readConfig(a).catch(()=>null);return pick(c,'terminal.backend')==='ssh'&&String(pick(c,'terminal.ssh_user')||'')===('ag-'+a).slice(0,32)}
const SR_PLACED=path.join(DATA,'self-runs-placement.json');
async function srEnsure(a,cfg,mcp){const ok=await srEligible(a),u=srUrl(a);
 await withAgent(a,async()=>{const y=await cfg();if(!y)return;const has=/^\s*aqeelos-self:/m.test(y);
  if(ok&&!y.includes(u)){if(has)await mcp(a,'DELETE','/aqeelos-self');await mcp(a,'POST','',{name:'aqeelos-self',url:u});console.log('self-run tool set for',a)}
  else if(!ok&&has){await mcp(a,'DELETE','/aqeelos-self');console.log('self-run tool removed from',a)}});
 await srPlace(a)}
// hidden on webhooks only (Kirimdev customers: no admin tools); WhatsApp gets the same set as the app (the engine has no per-channel
// switch for one tool server, so that channel lists every other server by name; kept in step at every sync)
async function srPlace(a){const c=await readConfig(a).catch(()=>null);if(!c)return;let m={};try{m=JSON.parse(await readFile(SR_PLACED,'utf8'))}catch{}
 const servers=Object.entries(pick(c,'mcp_servers')||{}).filter(([,v])=>v&&typeof v==='object'&&!/^(false|0|no|off)$/i.test(String(v.enabled??''))).map(([n])=>n);
 const has=servers.includes('aqeelos-self');let changed=false,before=JSON.stringify(m);
 // on every other channel it shows: one with a hand-picked list of tool servers gets aqeelos-self added to it
 for(const pf of [...new Set(['whatsapp','webhook',...Object.keys(pick(c,'platform_toolsets')||{})])]){const hide=false; // customer admin tools are excluded after resolution by platform_toolset_excludes.webhook
  const r=srPlacement({pf,cur:pick(c,'platform_toolsets.'+pf),servers,hide,managed:!!m[a+'|'+pf]});
  if(r.want){const s=await setKey(a,'platform_toolsets.'+pf,r.want);if(!s.ok)throw new Error(String(s.err||s.out||'could not save').slice(-200));changed=true;console.log('self-run tool',hide?'kept off':'back on',pf,'for',a)}
  if(r.managed)m[a+'|'+pf]=true;else delete m[a+'|'+pf]}
 // no restart of its own (each one is a gap where agents drop, 5 Nov 2026): the lists take effect at the engine's next
 // restart, and until then run_self is refused on those channels anyway (judge in self-runs.mjs)
 if(JSON.stringify(m)!==before)await writeFile(SR_PLACED,JSON.stringify(m));if(changed)console.log('self-run tool lists updated for',a,'(in effect from the next engine restart)')}
// the chat a call came from: the waiting call with these very arguments in the agent's own chat database
async function srOrigin(a,tool,args){let calls=[];
 // a busy database (right after an engine restart) is tried again, like a call not saved yet
 let err=null;for(let i=0;i<6;i++){try{err=null;calls=(await srBox.lookup(a,tool)).filter(c=>{let x;try{x=typeof c.args==='string'?JSON.parse(c.args||'{}'):c.args}catch{return false}return srFp(x)===srFp(args)})}catch(e){err=e;console.warn('self-run: reading',a+'\'s chats failed:',e.detail||e.message)}
  if(calls.length)break;await new Promise(r=>setTimeout(r,err?2000:800))}
 if(!calls.length&&err)return {ok:false,why:err.message+' Try again in a minute.'};
 const settings=await selfRuns.settings(a),trusted=await selfRuns.trusted();
 const sessionUser=id=>{const uid=users.sessionOwner(id),w=uid&&users.byId(uid);return w?{name:w.name||w.username||uid,ok:users.atLeast(w,a,'edit')}:null};
 if(!calls.length)return srJudge([],{settings,trusted,sessionUser});
 // the same call twice at once: every chat it could be from must pass
 const v=calls.map(c=>srJudge(c.chain,{settings,trusted,sessionUser}));return v.find(x=>!x.ok)||v[0]}
const SR_TOOLS=[
 {name:'run_self',description:'Start a fresh run of yourself in the background, to test or re-run your own work: a new chat of your own with this prompt, with your own tools, files and keys, in your own workspace. It runs at most timeout_minutes ('+SR_MAX+' at most) and you can carry on meanwhile; the person who asked hears when it ends. Then call run_self_status with its id and wait true to get the result. Only in chats with your owner, a trusted person or the aqeelOS chat, and from your own schedules. At most 2 at once and a daily limit set in aqeelOS.',
  inputSchema:{type:'object',properties:{prompt:{type:'string',description:'Everything the run needs to know: it starts with no memory of this chat'},reason:{type:'string',description:'Why, in a few words (shown to the owner)'},timeout_minutes:{type:'number',minimum:1,maximum:SR_MAX,description:'Stop it after this many minutes (default '+SR_DEF+', at most '+SR_MAX+')'},lock:{type:'string',description:'Optional: a lock file in your workspace, e.g. .tools/browser.lock. The run waits (up to 10 minutes) until nothing else holds it, and holds it while it runs.'}},required:['prompt','reason']}},
 {name:'run_self_status',description:'How a run you started with run_self is going, and its result when it is done. With wait true it waits up to 20 seconds for it to finish; for a longer run, do other work or sleep in your terminal between checks',inputSchema:{type:'object',properties:{id:{type:'string',description:'The run id run_self gave'},wait:{type:'boolean'}},required:['id']},annotations:{readOnlyHint:true}},
 {name:'run_self_list',description:'Your runs from run_self (newest first), how many you started today against your daily limit, and whether self-runs are paused.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}];
const SR_WAIT=20e3;
const SR_STATE={waiting:'Waiting for the lock',running:'Running',ok:'Finished',failed:'Failed',timeout:'Ran out of time',stopped:'Stopped by an admin',interrupted:'Lost: aqeelOS restarted while it ran'};
const srText=r=>'Run '+r.id+': '+(SR_STATE[r.state]||r.state)+(r.secs!=null?' after '+srDur(r.secs):'')+(r.exit!=null&&r.state!=='ok'?' (exit code '+r.exit+')':'')+'.\nReason: '+r.reason+(r.error?'\n'+r.error:'')+(r.answer?'\n\nIts last output:\n'+r.answer:'')+(r.state==='running'||r.state==='waiting'?'\n\nStill going. Do other work, or wait in your terminal (sleep 60), then call run_self_status again.':'');
async function srMcp(req,res,ms){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method!=='POST')return send(res,405,'POST only');
 let msg={};try{msg=JSON.parse(await readBody(req,262144))}catch{return send(res,400,{error:'bad json'})}
 const a=ms[1],x=Buffer.from(String(ms[2])),y=Buffer.from(srSig(a));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,{error:'bad token'});
 const rpc=result=>send(res,200,{jsonrpc:'2.0',id:msg.id,result}),reply=(text,isError)=>rpc({content:[{type:'text',text}],...(isError?{isError:true}:{})});
 if(msg.method==='initialize')return rpc({protocolVersion:msg.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos-self',version:'1.0.0'}});
 if(msg.method==='notifications/initialized'||msg.id==null)return send(res,202,'');
 if(msg.method==='ping')return rpc({});
 if(msg.method==='tools/list')return rpc({tools:await srEligible(a)?SR_TOOLS:[]});
 if(msg.method!=='tools/call')return send(res,200,{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
 const name=String(msg.params?.name||''),args=msg.params?.arguments&&typeof msg.params.arguments==='object'?msg.params.arguments:{};
 if(!SR_TOOLS.some(t=>t.name===name))return reply('Unknown tool.',true);
 if(!await srEligible(a))return reply('Running yourself is not available for this agent.',true);
 let origin=await srOrigin(a,name,args);
 try{if(name==='run_self'){const ws=path.join(homedir(),'workspaces',a);let lockPath=null;
   if(origin.ok&&args.lock)try{lockPath=await safeLock(ws,args.lock)}catch(e){origin={ok:false,by:origin.by,why:e.message}}
   const r=await selfRuns.start({agent:a,args,origin,ws,lockPath});console.log('self-run',r.id,'started by',a,'for',origin.by?.kind||'?');
   return reply('Started run '+r.id+' ('+r.minutes+' minutes at most'+(r.state==='waiting'?', it first waits for the lock':'')+'). It runs on its own, so carry on. Call run_self_status with id '+r.id+' and wait true for the result; the person who asked also hears when it ends.')}
  if(!origin.ok){await selfRuns.start({agent:a,args:{prompt:'('+name+')',reason:'('+name+')'},origin}).catch(()=>{});return reply(origin.why,true)}
  if(name==='run_self_status'){// a short wait only: the engine runs one call at a time per tool server, so a long one held up every other call to it
   // (5 Nov 2026: a run's own run_self waited 3 minutes behind its parent's run_self_status)
   const r=args.wait?await selfRuns.wait(a,args.id,SR_WAIT):await selfRuns.status(a,args.id);return r?reply(srText(r)):reply('You have no run with id '+String(args.id||'').slice(0,40)+'. run_self_list shows yours.',true)}
  const m=await selfRuns.mine(a);
  return reply('Today: '+m.today+' of '+m.cap+' runs.'+(m.paused?' Self-runs are PAUSED ('+(m.paused.why==='cap'?'daily limit reached, until tomorrow':'3 failed runs in a row, until an admin resumes them')+').':'')+(m.on?'':' Running yourself is switched off for you in aqeelOS.')+'\n'+(m.runs.map(r=>'- '+r.id+' · '+(SR_STATE[r.state]||r.state)+(r.secs!=null?' · '+srDur(r.secs):'')+' · '+r.reason).join('\n')||'No runs yet.'))}
 catch(e){return reply(e.message,true)}}
// every 5 seconds: runs that started or ended, trusted-person codes that arrived, and (live) the 08:00 summary
let srTicking=false;setInterval(()=>{if(srTicking)return;srTicking=true;(async()=>{await selfRuns.check();
  const codes=await selfRuns.pendingCodes();if(codes.length){const hits=await srBox.findCodes(await listAllProfiles(),Math.min(...codes.map(c=>c.at))-60e3);
   for(const h of hits){const m=/TRUST-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(h.text||'');if(!m||!codes.some(c=>c.code===m[0]))continue;
    const t=await selfRuns.codeSeen({code:m[0],platform:h.platform,uid:h.uid,name:h.name,agent:h.agent});if(t){console.log('self-runs: a trusted person was added on',t.platform);syncNotifyTool().catch(()=>{})}}}
  if(LIVE_APP)await selfRuns.summary(8)})().catch(e=>console.warn('self-runs tick',e.message)).finally(()=>{srTicking=false})},5000).unref();
// the page: a phone-sized form, its own small script; strict headers (no caching, no referrer, no framing, not indexed)
function secretPage(nonce){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Save a key · aqeelOS</title>
<style nonce="${nonce}">@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}
:root{--bg:#f5f6f8;--surface:#fff;--ink:#0b0c10;--muted:#646875;--border:#e2e3e9;--blue:#0158cb;--ok:#1f6b3a;--bad:#c62f2f;--soft:#edeef2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--surface:#171c25;--ink:#f0f3fa;--muted:#a1adbf;--border:#303a4b;--blue:#6ca9ff;--ok:#5fd38d;--bad:#ff8a8a;--soft:#1d2430;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:15px/1.5 'Plus Jakarta Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:26px 22px;opacity:0;transform:translateY(6px);transition:opacity .25s ease,transform .25s ease}
main.in{opacity:1;transform:none}h1{font-size:20px;line-height:1.3;margin:0 0 6px;letter-spacing:-.01em}p{margin:0 0 16px;color:var(--muted)}.who b{color:var(--ink);font-weight:600}
label{display:block;font-weight:600;font-size:13px;margin:0 0 6px}.key{font-weight:500;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
input{width:100%;height:48px;padding:0 14px;font:inherit;font-size:16px;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 22%,transparent)}
button{width:100%;height:48px;margin-top:14px;border:0;border-radius:999px;background:var(--blue);color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer;transition:opacity .15s,transform .1s}
button:active{transform:scale(.98)}button:disabled{opacity:.55;cursor:default}.note{font-size:13px;margin:10px 0 0}.err{color:var(--bad);min-height:20px}.warn{background:var(--soft);border-radius:10px;padding:9px 12px;font-size:13px;color:var(--ink);margin:0 0 14px}
.done{color:var(--ok);font-weight:600;font-size:17px;margin:0 0 6px}.m0{margin:0}</style></head><body><main id="m" aria-live="polite"><p id="wait">Opening…</p></main>
<script nonce="${nonce}">(()=>{const m=document.getElementById('m'),ss=(k,v)=>{try{return v===undefined?sessionStorage.getItem(k):v===null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v)}catch{return null}};
const t=location.hash.slice(1)||ss('aqeelos-secret-link')||'';if(t)ss('aqeelos-secret-link',t);history.replaceState(null,'',location.pathname);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=h=>{m.classList.remove('in');setTimeout(()=>{m.innerHTML=h;requestAnimationFrame(()=>m.classList.add('in'))},m.innerHTML.includes('Opening')?0:160)};
const gone=()=>{ss('aqeelos-secret-link',null);show('<h1>This link no longer works</h1><p class="m0">This link was already used or expired, ask for a new one.</p>')};
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),cache:'no-store',credentials:'omit',referrerPolicy:'same-origin'}).then(async r=>({s:r.status,j:await r.json().catch(()=>({}))}));
if(!t)return gone();
post('/secret/peek',{token:t}).then(({s,j})=>{if(s===429)return show('<h1>Too many tries</h1><p class="m0">Wait a few minutes, then open the link again.</p>');if(s===410)return gone();if(s!==200)return show('<h1>Something went wrong</h1><p class="m0">Reload this page in a moment. The link still works.</p>');
 const left=Math.max(1,Math.round((j.exp-Date.now())/60000));
 show('<h1>'+esc(j.label)+'</h1><p class="who">For <b>'+esc(j.agentName)+'</b>. Only it can use what you save here; nobody sees it again.</p>'+
  '<form id="f" autocomplete="off"><label for="v">Paste it here <span class="key">'+esc(j.name)+'</span></label><input id="v" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required><button id="b" type="submit">Save</button><p class="note err" id="e"></p></form><p class="note">This link works once, for about '+left+' more minute'+(left>1?'s':'')+'.</p>');
 setTimeout(()=>{const f=document.getElementById('f');if(!f)return;document.getElementById('v').focus();
  f.addEventListener('submit',ev=>{ev.preventDefault();const v=document.getElementById('v'),b=document.getElementById('b'),e=document.getElementById('e');if(!v.value.trim()){e.textContent='Paste the value first.';return}
   b.disabled=true;b.textContent='Saving…';e.textContent='';
   post('/secret/save',{token:t,value:v.value}).then(({s,j:r})=>{if(s===200&&r.ok){v.value='';ss('aqeelos-secret-link',null);return show('<p class="done">Saved</p><p class="m0">'+esc(r.name)+' is saved for '+esc(r.agentName)+'. Go back to the chat and tell it you saved it. You can close this page.</p>')}
    if(s===410)return gone();e.textContent=s===429?'Too many tries. Wait a few minutes.':(r.error||'It could not be saved. Try again.');b.disabled=false;b.textContent='Save'}).catch(()=>{e.textContent='No connection. Try again.';b.disabled=false;b.textContent='Save'})})},200)}).catch(()=>show('<h1>No connection</h1><p class="m0">Reload this page when you are online. The link still works.</p>'))})();</script></body></html>`}
async function secretRoute(req,res,p){try{return await secretRouteIn(req,res,p)}catch(e){console.warn('secret link page:',String(e.message||e).slice(0,160));if(!res.headersSent)return send(res,500,{error:'Something went wrong. Try again in a moment.'},{'cache-control':'no-store','referrer-policy':'no-referrer'})}}
async function secretRouteIn(req,res,p){
 const nonce=randomBytes(16).toString('base64');
 const H={'cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-frame-options':'DENY','x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"};
 if(p==='/secret'&&req.method==='GET')return send(res,200,secretPage(nonce),{...H,'content-type':'text/html; charset=utf-8'});
 if(req.method!=='POST'||!['/secret/peek','/secret/save'].includes(p))return send(res,405,{error:'Not here.'},H);
 // from the page itself only: same origin, JSON, at most 8 KB; a few tries per address
 const og=String(req.headers.origin||''),same=og===new URL(PUBLIC_URL).origin||((!og||og==='null')&&req.headers['sec-fetch-site']==='same-origin');
 if(!same||!/^application\/json\b/i.test(String(req.headers['content-type']||'')))return send(res,403,{error:'Open the link you were sent.'},H);
 if(secretHits(clientIp(req)))return send(res,429,{error:'Too many tries. Wait a few minutes.'},H);
 if(+(req.headers['content-length']||0)>8192)return send(res,413,{error:'That is too much.'},{...H,connection:'close'});
 let raw;try{raw=await readBody(req,8192)}catch{return send(res,413,{error:'That is too much.'},{...H,connection:'close'})}let b;try{b=JSON.parse(raw)}catch{return send(res,400,{error:'Open the link you were sent.'},H)}
 if(p==='/secret/peek'){const r=await secretLinks.peek(b?.token);return r?send(res,200,r,H):send(res,410,{gone:true},H)}
 const r=await secretLinks.consume(b?.token,b?.value);return send(res,r.ok?200:r.gone?410:400,r.ok?{ok:true,name:r.name,agentName:r.agentName}:r.gone?{gone:true}:{error:r.error},H)}
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
 // Help's profile only through /ui/help (help.mjs): nobody, admins included, opens its chats or settings here. Its usage
 // totals are the one exception, for admins on System › Usage (numbers per day and model, never what was said; 1 Nov 2026)
 const helpTotals=agent===HELP_AGENT&&users.isAdmin(u)&&req.method==='GET'&&/^\/hapi\/analytics\/(usage|models)$/.test(p);
 if(!helpTotals&&(agent===HELP_AGENT||decodeURIComponent((/^\/hapi\/profiles\/([^/?]+)/.exec(p)||[])[1]||'')===HELP_AGENT))return send(res,403,{error:'Help chats are private to each person.'});
 const no=users.gate(u,p,req.method,q,agent);if(no)return send(res,no.status,{error:no.error});
 {const rm=/\/v1\/runs\/([^/]+)/.exec(p);if(rm&&!users.isAdmin(u)){const own=runOwner.get(decodeURIComponent(rm[1]));if(!own||own.user!==u.id)return send(res,403,{error:'That reply is not yours.'})}}
 if(p.startsWith('/gapi/p/')&&agent&&agent!=='default'&&!keyOk.has(agent)){const envF=path.join(HERMES_HOME,'profiles',agent,'.env');const e=await readFile(envF,'utf8').catch(()=>null);
  if(e!==null){if(!/^API_SERVER_KEY=/m.test(e)&&API_KEY){await writeFile(envF,(e&&!e.endsWith('\n')?e+'\n':e)+'API_SERVER_KEY='+API_KEY+'\n',{mode:0o600});console.log('added the missing gateway key for',agent);await new Promise(r=>setTimeout(r,1500))}keyOk.add(agent)}}
 // the engine's usage reports, per agent: cached, a few at a time, with a time limit and the last good answer on failure (usage.mjs)
 {const am=/^\/hapi\/analytics\/(usage|models)$/.exec(p);if(am&&req.method==='GET'){const days=Math.min(365,Math.max(1,+q.get('days')||30));try{return send(res,200,await usage.report(am[1],q.get('profile')||'default',days,{fresh:!!req.headers['x-fresh']}))}catch(e){return send(res,e.status||504,{error:e.name==='TimeoutError'?'The engine took too long to add up this agent’s usage.':e.message})}}}
 if(p==='/hapi/messaging/platforms'&&req.method==='GET'){try{return send(res,200,await platformsCached(q.get('profile')||'default'))}catch(e){return send(res,e.status||502,{error:e.message})}}
 if(p.startsWith('/hapi/messaging/')&&req.method!=='GET')platCache.clear();
 if(p.startsWith('/hapi/')&&req.method!=='GET'){hapiStatus.drop();hapiLists.drop()}   // any engine change: the next status is read new
 {const m=req.method==='DELETE'&&/^\/hapi\/providers\/oauth\/([^/]+)$/.exec(p);if(m&&users.isAdmin(u)&&(q.get('profile')||'default')==='default')accountsApi.forget('p:'+decodeURIComponent(m[1])).catch(()=>{})}   // signed out on purpose: no "is signed out" notice
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
 // What was true before is kept first, so the same check as a night update runs after it (engine-updates.mjs).
 if(p==='/hapi/hermes/update'&&req.method==='POST'&&users.isAdmin(u)){if(backups.busy())return send(res,409,{error:'A restore is running. Update after it finishes.'});if(await engineUpd.beforeManual().catch(e=>{console.warn('engine update: before',e.message);return true})===false)return send(res,409,{error:'An engine update is already running.'});await engineReset();setTimeout(()=>engineWatch().catch(()=>{}),120000)}
 if(p.startsWith('/hapi/')&&req.method!=='GET'&&q.get('profile')&&/json/.test(String(req.headers['content-type']||''))&&!p.startsWith('/hapi/files')){let b=null,raw;
  // the body is read up front, so a bad one is answered here (passing it on would forward a body that is already gone)
  try{raw=(await readRaw(req,30e6)).toString('utf8')}catch{return send(res,413,{error:'That is too large to send.'})}try{b=raw?JSON.parse(raw):{}}catch{return send(res,400,{error:'The request body is not valid JSON.'})}
  if(b&&typeof b==='object'&&!Array.isArray(b)&&(!b.profile||!users.isAdmin(u)))b.profile=q.get('profile');if(b!==null)body=Buffer.from(JSON.stringify(b))}
 // a member's JSON body without ?profile= may not name another agent either
 // and nobody's may name Help's profile (or make an agent with its name)
 if(!q.get('profile')&&p.startsWith('/hapi/')&&req.method!=='GET'&&body===undefined&&/json/.test(String(req.headers['content-type']||''))&&!p.startsWith('/hapi/files')){const raw=await readRaw(req,30e6);body=raw;try{const b=JSON.parse(raw.toString('utf8')||'null');if(b&&typeof b==='object'&&!Array.isArray(b)){if(b.profile===HELP_AGENT||p==='/hapi/profiles'&&b.name===HELP_AGENT)return send(res,403,{error:'That name is taken by Help.'});if(!users.isAdmin(u)&&b.profile&&b.profile!==(agent||'default'))return send(res,403,{error:'That agent is not shared with you.'})}}catch{}}
 // a member's file calls must stay in their own folder
 if(!users.isAdmin(u)&&p.startsWith('/hapi/files')){
  // no path would list the engine's own default folder: a member's goes to their home instead
  if(req.method==='GET'){if(!q.get('path')){q.set('path',users.home(u));req.url=p+'?'+q}if(!users.filePathOk(u,q.get('path')))return send(res,403,{error:'That folder is not yours.'})}
  else{const raw=await readRaw(req,p.endsWith('upload-stream')?200e6:65536);body=raw;
   let fp=null;if(p.endsWith('upload-stream')){const f=formPaths(raw,req.headers['content-type']);if(!f||f.length!==1)return send(res,400,{error:'Upload one file location at a time.'});fp=f[0]}else{try{fp=JSON.parse(raw.toString('utf8')).path}catch{}}
   if(!users.filePathOk(u,fp,true)||q.has('path')&&!users.filePathOk(u,q.get('path'),true))return send(res,403,{error:'That folder is not yours.'})}}
 // a member's message: within their daily limit, and only on models they may use
 const chatM=/^\/gapi(?:\/p\/[^/]+)?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p);
 if(chatM&&!users.isAdmin(u)&&req.method==='POST'){
  const lim=users.limitOf(u);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),u.id,users.ownerOf);if(t.tokens+await code.usedToday(u.id)>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
  const allowed=users.allowedModels(u);if(allowed){let b={};try{b=JSON.parse((await readRaw(req,40e6)).toString('utf8'))}catch{}
   // the chat bar always sends the model it shows, "Default" included: the agent's own default gets the same
   // fallback as no model at all (the first allowed one), only another model picked by hand is refused
   const d=await agentModel(agent),isDef=!b.model||b.model===d.model&&(!b.provider||b.provider===d.provider);
   if(!isDef){if(!users.modelOk(u,b.provider||'',b.model))return send(res,403,{error:'You can\'t use that model. Ask the owner.'})}
   else if(!users.modelOk(u,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');if(m.length){b.provider=pv;b.model=m.join('|')}else{b.model=pv;delete b.provider}}
   body=Buffer.from(JSON.stringify(b))}}
 let relayTarget=undefined,relayJob=null;
 const cronM=/^\/hapi\/cron\/jobs(?:\/([^/]+))?$/.exec(p);
 if(cronM&&(req.method==='POST'&&!cronM[1]||req.method==='PUT'&&cronM[1])){let b={};try{b=JSON.parse((body||await readRaw(req,262144)).toString('utf8'))}catch{}
  const holder=req.method==='PUT'?(b.updates||{}):b;const dv=String(holder.deliver||'');
  if(dv.startsWith('relay:')){const [owner,platform]=dv.slice(6).split('|');relayTarget={owner,platform};holder.deliver='local'}else if('deliver' in holder)relayTarget=null;
  // a script, a work folder, another model address or the terminal/file/code tools on a schedule: only for people allowed the unsafe tools
  if(!users.isAdmin(u)&&!users.can(u,'unsafe')&&(holder.script||holder.no_agent||holder.workdir||holder.base_url||(Array.isArray(holder.enabled_toolsets)?holder.enabled_toolsets:[]).some(t=>UNSAFE_TOOLSETS.includes(t))))return send(res,403,{error:'Scripts, folders, model addresses and the terminal, file and code tools on a schedule are only for admins.'});
  relayJob=cronM[1]||null;body=Buffer.from(JSON.stringify(b))}
 // deleting an agent: keep a full copy first (30 days), so it can be restored from Agents › Recently deleted
 const delM=/^\/hapi\/profiles\/([^/]+)$/.exec(p);
 // a delete waits for the agent's setup and settings changes to finish (a command running during a delete leaves a ghost folder)
 if(delM&&req.method==='DELETE'){const n=decodeURIComponent(delM[1]);await export_setups.wait(n).catch(()=>{});await withAgent(n,()=>{})}
 if(delM&&req.method==='DELETE'){const name=decodeURIComponent(delM[1]);if(name!=='default'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)&&!/^(rl|nt|lk|dp|kp|sh-a|sh-b)-/.test(name)){
   const dir=path.join(HERMES_HOME,'profiles',name),trash=path.join(DATA,'agent-trash');await mkdir(trash,{recursive:true});
   const file=path.join(trash,name+'__'+new Date().toISOString().replace(/[:.]/g,'-')+'.tgz');const {execFile}=await import('node:child_process');
   // its extra numbers (copies, with their WhatsApp sessions) go in the same backup, each as <copy>/ plus a list
   // of them (.aqeel-copies.json), so Restore brings them back too
   const copies=[];for(const l of await links.list(name).catch(()=>[]))if(await stat(path.join(HERMES_HOME,'profiles',l.name)).catch(()=>null))copies.push(l);
   const meta=path.join(trash,'.copies-'+process.pid+'-'+Date.now());await mkdir(meta,{recursive:true});await writeFile(path.join(meta,'.aqeel-copies.json'),JSON.stringify(copies));
   const extra=copies.flatMap(l=>['--exclude='+l.name+'/cache','--exclude='+l.name+'/sandboxes','-C',path.join(HERMES_HOME,'profiles'),l.name]);
   // tar exits 1 when a file changed while it was read (a busy agent); the backup is still good if it was written
   const ok=await new Promise(r=>execFile('tar',['-czf',file,'--warning=no-file-changed','--ignore-failed-read','--exclude=./cache','--exclude=./sandboxes','-C',dir,'.',...extra,'-C',meta,'.aqeel-copies.json'],{timeout:180000,maxBuffer:1e6},e=>r(!e||e.code===1)))&&(await stat(file).then(x=>x.size>0,()=>false));
   (await import('node:fs/promises')).rm(meta,{recursive:true,force:true}).catch(()=>{});
   if(!ok)return send(res,500,{error:'Could not save a backup of this agent first, so it was not deleted.'})}}
 // no start, stop or restart of the agents while a restore copies their files
 if(p.startsWith('/hapi/gateway/')&&req.method==='POST'&&backups.busy())return send(res,409,{error:'A restore is running. The agents start again by themselves when it finishes.'});
 // a deliberate stop: the watch leaves it stopped, once the engine really stopped it (a failed stop keeps the watch on)
 if(p==='/hapi/gateway/stop'&&req.method==='POST'&&(q.get('profile')||'default')==='default')res.once('finish',()=>{if(res.statusCode>=200&&res.statusCode<300)gwStopped=true});
 // deleting an agent also removes its extra numbers (copies) and takes it out of channel sharing
 // only once the engine really deleted it (2xx): a refused delete keeps the agent's numbers and WhatsApp sessions
 if(delM&&req.method==='DELETE'){const gone=decodeURIComponent(delM[1]);if(!gone.includes('--'))res.once('finish',async()=>{if(res.statusCode>=300)return;
  for(const l of await links.list(gone).catch(()=>[]))await links.remove(l.name).catch(e=>console.warn('remove copy',l.name,e.message));
  setTimeout(async()=>{if(await isAgent(gone))return;await users.dropAgent(gone).catch(()=>{});await accountHooks.forgetSkills?.(gone).catch(()=>{});const {rm}=await import('node:fs/promises');
   // anything the engine left behind (a bare logs/ folder) and an agent folder holding only aqeelOS's own notes
   await rm(path.join(HERMES_HOME,'profiles',gone),{recursive:true,force:true}).catch(()=>{});
   const ws=path.join(homedir(),'workspaces',gone);if((await readdir(ws).catch(()=>['?'])).every(x=>x==='AGENTS.md'))await rm(ws,{recursive:true,force:true}).catch(()=>{});
   await setStatus(gone,null);const sh=await relay.shares().catch(()=>({}));
   for(const [k,v] of Object.entries(sh)){const [owner,platform]=k.split('|');if(owner===gone)await relay.setShare(owner,platform,{senders:[],chat:''}).catch(()=>{});else if((v.senders||[]).includes(gone))await relay.setShare(owner,platform,{senders:v.senders.filter(x=>x!==gone),chat:v.chat}).catch(()=>{})}
   syncNotifyTool().catch(()=>{});if(LIVE_APP)writeAgentContext().catch(()=>{});console.log('cleaned up after deleting',gone)},20000)})}
 {const whM=/^\/hapi\/webhooks(?:\/([^/]+))?(\/enabled)?$/.exec(p),wa=q.get('profile')||'default';
  // one webhook list serves every agent (the main agent's); each entry is bound to the agent it runs as
  if(whM&&!wa.includes('--')&&req.method==='GET'&&!whM[1]){const h={'x-hermes-session-token':DASH_TOKEN};
   // an engine that does not answer is not "webhooks are off" (the page would offer to turn them on, restarting the agents)
   const d=await fetch(DASH.origin+'/api/webhooks?profile=default',{headers:h}).then(r=>r.ok?r.json():null).catch(()=>null);if(!d||typeof d!=='object')return send(res,502,{error:'Could not reach the webhook list. Try again in a moment.'});
   let store={};try{store=JSON.parse(await readFile(path.join(HERMES_HOME,'webhook_subscriptions.json'),'utf8'))}catch{}
   const subs=(d.subscriptions||[]).map(x=>{const ag=(store[x.name]?.profile)||'default';return {...x,agent:ag,url_path:ag==='default'?'/webhooks/'+x.name:'/webhooks/'+ag+'/'+x.name}}).filter(x=>x.agent===wa);
   return send(res,200,{...d,subscriptions:subs})}
  // turning webhooks on is for the one shared listener (the main agent's)
  if(whM&&whM[1]==='enable'&&req.method==='POST'&&wa!=='default'){req.url=req.url.replace(/([?&]profile=)[^&]*/,'$1default');let b={};try{b=JSON.parse((body||Buffer.from('{}')).toString('utf8')||'{}')}catch{}b.profile='default';body=Buffer.from(JSON.stringify(b))}
  // the public address takes names of up to 64 characters, so longer ones are refused when made (the main agent's too)
  if(whM&&!whM[1]&&req.method==='POST'&&wa==='default'){body=body||await readRaw(req,65536);let b={};try{b=JSON.parse(body.toString('utf8'))}catch{}if(String(b.name||'').trim().length>64)return send(res,400,{error:'Keep the name to 64 characters or fewer.'})}
  // the main agent's list holds every agent's webhooks: from the main agent, only its own can be changed or deleted
  if(whM&&whM[1]&&wa==='default'&&(req.method==='DELETE'||req.method==='PUT')){let store={};try{store=JSON.parse(await readFile(path.join(HERMES_HOME,'webhook_subscriptions.json'),'utf8'))}catch{}
   if((store[decodeURIComponent(whM[1])]?.profile||'default')!=='default')return send(res,404,{error:'No webhook with that name on this agent.'})}
  if(whM&&wa!=='default'&&!wa.includes('--')){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
   if(req.method==='POST'&&!whM[1]){let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}
    const name=String(b.name||'').trim().toLowerCase().replace(/ /g,'-');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))return send(res,400,{error:'Use lowercase letters, numbers, - or _, at most 64.'});
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
 // a locked agent (its owner may not use unsafe tools), or a "--" copy of one: terminal, files, code and computer use
 // can't be switched on here by anyone, admins included (the page hides the switch; this is the rule itself)
 {const ts=/^\/hapi\/tools\/toolsets\/([^/]+)$/.exec(p);if(ts&&req.method==='PUT'&&UNSAFE_TOOLSETS.includes(decodeURIComponent(ts[1]))){const base=String(agent||'default').split('--')[0];
  if(base!=='default'&&lockedAgent(base,await getStatus().catch(()=>({})))){let b={};try{body=body||await readRaw(req,65536);b=JSON.parse(body.toString('utf8'))}catch{}
   if(b.enabled!==false)return send(res,403,{error:'This agent’s terminal, file, code and computer tools are locked: its owner’s role does not allow them. An admin can change that role in People.'})}}}
 // a skill from the hub follows the same rule as the ones given out (skills-policy.mjs): one this agent may not have is
 // refused by its name, and the agent's folder is checked again once the install (it runs in the background) is done
 if(req.method==='POST'&&/^\/hapi\/skills\/hub\/(install|update)$/.test(p)){const a=agent||'default';let b={};try{body=body||await readRaw(req,65536);b=JSON.parse(body.toString('utf8'))}catch{}
  const nm=String(b.identifier||b.name||'').split(/[/:@]/).filter(Boolean).pop()||'';if(nm&&!skillAllowed(nm,a))return send(res,403,{error:'That skill is kept for other agents, so it can’t be added to this one.'});
  for(const d of [20e3,90e3,300e3])setTimeout(()=>accountHooks.trimSkills?.(a).catch(()=>{}),d).unref?.()}
 let made=null;
 if(!users.isAdmin(u)&&(req.method==='POST'&&(p==='/hapi/mcp/servers'||p==='/hapi/profiles')||/^(PUT|PATCH)$/.test(req.method)&&/^\/hapi\/mcp\/servers\/[^/]+$/.test(p))){
  let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}
  // an MCP server started by command runs code on the box: same rule as the terminal
  if(/^\/hapi\/mcp\/servers(\/[^/]+)?$/.test(p)&&/^(POST|PUT|PATCH)$/.test(req.method)&&(b.command||b.args||b.transport==='stdio')&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
  // a member's tool address may not point inside the box or at a cloud's metadata service
  if(/^\/hapi\/mcp\/servers/.test(p)&&b.url&&await privateAddress(b.url))return send(res,403,{error:'Tools must use a public web address.'});
  // a member's new agent starts empty: copying the main agent would copy its keys and memory
  if(p==='/hapi/profiles'){const rel=users.reserve(u);if(!rel)return send(res,403,{error:'You reached the number of agents your role allows. Delete one first or ask the owner.'});res.once('close',rel);
   b.clone_from_default=false;b.clone_all=false;if(b.clone_from&&users.level(u,String(b.clone_from))!=='owner')delete b.clone_from;made=String(b.name||'');
   // the apps and library skills a new agent starts with follow the same rules as adding them later
   delete b.hub_skills;const ms=Array.isArray(b.mcp_servers)?b.mcp_servers:[];if(ms.some(s=>s&&(s.command||s.args||s.transport==='stdio'))&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
   for(const s of ms)if(s?.url&&await privateAddress(s.url))return send(res,403,{error:'Tools must use a public web address.'})}
  body=Buffer.from(JSON.stringify(b))}
 // a member's catalog install: the same rules as adding that server by hand (a plain public address, or "unsafe" for anything that runs on the box)
 if(!users.isAdmin(u)&&req.method==='POST'&&p==='/hapi/mcp/catalog/install'){let b={};try{b=JSON.parse((body||await readRaw(req,65536)).toString('utf8'))}catch{}body=Buffer.from(JSON.stringify(b));
  const cat=await fetch(DASH.origin+'/api/mcp/catalog?profile='+encodeURIComponent(agent||'default'),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)}).then(r=>r.json()).catch(()=>null);
  const e=(cat?.entries||[]).find(x=>x.name===String(b.name||''));if(!e)return send(res,404,{error:'That tool is not in the catalog.'});
  const plain=e.url&&!e.command&&!e.args&&e.transport!=='stdio'&&!(e.bootstrap||[]).length&&!e.needs_install;
  if(!plain&&!users.can(u,'unsafe'))return send(res,403,{error:'Only admins can add tools that run a command on the box. Use a server URL instead.'});
  if(e.url&&await privateAddress(e.url))return send(res,403,{error:'Tools must use a public web address.'})}
 const transform=/^\/hapi\/(sessions|sessions\/search|profiles|cron\/jobs)$/.test(p)&&req.method==='GET'?d=>users.filter(u,p,d,agent)
  :p==='/hapi/status'&&req.method==='GET'?d=>Array.isArray(d?.profiles)?{...d,profiles:d.profiles.filter(x=>(x?.name||x)!==HELP_AGENT)}:d
  :/^\/gapi(\/p\/[^/]+)?\/api\/model\/options$/.test(p)&&users.allowedModels(u)?d=>({...d,providers:(d.providers||[]).map(pv=>({...pv,models:(pv.models||[]).filter(m=>users.modelOk(u,pv.slug,m))})).filter(pv=>pv.models.length)})
  :/^\/gapi(\/p\/[^/]+)?\/api\/sessions$/.test(p)&&req.method==='POST'?async d=>{await users.own(d.id||d.session?.id||d.session_id,u);return d}
  // a fork belongs to the person who forked it (else it would count as the owner's and they could not open it)
  :/^\/(gapi(\/p\/[^/]+)?\/api|hapi)\/sessions\/[^/]+\/fork$/.test(p)&&req.method==='POST'?async d=>{await users.own(d?.session?.id||d?.id||d?.session_id||d?.new_session_id,u);return d}
  :made?async d=>{await memberAgent(u,String(d?.name||d?.profile?.name||made));return d}
  :p==='/hapi/profiles'&&req.method==='POST'?async d=>{const n=d?.name||d?.profile?.name;if(n){noteMade(n);syncNotifyTool().catch(()=>{});   // the aqeelOS tool needs nothing from the setup: a new agent gets it at once, not minutes later
   (setupAgentFn?setupAgentFn(n):Promise.resolve()).catch(e=>console.warn('setup',n,e.message)).finally(async()=>{await agentHealth(n).catch(()=>{});await syncNotifyTool().catch(()=>{});if(LIVE_APP)writeAgentContext().catch(()=>{});
   const {execFile}=await import('node:child_process');execFile(process.execPath,[path.join(root,'scripts','apply-skill-patches.mjs')],{timeout:180000},e=>{if(e)console.warn('skill patches',n,e.message)})})}return d}
  :relayTarget!==undefined?async d=>{const id=relayJob||(d.job||d).id;if(id)await relay.setJobRelay(agent,id,relayTarget);return d}:undefined;
 // the chat list is filtered per person AFTER the engine pages it: page on (at most 10 engine pages of 100) until the
 // asked-for rows are left, skipping `offset` filtered rows, so a member's list and its total are real ("more" past the cap)
 if(p==='/hapi/sessions'&&req.method==='GET'){const lim=Math.min(200,Math.max(1,+q.get('limit')||100)),skip=Math.max(0,+q.get('offset')||0),out=[];let seen=0,end=false,raw={};
  // no more pages than needed: stop once the asked-for rows are in, or after about 8 s ("more" either way)
  const t0=Date.now();for(let i=0;i<10;i++){const qq=new URLSearchParams(q);qq.set('limit','100');qq.set('offset',String(i*100));
   const r=await fetch(DASH.origin+'/api/sessions?'+qq,{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(i?Math.max(1500,8000-(Date.now()-t0)):30000)}).catch(()=>null);
   if(!r?.ok){if(!i)return send(res,r?.status||502,{error:'Could not load the chats. Try again in a moment.'});break}
   raw=await r.json().catch(()=>({}));const page=raw.sessions||[];
   for(const x of users.filter(u,p,{sessions:page},agent).sessions){if(seen>=skip&&out.length<lim)out.push(x);seen++}
   if(page.length<100){end=true;break}if(out.length>=lim||Date.now()-t0>8000)break}
  return send(res,200,{...raw,sessions:out,total:seen,...(end?{}:{more:true})})}
 // the engine's status takes ~2 s and every page draw asks for it: the last answer (5 s) at once, read again behind the
 // scenes; a poll waiting for a restart sends x-fresh. Not read yet or the engine failed: the plain pass-through below
 if(p==='/hapi/status'&&req.method==='GET'){const k=q.toString(),hit=hapiStatus.peek(k);
  const read=()=>fetch(DASH.origin+'/api/status'+(k?'?'+k:''),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});
  if(hit&&'v' in hit&&!req.headers['x-fresh'])return send(res,200,transform(await hapiStatus.get(k,read)));
  try{return send(res,200,transform(await hapiStatus.get(k,read,{force:true})))}catch{}}
 if((p==='/hapi/tools/toolsets'||p==='/hapi/skills')&&req.method==='GET'&&!req.headers['x-fresh']){const k=p+'?'+q.toString();
  const read=()=>fetch(DASH.origin+'/api'+p.slice(5)+'?'+q.toString(),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});
  try{return send(res,200,transform(await hapiLists.get(k,read)))}catch{}}   // the engine failed: the plain pass-through below says why
 if(p.startsWith('/hapi/'))return proxy(req,res,DASH,'/hapi',{'x-hermes-session-token':DASH_TOKEN},{transform,body});
 const live=chatM&&req.method==='POST'?{key:agent+'|'+decodeURIComponent(chatM[1]),user:u.id}:undefined;
 // a new message starts a new turn: the person's browser lifts a Stop they pressed in this chat
 if(live)localBrowser.turn(decodeURIComponent(chatM[1]),u.id);
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
const screens=createScreens({keepOn:a=>agentAds.keepOn(a)});
// every agent's own AdsPower on its own screen, as its own user, with its own port and sign-in (app/agent-adspower.mjs, 1 Nov 2026)
const agentAds=createAgentAdspower({DATA,HERMES_HOME,screens,wanted:a=>optins.on('adspower',a),help:a=>a===HELP_AGENT,codeUser:a=>agentDefaults.codeUser(a),agentNames,readConfig,pick,withAgent,live:LIVE_APP,nameOf:a=>agentName(a),skip:async a=>a===HELP_AGENT||await isTestAgent(a),
 mcp:(a,m,p,b)=>fetch(`${DASH.origin}/api/mcp/servers${p}?profile=${encodeURIComponent(a)}`,{method:m,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok&&r.status!==404)throw new Error('MCP '+m+' '+r.status+' '+(await r.text().catch(()=>'')).slice(0,120))})});
const SCREEN=new URL(env.UI_SCREEN||'http://127.0.0.1:6080');
const BUILD=String(Date.now());
const sameOrigin=req=>{const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host}catch{return false}};
const plugins=createPluginHost({DASH,DASH_TOKEN,users,send,security,proxy,me,validCookie,sameOrigin});
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
  if(codeOnline.handle(req,res))return;   // code.elmora.example and code-preview.elmora.example: Code online, behind sign-in
  if(p==='/install-ping')return install.ping(req,res);
  if(p==='/healthz')return send(res,200,{ok:true,build:BUILD,live:liveCount(),engine:(void engineAgents(),engAgents.n),busy:busyTotal({live:liveCount(),setups:export_setups.running(),ops:opsBusy(),relay:relay.sending(),gwRestarting:!!gwRestarting,engineUpdate:engineUpd.busy(),restore:backups.busy()})});
  // the code bridge agents' engines call during a Code run for a computer project (app/code-bridge.mjs)
  if(p.startsWith('/mcp/code/')&&await codeBridge.handle(req,res,{send,readBody}))return;
  // run_self and the rest (aqeelos-self): from this box only, each agent's address signed
  {const ms=/^\/mcp\/self\/([\w-]+)\/([\w-]+)$/.exec(p);if(ms)return await srMcp(req,res,ms)}
  // an agent's Google files (google-files.mjs): from this box only, signed per agent, only the files listed for it
  {const mf=/^\/google-files\/([\w-]+)\/([\w-]+)$/.exec(p);if(mf){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method!=='POST')return send(res,405,'POST only');
   const x=Buffer.from(String(mf[2])),y=Buffer.from(sign('google-files:'+mf[1]).slice(0,32));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,{error:'bad signature'});
   let body;try{body=JSON.parse(await readBody(req,4e6))}catch{return send(res,400,{error:'bad json'})}const r=await googleFiles.call(mf[1],body);return send(res,r.status,r.json)}}
  // the posting gate an agent's posting schedule runs first (posting-limits.mjs): from this box only, signed per agent
  {const mg=/^\/posting-gate\/([\w-]+)\/([\w-]+)$/.exec(p);if(mg){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');
   const x=Buffer.from(String(mg[2])),y=Buffer.from(String(relay.sig(mg[1])));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,'bad signature');
   const t=await postingLimits.gate(mg[1]).catch(e=>'aqeelOS could not check the limits ('+e.message+'), so no post this run.\n{"wakeAgent": false}');res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});return res.end(t+'\n')}}
  // the "notify me" tool agents call (from this box only; each agent's address is signed)
  const mn=/^\/mcp\/notify\/([\w-]+)\/([\w-]+)$/.exec(p);
  if(mn){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method==='GET')return send(res,405,'POST only');
   let msg={};try{msg=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'})}// connect_mcp_tool: the right way for an agent to start a sign-in (public return address, never localhost)
   const signed=(()=>{const a=Buffer.from(String(mn[2])),b=Buffer.from(String(relay.sig(mn[1])));return a.length===b.length&&timingSafeEqual(a,b)})();
   // self-repair kit (agent-versions.mjs): own-scope tools for every agent but the main one; a SOUL change by the agent
   // itself starts the "does it still answer" check; my_settings is versioned (undo) before it takes effect
   {const base=mn[1].split('--')[0],nm=msg.params?.name,A=msg.params?.arguments||{};
    if(signed&&base!=='default'&&msg.method==='tools/call'&&nm==='change_instructions')versions.arm(base).catch(()=>{});
    if(signed&&base!=='default'&&msg.method==='tools/call'&&nm==='my_settings'&&A.value!==undefined&&OWN_SETTINGS.test(String(A.key||'').trim())){const r=await versions.mySetting(base,String(A.key).trim(),A.value,{by:NAMES[base]||base,why:A.why});
     if(!r.isError){console.log('own settings: '+base+' set '+A.key+' (versioned)');restartLater(base+' changed its own '+A.key);versions.arm(base).catch(()=>{})}
     return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.isError?r.text:r.text+' It takes effect from your next message (aqeelOS reloads the agents once no reply is running).'}],...(r.isError?{isError:true}:{})}})}
    if(signed&&msg.method==='tools/call'&&VERSION_TOOLS.some(x=>x.name===nm)){const who=NAMES[base]||base;let r;   // the main agent too (7 Nov 2026): every agent can see and fix its own problems
     try{if(nm==='my_changes'){const c=await versions.changes(base,{limit:A.limit||30});r={text:(c.items.length?c.items.map(x=>'- '+x.id+' '+x.kind+(x.state==='undone'?' [undone]':'')+': '+x.what+(x.why?' — '+x.why:'')+' · '+x.by+' · '+new Date(x.at).toISOString().slice(0,16)).join('\n'):'No changes yet.')+(c.watch?'\n\naqeelOS is checking that you still answer after your latest change.':'')}}
      else if(nm==='undo_my_change'){const x=await versions.undo(base,String(A.id||''),{by:who});r={text:'Undone: '+(x.what||('instructions back to version '+x.v))+'. That is a version too.'};versions.arm(base).catch(()=>{})}
      else if(nm==='my_logs')r=await versions.myLogs(base,A);
      else if(nm==='my_runs')r=await versions.myRuns(base,A);
      else if(nm==='my_health')r=await versions.myHealth(base);
      else if(nm==='my_deliveries')r=await versions.myDeliveries(base,A);
      else if(nm==='my_schedules'){r=await versions.mySchedules(base,A,{by:who});if(!r.isError&&A.action&&!['list','run_now'].includes(A.action))versions.arm(base).catch(()=>{})}
      else if(nm==='create_my_webhook')r=await versions.createWebhook(base,A,{by:who});
      else if(nm==='test_send')r=await versions.testSend(base,A);
      else if(nm==='reconnect_my_connector'){const n=String(A.name||'').trim().toLowerCase();
       if(['whatsapp','telegram','slack','discord','signal'].includes(n)){msg.params={...msg.params,name:'reconnect_channel',arguments:{channel:n}};r=null}
       else{msg.params={...msg.params,name:'connect_mcp_tool',arguments:{tool:n}};r=null}}
     }catch(e){r={isError:true,text:e.message}}
     // outside its own scope: filed for the aqeelOS fixer by itself, so the agent never needs another agent
     if(r&&r.isError&&r.outside&&nm==='my_schedules'){try{const f=await issues.file({agent:base,what:'Schedule outside its own list',missing:who+' needs to change schedule '+String(A.id)+' which is not in its own list',evidence:JSON.stringify(A).slice(0,600),proposed_fix:'Move that schedule into '+who+'\'s own list unchanged (create there, check it fires once, then remove the old one).',origin:await originOf(base,'my_schedules')});r.text+=' Filed for the aqeelOS fixer as issue '+f.issue.id+'; my_issues shows it.'}catch{}}
     if(r)return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:String(r.text||'')}],...(r.isError?{isError:true}:{})}})}}
   // nothing is made without a plain name and one line on what it is for (name-rules.mjs): refused with what to add
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='name_thing'){const r=await nameThing(mn[1].split('--')[0],msg.params?.arguments||{}).catch(e=>({isError:true,text:e.message}));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'){const why=nameRefusal(msg.params?.name,msg.params?.arguments);if(why){console.log('names: refused',msg.params?.name,'for',mn[1]);return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:why}],isError:true}})}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='connect_mcp_tool'){const tool=String(msg.params?.arguments?.tool||'').trim();const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    const redirect=MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(tool);
    const ag=mn[1].split('--')[0];
    await whyOf.noteApp(ag,tool,{by:'agent',purpose:String(msg.params?.arguments?.why||'').slice(0,300),from:await whyOf.from(ag)}).catch(()=>{});
    try{const pr=await sharing.prepareSignin(ag,tool,redirect);if(pr.changed)await new Promise(r=>setTimeout(r,2500));const [svc,where,save]=appSettings(tool,pr.url);
     const j=await startSignin(ag,tool);
     // the answer is written for anyone on the team: the easy way first, exact steps only when an app of their own is involved
     if(j.authorization_url&&!pr.own)return reply(`Send the person exactly this (no technical steps needed):\n\nTo connect ${svc}, open this link and click Allow: ${j.authorization_url}\nYou'll land on a page that says "Signed in". That's it.\n\n(Open it within 5 minutes; after that, ask again for a fresh link.)`);
     if(j.authorization_url)return reply(`${svc} is connected through the person's own ${svc} app, so that app must list aqeelOS's address first. Send exactly this:\n\n1. Open ${where}.\n2. Add this address exactly: ${redirect}\n3. Click ${save}. (It doesn't work until it's saved.)\n4. Then open this link and click Allow: ${j.authorization_url}\n5. You'll land on a page that says "Signed in".\n\nIf ${svc} says "redirect_uri did not match", steps 2–3 weren't saved: redo them, then open the link again. Only an admin of that ${svc} app can do steps 1–3. If the person is not one and cannot ask one, offer Composio as the fallback and tell them: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only if they agree.`);
     const err=j.error||j.detail||'no link came back';
     if(/client registration|client_id|client id/i.test(err))return reply(`${svc} needs an app of the person's own (a one-time setup, free). Offer to walk them through it, or do it with them in the browser: create an app at ${where.split(' → ')[0]}, add this Redirect URL: ${redirect}, then they paste its Client ID and Client Secret with the lock button (or in Abilities › MCP tools › ${tool} › Sign in). If they cannot (no admin access) or do not want to, offer Composio as the fallback and tell them: "Composio is quick (one click on Allow, nothing to set up), but its free plan has a limit on actions and costs money beyond it." Use it only if they agree.`,true);
     return reply('Could not start the sign-in: '+err,true)}catch(e){return reply('Could not start the sign-in: '+e.message,true)}}
   // manage_agent (agent-access.mjs): change another agent at the level shared with the caller; checked here on every call
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='manage_agent'){const r=await agentAccess.call(mn[1],msg.params?.arguments||{}).catch(e=>({isError:true,text:e.message}));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='change_instructions'){const ag=mn[1].split('--')[0];const r=await instructions.change(ag,msg.params?.arguments||{},{by:NAMES[ag]||ag}).catch(e=>({isError:true,text:e.message}));if(!r.isError)console.log('instructions:',ag,'changed its own ('+r.text.slice(0,40)+')');return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='organize_schedule'){const r=await schedules.organize(mn[1],msg.params?.arguments||{}).catch(e=>({isError:true,text:e.message}));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='choose_browser'){const r=await askBrowser(mn[1],msg.params?.arguments||{});return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}]}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='type_secret'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const name=String(a.name||'').trim().toUpperCase();
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    if(!/^[A-Z][A-Z0-9_]{1,59}$/.test(name))return reply('Give the name of a saved secret, like GMAIL_PASSWORD.',true);
    // typing a secret into a field is using it (viewer is enough); the agent's own, or one shared with it (sharing.mjs)
    const sa=await secretAccess.resolve(base,name,'use');if(!sa.ok&&!/^No saved secret/.test(sa.why))return reply(sa.why,true);
    const value=sa.ok?await readFile(sa.file,'utf8').catch(()=>null):null;
    if(value===null){const have=await readdir(secretDir(base)).catch(()=>[]);return reply('No saved secret called '+name+'.'+(have.length?' Saved ones: '+have.join(', ')+'.':' Ask the person with ask_secret.'),true)}
    try{await screens.typeInto(base,value,{enter:!!a.press_enter,secret:true});return reply('Typed '+name+' into the focused field on your screen'+(a.press_enter?' and pressed Enter':'')+'. You did not see it; take a screenshot to check the result.')}catch(e){return reply('Could not type it: '+e.message,true)}}
   // one-time secret links (secret-links.mjs): for the calling agent; the main agent may also ask for an agent of the owner's
   if(signed&&msg.method==='tools/call'&&['request_secret_link','secret_link_status'].includes(msg.params?.name)){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    const target=String(a.agent||'').trim()||base;const own=o=>!o||o==='owner';
    if(target!==base&&(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target)||target.includes('--')))return reply('Give the agent id, like support-agent.',true);
    if(target!==base&&!(base==='default'&&own(users.agentOwner(target))))return reply('You can only ask for keys for yourself'+(base==='default'?' or for an agent the owner owns':'')+'.',true);
    const tz=installTz()||(await readConfig('default').catch(()=>null))?.timezone||sysTz(),when=t=>{const x=localAt(t,tz);return String(x.h).padStart(2,'0')+':'+String(x.min).padStart(2,'0')};
    try{if(msg.params.name==='request_secret_link'){const r=await secretLinks.create({agent:target,name:a.name,label:a.label,by:base});keysId.note(a.name,{label:a.label,description:a.description,agent:target}).catch(()=>{});console.log('secret link made by',base,'for',r.link.agent+':',r.link.name);
      return reply('Send the person this link exactly (it works once, until '+when(r.exp)+', about 30 minutes):\n\n'+r.url+'\n\nTell them: open it, paste '+r.link.label+' there and press Save. Never ask them to paste it in the chat. When they say it is saved (or a minute later), call secret_link_status with name '+r.link.name+(target!==base?' and agent '+target:'')+' to check. '+secretHow(r.link.agent,r.link.name))}
     const r=a.wait?await secretLinks.wait(target,a.name,20e3):await secretLinks.status(target,a.name);
     if(!r)return reply('There is no secret link for '+String(a.name||'').toUpperCase()+(target!==base?' on '+target:'')+'. Make one with request_secret_link.',true);
     const say={open:'Not saved yet. The link works until '+when(r.exp)+'. Check again in a minute (sleep 60 in your terminal), or when they say it is saved.',saved:'Saved '+r.name+' at '+when(r.done)+'. '+secretHow(r.agent,r.name),expired:'The link expired at '+when(r.exp)+' without being used. Make a new one if you still need it.',replaced:'A newer link replaced this one. Check that one.',cancelled:'The owner cancelled this link in aqeelOS. Ask them before making a new one.',saving:'It is being saved right now. Check again in a moment.',interrupted:'aqeelOS restarted while it was being saved, so it may not be there. Check whether '+r.name+' works; if not, make a new link.'}[r.state]||r.state;
     return reply(say,r.state==='expired'||r.state==='cancelled')}catch(e){return reply(e.message,true)}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='ask_secret'){const r=await askSecret(mn[1],msg.params?.arguments||{});{const A=msg.params?.arguments||{};if(A.mode==='save'&&!r.isError)keysId.note(A.name,{label:A.label,description:A.description,agent:mn[1].split('--')[0]}).then(()=>keysId.tick()).catch(()=>{})}return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   // apply_changes: an agent that changed settings, tools or skills (its own or another agent's) makes them take
   // effect itself, through the same careful restart as the Restart agents button: after every reply in progress
   // (its own included) has finished. Only agents of people who may use the unsafe tools.
   const mayApply=!lockedAgent(mn[1].split('--')[0],{})&&adminTier(mn[1]);   // F: restarting every agent is an admin-tier power
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='apply_changes'){if(!mayApply)return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'Only agents of admins can restart the agents. Ask an admin to press Restart agents on System › Health.'}]}});
    const why=String(msg.params?.arguments?.why||'settings changed').slice(0,120);restartLater(why+' (asked by '+(NAMES[mn[1].split('--')[0]]||mn[1])+')');
    // 7 Nov 2026: Donna's apply_changes restarted every agent and Telegram was gone for 4.5 minutes. An agent never restarts the engine now
    return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'No restart now. Apps and tool servers (MCP) you added, removed or shared apply by themselves within a minute or two: the engine reads the settings again. Other changes (settings read at start, plugins, toolsets) take effect at the restart in the quiet hours, '+'01:00-05:00. If it cannot wait, tell the person they can press Restart agents on System › Health. Finish your turn with one short line saying which of these applies.'}]}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='reconnect_channel'){const me=mn[1],reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{...(isError?{isError:true}:{}),content:[{type:'text',text}]}});
    const pf=String(msg.params?.arguments?.channel||'').trim().toLowerCase();
    if(!mayApply)return reply('Only agents of admins can reconnect channels. Ask an admin to press Reconnect on the Channels page.',true);
    if(!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook'].includes(pf))return reply('Name one of your own channels, for example whatsapp or telegram.',true);
    if(Date.now()-(reconnectAsked.get(me)||0)<60e3)return reply('A reconnect was just started for you. Wait a minute before asking again.',true);
    const pl=await platformsCached(me).catch(()=>null);if(!(pl?.platforms||pl||[]).some(x=>x.id===pf&&(x.configured||x.account)))return reply('You have no '+pf+' channel of your own to reconnect.',true);
    if((await pausedLoad())[me+'|'+pf])return reply('Your '+pf+' channel is paused by an admin, so nobody answers it on purpose. It is not reconnected. Tell the person an admin can resume it on the Channels page.',true);
    reconnectAsked.set(me,Date.now());console.log('reconnect_channel:',pf,'asked by',me);
    if(me==='default')restartGateway('reconnect '+pf+' (asked by '+(NAMES[me]||me)+')',{bridges:pf==='whatsapp'}).catch(()=>{});
    else setTimeout(()=>reconnectOne(me,pf).catch(e=>console.warn('reconnect_channel',me,pf,e.message)),4000);
    return reply('Reconnecting '+pf+' for you in a few seconds'+(me==='default'?' (the engine restarts once no reply is in progress, so every agent pauses for about 25 seconds)':'')+'. The connection drops briefly and comes back with its saved login, no new QR. Finish your turn now with one short line saying so. Do not check it in this turn.')}
   // access between agents: see what the others have (names only), ask for it, offer what you have; an admin decides
   if(signed&&msg.method==='tools/call'&&['access_list','request_access','offer_access'].includes(msg.params?.name)){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    try{if(msg.params.name==='access_list'){let [o,m,q]=await Promise.all([accessAsk.others(base),accessAsk.mine(base),accessAsk.of(base)]);if(!adminTier(base))o=o.filter(x=>users.agentMayManage(base,x.owner));   // F: never the owner's or other people's thingsconst nm=x=>NAMES[x]||x;
      return reply('You have:\n'+(m.map(x=>'- '+x.what+' '+x.label+' (kind '+x.kind+', id '+x.id+')'+(x.owner===base?', you own it':', shared by '+x.ownerName)).join('\n')||'- nothing shared yet')+'\n\nOther agents have (you can see these exist but not use them; ask with request_access):\n'+(o.map(x=>'- '+x.what+' '+x.label+' (kind '+x.kind+', id '+x.id+'), owned by '+x.ownerName).join('\n')||'- nothing else')+(q.length?'\n\nYour requests:\n'+q.map(r=>'- '+r.label+' for '+nm(r.to)+': '+(r.done?(r.ok?'allowed':'declined'):'waiting for an admin')).join('\n'):''))}
     if(!a.kind||!a.id)return reply('Give kind (mcp, google, plugin or key) and id, from access_list.',true);
     const from=await whyOf.from(base);const r=msg.params.name==='request_access'?await accessAsk.ask({kind:String(a.kind),id:String(a.id),to:base,by:base,dir:'get',why:a.why,from}):await accessAsk.ask({kind:String(a.kind),id:String(a.id),to:String(a.to||''),by:base,dir:'give',why:a.why,from});
     console.log('access asked by agent',base,msg.params.name,a.kind,a.id);return reply(r.already?r.text:'Asked. It shows under Bottlenecks in aqeelOS; nothing is shared until an admin allows it. Tell the person in one line what you asked for and why, then go on without it.')}catch(e){return reply(e.message,true)}}
   // register_account: an agent that made a login acting as the owner says so (Abilities › Connections)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='register_account'){const base=mn[1].split('--')[0];const r=await connAccounts.register(base,msg.params?.arguments||{}).catch(e=>({isError:true,text:e.message}));if(!r.isError&&r.id){const A=msg.params?.arguments||{};labels.set('ca',r.id,{name:A.label,description:A.description}).catch(()=>{})}console.log('account registered by',base+':',String(msg.params?.arguments?.label||'').slice(0,80));
    return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   // report_bottleneck: an agent says what blocks it (missing access, a sign-in, a permission, something only the person can give)
   // whatsapp_reply (kirimdev.mjs): the calling agent's own Kirimdev line only, to someone who wrote in the last 24 hours
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='whatsapp_reply'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};
    try{const r=await kirimdev.reply(base,String(a.to||''),String(a.text||''));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'Sent ('+r.length+' message'+(r.length===1?'':'s')+', status '+r.map(x=>x.status||'queued').join(', ')+'). Do not send it again.'}]}})}
    catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   // record_post (posting-limits.mjs): an agent with posting limits says what it just posted; aqeelOS checks the public sees it
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='record_post'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const r=await postingLimits.record(base,a).catch(e=>({isError:true,text:e.message}));
    return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.isError?{isError:true}:{})}})}
   // whatsapp_draft (kirimdev.mjs, Draft mode): send (as written or as the team changed it) or drop a draft the team answered
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='whatsapp_draft'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};
    try{const r=await kirimdev.draft(base,a.id,String(a.action||''),a.text,(NAMES[base]||base)+' (approved in Telegram)');return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.dropped?'Dropped. Nothing was sent.':'Sent ('+r.sent+' message'+(r.sent===1?'':'s')+'). Say so in the topic in one line. Do not send it again.'}]}})}
    catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   // team_group (team-group.mjs): read your team group, or change it when the owner says so in chat
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='team_group'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};
    try{const {action,...patch}=a;const g=action==='set'?await teamGroups.set(base,patch,(NAMES[base]||base)+' (asked in chat)'):await teamGroups.get(base);
     return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:(action==='set'?'Saved. The owner sees the change in aqeelOS.\n\n':'')+teamContext(g).join('\n')}]}})}
    catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='past_chats'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const r=await chatHistory.find(base,String(a.query||''),{limit:a.limit}).catch(e=>({text:e.message,error:true}));console.log('past chats searched by',base+':',String(a.query||'').slice(0,60),'→',r.total??'-');return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:r.text}],...(r.error?{isError:true}:{})}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='my_issues'){const base=mn[1].split('--')[0];const l=await issues.forAgent(base).catch(()=>[]);return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:l.length?l.map(i=>'- '+i.id+' '+i.state+(i.tries?' (try '+i.tries+' of 3)':'')+': '+i.missing+(i.state==='fixed'&&i.proof?' (proven: '+String(i.proof).slice(0,200)+')':i.result?.summary?' ('+i.result.summary+')':'')+(i.need&&['needs_human','stuck'].includes(i.state)?' (needs a person: '+i.need+')':'')).join('\n'):'No issues filed by you.'}]}})}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='report_bottleneck'&&msg.params?.arguments?.system===true){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};
    try{const from=await whyOf.from(base);const rep=await bottlenecks.report(base,{what:a.what,missing:a.missing,fix:a.proposed_fix||a.fix,system:true,from});
     const r=await issues.file({agent:base,report:rep.id,what:a.what,missing:a.missing,evidence:a.evidence,proposed_fix:a.proposed_fix||a.fix,affects:a.affects,needs:a.needs,origin:await originOf(base)});const i=r.issue;
     console.log('issue filed by',base+':',i.id,i.state,String(a.missing).slice(0,80));
     // 7 Nov 2026: nobody approves; the fixer fixes, reloads and proves it, and messages a person only when one is needed
     const say=i.state==='open'?'Filed as issue '+i.id+' (the fixer is switched off). Not fixed yet: say so plainly.':['fixed'].includes(i.state)?'Issue '+i.id+' is already fixed and proven.':
      i.state==='needs_human'?'Filed as issue '+i.id+'. It waits for a person: '+(i.need||'see System › Health')+'.':
      'Filed as issue '+i.id+'. The aqeelOS fixer on this server fixes it by itself, reloads safely and proves it with the original check; nobody needs to be messaged. Tell the person in one line: it is filed and being fixed automatically, not fixed yet. my_issues shows where it is.';
     return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:(r.again?'This was already filed; added your report to it. ':'')+say}]}})}catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='report_bottleneck'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};try{await bottlenecks.report(base,{what:a.what,missing:a.missing,fix:a.fix,system:a.system===true,from:await whyOf.from(base)});console.log('bottleneck reported by',base+':',String(a.missing).slice(0,80));return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:a.system===true?'Reported as a system problem. The owner sees it on Health and gets a message about it. It is NOT fixed yet: say so plainly to the person (for example: This is not fixed yet, I have reported it to the owner), and never call it fixed or logged until you have checked that it works.':'Reported. The person sees it under Bottlenecks with what would fix it. Tell them briefly in your reply too, then carry on with anything you can still do.'}]}})}catch(e){return send(res,200,{jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}}
   // aqeelOS Code is one-way (25 Oct 2026): a Code run may ask agents for things, but an agent never changes a Code
   // project, so agents get no Code project tools (the old code_projects and code_work are gone)
   // an agent changes its own everyday settings (voice notes, voice, time zone, how replies show) instead of sending the
   // person to the owner; nothing here widens what it can reach (no tools, keys, terminal, browser or access settings)
   // an agent turns off an app of its own it does not need (7 Nov 2026: Sela and cove-support asked); only off, never on
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='switch_my_app_off'){const base=mn[1].split('--')[0],app=String(msg.params?.arguments?.app||'').trim();
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    try{const c=await readConfig(mn[1]).catch(()=>null)||{},e=c.mcp_servers?.[app];
     if(/^adspower$/i.test(app)){await optins.set('adspower',base,false);agentAds.retire(base).catch(()=>{});console.log('abilities: '+base+' switched its own AdsPower off');return reply('AdsPower is off for you now; its app stops within a minute. An admin can switch it on again in Edit agent › Abilities.')}
     if(!e)return reply('You have no app called '+app+'. Your apps: '+(appNames(c).concat(Object.entries(c.mcp_servers||{}).filter(([,x])=>COMPOSIO_URL.test(String(x?.url||''))).map(([n])=>n)).join(', ')||'none')+'.',true);
     if(COMPOSIO_URL.test(String(e.url||'')))await optins.set('composio',base,false);
     else if(isConnectorEntry(e))await optins.setApp(base,app,false);
     else return reply(app+' is not a sign-in app, so it cannot be turned off this way. Ask the owner (report_bottleneck) if you do not need it.',true);
     await composioOff(base);closeSolvedSignins().catch(()=>{});console.log('abilities: '+base+' switched its own '+app+' off');
     return reply(app+' is off for you now: its tools go away and it no longer asks you to sign in. An admin can switch it on again in Edit agent › Abilities.')}
    catch(er){return reply('Could not turn it off: '+er.message,true)}}
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='my_settings'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{},key=String(a.key||'').trim();
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    if(!OWN_SETTINGS.test(key))return reply('Only these can be changed this way: stt.* (voice notes, e.g. stt.language: "" = detect each time, "id", "en"), tts.* (your voice), timezone and display.*. Anything else goes through report_bottleneck.',true);
    if(a.value===undefined){const c=await readConfig(base).catch(()=>null);return reply(key+' = '+JSON.stringify(pick(c,key)??null))}
    const r=await setKey(base,key,a.value===null?'':a.value).catch(e=>({ok:false,out:e.message}));if(!r.ok)return reply('Could not change it: '+String(r.out||'').trim().slice(-300),true);
    console.log('own settings: '+base+' set '+key);restartLater(base+' changed its own '+key);
    return reply('Saved '+key+' = '+JSON.stringify(a.value)+'. It takes effect from your next message (aqeelOS reloads the agents once no reply is running).')}
   // the guarded browser in aqeelOS Code on the agent owner's own computer (no extension; only the sites allowed there)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='computer_browser'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const owner=users.agentOwner(base)||'owner';
    const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    try{const r=await code.browse([owner],{action:String(a.action||''),url:a.url,ref:a.ref,text:a.text,key:a.key,submit:!!a.submit});return reply(r.text||'(no answer)',r.state==='failed')}catch(e){return reply(e.message,true)}}
   // a Code run on the engine (aqeelOS models) asks another agent attached to it, as the person who sent the run; files
   // in the answer are saved into that run's project (not in Plan only)
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='code_ask_agent'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    const target=String(a.agent||''),f=codeAgents.runFor(base,target);if(f.error)return reply(f.error,true);if(target===base)return reply('That is you. Do it yourself.',true);const who=users.byId(f.run.user);
    if(!who||users.gate(who,'/gapi/api/model/options','GET',new URLSearchParams(),target))return reply('The person who started this run may not use that agent.',true);if(!String(a.task||'').trim())return reply('Say what the agent should do.',true);if(a.save_to&&safeRel(a.save_to)===null)return reply('Save files to a folder inside the project, for example from-agents or assets.',true);
    try{const r=await codeAsk(who,target,String(a.task),{project:f.run.project,plan:f.run.plan});let saved=[];if(r.files.length&&!f.run.plan&&f.run.dir)saved=await codeAgents.saveInto(f.run.dir,r.agentName,r.files,a.save_to);console.log('code: '+base+' asked',target,'in a Code run'+(saved.length?' ('+saved.length+' files)':''));
     return reply(r.agentName+': '+(r.text||'(no answer)')+(saved.length?'\n\nSaved in the project: '+saved.join(', '):'')+(f.run.plan&&r.files.length?'\n\nIt had files ('+r.files.map(x=>x.name).join(', ')+'); they are not saved in Plan only.':!f.run.dir&&r.files.length?'\n\nIt had files ('+r.files.map(x=>x.name).join(', ')+'); this project is on the person\'s computer, so they are not saved. Ask the agent for the text itself if you need it.':''))}catch(e){return reply(e.message,true)}}
   // "Open in Code": the agent keeps a build request and gets a link that opens Code with it filled in and itself attached
   if(signed&&msg.method==='tools/call'&&msg.params?.name==='open_in_code'){const base=mn[1].split('--')[0],a=msg.params?.arguments||{};const reply=(text,isError)=>send(res,200,{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text}],...(isError?{isError:true}:{})}});
    const t=String(a.request||'').trim();if(!t)return reply('Give the request in plain words.',true);try{const id=await codeAgents.handoff(base,t),link=PUBLIC_URL+'/#/code/code/'+id;
     return reply('Give the person this link in your reply, on a line of its own: [Open in Code]('+link+')\nIt opens aqeelOS Code (the desktop app on their computer) with the request filled in and you attached. Nothing runs until they press send. Do not start building it yourself.')}catch(e){return reply(e.message,true)}}
   const out=await relay.mcp(mn[1],mn[2],msg);
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&(await kirimdev.lines().catch(()=>({})))[mn[1].split('--')[0]])out.body.result.tools.push({name:'whatsapp_reply',description:'Send a message to a customer on your own Kirimdev line (the team\'s WhatsApp CRM; not a WhatsApp channel of yours). Use it when the team answers a HANDOFF question in your Questions topic: send their answer to that customer (the number is in the handoff post). Your normal replies to customers are sent for you; do not use this for them. Only works for someone who wrote to you in the last 24 hours. Separate several messages with a line containing only ---; [FOTO: file] and [TEMPLATE: name] send pictures.',inputSchema:{type:'object',properties:{to:{type:'string',description:'The customer\'s WhatsApp number, e.g. 6281234567890'},text:{type:'string',description:'What to send, in the customer\'s language'}},required:['to','text']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&(await kirimdev.lines().catch(()=>({})))[mn[1].split('--')[0]])out.body.result.tools.push({name:'whatsapp_draft',description:'Draft mode: when the team answers one of your DRAFT #<n> posts in your Questions topic, act on it here. "ok" (or yes, kirim, send) = action send. A reply with changed text = action send with that text, exactly as they wrote it. "no" (or jangan, drop) = action discard. Never send a draft nobody approved.',inputSchema:{type:'object',properties:{id:{type:'integer',description:'The draft number from the post, e.g. 12 for DRAFT #12'},action:{type:'string',enum:['send','discard']},text:{type:'string',description:'Only when the team changed the text: their text, exactly. Separate several messages with a line containing only ---'}},required:['id','action']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push(...VERSION_TOOLS);
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'team_group',description:'Your team Telegram group and its topics (Questions, Orders, Log, your own topic), as set in aqeelOS. Use action get to read where to post. Use action set ONLY when the owner tells you in chat to use another group or topic; send just what changes. Every change is shown to the owner.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['get','set']},name:{type:'string',description:'The group\'s name'},chatId:{type:'string',description:'The group id, e.g. -1001234567890'},questions:{type:'integer',description:'Topic number for questions and drafts'},orders:{type:'integer',description:'Topic number for new orders'},log:{type:'integer',description:'Topic number for the activity log'},own:{type:'integer',description:'Your own topic number'},mention:{type:'string',description:'Who to mention for a person, e.g. @illusiveminds @diabloxd1337'}},required:['action']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&mayApply)out.body.result.tools.push({name:'apply_changes',description:'Make settings changes take effect: after you changed an agent\'s config (yours or another agent\'s), a plugin or a toolset, call this once. Apps and tool servers (MCP) apply by themselves within a minute or two; everything else is applied at the next restart in the quiet hours (01:00-05:00). Never restart the gateway any other way.',inputSchema:{type:'object',properties:{why:{type:'string',description:'What changed, in a few words'}},required:['why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&mayApply)out.body.result.tools.push({name:'reconnect_channel',description:'Make a change to one of YOUR OWN channels take effect, for example after you changed WHATSAPP_GROUP_POLICY or another WHATSAPP_* / TELEGRAM_* setting. A WhatsApp connection is its own process that reads its settings only when it starts, so apply_changes does not reach it: call this instead. It restarts only that connection of yours (saved login kept, no new QR). Never kill or restart processes yourself.',inputSchema:{type:'object',properties:{channel:{type:'string',description:'Your channel, e.g. whatsapp or telegram'}},required:['channel']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&await postingLimits.usesLimits(mn[1].split('--')[0]).catch(()=>false))out.body.result.tools.push({name:'record_post',description:'Right after EACH public post or comment you publish, call this once with the link of the post you replied to (or your own post), the exact text you posted and whether it went to a hot or warm lead. aqeelOS counts it against your posting limits and checks, signed out, that the public can see it. If it answers NOT visible, stop posting and report the failure as it says.',inputSchema:{type:'object',properties:{post_url:{type:'string',description:'Full https link of the post you replied to (or your own new post)'},text:{type:'string',description:'The exact text you posted'},lead:{type:'string',enum:['hot','warm']}},required:['post_url','text','lead']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push(agentAccess.TOOL);
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'change_instructions',description:'Change your own standing instructions (your SOUL) when the person who owns you, or someone with their authority, gives you a new rule, limit, target or correction. Change the rule where it is written so it is said once: for each place give the exact current text (old_text, copied from your instructions) and its replacement (new_text). Never add an "override" section and never edit SOUL.md yourself. aqeelOS keeps every version with who said it and why (that history is your decisions log) and the owner can undo it. Every change applies at once (from your next message), a full rewrite too (rewrite = the whole new text); nobody needs to approve it, and it can be undone. Do not save rules, caps or limits in memory.',inputSchema:{type:'object',properties:{edits:{type:'array',items:{type:'object',properties:{old_text:{type:'string',description:'Exact text now in your instructions (unique)'},new_text:{type:'string',description:'What it becomes'}},required:['old_text','new_text']}},rewrite:{type:'string',description:'Only for a full rewrite: the whole new text (always waits for approval)'},why:{type:'string',description:'What changes and why, in one line, e.g. "comments 3 per hour instead of 5"'},said_by:{type:'string',description:'Who decided it, e.g. "the owner on Telegram"'}},required:['why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'choose_browser',description:'Before a browser job in a chat, ask the person once where to do it: their own Chrome ("yours": a separate window on their computer, with the sign-ins they already have; best for one-off jobs such as Google Cloud or admin consoles) or your screen on the AI box ("server": keeps working when their computer is off; needed for anything scheduled or long-running). When you also have computer_browser, there is a third choice: the guarded browser in aqeelOS Code on their computer ("computer": no extension needed, they watch it live in Code, only the sites they allowed there). Give your suggestion. Wait for the answer, then follow it for the rest of the chat.',inputSchema:{type:'object',properties:{task:{type:'string',description:'What you will do in the browser, in a few words'},suggest:{type:'string',enum:['yours','server']},why:{type:'string',description:'One short reason for your suggestion'}},required:['task','suggest']}},{name:'type_secret',description:'Type a secret the person saved for you (a password, code or key) into the field that has focus on your screen, without seeing it. Click the field first. Saved secrets: '+((await readdir(secretDir(mn[1].split('--')[0])).catch(()=>[])).join(', ')||'none yet (ask with ask_secret)')+'.',inputSchema:{type:'object',properties:{name:{type:'string',description:'The saved name, e.g. GMAIL_PASSWORD'},press_enter:{type:'boolean'}},required:['name']}},{name:'ask_secret',description:'Ask the person for a password, API key or other secret through a protected field in their aqeelOS chat. You never see the value. mode "type": it is typed into the field that has focus on your screen (click the field first; set press_enter to submit). mode "save": it is stored as a named key (name in capitals, e.g. OPENAI_API_KEY) that the engine and your commands can use. Never ask for a secret in plain chat or on the screen viewer; always use this.',inputSchema:{type:'object',properties:{label:{type:'string',description:'What it is, e.g. "Gmail password for ops@company.com"'},mode:{type:'string',enum:['type','save']},name:{type:'string',description:'For save: the key name in capitals'},press_enter:{type:'boolean',description:'For type: press Enter after typing'}},required:['label','mode']}},{name:'organize_schedule',description:'File one of your schedules so the person understands it at a glance: put it in a folder (the project or client it is for, e.g. a client name, Personal Finance), give it a clear title and a one-sentence description of what it does and why. Use it right after you create or change a schedule, and when the person asks you to tidy, move or rename schedules.',inputSchema:{type:'object',properties:{job_id:{type:'string',description:'The schedule id (from cronjob list)'},folder:{type:'string',description:'Folder name, 1-2 words'},title:{type:'string',description:'Clear title, max 6 words (optional)'},description:{type:'string',description:'One plain sentence: what it does and why'}},required:['job_id']}},{name:'connect_mcp_tool',description:'Start the sign-in for one of your MCP tools (slack, composio, notion…) and get the link to give the person. Always use this to connect an MCP tool; never a command-line login or a localhost callback.',inputSchema:{type:'object',properties:{tool:{type:'string',description:'The MCP tool name as listed, e.g. "slack" or "composio"'},why:{type:'string',description:'What you need it for, in one line the person understands (e.g. "to read the Q3 numbers in your Notion for the report you asked for"). It is shown on the sign-in notice.'}},required:['tool','why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push(
    {name:'access_list',description:'What you have (apps, Google accounts, plugins, keys) and what the other agents have that you cannot use yet (names only, never values), plus your open access requests.',inputSchema:{type:'object',properties:{}}},
    {name:'request_access',description:'Ask to use something another agent has (from access_list): an app, a Google account, a plugin or a key. An admin decides under Bottlenecks; it is never shared without that. Use it when the work needs it, not just in case.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['mcp','google','plugin','key']},id:{type:'string',description:'id from access_list'},why:{type:'string',description:'one line: what you need it for'}},required:['kind','id','why']}},
    {name:'offer_access',description:'Offer something you have (from access_list) to another agent that needs it. An admin decides under Bottlenecks.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['mcp','google','plugin','key']},id:{type:'string'},to:{type:'string',description:'the other agent id'},why:{type:'string'}},required:['kind','id','to','why']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push(
    {name:'request_secret_link',description:'Lock box link (lockbox, secret link): when you need a token, password or API key saved and the person is talking to you on Telegram, WhatsApp, Slack or any channel other than the aqeelOS app: get a one-time link to send them. They open it on their phone and paste the value; it is saved as the key you name, exactly like ask_secret mode "save". You never see it. The link works once, for 30 minutes.'+(mn[1].split('--')[0]==='default'?' You may also ask for a key for another agent the owner owns (agent).':''),inputSchema:{type:'object',properties:{label:{type:'string',description:'What it is, in words the person recognises, e.g. "Support Telegram bot token"'},name:{type:'string',description:'The key name in capitals, ending in _KEY, _TOKEN, _SECRET or _PASSWORD, e.g. SALES_SUPPORT_BOT_TOKEN. It must be a new key: a link never replaces one that is set.'},...(mn[1].split('--')[0]==='default'?{agent:{type:'string',description:'Optional: the agent id the key is for (default: you)'}}:{})},required:['label','name']}},
    {name:'secret_link_status',description:'Whether the person saved the key through the link from request_secret_link. With wait true it waits up to 20 seconds; otherwise check again a minute later or when they say it is saved.',inputSchema:{type:'object',properties:{name:{type:'string',description:'The key name you asked for'},wait:{type:'boolean',description:'Wait (up to 20 seconds) until it is saved'},...(mn[1].split('--')[0]==='default'?{agent:{type:'string',description:'The agent id, if you asked for another agent'}}:{})},required:['name']}});
   // both tools only on a tools list (7 Nov 2026: the second push ran unguarded and broke every "initialize" with a 500)
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'switch_my_app_off',description:'Turn off one of your own apps you do not need (a sign-in app such as notion-abel or slack, Composio, or AdsPower), so it stops asking you to sign in and its tools go away. Only off: turning one on again is for an admin (Edit agent › Abilities). Use it when the person says you do not need that app, or an app you never use keeps asking for a sign-in.',inputSchema:{type:'object',properties:{app:{type:'string',description:'the app as your tools name it, e.g. notion-abel, slack, composio, AdsPower'}},required:['app']}},{name:'my_settings',description:'Read or change your own everyday settings yourself, without asking the owner: voice notes (stt.language: "" detects the language each time, or a code like "id" or "en"; stt.*), your voice (tts.*), your time zone (timezone, e.g. Europe/Berlin) and how replies show (display.*). Leave value out to read the current value. Do this when the person asks for such a change or a setting clearly gets in their way.',inputSchema:{type:'object',properties:{key:{type:'string',description:'e.g. stt.language, tts.provider, timezone'},value:{description:'the new value; leave out to read'}},required:['key']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'register_account',description:'Call this right after you create a login that acts AS THE PERSON (their own Google account, a Slack or Notion sign-in as them, their personal Telegram account, any account where what you do goes out under their name), not a bot and not a service such as n8n or Composio. It shows in aqeelOS under Abilities › Connections, where the owner sees what you do with it and can pause or disconnect it. A login that is not registered is flagged to the owner.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['google','mcp-oauth','telegram-user','other'],description:'google (a google_token file), mcp-oauth (an app sign-in), telegram-user (a personal Telegram session), other'},label:{type:'string',description:'Plain name, e.g. "Slack, Sam (Acme)" or "Google, work"'},can:{type:'array',items:{type:'string',enum:['read','draft','send']},description:'What you may do with it, as the person agreed'},where:{type:'string',description:'Where the credential is stored, e.g. ~/.hermes/mcp-tokens/slack-pixel.json'},note:{type:'string',description:'What it is for, in one line'}},required:['kind','label','where']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'report_bottleneck',description:'When you cannot do something because a person has to act first, report it once (aqeelOS adds the chat and message that led to it, so say the purpose plainly in what): access you are missing (a folder, a sheet, an account, a channel), a sign-in, a permission or a setting, or information only they have. Also use it, with system true, when something is broken outside your own files and tools (the engine, aqeelOS, a channel or bridge, another agent, a server): you cannot fix that yourself, so never say it is fixed. Not for ordinary errors you can fix or work around yourself. Say what you were trying to do, what is missing, and what would fix it. It appears under Bottlenecks in aqeelOS with a fix button.',inputSchema:{type:'object',properties:{what:{type:'string',description:'What you were trying to do, in a few words'},missing:{type:'string',description:'What is missing, plainly (for example: access to the Finance folder in Google Drive)'},fix:{type:'string',description:'What would fix it (for example: share the folder with me, or connect Drive for me)'},system:{type:'boolean',description:'true when the cause is outside your own files and tools: the engine, aqeelOS, the sending code, a channel or bridge, a tool server, another agent. It becomes an issue that the aqeelOS fixer on this server fixes by itself (or after the owner\'s OK when it touches other teams, keys, permissions, money or deleting data) and you get the answer in this chat.'},evidence:{type:'string',description:'With system true: what you saw that proves it (error text, message ids, file and line, what you ran and what came back)'},proposed_fix:{type:'string',description:'With system true: what you think should change, and where'},affects:{type:'array',items:{type:'string'},description:'With system true: other agent ids the fix would change (leave out when only you)'},needs:{type:'array',items:{type:'string',enum:['keys','permissions','money','delete']},description:'With system true: mark when the fix needs new keys/secrets, permission or sharing changes, spending money or deleting data'}},required:['missing']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'my_issues',description:'The system issues you filed (report_bottleneck with system true) and where each one is: queued, fixing, applying (waiting to reload safely), verifying (the original check runs again), fixed (proven, with the proof), needs_human (what a person must do), stuck (3 tries failed) or gone.',inputSchema:{type:'object',properties:{}}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&await chatHistory.has(mn[1].split('--')[0]).catch(()=>false))out.body.result.tools.push({name:'past_chats',description:'Search the past customer chats of YOUR OWN Kirimdev line (your brand only; read only) for how our team answered something before: product facts (cartridges per vial, how long a vial lasts), payment links, shipping, objections. Use it BEFORE you ask the team anything. Give a few words in the customer\'s language and English, e.g. "cartridge vial". Returns matching messages with the chat around them, newest first.',inputSchema:{type:'object',properties:{query:{type:'string',description:'A few words that must all appear, e.g. cartridge vial; "quoted phrase" for an exact phrase'},limit:{type:'integer',description:'How many matches (default 8, max 15)'}},required:['query']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'open_in_code',description:'When someone asks you to build something in code (a website, an app, a tool, a deck or a document made with code), do not build it in the chat: call this with their request and reply with the link it gives. The link opens aqeelOS Code with the request filled in and you attached; they press send there.',inputSchema:{type:'object',properties:{request:{type:'string',description:'What to build, in their words, with the details they gave'}},required:['request']}});
   // always listed (the engine may keep the list it read first); it answers only during a Code run with other agents attached
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'code_ask_agent',description:'Only in an aqeelOS Code run: ask one of the other agents attached to it (named in the run\'s note) to fetch or do something with its own access, and get its answer. Files it returns are saved in the project (from-agents/<agent>/, or save_to). You may ask several agents at once.',inputSchema:{type:'object',properties:{agent:{type:'string',description:'The attached agent id'},task:{type:'string',description:'What it should do or find, and exactly what to send back'},save_to:{type:'string',description:'Optional folder in the project for its files, e.g. assets/images'}},required:['agent','task']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools)&&code.computerOf([users.agentOwner(mn[1].split('--')[0])||'owner']))out.body.result.tools.push({name:'computer_browser',description:'Browse in the guarded browser of aqeelOS Code on the person\'s own computer (no extension needed; the person sees it live in Code › Browser and can take over). It only opens their computer\'s own pages and the sites they allowed there; anything else is refused with the list, and a robot check is handed to them. Actions: open (url), snapshot (the page and its numbered elements), click (ref from snapshot), type (ref, text, submit), press (key), read (the page text), back.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['open','snapshot','click','type','press','read','back']},url:{type:'string'},ref:{type:'string'},text:{type:'string'},key:{type:'string'},submit:{type:'boolean'}},required:['action']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))out.body.result.tools.push({name:'name_thing',description:'Give one of your own things a plain name and a one-line description people will remember: a skill you have, a key in your settings (say which account or user it belongs to) or an app in your setup. Use it whenever you make one, and when aqeelOS asks you to.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['skill','key','mcp']},id:{type:'string',description:'The skill name, the key name (or NAME@code from the Keys list), or the app name'},name:{type:'string',description:'Plain name, e.g. "GitHub: acme-dev (repo access)"'},description:{type:'string',description:'One line on what it is for; for a key, which account or user'}},required:['kind','id','name','description']}});
   if(signed&&msg.method==='tools/list'&&Array.isArray(out.body?.result?.tools))addNameFields(out.body.result.tools);
   if(out.body==null){res.writeHead(out.status);return res.end()}return send(res,out.status,out.body)}
  // private Live apps: Traefik asks here before each request (forwardAuth); /live-login sends a signed-in person back with a pass
  if(p==='/live-auth')return live.auth(req,res,id=>users.user(id)).catch(()=>{if(!res.headersSent){res.writeHead(503);res.end()}});
  if(p==='/live-login'&&req.method==='GET')return live.login(req,res,await me(req)).catch(()=>{if(!res.headersSent)send(res,500,'Try again.')});
  // Incoming webhooks (GitHub, Stripe…) reach Hermes' webhook listener here. No sign-in: each
  // subscription checks its own secret signature, and nothing but POST /webhooks/<name> passes.
  if(/^\/webhooks\/[\w.-]{1,64}$/.test(p)&&req.method==='POST')return proxy(req,res,HOOKS,'',{});
  {const wm=/^\/webhooks\/([a-z0-9][a-z0-9_-]{0,63})\/([\w.-]{1,64})$/.exec(p);if(wm&&req.method==='POST'){req.url='/p/'+wm[1]+'/webhooks/'+wm[2]+url.search;
   // an agent's own webhook for a provider that signs its own way (create_my_webhook): its signature is checked with the
   // agent's saved key and the call is signed again for the engine; any other route passes untouched
   let raw;try{raw=await readRaw(req,1e6)}catch{return send(res,413,{error:'too large'})}
   const g=await versions.hookGate(wm[1],wm[2],req.headers,raw).catch(e=>({pass:false,status:500,error:e.message}));if(!g.pass)return send(res,g.status||401,{error:g.error||'refused'});
   if(g.headers){for(const h of ['x-webhook-signature','x-hub-signature-256','x-gitlab-token','linear-signature','webhook-signature','svix-signature','x-kirim-signature'])delete req.headers[h];Object.assign(req.headers,g.headers)}
   return proxy(req,res,HOOKS,'',{},{body:raw})}}
  // WhatsApp Business (Meta's Cloud API) calls here: GET is Meta's address check, POST the messages. No sign-in:
  // the engine checks Meta's signature with the app secret. The main agent's listener serves every agent (/p/<agent>/…).
  {const cm=/^\/whatsapp-cloud(?:\/([a-z0-9][a-z0-9_-]{0,63}))?$/.exec(p);if(cm&&(req.method==='GET'||req.method==='POST')){req.url=(cm[1]&&cm[1]!=='default'?'/p/'+cm[1]:'')+'/whatsapp/webhook'+url.search;return proxy(req,res,WA_CLOUD,'',{})}}
  // one-time secret links (no sign-in: the token after # is the credential)
  // Kirimdev posts customer messages here, signed; nothing else is taken (kirimdev.mjs)
  {const km=/^\/kirimdev\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(km){if(req.method!=='POST')return send(res,405,{error:'POST only'});let raw;
   if(+req.headers['content-length']>1024*1024)return send(res,413,{error:'Too large'});try{raw=await readRaw(req,1024*1024)}catch{return send(res,413,{error:'Too large'})}
   try{const r=await kirimdev.receive(km[1],req.headers,raw);return send(res,r.status,r.body)}catch(e){console.warn('kirimdev receive',e.message);return send(res,500,{error:'Try again'})}}}
  // a press on an issue's Telegram button, posted by the gateway plugin aqeelos-issue-buttons (this box only, with the key)
  // the engine plugin aqeelos-live (this box only, with the key in HERMES_HOME/secrets/agent-live.key): a turn's context, a held error
  // the customer-run tool server (local only; a run's own key in X-Aqeelos-Run)
  {const cm=/^\/mcp\/customer\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(cm){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');
   if(req.method!=='POST')return send(res,405,'POST only');let msg={};try{msg=JSON.parse(await readBody(req,262144))}catch{return send(res,400,{error:'bad json'})}
   {const w=msg.method==='tools/call'&&smokeWatch.get(String(msg.params?.arguments?.run||''));if(w)w.push({name:String(msg.params?.name||''),path:String(msg.params?.arguments?.path||'')})}
   const r=await customerTools.mcp(cm[1],String(req.headers['x-aqeelos-run']||''),msg);return r.status===202?send(res,202,''):send(res,r.status,r.body)}}
  if(p==='/agent-live/context'||p==='/agent-live/held'){if(req.method!=='POST')return send(res,405,{error:'POST only'});let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
   if(!await agentLive.keyOk(b.key))return send(res,403,{error:'bad key'});const ag=String(b.agent||'');if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(ag)||!(await agentLive.homes()).includes(ag))return send(res,404,{error:'no such agent'});
   if(p==='/agent-live/held')return send(res,200,{ok:true,...await agentLive.hold(ag,{error:String(b.error||'').slice(0,8000),platform:String(b.platform||'').slice(0,40),session:String(b.session||'').slice(0,120)})});
   try{const ch=b.chat&&typeof b.chat==='object'?Object.fromEntries(['chat_id','thread_id','chat_type','chat_name'].map(k=>[k,String(b.chat[k]||'').slice(0,200)])):{};return send(res,200,await agentLive.context(ag,{platform:String(b.platform||''),sender:String(b.sender||''),first:!!b.first,seen:String(b.seen||''),chat:ch}))}catch(e){console.warn('agent-live context',ag,e.message);return send(res,200,{text:''})}}
  if(p==='/issue-press'){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra)||req.method!=='POST')return send(res,403,{error:'local only'});
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=await pressKey();
   if(typeof b.key!=='string'||b.key.length!==k.length||!timingSafeEqual(Buffer.from(b.key),Buffer.from(k)))return send(res,403,{error:'bad key'});
   const r=await issues.press(b.data,String(b.from||''));console.log('issue button',String(b.data||'').slice(0,15),'from',b.from,'→',r.toast);return send(res,200,r)}
  // an old Approve / Decline link (issues.mjs before 7 Nov 2026): it only shows where the issue is now
  {const im=/^\/issue\/(i[0-9a-f]{8})\/([\w-]{10,40})$/.exec(p);if(im){const H={'cache-control':'no-store','x-robots-tag':'noindex'};
   const page=(body)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...H});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>aqeelOS issue</title><body style="font:16px/1.5 system-ui;max-width:560px;margin:40px auto;padding:0 18px">'+body+'</body>')};
   const e=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
   const l=(await issues.list()).items.find(x=>x.id===im[1]);if(!l)return page('<h2>Link not valid</h2>');
   return page('<h2>'+e(l.agentName)+': '+e(l.missing)+'</h2><p>Nothing to approve any more: the fixer handles every issue by itself and proves the fix (7 Nov 2026).</p><p>State: '+e(l.state)+'</p>')}}
  if(p==='/secret'||p.startsWith('/secret/'))return await secretRoute(req,res,p);
  // MCP sign-in (OAuth) returns here from Slack, Notion…; the engine checks the one-time state. No sign-in needed.
  // Google sign-ins (Google Workspace skill with a Web-application client) return here, and aqeelOS finishes them:
  // it finds the agent and account whose pending sign-in has this state and runs the skill's --auth-code step.
  if(p==='/google-oauth/callback'&&req.method==='GET'){const st=url.searchParams.get('state')||'';
   const page=(t,m)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${t}</h2><p>${m}</p></body>`)};
   // a sign-in started in the app (Connect Google): finished here, nothing for an agent to do
   if(await gconnect.has(st)){try{const r=await gconnect.finish(url.search);googleConnected(r);return page('Google account connected',(r.email?'<b>'+esc(r.email)+'</b> is':'Your Google account is')+' connected to '+esc(NAMES[r.agent]||r.agent)+'. You can close this tab and go back to aqeelOS.')}catch(e){return page('Not connected',esc(e.message))}}
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
   let who=users.byId(dev.user);if(!who)return send(res,401,{error:'The person this computer was paired for no longer exists.'});
   // the box's own Code copy is paired as the owner but used by everyone on Code online: listing and asking agents and
   // publishing, models and engine runs act only as a person aqeelOS signed for (x-aq-act: <uid>.<exp>.<sig>, a few
   // minutes), never as the owner. The box's copy is known by the flag aqeelOS set when it paired it, not by its name.
   const BOX=dev.user==='owner'&&dev.box===true;
   if(BOX&&/^\/ui\/code\/(ask|publish|agents|agent-model|run-ticket|engine\/(run|stop|approval))$/.test(p)){const [uid,exp,sg]=String(req.headers['x-aq-act']||'').split('.');
    const ok=!!uid&&Number(exp)>Date.now()&&Number(exp)<Date.now()+600e3&&!!sg&&(()=>{const x=Buffer.from(sg),y=Buffer.from(sign('code-act:'+uid+'.'+exp));return x.length===y.length&&timingSafeEqual(x,y)})();
    who=ok?users.byId(uid):null;if(!who)return send(res,403,{error:'Online Code can do this only for a signed-in person. Use Code on your own computer for now.'})}
   /* Team folders (Plan 4, 25 Oct 2026): a person's own Code shares a project folder, pushes and pulls, as the person the
      device key is for. git's smart HTTP is at /ui/code/team/git/<id>.git/...; the rest are small JSON calls. The box's own
      copy is used by everyone, so it has no team folders: they live on each person's computer. */
   if(p.startsWith('/ui/code/team')){if(BOX)return send(res,403,{error:'Team folders work in Code on your own computer.'});
    if(p.startsWith('/ui/code/team/git/'))return teamFolders.serve(req,res,who.id,p.slice(18),url.searchParams);
    let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{}}const q=url.searchParams;
    try{if(p==='/ui/code/team'&&req.method==='GET')return send(res,200,{me:who.id,folders:await teamFolders.list(who.id)});
     if(p==='/ui/code/team/folder'&&req.method==='GET')return send(res,200,await teamFolders.get(String(q.get('id')||''),who.id));
     if(p==='/ui/code/team/history'&&req.method==='GET')return send(res,200,{pushes:await teamFolders.history(String(q.get('id')||''),who.id)});
     if(p==='/ui/code/team/share'&&req.method==='POST'){const f=await teamFolders.create(who.id,{name:b.name,members:b.members,chats:b.chats});console.log('team folders: '+(who.name||who.id)+' shared',f.id);return send(res,200,f)}
     if(p==='/ui/code/team/update'&&req.method==='POST')return send(res,200,await teamFolders.update(String(b.id||''),who.id,{name:b.name,members:b.members,chats:b.chats}));
     if(p==='/ui/code/team/unshare'&&req.method==='POST')return send(res,200,await teamFolders.unshare(String(b.id||''),who.id))}catch(e){return send(res,e.status||400,{error:e.message})}
    return send(res,404,{error:'Not found'})}
   const mine=a=>!users.gate(who,'/gapi/api/model/options','GET',new URLSearchParams(),a);   // the agents this person may chat with (shared, owned, not someone's private one)
   if(p==='/ui/code/whoami')return send(res,200,{name:who.name||who.id,user:who.id,liveDomain:hostSetting('liveDomain')});
   // the agents this person may use in Code; intro=1 adds each one's introduction for a run (what it is for, its skills by
   // name, and for an agent they own a short digest of its work notes), for the ids asked (ids=a,b) only
   if(p==='/ui/code/agents'){const intro=url.searchParams.get('intro')==='1',want=intro?new Set(String(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,8)):null;const out=[];
    for(const a of await listAgents()){if(!mine(a)||await isTestAgent(a)||want&&!want.has(a))continue;const c=await readConfig(a).catch(()=>null)||{};
     out.push({id:a,name:NAMES[a]||await displayName(a),apps:Object.keys(c.mcp_servers||{}).filter(n=>n!=='aqeelos-notify'),google:(await googleContext(a).catch(()=>[])).length,...(intro?await codeAgents.intro(a,{memory:users.level(who,a)==='owner'}):{})})}return send(res,200,{agents:out})}
   // a run's ticket: the agents attached to one Code message, each one this person may chat with; aqeelos_ask may then
   // ask only those (checked here again on every ask)
   if(p==='/ui/code/run-ticket'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const all=await listAgents();
    const list=[...new Set((Array.isArray(b.agents)?b.agents:[]).map(String))].slice(0,6);for(const a of list)if(!all.includes(a)||!mine(a)||await isTestAgent(a))return send(res,403,{error:'You can’t use one of those agents.'});
    return send(res,200,{ticket:codeAgents.ticket(who.id,list,b.project),agents:await Promise.all(list.map(async a=>({id:a,name:NAMES[a]||await displayName(a)})))})}
   // one ask from a run: only an agent attached to it (the ticket), that this person may still chat with; files come
   // back with the answer (Code saves them in the project; nothing is written on the person's computer from here)
   if(p==='/ui/code/ask'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}const a=String(b.agent||'');const t=codeAgents.ticketAgents(b.ticket,who.id);
    if(!t||!t.agents.includes(a))return send(res,403,{error:'Only the agents attached to this message in Code can be asked'+(t?.agents.length?' ('+t.agents.join(', ')+')':'')+'.'});
    if(!(await listAgents()).includes(a)||!mine(a))return send(res,403,{error:'You can’t ask that agent.'});const task=String(b.task||'').slice(0,20000);if(!task)return send(res,400,{error:'Say what the agent should do.'});
    try{const r=await codeAsk(who,a,task,{project:b.project,plan:!!b.plan});console.log('code: '+(who.name||who.id)+' asked',a,'from aqeelOS Code'+(r.files.length?' ('+r.files.length+' files)':''));
     return send(res,200,{agent:a,agentName:r.agentName,text:r.text,files:b.plan?r.files.map(f=>({name:f.name,size:f.data.length})):r.files.map(f=>({name:f.name,size:f.data.length,data:f.data.toString('base64')}))})}catch(e){return send(res,e.status||502,{error:e.message})}}
   // Code's models and account for one agent: the models the chat's menu lists for that agent (a member: only the ones
   // they may use) and the account it is on (Models page), asked again for every run, so a switch counts at once. Only
   // the box's own copy, on this machine, gets the Claude account's folder; a person's computer keeps its own
   // sign-in and is never sent an account path or secret. No agent: the models of the agent this person would chat with.
   if(p==='/ui/code/agent-model'&&req.method==='GET'){const box=BOX;const may=(await listAgents()).filter(mine),want=String(url.searchParams.get('agent')||'');
    if(want&&!may.includes(want))return send(res,403,{error:'You can’t use that agent.'});const a=want||(may.includes('default')?'default':may[0]||'');
    const r=want?await accountsApi.codeRoute(want).catch(()=>null):null;let models=null,engineModels=null;
    try{const o=await fetch(GATE.origin+(a&&a!=='default'?'/p/'+encodeURIComponent(a):'')+'/api/model/options',{headers:{authorization:'Bearer '+API_KEY},signal:AbortSignal.timeout(20000)}).then(x=>x.ok?x.json():null);
     // every model the chat's menu has (any provider): Code's one model list, for a person's computer too (25 Oct 2026);
     // Code runs Claude models on Claude Code, ChatGPT models on Codex and the rest on the engine (the box's copy only)
     if(o)engineModels=(o.providers||[]).filter(pv=>pv.authenticated&&(pv.models||[]).length&&!/nous/i.test((pv.slug||'')+' '+(pv.name||''))).map(pv=>({provider:pv.slug,name:codeProvName(pv),models:(pv.models||[]).filter(m=>typeof m==='string'&&users.modelOk(who,pv.slug,m))})).filter(x=>x.models.length);
     if(o){models={claude:[],codex:[],gemini:[]};for(const pv of o.providers||[]){if(!pv.authenticated)continue;const k=pv.slug==='claude-subscription-directsdk-experimental'?'claude':pv.slug==='openai-codex'?'codex':/^gemini/.test(pv.slug)?'gemini':'';if(!k)continue;
      for(const m of pv.models||[])if(typeof m==='string'&&users.modelOk(who,pv.slug,m)&&!models[k].includes(m))models[k].push(m)}}}catch{}
    // engine: every model (and Default with the priority list) runs on the engine; a computer's projects through the code bridge
    return send(res,200,{agent:want,where:box?'box':'computer',restricted:!!users.allowedModels(who),models,engineModels,agentDefault:a?await agentModel(a):null,engine:box?!codeOnline.remote():true,...(r?{provider:r.provider,model:r.model,account:{label:r.account.label,kind:r.account.kind},...(box&&r.provider==='claude'?{main:r.main,configDir:r.configDir}:{})}:{})})}
   /* Code's "aqeelOS models" engine (the box's own Code copy; a computer's below): one turn for an agent, run by the engine exactly
      like a chat message (the agent's own model and account, the Models page's priority list and auto-switch, any
      provider, its tools and their locks), in the project's folder on the box. The chat's rules apply to the person
      who sent it (x-aq-act): the agents they may use, their models, their daily limit. The engine's events stream
      back as they come (also to /ui/live, so the chat page can follow the same turn); stop and approvals go by the
      handle sent first, so they keep working after the person's short note has run out. */
   /* A person's computer (25 Oct 2026): the same turn, for a project in a folder there. The engine's chat starts in an
      empty folder of the agent's own here and reaches the project only through the code bridge (app/code-bridge.mjs):
      this turn is bound to that computer's run (b.bridge) while it goes on, and nothing of the project is on the box. */
   if(p.startsWith('/ui/code/engine/')){const box=BOX,far=!BOX;
    if(p==='/ui/code/engine/run'&&req.method==='POST'){if(box&&codeOnline.remote())return send(res,409,{error:'Online Code runs in its own container here, so agents cannot reach its folders. Use Claude Code, Codex or Gemini CLI.'});
     let b={};try{b=JSON.parse(await readBody(req,40e6))}catch{return send(res,400,{error:'The request was not valid JSON.'})}
     // no agent picked in Code: the one this person would chat with (as agent-model answers)
     const may=(await listAgents()).filter(mine),a=String(b.agent||'')||(may.includes('default')?'default':may[0]||'');if(!may.includes(a)||await isTestAgent(a))return send(res,403,{error:'You can’t use that agent.'});
     const name=NAMES[a]||await displayName(a);if(await agentDefaults.codeLocked(a))return send(res,403,{error:name+'’s terminal and file tools are locked, so it cannot work on code. Pick a Claude or ChatGPT model, or ask an admin.'});
     // the other agents attached to this message: the engine may ask them (code_ask_agent) while the turn goes on
     const attached=[a,...new Set((Array.isArray(b.agents)?b.agents:[]).map(String).filter(x=>x!==a))].slice(0,6);for(const x of attached.slice(1))if(!may.includes(x)||await isTestAgent(x))return send(res,403,{error:'You can’t use one of the attached agents.'});
     // a member: within their daily limit (Chat and Code together) and only on models they may use, as in Chat
     let provider=String(b.provider||''),model=String(b.model||'');if(!/^[\w.:/@+-]{0,120}$/.test(provider+model))return send(res,400,{error:'Invalid model name.'});
     if(!users.isAdmin(who)){const lim=users.limitOf(who);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),who.id,users.ownerOf);if(t.tokens+await code.usedToday(who.id)>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'})}
      const allowed=users.allowedModels(who);if(allowed){const d=await agentModel(a),isDef=!model||model===d.model&&(!provider||provider===d.provider);
       if(!isDef){if(!users.modelOk(who,provider,model))return send(res,403,{error:'You can\'t use that model. Ask the owner.'})}
       else if(!users.modelOk(who,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');if(m.length){provider=pv;model=m.join('|')}else{model=pv;provider=''}}}}
     // the project folder: one of online Code's own (~/code-projects/<name>), as it really is (no link out of it)
     const AREA=path.join(homedir(),'code-projects');let dir='';const bridgeId=String(b.bridge||''),project=String(b.projectName||'').replace(/[\u0000-\u001f]/g,'').slice(0,80)||'project';
     if(far){if(!/^[0-9a-f]{24}$/.test(bridgeId))return send(res,400,{error:'Update aqeelOS Code on this computer to run this model.'});try{dir=await codeBridge.room(a,who.id,project)}catch(e){return send(res,500,{error:'Could not make the agent’s folder for this run: '+e.message})}}
     else{try{dir=await realpath(String(b.path||''))}catch{}
     // a folder right inside it: the agent is let through that one folder only
     if(!dir.startsWith(AREA+path.sep)||dir.slice(AREA.length+1).includes(path.sep)||!(await stat(dir).catch(()=>null))?.isDirectory())return send(res,400,{error:'Only projects right inside online Code’s project folder (~/code-projects) can run on aqeelOS models.'})}
     const pre=a!=='default'?'/p/'+encodeURIComponent(a):'',H={authorization:'Bearer '+API_KEY,'content-type':'application/json'};
     // Plan only: the turn works in a read-only copy of the project in a chat of its own (codeAgents.planCopy), so it can
     // only read and propose; the copy goes when the turn ends
     const real=dir;let planDir='';if(b.plan&&!far){try{planDir=await codeAgents.planCopy(dir,AREA)}catch(e){return send(res,413,{error:e.message})}dir=planDir}
     // the same engine chat again for the same Code chat (only the person's own), else a new one that is theirs
     let sid=planDir?'':String(b.session||'');if(sid&&(!/^[\w.:-]{1,128}$/.test(sid)||users.ownerOf(sid)!==who.id))sid='';
     if(!sid){try{const d=await fetch(GATE.origin+pre+'/api/sessions',{method:'POST',headers:H,body:JSON.stringify({cwd:dir}),signal:AbortSignal.timeout(30000)}).then(async x=>x.ok?x.json():Promise.reject(Error((await x.text()).slice(0,200)||'HTTP '+x.status)));
       sid=String(d.session?.id||d.id||d.session_id||'');if(!sid)throw Error('no chat id');await users.own(sid,who)}catch(e){void codeAgents.planDrop(planDir);return send(res,502,{error:'The engine could not start a chat for '+name+': '+e.message})}}
     let text=String(b.prompt||'').slice(0,400000);if(!text.trim()){void codeAgents.planDrop(planDir);return send(res,400,{error:'Say what to do.'})}
     if(far&&b.plan)text='PLAN ONLY: change nothing; read with the project tools, then propose.\n\n'+text;
     if(planDir)text='PLAN ONLY: you are in a read-only copy of the project. Change nothing; read, then propose.\n\n'+text.split(String(b.path)).join(planDir).split(real).join(planDir);
     const imgs=(Array.isArray(b.images)?b.images:[]).slice(0,6).map(String).filter(u=>/^data:image\/(png|jpeg|webp|gif);base64,/.test(u));
     const msg={message:imgs.length?[{type:'text',text},...imgs.map(u=>({type:'image_url',image_url:{url:u}}))]:text};
     // a model picked in Code is locked for this turn on its own account; "Default" leaves the agent's own choice (and auto-switch) in charge
     if(model){msg.model=model;if(provider)msg.provider=provider;msg.require_model_lock=true}
     if(/^(none|minimal|low|medium|high|xhigh|max|ultra)$/.test(String(b.effort||'')))msg.model_options={reasoning_effort:b.effort};
     // the agent's own user is let into the folder for this turn only (taken away again when it ends, also when it does not start)
     let unrun=()=>{};if(!far)try{await agentDefaults.codeAccess(a,dir,AREA,{read:!!planDir})}catch(e){void codeAgents.planDrop(planDir);return send(res,409,{error:e.message})}
     // a computer's turn is bound to its run until it ends, also when it does not start (unbound at once then)
     const bound=far?codeBridge.bind({agent:a,user:who.id,dev:dev.key,devName:dev.name,project,mode:b.plan?'plan':'run',bridge:bridgeId}):'';
     const after=async()=>{unrun();if(bound)codeBridge.unbind(bound);if(!far)await agentDefaults.codeAccessAfter(a,dir,AREA).catch(()=>{});await codeAgents.planDrop(planDir)};
     const up=await fetch(GATE.origin+pre+'/api/sessions/'+encodeURIComponent(sid)+'/chat/stream',{method:'POST',headers:{...H,accept:'text/event-stream'},body:JSON.stringify(msg),...longFetch()}).catch(e=>({ok:false,status:502,text:async()=>e.message}));
     if(!up.ok||!up.body){void after();const t=await up.text().catch(()=>'');let said=t;try{const j=JSON.parse(t);said=j.error?.message||j.error||j.detail||t}catch{}return send(res,up.status===429?429:502,{error:'The engine did not take the turn ('+up.status+')'+(said?': '+String(said).slice(0,200):'')})}
     const route=await accountsApi.codeRoute(a).catch(()=>null),handle=randomBytes(18).toString('base64url'),h={agent:a,pre,user:who.id,runId:'',stop:false};codeRuns.set(handle,h);
     // (a computer's project is not on the box: an ask's files are named in the answer, not saved, see code_ask_agent)
     unrun=codeAgents.runStart(a,{user:who.id,agents:attached,dir:far?'':real,plan:!!planDir||far&&!!b.plan,project:far?project:path.basename(real)});
     res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
     res.write('event: aqeelos.code\ndata: '+JSON.stringify({type:'aqeelos.code',handle,session:sid,plan:!!planDir,agent:a,agentName:name,provider:provider||route?.engine||'',model:model||route?.model||'',account:model&&provider&&route?.engine!==provider?'':route?.account?.label||''})+'\n\n');
     const key=a+'|'+sid,rec=liveStart(key,who.id);console.log('code: '+(who.name||who.id)+' ran',a,'on aqeelOS models'+(far?' for '+project+' on '+dev.name:''));
     // the turn goes on on the engine when Code goes away (like a chat reply): read to its end either way
     // a comment line every 20 s while the engine is quiet (a pending approval, a long command), so no reader times out
     const beat=setInterval(()=>{if(!res.writableEnded&&!res.destroyed)res.write(': keep-alive\n\n')},20000);beat.unref?.();
     // the events read whole (one may span network chunks): the run id from run.started, approvals by their type
     const dec=new TextDecoder();let pend='';const onEvent=raw=>{let ev='',data='';for(const line of raw.split(/\r?\n/)){if(line.startsWith('event:'))ev=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trimStart()}
      let d=null;try{d=JSON.parse(data)}catch{}const type=d?.type||ev;
      if(!rec.runId&&(type==='run.started'||d?.run_id)){const id=String(d?.run_id||d?.run?.id||d?.id||'');if(id&&/^[\w.:-]{1,200}$/.test(id)){rec.runId=h.runId=id;runOwner.set(id,{user:who.id,t:Date.now()});if(h.stop)fetch(GATE.origin+pre+'/v1/runs/'+encodeURIComponent(id)+'/stop',{method:'POST',headers:H}).catch(()=>{})}}
      if(type==='approval.request')rec.asking=true;else if(type==='approval.responded')rec.asking=false;if(bound&&/^tool\./.test(type))codeBridge.event(bound,type,d)};
     try{for await(const c of up.body){const buf=Buffer.from(c);rec.last=Date.now();rec.size+=buf.length;rec.chunks.push(buf);if(rec.size>8e6){rec.size-=rec.chunks.splice(40,Math.max(0,rec.chunks.length-200)).reduce((x,y)=>x+y.length,0)}
       pend+=dec.decode(buf,{stream:true});let i;while((i=pend.search(/\r?\n\r?\n/))>=0){const raw=pend.slice(0,i);pend=pend.slice(i).replace(/^\r?\n\r?\n/,'');onEvent(raw)}if(pend.length>4e6)pend='';
       if(!res.writableEnded&&!res.destroyed)res.write(buf);for(const sub of rec.subs)sub.write(buf)}}catch{}
     clearInterval(beat);liveEnd(key,rec);if(!res.writableEnded)res.end();setTimeout(()=>codeRuns.delete(handle),600e3).unref?.();
     await after();return}
    let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const h=codeRuns.get(String(b.handle||''));if(!h)return send(res,404,{error:'That run has already finished.'});
    if(h.user!==who.id)return send(res,403,{error:'Only the person who started this run can stop it or answer it.'});   // (who: the person on the note)
    const go=(what,body)=>fetch(GATE.origin+h.pre+'/v1/runs/'+encodeURIComponent(h.runId)+'/'+what,{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(20000)}).then(async r=>send(res,r.ok?200:502,r.ok?{ok:true}:{error:'The engine answered '+r.status+': '+(await r.text()).slice(0,200)}),e=>send(res,502,{error:e.message}));
    if(p==='/ui/code/engine/stop'&&req.method==='POST'){if(!h.runId){h.stop=true;return send(res,200,{ok:true,later:true})}return go('stop')}
    if(p==='/ui/code/engine/approval'&&req.method==='POST'){const choice=String(b.choice||'');if(!/^(once|session|always|deny)$/.test(choice)||!h.runId)return send(res,400,{error:'Nothing to answer.'});return go('approval',{choice,...(b.request_id?{request_id:String(b.request_id).slice(0,200)}:{})})}
    return send(res,404,{error:'Not found'})}
   if(p==='/ui/code/version')return send(res,200,{version:await code.version()});
   // Live: Code publishes a project as a zip (the body), as the person this computer is paired for
   // Live from Code: is an address free, and how is a publish going
   if(p==='/ui/code/live-name'&&req.method==='GET')return send(res,200,await live.nameCheck(who,url.searchParams.get('slug')||''));
   if(p==='/ui/code/live-status'&&req.method==='GET'){try{const a=await live.check(String(url.searchParams.get('id')||''));return send(res,200,{status:a.stopped?'offline':a.status,error:a.error||'',url:live.urlOf(a.slug)})}catch(e){return send(res,404,{error:e.message})}}
   if(p==='/ui/code/publish'&&req.method==='POST'){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>90e6)return send(res,413,{error:'The project is over 90 MB. Leave big files (videos, data) out of it.'});chunks.push(c)}
    const q=url.searchParams;try{const a=await live.publish(who,{name:q.get('name'),slug:q.get('slug'),repo:q.get('repo'),database:q.get('db')==='1',visibility:q.get('visibility')||undefined,zip:Buffer.concat(chunks)});console.log('live: '+(who.name||who.id)+' published',a.slug);return send(res,200,a)}catch(e){return send(res,400,{error:e.message})}}
   // the people an online project can be shared with (names only)
   if(p==='/ui/code/people'&&req.method==='GET')return send(res,200,{people:users.people().filter(x=>x&&x.id&&!x.disabled).map(x=>({id:x.id,name:x.name||x.username||'Someone',username:x.username||''}))});
   if(p==='/ui/code/report'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.report(dev,b);return send(res,200,{ok:true})}
   if(p==='/ui/code/run-usage'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.addRun(dev,b);return send(res,200,{ok:true})}
   if(p==='/ui/code/update'){const u=await code.update();res.writeHead(200,{'content-type':'application/zip','content-length':u.zip.length,'x-code-version':u.version,'cache-control':'no-store'});return res.end(u.zip)}
   // the long-poll for browser jobs (computer_browser); the box's copy has no browser jobs to run for a person
   if(p==='/ui/code/poll'&&req.method==='POST'){await readBody(req,262144).catch(()=>'');let gone=false;res.once('close',()=>{gone=true});const job=await code.poll(dev);if(gone||res.destroyed){code.requeue(dev,job);return}return send(res,200,{job})}
   if(p==='/ui/code/bridge-done'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4e6))}catch{}return send(res,200,{ok:codeBridge.done(dev,b)})}
   if(p==='/ui/code/done'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,262144))}catch{}return send(res,200,{ok:code.done(dev,b.id,{state:String(b.state||''),text:String(b.text||'').slice(0,20000),files:(b.files||[]).slice(0,200).map(String),chat:String(b.chat||'')})})}
   return send(res,404,{error:'Not found'})}
  if(p==='/ui/brand'&&req.method==='GET')return send(res,200,{...await brand.get(),owner:legalOwner()});
  if(p==='/ui/brand/logo'&&req.method==='GET'){const l=await brand.logo();if(!l){res.writeHead(302,{location:env.BRAND_LOGO_FALLBACK||'/assets/aqeelos-mark.svg'});return res.end()}res.writeHead(200,{'content-type':l.type,'cache-control':'public, max-age=86400','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'",'x-content-type-options':'nosniff'});return res.end(l.data)}
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
   if(/^\/ui\/screens\/[^/]+\/adspower(\/(start|stop))?$/.test(p))return agentAds.handle(req,res,p,send,{admin:users.isAdmin(u)});
   return p==='/ui/screen/browser'?openBrowser(res,url.searchParams.get('agent')):screens.handle(req,res,p,send)}
  if(p==='/ui/adspower'){const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'});return agentAds.handle(req,res,p,send,{admin:users.isAdmin(u)})}
  if(p.startsWith('/auth/')&&await accountAuth(req,res,p,url))return;
  if(p==='/auth/login'&&req.method==='POST'){
   const ip=clientIp(req);if(limited(ip))return send(res,429,{error:'Too many attempts. Try again in a few minutes.'});
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
   const u=await users.login(b.name,b.password||'',pw=>!!PW_HASH&&checkPassword(pw));
   if(!u){(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now());const nm=String(b.name||'').trim();return send(res,401,{error:!nm?'Enter your email.':!nm.includes('@')&&users.emailOnly()?'Sign in with your email address.':'That email and password do not match.'})}
   const note=users.loginNote(u,b.name);
   attempts.delete(ip);
   // two-step: the password was right; now a code goes to their confirmed email
   if(u.twoStep&&u.emailVerified){try{return send(res,200,{needCode:true,key:await users.loginCode(u),to:u.email.replace(/^(.).*(@.*)$/,'$1•••$2'),note})}catch(e){return send(res,502,{error:'Your sign-in code could not be sent: '+e.message})}}
   return send(res,200,{ok:true,note},{'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)});
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
   // the live app needs their email (they sign in with it); a test copy's checks may leave it out
   if(LIVE_APP&&!String(b.email||'').trim())return send(res,400,{error:'Enter your email address. You sign in with it.'});
   try{const u=await users.accept(String(b.code||''),b.name,b.password,b.username,b.email);return send(res,200,{ok:true,name:u.name},{'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}
   catch(e){(attempts.get(ip)||attempts.set(ip,[]).get(ip)).push(Date.now());return send(res,400,{error:e.message})}}
  if(p.startsWith('/ui/')){
   const u=await me(req);if(!u)return send(res,401,{error:'Sign in first.'},{'x-hui-auth':'required'});
   if(req.method!=='GET'&&req.headers['x-hui']!=='1')return send(res,403,{error:'Missing request header.'});
   if(p.startsWith('/ui/plugin-'))return plugins.handle(req,res,u,url);
   if(p.startsWith('/ui/help/'))return help.handle(req,res,u,url);
   if((p==='/ui/install'||p.startsWith('/ui/install/'))&&await install.handle(req,res,u,url))return;
   // the real-life test after each deploy (scripts/live-test.mjs) and any automatic undo (box-live.sh), for System › Health
   if(p==='/ui/live-test'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});try{return send(res,200,JSON.parse(await readFile(path.join(DATA,'live-test.json'),'utf8')))}catch{return send(res,200,{runs:[]})}}
   // Edit agent › Abilities: AdsPower and Composio per agent (admins change them; the agent's editors may read them)
   if(p==='/ui/optins'&&req.method==='GET'){const a=String(url.searchParams.get('agent')||'default');if(!users.isAdmin(u)&&!users.atLeast(u,a,'edit'))return send(res,403,{error:'Not your agent.'});return send(res,200,{agent:a,admin:users.isAdmin(u),abilities:await optins.state(a),apps:await optins.appsState(a,await knownApps(a))})}
   if(p==='/ui/optins'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change this.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const a=String(b.agent||'').split('--')[0],k=String(b.kind||''),v=!!b.on;if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a)||!await isAgent(a))return send(res,400,{error:'Unknown agent'});
    try{if(k==='app')await optins.setApp(a,String(b.name||''),v);else await optins.set(k,a,v)}catch(e){return send(res,400,{error:e.message})}
    // applied now: AdsPower starts (or stops and loses its tool); Composio is added (or removed)
    if(k==='adspower')(v?agentAds.tick().then(()=>agentAds.tools()):agentAds.retire(a)).catch(e=>console.warn('abilities',e.message));
    if(k==='composio'||k==='app')(v?connectors.ensureAll():composioOff(a).then(()=>closeSolvedSignins())).catch(e=>console.warn('abilities',e.message));
    return send(res,200,{ok:true,abilities:await optins.state(a),apps:await optins.appsState(a,await knownApps(a))})}
   // a new password signs out every other browser and phone; this one gets a fresh sign-in
   if(p==='/ui/me/password'&&req.method==='PUT')return users.api(u,req,res,p,async(r,code,data,h)=>{if(code===200){await revokeSessions(u.id);return send(r,code,data,{...(h||{}),'set-cookie':'hui='+makeCookie(u.id)+'; '+cookieAttrs(SESSION_DAYS*86400)})}return send(r,code,data,h)},readBody);
   // System › Branding (admins): the name, logo and contact of this install
   if(p.startsWith('/ui/brand')&&req.method!=='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins change the branding.'});
    try{let r;if(p==='/ui/brand'&&(req.method==='POST'||req.method==='PUT')){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}if('name' in b)r=await brand.setName(b.name);if('contact' in b)r=await brand.setContact(b.contact);r||=await brand.get()}
     else if(p==='/ui/brand/logo'&&req.method==='POST')r=await brand.setLogo(await readRaw(req,600*1024),String(req.headers['content-type']||''));
     else if(p==='/ui/brand/logo'&&req.method==='DELETE')r=await brand.clearLogo();else return send(res,404,{error:'Not found'});
     console.log('branding changed by',u.name||u.id,'→',r.name);return send(res,200,r)}catch(e){return send(res,400,{error:e.message})}}
   {const lm=/^\/ui\/people\/([\w-]+)\/lead$/.exec(p);if(lm&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const x=users.byId(lm[1]);if(!x||x.id==='owner')return send(res,404,{error:'Unknown person'});try{return send(res,200,{ok:true,lead:await makeLead(x)})}catch(e){return send(res,502,{error:'The lead agent could not be made: '+e.message})}}}
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
    for(const f of await readdir(trash).catch(()=>[])){
     // a restored agent's backup is kept aside (.restored) for the same 30 days, out of this list
     if(f.endsWith('.tgz.restored')){const st=await stat(path.join(trash,f)).catch(()=>null);if(st&&Date.now()-st.mtimeMs>30*864e5)await unlink(path.join(trash,f)).catch(()=>{});continue}
     const m=/^(.+)__(.+)\.tgz$/.exec(f);if(!m)continue;const st=await stat(path.join(trash,f)).catch(()=>null);if(!st)continue;
     if(Date.now()-st.mtimeMs>30*864e5){await unlink(path.join(trash,f)).catch(()=>{});continue}out.push({file:f,agent:m[1],deleted:st.mtimeMs,size:st.size})}
    return send(res,200,{items:out.sort((a,b)=>b.deleted-a.deleted)})}
   if(p==='/ui/agent-trash/purge'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');if(!/^[\w.-]+__[\w.-]+\.tgz$/.test(f)||f.includes('..'))return send(res,400,{error:'Unknown backup'});await unlink(path.join(DATA,'agent-trash',f)).catch(()=>{});console.log('deleted the kept backup',f);return send(res,200,{ok:true})}
   if(p==='/ui/agent-restore'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const f=String(b.file||'');const m=/^([a-z0-9][a-z0-9_-]{0,63})__[\w-]+\.tgz$/.exec(f);if(!m)return send(res,400,{error:'Unknown backup.'});
    const dir=path.join(HERMES_HOME,'profiles',m[1]);if(await stat(dir).catch(()=>null))return send(res,409,{error:'An agent with that name exists already.'});
    await mkdir(dir,{recursive:true});const {execFile}=await import('node:child_process');
    // a failed unpack leaves no half agent folder behind
    const ok=await new Promise(r=>execFile('tar',['-xzf',path.join(DATA,'agent-trash',f),'-C',dir],{timeout:180000},e=>r(!e)));if(!ok){await (await import('node:fs/promises')).rm(dir,{recursive:true,force:true}).catch(()=>{});return send(res,500,{error:'Could not unpack the backup.'})}
    // its extra numbers came back inside it: move each to its own folder and list it again (one that exists already stays as it is)
    const cl=path.join(dir,'.aqeel-copies.json');let copies=[];try{copies=JSON.parse(await readFile(cl,'utf8'))}catch{}
    for(const c of Array.isArray(copies)?copies:[]){const cn=String(c?.name||'');if(!cn.startsWith(m[1]+'--')||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cn))continue;const src=path.join(dir,cn),dst=path.join(HERMES_HOME,'profiles',cn);
     if(!await stat(src).catch(()=>null))continue;if(await stat(dst).catch(()=>null)){console.warn('restore: copy exists already',cn);continue}
     try{await rename(src,dst);await links.adopt(cn,{...c,agent:m[1]})}catch(e){console.warn('restore copy',cn,e.message)}}
    await unlink(cl).catch(()=>{});
    await users.restoreAgent(m[1]).catch(()=>{});await rename(path.join(DATA,'agent-trash',f),path.join(DATA,'agent-trash',f+'.restored')).catch(()=>{});restartGateway('restored '+m[1]).then(()=>agentHealth(m[1])).catch(()=>{});
    return send(res,200,{ok:true,agent:m[1]})}
   // plugins on/off for ONE agent (the engine's own plugin routes always change the main agent)
   if(p==='/ui/plugins/toggle'&&req.method==='POST'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can turn plugins on or off.'});
   if(p==='/ui/plugins/toggle'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),name=String(b.name||'');
    if(!/^[\w.@-]{1,80}$/.test(name))return send(res,400,{error:'Unknown plugin'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'});
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    const r=await hcmd(ag,['plugins',b.enabled?'enable':'disable',name],{timeout:150000});
    return r.ok?send(res,200,{ok:true,restart_required:/restart/i.test(r.out)}):send(res,400,{error:(r.err||'Could not change the plugin').slice(0,300)})}
   // Google AI Pro through Antigravity (Google's agy tool): status for everyone, connecting, cancelling and removing for admins
   if(p.startsWith('/ui/antigravity/')){const act=p.slice(16);if(act==='status'&&req.method==='GET')return send(res,200,await antigravity.status(url.searchParams.has('fresh')));
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect Google AI Pro.'});if(req.method!=='POST')return send(res,405,{error:'POST only'});
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{if(act==='start')return send(res,200,await antigravity.start());if(act==='code')return send(res,200,await antigravity.code(b.code));if(act==='cancel')return send(res,200,await antigravity.cancel());if(act==='logout'){const r=await antigravity.logout();await accountsApi.forget('p:antigravity-subscription').catch(()=>{});return send(res,200,r)}}catch(e){return send(res,400,{error:e.message})}
    return send(res,404,{error:'Unknown'})}
   // today's US dollar → rupiah rate, so costs can be shown in rupiah (fetched twice a day, last good one kept)
   if(p==='/ui/fx'&&req.method==='GET'){if(!FX.at||Date.now()-FX.at>12*3600e3){try{const r=await fetch('https://open.er-api.com/v6/latest/USD',{signal:AbortSignal.timeout(8000)});const j=await r.json();const rates=Object.fromEntries(Object.entries(j?.rates||{}).filter(([k,v])=>/^[A-Z]{3}$/.test(k)&&+v>0));if(rates.EUR)Object.assign(FX,{rates,at:Date.now(),day:(j.time_last_update_utc||'').slice(5,16)})}catch{}}
    return send(res,200,{rates:FX.rates,IDR:FX.rates.IDR,updated:FX.day||null})}
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
     if(LIVE_APP)writeAgentContext().catch(()=>{});return send(res,200,{ok:true,label,note})}
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
    // every other line (comments, blank lines, ones not understood) is kept as it is; key lines may start with options
    // (from="…",command="…"); the builder's key is known by its fingerprint, recorded the first time (DATA/ssh-protected.json)
    const f=path.join(homedir(),'.ssh','authorized_keys'),pf=path.join(DATA,'ssh-protected.json');const {createHash}=await import('node:crypto');
    const KEY=/(?:^|\s)(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*))?$/;
    const fpOf=b=>{try{return 'SHA256:'+createHash('sha256').update(Buffer.from(b,'base64')).digest('base64').replace(/=+$/,'')}catch{return ''}};
    const read=async()=>{const lines=(await readFile(f,'utf8').catch(()=>'')).split('\n');if(lines.length&&lines[lines.length-1]==='')lines.pop();
     const keys=lines.map((l,i)=>{if(l.trim().startsWith('#'))return null;const m=KEY.exec(l.trim());return m?{i,type:m[1],b64:m[2],name:(m[3]||'').trim()||'(no name)',fp:fpOf(m[2])}:null}).filter(Boolean);
     let prot=await readFile(pf,'utf8').then(JSON.parse).catch(()=>null);
     // which keys stay: chosen here with Protect (or SSH_PROTECTED_FP); none by default on a new install
     if(!Array.isArray(prot)){prot=[];await writeJsonAtomic(pf,prot).catch(()=>{})}
     const pset=new Set([...prot,...String(process.env.SSH_PROTECTED_FP||'').split(',').map(x=>x.trim()).filter(Boolean)]);
     return {lines,keys,list:keys.map(k=>({type:k.type,name:k.name,fp:k.fp,protected:pset.has(k.fp)}))}};
    // the user people sign in as (shown in "How to connect"): set here, else SSH_USER, else the user aqeelOS runs as
    const sf=path.join(DATA,'ssh-settings.json'),sshUser=async()=>(await readFile(sf,'utf8').then(JSON.parse).catch(()=>({}))).user||env.SSH_USER||(()=>{try{return userInfo().username}catch{return 'root'}})();
    if(req.method==='GET')return send(res,200,{keys:(await read()).list,host:SSH_HOST,port:SSH_PORT,user:await sshUser()});
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
    if(req.method==='PUT'&&'user' in b){const un=String(b.user||'').trim();if(un&&!/^[a-z_][a-z0-9_-]{0,31}$/.test(un))return send(res,400,{error:'Use a Linux user name: small letters, numbers, dashes or underscores.'});await writeJsonAtomic(sf,{user:un});return send(res,200,{user:await sshUser()})}
    // one change at a time, each on a fresh read, so two adds at once both stay
    const locked=fn=>{const r=sshLock.then(fn);sshLock=r.catch(()=>{});return r};
    // Protect: a key that can't be removed here by mistake (the one that maintains the box, for example)
    if(req.method==='PUT'&&b.fp)return locked(async()=>{const r=await read();if(!r.keys.some(x=>x.fp===b.fp))return send(res,404,{error:'No such key'});let prot=await readFile(pf,'utf8').then(JSON.parse).catch(()=>[]);if(!Array.isArray(prot))prot=[];
     if(!b.protected&&String(env.SSH_PROTECTED_FP||'').split(',').map(x=>x.trim()).includes(b.fp))return send(res,400,{error:'This key is protected in the server settings (SSH_PROTECTED_FP), so it stays.'});
     prot=b.protected?[...new Set([...prot,b.fp])]:prot.filter(x=>x!==b.fp);await writeJsonAtomic(pf,prot);
     console.log('ssh key',b.fp,b.protected?'protected':'no longer protected','by',u.name||u.id);return send(res,200,{keys:(await read()).list})});
    if(req.method==='POST'){const k=String(b.key||'').trim().replace(/\s+/g,' ');const name=String(b.name||'').trim().replace(/[^\w .@-]/g,'').slice(0,60);
     const m=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com) ([A-Za-z0-9+/=]{60,}) ?(.*)$/.exec(k);if(!m)return send(res,400,{error:'That is not an SSH public key. It starts with ssh-ed25519 (or ssh-rsa) and is one line. Never paste a private key.'});
     if(!name)return send(res,400,{error:'Give it a name, like “Sam’s laptop” or “Codex on the office PC”.'});
     return locked(async()=>{const r=await read();if(r.keys.some(x=>x.b64===m[2]))return send(res,400,{error:'That key already has access.'});
      const line=m[1]+' '+m[2]+' '+name.replace(/\s+/g,'-');await mkdir(path.dirname(f),{recursive:true,mode:0o700});await writeFile(f,[...r.lines,line].join('\n')+'\n',{mode:0o600});
      console.log('ssh access added:',name,'by',u.name||u.id);return send(res,200,{keys:(await read()).list})})}
    if(req.method==='DELETE')return locked(async()=>{const r=await read();const k=r.keys.find(x=>x.fp===b.fp);if(!k)return send(res,404,{error:'No such key'});
     if(r.list.find(x=>x.fp===k.fp).protected)return send(res,400,{error:'This key is protected. Choose Allow removing first.'});
     r.lines.splice(k.i,1);await writeFile(f,r.lines.join('\n')+'\n',{mode:0o600});console.log('ssh access removed:',k.name,'by',u.name||u.id);return send(res,200,{keys:(await read()).list})})}
   if(p==='/ui/memory'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});return send(res,200,await memNow())}
   if(p==='/ui/system-events'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{events:[]});return send(res,200,{events:sysEvents.filter(e=>e.kind!=='restart-failed')})}   // that one is a Bottlenecks item (noteSys)
   // the bell's list (news.mjs): the same on every device, read and cleared per person; the app adds a person's own news
   if(p==='/ui/news'&&req.method==='GET')return send(res,200,{items:await news.list(u,users.isAdmin(u)),needs:await needsFor(u).catch(()=>[])});
   // Activity (System › Activity): the quiet log, no badge
   if(p==='/ui/activity'&&req.method==='GET')return send(res,200,{items:await news.activity(u,users.isAdmin(u))});
   if(p==='/ui/notify-settings'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(req.method==='GET')return send(res,200,await notifySettings());
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}const v={...await notifySettings(),daily:!!b.daily};await writeFile(path.join(DATA,'notify.json'),JSON.stringify(v));return send(res,200,v)}}
   if(p.startsWith('/ui/news')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const admin=users.isAdmin(u);
    if(p==='/ui/news'){try{return send(res,200,{item:await news.addOwn(u,b)})}catch(e){return send(res,e.status||400,{error:e.message})}}
    if(p==='/ui/news/import')return send(res,200,{n:await news.importOwn(u,b.items)});
    if(p==='/ui/news/read')return send(res,200,{n:await news.read(u,admin,{ids:Array.isArray(b.ids)?b.ids.map(String).slice(0,200):[],all:!!b.all})});
    if(p==='/ui/news/hide')return send(res,200,{n:await news.hide(u,admin,{id:b.id?String(b.id):'',read:!!b.read})})}
   if(p==='/ui/thinking'&&req.method==='GET'){const sid=String(url.searchParams.get('session')||'');if(!/^[\w.-]{3,120}$/.test(sid))return send(res,200,{items:[]});const l=await readFile(path.join(DATA,'thinking',sid+'.json'),'utf8').then(JSON.parse).catch(()=>[]);return send(res,200,{items:l.filter(x=>users.isAdmin(u)||x.by===u.id).map(({u:q,think})=>({u:q,think}))})}
   if(p==='/ui/live'&&req.method==='GET'){const rec=LIVE.get((url.searchParams.get('agent')||'default')+'|'+(url.searchParams.get('session')||''));
    if(!rec||rec.done||rec.user!==u.id)return send(res,url.searchParams.has('peek')?200:204,url.searchParams.has('peek')?{live:false}:'');
    if(url.searchParams.has('peek'))return send(res,200,{live:true,since:rec.t});
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
    for(const c of rec.chunks)res.write(c);rec.subs.add(res);res.on('close',()=>rec.subs.delete(res));return}
   if(p==='/ui/gateway/restart'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can restart the gateway.'});if(backups.busy())return send(res,409,{error:'A restore is running. The agents start again by themselves when it finishes.'});
    const waiting=await waitingNow();restartGateway('restart from the app ('+(u.name||u.id)+')').catch(()=>{});return send(res,200,{ok:true,waiting})}
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
    // Unlock (admins): the admin's lock comes off; an agent whose owner may not have these tools stays locked by that
    if(b.safe===false){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can unlock an agent.'});
     try{await setStatus(ag,{safe:false});if(lockedAgent(ag,await getStatus())){const ow=users.byId(users.agentOwner(ag));return send(res,200,{ok:true,still:(ow?.name||'Its owner')+' is not allowed terminal, files or code, so the agent keeps them off. Give them that under People first.'})}
      await unlockTools(ag);agentDefaults.ensure(ag).catch(()=>{});console.log('agent unlocked from safe tools:',ag,'by',u.id);return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
    try{await setStatus(ag,{safe:true});await lockTools(ag);return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
   // Channels › Slack: channels whose name starts with this stay quiet ('' = none)
   // quiet Slack channels, per workspace: GET {teams:{<id>:{prefix,name}}}; PUT {team,prefix,name}
   if(p==='/ui/slack-quiet'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});if(req.method==='GET'){const bots=[];for(const a of await listAgents()){const env=await envOf(a);if(!env.SLACK_BOT_TOKEN)continue;const r=await channelIdentity(a,{id:'slack'},env).catch(()=>null);if(r?.account?.team)bots.push({agent:a,team:r.account.team,name:r.account.name||''})}
     return send(res,200,{teams:await slackQuiet.get(),bots})}
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{const t=await slackQuiet.set(String(b.team||''),b.prefix,b.name);setTimeout(()=>slackClientChannels().catch(()=>{}),1000).unref();console.log('slack quiet for',b.team,'is now',JSON.stringify(t.prefix),'by',u.id);return send(res,200,t)}catch(e){return send(res,400,{error:e.message})}}}
   // Trusted (runs as the main user): admins, for agents of admins. Others run as their own Linux user
   if(p==='/ui/agent-trust'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const tr=await agentDefaults.trusted();
    if(req.method==='GET'){const out={};for(const a of String(url.searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200))out[a]={trusted:tr.has(a),main:a==='default',may:a==='default'||users.tierOf(a)==='admin'};return send(res,200,out)}
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'');if(!await isAgent(ag)||ag==='default'||ag.includes('--'))return send(res,400,{error:'Unknown agent'});
    if(b.trusted&&users.tierOf(ag)!=='admin')return send(res,400,{error:'Only agents of admins can run as the main user.'});
    await agentDefaults.setTrusted(ag,!!b.trusted);console.log('agent',ag,b.trusted?'trusted: runs as the main user':'runs as its own user','(by '+u.id+')');
    agentDefaults.added(ag).then(async n=>{if(n&&!await isTestAgent(ag).catch(()=>false))Promise.resolve(restartGateway('Trusted changed for '+ag)).catch(()=>{})}).catch(e=>console.warn('agent defaults',ag,e.message));return send(res,200,{ok:true,trusted:!!b.trusted})}
   // Abilities › Skills › Only these agents (admins): one skill's rule in skills-policy.json
   if(p==='/ui/skills-policy'){if(req.method==='GET')return send(res,200,skillRules());if(!users.isAdmin(u))return send(res,403,{error:'Only admins decide which agents get a skill.'});
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}try{await setSkillRule(b.skill,Array.isArray(b.agents)?b.agents:null);console.log('skill',b.skill,Array.isArray(b.agents)?'only for '+b.agents.join(', '):'for every agent','(by '+u.id+')');return send(res,200,skillRules())}catch(e){return send(res,400,{error:e.message})}}
   // which agents are locked to safe tools, and why (the Tool groups grid shows a lock with this reason instead of a switch)
   if(p==='/ui/agent-locks'&&req.method==='GET'){const st=await getStatus();const out={};
    for(const a of String(url.searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200)){if(a==='default'||!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)!==null||!lockedAgent(a,st))continue;
     const ow=users.byId(users.agentOwner(a));out[a]=st[a]?.safe?'An admin locked this agent to safe tools: terminal, files, code and computer use stay off.':'Its owner'+(ow?.name?' '+ow.name:'')+' isn’t allowed terminal, files, code or computer use, so this agent can’t have them either.'}
    return send(res,200,out)}
   // abilities across agents: who has what, copy to other agents, rename an MCP tool (admins, or owners of both agents)
   if(p==='/ui/share/used'&&req.method==='GET'){const kind=url.searchParams.get('kind')||'';const all=await sharing.usedBy(kind);if(!users.isAdmin(u)){for(const k of Object.keys(all))all[k]=all[k].filter(a=>users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)===null)}return send(res,200,all)}
   if(p==='/ui/share'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||''),to=(Array.isArray(b.to)?b.to:[]).map(String);
    const may=a=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null;if(!may(from)||!to.every(may))return send(res,403,{error:'You can only share between agents you can edit.'});
    if(!users.isAdmin(u)&&b.kind==='mcp')return send(res,403,{error:'Only admins can copy MCP tools between agents.'});
    // the same rights as doing it on each agent directly: plugins are admin-only, skills and schedules need that permission
    if(!users.isAdmin(u)&&b.kind==='plugin')return send(res,403,{error:'Only admins can turn plugins on.'});
    if(!users.isAdmin(u)&&b.kind==='skill'&&!to.every(a=>users.canOn(u,'skills',a)))return send(res,403,{error:'Your role does not include adding skills to that agent.'});
    if(!users.isAdmin(u)&&b.kind==='schedule'&&!to.every(a=>users.canOn(u,'schedules',a)))return send(res,403,{error:'Your role does not include schedules on that agent.'});
    try{return send(res,200,await sharing.share(String(b.kind||''),String(b.name||''),from,to,b.replace===true))}catch(e){return send(res,400,{error:e.message})}}
   // a provider without automatic registration (Slack, Google…): its app's client ID/secret, and the return address to give it
   if(p==='/ui/mcp/oauth-client'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set this.'});let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{return send(res,200,await sharing.setOauthClient(String(b.agent||'default'),String(b.name||''),String(b.client_id||'').trim(),String(b.client_secret||'').trim(),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||''))))}catch(e){return send(res,400,{error:e.message})}}
   // every agent's model and the account it runs on, for "All agents" on Agents' models
   if(p==='/ui/n8n/status'&&req.method==='GET'){const a=String(url.searchParams.get('agent')||'default');
    // every agent's n8n address is for admins only; a member sees an agent's own only when they have that agent
    // (the n8n page always asks for the main agent, so no access still answers, just without the address)
    const s=await n8n.status(a);if(!users.isAdmin(u)){delete s.users;if(users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))s.user=null}return send(res,200,s)}
   // "Open in Code" from a chat: the request an agent kept, for a person who may chat with that agent
   if(p==='/ui/code/handoff'&&req.method==='GET'){const v=await codeAgents.handoffGet(url.searchParams.get('id'));if(!v)return send(res,404,{error:'This link has expired. Ask the agent again.'});
    if(users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),v.agent))return send(res,403,{error:'You can’t use that agent.'});return send(res,200,{agent:v.agent,agentName:NAMES[v.agent]||await displayName(v.agent),text:v.text})}
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
   if(p==='/ui/code/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const d=await code.runs(days,users.isAdmin(u)?null:u.id);const people={};for(const id of Object.keys(d.byPerson)){const x=users.byId(id);people[id]={name:x?.name||id,avatar:x?.avatar?'/ui/people/avatar/'+id:null}}
    // admins: the latest calls agents made into projects on people's computers (the code bridge), newest first
    const bridge=users.isAdmin(u)?(await codeBridge.recent(40)).map(x=>({...x,userName:users.byId(x.user)?.name||x.user||''})):undefined;return send(res,200,{...d,people,...(bridge?{bridge}:{})})}
   // Bottlenecks: what is stuck until a person acts (admins also see what aqeelOS itself noticed)
   // Live: every published app (everyone sees them; publisher or admin takes one offline; admins connect the server)
   // Connected apps › Code (admins): every computer's Code with its GitHub accounts and tool servers, and Live's server
   if(p==='/ui/code/connected'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const names=Object.fromEntries(users.people().map(x=>[x.id,x.name||x.username||'Someone']));
    return send(res,200,{devices:(await code.allDevices()).map(d=>({...d,person:names[d.user]||'Someone'})),live:{connected:(await live.list(u,true)).connected}})}
   // backups to Google Drive (admins): the state, back up now, a restore test, and the key that unlocks them
   // engine updates (engine-updates.mjs): the setting, "Update tonight", and the list of attempts
   if(p.startsWith('/ui/engine-updates')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    try{if(p==='/ui/engine-updates'&&req.method==='GET')return send(res,200,await engineUpd.status());
     if(p==='/ui/engine-updates/mode'&&req.method==='POST')return send(res,200,await engineUpd.setMode(String(b.mode||'')));
     if(p==='/ui/engine-updates/tonight'&&req.method==='POST')return send(res,200,await engineUpd.setTonight(!!b.on))}catch(e){return send(res,400,{error:e.message})}}
   // run_self (admins, Automations › Runs itself): per-agent switches and limits, trusted people, runs, Stop and Resume
   if(p==='/ui/self-runs'||p.startsWith('/ui/self-runs/')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    const who=u.name||u.username||u.id,ag=String(b.agent||'');
    try{if(req.method==='GET'&&p==='/ui/self-runs'){const all=[];for(const a of await listAgents())if(await srEligible(a))all.push(a);return send(res,200,await selfRuns.overview(all))}
     if(req.method==='GET'&&p==='/ui/self-runs/run'){const r=await selfRuns.detail(url.searchParams.get('id'));return r?send(res,200,r):send(res,404,{error:'No such run.'})}
     if(req.method!=='POST')return send(res,405,{error:'Not here.'});
     if((p==='/ui/self-runs/settings'||p==='/ui/self-runs/resume')&&!await srEligible(ag))return send(res,400,{error:'That agent cannot run itself.'});
     if(p==='/ui/self-runs/settings')return send(res,200,await selfRuns.setSettings(ag,b,who));
     if(p==='/ui/self-runs/resume')return send(res,200,{ok:await selfRuns.resume(ag,who)});
     if(p==='/ui/self-runs/stop')return send(res,200,{ok:await selfRuns.stop(String(b.id||''),who)});
     if(p==='/ui/self-runs/code'){const c=await selfRuns.newCode({name:b.name,by:who});return send(res,200,{code:c.code,exp:c.exp})}
     if(p==='/ui/self-runs/code/cancel')return send(res,200,{ok:await selfRuns.cancelCode(String(b.code||''))});
     if(p==='/ui/self-runs/untrust'){const ok=await selfRuns.untrust(String(b.id||''),who);if(ok)syncNotifyTool().catch(()=>{});return send(res,200,{ok})}
     return send(res,404,{error:'Not here.'})}catch(e){return send(res,400,{error:e.message})}}
   // one-time secret links (admins, System › Keys and secrets): open links (cancel) and what happened, never a value
   // Kirimdev lines (kirimdev.mjs): the API key and its check, each line's status, Test/Draft/Live, the optional webhook
   if(p==='/ui/kirimdev'||p==='/ui/kirimdev/setup'||p==='/ui/kirimdev/line'||p==='/ui/kirimdev/disconnect'||p==='/ui/kirimdev/renew'||p==='/ui/kirimdev/test'||p==='/ui/kirimdev/mode'||p==='/ui/kirimdev/connect'||p==='/ui/kirimdev/pause'||p==='/ui/kirimdev/draft'||p==='/ui/kirimdev/check'||p==='/ui/kirimdev/key'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(req.method==='GET'&&p==='/ui/kirimdev'){const [lines,account,keySaved,numbers]=await Promise.all([kirimdev.status(),kirimdev.account(),readFile(path.join(HERMES_HOME,'secrets','kirimdev.env'),'utf8').then(t=>/^KIRIMDEV_API_KEY=\S/m.test(t),()=>false),kirimdev.numbers({fresh:url.searchParams.get('fresh')==='1'})]);return send(res,200,{lines,account,keySaved,numbers,reach:publicReach(PUBLIC_URL)})}
    if(req.method==='GET'&&p==='/ui/kirimdev/setup')return send(res,200,await kirimdevSetup(String(url.searchParams.get('agent')||'')));
    let b={};try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}
    try{if(req.method==='POST'&&p==='/ui/kirimdev/mode')return send(res,200,{ok:await kirimdev.setMode(String(b.agent||''),String(b.mode||''))});
     if(req.method==='POST'&&p==='/ui/kirimdev/pause')return send(res,200,{pauseMin:await kirimdev.setPause(String(b.agent||''),b.min)});
     if(req.method==='POST'&&p==='/ui/kirimdev/draft')return send(res,200,await kirimdev.draft(String(b.agent||''),b.id,String(b.action||''),b.text,u.name||'an admin'));
     if(req.method==='POST'&&p==='/ui/kirimdev/connect'){const r=await kirimdev.connectWebhook(String(b.agent||''));kirimdev.check().catch(()=>{});return send(res,200,r)}
     if(req.method==='POST'&&p==='/ui/kirimdev/check')return send(res,200,await kirimdev.check());
     if(req.method==='POST'&&p==='/ui/kirimdev/key')return send(res,200,await kirimdev.setKey(String(b.key||'')));
     // Connect (a new line) or the line's settings changed; the team group is saved with it when one was picked
     if(req.method==='POST'&&p==='/ui/kirimdev/line'){const a=String(b.agent||'');if(!(await listAgents()).includes(a))throw Error('Pick the agent that answers this number.');
      if(b.team&&String(b.team.chatId||'').trim()){const cur=await teamGroups.get(a).catch(()=>null);await teamGroups.set(a,{chatId:b.team.chatId,...(b.team.name?{name:b.team.name}:{}),topics:{...(cur?.topics||{}),questions:b.team.questions??''}},u.name||'an admin')}
      const {team,agent,...rest}=b;const r=await kirimdev.saveLine(a,rest);if(r.isNew)kirimdevChanged();return send(res,200,r)}
     if(req.method==='POST'&&p==='/ui/kirimdev/disconnect'){const r=await kirimdev.disconnect(String(b.agent||''));kirimdevChanged();return send(res,200,r)}
     if(req.method==='POST'&&p==='/ui/kirimdev/renew')return send(res,200,await kirimdev.renewSecret(String(b.agent||'')));
     if(req.method==='POST'&&p==='/ui/kirimdev/test')return send(res,200,await kirimdev.testSend(String(b.agent||''),b.tester))}catch(e){return send(res,400,{error:e.message})}}
   // Team group per agent (team-group.mjs): admins read and change it on the Channels page
   if(p==='/ui/team-group'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(req.method==='GET'){const a=url.searchParams.get('agent')||'';return send(res,200,{group:await teamGroups.get(a),roles:TEAM_ROLES.map(([k,l,what])=>({key:k,label:l,what}))})}
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{const {agent,...patch}=b;if(!(await listAgents()).includes(String(agent||'')))throw Error('Unknown agent.');return send(res,200,{group:await teamGroups.set(String(agent),patch,u.name||'an admin')})}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/secret-links'||p==='/ui/secret-links/cancel'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(req.method==='GET'&&p==='/ui/secret-links')return send(res,200,await secretLinks.list());
    if(req.method==='POST'&&p==='/ui/secret-links/cancel'){let b={};try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}return send(res,200,{ok:await secretLinks.cancel(String(b.id||''),u.id)})}
    return send(res,405,{error:'Not here.'})}
   // automations (automation-guard.mjs): every agent's tool servers and schedules that hit a missing tool; Fix now, Run now
   if(p.startsWith('/ui/automations')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    // with each agent's backup models and an outage switch going on (backup-models.mjs); Check now writes the lists at once
    try{if(p==='/ui/automations'&&req.method==='GET')return send(res,200,{...await guard.status(),models:await backupModels.status().catch(()=>null)});
     if(p==='/ui/automations/models'&&req.method==='POST'){const r=await backupModels.sync('Check now');await backupModels.tick();return send(res,200,{lists:r,...await backupModels.status()})}const a=String(b.agent||'');if(!(await agentNames({copies:true})).includes(a))return send(res,400,{error:'Unknown agent'});
     if(p==='/ui/automations/fix'&&req.method==='POST')return send(res,200,guard.startFix(a,String(b.server||'')));   // runs in the background; the card shows Fixing until it is done
     if(p==='/ui/automations/run'&&req.method==='POST')return send(res,200,await guard.runJob(a,String(b.job||'')))}catch(e){return send(res,400,{error:e.message})}}
   if(p.startsWith('/ui/backups')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
    if(p==='/ui/backups'&&req.method==='GET')return send(res,200,await backups.status());
    if(p==='/ui/backups/key'&&req.method==='GET'){try{return send(res,200,{key:await backups.key()})}catch(e){return send(res,409,{error:e.message})}}
    if(p==='/ui/backups/run'&&req.method==='POST'){if(backups.busy())return send(res,409,{error:'A restore is running. Back up after it finishes.'});backups.run('by hand').catch(()=>{});return send(res,200,{started:true})}
    if(p==='/ui/backups/test'&&req.method==='POST'){try{return send(res,200,await backups.test())}catch(e){return send(res,400,{error:e.message})}}
    if(p==='/ui/backups/list'&&req.method==='GET'){try{return send(res,200,await backups.list())}catch(e){return send(res,400,{error:e.message})}}
    if(p==='/ui/backups/estimate'&&req.method==='GET'){try{return send(res,200,await backups.estimate(url.searchParams.get('id')))}catch(e){return send(res,e.status||400,{error:e.message})}}
    // an existing key typed in, the settings, and the two steps of a restore: Prepare (a preview, nothing changes) and Restore now
    if(req.method!=='GET'){let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}const ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message,...(e.replace?{replace:true}:{})});
     if(p==='/ui/backups/key'&&req.method==='POST')return backups.setKey(b.key,{replace:!!b.replace}).then(ok,bad);
     if(p==='/ui/backups/settings'&&req.method==='PUT')return backups.setSettings(b).then(x=>ok({settings:x}),bad);
     if(p==='/ui/backups/prepare'&&req.method==='POST')return backups.prepare(String(b.id||'')).then(ok,bad);
     if(p==='/ui/backups/cancel'&&req.method==='POST')return backups.cancel().then(ok,bad);}
    // a restore stops and starts the real agents, so only the live app does it (a test copy shares the box's engine)
    if(p==='/ui/backups/restore'&&req.method==='POST'){if(!LIVE_APP)return send(res,409,{error:'Only the live app restores backups.'});if(engineUpd.busy())return send(res,409,{error:'The engine is updating. Restore after it finishes.'});try{return send(res,200,await backups.apply())}catch(e){return send(res,e.status||400,{error:e.message})}}}
   // Connect Google (google-connect.mjs, admins): the OAuth client file, Connect and Reconnect, a pasted address, check, remove
   if(p.startsWith('/ui/google/')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins connect Google accounts.'});let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{return send(res,400,{error:'Bad request'})}}
    const ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message}),ag=String(b.agent||url.searchParams.get('agent')||'default');
    if(p!=='/ui/google/result'&&p!=='/ui/google/client'&&p!=='/ui/google/state'&&!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'});
    if(p==='/ui/google/state'&&req.method==='GET'){const all=await agentNames();const accounts=(await Promise.all(all.map(a=>gconnect.accounts(a)))).flat().map(x=>({...x,agentName:NAMES[x.agent]||x.agent}));return ok({...await gconnect.info(),accounts,agents:all.map(a=>({id:a,name:NAMES[a]||a}))})}
    if(p==='/ui/google/client'&&req.method==='POST')return gconnect.saveClient(String(b.json||'')).then(ok,bad);
    if(p==='/ui/google/client'&&req.method==='DELETE')return gconnect.removeClient().then(ok,bad);
    if(p==='/ui/google/connect'&&req.method==='POST')return gconnect.start({agent:ag,name:b.name,services:Array.isArray(b.services)?b.services:undefined,reconnect:!!b.reconnect}).then(ok,bad);
    if(p==='/ui/google/result'&&req.method==='GET')return gconnect.result(String(url.searchParams.get('state')||'')).then(ok,bad);
    if(p==='/ui/google/finish'&&req.method==='POST')return gconnect.finish(String(b.address||'')).then(r=>{googleConnected(r,u.name||u.email||'');return ok(r)},bad);
    if(p==='/ui/google/check'&&req.method==='POST')return gconnect.check(ag,String(b.name||'')).then(ok,bad);
    if(p==='/ui/google/account'&&req.method==='DELETE')return gconnect.remove(ag,String(b.name||'')).then(r=>{if(LIVE_APP)writeAgentContext().catch(()=>{});return ok(r)},bad);
    return send(res,404,{error:'Not found'})}
   // an app that is already added: edit its address, sign-in and key, or its command; its key and keys nothing reads (admins)
   if(p==='/ui/mcp/server'||p==='/ui/mcp/keys'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins change apps and their keys.'});let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{return send(res,400,{error:'Bad request'})}}
    const ag=String(b.agent||url.searchParams.get('agent')||'default'),ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message});if(!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'});
    if(p==='/ui/mcp/server'&&req.method==='GET')return mcpEdit.get(ag,String(url.searchParams.get('name')||'')).then(ok,bad);
    if(p==='/ui/mcp/server'&&req.method==='PUT')return mcpEdit.save(ag,b).then(ok,bad);
    if(p==='/ui/mcp/keys'&&req.method==='GET'){if(url.searchParams.get('all')==='1'){const out=[];for(const a of await agentNames())for(const k of await mcpEdit.keys(a).catch(()=>[]))out.push({...k,agent:a,agentName:NAMES[a]||a});return ok({keys:out})}return mcpEdit.keys(ag).then(k=>ok({keys:k}),bad)}
    if(p==='/ui/mcp/keys'&&req.method==='DELETE')return mcpEdit.removeKey(ag,String(b.key||'')).then(ok,bad);
    return send(res,405,{error:'Not allowed'})}
   // which aqeelOS app version is current (the app offers to update itself when it is older)
   if(p==='/ui/code/app-version'&&req.method==='GET'){const [l,r]=await Promise.all([localAppVersions(),releaseAppVersions()]);const v={};for(const k of ['mac','windows']){const n=newerApp(r?.[k],l[k])?r[k]:l[k];if(n)v[k]=n}return send(res,200,v)}
   // company-wide defaults (the currency for people who never picked one): everyone reads them, admins set them
   if(p==='/ui/defaults'){const F=path.join(DATA,'defaults.json');let d={};try{d=JSON.parse(await readFile(F,'utf8'))}catch{}
    if(req.method==='GET')return send(res,200,d);if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
    if(b.currency!==undefined){if(!/^[A-Z]{3}$/.test(String(b.currency)))return send(res,400,{error:'Pick a currency code like USD or EUR.'});d.currency=b.currency}await writeFile(F,JSON.stringify(d,null,1));return send(res,200,d)}
   if(p==='/ui/apps'&&req.method==='GET')return send(res,200,{...await live.list(u,users.isAdmin(u)),admin:users.isAdmin(u)});
   if(p.startsWith('/ui/apps/')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{if(p==='/ui/apps/check'){const a=await live.check(String(b.id||''));return send(res,200,{status:a.status,error:a.error||''})}
     if(p==='/ui/apps/remove')return send(res,200,await live.remove(u,users.isAdmin(u),String(b.id||'')));
     if(p==='/ui/apps/visibility')return send(res,200,await live.setVisibility(u,users.isAdmin(u),String(b.id||''),String(b.visibility||'')));
     if(p==='/ui/apps/online')return send(res,200,await live.setOnline(u,users.isAdmin(u),String(b.id||''),!!b.on));
     if(p==='/ui/apps/visits'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,await live.countVisits(!!b.on))}
     if(p==='/ui/apps/connect'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,await live.connect(b))}}catch(e){return send(res,400,{error:e.message})}}
   // System › Health: each agent fine or with its problems, and its failed messages this week (agent-health.mjs)
   if(p==='/ui/health/issues'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const l=await issues.list();return send(res,200,{items:l.items.map(i=>({id:i.id,agent:i.agent,agentName:i.agentName,state:i.state,source:i.source||null,missing:i.missing,proposed_fix:i.proposed_fix,byName:i.byName,decision:i.decision,created:i.created,updated:i.updated,count:i.count,result:i.result||null,tries:i.tries??i.attempts??0,proof:i.proof||null,need:i.need||null,told:i.told||null,patch:i.patch||null,noRetry:!!i.noRetry,closeAfter:!!i.closeAfter,history:(i.history||[]).slice(-8).map(h=>({kind:h.kind,at:h.at,status:h.status,summary:h.summary||null,outcome:h.outcome||null}))})),escalations:await escalations.view().catch(()=>({agents:{}})),agents:(await listAgents().catch(()=>[])).map(a=>({id:a,name:agentName(a)})),sources:await chatHistory.sources().catch(()=>[]),policy:{teams:(l.policy.teams||[]).map(t=>({name:t.name,agents:t.agents,contact:t.contact||(t.members||[])[0]?.name||null,members:(t.members||[]).map(m=>m.name)})),fixer:l.policy.fixer||{}}})}
  // Report an issue, Stop retrying and Close (System › Health): a person files one for the fixer, or ends one
  if(/^\/ui\/health\/issues\/(report|close|stop)$/.test(p)&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
   try{if(p.endsWith('/report')){const a=String(b.agent||'');if(!(await listAgents()).includes(a))return send(res,400,{error:'Pick the agent it is about.'});
     const r=await issues.file({agent:a,missing:String(b.missing||''),evidence:String(b.evidence||''),source:'person',origin:{who:u.name||'an admin'}});return send(res,200,{ok:true,id:r.issue.id,state:r.issue.state,again:!!r.again})}
    const i=await issues[p.endsWith('/close')?'close':'stop'](String(b.id||''),u.name||'an admin');if(!i)return send(res,404,{error:'No such issue.'});return send(res,200,{ok:true,state:i.state,after:!!i.noRetry})}catch(e){return send(res,400,{error:e.message})}}
  // System › Teams (team-settings.mjs): teams and members, the fixer, where alerts go, Pause alerts, test agents
  if(/^\/ui\/(teams|alerts)(\/|$)/.test(p)){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,131072))}catch{}}
   const nm=a=>agentName(a),chans=async()=>(await relay.channelsFor('default').catch(()=>[])).map(c=>({id:c.id,name:c.name,platform:c.platform,owner:c.owner}));
   const full=async()=>{const v=await teamSettings.view();return {...v,agents:v.agents.map(a=>({id:a,name:nm(a)})),channels:await chans()}};
   try{
    if(p==='/ui/teams'&&req.method==='GET')return send(res,200,await full());
    if(p==='/ui/teams'&&req.method==='PUT'){await teamSettings.setTeams(b);return send(res,200,await full())}
    if(p==='/ui/teams/fixer'&&req.method==='PUT'){const f=await teamSettings.setFixer(b);if(f.on&&LIVE_APP)issues.tick().catch(()=>{});return send(res,200,{fixer:f})}
    if(p==='/ui/teams/test'&&req.method==='PUT')return send(res,200,{tests:await teamSettings.setTest(b.agent,!!b.on)});
    if(p==='/ui/alerts/chats'&&req.method==='POST'){const c=(await relay.channelsFor('default')).find(x=>x.id===String(b.channel||''));if(!c)return send(res,404,{error:'That channel is gone.'});
     return send(res,200,{chats:await relay.recipients(c.owner,c.platform)})}
    if(p==='/ui/alerts'&&req.method==='PUT'){const id=String(b.channel||'');let name=null;
     if(id){const c=(await relay.channelsFor('default')).find(x=>x.id===id);if(!c)return send(res,400,{error:'That channel is not connected.'});name=c.name+(b.chatName?', '+String(b.chatName).slice(0,60):'')}
     return send(res,200,{alerts:await teamSettings.setAlerts({channel:id,chat:b.chat,name})})}
    if(p==='/ui/alerts/test'&&req.method==='POST'){const r=await ownerSend('Test from '+(globalThis.AQ_BRAND||'aqeelOS')+': alerts for you arrive here. Sent by '+(u.name||'an admin')+' from System › Teams.','telegram');return send(res,200,r)}
    if(p==='/ui/alerts/pause'&&req.method==='PUT')return send(res,200,{pause:await teamSettings.setPause(b)});
   }catch(e){return send(res,400,{error:e.message})}
   return send(res,404,{error:'Not found'})}
  // "Try again" (after a person did what was needed, or for a stuck issue): a fresh set of tries
  // code changes on the box that git lacks (code-changes.mjs): the list, one patch's text, and "taken into git"
  if(p==='/ui/health/code-changes'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
   if(url.searchParams.get('name')){try{return send(res,200,{text:await codeChanges.read(url.searchParams.get('kind'),url.searchParams.get('name'))})}catch(e){return send(res,404,{error:e.code==='ENOENT'?'That patch is gone.':e.message})}}
   return send(res,200,{items:await codeChanges.list()})}
  if(p==='/ui/health/code-changes/done'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
   try{await codeChanges.done(String(b.kind||''),String(b.name||''));return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.code==='ENOENT'?'That patch is gone.':e.message})}}
  if(p==='/ui/health/issues/retry'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}const i=await issues.retry(String(b.id||''));if(!i)return send(res,404,{error:'No such issue.'});return send(res,200,{ok:true,state:i.state})}
   if(p==='/ui/health/agents'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,await health.view())}
   // an agent's instructions (instructions.mjs): history, a version with its changes, save, bring back, rewrites waiting for approval, flags
   // an agent's own changes (agent-versions.mjs): list, and undo one (Edit agent › Changes); same rights as its instructions
   {const vm=/^\/ui\/agent-versions\/([^/]+)(?:\/(undo))?$/.exec(p);if(vm){const ag=decodeURIComponent(vm[1]),who=u.name||u.username||'Someone';
    if(!(await listAgents()).includes(ag))return send(res,404,{error:'No such agent.'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can chat with this agent but not change it.'});
    try{if(!vm[2]&&req.method==='GET')return send(res,200,await versions.changes(ag,{limit:60}));
     if(vm[2]==='undo'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const x=await versions.undo(ag,String(b.id||''),{by:who});console.log('agent-versions:',who,'undid',ag,b.id);return send(res,200,x)}
     return send(res,405,{error:'Not allowed'})}catch(e){return send(res,400,{error:e.message})}}}
   {const im=/^\/ui\/instructions\/([^/]+)(?:\/(v\/\d+|p\/[a-z0-9]+|save|restore|propose|decide|check))?$/.exec(p);if(im){const ag=decodeURIComponent(im[1]),act=im[2]||'',who=u.name||u.username||'Someone';
    if(!(await listAgents()).includes(ag))return send(res,404,{error:'No such agent.'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can chat with this agent but not change it.'});
    if(act==='decide'&&!users.isAdmin(u)&&users.agentOwner(ag)!==u.id)return send(res,403,{error:'Only an owner of this agent can approve its instructions.'});
    let b={};if(req.method==='POST'||req.method==='PUT'){try{b=JSON.parse(await readBody(req,400e3)||'{}')}catch{return send(res,400,{error:'bad json'})}}
    try{if(!act&&req.method==='GET')return send(res,200,await instructions.history(ag));
     if(act.startsWith('v/')&&req.method==='GET')return send(res,200,await instructions.version(ag,+act.slice(2)));
     if(act.startsWith('p/')&&req.method==='GET')return send(res,200,await instructions.proposal(ag,act.slice(2)));
     if(act==='save'&&req.method==='PUT'){const x=await instructions.write(ag,b.content,{kind:'edit',by:who,why:b.why||'',said:b.said||''});console.log('instructions:',who,'saved',ag,'v'+x.v);return send(res,200,x)}
     if(act==='restore'&&req.method==='POST'){const x=await instructions.restore(ag,+b.v,who);console.log('instructions:',who,'brought back',ag,'v'+b.v);return send(res,200,x)}
     if(act==='propose'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,await instructions.propose(ag,{content:b.content,why:b.why,said:b.said,by:b.by||who}))}
     if(act==='decide'&&req.method==='POST'){const r=await instructions.decide(ag,String(b.id||''),!!b.ok,who);console.log('instructions:',who,r.state,'a rewrite of',ag);return send(res,200,r)}
     if(act==='check'&&req.method==='POST'){await instructions.check(ag,{force:true});return send(res,200,await instructions.history(ag))}}
    catch(e){return send(res,400,{error:e.message})}
    return send(res,405,{error:'Not allowed'})}}
   if(p==='/ui/bottlenecks'&&req.method==='GET')return send(res,200,{items:await needsFor(u)});
   if((p==='/ui/bottlenecks/done'||p==='/ui/bottlenecks/later')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const id=String(b.id||'').slice(0,300);if(!id)return send(res,400,{error:'Which one?'});const admin=users.isAdmin(u);
    // a Help ticket: admins resolve it (the person is told in their Help chat) or put it off a day
    if(id.startsWith('ticket|')){try{return send(res,200,await help.decide(id,p.endsWith('/done')?'done':'later',u))}catch(e){return send(res,e.status||400,{error:e.message})}}
    // only what this person is shown: a report from an agent they may use, anything else for admins and only when it is there
    if(id.startsWith('report|')){const r=await bottlenecks.find(id);if(!r)return send(res,404,{error:'That one is already gone.'});if(users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),r.agent))return send(res,403,{error:'That agent is not shared with you.'})}
    else{if(!admin)return send(res,403,{error:'Only admins.'});const cur=await bottlenecks.list({admin:true,mayUse:()=>false,signins:[...signinsDue.values()],invites:users.expiredInvites(),accounts:await accountsApi.signedOut().catch(()=>[]),channels:await channelAttention(false).catch(()=>[])});if(!cur.some(x=>x.id===id))return send(res,404,{error:'That one is already gone.'})}
    await (p.endsWith('done')?bottlenecks.done(id):bottlenecks.later(id,admin?null:u.id));return send(res,200,{ok:true})}
   // Code › Live › Team folders: the shared folders a person is in (admins see every one), read only
   if(p==='/ui/team-folders'&&req.method==='GET')return send(res,200,{folders:await teamFolders.list(u.id,{all:users.isAdmin(u)})});
   if(p==='/ui/code/devices'&&req.method==='GET')return send(res,200,{devices:await code.devices(u.id)});
   if(p==='/ui/code/unpair'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=await code.unpair(u.id,String(b.id||''));return n?send(res,200,{ok:true}):send(res,400,{error:'That computer was not found.'})}
   {const dm=/^\/ui\/code\/download\/(windows|mac)$/.exec(p);if(dm&&req.method==='GET'){
    // the aqeelOS app installer (Windows: aqeelOS-Setup.exe, Mac: aqeelOS.dmg). ?check=1 says whether it is there; without one
    // there is nothing to give (the older zip ran Code outside the app, which the browser no longer opens)
    {const f=path.join(DATA,'desktop',dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS-Setup.exe');const st=await stat(f).catch(()=>null);
     // the public release, unless this install has its own newer build (or none is published)
     const rel=await releaseAppVersions(),mine=await localAppVersions(),useRel=rel?.[dm[1]]&&(!st||newerApp(rel[dm[1]],mine[dm[1]]));
     if(url.searchParams.get('check'))return send(res,200,{ok:Boolean(st||useRel)});
     if(useRel){res.writeHead(302,{location:DESKTOP_RELEASES+'/'+path.basename(f),'cache-control':'no-store',...security});return res.end()}
     if(st){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+(dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS Setup.exe')+'"','content-length':st.size,...security});return createReadStream(f).pipe(res)}}
    return send(res,404,{error:'The aqeelOS app for '+(dm[1]==='mac'?'Mac':'Windows')+' isn’t ready yet.'})}}
   // an agent's n8n is its workflows, signed in as it: a member needs to be able to change that agent, chatting is not enough
   if(p==='/ui/n8n/spaces'&&req.method==='GET'){const mine=users.isAdmin(u)?null:new Set((await listAgents()).filter(a=>users.atLeast(u,a,'edit')));const all=await n8n.spaces({fresh:url.searchParams.has('fresh')}),l=all.filter(x=>!mine||mine.has(x.agent));
    return send(res,200,{spaces:l.map(x=>({...x,name:NAMES[x.agent]||x.agent,shared:x.shared.filter(a=>!mine||mine.has(a))})),agents:(await listAgents()).filter(a=>!mine||mine.has(a)).map(a=>({id:a,name:NAMES[a]||a})),canEdit:users.isAdmin(u),...(all.partial?{partial:true}:{})})}
   if(p==='/ui/n8n/share'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share an agent’s n8n.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await n8n.share(String(b.space||''),String(b.agent||''),!!b.on))}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/n8n/base'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change the n8n address.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await n8n.setBase(b.url))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/n8n/owner'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect n8n.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{await n8n.setOwner(String(b.email||'').trim(),String(b.password||''));console.log('n8n: owner login saved');return send(res,200,{ok:true})}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/n8n/open'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const a=String(b.agent||'default');
    // admins can open n8n as its owner, to see every agent's workflows
    if(b.owner){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can open n8n as its owner.'});if(!await n8n.ready())return send(res,409,{error:'n8n is not connected yet.'});const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket('__owner')})}if(!(await listAgents()).includes(a))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&!users.atLeast(u,a,'edit'))return send(res,403,{error:'You can chat with this agent but not open its n8n.'});
    try{const r=await n8n.ensure(a);const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket(a),email:r.email})}catch(e){return send(res,409,{error:e.message})}}
   if(p==='/ui/models/agents'&&req.method==='GET'){const ag=(await listAgents()).filter(a=>users.isAdmin(u)||users.level(u,a));   // the agents this person may use (owned or shared)
    // side by side, a few at a time (each a config read; it was one after another)
    const out=await Promise.all(ag.map(a=>cfgLimit(async()=>{const c=await readConfig(a).catch(()=>null)||{};return {id:a,name:NAMES[a]||await displayName(a),model:c.model?.default||'',provider:c.model?.provider||''}})));return send(res,200,{agents:out})}
   // Models › AI accounts › If an account fails: each agent's fallback models, as backup-models.mjs keeps them (admins; 1 Nov 2026)
   if(p==='/ui/models/fallbacks'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});const st=await backupModels.status().catch(()=>({agents:[],outages:[]}));return send(res,200,{...st,agents:(st.agents||[]).filter(x=>users.level(u,x.agent))})}   // like /ui/models/agents: not a member's private agent
   // Access: who owns each connection and which agents may use it (see access.mjs). Admins only.
   // asking for access: anyone may see what the other agents have (names only) and ask for it for an agent they use; admins decide
   // Sharing levels (sharing.mjs): per resource (GET ?type&id) and per agent (GET ?agent); admins act as the owner,
   // others may change a share only through an agent they are allowed to manage (its level on the resource decides)
   // Agents › Edit agent › Access (agent-access.mjs): which agents may look after this one, at which level. Admins change it
   // (as the main agent); a person who owns the agent may read it. Never shows a key.
   if(p==='/ui/agent-access'){const ag=String(url.searchParams.get('agent')||'');let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}const t=String(b.agent||ag);
    if(!users.isAdmin(u)&&users.level(u,t)!=='owner')return send(res,403,{error:'Only an admin or the agent\'s owner sees this.'});
    try{await agentAccess.ensure(t);if(req.method==='GET'){const r=await shareLevels.get('agent',t);const all=(await agentNames({copies:false})).filter(x=>x!==t&&x!==agentAccess.MAIN);
      return send(res,200,{agent:t,main:agentAccess.MAIN,owner:r?.owner||t,grants:r?.grants||{},agents:all.map(x=>({id:x,name:NAMES[x]||x})),levels:['manager','editor','viewer','none']})}
     if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});const r=await shareLevels.share('agent',t,{person:u.name||u.email||u.id,admin:true},String(b.to||''),String(b.level||''));console.log('agent access:',t,'->',b.to,b.level);return send(res,200,{ok:true,...r})}
    catch(e){return send(res,e.status||409,{error:e.message})}}
   if(p.startsWith('/ui/sharing')){let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const type=String(b.type||url.searchParams.get('type')||''),rid=String(b.id||url.searchParams.get('id')||''),ag=String(b.as||url.searchParams.get('agent')||'');
    try{if(req.method==='GET'){if(p==='/ui/sharing/audit'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});return send(res,200,{items:await shareLevels.audit({k:type&&rid?type+':'+rid:undefined})})}
      if(ag){if(!users.isAdmin(u)&&!users.level(u,ag))return send(res,403,{error:'This agent is private to its owner.'});return send(res,200,{enabled:await shareLevels.enabled(),items:await shareLevels.forAgent(ag)})}
      if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'});return send(res,200,{enabled:await shareLevels.enabled(),levels:SHARE_LEVELS,resource:type?await shareLevels.get(type,rid):null,items:type?undefined:await shareLevels.list()})}
     if(req.method!=='POST')return send(res,405,{error:'POST only'});
     const actor=users.isAdmin(u)?{person:u.name||u.email||u.id,admin:true}:(ag&&users.level(u,ag)==='owner'?{agent:ag}:null);if(!actor)return send(res,403,{error:'Only an admin, or the person who owns the acting agent, can change sharing.'});
     let r;if(p==='/ui/sharing/share')r=await shareLevels.share(type,rid,actor,String(b.agent||''),String(b.level||''));
     else if(p==='/ui/sharing/revoke')r=await shareLevels.revoke(type,rid,actor,String(b.agent||''));
     else if(p==='/ui/sharing/transfer')r=await shareLevels.transfer(type,rid,actor,String(b.agent||''));
     else if(p==='/ui/sharing/claim'){if(!actor.admin)return send(res,403,{error:'Admins only.'});r=await shareLevels.claim(type,rid,String(b.agent||''),{label:b.label||'',by:'person:'+actor.person})}
     else if(p==='/ui/sharing/enabled'){if(!actor.admin)return send(res,403,{error:'Admins only.'});r=await shareLevels.setEnabled(!!b.on,'person:'+actor.person)}
     else return send(res,404,{error:'Not found'});
     console.log('sharing:',p.split('/').pop(),type+':'+rid,b.agent||'',b.level||'');return send(res,200,{ok:true,...r})}catch(e){return send(res,e.status||409,{error:e.message})}}
   // Abilities › Connected accounts (connected-accounts.mjs): the owner's own logins the agents use; admins only
   if(p.startsWith('/ui/connected-accounts')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can see the logins agents use as the owner.'});let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const id=String(b.id||url.searchParams.get('id')||'');
    try{if(p==='/ui/connected-accounts'&&req.method==='GET')return send(res,200,await connAccounts.list({fresh:url.searchParams.get('fresh')==='1'}));
     if(p==='/ui/connected-accounts/actions'&&req.method==='GET')return send(res,200,await connAccounts.actions(id));
     if(req.method!=='POST')return send(res,405,{error:'POST only'});
     const who=u.name||u.email||'';let r;
     if(p==='/ui/connected-accounts/pause')r=await connAccounts.pause(id,!!b.on,who);
     else if(p==='/ui/connected-accounts/can')r=await connAccounts.setCan(id,b.can);
     else if(p==='/ui/connected-accounts/approve')r=await connAccounts.approve(id,who);
     else if(p==='/ui/connected-accounts/check'){await connAccounts.check(id);r={ok:true}}
     else if(p==='/ui/connected-accounts/disconnect')r=await connAccounts.disconnect(id);
     // Add › A login: the owner adds a login an agent uses as them (until 7 Nov 2026 only an agent's register_account could)
     else if(p==='/ui/connected-accounts/add'){const ag=String(b.agent||'default');if(!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'});
      r=await connAccounts.register(ag,{kind:b.kind,label:b.label,where:b.where,can:b.can,note:b.note},{owner:who});if(r.isError)return send(res,400,{error:r.text})}   // no restart: the engine drops a removed app at its next look
     else return send(res,404,{error:'Not found'});
     console.log('connected accounts:',p.split('/').pop(),id,'by',who);return send(res,200,{ok:true,...r})}catch(e){return send(res,409,{error:e.message})}}
   // Abilities › Connections (connections.mjs): everyone sees the agents they may use; changes are checked per row and agent
   if(p.startsWith('/ui/connections')){const perm={admin:users.isAdmin(u),level:a=>users.level(u,a),canOn:(cap,a)=>users.canOn(u,cap,a)};let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const key=String(b.key||url.searchParams.get('key')||''),agent=String(b.agent||'');
    try{if(p==='/ui/connections'&&req.method==='GET')return send(res,200,await keysId.decorate(await labels.applyRows(await connections.list(perm,{fresh:url.searchParams.get('fresh')==='1'}))));
     if(p==='/ui/connections/detail'&&req.method==='GET')return send(res,200,await keysId.decorate(await labels.applyRows(await connections.detail(key,perm))));
     if(req.method!=='POST')return send(res,405,{error:'POST only'});if(!key)return send(res,400,{error:'Which connection?'});
     if(p!=='/ui/connections/disconnect'&&!(await listAgents()).includes(agent))return send(res,400,{error:'Unknown agent'});let r;
     if(p==='/ui/connections/level')r=await connections.setLevel(key,agent,String(b.level||''),perm);
     else if(p==='/ui/connections/add')r=await connections.add(key,agent,perm);
     else if(p==='/ui/connections/remove')r=await connections.remove(key,agent,perm);
     else if(p==='/ui/connections/owner')r=await connections.setOwner(key,agent,perm);
     else if(p==='/ui/connections/disconnect')r=await connections.disconnect(key,perm);
     else return send(res,404,{error:'Not found'});
     console.log('connections:',p.split('/').pop(),key,agent,b.level||'','by',u.name||u.email||u.id);return send(res,200,{ok:true,...r})}catch(e){return send(res,e.status||409,{error:e.message})}}
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
    return send(res,200,{checked:signinsAt,items:await Promise.all([...signinsDue.values()].map(async x=>{const it=l.items.find(y=>y.id===x.name);
     const siblings=await Promise.all((x.siblings||[]).map(async s=>({...s,account:await whyOf.accountOf(x.agent,s.name)})));
     return {...x,account:x.account||await whyOf.accountOf(x.agent,x.name),siblings,others:(it?.users||[]).filter(u2=>u2.signed&&u2.id!==x.agent).map(u2=>({id:u2.id,name:u2.name}))}}))})}
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
     if(done.length){console.log('connected app',name,'from',from,'now also on',done.join(', '),'(applied by the engine itself, no restart)');for(const a of to)await optins.setApp(a,name,true).catch(()=>{})}
     return send(res,200,{ok:true,agents:done})}}
   if(p==='/ui/mcp/start-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),tool=String(b.name||'');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'});
    // who started it: an admin's own sign-in is never asked about as an unknown login (connected-accounts.mjs ownerMade)
    await whyOf.noteApp(ag,tool,{by:'person',admin:users.isAdmin(u),who:u.name||u.username||''}).catch(()=>{});
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
   if(p==='/ui/channels'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can see every channel.'});return send(res,200,await channelList(url.searchParams.has('fresh')))}
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
   // approve a person on one of an agent's channels before they message it (admins, or members who may edit that agent)
   if(p==='/ui/channels/approve-person'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const ag=String(b.agent||''),pf=String(b.platform||''),base=ag.split('--')[0];
    if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent.'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'You can only add people to agents you may edit.'});
    if(!PERSON_HELP[pf])return send(res,400,{error:'Adding people by hand works for WhatsApp, Telegram, Slack, Discord and email.'});
    const pl=await platformsCached(ag).catch(()=>null);const c=(pl?.platforms||pl||[]).find?.(x=>x.id===pf);if(!c||!(c.configured||c.state==='connected'||c.paused))return send(res,400,{error:(NAMES[base]||base)+' has no '+PERSON_HELP[pf]+' connected.'});
    let id;try{id=personId(pf,b.id)}catch(e){return send(res,400,{error:e.message})}
    const name=String(b.name||'').trim().slice(0,80),note=String(b.note||'').trim().slice(0,140);if(!name)return send(res,400,{error:'Give their name, so everyone knows who it is.'});
    const pr=await fetch(DASH.origin+'/api/pairing?profile='+encodeURIComponent(ag),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(20000)}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(!pr)return send(res,502,{error:'The engine did not answer, so nobody was added. Try again in a moment.'});
    const dup=(pr.approved||[]).find(x=>x.platform===pf&&samePerson(pf,x.user_id,id));if(dup)return send(res,409,{error:(dup.user_name||id)+' is already approved on this '+PERSON_HELP[pf]+'.'});
    let how;try{how=await approvePerson(ag,pf,id,name)}catch(e){return send(res,500,{error:e.message})}
    await editAdded(all=>{all[ag+'|'+pf+'|'+id]={by:u.name||u.id,name,note,t:Date.now()}}).catch(e=>console.warn('approvals added: the mark was not saved:',e.message));
    console.log('approved by hand on',ag,pf,'('+how+') by',u.name||u.id);return send(res,200,{ok:true,id})}
   /* Who can message (1-2 Nov 2026): read straight from the agent's own .env, config.yaml, pairing store and WhatsApp
      lid-mapping files, never from the 10-minute platforms cache (allowlist.mjs decides; it matches the engine and the
      WhatsApp bridge). GET: per channel the people who may message (one row per person, every alias; groups apart) and
      what strangers get; the list for every channel. POST remove-person: one person (or "*", or clear:true for one whole
      list) off the lists the row stands for and out of the approvals, then everything read again.
      Writing touches only the agent asked about, never another's files:
      - a list: under the engine's own .env lock (editEnv) and in the same in-app queue as the WhatsApp loop guard, worked
        out from the file as it is then; the engine is then told that value for this profile (PUT without `enabled`, so a
        paused channel stays paused), which makes a named agent's gateway apply it at once. The main agent's gateway keeps
        its old list in memory until the agents restart, and the answer says so.
      - an approval: in this agent's own pairing store, under the store's own lock (its folder's .lock), never through the
        engine's revoke: that also rewrites the dashboard's own scope, the MAIN agent's .env, whatever profile was asked.
      For an agent other than the main one the check afterwards also proves the main agent's .env did not change. */
   if((p==='/ui/channels/who'&&req.method==='GET')||(p==='/ui/channels/remove-person'&&req.method==='POST')){const post_=req.method==='POST';let b={};if(post_){try{b=JSON.parse(await readBody(req,4096))}catch{}}
    const ag=String(post_?b.agent:url.searchParams.get('agent')||'default'),base=ag.split('--')[0];if(ag.startsWith('.')||!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent.'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'You can only see and change who may message agents you may edit.'});
    const home=ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),envF=path.join(home,'.env'),hh={'x-hermes-session-token':DASH_TOKEN},pdir=pairingDir(home);
    // the store's own approvals ({platform}-approved.json); the engine's /api/pairing would add the .env entries again
    const approvals=async()=>{const out=[];for(const n of await readdir(pdir).catch(()=>[])){const m=/^(.+)-approved\.json$/.exec(n);if(!m)continue;let d={};try{d=JSON.parse(await readFile(path.join(pdir,n),'utf8'))}catch{continue}
     for(const [uid,v] of Object.entries(d&&typeof d==='object'?d:{}))out.push({platform:m[1],user_id:uid,user_name:v?.user_name||''})}return out};
    const read=async()=>{const [env,approved,conf]=await Promise.all([readFile(envF,'utf8').catch(()=>'').then(parseEnv),approvals(),readConfig(ag).catch(()=>({}))]);return {env,approved,mapping:waMapping(home),conf:conf||{}}};
    if(!post_){const st=await read();const pl=await platformsCached(ag).catch(()=>null);
     const on=(pl?.platforms||pl||[]).filter?.(c=>(c.configured||c.state==='connected'||c.paused)&&!['api_server','webhook'].includes(c.id)).map(c=>c.id)||[];
     const ids=[...new Set([...on,...st.approved.map(x=>x.platform),...Object.keys(st.env).map(k=>/^([A-Z0-9]+)_ALLOWED_USERS$/.exec(k)?.[1]).filter(x=>x&&x!=='GATEWAY').map(x=>x==='QQ'?'qqbot':x.toLowerCase())])];
     return send(res,200,{agent:ag,channels:ids.map(pf=>channelWho(st.env,pf,st.approved,st.mapping,st.conf)),global:globalWho(st.env,st.mapping,st.conf)})}
    const pf=String(b.platform||''),id=String(b.id??''),every=!!b.every,clear=b.clear===true;if(!/^[a-z0-9_]{1,40}$/.test(pf)&&!every)return send(res,400,{error:'Unknown channel.'});
    const io={read,
     setList:(k,fn)=>envQueue(envF,async()=>{let val=null;const changed=await editEnv(envF,t=>setEnvLine(t,k,old=>{const v=fn(old??'');val=v;return v}));if(!changed)return {changed:false,hot:true};
      // tell the engine for this profile (this channel's own list only; the list for every channel is read at its start)
      const kp=/^([A-Z0-9]+)_ALLOWED_USERS$/.exec(k)?.[1];if(!kp||kp==='GATEWAY')return {changed:true,hot:false};
      const r=await fetch(DASH.origin+'/api/messaging/platforms/'+encodeURIComponent(kp==='QQ'?'qqbot':kp.toLowerCase())+'?profile='+encodeURIComponent(ag),{method:'PUT',headers:{...hh,'content-type':'application/json'},body:JSON.stringify(engineChange(k,val)),signal:AbortSignal.timeout(30000)}).catch(()=>null);
      return {changed:true,hot:!!(r?.ok&&(await r.json().catch(()=>({}))).hot_served)}}),
     revoke:(platform,ids)=>envQueue(envF,()=>withFlock(path.join(pdir,'.lock'),async()=>{const f=path.join(pdir,platform+'-approved.json');let d;try{d=JSON.parse(await readFile(f,'utf8'))}catch(e){if(e.code==='ENOENT')return;throw new Error('The approved list for '+platform+' could not be read, so it was left as it is.')}
      const {data,gone}=approvedWithout(d,platform,ids,waMapping(home));if(!gone.length)return;const t=f+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(data,null,2),{mode:0o600});await rename(t,f)},10)),
     ...(ag==='default'?{}:{mainEnv:()=>readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'')})};
    let out;try{out=await removePerson(io,{pf,id,every,clear})}catch(e){platCache.delete(ag);return send(res,e.status||500,{error:e.message})}
    if(id&&id!=='*'){const mp=waMapping(home);await editAdded(all=>{let ch=false;for(const k2 of Object.keys(all)){const [a2,p2,...r2]=k2.split('|');if(a2===ag&&(every||p2===pf)&&samePerson(p2,r2.join('|'),id,mp)){delete all[k2];ch=true}}return ch?undefined:false}).catch(()=>{})}
    platCache.delete(ag);console.log('who can message:',u.name||u.id,'removed',clear?'(the whole list)':id,'from',ag,every?'every channel':pf,out.still?'(still there: '+out.why.join(', ')+')':'');
    return send(res,200,{ok:!out.still,...out,main:ag==='default'})}
   if(p==='/ui/channels/approvals-added'&&req.method==='GET'){const all=await readFile(ADDED_FILE,'utf8').then(JSON.parse).catch(()=>({}));if(users.isAdmin(u))return send(res,200,all);
    // only the agents they may edit, as for adding someone (who added whom is not for everyone who can chat with it)
    const out={};for(const [k,v] of Object.entries(all)){const a=k.split('|')[0].split('--')[0];if(users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null)out[k]=v}return send(res,200,out)}
   // Remove access on a person added by hand: the engine's revoke runs from the page; this forgets the mark
   if(p==='/ui/channels/approve-person/forget'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||''),base=ag.split('--')[0];
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)!==null)return send(res,403,{error:'Not your agent.'});
    const k=ag+'|'+String(b.platform||'')+'|'+String(b.id||'');try{await editAdded(all=>{if(!all[k])return false;delete all[k]})}catch(e){return send(res,500,{error:'The mark could not be removed: '+e.message})}return send(res,200,{ok:true})}
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
    // a paused one goes too: its Paused row has nothing left to resume
    const unpause=async()=>{const ps=await pausedLoad();if(ps[ag+'|whatsapp']){delete ps[ag+'|whatsapp'];await pausedSave(ps)}};
    if(ag.includes('--')){await links.remove(ag).catch(()=>{});await unpause();platCache.clear();attention.t=0;return send(res,200,{ok:true,removed:'extra'})}
    // switched off first, and only when the engine says so is the login set aside
    const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
    const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{WHATSAPP_ENABLED:'false'},profile:ag})}).catch(e=>({ok:false,json:async()=>({detail:e.message})}));const j=await r.json().catch(()=>({}));
    if(!r.ok)return send(res,400,{error:j.detail||j.error||'The engine did not accept it, so nothing was removed.'});
    await stopBridges(ag);const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    if(await stat(dir).then(()=>true,()=>false))await rename(dir,dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-')).catch(()=>{});
    await unpause();platCache.clear();attention.t=0;if(!j.hot_served&&ag==='default')restartGateway('WhatsApp removed from '+ag).catch(()=>{});console.log('whatsapp removed from',ag);return send(res,200,{ok:true})}
   if((p==='/ui/channels/whatsapp/prepare'||p==='/ui/channels/whatsapp-reset')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}waLinking.set(String(b.agent||'default'),Date.now());
    const ag=String(b.agent||'default');if(!(await listAllProfiles()).includes(ag))return send(res,400,{error:'Unknown agent'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'You can only link channels of agents you may edit.'});
    const home=ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),dir=path.join(home,'platforms','whatsapp','session');
    platCache.delete(ag);const pl=await platformsCached(ag).catch(()=>null);const w=(pl?.platforms||pl||[]).find?.(x=>x.id==='whatsapp');
    // a working link is never thrown away by accident: replacing it (another phone) has to be asked for
    if(w?.state==='connected'&&!b.replace)return send(res,409,{error:'This WhatsApp is connected'+(w.account?.phone?' ('+w.account.phone+')':'')+'. To link a different phone, choose “Link a different phone”.',connected:true,account:w.account||null});
    // a login that is only starting or reconnecting is not set aside unless the person asked to replace it
    const busy=w&&/retrying|reconnecting|connecting|starting/.test(w.state||'');
    if(busy&&!w.needs_link&&!b.replace)return send(res,409,{error:'This WhatsApp is reconnecting with its saved login'+(w.account?.phone?' ('+w.account.phone+')':'')+'. Give it a minute. To link a different phone, choose “Link a different phone”.',connected:true,account:w.account||null});
    // the engine still retrying the old login would fight the new QR on the same files: switch it off first (and back on if the QR is not used)
    let switchedOff=false;if(busy){const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
     const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:false,env:{},profile:ag})}).catch(()=>null);const j=await r?.json().catch(()=>({}))||{};
     if(r?.ok){switchedOff=true;if(!j.hot_served)await restartGateway('stopping WhatsApp retries on '+ag+' before linking')}}
    const stopped=await stopBridges(ag);
    let kept=null;if(await stat(dir).then(()=>true,()=>false)){const keep=dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-');kept=path.basename(keep);await rename(dir,keep).catch(async()=>{const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true})});
     const parent=path.dirname(dir);const old=(await readdir(parent).catch(()=>[])).filter(n=>n.startsWith('session.unlinked-')).sort().reverse().slice(2);   // keep the last two ended logins only
     const {rm}=await import('node:fs/promises');for(const o of old)await rm(path.join(parent,o),{recursive:true,force:true}).catch(()=>{})}
    if(switchedOff)waPrepOff.set(ag,kept||'');else waPrepOff.delete(ag);
    platCache.clear();console.log('whatsapp: cleared the ended login of',ag,stopped?'(stopped '+stopped+' bridge)':'');return send(res,200,{ok:true,was:w?.account||null,kept})}
   // the QR window closed before a phone was linked: the ended login goes back, so the channel still shows (Logged out · Link again)
   if(p==='/ui/channels/whatsapp/restore'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),kept=String(b.kept||'');
    if(!(await listAllProfiles()).includes(ag)||!/^session\.unlinked-[\w-]+$/.test(kept))return send(res,400,{error:'Nothing to restore'});
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag.split('--')[0]+'/soul','PUT',new URLSearchParams(),ag.split('--')[0])!==null)return send(res,403,{error:'Not your agent.'});
    const dir=path.join(ag==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',ag),'platforms','whatsapp','session');
    const keptDir=path.join(path.dirname(dir),kept);if(!await stat(keptDir).then(x=>x.isDirectory(),()=>false))return send(res,200,{ok:true,restored:false});
    // prepare switched it off to make room for the QR: the old login goes back on as it was
    const backOn=async()=>{if(waPrepOff.get(ag)!==kept)return;waPrepOff.delete(ag);const h={'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'};
     const r=await fetch(DASH.origin+'/api/messaging/platforms/whatsapp?profile='+encodeURIComponent(ag),{method:'PUT',headers:h,body:JSON.stringify({enabled:true,env:{},profile:ag})}).catch(()=>null);const j=await r?.json().catch(()=>({}))||{};
     if(!r?.ok)console.warn('whatsapp: could not switch',ag,'back on after a cancelled link:',j.detail||j.error||'no answer');else if(!j.hot_served)restartGateway('WhatsApp back on '+ag+' after a cancelled link').catch(()=>{})};
    // a new phone got linked: kept unless the person cancelled after scanning (force), then that login is set aside (never deleted)
    // and the old one goes back, with every bridge on it stopped first so nothing keeps writing to it
    if(await stat(path.join(dir,'creds.json')).then(()=>true,()=>false)){if(b.force!==true)return send(res,200,{ok:true,restored:false});
     await stopBridges(ag);const aside=dir+'.unlinked-'+new Date().toISOString().replace(/[:.]/g,'-')+'-cancelled';
     try{await rename(dir,aside)}catch(e){return send(res,500,{error:'Could not set the new login aside: '+e.message})}
     try{await rename(keptDir,dir)}catch(e){await rename(aside,dir).catch(()=>{});return send(res,500,{error:'Could not put the old login back: '+e.message})}
     await backOn();platCache.clear();attention.t=0;console.log('whatsapp: cancelled after scanning on',ag,'- new login set aside, old one back');return send(res,200,{ok:true,restored:true,setAside:path.basename(aside)})}
    await stopBridges(ag,{pairOnly:true});const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true,force:true});await rename(keptDir,dir).catch(()=>{});await backOn();platCache.clear();return send(res,200,{ok:true,restored:true})}
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
   // only the schedules this person may see in the list (the same rule as the cron list: users.schedOk), admins included
   if(p==='/ui/schedules/info'&&req.method==='GET'){try{const d0=await schedules.info();const d={...d0,meta:{...d0.meta},runs:{...d0.runs},names:{...d0.names}};const ok=a=>users.schedOk(u,a);
    for(const k of Object.keys(d.meta))if(!ok(k.split('|')[0]))delete d.meta[k];for(const k of Object.keys(d.runs))if(!ok(k.split('|')[0]))delete d.runs[k];
    // a member sees only the folders their schedules are in, and keeps their own open and shut folders (in the browser)
    if(!users.isAdmin(u)){d.names={};const f=new Set(Object.values(d.meta).map(m=>m.folder).filter(Boolean));d.folders=d.folders.filter(x=>f.has(x));d.order=d.order.filter(x=>f.has(x));d.colors=Object.fromEntries(Object.entries(d.colors).filter(([x])=>f.has(x)));d.folds={}}
    return send(res,200,d)}catch(e){return send(res,500,{error:e.message})}}
   if(p==='/ui/schedules/detail'&&req.method==='GET'){const a=url.searchParams.get('profile')||'default';if(!users.schedOk(u,a))return send(res,403,{error:'Not your agent'});
    try{return send(res,200,await schedules.detail(a,url.searchParams.get('id')||''))}catch(e){return send(res,404,{error:e.message})}}
   if(p==='/ui/schedules/meta'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const a=String(b.profile||'default');if(!users.isAdmin(u)&&users.gate(u,'/hapi/cron/jobs','POST',new URLSearchParams('profile='+a),a))return send(res,403,{error:'Not your agent'});
    return send(res,200,await schedules.setMeta(a,String(b.id||''),b))}
   // Run rules (posting-limits.mjs): one run at a time and posting limits per agent; admins change them, anyone who sees its schedules may look
   if(p==='/ui/run-rules'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.schedOk(u,a))return send(res,403,{error:'Not your agent'});
    try{return send(res,200,await postingLimits.view(a))}catch(e){return send(res,500,{error:e.message})}}
   if(p==='/ui/run-rules'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change run rules.'});let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const a=String(b.agent||'');
    if(!await isAgent(a))return send(res,404,{error:'No such agent'});try{const v=await postingLimits.set(a,{serial:b.serial,rules:b.rules});console.log('run rules: '+a+(b.serial!==undefined?' one at a time '+(b.serial?'on':'off'):'')+(b.rules?' limits '+(v.rules.on?'on':'off'):''));return send(res,200,v)}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/schedules/folder'&&req.method==='POST'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can rename folders.'});
   if(p==='/ui/schedules/folder'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}try{return send(res,200,await schedules.folderOp(b))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/job-relays'&&req.method==='GET'){const all=await relay.jobRelays();if(users.isAdmin(u))return send(res,200,all);const out={};for(const [k,v] of Object.entries(all||{})){const a=k.split('|')[0];if(!users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))out[k]=v}return send(res,200,out)}
   // reconnect ONE channel: a second agent's channel is switched off and on by itself (no engine restart);
   // the main agent's channels live in the engine itself, so for those the proper restart is the only way
   // a short note on a channel (what it is for), shown on its row
   if(p==='/ui/channels/note'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=String(b.agent||'')+'|'+String(b.platform||'');const f=path.join(DATA,'channel-notes.json');const all=await readFile(f,'utf8').then(JSON.parse).catch(()=>({}));const v=String(b.note||'').trim().slice(0,120);if(v)all[k]=v;else delete all[k];await writeFile(f,JSON.stringify(all,null,1));platCache.clear();return send(res,200,{ok:true})}
   if(p==='/ui/channels/reconnect'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can reconnect channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const ag=String(b.agent||''),pf=String(b.platform||'');if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf))return send(res,400,{error:'Unknown channel'});
    if((await pausedLoad())[ag+'|'+pf])return send(res,409,{error:'This channel is paused. Pick who answers it under Owned by first.'});
    if(ag==='default'){restartGateway('reconnect '+pf+' (main agent)',{bridges:pf==='whatsapp'}).catch(()=>{});return send(res,200,{ok:true,restarting:true,waiting:await waitingNow()})}
    let j;try{j=await reconnectOne(ag,pf)}catch(e){platCache.clear();return send(res,502,{error:e.message})}platCache.clear();
    console.log('reconnected',pf,'on',ag,j.hot_served?'(live)':'');return send(res,200,{ok:true,restarting:false})}
   if(p==='/ui/channels/pause'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can pause channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    const ag=String(b.agent||''),pf=String(b.platform||'');if(!(await listAllProfiles()).includes(ag)||!/^[a-z0-9_]{1,40}$/.test(pf)||['api_server','webhook'].includes(pf))return send(res,400,{error:'Unknown channel'});
    try{return send(res,200,await setChannelOn(ag,pf,b.on===true))}catch(e){return send(res,400,{error:e.message})}}
   if(p==='/ui/channels/move'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can move channels.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await channels.move(String(b.platform||''),String(b.from||''),String(b.to||'')))}catch(e){return send(res,400,{error:e.message})}}   // the pause, sharing and note follow in channels' moved hook
   // QR codes (WhatsApp linking…): drawn here with the qrcode library that ships with the engine
   if(p==='/ui/qr'&&req.method==='GET'){const d=String(url.searchParams.get('d')||'');if(!d||d.length>2000)return send(res,400,'bad');
    try{const mod=await import(path.join(HERMES_HOME,'hermes-agent','node_modules','qrcode','lib','index.js'));const QR=mod.default||mod;const svg=await QR.toString(d,{type:'svg',margin:1,errorCorrectionLevel:'M',color:{dark:'#0b0c10',light:'#ffffff'}});
     res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(svg)}catch(e){return send(res,500,{error:'QR could not be drawn: '+e.message})}}
   // names and descriptions (labels.mjs): everyone signed in reads them, admins change them; ids never change here
   // which account each key belongs to (keys-identity.mjs): admins only; never a secret, only the account and last 4
   if(p==='/ui/keys/identity'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins see keys.'});return send(res,200,await keysId.list())}
   if(p==='/ui/keys/identity/check'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can check keys.'});let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await keysId.check(String(b.id||'')))}catch(e){return send(res,e.status||500,{error:e.message})}}
   // which skills and plugins are Built in (ship with aqeelOS or the engine); the rest were added on this OS
   if(p==='/ui/skills/builtin'&&req.method==='GET')return send(res,200,await builtins.names());
   if(p==='/ui/skills/builtin'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change this.'});let b={};try{b=JSON.parse(await readBody(req,1024))}catch{}await builtins.setWanted(!!b.install);return send(res,200,b.install?await builtins.install({log:m=>console.log(m),force:true}):{ok:true})}
   if(p==='/ui/labels'&&req.method==='GET')return send(res,200,{labels:await labels.all()});
   if(p==='/ui/labels'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can rename things.'});let b={};try{b=JSON.parse(await readBody(req,8192))}catch{return send(res,400,{error:'Bad JSON'})}
    try{const v=await labels.set(String(b.kind||''),String(b.id||''),{name:b.name,description:b.description});console.log('label',b.kind+':'+b.id,'by',u.id||u.name||'?');return send(res,200,{ok:true,label:v})}catch(e){return send(res,e.status||500,{error:e.message})}}
   if(p==='/ui/explain'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,300000))}catch{}const items=(Array.isArray(b.items)?b.items:[]).slice(0,300).map(x=>({id:String(x?.id||'').slice(0,120),name:String(x?.name||'').slice(0,160),desc:String(x?.desc||'').slice(0,600)}));return send(res,200,await explain.get(String(b.kind||''),items,{write:users.isAdmin(u)}))}
   if(p==='/ui/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const ag=String(url.searchParams.get('agent')||''),every=[...await listAllProfiles(),HELP_AGENT];   // Help's chats are each person's: its own line on Usage
    const all=await usage.breakdown(ag&&ag!=='all'?every.filter(x=>x===ag||x.startsWith(ag+'--')):every,days,users.ownerOf);
    const people=Object.fromEntries(users.people().map(x=>[x.id,{...users.face(x),name:x.name,limit:users.limitOf(x)||null}]));   // the limit that applies (a role's too), not only one set on the person
    if(!users.isAdmin(u))return send(res,200,{days,byPerson:{[u.id]:all.byPerson[u.id]||null},people:{[u.id]:people[u.id]},today:await usage.today(await listAllProfiles(),u.id,users.ownerOf)});
    return send(res,200,{...all,people})}
   // the suggestions an empty chat starts with, for this install (admins write them on System › Branding)
   if(p==='/ui/starters/defaults'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});if(req.method==='GET')return send(res,200,await starters.defaults());
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}return send(res,200,await starters.setDefaults(b))}
   if(p==='/ui/starters'){const agent=url.searchParams.get('agent')||'default';if(users.gate(u,'/ui/screens/'+agent,'GET',new URLSearchParams(),agent))return send(res,403,{error:'That agent is not shared with you.'});
    let recent=[];try{const r=await fetch(`${DASH.origin}/api/sessions?limit=60${agent==='default'?'':'&profile='+encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':DASH_TOKEN}});recent=users.filter(u,'/hapi/sessions',await r.json()).sessions||[]}catch{}
    return send(res,200,await starters.get(u.id,users.isAdmin(u)?'admin':'member',agent,recent))}
   // a member finishing the setup of an agent they own (New agent, Finish setup): the same steps the app runs for it
   if(p==='/ui/accounts/setup-agent'&&req.method==='POST'&&!users.isAdmin(u)){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=String(b.name||'');
    if(users.level(u,n)!=='owner')return send(res,403,{error:'Only the owner of this agent can finish its setup.'});
    return accountsApi(req,res,p,send,async()=>JSON.stringify({name:n}),a=>users.level(u,a)==='owner')}
   const no=users.gate(u,p,req.method,url.searchParams,'default');if(no)return send(res,no.status,{error:no.error});
   // connecting, reconnecting, renaming and removing a model account, its priority and switching: admins only, every
   // route the same way (25 Oct; before, adding a Claude account and sending its code were open to any signed-in admin
   // check that passed the gate, while Google checked inside its own handler). Reading the list stays as the gate says.
   if((p.startsWith('/ui/accounts/old-code')||/^\/ui\/accounts\/[a-z0-9-]+\/login$/.test(p)||p.startsWith('/ui/accounts')&&req.method!=='GET')&&!users.isAdmin(u))return send(res,403,{error:'Only admins can change model accounts.'});
   if(p.startsWith('/ui/connect/')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change model accounts.'});return connect.handle(req,res,p,send,readBody)}
   if(p.startsWith('/ui/accounts'))return accountsApi(req,res,p,send,readBody,a=>!!users.level(u,a));
   if(p==='/ui/logo')return logo(req,res);
   return identities(req,res,p,u);
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
 // the engine console: admins only, signed in on this site, for one agent
 if(p==='/ui/console/ws'){const ag=new URL(req.url,'http://x').searchParams.get('agent')||'default';if(!validCookie(req)||!sameOrigin(req)||!/^[\w-]{1,64}$/.test(ag)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  me(req).then(u=>{if(!u||!users.isAdmin(u)||users.gate(u,'/hapi/status','GET',new URLSearchParams({profile:ag}),ag)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}return engineConsole.upgrade(req,sock,headBuf,{agent:ag,user:u.name||u.id})}).catch(()=>sock.destroy());return}
 // a plugin's live connection (the Task board's event stream among them): see plugin-host.mjs
 if(p.startsWith('/hapi/plugins/')||p.startsWith('/ui/plugin-api/')){plugins.upgrade(req,sock,headBuf);return}
 if(p!=='/screen/websockify'||!validCookie(req)||!sameOrigin(req)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
 const agent=new URL(req.url,'http://x').searchParams.get('agent');
 me(req).then(u=>{if(!u||users.gate(u,'/ui/screens/'+(agent||'default'),'GET',new URLSearchParams(),agent||'default')){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  // screen=ads: the old shared :99 screen, no longer offered in the app (each agent has its own AdsPower); admins only
  const ads=new URL(req.url,'http://x').searchParams.get('screen')==='ads';if(ads&&!users.isAdmin(u)){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  return screens.upgrade(req,sock,headBuf,ads?null:agent,users.isAdmin(u))}).catch(()=>sock.destroy());
});
server.listen(PORT,HOST,()=>console.log(`aqeelOS on http://${HOST}:${PORT} → dashboard ${DASH.origin}, gateway ${GATE.origin}`));
// Skills and Schedules show at once from the first visit: their slow engine answers are asked for once, one agent at a time
setTimeout(async()=>{schedules.info().catch(()=>{});try{for(const a of await listAgents())await skillsCached(a).catch(()=>{})}catch{}},3000).unref();

process.on('unhandledRejection',e=>console.error('unhandled:',e?.stack||e));process.on('uncaughtException',e=>console.error('uncaught:',e?.stack||e));
