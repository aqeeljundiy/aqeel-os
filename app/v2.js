// aqeelOS /v2 layer (13 Nov 2026). Loaded only on /v2, after the app's own scripts and before boot.js; it never changes what
// the app does, only how it moves and holds together: one highlight that glides in the menu and the chat list, chat rows
// that rise in the first time they show, the sidebar and the live screen resizable by keyboard too, the floating screen
// snapping to a corner and morphing between side panel and window, light/dark following the device until one is picked.
// Everything here is inside this function: no new global names (scripts/check-globals.mjs).
(()=>{
 const html=document.documentElement;
 const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const secOf=()=>(location.hash.replace(/^#\/?/,'').split(/[\/?]/)[0])||'chat';
 const markSec=()=>html.setAttribute('data-v2sec',secOf());
 addEventListener('hashchange',markSec);markSec();

 /* ---------- the gliding highlight ----------
    The sidebar is redrawn by morph() (core.js), which removes anything it did not draw. So the glide is put back after
    every redraw at the place it last stood, and then moves to the new active item: it glides across redraws and pages. */
 const last={};
 const GLIDES=[['.side .sections','.sec.on','sec'],['.side .side-list','.item.on','list']];
 function glide(boxSel,onSel,key){const box=document.querySelector(boxSel);if(!box)return;
  const on=box.querySelector(onSel);let g=box.querySelector(':scope>.v2-glide');
  if(!box.classList.contains('v2-has-glide'))box.classList.add('v2-has-glide');
  const fresh=!g;if(fresh){g=document.createElement('span');g.className='v2-glide still';g.setAttribute('aria-hidden','true');box.append(g)}
  if(!on||!on.offsetParent){if(g.classList.contains('v2-show'))g.classList.remove('v2-show');return}
  const br=box.getBoundingClientRect(),r=on.getBoundingClientRect();
  const p={x:Math.round(r.left-br.left+box.scrollLeft),y:Math.round(r.top-br.top+box.scrollTop),w:Math.round(r.width),h:Math.round(r.height)};
  const put=q=>{const t=`translate(${q.x}px,${q.y}px)`;if(g.style.transform!==t)g.style.transform=t;if(g.style.width!==q.w+'px')g.style.width=q.w+'px';if(g.style.height!==q.h+'px')g.style.height=q.h+'px'};
  const was=last[key];last[key]=p;
  if(fresh){put(was||p);if(!g.classList.contains('v2-show'))g.classList.add('v2-show');void g.offsetWidth;g.classList.remove('still');if(was)requestAnimationFrame(()=>put(p));return}
  if(!g.classList.contains('v2-show'))g.classList.add('v2-show');put(p)}

 /* ---------- chat rows rise in the first time each is seen ---------- */
 const seen=new Set();let firstList=true;
 function rows(){const list=document.querySelector('.side .side-list');if(!list)return;let i=0;
  for(const b of list.querySelectorAll('.item[data-go^="/chat/"]')){const k=b.getAttribute('data-go');if(seen.has(k))continue;seen.add(k);
   if(reduce()||!firstList&&i>20)continue;const row=b.closest('.item-row')||b;row.style.setProperty('--i',i++);row.classList.add('v2-in');
   row.addEventListener('animationend',()=>row.classList.remove('v2-in'),{once:true})}
  if(seen.size)firstList=false}

 /* ---------- the version mark next to the wordmark ---------- */
 function chip(){const w=document.querySelector('.side-top .wordmark');if(!w||w.querySelector('.v2-chip'))return;
  // v2 is the UI now (14 Nov 2026); the mark is the way back to the first version (/v1) while it is still kept
  const a=document.createElement('a');a.className='v2-chip';a.href='/v1'+location.hash;a.textContent='v2';a.title='The new look. Click for the old one (kept at /v1 for a while).';
  a.addEventListener('click',()=>{a.href='/v1'+location.hash});w.append(a)}

 /* ---------- panels: the resize handles work by keyboard too ---------- */
 const LIM={side:[220,420,'--side-open','sideW','.side'],screen:[360,null,'--screen-w','screenW','#screenPane']};
 function handles(){for(const h of document.querySelectorAll('[data-drag="side"],[data-drag="screen"]')){if(h.hasAttribute('tabindex'))continue;
  h.tabIndex=0;h.setAttribute('role','separator');h.setAttribute('aria-orientation','vertical');
  h.setAttribute('aria-label',h.dataset.drag==='side'?'Sidebar width: arrow keys to change, Enter to reset':'Screen panel width: arrow keys to change, Enter to reset')}}
 document.addEventListener('keydown',e=>{const h=e.target.closest?.('[data-drag="side"],[data-drag="screen"]');if(!h)return;
  const [lo,hiFix,prop,key,sel]=LIM[h.dataset.drag];const app=document.querySelector('.app'),el=document.querySelector(sel);if(!app||!el)return;
  if(e.key==='Enter'){app.style.removeProperty(prop);store.set(key,null);e.preventDefault();return}
  const step=e.shiftKey?48:16,dir=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!dir)return;e.preventDefault();
  const hi=hiFix||Math.round(innerWidth*.72),cur=el.offsetWidth,w=Math.max(lo,Math.min(hi,cur+(h.dataset.drag==='screen'?-dir:dir)*step));
  app.style.setProperty(prop,w+'px');store.set(key,w)});

 /* ---------- the floating screen: snaps to the nearest corner when let go near an edge ---------- */
 let floatDrag=false;
 document.addEventListener('pointerdown',e=>{floatDrag=!!e.target.closest?.('[data-drag="float"]')&&!e.target.closest('button')},true);
 document.addEventListener('pointerup',()=>{if(!floatDrag)return;floatDrag=false;const fl=document.querySelector('#screenFloat');if(!fl||typeof Screen==='undefined')return;
  const r=fl.getBoundingClientRect(),M=12,near=72;let x=r.left,y=r.top;
  if(x<near)x=M;else if(innerWidth-r.right<near)x=innerWidth-r.width-M;
  if(y<near)y=M;else if(innerHeight-r.bottom<near)y=innerHeight-r.height-M;
  if(x===r.left&&y===r.top)return;
  fl.classList.add('v2-snap');Screen.float.x=Math.round(x);Screen.float.y=Math.round(y);Screen.placeFloat();store.set('screenFloat',Screen.float);
  setTimeout(()=>fl.classList.remove('v2-snap'),400)});

 /* ---------- side panel <-> window: the screen morphs from where it was to where it goes ---------- */
 const paneEl=()=>document.querySelector('#screenFloat')||(!document.querySelector('#screenPane')?.hidden&&document.querySelector('#screenPane'));
 if(typeof ACT!=='undefined'&&ACT['scr-mode']){const mode=ACT['scr-mode'];
  ACT['scr-mode']=(...a)=>{const from=paneEl()?.getBoundingClientRect();const res=mode(...a);
   requestAnimationFrame(()=>{const to=paneEl();if(!from||!to||reduce())return;const r=to.getBoundingClientRect();if(!r.width||!r.height)return;
    to.animate([{transformOrigin:'0 0',transform:`translate(${from.left-r.left}px,${from.top-r.top}px) scale(${from.width/r.width},${from.height/r.height})`,opacity:.55},{transformOrigin:'0 0',transform:'none',opacity:1}],{duration:360,easing:'cubic-bezier(.2,.7,.2,1)'})});
   return res}}

 /* ---------- light and dark ---------- */
 // the switch fades the colours over instead of flashing them
 if(typeof theme==='function'){const flip=theme;window.theme=(...a)=>{html.classList.add('v2-theming');const r=flip(...a);setTimeout(()=>html.classList.remove('v2-theming'),320);return r}}
 // nothing picked yet: follow the device, also when it changes (evening dark mode)
 const mq=matchMedia('(prefers-color-scheme: dark)');
 mq.addEventListener?.('change',e=>{let t=null;try{t=localStorage.getItem('hui-theme')}catch{}if(t)return;
  html.classList.add('v2-theming');html.classList.toggle('dark',e.matches);if(typeof paintTop==='function'&&document.querySelector('.topbar'))paintTop();setTimeout(()=>html.classList.remove('v2-theming'),320)});

 /* ---------- the admin kit's parts (owner, 14 Nov 2026: "make aqeelOS with the adminkit ui ... improving the UI, not a redesign") ----------
    app/vendor/admin-kit/admin-kit.js loads just before this file, on /v2 only. The app keeps calling its own helpers; on /v2 they
    hand the work to the kit's part, with the same words and the same answer to the caller. Kit 0.27.0 grew what the app's
    pieces had and the kit did not (owner, 14 Nov 2026: "Grow the kit"): menus with icons, second lines, ticks, headings and
    search, opened from the app's own buttons; the search box with icons, live results and its key hints. */
 const AK=typeof AdminKit==='object'&&AdminKit?AdminKit:null;
 const kitOpen=()=>document.querySelector('.ak-menu-pop,.ak-pop--cal,.ak-cmd,.ak-dialog,.ak-sheet');
 // Ctrl+K (Cmd+K on a Mac) opens the search, once: the kit listens for the same keys, so they are stopped before it and
 // the app's own handler (boot.js) see them and the search is opened here (both opened, seen 14 Nov 2026)
 addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey||e.key?.toLowerCase()!=='k')return;e.stopPropagation();
  const mod=typeof isMac!=='undefined'&&isMac?e.metaKey:e.ctrlKey;if(!mod||typeof S==='undefined'||!S.signedIn||typeof palette!=='function')return;
  e.preventDefault();if(AK?.command?.isOpen)AK.command.close();else if(!document.querySelector('.palette'))palette()},true);
 // Escape closes the top kit box only. The app's own Escape (core.js) runs first and would close the drawer under it.
 addEventListener('keydown',e=>{if(e.key!=='Escape'||e.isComposing||!AK||!kitOpen())return;
  // a question or an app menu on top of a panel answers its own Escape (core.js), as on /
  if(document.querySelector('.drawer.stack:not(.closing),.menu:not(.closing)'))return;e.stopPropagation();e.preventDefault();
  if(AK.menu?.isOpen)return AK.menu.close();if(AK.datePick?.isOpen)return AK.datePick.close();if(AK.command?.isOpen)return AK.command.close();
  const d=document.querySelector('.ak-dialog');if(d){(d.querySelector('.ak-dialog__actions .ak-btn:not(.ak-btn--primary):not(.ak-btn--danger)')||d.querySelector('.ak-dialog__x'))?.click();return}
  // a side panel of the app: the app decides (it asks first when something was typed)
  if(document.querySelector('.v2-host[open]')&&typeof askClose==='function')return askClose();
  document.querySelector('.ak-sheet .ak-sheet__head [aria-label="Close"]')?.click()},true);
 if(AK){
  // toasts: the kit's (they stack, pause on hover and swipe away on a phone); a failure is still kept for "What went wrong"
  if(typeof toast==='function'&&AK.toast){window.toast=(msg,kind)=>{const t=String(msg??'');
   if(kind==='err'){try{Oops.add('toast',t)}catch{}AK.toast.error(t)}else AK.toast.success(t)}}
  // "are you sure" boxes: the kit's, same title, words and buttons, and the X in the corner as on /; resolves true or false
  if(typeof confirmBox==='function'&&AK.confirm){window.confirmBox=(title,text,okLabel='Delete',danger=true)=>
   AK.confirm({title:String(title??''),body:typeof plainText==='function'?plainText(text):String(text??''),confirmLabel:okLabel,cancelLabel:'Cancel',tone:danger?'danger':undefined,closeButton:true}).then(ok=>!!ok)}
  // menus: the kit's, from the same items (icon, second line, tick, heading, divider, red, key, search). A menu with content
  // of its own (opt.html: the date grid, the connected-accounts form) stays the app's.
  if(typeof menu==='function'&&AK.menu){const own=menu;
   window.menu=(anchor,items,opt={})=>{if(opt.html||!anchor?.getBoundingClientRect)return own(anchor,items,opt);
    for(const x of document.querySelectorAll('.menu'))x.remove();
    const list=(items||[]).filter(Boolean).map(i=>i==='-'?'-':i.header?{header:i.header,title:i.title}:
     {label:String(i.label??''),sub:i.sub||undefined,icon:i.ava||(i.icon?icon(i.icon,16):undefined),checked:!!i.on,tone:i.bad?'danger':undefined,disabled:!!i.disabled,kbd:i.kbd||undefined,title:i.title||undefined,keywords:i.find||undefined,run:i.run});
    // the phone sheet's title: the menu's first heading, else the button's own words (its tooltip is a sentence)
    const label=list.find(i=>i.header)?.header||anchor.textContent?.trim().slice(0,60)||anchor.getAttribute?.('aria-label')||'Menu';
    const r=anchor.getBoundingClientRect(),align=r.left>innerWidth*.6?'end':'start';
    AK.menu(anchor,list,{label,search:!!opt.search,placeholder:'Search',align}).then(()=>setTimeout(()=>opt.onClose?.(),0));
    return null}}
  // the day picker of date fields (the schedule editor's "Once"): the kit's calendar from the same button, a bottom sheet
  // on a phone; arrows, Enter and Escape as before (Schedules, owner 14 Nov 2026: "Yes, Schedules next")
  if(typeof datePop==='function'&&AK.datePick)window.datePop=(anchor,cur,pick)=>{AK.datePick(anchor,cur||'',{label:'Pick a day'}).then(v=>{anchor.classList?.remove('open');if(v)pick(v)})};
  // side panels and pop-ups (drawer(), every page; owner, 14 Nov 2026: "Do all first"): the app builds the panel as before
  // (its head, body, buttons, typing guard, focus and backdrop) and the kit's sheet carries it: it moves in and out, and on a
  // phone it is a bottom sheet you can drag down. modal="false": the app's own backdrop and the boxes it opens on top
  // (questions, pickers) stay usable; a close by the person asks the app first (askClose: "Discard what you typed?").
  if(typeof drawer==='function'&&customElements.get('ak-drawer')){const ownDrawer=drawer;
   window.drawer=(title,body,foot='',opt={})=>{const d=ownDrawer(title,body,foot,opt);if(!d?.isConnected)return d;
    const kd=document.createElement('ak-drawer');kd.className='v2-host';kd.setAttribute('heading',String(title??''));kd.setAttribute('modal','false');kd.setAttribute('side',opt.side?'right':'center');
    kd.addEventListener('beforeclose',e=>{e.preventDefault();if(typeof askClose==='function')askClose();else closeLayers()});
    // the app removes the panel (saved, closed, replaced): the sheet goes out with it still inside, then both are gone
    let out=false;d.remove=()=>{if(out)return;out=true;kd.hide();setTimeout(()=>{Element.prototype.remove.call(d);kd.remove()},420)};
    kd.append(d);document.body.append(kd);requestAnimationFrame(()=>kd.show());
    setTimeout(()=>{if(d.contains(document.activeElement))return;const f=d.querySelector('input:not([type=checkbox]):not([type=hidden]),textarea,select');(f||d.querySelector('.drawer-head [data-act=close]'))?.focus({preventScroll:true})},120);
    return d}}
  // the search (Ctrl+K and the top bar's search button): the kit's box, with the app's lists and live results
  if(typeof palette==='function'&&typeof paletteFind==='function'&&AK.command){const ownPalette=palette;
   const asItem=x=>({label:x.l,group:x.g,hint:x.sub||undefined,icon:x.ic?icon(x.ic,16):undefined,run:x.run});
   AK.command.text({placeholder:matchMedia('(max-width:600px)').matches?'Search or run a command':'Search pages, chats, skills or run a command',empty:'Nothing found.',match:'contains',label:'Search',foot:['↑↓ to move','Enter to open','Esc to close']});
   AK.command.onQuery(async q=>(await paletteFind(q.toLowerCase())).map(asItem));
   window.palette=()=>{if(typeof closeLayers==='function')closeLayers(false);AK.command.set(ownPalette(true).map(asItem));AK.command.open()}}
 }

 /* ---------- after every redraw ---------- */
 let queued=false;
 const tick=()=>{queued=false;chip();handles();rows();for(const [b,o,k] of GLIDES)glide(b,o,k)};
 const later=()=>{if(!queued){queued=true;requestAnimationFrame(tick)}};
 new MutationObserver(ms=>{if(ms.every(m=>m.target.classList?.contains('v2-glide')||m.target.classList?.contains('v2-in')))return;later()})
  .observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 addEventListener('resize',later);
 later();
})();
