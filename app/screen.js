// Live screen: watch (and take over) the selected agent's own screen on the box, streamed with noVNC.
// Every agent has its own screen that starts when it browses and stops when idle; AdsPower agents share :99.
// Shown as a laptop, either docked beside the chat (resizable) or floating like a mini player.
const Screen={
 open:store.get('screenOpen',false),control:false,mode:store.get('screenMode','dock'),
 float:store.get('screenFloat',{w:480,x:null,y:null}),
 st:null,
 agent(){return S.profile||'default'},
 off(){return this.st&&this.st.agent===this.agent()&&this.st.kind==='desktop'&&!this.st.running},
 src(){return '/screen/vnc.html?autoconnect=1&reconnect=1&reconnect_delay=1500&resize=scale&show_dot=1&path='+encodeURIComponent('screen/websockify?agent='+this.agent())+'&view_only='+(this.control?0:1)},
 async refresh(){const a=this.agent();try{const st=await call('','/ui/screens/'+encodeURIComponent(a));const was=this.st;this.st=st;
  if(!was||was.agent!==st.agent||was.running!==st.running||was.kind!==st.kind)this.paint(true)}catch{}},
 // While the screen is open, notice when the agent changes or its screen turns on/off by itself.
 watch(){clearInterval(this._t);if(!this.open)return;this.refresh();this._t=setInterval(()=>{if(document.hidden)return;if(this.st?.agent!==this.agent())this.st=null;this.refresh()},5000)},
 toggle(){this.open=!this.open;store.set('screenOpen',this.open);this.paint(true);this.watch();paintTop()},
 setMode(m){this.mode=m;store.set('screenMode',m);this.paint(true)},
 setControl(on){this.control=on;this.paint(true);if(on)setTimeout(()=>$('#scrFrame')?.focus(),400)},
 head(compact){const c=this.control;return `<div class="screen-head ${compact?'compact':''}" ${compact?'data-drag="float"':''}><b>${icon('monitor',16)}<span class="lbl">${esc(ident(this.agent()).name)}</span></b>${this.off()?'<span class="chip"><i class="dot"></i>Off</span>':`<span class="chip ${c?'warn':'ok'}"><i class="dot"></i>${c?'You are in control':'Watching'}</span>`}<span class="grow"></span>
  ${this.off()?'':`<button class="${c?'primary':''}" data-act="scr-control" title="${c?'Give control back':'Use mouse and keyboard on the screen'}">${icon('mouse',15)}<span>${c?'Done':'Take over'}</span></button>`}
  ${compact||this.off()?'':`<button class="ghost icon" data-act="scr-browser" title="Open a browser window" aria-label="Open a browser window">${icon('globe',17)}</button>`}
  <button class="ghost icon" data-act="scr-mode" title="${this.mode==='float'?'Dock beside the chat':'Float over the chat'}" aria-label="${this.mode==='float'?'Dock':'Float'}">${icon(this.mode==='float'?'dock':'pip',17)}</button>
  ${compact?'':`<button class="ghost icon" data-act="scr-pop" title="Open in its own tab" aria-label="Open in its own tab">${icon('popout',17)}</button>`}
  <button class="ghost icon" data-act="screen" title="Close" aria-label="Close screen">${icon('x',18)}</button></div>`},
 laptop(){const n=esc(ident(this.agent()).name);if(this.off())return `<div class="screen-stage"><div class="laptop"><div class="lid"><span class="cam"></span><div class="lcd scr-off"><div>${icon('monitor',28)}<b>${n}'s screen is off</b><span>It turns on by itself when ${n} opens a browser, and off again after 15 quiet minutes.</span><button class="primary" data-act="scr-start">${icon('power',15)}Turn on now</button></div></div></div></div></div>`;
  return `<div class="screen-stage"><div class="laptop"><div class="lid"><span class="cam"></span><div class="lcd"><iframe id="scrFrame" title="Live screen of ${n}" src="${this.src()}" allow="clipboard-read; clipboard-write"></iframe></div></div></div>${this.control?'':'<div class="screen-hint">Watching only. Press Take over to click and type.</div>'}</div>`},
 paint(force){const pane=$('#screenPane'),app=$('.app');if(!pane||!app)return;
  const docked=this.open&&this.mode==='dock',floating=this.open&&this.mode==='float';
  app.classList.toggle('screen-open',docked);pane.hidden=!docked;
  let fl=$('#screenFloat');
  if(!floating&&fl){fl.remove();fl=null}
  if(!docked)pane.innerHTML='';
  if(docked&&(force||!pane.querySelector('iframe'))){pane.innerHTML=`<div class="resizer" data-drag="screen" title="Drag to resize"></div>${this.head(false)}${this.laptop()}`;this.tidy()}
  if(floating&&(force||!fl)){if(!fl){fl=document.createElement('div');fl.id='screenFloat';fl.className='screen-float';document.body.append(fl)}
   fl.innerHTML=`${this.head(true)}${this.laptop()}<div class="corner" data-drag="floatsize" title="Drag to resize"></div>`;this.placeFloat();this.tidy()}
  const sw=store.get('screenW',null);if(sw)app.style.setProperty('--screen-w',sw+'px');
 },
 placeFloat(){const fl=$('#screenFloat');if(!fl)return;const w=Math.max(300,Math.min(this.float.w||480,innerWidth-24));fl.style.width=w+'px';
  const h=fl.offsetHeight||w*.78;let x=this.float.x??innerWidth-w-24,y=this.float.y??innerHeight-h-24;x=Math.max(12,Math.min(x,innerWidth-w-12));y=Math.max(12,Math.min(y,innerHeight-h-12));fl.style.left=x+'px';fl.style.top=y+'px'},
 // The stream page is same-origin, so its own toolbar can be hidden: only the screen should show.
 tidy(){const f=$('#scrFrame');if(!f)return;f.onload=()=>{try{const d=f.contentDocument;const st=d.createElement('style');st.textContent='#noVNC_control_bar_anchor,#noVNC_control_bar,#noVNC_control_bar_hint,#noVNC_status{display:none!important}html,body,#noVNC_container{background:#0b0c10!important}';d.head.append(st)}catch{}}},
};
ACT['screen']=()=>Screen.toggle();
ACT['scr-control']=()=>Screen.setControl(!Screen.control);
ACT['scr-mode']=()=>Screen.setMode(Screen.mode==='float'?'dock':'float');
ACT['scr-pop']=()=>window.open(Screen.src().replace('view_only=1','view_only=0'),'_blank','noopener');
ACT['scr-start']=async a=>{a.disabled=true;a.innerHTML='<span class="spinner"></span>Turning on…';try{Screen.st=await post((p,o)=>call('',p,o),'/ui/screens/'+encodeURIComponent(Screen.agent())+'/start');Screen.paint(true)}catch(e){fail(e);a.disabled=false;a.textContent='Turn on now'}};
ACT['scr-browser']=async()=>{try{await post((p,o)=>call('',p,o),'/ui/screen/browser?agent='+encodeURIComponent(Screen.agent()));toast('Opening a browser on the screen…')}catch(e){fail(e)}};

