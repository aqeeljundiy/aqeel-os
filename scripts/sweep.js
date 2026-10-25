// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it settles: no "Couldn't load", no null/undefined text,
// no script errors, and no flicker (a fade-in replaying after the page has settled). Returns JSON {out:[...], bad:n}.
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
const pages=['#/chat','#/code/code','#/agents/profiles','#/agents/memory','#/agents/files','#/automations/schedules','#/automations/webhooks','#/automations/n8n','#/channels/channels','#/abilities/skills','#/abilities/mcp','#/abilities/plugins','#/models/models','#/system/people','#/system/usage','#/system/health','#/system/logs','#/system/keys','#/system/settings','#/help'];
const sl=ms=>new Promise(r=>setTimeout(r,ms));const out=[];let bad=0;
let settled=Infinity,shown=new Set();const flick=[];const sig=t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,80);
 // only what has settled counts as shown: content drawn a moment before this look is still in its first entrance (its
 // fade starts a frame later, or after its stagger), which is not a replay (a slow page landing at 2.5 s, 24 Oct 2026)
 const snap=()=>{shown=new Set();for(const el of document.querySelectorAll('#view *')){if(el.getAnimations().some(a=>Calm.entry().has(a.animationName)&&a.playState!=='finished'))continue;const x=sig(el);if(x.length>3)shown.add(x)}};
 // and once that first entrance is over, it is shown too: from then on a fade-in of the same content is a replay
 // but only what is no longer fading: Calm ends a late panel's own rise at once while watchReveal fades its block (or
 // the rows inside it) in, so that panel, or a box whose rows are still coming in, was never on screen settled (Memory
 // and Settings › Help landing at 4 s read as replays of themselves, 25 Oct 2026). What settled, and the blocks round
 // it once all of them have, count from then on
 document.addEventListener('animationend',e=>{const t=e.target,v=$('#view');if(performance.now()<settled||!t.closest?.('#view')||!Calm.entry().has(e.animationName))return;
  const fl=v.getAnimations({subtree:true}).filter(a=>Calm.entry().has(a.animationName)&&a.playState!=='finished').map(a=>a.effect?.target).filter(Boolean),free=n=>!fl.some(f=>f.contains(n)||n.contains(f));
  const up=[];for(let n=t.parentElement;n&&n!==v;n=n.parentElement)up.push(n);
  for(const el of [...up,t,...t.querySelectorAll('*')])if(free(el)){const x=sig(el);if(x.length>3)shown.add(x)}},true);
document.addEventListener('animationstart',e=>{if(performance.now()<settled||typeof Calm==='undefined'||!Calm.entry().has(e.animationName))return;const t=e.target;if(t.closest?.('.menu,.toast,dialog,.drawer,.notice,[data-anim],.aq-menu'))return;if(!shown.has(sig(t)))return;
 setTimeout(()=>{if(t.isConnected&&t.getAnimations().some(a=>a.animationName===e.animationName&&a.playState==='running'))flick.push(e.animationName+' on '+(t.id?'#'+t.id:String(t.className||t.tagName).slice(0,40)))},40)},true);
for(let i=0;i<pages.length;i++){const p=pages[i];
 location.hash=pages[(i+3)%pages.length];await sl(120);location.hash=pages[(i+7)%pages.length];await sl(200);
 if(i%3===0)S.viewAll=!S.viewAll;if(i%4===1)S.viewAgent=S.viewAgent?null:(S._viewList||[])[1]||null;
 location.hash=p;flick.length=0;await sl(2500);snap();settled=performance.now();await sl(5500);settled=Infinity;
 if(flick.length){bad++;out.push('✗ '+p+' flickers: '+[...new Set(flick)].slice(0,3).join(', '))}
 const err=[...document.querySelectorAll('#view .state-box.err')].map(x=>x.textContent.trim().slice(0,140));
 const txt=(()=>{const v=document.querySelector('#view');if(!v)return '';const c=v.cloneNode(true);c.querySelectorAll('.log,pre,code,#logBox').forEach(e=>e.remove());return c.textContent||''})();const nul=/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(txt);
 if(err.length||nul){bad++;out.push('✗ '+p+' '+(err.join(' / ')||'shows null/undefined text'))}}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad})})()
