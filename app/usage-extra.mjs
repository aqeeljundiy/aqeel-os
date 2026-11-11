// Usage readings the engine does not give: (1) Google AI plan through Antigravity, (2) a Claude account whose usage call Anthropic refuses.
// Checked on the boxes 12 Nov 2026 (no secrets printed):
//  - agy keeps its Google sign-in in ~/.gemini/antigravity-cli/antigravity-oauth-token (a JSON file: token.access_token, refresh_token, expiry;
//    agy renews it when it runs). Not signed in = no file (pnp-box: "You are not logged into Antigravity").
//  - agy's own quota manager asks cloudcode-pa.googleapis.com/v1internal: loadCodeAssist (plan, project) and fetchAvailableModels
//    (per model quotaInfo {remainingFraction, resetTime}). Both answer 200 with that sign-in as a plain Bearer call.
//  - Anthropic's /api/oauth/usage refuses with 429 (Retry-After ~5 min, counting down) for a token that is also asked by the engine's
//    gateways; the same token's /v1/messages answers with anthropic-ratelimit-unified-* headers (5 h and 7 day use + reset), also when at its limit.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const CC='https://cloudcode-pa.googleapis.com/v1internal:';
export const AGY_TOKEN=()=>path.join(homedir(),'.gemini','antigravity-cli','antigravity-oauth-token');
const num=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);

// fetchAvailableModels answer -> windows in the shape the provider cards use ({label, used, resets, scope}). One window per model
// family (the lowest room of its models), shown only: scope 'model' never moves an agent, the family a model belongs to is not the whole account.
export function agyWindows(j){const fam={};
 for(const [id,m] of Object.entries(j?.models||{})){const q=m?.quotaInfo;if(!q||m.isInternal||!m.displayName||/^(tab_|chat_)/.test(id))continue;const left=num(q.remainingFraction);if(left===null)continue;
  const k=/image/i.test(id)?'Images':/claude/i.test(id)?'Claude':/gemini/i.test(id)?'Gemini':'Other models';const used=Math.round(100*(1-Math.min(1,Math.max(0,left))));
  const f=fam[k]||(fam[k]={used:-1,resets:null});if(used>f.used){f.used=used;f.resets=q.resetTime||null}else if(used===f.used&&q.resetTime&&(!f.resets||q.resetTime>f.resets))f.resets=q.resetTime}
 return Object.entries(fam).sort(([a],[b])=>['Gemini','Claude','Other models','Images'].indexOf(a)-['Gemini','Claude','Other models','Images'].indexOf(b))
  .map(([label,f])=>({label:label+' (Antigravity)',used:f.used,resets:f.used>0?f.resets:null,scope:label==='Images'?'image':'model'}))}

// A reader for the Antigravity quota: the last answer is kept; asked at most every `every`, after a refusal it waits (Retry-After, else doubling from 10 to 60 min).
export function createAgyQuota({every=10*60e3,now=()=>Date.now(),fetchImpl=fetch,tokenFile=AGY_TOKEN,log=()=>{}}={}){
 const st={at:0,next:0,wait:0,windows:[],plan:'',error:'',signedIn:null};let asking=null,proj=null;
 const post=async(method,token,body)=>{const r=await fetchImpl(CC+method,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','user-agent':'antigravity'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return r};
 async function ask(){let t;try{t=JSON.parse(await readFile(tokenFile(),'utf8')).token}catch{st.signedIn=false;st.windows=[];st.error='';st.plan='';return}
  st.signedIn=!!t?.access_token;if(!st.signedIn)return;
  // agy renews the file when it runs (the app asks it every 10 min); an expired one is not used and the last reading stays
  if(t.expiry&&Date.parse(t.expiry)<now()){st.error='Google sign-in is renewed when Antigravity next runs.';st.next=now()+2*60e3;return}
  try{if(!proj||proj.at<now()-24*3600e3){const r=await post('loadCodeAssist',t.access_token,{metadata:{ideType:'ANTIGRAVITY',platform:'PLATFORM_UNSPECIFIED',pluginType:'GEMINI'}});
    if(!r.ok)return refused(r);const j=await r.json();const p=j.cloudaicompanionProject;proj={at:now(),id:typeof p==='string'?p:p?.id||null,plan:j.paidTier?.name||j.currentTier?.name||''}}
   const r=await post('fetchAvailableModels',t.access_token,proj.id?{project:proj.id}:{});if(!r.ok)return refused(r);
   const ws=agyWindows(await r.json());if(!ws.length){st.error='No limits in the answer.';st.next=now()+every;return}
   Object.assign(st,{windows:ws,plan:proj.plan,at:now(),next:0,wait:0,error:''})}
  catch{st.wait=Math.min(60*60e3,Math.max(10*60e3,st.wait*2));st.next=now()+st.wait;st.error='Could not reach Google.'}}
 function refused(r){if(r.status===401||r.status===403){proj=null;st.error='Google did not accept the sign-in.';st.next=now()+every;return}
  const ra=Number(r.headers?.get?.('retry-after'))||0;st.wait=Math.min(60*60e3,Math.max(10*60e3,ra*1000,st.wait*2));st.next=now()+st.wait;st.error=r.status===429?'Google is not giving out limits right now.':'Limits unavailable ('+r.status+').';log('antigravity quota: '+r.status)}
 // {signedIn, windows, plan, at, error}: never throws, never waits more than one ask
 async function read(){if(!asking&&now()>=st.next&&(!st.at||now()-st.at>=every)){asking=ask().finally(()=>{asking=null})}
  if(asking&&!st.at)await asking;return {signedIn:st.signedIn,windows:st.windows,plan:st.plan,at:st.at,error:st.error}}
// idle(): resolves when the background ask a read() started has finished (tests wait on this, not on a timer)
 return {read,idle:()=>asking||Promise.resolve()}}

// Claude: the usage numbers from the headers of a 1-token answer (what Claude Code itself does at start). Works when /api/oauth/usage refuses,
// also when the account is at its limit (the 429 carries the same headers). Returns {session,week,opus:null,sonnet:null,status} or null.
export async function claudeHeaderUsage(token,{fetchImpl=fetch}={}){
 try{const r=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token,'anthropic-beta':'oauth-2025-04-20','anthropic-version':'2023-06-01','content-type':'application/json','user-agent':'claude-code/2.1.0'},
   body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:1,system:"You are Claude Code, Anthropic's official CLI for Claude.",messages:[{role:'user',content:'hi'}]}),signal:AbortSignal.timeout(20000)});
  const h=n=>r.headers.get('anthropic-ratelimit-unified-'+n);const win=k=>{const u=num(h(k+'-utilization'));const rs=num(h(k+'-reset'));return u===null?null:{used:Math.round(u*100),resets:rs?new Date(rs*1000).toISOString():null}};
  const session=win('5h'),week=win('7d');if(!session&&!week)return null;return {session,week,opus:null,sonnet:null,status:h('status')||''}}
 catch{return null}}

// Providers whose sign-in the engine marked dead (auth.json credential_pool: last_status 'dead', 401 / token_revoked). Such a provider
// has no usage to read: the card says why instead of staying blank (pnp-box, ChatGPT: dead since 10 Nov, usage call answers 401).
export async function deadLogins(authFile){try{const cp=JSON.parse(await readFile(authFile,'utf8')).credential_pool||{};
 return new Set(Object.entries(cp).filter(([,v])=>Array.isArray(v)&&v.length&&v.every(e=>e?.last_status==='dead')).map(([k])=>k))}catch{return new Set()}}
