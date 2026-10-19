// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it settles: no "Couldn't load", no null/undefined text,
// no script errors, and no flicker (a fade-in replaying after the page has settled). Returns JSON {out:[...], bad:n}.
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
const pages=['#/chat','#/code/code','#/agents/profiles','#/agents/memory','#/agents/files','#/automations/schedules','#/automations/webhooks','#/automations/n8n','#/channels/channels','#/abilities/skills','#/abilities/mcp','#/abilities/plugins','#/models/models','#/system/people','#/system/usage','#/system/health','#/system/logs','#/system/keys','#/system/settings','#/system/guide'];
const sl=ms=>new Promise(r=>setTimeout(r,ms));const out=[];let bad=0;
let settled=Infinity;const flick=[];document.addEventListener('animationstart',e=>{if(performance.now()<settled||typeof Calm==='undefined'||!Calm.entry().has(e.animationName))return;const t=e.target;if(t.closest?.('.menu,.toast,dialog,.drawer,.notice,[data-anim],.aq-menu'))return;
 setTimeout(()=>{if(t.isConnected&&t.getAnimations().some(a=>a.animationName===e.animationName&&a.playState==='running'))flick.push(e.animationName+' on '+(t.id?'#'+t.id:String(t.className||t.tagName).slice(0,40)))},40)},true);
for(let i=0;i<pages.length;i++){const p=pages[i];
 location.hash=pages[(i+3)%pages.length];await sl(120);location.hash=pages[(i+7)%pages.length];await sl(200);
 if(i%3===0)S.viewAll=!S.viewAll;if(i%4===1)S.viewAgent=S.viewAgent?null:(S._viewList||[])[1]||null;
 location.hash=p;settled=performance.now()+1500;flick.length=0;await sl(4500);settled=Infinity;
 if(flick.length){bad++;out.push('✗ '+p+' flickers: '+[...new Set(flick)].slice(0,3).join(', '))}
 const err=[...document.querySelectorAll('#view .state-box.err')].map(x=>x.textContent.trim().slice(0,140));
 const txt=document.querySelector('#view')?.innerText||'';const nul=/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(txt);
 if(err.length||nul){bad++;out.push('✗ '+p+' '+(err.join(' / ')||'shows null/undefined text'))}}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad})})()
