// Per-ACCOUNT sign-in limit (BACKLOG AUD-15, 13 Nov 2026). The per-address limit (server.mjs "attempts") is not enough: behind Cloudflare or any
// proxy many people share an address, and an attacker can rotate addresses against one account. So every try to sign in or to prove a secret
// is also counted against the ACCOUNT, whatever address it comes from.
//
// What is counted (a "key" is "<kind>:<account id>"; a name that belongs to nobody is keyed by a hash of the normalised name, so it behaves the same)
//   pw       a password: /auth/login, and "your current password" in Settings (change password, email, two-step, recovery code)
//   login    the two-step code after the password (/auth/code)         verify   the code that confirms an email address
//   recover  the owner's recovery code                                   reset    "forgot password" requests (the mail is simply not sent again)
//   resettok a reset-link token that matched nothing (/auth/reset)     invite   an invite code that matched nothing (/auth/accept)
//   resettok and invite belong to no account yet, so they share one bucket each and a much larger free allowance.
// The rule: after FREE (5) wrong tries inside WINDOW (15 min) the account waits 30 s, then 60 s, 120 s ... never more than 15 min. Tries that arrive while
// it waits are not even looked at (the right password gets nothing either) and are answered with the SAME words, status and work as a wrong one, so
// nobody can tell a waiting account from a wrong password, or an account from a made-up name. A right answer clears the count.
// The owner is never locked out by someone else's guessing: a try to SIGN IN (opts.signIn) from a browser that already holds a valid session cookie
// for that same account skips the wait and is not counted (the cookie is signed by this server and was only ever given to someone who knew the
// password). It is never used for "current password" inside a session: a stolen session must still not be able to guess without end.
// State is kept in one file through app/store.mjs, so a restart does not hand the attacker a fresh count. It is bounded (MAX_ENTRIES) and an entry
// disappears once its tries are older than the window and its wait is over. Addresses are kept only as salted hashes, passwords never.
// The owner is told once per account on Health (onLock) with the count and the number of addresses; the callback gets no password and no address.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,createHmac,randomBytes,scryptSync} from 'node:crypto';
import {readStoreSync,saveStore} from './store.mjs';

export const WINDOW_MS=15*60e3,MAX_DELAY_MS=15*60e3,STEP_MS=30e3,MAX_ENTRIES=2000,MAX_FAILS=40,MAX_ADDRS=25;
export const hashName=n=>createHash('sha256').update(String(n||'').trim().toLowerCase().slice(0,200)).digest('hex').slice(0,24);
// the work of one wrong password, spent when nothing was really checked (a locked or unknown account), so the answer takes as long as a wrong one
let burnSalt=null;
export function burn(){burnSalt||=randomBytes(16);scryptSync('burn',burnSalt,64)}
// the request being served (set once per request by server.mjs), so the places that count a try do not each need the address and cookie handed down
const als=new AsyncLocalStorage();
export const withRequest=(req,fn)=>als.run(req,fn);
// the server calls this at the top of each request: that request's own async work sees it, and a later request on the same connection replaces it
export const enterRequest=req=>als.enterWith(req);

export function createSignInGuard({file=null,now=()=>Date.now(),free=5,ipOf=()=>null,deviceOf=()=>null,onLock=()=>{},flushMs=1000}={}){
 let db=file?readStoreSync(file,()=>({v:1,salt:randomBytes(16).toString('hex'),e:{}})):{v:1,salt:randomBytes(16).toString('hex'),e:{}};
 if(!db||typeof db!=='object'||typeof db.e!=='object'||!db.salt){db={v:1,salt:randomBytes(16).toString('hex'),e:{}}}
 const m=db.e;   // key → {fails:[ms], total, until, last, addrs:[hash], told}
 const FREE=Math.max(1,free);
 const freeFor=key=>/^(resettok|invite):/.test(key)?Math.max(30,FREE):FREE;
 const quiet=v=>now()-v.last>WINDOW_MS&&v.until<=now();
 const sweep=(keep=MAX_ENTRIES)=>{for(const k of Object.keys(m))if(quiet(m[k]))delete m[k];
  const ks=Object.keys(m);if(ks.length>keep)for(const k of ks.sort((a,b)=>m[a].last-m[b].last).slice(0,ks.length-keep))delete m[k]};
 sweep();
 let timer=null,saving=Promise.resolve();
 const save=()=>{if(!file||timer)return;timer=setTimeout(()=>{timer=null;saving=saveStore(file,db,{pretty:0,mode:0o600}).catch(e=>console.warn('signin-guard: not saved:',e.message))},flushMs);timer.unref?.()};
 // for tests and for a clean stop: whatever is pending is written now
 const flush=async()=>{if(timer){clearTimeout(timer);timer=null;if(file)saving=saveStore(file,db,{pretty:0,mode:0o600}).catch(()=>{})}await saving};
 const idOf=key=>key.split(':')[1];
 const kindOf=key=>key.split(':')[0];
 // a sign-in try from a device that already holds a valid session for this very account
 const trusted=(key,o)=>{if(!o?.signIn)return false;const r=als.getStore();if(!r)return false;const d=deviceOf(r);return !!d&&d===idOf(key)};
 const addr=()=>{const r=als.getStore(),ip=r?ipOf(r):null;return ip?createHmac('sha256',db.salt).update(String(ip)).digest('hex').slice(0,12):null};
 // seconds still to wait (0 = go ahead)
 function wait(key,o){const v=m[key];if(!v)return 0;const t=now();if(quiet(v)){delete m[key];save();return 0}
  if(v.until<=t)return 0;if(trusted(key,o))return 0;
  // the try that is turned away is not a guess, but the address it came from is part of "how many addresses"
  const a=addr();if(a&&!v.addrs.includes(a)&&v.addrs.length<MAX_ADDRS){v.addrs.push(a);save()}
  return Math.ceil((v.until-t)/1000)}
 // a wrong try: returns the seconds the account now waits (0 while the free tries last)
 function fail(key,o){if(trusted(key,o))return 0;const t=now();let v=m[key];
  if(!v||quiet(v)){if(!v&&Object.keys(m).length>=MAX_ENTRIES)sweep(Math.floor(MAX_ENTRIES*0.9));v=m[key]={fails:[],total:0,until:0,last:t,addrs:[],told:0}}
  v.fails=v.fails.filter(x=>t-x<WINDOW_MS);v.fails.push(t);if(v.fails.length>MAX_FAILS)v.fails.splice(0,v.fails.length-MAX_FAILS);
  v.total++;v.last=t;const a=addr();if(a&&!v.addrs.includes(a)&&v.addrs.length<MAX_ADDRS)v.addrs.push(a);
  const over=v.fails.length-freeFor(key);v.until=over>=0?t+Math.min(MAX_DELAY_MS,STEP_MS*2**Math.min(over,20)):0;
  // told once when the lock begins; again (same Health item, new numbers) only when the count has doubled
  if(over>=0&&kindOf(key)!=='resettok'&&kindOf(key)!=='invite'&&kindOf(key)!=='reset'&&!/^pw:name:/.test(key)&&(!v.told||v.total>=v.told*2)){v.told=v.total;
   try{Promise.resolve(onLock({kind:kindOf(key),id:idOf(key),count:v.total,addresses:v.addrs.length,windowMin:WINDOW_MS/60e3})).catch(()=>{})}catch{}}
  save();return Math.ceil(Math.max(0,v.until-t)/1000)}
 // a right answer: the count starts over (a trusted device's right answer ends someone else's lock too)
 function ok(key){if(m[key]){delete m[key];save()}}
 return {wait,fail,ok,flush,size:()=>Object.keys(m).length}}
