// "The AI provider is not available": one shared answer to "is this agent answer or engine error only a rate limit, a used-up
// account, a revoked sign-in or no model reachable?" (12 Nov 2026, server audit). Such a result says nothing about the thing
// that was being checked, so it is INCONCLUSIVE: auto-rollback does not undo anything, the fixer's proof and fix runs and the
// deploy live test do not count it as a failure, and everything is tried again after the account's reset time if it is known.
// Before this, one used-up Claude account on one box undid good changes on 6 agents and opened "Automatic rollback" issues,
// Elkiya started 372 proof runs in a day, and agents moved 148 times between accounts that were all used up.
// The strings are the real ones from the two servers' logs and agent answers (errors.log, ui.log, issues.json):
//   "You've hit your session limit · resets 6pm (UTC)"            (Claude subscription, HTTP 429)
//   "I couldn't reach any of my models just now (Claude and GPT)" / "(Claude, Gemini and GPT)"   (the agent's own answer)
//   "I couldn't connect to the AI model service, so this message wasn't processed"   (the agent's answer, live test)
//   "Antigravity: Individual quota reached. Please upgrade your subscription"
//   "HTTP 429: Incomplete upstream response (... upstream rate-limited 1 consecutive request(s) ...)"
//   "credential pool: marking device_code DEAD (status=401, reason=token_revoked)", "credential pool is exhausted",
//   "every entry in cooldown", "auth error on auto and all fallbacks exhausted", "refused for billing/credits"
import {readFileSync} from 'node:fs';
import {writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

// kind: limit (rate limit, session or weekly use used up), quota (a plan's quota), unreachable (no model answered), auth (sign-in revoked), billing (no credit)
const STRONG=[
 ['limit',/hit your (?:session|weekly|week|usage|5[- ]?hour|monthly) limit/i],
 ['unreachable',/couldn'?t reach any of my models/i],
 ['unreachable',/couldn'?t connect to the AI model service/i],
 ['quota',/individual quota reached/i],
 ['limit',/upstream rate-limited \d+ consecutive request/i]];
const LOOSE=[
 ['limit',/\bHTTP 429\b|status:? 429\b|\b429 Too Many Requests\b/i],
 ['limit',/rate[- ]?limit(?:ed)?\b.{0,40}(?:try again|retry|exceeded|reached|all fallbacks)|(?:try again|retry).{0,40}rate[- ]?limit/i],
 ['limit',/\b(?:usage|session|weekly) limit (?:reached|exceeded)\b|resets \d{1,2}(?::\d\d)? ?(?:am|pm)\b/i],
 ['quota',/\bquota (?:reached|exceeded|exhausted)\b|insufficient[_ ]quota/i],
 ['unreachable',/credential pool is exhausted|every entry in cooldown|all fallbacks exhausted|no (?:model|provider)s? (?:is |are )?available/i],
 ['unreachable',/overloaded_error|\bAnthropic is overloaded\b/i],
 ['auth',/token_revoked|token has been revoked|will NOT re-enter rotation/i],
 ['billing',/refused for billing\/credits|credit balance is too low|out of credit/i]];

const MINUTE=60e3,fmtCache=new Map();
const parts=(t,tz)=>{let f=fmtCache.get(tz);if(!f){try{f=new Intl.DateTimeFormat('en-GB',{timeZone:tz||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}catch{f=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}fmtCache.set(tz,f)}
 const o={};for(const p of f.formatToParts(new Date(t)))o[p.type]=p.value;return [+o.hour,+o.minute]};
// the next time the clock of a time zone shows hh:mm (strictly after now, at most 25 hours ahead)
export function nextClock(hh,mm,tz,now=Date.now()){let t=now-(now%MINUTE)+MINUTE;for(let k=0;k<25*60+1;k++,t+=MINUTE){const [h,m]=parts(t,tz);if(h===hh&&m===mm)return t}return null}
// when it works again, as far as the text says: "resets 6pm (UTC)", "resets at 6:30 PM (Asia/Jakarta)", "retry in 5 minutes", "Retry-After: 120", "until 18:00"
export function resetOf(text,now=Date.now()){const s=String(text||'');let m;
 if(m=/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(am|pm)\s*(?:\(([A-Za-z_/+\-0-9]+)\))?/i.exec(s)){let h=+m[1]%12;if(/pm/i.test(m[3]))h+=12;const tz=/^(utc|gmt|z)$/i.test(m[4]||'')?'UTC':m[4]||'UTC';return nextClock(h,+(m[2]||0),tz,now)}
 if(m=/(?:resets?|until|available again)\s+(?:at\s+)?(\d{1,2}):(\d\d)\s*(?:\(([A-Za-z_/+\-0-9]+)\)|UTC)?/i.exec(s)){const tz=/^(utc|gmt)$/i.test(m[3]||'')||!m[3]?'UTC':m[3];return nextClock(+m[1],+m[2],tz,now)}
 if(m=/retry[- ]after:?\s*(\d+)\b/i.exec(s))return now+Math.min(+m[1],86400)*1000;
 if(m=/(?:try again|retry)\s+in\s+(\d+)\s*(second|sec|minute|min|hour|h)/i.exec(s)){const n=+m[1],u=m[2].toLowerCase();return now+n*(u[0]==='s'?1e3:u[0]==='m'?60e3:3600e3)}
 return null}
// null when the text is not about the provider; else {kind, resetAt (ms or null), why}. strict: only the agent's own wording
// and the provider's own refusals (use it on a result a model wrote, so a report ABOUT rate limits is never taken for one).
export function providerUnavailable(text,{now=Date.now(),strict=false}={}){const s=String(text??'');if(!s.trim())return null;
 for(const [kind,re] of strict?STRONG:[...STRONG,...LOOSE]){const m=re.exec(s);if(m)return {kind,resetAt:resetOf(s,now),why:s.slice(Math.max(0,m.index-20),m.index+m[0].length+80).replace(/\s+/g,' ').trim()}}
 return null}
// when to try again: the reset time if known (never more than `max` away), else `fallback` from now
export const retryAt=(info,{now=Date.now(),fallback=30*60e3,max=3*3600e3,pad=60e3}={})=>info?.resetAt&&info.resetAt>now?Math.min(info.resetAt+pad,now+max):now+fallback;

// the hold another process wrote (DATA/provider-hold.json), for a script that runs outside the app (the deploy live test): the
// hold while it is still in the future, else null. Never throws.
export function readHold(DATA,now=Date.now()){try{const h=JSON.parse(readFileSync(path.join(DATA,'provider-hold.json'),'utf8'));return h&&h.until>now?h:null}catch{return null}}

// what every part of the app shares: while one holds, nothing new is started that needs a model. In memory, kept in
// DATA/provider-hold.json so a restart does not forget it.
export function createLimitState({DATA=null,now=()=>Date.now(),log=()=>{}}={}){
 const FILE=DATA?path.join(DATA,'provider-hold.json'):null;let h=null;
 if(FILE)try{h=JSON.parse(readFileSync(FILE,'utf8'))}catch{}
 const save=()=>{if(!FILE)return;const t=FILE+'.'+process.pid+'.tmp';mkdir(DATA,{recursive:true}).then(()=>writeFile(t,JSON.stringify(h||{})).then(()=>rename(t,FILE))).catch(()=>{})};
 const hold=()=>h&&h.until>now()?h:null;
 const api={hold,until:()=>hold()?.until||0,
  set(until,why='',kind='limit'){if(!(until>now()))return null;if(hold()&&hold().until>=until)return hold();const was=!!hold();h={until,why:String(why).slice(0,200),kind,since:was?h.since:now()};save();if(!was)log('provider: unavailable until '+new Date(until).toISOString()+' ('+h.why+')');return h},
  // text is an answer or error from a model call: a limit sets the hold (returns the info), anything else returns null
  note(text,opts={}){const i=providerUnavailable(text,{now:now(),...opts});if(!i)return null;api.set(retryAt(i,{now:now()}),i.why,i.kind);return i},
  clear(){if(h){h=null;save()}}};
 return api}
