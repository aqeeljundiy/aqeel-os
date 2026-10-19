// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it settles: no "Couldn't load", no null/undefined text,
// no script errors. Returns JSON {out:[...], bad:n}.
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
const pages=['#/chat','#/agents/profiles','#/agents/memory','#/agents/files','#/automations/schedules','#/automations/webhooks','#/automations/n8n','#/channels/channels','#/abilities/skills','#/abilities/mcp','#/abilities/plugins','#/models/models','#/system/people','#/system/usage','#/system/health','#/system/logs','#/system/keys','#/system/settings','#/system/guide'];
const sl=ms=>new Promise(r=>setTimeout(r,ms));const out=[];let bad=0;
for(let i=0;i<pages.length;i++){const p=pages[i];
 location.hash=pages[(i+3)%pages.length];await sl(120);location.hash=pages[(i+7)%pages.length];await sl(200);
 if(i%3===0)S.viewAll=!S.viewAll;if(i%4===1)S.viewAgent=S.viewAgent?null:(S._viewList||[])[1]||null;
 location.hash=p;await sl(4500);
 const err=[...document.querySelectorAll('#view .state-box.err')].map(x=>x.textContent.trim().slice(0,140));
 const txt=document.querySelector('#view')?.innerText||'';const nul=/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(txt);
 if(err.length||nul){bad++;out.push('✗ '+p+' '+(err.join(' / ')||'shows null/undefined text'))}}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad})})()
