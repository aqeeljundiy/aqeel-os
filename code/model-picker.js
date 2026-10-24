// Pickers: model (grouped by AI, so it also picks the provider) and effort. A hidden #model select holds the combined "model|effort" value the app reads;
// the visible Model and Effort pickers write to it and follow it when it changes.
// Models come from /api/models: Codex reports its live catalog with per-model effort levels; Claude uses its CLI aliases;
// paired with aqeelOS, the agent's models from aqeelOS replace them (see modelsForAgent).
const $=id=>document.getElementById(id);
const EFFORT_LABELS={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'};
export const effortLabel=e=>EFFORT_LABELS[e]||e;
export const providerName=p=>({claude:'Claude',codex:'GPT',gemini:'Gemini'})[p]||p;
let catalog={codex:[],claude:[],gemini:[]},ready=[];
let saved={};try{saved=JSON.parse(localStorage.getItem('cba-model')||'{}')}catch{}
const persist=()=>{try{localStorage.setItem('cba-model',JSON.stringify(saved))}catch{}};

function fillModels(){
 const provider=$('provider-pick').value,list=catalog[provider]||[],select=$('model');select.replaceChildren();
 if(!list.length)select.append(new Option('Default model','|'));
 for(const m of list){const group=document.createElement('optgroup');group.label=m.name;
  const efforts=m.efforts?.length?[...m.efforts]:[''];
  // Claude has no reported default effort: offer “Auto” (the CLI decides) before the explicit levels
  if(provider==='claude')efforts.unshift('');
  for(const e of efforts){const o=new Option(provider==='gemini'?m.name:m.name+' · '+(e?effortLabel(e):'Auto')+(e&&e===m.defaultEffort?' (default)':''),m.id+'|'+e);
   o.dataset.desc=(e===efforts.find(x=>x)&&m.description)?m.description:'';group.append(o)}
  select.append(group)}
 const want=saved.combo?.[provider],values=[...select.options].map(o=>o.value);
 const def=list.find(m=>m.isDefault)||list[0];const fallback=def?def.id+'|'+(provider==='claude'?'':def.defaultEffort||def.efforts?.[0]||''):values[0];
 select.value=values.includes(want)?want:values.includes(fallback)?fallback:values[0];
 syncVisible();
}

const EFFORTS=(provider,m)=>provider==='gemini'?[]:[...(provider==='claude'?['']:[]),...(m?.efforts?.length?m.efforts:[])];
function syncVisible(){const provider=$('provider-pick').value,list=catalog[provider]||[],[id='',effort='']=$('model').value.split('|');
 const name=$('model-name'),groups=[];
 for(const p of ['claude','codex','gemini'].filter(x=>ready.includes(x)||x===provider)){const g=document.createElement('optgroup');g.label=providerName(p);const models=catalog[p]||[];
  for(const m of models.length?models:[{id:'',name:'Default model'}]){const o=new Option(m.name,p+':'+m.id);o.dataset.desc=m.description||'';g.append(o)}groups.push(g)}
 name.replaceChildren(...groups);name.value=provider+':'+id;
 const m=list.find(x=>x.id===id),levels=EFFORTS(provider,m),eff=$('effort');eff.replaceChildren(...levels.map(e=>{const o=new Option((e?effortLabel(e):'Auto')+(e&&e===m?.defaultEffort?' (default)':''),e,false,e===effort);if(!e)o.dataset.desc='Claude Code decides';return o}));eff.value=effort;
 eff.closest('.dd')?.toggleAttribute('hidden',!levels.length);eff.hidden=!levels.length}
function setCombined(id,effort){const v=id+'|'+effort,sel=$('model');if(![...sel.options].some(o=>o.value===v))return;sel.value=v;sel.dispatchEvent(new Event('change'))}
const pickedModel=()=>{const v=$('model-name').value,i=v.indexOf(':');return [v.slice(0,i),v.slice(i+1)]};
$('model-name').addEventListener('change',()=>{const [provider,id]=pickedModel();
 if(provider!==$('provider-pick').value){$('provider-pick').value=provider;saved.provider=provider;persist();fillModels();$('provider-pick').dispatchEvent(new Event('change',{bubbles:true}))}
 const m=(catalog[provider]||[]).find(x=>x.id===id),levels=EFFORTS(provider,m),cur=$('effort').value;
 setCombined(id,levels.includes(cur)?cur:provider==='claude'?'':m?.defaultEffort||levels[0]||'')});
$('effort').addEventListener('change',()=>setCombined(pickedModel()[1],$('effort').value));
let signedIn=[],forAgent='';
// paired with aqeelOS, the list is the one the chat's model menu has for the agent picked here (a member: only the
// models they may use, so an AI with none of those is not offered)
function applyReady(){ready=catalog.restricted?signedIn.filter(p=>(catalog[p]||[]).length):signedIn;
 for(const o of $('provider-pick').options){o.disabled=!ready.includes(o.value);o.textContent=providerName(o.value)+(o.disabled?(signedIn.includes(o.value)?' · not allowed':' · not connected'):'')}
 const cur=$('provider-pick').value,preferred=[ready.includes(cur)?cur:'',saved.provider,'claude','codex','gemini'].find(p=>p&&ready.includes(p));if(preferred)$('provider-pick').value=preferred}
async function loadCatalog(){try{const r=await fetch('/api/models?agent='+encodeURIComponent(forAgent));if(r.ok)catalog=await r.json()}catch{}}
export async function setupModelPicker(readyIds){
 signedIn=readyIds;forAgent=$('agent-pick')?.value||'';await loadCatalog();applyReady();fillModels()}
// the agent changed: its models (the agent's own model first when nothing was chosen for this AI yet)
export async function modelsForAgent(agent){agent=String(agent||'');if(agent===forAgent&&catalog.managed!==undefined)return;forAgent=agent;await loadCatalog();applyReady();fillModels()}

export function getChoice(){const [model='',effort='']=$('model').value.split('|');return {provider:$('provider-pick').value,model,effort}}

$('provider-pick').addEventListener('change',()=>{saved.provider=$('provider-pick').value;persist();if(!$('model-name').value.startsWith(saved.provider+':'))fillModels()});
$('model').addEventListener('change',()=>{(saved.combo??={})[$('provider-pick').value]=$('model').value;persist();syncVisible()});

// The remembered (or default) model and effort for a provider, used by Compare and Team.
export function choiceFor(provider){const list=catalog[provider]||[];const want=saved.combo?.[provider];
 if(want){const [model,effort='']=want.split('|');if(list.some(m=>m.id===model))return {provider,model,effort}}
 const def=list.find(m=>m.isDefault)||list[0];return {provider,model:def?.id||'',effort:provider==='claude'?'':def?.defaultEffort||''}}
// the second AI for Compare, Team and "retry with": the first other connected provider
export function partnerFor(p){const order={claude:['codex','gemini'],codex:['claude','gemini'],gemini:['claude','codex']}[p]||['claude','codex'];return order.find(x=>ready.includes(x))||order[0]}
