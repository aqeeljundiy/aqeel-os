// One model list for the chat and Code (owner, 21 Nov 2026: "make sure the LLM selector for Code and the normal chat are the same,
// with every model and effort available for each, kept up to date"). Built from what the engine offers an agent (its sign-ins), in one place:
//   - every signed-in provider in one of four groups (Claude, ChatGPT, Google, Other), retired ones left out (the Gemini CLI, which
//     Google closed for personal accounts on 17 Oct 2026; its models live on through the Google AI plan);
//   - Google's per-effort names (gemini-4-neon-low/-medium/-high/-xhigh) folded into one model with those efforts;
//   - every model with the efforts it takes, its context size and "new" for a week after it first shows up;
// The chat's picker (chat.js) and Code's (code-device-routes.mjs → code/server.mjs) both read this, so they always match.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {writeStore} from './store.mjs';

const RETIRED=new Set(['gemini-subscription']);
const GROUP=slug=>/claude-subscription|^anthropic$/.test(slug)?'Claude':slug==='openai-codex'||slug==='openai-api'?'ChatGPT':/antigravity|^gemini/.test(slug)?'Google':'Other';
const VARIANT=/^(.+)-(minimal|low|medium|high|xhigh|max)$/;
const ORDER=['none','minimal','low','medium','high','xhigh','max'];
// the efforts a model takes, from its family (Google: from its own names, folded below)
export function effortsOf(slug,model,cap={}){if(cap.reasoning===false)return [];const m=String(model).toLowerCase(),off=cap.can_disable_reasoning?['none']:[];
 if(/claude|anthropic\//.test(m)||/claude-subscription|^anthropic$/.test(slug))return [...off,'low','medium','high','xhigh','max'];
 if(/gpt|openai\//.test(m)||/openai/.test(slug))return [...off,'minimal','low','medium','high','xhigh'];
 return [...off,'low','medium','high']}
// the context window a model has (known families; otherwise unknown)
export function contextOf(model){const m=String(model).toLowerCase();if(/\[1m\]|-1m\b/.test(m))return 1_000_000;const k=/-(\d{3,4})k\b/.exec(m);if(k)return +k[1]*1000;
 if(/gemini/.test(m))return 1_000_000;if(/claude-haiku-4-5/.test(m))return 200_000;if(/claude/.test(m))return 200_000;if(/gpt-6|gpt-5/.test(m))return 400_000;return null}
export function niceName(id){const s=String(id).split('/').pop().replace(/\[1m\]$/,' (1M)');
 return s.replace(/^gpt-/i,'GPT-').replace(/(\d)-(\d)(?=$|[^\d])/g,'$1.$2').split('-').map(w=>/^(gpt|ai|oss)$/i.test(w)?w.toUpperCase():w.charAt(0).toUpperCase()+w.slice(1)).join(' ').replace(/\bGPT \b/,'GPT-')}

// options: the engine's /api/model/options answer for one agent; seen: {"<provider>|<model>": first-seen ms}; allow: providers the
// owner allowed that are hidden by default (Nous, the Anthropic API key)
// need: how big this agent's larger requests are (ledger.mjs modelStats _p95); a model whose context is smaller says so
export function buildCatalog(options,{seen={},allow=[],now=Date.now(),newFor=7*864e5,stats={},need=0}={}){const out=[];
 const small=ctx=>ctx&&need&&ctx<need*1.1?'Too small for this agent: its larger requests are about '+Math.round(need/1000)+'k tokens, this model holds '+Math.round(ctx/1000)+'k':'';
 // a model that keeps failing this agent's work says so (ledger.mjs modelStats: 3 failures or more, a third of its calls or more)
 const warnOf=(slug,ids,ctx)=>small(ctx)||((slug,ids)=>{let c=0,e=0,last='';for(const id of ids){const x=stats[slug+'|'+id];if(x){c+=x.calls;e+=x.errors;last=x.last||last}}return e>=3&&e>=(c+e)/3?'Failed '+e+' of '+(c+e)+' calls for this agent this week'+(last?': '+last:''):''})(slug,ids);
 for(const p of options?.providers||[]){if(!p.authenticated||RETIRED.has(p.slug)||!(p.models||[]).length)continue;
  if(/nous/i.test(p.slug+' '+(p.name||''))&&!allow.includes(p.slug))continue;if(p.slug==='anthropic'&&!allow.includes('anthropic'))continue;
  const caps=p.capabilities||{},ms=[...new Set((p.models||[]).filter(x=>typeof x==='string'))],fam={},plain=[];
  // Google's names carry the effort: one model per family when there are two efforts or more
  for(const m of ms){const v=GROUP(p.slug)==='Google'?VARIANT.exec(m):null;if(v){(fam[v[1]]||=[]).push([v[2],m])}else plain.push(m)}
  const models=[];
  for(const [base,vs] of Object.entries(fam)){if(vs.length<2){plain.push(vs[0][1]);continue}
   const efforts=vs.map(v=>v[0]).sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b)),ids=Object.fromEntries(vs);
   models.push({id:base,name:niceName(base),efforts,effortIds:ids,defaultEffort:efforts.includes('high')?'high':efforts.at(-1),context:contextOf(base),warn:warnOf(p.slug,vs.map(v=>v[1]),contextOf(base)),
    isNew:vs.some(([,m])=>seen[p.slug+'|'+m]>now-newFor),current:p.is_current&&vs.some(([,m])=>m===options.model)})}
  for(const m of plain){const ef=effortsOf(p.slug,m,caps[m]||{});
   models.push({id:m,name:niceName(m),efforts:ef,defaultEffort:ef.includes('medium')?'medium':ef[0]||'',context:contextOf(m),warn:warnOf(p.slug,[m],contextOf(m)),isNew:seen[p.slug+'|'+m]>now-newFor,current:p.is_current&&m===options.model})}
  out.push({provider:p.slug,name:p.name||p.slug,group:GROUP(p.slug),current:!!p.is_current,models})}
 const g=['Claude','ChatGPT','Google','Other'];out.sort((a,b)=>b.current-a.current||g.indexOf(a.group)-g.indexOf(b.group));
 return {provider:options?.provider||null,model:options?.model||null,providers:out}}
// the model id the engine runs for a picked model and effort (a folded Google model: its name for that effort)
export function resolveModel(catalog,provider,id,effort){const p=(catalog?.providers||[]).find(x=>x.provider===provider),m=p?.models.find(x=>x.id===id);
 if(!m?.effortIds)return id;return m.effortIds[effort]||m.effortIds[m.defaultEffort]||Object.values(m.effortIds)[0]}

// first seen: a model counts as new for a week; the very first read marks everything as known (nothing is new on day one)
export function createModelCatalog({DATA,options,allow=async()=>[],stats=async()=>({}),now=()=>Date.now()}){const F=path.join(DATA,'model-catalog.json');let seen=null;
 async function note(opts){seen||=await readFile(F,'utf8').then(JSON.parse).catch(()=>null);const first=!seen;seen||={};let ch=false;
  for(const p of opts?.providers||[])for(const m of p.models||[]){const k=p.slug+'|'+m;if(!seen[k]){seen[k]=first?1:now();ch=true}}
  if(ch)await writeStore(F,JSON.stringify(seen)).catch(()=>{});return seen}
 async function catalog(agent='default'){const o=await options(agent);return buildCatalog(o,{seen:await note(o),allow:await allow(),now:now(),...await stats(agent).then(st=>({stats:st,need:st?._p95||0}),()=>({}))})}
 return {catalog,note}}
