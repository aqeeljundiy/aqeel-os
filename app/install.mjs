// What differs per install, in one place, so a new owner never edits an env file (7 Nov 2026, plug and play).
// Each value comes from, in order: the environment (still wins, for the reference install and test copies), the
// install's own settings file (<DATA>/install.json, changed in the app on System › Settings), then a neutral default.
//  - engineKeys(): the gateway key and dashboard token, read from the engine's own ~/.hermes/.env when not set;
//  - uiSecret(): the cookie key, made once and kept in <DATA>/ui-secret, so sign-ins survive restarts;
//  - publicUrl() / PUBLIC_URL_REF: "Your address", the https address people and services reach this install at.
//    Every public callback (invites, WhatsApp Business, Kirimdev webhooks, MCP and Google sign-ins) reads it;
//  - isLive(): whether this copy runs the background jobs that change agents (AQEELOS_LIVE; the installer sets 1,
//    test copies 0);
//  - installTz(): the one time zone of the install (schedules, posting limits, backups, notices).
// Other areas import publicUrl() for their callbacks: it always answers the current address.
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,chmodSync,statSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStoreSync,saveStoreSync,storeBad} from './store.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env=process.env;
export const DATA_DIR=path.resolve(env.UI_DATA_DIR||path.join(ROOT,'..','hermes-ui-data'));
const FILE=()=>path.join(DATA_DIR,'install.json');
const HERMES_HOME=()=>(env.HERMES_HOME||path.join(homedir(),'.hermes')).replace(/^~(?=\/|$)/,homedir());
const PORT=()=>Number(env.UI_PORT)||4400;

/* ---------- the settings file ---------- */
// Through app/store.mjs (12 Nov 2026): a file that exists but cannot be read is never taken for an empty one. Before, settings() cached {} on any read
// error and saveSettings({...settings(),...patch}) wrote that over the real file: the address and time zone were gone after one bad read. Now the last
// good copy is used (else nothing), saving is refused with a message that names the file, and a repaired file is read again (nothing stays cached while it is bad).
let cache=null,memId='';
export function settings(){if(cache&&!storeBad(FILE()))return cache;cache=readStoreSync(FILE(),{})||{};
 if(!cache.id){cache.id=memId||=randomBytes(12).toString('base64url');if(!storeBad(FILE())){try{write(cache)}catch{}}}return cache}
function write(o){saveStoreSync(FILE(),o)}
export function saveSettings(patch){const next={...settings()};for(const [k,v] of Object.entries(patch)){if(v===undefined||v===null||v==='')delete next[k];else next[k]=v}
 write(next);cache=next;return next}
export const reloadSettings=()=>{cache=null;return settings()};
// this install's own id: the address check asks the address for it, so it proves the address reaches this very copy
export const installId=()=>settings().id;

