// Model accounts with an API key (25 Oct 2026): the key is tested here before it is saved (a cheap call such as listing
// the provider's models), the answer is the provider's own words, and every saved key is tested again every 5 minutes
// (the accounts loop), so a card can say Key rejected or Out of credit. Keys are saved through the engine's own .env
// route on the main agent, as before, and never sent back to the page or logged.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// the cheap call per provider (the engine's providers, auth.py PROVIDER_REGISTRY): url, how the key goes, and for some
// a credit check on the answer. Not listed: a provider's own base URL + /models with a Bearer key.
const PROBE={
 anthropic:{url:'https://api.anthropic.com/v1/models',head:k=>({'x-api-key':k,'anthropic-version':'2023-06-01'})},
 'openai-api':{url:'https://api.openai.com/v1/models'},
 openrouter:{url:'https://openrouter.ai/api/v1/key',credit:j=>j?.data&&j.data.limit_remaining!=null&&Number(j.data.limit_remaining)<=0},
 xai:{url:'https://api.x.ai/v1/models'},
 deepseek:{url:'https://api.deepseek.com/user/balance',credit:j=>j&&j.is_available===false},
 gemini:{url:'https://generativelanguage.googleapis.com/v1beta/models',head:k=>({'x-goog-api-key':k})},
 huggingface:{url:'https://huggingface.co/api/whoami-v2'}};
const BASES={zai:'https://api.z.ai/api/paas/v4','kimi-coding':'https://api.moonshot.ai/v1','kimi-coding-cn':'https://api.moonshot.cn/v1',arcee:'https://api.arcee.ai/api/v1',gmi:'https://api.gmi-serving.com/v1',
 alibaba:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',nvidia:'https://integrate.api.nvidia.com/v1','ai-gateway':'https://ai-gateway.vercel.sh/v1','opencode-zen':'https://opencode.ai/zen/v1','opencode-go':'https://opencode.ai/zen/go/v1',
 nous:'https://inference-api.nousresearch.com/v1',xiaomi:'https://api.xiaomimimo.com/v1','tencent-tokenhub':'https://tokenhub.tencentmaas.com/v1',lmstudio:'http://127.0.0.1:1234/v1'};
// not keys, though the engine lists them with Anthropic's: a Claude plan token
const NOT_KEYS=/^(ANTHROPIC_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)$/;
// a provider's name in plain words, for messages ("OpenRouter says this key isn't valid")
const NAMES={anthropic:'Anthropic','openai-api':'OpenAI',openai:'OpenAI',openrouter:'OpenRouter',xai:'xAI',deepseek:'DeepSeek',gemini:'Google Gemini',huggingface:'Hugging Face',nous:'Nous',zai:'Z.ai',nvidia:'NVIDIA',alibaba:'Alibaba'};
export const providerName=(slug,url)=>NAMES[slug]||(()=>{try{return new URL(url).host.replace(/^api\./,'')}catch{return 'The provider'}})();
// the first account's model for agents that have none yet (a fresh install): the engine's own list for that provider
// (the current one first, else its first model), else any signed-in provider with models
export function firstModelFor(providers,slug){const ok=(providers||[]).filter(p=>p&&p.authenticated!==false&&(p.models||[]).length);
 const p=ok.find(x=>x.slug===slug)||ok.find(x=>slug&&String(slug).startsWith(x.slug))||ok[0];return p?{provider:p.slug,model:p.models[0]}:null}
