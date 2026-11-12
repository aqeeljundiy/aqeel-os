// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it settles: no "Couldn't load", no null/undefined text,
// no script errors, and no flicker (a fade-in replaying after the page has settled). Returns JSON {out:[...], bad:n}.
// Since 7 Nov 2026 it also fails on the other flickers found then (owner: "sometimes it flickers when text and transitions
// happen"): settled content jumping 40 px or more in one frame (a card added above it, text that changed size), pictures
// in the sidebar, topbar or chat loading again because their part was drawn anew, the bell's count popping in again on a
// page switch, and pop-ups that appear without fading in or snap back before they leave.
// Since 12 Nov 2026 ("flicker, happening again": Settings moved six times while its cards arrived, Health five, and none
// of the checks above saw it because each card glided) it also fails on:
//   the shell drawn again: any element added to or taken out of the sidebar or the topbar while pages change, other than
//     the sidebar's own list for the section (.side-sub) and the title in the topbar (.crumbs);
//   a page that moves: the browser's own layout-shift score, summed per page from the moment it is opened, above SHIFT_MAX.
// SWEEP_ONLY (a list of addresses set on window before this runs) checks only those pages: the quick run in GitHub Actions.
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
const jumps=[],pics=[];let skelAt=0;const since=new Map();
const SHIFT_MAX=0.05;let shift=0,shiftBy=[];const shell=[];let shellOn=false;
const nm=n=>n.id?'#'+n.id:n.tagName.toLowerCase()+(String(n.className?.baseVal??n.className??'').trim()?'.'+String(n.className?.baseVal??n.className).trim().split(/\s+/).slice(0,2).join('.'):'');
for(const part of ['.side','.topbar']){const el=document.querySelector(part);if(el)new MutationObserver(ms=>{if(!shellOn)return;for(const m of ms){const tg=m.target.nodeType===1?m.target:m.target.parentElement;if(!tg||tg.closest('.side-sub,.crumbs'))continue;
 for(const n of [...m.addedNodes,...m.removedNodes])if(n.nodeType===1&&!n.matches('.side-sub,.sec-dot'))shell.push(location.hash.split('?')[0]+' '+nm(n)+' in '+nm(tg))}}).observe(el,{childList:true,subtree:true})}
// text on screen and since when (a block counts as settled 400 ms after it first showed)
const tsig=t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,60);
const scan=()=>{const t=performance.now();for(const el of document.querySelectorAll('#view *'))if(el.children.length<40){const x=tsig(el);if(x.length>3&&!since.has(x))since.set(x,t)}};const scanT=setInterval(scan,100);
new MutationObserver(ms=>{const gone=new Map();for(const m of ms)for(const r of m.removedNodes)if(r.nodeType===1){if(r.classList?.contains('skel')||r.querySelector?.('.skel,.skel-row'))skelAt=performance.now();for(const i of [r,...r.querySelectorAll('img')])if(i.tagName==='IMG'&&i.complete&&i.naturalWidth)gone.set(i.getAttribute('src'),i)}
 if(!gone.size)return;for(const m of ms)for(const a of m.addedNodes)if(a.nodeType===1)for(const i of [a,...a.querySelectorAll('img')]){const w=i.tagName==='IMG'&&i.isConnected&&gone.has(i.getAttribute('src'))&&i.closest('.side,.topbar,#thread');
  if(w){pics.push(w.matches('#thread')?'chat reply':w.matches('.side')?'sidebar':'topbar');gone.delete(i.getAttribute('src'))}}}).observe(document.body,{childList:true,subtree:true});
try{new PerformanceObserver(l=>{const t=performance.now();
 for(const e of l.getEntries())if(!e.hadRecentInput){shift+=e.value;for(const so of e.sources||[]){const n=so.node;if(n&&n.nodeType===1&&e.value>.005)shiftBy.push(nm(n)+' '+Math.round(so.currentRect.y-so.previousRect.y)+' px')}}
 if(t-skelAt<150)return;   // content replacing its loading placeholder may move what is below
 if(document.getAnimations().some(a=>(a.id==='late'||a.id==='smooth-height')&&a.playState==='running'))return;   // a block opening its space: a glide, not a jump
 for(const e of l.getEntries())for(const so of e.sources||[]){const n=so.node;if(!n||n.nodeType!==1||!n.closest?.('#view')||n.closest('.menu,.drawer,.toast,dialog,.palette'))continue;
  const dy=Math.abs(so.currentRect.y-so.previousRect.y),dh=Math.abs(so.currentRect.height-so.previousRect.height);if(Math.max(dy,dh)<40||!so.currentRect.height)continue;
  const x=tsig(n),at=since.get(x);if(!at||t-at<400)continue;jumps.push(location.hash.split('?')[0]+' '+(n.id?'#'+n.id:String(n.className||n.tagName).split(' ').slice(0,2).join('.'))+' moved '+Math.round(Math.max(dy,dh))+' px')}}).observe({type:'layout-shift'})}catch{}