/* ---------- the engine's keys ---------- */
export function parseEnvText(t){const o={};for(const line of String(t||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);if(!m)continue;
 let v=m[2];if(/^(["']).*\1$/.test(v))v=v.slice(1,-1);else v=v.replace(/\s+#.*$/,'');o[m[1]]=v}return o}
// API_SERVER_KEY and HERMES_DASHBOARD_SESSION_TOKEN: the environment, else the engine's own .env (where the engine keeps them)
export function engineKeys(e=env,home=HERMES_HOME()){let file={};try{file=parseEnvText(readFileSync(path.join(home,'.env'),'utf8'))}catch{}
 const one=k=>e[k]?{v:e[k],from:'env'}:file[k]?{v:file[k],from:'engine'}:{v:'',from:''};
 const a=one('API_SERVER_KEY'),d=one('HERMES_DASHBOARD_SESSION_TOKEN');
 return {API_SERVER_KEY:a.v,HERMES_DASHBOARD_SESSION_TOKEN:d.v,from:{api:a.from,dash:d.from}}}

// A fresh engine has neither key (it never makes API_SERVER_KEY, and its dashboard token is random on every start
// unless .env sets one), so aqeelOS could not talk to it. Missing ones are written once into the engine's own .env
// (owner-only); the engine uses them from its next start. Returns the names it added.
export function ensureEngineKeys(e=env,home=HERMES_HOME()){const f=path.join(home,'.env');let t='';try{t=readFileSync(f,'utf8')}catch{}
 const have=parseEnvText(t),add=[];
 const want={API_SERVER_ENABLED:'true',API_SERVER_KEY:()=>randomBytes(24).toString('hex'),HERMES_DASHBOARD_SESSION_TOKEN:()=>randomBytes(24).toString('base64url')};
 for(const [k,v] of Object.entries(want))if(!have[k]&&!e[k])add.push(k+'='+(typeof v==='function'?v():v));
 if(!add.length)return [];try{mkdirSync(home,{recursive:true});writeFileSync(f,(t&&!t.endsWith('\n')?t+'\n':t)+'# added by aqeelOS so it can reach the engine (restart the engine once)\n'+add.join('\n')+'\n',{mode:0o600});chmodSync(f,0o600)}catch{return []}
 return add.map(l=>l.split('=')[0])}

/* ---------- the cookie key ---------- */
export function uiSecret(e=env,dir=DATA_DIR){if(e.UI_SECRET)return {secret:e.UI_SECRET,from:'env'};const f=path.join(dir,'ui-secret');
 try{const s=readFileSync(f,'utf8').trim();if(s.length>=32)return {secret:s,from:'file'}}catch{}
 const s=randomBytes(32).toString('hex');try{mkdirSync(dir,{recursive:true});writeFileSync(f,s+'\n',{mode:0o600});chmodSync(f,0o600);return {secret:s,from:'made'}}catch{return {secret:s,from:'memory'}}}

/* ---------- Your address ---------- */
export const cleanUrl=u=>{const s=String(u||'').trim().replace(/\/+$/,'');if(!s)return '';let x;try{x=new URL(s)}catch{throw Error('That is not a web address. It looks like https://ai.example.com')}
 if(!/^https?:$/.test(x.protocol))throw Error('The address starts with https://');if(x.pathname!=='/'||x.search||x.hash)throw Error('Just the address, without a path after it');return x.origin};
export function publicUrl(){return (env.PUBLIC_URL||settings().publicUrl||('http://localhost:'+PORT())).replace(/\/+$/,'')}
export const publicUrlFrom=()=>env.PUBLIC_URL?'env':settings().publicUrl?'setting':'default';
// A value that reads as the current address wherever a plain string was passed before (a+'/x', `${a}`, new URL(a), JSON):
// modules made at start keep working after the owner sets the address, without a restart.
export function urlRef(suffix='',fn=publicUrl){const val=()=>fn()+suffix;return Object.freeze({[Symbol.toPrimitive]:val,toString:val,valueOf:val,toJSON:val})}
export const PUBLIC_URL_REF=urlRef();
export const PUBLIC_HOST_REF=urlRef('',()=>{try{return new URL(publicUrl()).hostname}catch{return 'localhost'}});
// the address a browser used to reach us (behind a proxy: its forwarded host and scheme)
export function originOf(req){const h=req.headers||{};const host=String(h['x-forwarded-host']||h.host||'').split(',')[0].trim();if(!host)return '';
 const proto=String(h['x-forwarded-proto']||'').split(',')[0].trim()||(req.socket?.encrypted?'https':'http');try{return new URL(proto+'://'+host).origin}catch{return ''}}
// does the address reach this very install? It asks the address for /install-ping and compares the id.
export async function checkAddress(url,{fetchImpl=fetch,id=installId(),timeout=8000}={}){let u;try{u=cleanUrl(url)}catch(e){return {ok:false,why:e.message}}if(!u)return {ok:false,why:'Type the address first.'};
 try{const r=await fetchImpl(u+'/install-ping',{signal:AbortSignal.timeout(timeout),redirect:'follow'});if(!r.ok)return {ok:false,url:u,why:'The address answered, but not as this aqeelOS ('+r.status+').'};
  const j=await r.json().catch(()=>({}));if(j.id!==id)return {ok:false,url:u,why:'The address reaches a different aqeelOS.'};
  return {ok:true,url:u,https:u.startsWith('https://'),why:u.startsWith('https://')?'':'It works, but without https. Phones and outside services need https.'}}
 catch(e){return {ok:false,url:u,why:/timeout|abort/i.test(String(e?.name)+e?.message)?'Nothing answered at that address within 8 seconds.':'Nothing answers at that address yet.'}}}
export const localAddress=u=>{try{const h=new URL(u).hostname;return h==='localhost'||h.endsWith('.localhost')||/^(127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(h)||h==='[::1]'}catch{return true}};

/* ---------- live or test copy ---------- */
// AQEELOS_LIVE=1 (the installer's service sets it) or 0 (test copies, local development) decides. Without it, the old
// rule stays so a copy started by hand never changes real agents by surprise: live only on the usual port 4400.
// Not kept in install.json on purpose: test copies start from a copy of the live data.
export function isLive(e=env){const x=String(e.AQEELOS_LIVE??'').trim().toLowerCase();if(/^(1|true|yes|on)$/.test(x))return true;if(/^(0|false|no|off)$/.test(x))return false;
 return (Number(e.UI_PORT)||4400)===4400}
export const liveFrom=(e=env)=>String(e.AQEELOS_LIVE??'').trim()?'env':'port';

/* ---------- one time zone ---------- */
export const validTz=tz=>{if(!tz)return false;try{new Intl.DateTimeFormat('en',{timeZone:tz});return true}catch{return false}};
export const installTz=()=>{const z=settings().timezone;return validTz(z)?z:''};
// the whole process follows it (tz.mjs's sysTz, Date, every Intl format without a zone)
export function applyTz(z=installTz()){if(validTz(z)&&process.env.TZ!==z)process.env.TZ=z;return z}

/* ---------- the other public addresses (Code and published apps) ---------- */
const host=k=>v=>{const s=String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(s&&!/^[a-z0-9.-]+(:\d+)?$/.test(s))throw Error('A host name looks like code.example.com');return s};
export const HOSTS={codeHost:['CODE_HOST','code.localhost'],codePreviewHost:['CODE_PREVIEW_HOST','code-preview.localhost'],liveDomain:['LIVE_DOMAIN','app.localhost']};
export const cleanHost=host();
export const hostSetting=k=>{const [e,d]=HOSTS[k];return env[e]||settings()[k]||d};
export const hostFrom=k=>env[HOSTS[k][0]]?'env':settings()[k]?'setting':'default';

/* ---------- online Code (owner's decision, 12 Nov 2026: coding happens only on people's own computers) ---------- */
// OFF unless this install switched it on: the environment (ONLINE_CODE=1/0) wins, else the install's setting. Off means the server
// runs no Code workspace, answers its addresses with ONLINE_CODE_MSG, hides its settings, and deploys do not install or update
// what only online Code needs (scripts/box-live.sh asks the same rule). Live (published apps) and the agents never depend on it.
export const ONLINE_CODE_MSG='Coding happens on your own computer; publish from the Build app.';
export function onlineCodeRule(e=env,s=settings()){const x=String(e.ONLINE_CODE??'').trim().toLowerCase();if(/^(1|true|yes|on)$/.test(x))return true;if(/^(0|false|no|off)$/.test(x))return false;return s.onlineCode===true}
export const onlineCodeOn=()=>onlineCodeRule();
export const onlineCodeFrom=(e=env)=>String(e.ONLINE_CODE??'').trim()?'env':'setting';
// the box's own start script (~/services.sh, outside this repo) starts the workspace only while this file exists
export function syncOnlineCodeMarker({home=env.AQEELOS_HOME||homedir(),on=onlineCodeOn()}={}){const f=path.join(home,'.aqeelos-online-code');
 try{if(on){writeFileSync(f,'online Code is switched on in aqeelOS (System › Settings)'+String.fromCharCode(10))}else{try{unlinkSync(f)}catch(e){if(e.code!=='ENOENT')throw e}}return on}catch{return null}}

/* ---------- per-agent Linux users (scripts/agent-users.sh, run as root) ---------- */
// The root script beats ~/.aqeelos-agent-users.alive every 30 s while it watches; without a recent beat, agents other
// than the main one have no terminal, files, code or Runs itself of their own.
export function agentUsersState({home=env.AQEELOS_HOME||homedir(),now=Date.now(),statImpl}={}){const st=statImpl||(f=>{try{return statSync(f)}catch{return null}});
 const req=path.join(home,'.aqeelos-agent-users'),alive=st(req+'.alive'),done=st(req+'.done');
 const fresh=alive&&now-alive.mtimeMs<3*60e3;
 // an older watcher (before the beat) that already made users: it works, it just cannot say so
 return {ok:!!fresh||(!alive&&!!done),seen:!!(alive||done),fix:'sudo bash '+path.join(ROOT,'scripts','install.sh')+' --agent-users'}}

/* ---------- the Claude sign-in (Models) ---------- */
export const CLAUDE_PLUGIN='claude-subscription-directsdk-experimental';
export const shippedPlugin=()=>path.join(ROOT,'engine',CLAUDE_PLUGIN);
export function claudeState({bin=env.CLAUDE_BIN||path.join(homedir(),'.local','bin','claude'),hermesHome=HERMES_HOME()}={}){
 return {cli:existsSync(bin),plugin:existsSync(path.join(hermesHome,'plugins',CLAUDE_PLUGIN,'plugin.yaml')),shipped:existsSync(path.join(shippedPlugin(),'plugin.yaml'))}}
