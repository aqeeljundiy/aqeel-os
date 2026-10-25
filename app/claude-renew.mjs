// Claude sign-ins stay signed in (25 Oct 2026, issue #9): aqeelOS renews every Claude login itself, a while before
// it runs out, holding the locks of BOTH other renewers, so neither of them ever needs to renew it.
//
// Why the box got signed out (seen 05:41 UTC 24 Oct, expiresAt 0): a Claude login is a short access token plus a
// refresh token that works ONCE (each renewal hands back a new pair). Two programs renew the same file,
// <config folder>/.credentials.json, and each guards it with its own lock that the other never looks at:
//   the engine (agent/anthropic_credentials.py _refresh_oauth_token): flock(2) on <folder>/.credentials.lock
//     (hermes_cli/auth.py _auth_store_lock, target_path = the credentials file), renewing once less than 60 s is left;
//   Claude Code 2.1.301 (the engine's Claude plugin and aqeelOS Code run it): proper-lockfile folders made with mkdir,
//     <folder>/.oauth_refresh.lock and the older <real folder path>.lock (stale after 60 s, touched every 5 s),
//     renewing once less than 5 minutes is left.
// So both could take "their" lock at the same moment, both send the same refresh token, the second is refused
// (invalid_grant) and that login is gone. Read on the box, read-only, 25 Oct.
//
// The fix, without touching the engine: renew earlier than either of them (20 minutes before the end) while holding
// all three locks with their own primitives on their own paths: the engine's flock through the `flock` tool (the same
// flock(2) call Python's fcntl.flock makes), and Claude Code's two lock folders the way proper-lockfile makes them.
// Whoever wants to renew while we do waits for us, then reads the file again under its lock and finds a new token
// (both already re-read under their lock and adopt a different, still valid token instead of renewing). And as long
// as this runs, neither ever reaches its own renew point, so they cannot race each other either. The new token is
// written to the only store that holds it on this Linux box: the credentials file (the engine's credential pool
// reads that file again on every load, and there is no Keychain here). It replaces the file in one step (temp file
// and rename), keeping everything else in it (plan, scopes). If aqeelOS is down, the two old renewers work as before.
//
// If a login is lost anyway (Claude marked it with expiresAt 0, or the refresh token is refused although nobody
// renewed it under the locks): within the next minute aqeelOS tries the still-valid copies it knows (logins it saw
// working earlier, kept in memory only, and the account's own .credentials.json.bak-* files); a copy whose refresh
// token still works, or whose access token still answers, is put back. Otherwise the account shows Needs sign-in
// with Reconnect. Tokens are never logged.
import {spawn} from 'node:child_process';
import {readFile,writeFile,rename,mkdir,rmdir,stat,utimes,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const CLIENT_ID='9d1c250a-e61b-44d9-88ed-5944d1962f5e',TOKEN_URL='https://platform.claude.com/v1/oauth/token';
const AHEAD=20*60000,TICK=60000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fp=t=>createHash('sha256').update(String(t)).digest('hex').slice(0,16);
const credsOf=t=>{try{return JSON.parse(t)}catch{return null}};

// the engine's lock: a `flock` child holds flock(2) on the file until its stdin closes (it also lets go if aqeelOS dies)
function flockHold(file,waitS=20){return new Promise((res,rej)=>{let ch,held=false;
 try{ch=spawn('flock',['-x','-w',String(waitS),file,'sh','-c','echo held; exec cat >/dev/null'],{stdio:['pipe','pipe','ignore']})}catch(e){return rej(e)}
 ch.on('error',rej);ch.stdout.on('data',b=>{if(!held&&/held/.test(String(b))){held=true;res(()=>new Promise(r=>{ch.on('close',r);ch.stdin.end()}))}});
 ch.on('close',c=>{if(!held)rej(new Error('the engine is renewing (lock busy, '+c+')'))})})}
// Claude Code's lock: proper-lockfile's folder; one left by a holder that stopped touching it for 60 s is stale
async function dirLock(p,stale=60000){try{await mkdir(p)}catch(e){if(e.code!=='EEXIST')throw e;const s=await stat(p).catch(()=>null);if(s&&Date.now()-s.mtimeMs<stale)return null;
  try{await rmdir(p);await mkdir(p)}catch{return null}}
 const t=setInterval(()=>{const n=new Date();utimes(p,n,n).catch(()=>{})},5000);t.unref?.();return async()=>{clearInterval(t);await rmdir(p).catch(()=>{})}}

export function createClaudeRenew({accounts,busy=()=>false,live=false}){
 const state=new Map(),seen=new Map(),tried=new Set();   // id → {state,since,why}; id → good copies seen (memory only)
 let noFlock=false;
 async function post(body){const r=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/json','user-agent':'axios/1.7.9'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error('Anthropic answered '+r.status+(j.error?' '+j.error:''));e.dead=r.status===400||r.status===401;throw e}if(!j.access_token)throw new Error('Anthropic sent no token');return j}
 const refresh=c=>post({grant_type:'refresh_token',refresh_token:c.refreshToken,client_id:CLIENT_ID,...(Array.isArray(c.scopes)&&c.scopes.length?{scope:c.scopes.join(' ')}:{})});
 const works=async c=>{try{const r=await fetch('https://api.anthropic.com/api/oauth/usage',{headers:{authorization:'Bearer '+c.accessToken,'anthropic-beta':'oauth-2025-04-20','user-agent':'claude-code/2.1.0'},signal:AbortSignal.timeout(15000)});return r.ok}catch{return false}};
 async function write(f,j){const t=f+'.'+process.pid+'.'+Date.now()+'.tmp';await writeFile(t,JSON.stringify(j),{mode:0o600});await rename(t,f)}
 const merged=(j,c,r)=>({...j,claudeAiOauth:{...c,accessToken:r.access_token,refreshToken:r.refresh_token||c.refreshToken,expiresAt:Date.now()+(Number(r.expires_in)||3600)*1000,...(r.scope?{scopes:String(r.scope).split(' ').filter(Boolean)}:{})}});
 // all three locks, then fn(); null when one is busy (the next minute tries again)
 async function locked(dir,fn){if(noFlock)return null;let relE;
  try{relE=await flockHold(path.join(dir,'.credentials.lock'))}catch(e){if(e.code==='ENOENT'){noFlock=true;console.warn('claude renew: no flock tool here, renewing is left to Claude Code and the engine')}return null}
  let relC=null,relL=null;try{for(let i=0;i<5&&!relC;i++){relC=await dirLock(path.join(dir,'.oauth_refresh.lock'));if(!relC)await sleep(1000+Math.random()*1000)}if(!relC)return null;
   relL=await dirLock((await realpath(dir).catch(()=>dir))+'.lock');if(!relL)return null;return await fn()}
  finally{await relL?.();await relC?.();await relE()}}
 // a lost login: the copies we know, newest first, the spent one left out
 async function recover(a,f,j,deadTok){const c0=j?.claudeAiOauth||{};const bak=[];for(const n of (await readdir(a.dir).catch(()=>[])).filter(n=>/^\.credentials\.json\.bak-\d+$/.test(n)))bak.push((credsOf(await readFile(path.join(a.dir,n),'utf8').catch(()=>''))||{}).claudeAiOauth);
  const cands=[...(seen.get(a.id)||[]),...bak].filter(c=>c?.refreshToken&&c.refreshToken!==deadTok&&!tried.has(fp(c.refreshToken))).sort((x,y)=>(+y.expiresAt||0)-(+x.expiresAt||0));
  for(const c of cands){tried.add(fp(c.refreshToken));
   try{const r=await refresh(c);await write(f,merged(j||{},{...c0,...c},r));console.log('claude renew',a.id,'recovered from a still-valid copy');return true}
   catch{if(c.accessToken&&+c.expiresAt>Date.now()+120000&&await works(c)){await write(f,{...(j||{}),claudeAiOauth:{...c0,...c}});console.log('claude renew',a.id,'put back a copy that still works until',new Date(+c.expiresAt).toISOString());return true}}}
  return false}
 async function one(a){if(busy(a.id))return;const f=path.join(a.dir,'.credentials.json');const j=credsOf(await readFile(f,'utf8').catch(()=>''));const c=j?.claudeAiOauth;if(!c?.refreshToken&&!c?.accessToken)return;
  const st=state.get(a.id),exp=Number(c.expiresAt);
  // a new sign-in (Reconnect) clears what we knew about the old one
  if(st&&st.tok!==fp(c.refreshToken||''))state.delete(a.id);
  if(exp>Date.now()){const l=seen.get(a.id)||[];if(!l.some(x=>x.refreshToken===c.refreshToken))seen.set(a.id,[{...c},...l].slice(0,3))}
  if(state.get(a.id)?.state==='out')return;   // already tried everything for this login: waits for Reconnect
  const lost=!(exp>0);if(!lost&&exp-Date.now()>AHEAD)return;
  const r=await locked(a.dir,async()=>{const j2=credsOf(await readFile(f,'utf8').catch(()=>''));const c2=j2?.claudeAiOauth||{};const e2=Number(c2.expiresAt);
   if(e2>0&&e2-Date.now()>AHEAD)return 'fresh';   // someone renewed it meanwhile
   if(e2>0&&c2.refreshToken){try{const t=await refresh(c2);await write(f,merged(j2,c2,t));return 'renewed'}catch(e){if(!e.dead)return 'later';console.warn('claude renew',a.id,'refresh token refused:',e.message)}}
   return await recover(a,f,j2,c2.refreshToken)?'recovered':'out'});
  if(r==='renewed'||r==='recovered'){state.delete(a.id);if(r==='renewed')console.log('claude renew',a.id,'renewed')}
  else if(r==='out'){state.set(a.id,{state:'out',since:Date.now(),tok:fp(c.refreshToken||''),why:'This sign-in stopped working. Reconnect it.'});console.warn('claude renew',a.id,'needs sign-in')}}
 let running=false;
 async function tick(){if(running)return;running=true;try{for(const a of await accounts())await one(a).catch(e=>console.warn('claude renew',a.id,e.message))}finally{running=false}}
 if(live){setInterval(()=>tick().catch(()=>{}),TICK).unref();setTimeout(()=>tick().catch(()=>{}),10000).unref()}
 return {tick,out:id=>state.get(id)?.state==='out'?state.get(id):null}}
