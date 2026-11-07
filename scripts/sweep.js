// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it settles: no "Couldn't load", no null/undefined text,
// no script errors, and no flicker (a fade-in replaying after the page has settled). Returns JSON {out:[...], bad:n}.
// Since 7 Nov 2026 it also fails on the other flickers found then (owner: "sometimes it flickers when text and transitions
// happen"): settled content jumping 40 px or more in one frame (a card added above it, text that changed size), pictures
// in the sidebar, topbar or chat loading again because their part was drawn anew, the bell's count popping in again on a
// page switch, and pop-ups that appear without fading in or snap back before they leave.
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
const jumps=[],pics=[];let skelAt=0;const since=new Map();
// text on screen and since when (a block counts as settled 400 ms after it first showed)
const tsig=t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,60);
const scan=()=>{const t=performance.now();for(const el of document.querySelectorAll('#view *'))if(el.children.length<40){const x=tsig(el);if(x.length>3&&!since.has(x))since.set(x,t)}};const scanT=setInterval(scan,100);
new MutationObserver(ms=>{const gone=new Map();for(const m of ms)for(const r of m.removedNodes)if(r.nodeType===1){if(r.classList?.contains('skel')||r.querySelector?.('.skel,.skel-row'))skelAt=performance.now();for(const i of [r,...r.querySelectorAll('img')])if(i.tagName==='IMG'&&i.complete&&i.naturalWidth)gone.set(i.getAttribute('src'),i)}
 if(!gone.size)return;for(const m of ms)for(const a of m.addedNodes)if(a.nodeType===1)for(const i of [a,...a.querySelectorAll('img')]){const w=i.tagName==='IMG'&&i.isConnected&&gone.has(i.getAttribute('src'))&&i.closest('.side,.topbar,#thread');
  if(w){pics.push(w.matches('#thread')?'chat reply':w.matches('.side')?'sidebar':'topbar');gone.delete(i.getAttribute('src'))}}}).observe(document.body,{childList:true,subtree:true});
try{new PerformanceObserver(l=>{const t=performance.now();if(t-skelAt<150)return;   // content replacing its loading placeholder may move what is below
 if(document.getAnimations().some(a=>(a.id==='late'||a.id==='smooth-height')&&a.playState==='running'))return;   // a block opening its space: a glide, not a jump
 for(const e of l.getEntries())for(const so of e.sources||[]){const n=so.node;if(!n||n.nodeType!==1||!n.closest?.('#view')||n.closest('.menu,.drawer,.toast,dialog,.palette'))continue;
  const dy=Math.abs(so.currentRect.y-so.previousRect.y),dh=Math.abs(so.currentRect.height-so.previousRect.height);if(Math.max(dy,dh)<40||!so.currentRect.height)continue;
  const x=tsig(n),at=since.get(x);if(!at||t-at<400)continue;jumps.push(location.hash.split('?')[0]+' '+(n.id?'#'+n.id:String(n.className||n.tagName).split(' ').slice(0,2).join('.'))+' moved '+Math.round(Math.max(dy,dh))+' px')}}).observe({type:'layout-shift'})}catch{}
// the bell: one unread item here (in this tab only), and nothing about it may pop in or ring again while pages change
let bellPops=0;const bellOn=typeof Inbox!=='undefined'&&Inbox.items;if(bellOn){Inbox.items.unshift({id:'l-sweep',title:'Sweep check',text:'',read:false,at:Date.now()});Inbox.paintBell()}
document.addEventListener('animationstart',e=>{if(/^(popIn2|ring)$/.test(e.animationName)&&e.target.closest?.('.topbar'))bellPops++},true);
await new Promise(r=>setTimeout(r,800));bellPops=0;
// every page in the navigation (new ones are checked without editing this list), plus Help
const pages=[...new Set(['#/chat',...SECTIONS.flatMap(x=>x.pages?x.pages.filter(p=>!p.hidden).map(p=>'#/'+x.id+'/'+p.id):[]),'#/help'])];
const sl=ms=>new Promise(r=>setTimeout(r,ms));const out=[];let bad=0;
let settled=Infinity,shown=new Set();const flick=[];const sig=t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,80);
 // only what has settled counts as shown: content drawn a moment before this look is still in its first entrance (its
 // fade starts a frame later, or after its stagger), which is not a replay (a slow page landing at 2.5 s, 24 Oct 2026)
 // a block whose first content is still coming in does not count either, nor anything round it: #pg holding only the
 // Memory page's block has that block's very text, so a draw landing in the frame before this look counted as shown
 // and its own first fade, starting a frame later, read as a replay (predeploy, 7 Nov 2026: "#/agents/memory flickers:
 // reveal on two reveal" when the busy box drew Memory at 2.5 s)
 const snap=()=>{shown=new Set();const fl=$('#view')?.getAnimations({subtree:true}).filter(a=>Calm.entry().has(a.animationName)&&a.playState!=='finished').map(a=>a.effect?.target).filter(Boolean)||[];
  for(const el of document.querySelectorAll('#view *')){if(fl.some(f=>el.contains(f)))continue;const x=sig(el);if(x.length>3)shown.add(x)}};
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
clearInterval(scanT);
if(jumps.length){bad++;out.push('✗ content jumps instead of gliding: '+[...new Set(jumps)].slice(0,4).join(', '))}
if(pics.length){bad++;out.push('✗ pictures load again on a redraw ('+[...new Set(pics)].join(', ')+': '+pics.length+' times): update in place with morph()')}
if(bellOn&&bellPops){bad++;out.push('✗ the bell popped in or rang again '+bellPops+' times while pages changed (topbar drawn without its count)')}
// pop-ups: the palette fades in (Calm must leave it alone) and closes from where it is; a panel closed during its own
// entrance fades out from there instead of snapping to fully shown first
{const fr=()=>new Promise(r=>requestAnimationFrame(r)),sl=ms=>new Promise(r=>setTimeout(r,ms));closeLayers(false);await sl(300);
 const pb=document.querySelector('[data-act="palette"]');if(pb){pb.click();await fr();await fr();const p=document.querySelector('.palette');const o=p?+getComputedStyle(p).opacity:1;
  if(p&&o>.9){bad++;out.push('✗ the search palette appears without fading in (opacity '+o.toFixed(2)+' on its second frame)')}
  if(p){await sl(400);const y0=p.getBoundingClientRect().top;closeLayers();let worst=0;for(let i=0;i<10&&p.isConnected;i++){await fr();if(p.isConnected)worst=Math.max(worst,Math.abs(p.getBoundingClientRect().top-y0))}
   if(worst>20){bad++;out.push('✗ the search palette jumps '+Math.round(worst)+' px as it closes')}}}
 await sl(300);const bb=document.querySelector('.topbar [data-act="inbox"]');if(bb){bb.click();await sl(70);const d=document.querySelector('.drawer:not(.closing)');if(d){let last=+getComputedStyle(d).opacity,up=0;closeLayers();{const o=+getComputedStyle(d).opacity;if(o>last+.05)up=o-last;last=o}
  for(let i=0;i<14&&d.isConnected;i++){await fr();if(!d.isConnected)break;const o=+getComputedStyle(d).opacity;if(o>last+.05)up=Math.max(up,o-last);last=o}
  if(up){bad++;out.push('✗ a panel closed while still opening flashes back to fully shown before it leaves (+'+up.toFixed(2)+' opacity)')}}}}
if(bellOn){Inbox.items=Inbox.items.filter(x=>x.id!=='l-sweep');Inbox.paintBell()}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad})})()