/* ---------- dragging: sidebar width, screen width, floating window move/resize ---------- */
(()=>{let drag=null;
 const shield=on=>{document.body.classList.toggle('dragging',on)};
 document.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-drag]');if(!h||e.button!==0||e.target.closest('button'))return;
  const kind=h.dataset.drag;const app=$('.app');const fl=$('#screenFloat');
  drag={kind,x0:e.clientX,y0:e.clientY,side:$('.side')?.offsetWidth,scr:$('#screenPane')?.offsetWidth,fx:fl?.offsetLeft,fy:fl?.offsetTop,fw:fl?.offsetWidth,app};
  e.preventDefault();shield(true);h.setPointerCapture?.(e.pointerId)});
 document.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;
  if(drag.kind==='side'){const w=Math.round(Math.max(220,Math.min(420,drag.side+dx)));drag.app.style.setProperty('--side-open',w+'px');drag.val=w}
  if(drag.kind==='screen'){const w=Math.round(Math.max(360,Math.min(innerWidth*.72,drag.scr-dx)));drag.app.style.setProperty('--screen-w',w+'px');drag.val=w}
  if(drag.kind==='float'){Screen.float.x=drag.fx+dx;Screen.float.y=drag.fy+dy;Screen.placeFloat()}
  if(drag.kind==='floatsize'){Screen.float.w=Math.max(300,Math.min(innerWidth-24,drag.fw+dx));Screen.placeFloat()}});
 const end=()=>{if(!drag)return;if(drag.kind==='side'&&drag.val)store.set('sideW',drag.val);if(drag.kind==='screen'&&drag.val)store.set('screenW',drag.val);if(drag.kind.startsWith('float'))store.set('screenFloat',Screen.float);drag=null;shield(false);placePills()};
 document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
 document.addEventListener('dblclick',e=>{const h=e.target.closest('[data-drag]');if(!h)return;const app=$('.app');if(h.dataset.drag==='side'){app.style.removeProperty('--side-open');store.set('sideW',null)}if(h.dataset.drag==='screen'){app.style.removeProperty('--screen-w');store.set('screenW',null)}});
 addEventListener('resize',()=>Screen.placeFloat());
})();
if(Screen.open)setTimeout(()=>Screen.watch(),300);
