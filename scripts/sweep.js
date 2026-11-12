// Runs inside a signed-in aqeelOS page (see predeploy.sh): hops quickly between every page, switches agents and
// All agents on the way, then checks each page once it has settled: no "Couldn't load", no null/undefined text,
// no script errors, and no flicker (what counts as one, and when a page has settled, is written out above the page loop below).
// Returns JSON {out:[...], bad:n, pages, worstShift, worstAt, worstBy, slowest (ms a page took to settle), slowestAt, slowPages, shell}.
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
// SWEEP_WATCH: how long a settled page is watched (ms, 5500); SWEEP_LOAD_MAX: how long a page may take to settle (ms, 60000).
(async()=>{const errs=[];window.addEventListener('error',e=>errs.push('script error: '+e.message));
// the app is up and signed in before anything is watched (it used to start a fixed 3.5 s after the page was opened: on a slow start the sidebar was not
// there yet, so nothing watched the shell and the run passed without that check, or the script stopped on a name that did not exist yet)
for(let i=0;i<300&&!(typeof SECTIONS!=='undefined'&&typeof Swr!=='undefined'&&typeof Calm!=='undefined'&&document.querySelector('.side')&&document.querySelector('.topbar')&&document.querySelector('#view'));i++)await new Promise(r=>setTimeout(r,100));
if(!document.querySelector('.side')||!document.querySelector('#view')||typeof SECTIONS==='undefined')return JSON.stringify({out:['✗ the app did not start in this browser within 30 s (signed out, or the page did not load)'],bad:1,pages:0});
const jumps=[],pics=[];let skelAt=0,t0=0,tl=[];const since=new Map();
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
 for(const e of l.getEntries())if(!e.hadRecentInput){shift+=e.value;for(const so of e.sources||[]){const n=so.node;if(n&&n.nodeType===1&&e.value>.005)shiftBy.push(nm(n)+' '+Math.round(so.currentRect.y-so.previousRect.y)+' px at '+Math.round(t-t0)+' ms')}}
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
// the lists on Keys, Skills and Plugins are answered from the server's last read and read again behind it ("getting a newer list"); the test copy starts from
// a copy of the data with an old one, so its first answer was 3 rows short and they glided in six seconds later (layout shift 0.05, P&P 12 Nov). A person's box has
// read it recently: read it once here, as the first person to open it would have. (SWEEP_COLD=1 leaves this out.)
if(!window.SWEEP_COLD)try{await fetch('/ui/connections?fresh=1',{credentials:'same-origin'})}catch{}
await new Promise(r=>setTimeout(r,800));bellPops=0;shellOn=true;if(bellOn)bellN=Inbox.unread();
// every page in the navigation (new ones are checked without editing this list), plus Help
const pages=window.SWEEP_ONLY||[...new Set(['#/chat',...SECTIONS.flatMap(x=>x.pages?x.pages.filter(p=>!p.hidden).map(p=>'#/'+x.id+'/'+p.id):[]),'#/help'])];
// What counts as a flicker here, precisely (12 Nov 2026: the check failed one run in three on a busy box, each time on another page, because it
// looked 2.5 s after opening a page whatever the page was doing, so a page still loading at that moment was judged as if it had settled):
//   A page has SETTLED when, for QUIET ms without a break: Stage is not drawing it and nothing is staged out of sight, no read of this visit is
//   on its way (Swr.flying) and none is being asked again behind a last-known answer (Swr.wait, Swr.drawing), no loading placeholder is on
//   screen, and no entrance (a fade from under 0.6 opacity) is running in the view. The check waits for exactly that, not for a timer.
//   While it loads: an entrance that plays again on content whose entrance already played in this visit is a flicker (a redraw replaying it),
//     and so is a page that moves (layout shift above SHIFT_MAX, counted from the moment the address changed).
//   Once it has settled, for WATCH ms: any entrance on the page's own content is a flicker, whether it is content already shown fading in
//     again ("again") or content that arrives late and fades in or opens its space over the settled page ("late"). Layers on top (menus, toasts, dialogs) are not content.
//   Slow is not a flicker: a page that takes long to settle is waited for (and still judged by the rules above when its late parts land), and named
//     in the result with its time (slowPages: over SLOW ms, 6 s, the longest Stage holds the ring, so every page a person waited on that long is named; slowest). Only one that has not settled after LOAD_MAX (60 s, the longest the server itself
//     waits for the engine) fails, as "never finished loading", with the reads it was still waiting for.
// the reads on their way, by address (only to say which one a page that does not settle is waiting for)
const inAir=new Map();{const f0=window.fetch;window.fetch=function(u,o){const k={},p=f0.apply(this,arguments);inAir.set(k,[String(u?.url||u).split('?')[0].slice(0,70),performance.now()]);const end=()=>inAir.delete(k);p.then(end,end);return p}}
const WATCH=window.SWEEP_WATCH||5500,QUIET=400,LOAD_MAX=window.SWEEP_LOAD_MAX||60000,SLOW=6000,slowPages=[];let worst=0,worstAt='',worstBy=[],slow=0,slowAt='';
const sl=ms=>new Promise(r=>setTimeout(r,ms));const out=[];let bad=0;
const LAYER='.menu,.toast,dialog,.drawer,.notice,[data-anim],.aq-menu';
const sig=t=>(t.textContent||'').replace(/\s+/g,' ').trim().slice(0,80),who=t=>t.id?'#'+t.id:String(t.className?.baseVal??t.className??'').trim().split(/\s+/).slice(0,3).join('.')||t.tagName.toLowerCase();
const entering=a=>a.animationName&&a.playState==='running'&&Calm.entry().has(a.animationName)&&a.effect?.getTiming?.().iterations!==Infinity&&!a.effect.target?.closest?.('.staged,'+LAYER);
// why the page on screen is not settled yet ('' when it is)
const busy=()=>{const v=document.querySelector('#view');if(!v)return 'no page';if(v._stage||v.querySelector('.staged'))return 'being drawn';
 if(Swr.flyNav===S._nav&&Swr.flying)return 'reading';if(Swr.wait||Swr.nav===S._nav&&Swr.drawing)return 'reading again behind what it shows';
 if([...v.querySelectorAll('.skel:not(i),.skel-row')].some(x=>x.offsetParent&&!x.closest('.sched-desc')))return 'a loading placeholder';
 if(v.getAnimations({subtree:true}).some(entering))return 'its entrance';return ''};
let phase='off',revealed=false,shown=new Set(),played=new Set();const flick=[];
const snap=()=>{shown=new Set();for(const el of document.querySelectorAll('#view *')){if(el.closest('.staged'))continue;const x=sig(el);if(x.length>3)shown.add(x)}};
// an entrance that ran to its end in view while the page loads has played: the same content starting one again is a replay. Only inside the page that is
// being checked and once that page is on screen: the view's own entrance (#view) belongs to whichever page was opened last, and the pages hopped over on the
// way here end theirs in these first moments too (a hop over the chat ended its entrance with this page's heading already staged inside the view)
// and only one that really ran (120 ms or more in view): Calm ends the entrance of redrawn content in its first frame, which nobody sees (the first card of
// a list ended so, has the list's own first words, and the list's one fade a frame later read as a replay of it)
const began=new WeakMap();
document.addEventListener('animationend',e=>{const t=e.target;if(phase!=='load'||!revealed||t.id==='view'||!t.closest?.('#view')||t.closest('.staged,'+LAYER)||!Calm.entry().has(e.animationName))return;
 const b=began.get(t)?.[e.animationName];if(!b||performance.now()-b<120)return;const x=sig(t);if(x.length>3)played.add(x)},true);
document.addEventListener('animationstart',e=>{if(phase==='off'||typeof Calm==='undefined'||!Calm.entry().has(e.animationName))return;const t=e.target;if(!t.closest?.('#view')||t.closest(LAYER))return;
 if(!t.closest('.staged'))(began.get(t)||began.set(t,{}).get(t))[e.animationName]=performance.now();
 const ph=phase,at=Math.round(performance.now()-t0),x=sig(t),again=ph==='watch'?shown.has(x):t.id!=='view'&&played.has(x);if(ph==='load'&&!again)return;
 // only one that really runs in view: Calm ends the entrance of redrawn content at once, and a page still drawn out of sight shows nothing
 setTimeout(()=>{if(t.isConnected&&!t.closest('.staged')&&t.getAnimations().some(a=>a.animationName===e.animationName&&a.playState==='running'))
  flick.push(e.animationName+' on '+who(t)+' "'+x.slice(0,30)+'"'+(again?' again':' late')+' ('+at+' ms after opening, '+(ph==='watch'?'settled':'still loading')+')')},40)},true);
for(let i=0;i<pages.length;i++){const p=pages[i];
 location.hash=pages[(i+3)%pages.length];await sl(120);location.hash=pages[(i+7)%pages.length];await sl(200);
 if(i%3===0)S.viewAll=!S.viewAll;if(i%4===1)S.viewAgent=S.viewAgent?null:(S._viewList||[])[1]||null;
 location.hash=p;flick.length=0;shift=0;shiftBy=[];played=new Set();revealed=false;tl=[];t0=performance.now();phase='load';
 let q=0,why='',was=null,ok=false;
 while(performance.now()-t0<LOAD_MAX){await sl(40);const b=busy(),t=performance.now();if(b!==was){tl.push(Math.round(t-t0)+' '+(b||'quiet'));was=b}if(b!=='being drawn'&&b!=='no page')revealed=true;
  if(b){q=0;why=b}else if(!q)q=t;else if(t-q>=QUIET){ok=true;break}}
 const took=Math.round(performance.now()-t0-QUIET);if(ok&&took>slow){slow=took;slowAt=p}if(!ok||took>SLOW)slowPages.push(p+' '+(ok?(took/1000).toFixed(1)+' s':'over '+LOAD_MAX/1000+' s')+(why?' ('+why+')':''));
 const how=()=>' [what it did, ms after opening: '+tl.slice(0,14).join(', ')+']';
 if(ok){snap();phase='watch';const w0=performance.now();
  // a block that opens its space on the settled page (Late.grow: the glide a late card gets) arrived late too, though it is no CSS entrance
  while(performance.now()-w0<WATCH){await sl(100);for(const a of document.querySelector('#view')?.getAnimations({subtree:true})||[])if(a.id==='late'&&a.playState==='running'&&!a._swept){a._swept=1;const t=a.effect?.target;if(t&&!t.closest('.staged,'+LAYER))flick.push('a block opening its space late on '+who(t)+' ('+Math.round(performance.now()-t0)+' ms after opening, settled)')}}}else{bad++;out.push('✗ '+p+' never finished loading ('+LOAD_MAX/1000+' s after it was opened it was still waiting for: '+why+(inAir.size?'; reads not answered: '+[...inAir.values()].filter(v=>performance.now()-v[1]>3000).map(v=>v[0]+' '+Math.round((performance.now()-v[1])/1000)+' s').slice(0,5).join(', '):'')+')'+how())}
 phase='off';
 if(shift>worst){worst=shift;worstAt=p;worstBy=[...new Set(shiftBy)].slice(0,4)}if(shift>SHIFT_MAX){bad++;out.push('✗ '+p+' moves while it loads (layout shift '+shift.toFixed(2)+', limit '+SHIFT_MAX+'): '+[...new Set(shiftBy)].slice(0,4).join(', ')+': draw it whole (Stage) or keep the space'+how())}
 if(flick.length){bad++;out.push('✗ '+p+' flickers: '+[...new Set(flick)].slice(0,3).join(', ')+how())}
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
 // judged on its second frame only when that frame came within 120 ms of the click: its fade (pop) is about 200 ms, and a busy browser can take longer
 // than that for two frames, so the fade had really run and ended (12 Nov 2026: a PC running several sweeps at once). A slow sample is taken again, 3 tries.
 const pb=document.querySelector('[data-act="palette"]');if(pb){let p=null,o=1,el=0;for(let k=0;k<3;k++){const c0=performance.now();pb.click();await fr();await fr();el=performance.now()-c0;p=document.querySelector('.palette');o=p?+getComputedStyle(p).opacity:1;if(!p||el<120||k===2)break;closeLayers(false);await sl(300)}
  if(p&&o>.9&&el<120){bad++;out.push('✗ the search palette appears without fading in (opacity '+o.toFixed(2)+' on its second frame)')}else if(p&&el>=120)out.push('· the palette fade was not judged: two frames took '+Math.round(el)+' ms, three times')
  if(p){await sl(400);const y0=p.getBoundingClientRect().top;closeLayers();let worst=0;for(let i=0;i<10&&p.isConnected;i++){await fr();if(p.isConnected)worst=Math.max(worst,Math.abs(p.getBoundingClientRect().top-y0))}
   if(worst>20){bad++;out.push('✗ the search palette jumps '+Math.round(worst)+' px as it closes')}}}
 await sl(300);const bb=document.querySelector('.topbar [data-act="inbox"]');if(bb){bb.click();await sl(70);const d=document.querySelector('.drawer:not(.closing)');if(d&&!d.contains(document.activeElement)){bad++;out.push('✗ the notifications panel opened with the focus left behind it (Tab would leave the panel)')}if(d){let last=+getComputedStyle(d).opacity,up=0;closeLayers();{const o=+getComputedStyle(d).opacity;if(o>last+.05)up=o-last;last=o}
  for(let i=0;i<14&&d.isConnected;i++){await fr();if(!d.isConnected)break;const o=+getComputedStyle(d).opacity;if(o>last+.05)up=Math.max(up,o-last);last=o}
  if(up){bad++;out.push('✗ a panel closed while still opening flashes back to fully shown before it leaves (+'+up.toFixed(2)+' opacity)')}}}}
if(bellOn){Inbox.items=Inbox.items.filter(x=>x.id!=='l-sweep');Inbox.paintBell()}
if(errs.length){bad+=errs.length;out.push(...[...new Set(errs)].map(e=>'✗ '+e))}
return JSON.stringify({out,bad,pages:pages.length,worstShift:+worst.toFixed(3),worstAt,worstBy,slowest:slow,slowestAt:slowAt,slowPages,shell:shell.length})})()