// the bell: one unread item here (in this tab only), and nothing about it may pop in or ring again while pages change
let bellPops=0;const bellOn=typeof Inbox!=='undefined'&&Inbox.items;if(bellOn){Inbox.items.unshift({id:'l-sweep',title:'Sweep check',text:'',read:false,at:Date.now()});Inbox.paintBell()}
// a notification that really arrives during the run (an achievement earned by opening a page) may pop and ring once: only a
// pop with no new unread item is the topbar drawn without its count (OPS-14: P&P failed on exactly two, one pop and one ring)
let bellN=Infinity,bellGrew=-1e9;
document.addEventListener('animationstart',e=>{if(!/^(popIn2|ring)$/.test(e.animationName)||!e.target.closest?.('.topbar'))return;const n=bellOn?Inbox.unread():0,t=performance.now();if(n>bellN){bellN=n;bellGrew=t}if(t-bellGrew>1500)bellPops++},true);
await new Promise(r=>setTimeout(r,800));bellPops=0;shellOn=true;if(bellOn)bellN=Inbox.unread();
// every page in the navigation (new ones are checked without editing this list), plus Help
const pages=window.SWEEP_ONLY||[...new Set(['#/chat',...SECTIONS.flatMap(x=>x.pages?x.pages.filter(p=>!p.hidden).map(p=>'#/'+x.id+'/'+p.id):[]),'#/help'])];
const DWELL=window.SWEEP_DWELL||[2500,5500];let worst=0;
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
 location.hash=p;flick.length=0;shift=0;shiftBy=[];await sl(DWELL[0]);snap();settled=performance.now();await sl(DWELL[1]);settled=Infinity;
 worst=Math.max(worst,shift);if(shift>SHIFT_MAX){bad++;out.push('✗ '+p+' moves while it loads (layout shift '+shift.toFixed(2)+', limit '+SHIFT_MAX+'): '+[...new Set(shiftBy)].slice(0,4).join(', ')+': draw it whole (Stage) or keep the space')}
 if(flick.length){bad++;out.push('✗ '+p+' flickers: '+[...new Set(flick)].slice(0,3).join(', '))}
 const err=[...document.querySelectorAll('#view .state-box.err')].map(x=>x.textContent.trim().slice(0,140));
 const txt=(()=>{const v=document.querySelector('#view');if(!v)return '';const c=v.cloneNode(true);c.querySelectorAll('.log,pre,code,#logBox').forEach(e=>e.remove());return c.textContent||''})();const nul=/\bnull\b|\bundefined\b|NaN|\[object Object\]/.test(txt);
 if(!window.SWEEP_LOOSE&&(err.length||nul)){bad++;out.push('✗ '+p+' '+(err.join(' / ')||'shows null/undefined text'))}
 // 12 Nov 2026 (UI walk): a row of tabs says it is one to screen readers and the keyboard (core.js ariaTabs)
 {const t=[...document.querySelectorAll('#view .tabs')].filter(x=>x.offsetParent&&(x.getAttribute('role')!=='tablist'||!x.querySelector('[role=tab][aria-selected=true]')));if(t.length){bad++;out.push('✗ '+p+' has tabs without tab roles or a chosen tab ('+t.map(x=>x.dataset.tabs||'?').join(', ')+')')}}
 // 13 Nov 2026 (UI audit 12): no button, link or role=button inside another one, and no row you can Tab to that holds buttons (the row's own action is a real button beside them)
 {const I='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox]',O=['button','a[href]','[role=button]','[role=link]','[role=tab]','[role=checkbox]','[role=switch]','[tabindex="0"]:not(input):not(textarea):not(select)'].map(x=>'#view '+x).join(',');
  const n=[...document.querySelectorAll(O)].filter(e=>e.offsetParent&&[...e.querySelectorAll(I)].some(x=>x.offsetParent&&x!==e&&!x.closest('.drawer')));
  if(n.length){bad++;out.push('✗ '+p+' has a button or a row holding another button ('+[...new Set(n.map(e=>e.tagName.toLowerCase()+'.'+String(e.className).split(' ')[0]))].slice(0,4).join(', ')+')')}}}
clearInterval(scanT);shellOn=false;
if(shell.length){bad++;out.push('✗ the sidebar or topbar was drawn again while pages changed ('+shell.length+' elements): '+[...new Set(shell)].slice(0,5).join(', '))}
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
 await sl(300);const bb=document.querySelector('.topbar [data-act="inbox"]');if(bb){bb.click();await sl(70);const d=document.querySelector('.drawer:not(.closing)');if(d&&!d.contains(document.activeElement)){bad++;out.push('✗ the notifications panel opened with the focus left behind it (Tab would leave the panel)')}if(d){let last=+getComputedStyle(d).opacity,up=0;closeLayers();{const o=+getComputedStyle(d).opacity;if(o>last+.05)up=o-last;last=o}
  for(let i=0;i<14&&d.isConnected;i++){await fr();if(!d.isConnected)break;const o=+getComputedStyle(d).opacity;if(o>last+.05)up=Math.max(up,o-last);last=o}
  if(up){bad++;out.push('✗ a panel closed while still opening flashes back to fully shown before it leaves (+'+up.toFixed(2)+' opacity)')}}}}
if(bellOn){Inbox.items=Inbox.items.filter(x=>x.id!=='l-sweep');Inbox.paintBell()}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad,pages:pages.length,worstShift:+worst.toFixed(3),shell:shell.length})})()
