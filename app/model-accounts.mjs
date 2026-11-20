// Every sign-in its own account, whatever the provider (owner, 20 Nov 2026: "if the way we set up Claude is separate accounts
// and we could sort it, then Gemini should act the same, GPT should act the same, or any LLM"). A provider with more than
// one account shows each extra one as its own entry, 'p:<provider>#<account>', next to its first, 'p:<provider>':
//   - Google AI plan: each extra account is an agy home folder (antigravity.mjs); its limits are read with its own sign-in;
//     an agent on it gets <agent home>/aqeelos-model-accounts.json, which the engine plugin follows.
//   - ChatGPT: each extra sign-in is an entry of the engine's pool (model-pools.mjs); an agent on it gets
//     credential_pool_prefer.openai-codex in its config (engine fix aqeelos:pool-prefer).
// Everything else (cards, the priority list, groups with Most room first, switching, Used by, usage) works on these keys as
// on Claude accounts. A provider added later only needs its own lines below: how to list extra accounts, how to point an
// agent at one, and (if it can) how to read one account's limits.
import {readFile} from 'node:fs/promises';
import {writeStore} from './store.mjs';
import {homedir} from 'node:os';
import path from 'node:path';
import {homeOf} from './agentops.mjs';
import {createAgyQuota} from './usage-extra.mjs';

const GOOGLE='antigravity-subscription',CHATGPT='openai-codex';
export const splitSlug=s=>{const i=String(s||'').indexOf('#');return i<0?{base:String(s||''),acct:''}:{base:s.slice(0,i),acct:s.slice(i+1)}};
const ACCTS=()=>path.join(homedir(),'.gemini','aqeelos-accounts.json');
const agyToken=home=>path.join(home,'.gemini','antigravity-cli','antigravity-oauth-token');
const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};

// the extra accounts of each provider: [{base, acct, label, home?}] (the first account is the provider's own entry)
async function extraAccounts(HERMES_HOME){const out=[];
 for(const a of (await readJson(ACCTS(),{})).accounts||[])if(/^g[0-9a-f]{6}$/.test(a.id||'')&&!a.pending)out.push({base:GOOGLE,acct:a.id,label:a.label||'Google AI Pro',home:a.home});
 const pool=((await readJson(path.join(HERMES_HOME,'auth.json'),{})).credential_pool||{})[CHATGPT];
 if(Array.isArray(pool))pool.slice(1).forEach((e,i)=>{if(/^[0-9a-z]{4,16}$/i.test(e.id||''))out.push({base:CHATGPT,acct:e.id,label:e.label&&e.label!=='device_code'?e.label:'ChatGPT '+(i+2),status:e.last_status||null,resetAt:e.last_error_reset_at||null})});
 return out}
// the first ChatGPT pool entry's id: the provider's own card is that account
async function firstPoolId(HERMES_HOME){const pool=((await readJson(path.join(HERMES_HOME,'auth.json'),{})).credential_pool||{})[CHATGPT];return Array.isArray(pool)&&pool[0]?.id||''}

// add the extra accounts to the provider list the Accounts page and the switching read (each as its own provider entry)
const quotas=new Map();
export async function withExtras(v,{HERMES_HOME,log=()=>{}}){if(!Array.isArray(v))return v;
 for(const x of await extraAccounts(HERMES_HOME)){const b=v.find(p=>p.slug===x.base);if(!b)continue;   // the agent is not signed in to that provider at all
  const e={slug:x.base+'#'+x.acct,name:b.name,label:x.label,models:b.models||[],windows:[],details:[],base:x.base,acct:x.acct};
  if(x.base===GOOGLE){let q=quotas.get(x.acct);if(!q){q=createAgyQuota({tokenFile:()=>agyToken(x.home),log});quotas.set(x.acct,q)}const r=await q.read().catch(()=>null);
   if(r?.signedIn===false)e.details.push('Not signed in on this server: remove it and add it again.');else if(r){e.windows=r.windows||[];if(r.plan)e.details.push('Plan: '+r.plan);if(r.error)e.details.push(r.error)}}
  if(x.base===CHATGPT&&x.status==='exhausted')e.windows=[{label:'ChatGPT limit',used:100,resets:x.resetAt,scope:'account'}];
  v.push(e)}
 return v}

// which account of a provider an agent is pointed at ('' = its first)
export async function chosenAccount(profile,base,{HERMES_HOME}={}){
 if(base===GOOGLE){const c=String((await readJson(path.join(homeOf(profile),'aqeelos-model-accounts.json'),{}))[GOOGLE]||'');return c==='main'?'':c}
 if(base===CHATGPT){const y=await readFile(path.join(homeOf(profile),'config.yaml'),'utf8').catch(()=>'');const m=/credential_pool_prefer:[\s\S]{0,200}?\n\s+openai-codex:\s*["']?([0-9a-z]{4,16})/i.exec(y);
  const id=m?.[1]||'';return id&&id!==await firstPoolId(HERMES_HOME)?id:''}
 return ''}
// point an agent at one account of a provider ('' = its first)
export async function chooseAccount(profile,base,acct,{HERMES_HOME,setKey}){
 if(base===GOOGLE){const f=path.join(homeOf(profile),'aqeelos-model-accounts.json'),cur=await readJson(f,{});await writeStore(f,JSON.stringify({...cur,[GOOGLE]:acct||'main'}));return true}
 if(base===CHATGPT){const id=acct||await firstPoolId(HERMES_HOME);if(!id)return false;const r=await setKey(profile,'credential_pool_prefer.openai-codex',id);return !!r?.ok}
 return !acct}