const customEnv=id=>{const s=String(id||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');return s?'HERMES_CUSTOM_'+s+'_API_KEY':'HERMES_CUSTOM_API_KEY'};

export function createConnect({HERMES_HOME,DASH,DASH_TOKEN,live=false,afterSave=async()=>{}}){
 const dash=(p,o={})=>fetch(DASH.origin+'/api'+p,{...o,headers:{'x-hermes-session-token':DASH_TOKEN,...(o.body?{'content-type':'application/json'}:{}),...(o.headers||{})},signal:AbortSignal.timeout(30000)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||'The engine answered '+r.status);return j});
 // the provider's own words, without the key in them (some echo part of it back)
 const why=async(r,k)=>{const t=await r.text().catch(()=>'');let m='';try{const j=JSON.parse(t);m=j.error?.message||(typeof j.error==='string'?j.error:'')||j.message||j.detail||j.error_description||''}catch{m=t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
  m=String(m||r.statusText||'');if(k&&k.length>6)m=m.split(k).join('…');return m.slice(0,240)};
 // {state:'ok'|'rejected'|'credit'|'error'|'unreachable'|'untested', message, models?, base?}
 async function test(slug,key,base){const p=PROBE[slug];let url,head={accept:'application/json'};
  if(p){url=p.url;Object.assign(head,p.head?p.head(key):{authorization:'Bearer '+key})}
  else{const b=String(base||BASES[slug]||'').replace(/\/+$/,'');if(!b)return {state:'untested',message:'aqeelOS has no test for this provider yet.'};url=b+'/models';if(key)head.authorization='Bearer '+key}
  const go=async u=>{try{return await fetch(u,{headers:head,signal:AbortSignal.timeout(15000)})}catch(e){return {err:e}}};
  let r=await go(url);
  // an address typed without /v1 (or with it, when the server has none): the other one, as the engine's own probe does
  if(!p&&base&&!r.err&&r.status===404){const b=url.slice(0,-7),alt=/\/v1$/i.test(b)?b.slice(0,-3):b+'/v1';const r2=await go(alt+'/models');if(!r2.err&&r2.ok){r=r2;base=alt}}
  if(r.err)return {state:'unreachable',message:'Could not reach '+new URL(url).host+': '+String(r.err.cause?.code||r.err.cause?.errors?.[0]?.code||r.err.cause?.message||r.err.message||'no answer')};
  if(r.ok){const j=await r.json().catch(()=>null);const models=Array.isArray(j?.data)?j.data.map(x=>x?.id).filter(Boolean):Array.isArray(j?.models)?j.models.map(x=>x?.id||x?.name).filter(Boolean):[];
   if(p?.credit?.(j))return {state:'credit',message:'The key works, but the account has no credit left.',models};
   if(!p&&base&&!models.length)return {state:'error',message:'That address answered, but it lists no models. Check the address.'};
   // some providers list their models to anyone (Nous): then the answer says nothing about the key
   if(!p&&!base&&key){const r0=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)}).catch(()=>null);if(r0?.ok)return {state:'untested',message:'Saved. '+new URL(url).host+' lists its models to anyone, so aqeelOS could not check the key itself.'}}
   return {state:'ok',message:'Works',models,base}}
  const m=await why(r,key),cr=/credit|balance|billing|quota|payment|insufficient/i.test(m);
  if(r.status===402||cr&&(r.status===429||r.status===403||r.status===400))return {state:'credit',message:m||'Out of credit'};
  if(r.status===429)return {state:'ok',message:'Works (busy right now)'};
  if(r.status===401||r.status===403||r.status===400&&/key|auth|credential|token|permission/i.test(m))return {state:'rejected',message:providerName(slug,url)+' says this key isn’t valid. Copy the whole key again, or make a new one.',detail:m?m+' (HTTP '+r.status+')':'HTTP '+r.status};
  return {state:'error',message:new URL(url).host+' answered HTTP '+r.status+(m?': '+m:'')}}
 // the env var a provider's key lives in, from the engine's own list (its main key first)
 async function keyVar(slug){const env=await dash('/env?profile=default');const rows=Object.entries(env).filter(([k,v])=>v.provider===slug&&!NOT_KEYS.test(k)&&/_(API_KEY|TOKEN|KEY)$/.test(k));
  rows.sort((a,b)=>(b[1].provider_primary?1:0)-(a[1].provider_primary?1:0)||(b[1].is_set?1:0)-(a[1].is_set?1:0)||(/_API_KEY$/.test(b[0])?1:0)-(/_API_KEY$/.test(a[0])?1:0));return rows[0]?.[0]||''}
 async function envFile(){const t=await readFile(path.join(HERMES_HOME,'.env'),'utf8').catch(()=>'');const o={};for(const l of t.split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(l);if(m)o[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2')}return o}
 // last check per account key (p:<slug>): {state,message,at,since}; since = when it first went bad
 const checks=new Map();
 const keep=(k,r)=>{const old=checks.get(k);const bad=r.state==='rejected'||r.state==='credit';checks.set(k,{state:r.state,message:r.message,at:Date.now(),since:bad?(old?.state===r.state?old.since:Date.now()):null});if(bad&&old?.state!==r.state)console.log('key check:',k,r.state)};
 async function save(b){const slug=String(b.provider||''),key=String(b.key||'').trim();if(key.length>4096)throw new Error('That key is too long.');
  if(slug==='custom'){let base=String(b.base||'').trim().replace(/\/+$/,'');let id=String(b.id||'');
   if(id&&!base){const l=(await dash('/providers/custom-endpoints?profile=default')).endpoints||[];base=l.find(x=>x.id===id)?.base_url||''}
   if(!/^https?:\/\/[^\s/]+/.test(base))throw new Error('Type the address, starting with https://');
   const r=await test('custom',key,base);if(r.state!=='ok')return {ok:false,...r};
   const name=String(b.name||'').trim().slice(0,60)||new URL(r.base||base).host;
   const out=await dash('/providers/custom-endpoints?profile=default',{method:'POST',body:JSON.stringify({id,name,base_url:r.base||base,model:r.models[0]||'',api_key:key||null,discover_models:true})});
   id=out.id||id;keep('p:'+id,r);await afterSave(id).catch(e=>console.warn('first model',e.message));return {ok:true,state:'ok',message:'Works',key:'p:'+id,name}}
  if(!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(slug))throw new Error('Unknown provider');if(!key)throw new Error('Paste the key first.');
  const v=await keyVar(slug);if(!v)throw new Error('The engine has no key for this provider.');
  const r=await test(slug,key);if(r.state==='rejected'||r.state==='error'||r.state==='unreachable')return {ok:false,...r};
  await dash('/env?profile=default',{method:'PUT',body:JSON.stringify({key:v,value:key,provider_setup:true})});keep('p:'+slug,r);await afterSave(slug).catch(e=>console.warn('first model',e.message));
  return {ok:true,state:r.state,message:r.state==='untested'?(/^Saved/.test(r.message)?r.message:'Saved. aqeelOS has no test for this provider yet, so it was not checked.'):r.message,key:'p:'+slug}}
 // a provider's key, or one of your own endpoints (the account's slug is the endpoint's id)
 async function remove(b){const slug=String(b.provider||'');if(!/^[\w.:@-]{1,120}$/.test(slug))throw new Error('Unknown account');const v=await keyVar(slug);
  if(!v){const l=(await dash('/providers/custom-endpoints?profile=default')).endpoints||[];if(!l.some(e=>e.id===slug))throw new Error('The engine has no key for this account.');
   await dash('/providers/custom-endpoints/'+encodeURIComponent(slug)+'?profile=default',{method:'DELETE'});checks.delete('p:'+slug);return {ok:true}}await dash('/env?profile=default',{method:'DELETE',body:JSON.stringify({key:v})});checks.delete('p:'+slug);return {ok:true}}
 // every saved key, the same test as before saving, one after another
 let checking=null;
 function checkAll(){return checking||=(async()=>{try{const env=await dash('/env?profile=default'),vals=await envFile(),done=new Set();
   for(const [k,v] of Object.entries(env)){const slug=v.provider;if(!slug||done.has(slug)||NOT_KEYS.test(k)||!v.is_set||!/_(API_KEY|TOKEN|KEY)$/.test(k)||!(PROBE[slug]||BASES[slug])||!vals[k])continue;done.add(slug);
    if(slug==='lmstudio')continue;keep('p:'+slug,await test(slug,vals[k]))}
   const ce=(await dash('/providers/custom-endpoints?profile=default').catch(()=>({}))).endpoints||[];
   for(const e of ce)if(e.base_url&&e.has_api_key&&vals[customEnv(e.id)])keep('p:'+e.id,await test('custom',vals[customEnv(e.id)],e.base_url))}
  catch(e){console.warn('key check:',e.message)}finally{checking=null}})()}
 if(live)setTimeout(()=>checkAll(),30000).unref();
 const status=()=>Object.fromEntries(checks);
 // admins only (server.mjs checks it before this runs)
 async function handle(req,res,p,send,readBody){let b={};try{b=JSON.parse(await readBody(req,16384)||'{}')}catch{}
  try{if(p==='/ui/connect/key'&&req.method==='POST')return send(res,200,await save(b));
   if(p==='/ui/connect/test'&&req.method==='POST'){const r=await test(String(b.provider||''),String(b.key||'').trim(),String(b.base||''));return send(res,200,{state:r.state,message:r.message,models:(r.models||[]).slice(0,50)})}
   if(p==='/ui/connect/key'&&req.method==='DELETE')return send(res,200,await remove(b));
   // Refresh on Models › Accounts: every saved key tested now instead of at the next 5-minute round
   if(p==='/ui/connect/check'&&req.method==='POST'){await checkAll();return send(res,200,{keys:status()})}
   if(p==='/ui/connect/custom'&&req.method==='GET')return send(res,200,{endpoints:((await dash('/providers/custom-endpoints?profile=default')).endpoints||[]).map(e=>({id:e.id,name:e.name,base_url:e.base_url}))})}
  catch(e){return send(res,400,{error:e.message})}
  return send(res,404,{error:'Not found'})}
 return {handle,checkAll,status,test}}
