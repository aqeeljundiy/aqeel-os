// Live screen: watch (and take over) the selected agent's own screen on the box, streamed with noVNC.
// Every agent has its own screen that starts when it browses and stops when idle, and its own AdsPower on it (1 Nov
// 2026: the AdsPower copy every agent shared on :99 is gone, and so is the picker's AdsPower screen). This panel is where
// an agent's AdsPower is started and stopped; Connections shows its row.
// Shown as a laptop, either docked beside the chat (resizable) or floating like a mini player.
const Screen={
 open:store.get('screenOpen',false),control:false,mode:store.get('screenMode','dock'),src_:store.get('screenSrc','box'),   // src_: 'box' (the AI box screen) or 'mine' (the agent's tab in my Chrome)
 float:store.get('screenFloat',{w:480,x:null,y:null}),
 st:null,ads:false,pick:null,list:[],_n:0,   // pick: an agent chosen in the picker (null = follow the chat); ads: never set any more (the shared AdsPower screen is gone)
 agent(){return S.profile||'default'},   // the screen is always the agent you chat with
 chatAgent(){return S.profile||'default'},
 off(){return !this.ads&&this.st&&this.st.agent===this.agent()&&this.st.kind==='desktop'&&!this.st.running},
 src(){return '/screen/vnc.html?autoconnect=1&reconnect=1&reconnect_delay=1500&resize=scale&show_dot=1&path='+encodeURIComponent('screen/websockify?agent='+this.agent()+(this.ads?'&screen=ads':''))+'&view_only='+(this.control?0:1)},
 async refresh(){const a=this.agent();try{const st=await call('','/ui/screens/'+encodeURIComponent(a));const was=this.st;this.st=st;
  if(!was||was.agent!==st.agent||was.running!==st.running||was.kind!==st.kind)this.paint(true)}catch{}
  this.adsLoad(a)},
 /* The agent's own AdsPower on this screen (1 Nov 2026): signed in, not signed in (the person signs in here, with Take
    over) or off (admins can start it). Drawn in its own small row, so the live screen is never reloaded for it. */
 adsSt:null,
 async adsLoad(a){if(this.src_!=='box'||this.ads){this.adsPaint();return}try{const r=await call('','/ui/screens/'+encodeURIComponent(a)+'/adspower');this.adsSt=r.state==='none'?null:r}catch{this.adsSt=null}this.adsPaint()},
 adsHtml(){const x=this.adsSt;if(!x||x.agent!==this.agent().split('--')[0]||this.src_!=='box'||this.ads)return '';
  const [c,t]={running:['ok','Signed in'],'signed-out':['warn','Not signed in'],starting:['','Starting…'],off:['','Off']}[x.state]||['',x.state];
  const tip={running:'Its AdsPower tool works. Profiles open as windows on this screen.','signed-out':'Press Take over and sign in to AdsPower on this screen yourself.',starting:'AdsPower is opening on this screen.',off:'AdsPower is not running for this agent.'}[x.state]||'';
  return `<b>AdsPower</b><span class="chip ${c}"><i class="dot"></i>${esc(t)}</span><span class="scr-ads-tip">${esc(tip)}</span>${x.state==='off'&&S.me?.admin?`<button class="small" data-act="ads-start" data-agent="${esc(x.agent)}">${icon('power',14)}Start AdsPower</button>`:''}`},
 adsPaint(){for(const el of document.querySelectorAll('#scrAds')){const h=this.adsHtml();if(el.dataset.h!==h){el.dataset.h=h;el.innerHTML=h}}},
 // While the screen is open, notice when the agent changes or its screen turns on/off by itself.
 watch(){clearInterval(this._t);if(!this.open)return;this.refresh();this.loadList().then(()=>this.paint(true));this._t=setInterval(()=>{if(document.hidden)return;if(++this._n%6===0)this.loadList();if(this.st?.agent!==this.agent()){this.st=null;this.ads=false}this.refresh()},5000)},
 // the agent started using AdsPower: show where AdsPower draws (only for agents that have their own screen)
 // which screen: every agent's own screen by name, or simply follow the chat's agent
 picker(){const ag=this.list.length?this.list:[{agent:this.chatAgent()}];
  const cur=this.pick||'';
  const opt=(v,l)=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(l)}</option>`;
  return `<select id="scrPick" class="scr-pick" aria-label="Which screen" title="Which screen to watch">${opt('','Follow this chat ('+ident(this.chatAgent()).name+')')}
   ${ag.map(x=>opt(x.agent,ident(x.agent).name+"'s screen"+(x.running===false?' · off':''))).join('')}</select>`},
 note(){if(this.ads&&this.st?.kind!=='shared')return 'AdsPower';if(this.pick&&this.pick!==this.chatAgent())return 'Other agent';return ''},
 noteTip(){return 'Not the agent of this chat'},
 async loadList(){try{this.list=(await call('','/ui/screens')).screens||[]}catch{}},
 choose(v){this.ads=v==='ads';this.pick=v&&v!=='ads'?v:null;this.st=null;this.paint(true);this.refresh()},
 toggle(){this.open=!this.open;store.set('screenOpen',this.open);this.paint(true);this.watch();this.mirror();paintTop()},
 /* My browser view: a live picture of the agent's tab in your Chrome (the aqeelOS extension sends it), every 1.5 s
    while this view is open and the page is visible. Take over brings that tab to the front. */
 // a Chrome that is linked but asleep (lid closed, Chrome in the background) answers nothing: after a few silent
 // tries it says so plainly instead of spinning on a broken picture
 mirror(){clearInterval(this._m);if(!this.open||this.src_!=='mine')return;let quiet=0,shown=false;const tick=async()=>{if(document.hidden||!$('#lbNote'))return;let f={};try{f=await call('','/ui/local-browser/frame?session='+encodeURIComponent(Chat.id||'')+'&title='+encodeURIComponent(chatTitle(Chat.id)))}catch{f={error:true}}
   const img=$('#lbImg'),note=$('#lbNote'),bar=$('#lbBar');if(!note)return;
   if(!img.onerror)img.onerror=()=>{img.hidden=true;note.hidden=false;shown=false};
   const say=(html,btn)=>{img.hidden=true;note.hidden=false;shown=false;const h=html+(btn||'');if(note.dataset.h!==h){note.dataset.h=h;note.innerHTML=h}};
   const steps='<ol class="lb-steps"><li>Open Chrome on your computer (wake it up if it is asleep).</li><li>Click the aqeelOS icon in the toolbar and make sure it says Connected.</li></ol>';
   const silent=f.error||f.timeout||(f.connected&&!f.none&&!f.inactive&&!f.data);
   if(silent){if(++quiet<3&&!shown)return say('<span class="spinner"></span><span>Connecting to your browser…</span>');if(shown)return;
    return say(f.error?'<b>aqeelOS can’t be reached right now</b><span>Check your internet connection. It tries again by itself.</span>':'<b>Your browser isn’t answering</b><span>Chrome is closed, asleep, or the extension lost its connection.</span>'+steps,'<button data-act="lb-retry">'+icon('refresh',15)+'Try again</button>')}
   quiet=0;
   if(!f.connected)return say('<b>Your browser isn’t connected</b><span>Agents can work in your own Chrome when you choose “My browser”. It needs the aqeelOS extension, installed once.</span>'+steps,'<button class="primary" data-act="browser-setup">'+icon('globe',15)+'Set it up</button>');
   if(f.none)return say('<b>No agent is using your browser yet</b><span>When an agent asks where to browse, pick “My browser”. Its tab shows up here.</span>');
   bar.innerHTML=esc(f.title||'')+(f.url?' · <span class="lb-url">'+esc(f.url)+'</span>':'');
   if(f.inactive)return say('<b>The agent’s tab is in the background</b><span>Another tab is in front in that Chrome window.</span>','<button data-act="lb-focus">'+icon('mouse',15)+'Show it</button>');
   if(f.data){img.src=f.data;img.hidden=false;note.hidden=true;note.dataset.h='';shown=true}};tick();this._m=setInterval(tick,1500);this._mt=tick},
 setMode(m){this.mode=m;store.set('screenMode',m);this.paint(true)},
 setControl(on){this.control=on;this.paint(true);if(on)setTimeout(()=>$('#scrFrame')?.focus(),400)},
 seg(){return `<span class="scr-seg" role="tablist" aria-label="Which screen"><button class="${this.src_==='box'?'on':''}" data-act="scr-src" data-v="box" title="The agent's screen on the AI box">AI box</button><button class="${this.src_==='mine'?'on':''}" data-act="scr-src" data-v="mine" title="The agent's tab in your own Chrome">My browser</button></span>`},
 setSrc(v){this.src_=v;store.set('screenSrc',v);this.paint(true);this.mirror()},
 head(compact){const c=this.control;if(this.src_==='mine')return `<div class="screen-head ${compact?'compact':''}" ${compact?'data-drag="float"':''}><b>${icon('monitor',16)}</b>${this.seg()}<span class="grow"></span>
  <button data-act="lb-focus" title="Bring the agent's tab to the front in Chrome">${icon('mouse',15)}<span>Take over</span></button>
  <button class="ghost icon" data-act="scr-mode" title="${this.mode==='float'?'Dock beside the chat':'Float over the chat'}" aria-label="${this.mode==='float'?'Dock':'Float'}">${icon(this.mode==='float'?'dock':'pip',17)}</button>
  <button class="ghost icon" data-act="screen" title="Close" aria-label="Close screen">${icon('x',18)}</button></div>`;
  return `<div class="screen-head ${compact?'compact':''}" ${compact?'data-drag="float"':''}><b>${icon('monitor',16)}</b>${this.seg()}${this.off()?'<span class="chip"><i class="dot"></i>Off</span>':`<span class="chip ${c?'warn':'ok'}"><i class="dot"></i>${c?'You are in control':'Watching'}</span>`}${this.note()?`<span class="chip warn scr-note" title="${esc(this.noteTip())}">${esc(this.note())}</span>`:''}<span class="grow"></span>
  ${this.off()?'':`<button class="${c?'primary':''}" data-act="scr-control" title="${c?'Give control back':'Use mouse and keyboard on the screen'}">${icon('mouse',15)}<span>${c?'Done':'Take over'}</span></button>`}
  ${compact||this.off()?'':`<button class="ghost icon" data-act="scr-browser" title="Open a browser window" aria-label="Open a browser window">${icon('globe',17)}</button>`}
  <button class="ghost icon" data-act="scr-mode" title="${this.mode==='float'?'Dock beside the chat':'Float over the chat'}" aria-label="${this.mode==='float'?'Dock':'Float'}">${icon(this.mode==='float'?'dock':'pip',17)}</button>
  ${compact?'':`<button class="ghost icon" data-act="scr-pop" title="Open in its own tab" aria-label="Open in its own tab">${icon('popout',17)}</button>`}
  <button class="ghost icon" data-act="screen" title="Close" aria-label="Close screen">${icon('x',18)}</button></div>`},
 laptop(){if(this.src_==='mine')return `<div class="screen-stage"><div class="laptop"><div class="lid"><span class="cam"></span><div class="lcd lb-mirror"><img id="lbImg" alt="The agent's tab in your browser" hidden><div id="lbNote" class="lb-note"><span class="spinner"></span></div></div></div></div><div class="screen-hint lb-bar" id="lbBar">Looking for your browser…</div></div>`;
  const n=esc(ident(this.agent()).name);if(this.off())return `<div class="screen-stage"><div class="laptop"><div class="lid"><span class="cam"></span><div class="lcd scr-off"><div>${icon('monitor',28)}<b>${n}'s screen is off</b><span>It turns on by itself when ${n} opens a browser, and off again after 15 quiet minutes.</span><button class="primary" data-act="scr-start">${icon('power',15)}Turn on now</button></div></div></div></div></div>`;
  return `<div class="screen-stage"><div class="laptop"><div class="lid"><span class="cam"></span><div class="lcd"><iframe id="scrFrame" title="Live screen of ${n}" src="${this.src()}" allow="clipboard-read; clipboard-write"></iframe></div></div></div>${this.control?'<div class="screen-hint">You are in control. Ctrl+V pastes your text into the screen; copying on the screen copies to this computer.</div>':'<div class="screen-hint">Watching only. Press Take over to click and type.</div>'}</div>`},
 paint(force){const pane=$('#screenPane'),app=$('.app');if(!pane||!app)return;
  // switched to another agent: show that agent's screen
  if(this._for&&this._for!==this.agent()){this._for=this.agent();this.st=null;this.pick=null;if(this.open){force=true;this.refresh()}}else this._for=this.agent();
  const docked=this.open&&this.mode==='dock',floating=this.open&&this.mode==='float';
  app.classList.toggle('screen-open',docked);pane.hidden=!docked;
  let fl=$('#screenFloat');
  if(!floating&&fl){fl.remove();fl=null}
  if(!docked)pane.innerHTML='';
  if(docked&&(force||!pane.querySelector('iframe'))){pane.innerHTML=`<div class="resizer" data-drag="screen" title="Drag to resize"></div>${this.head(false)}<div class="scr-ads" id="scrAds"></div>${this.laptop()}`;this.tidy();this.adsPaint()}
  if(floating&&(force||!fl)){if(!fl){fl=document.createElement('div');fl.id='screenFloat';fl.className='screen-float';document.body.append(fl)}
   fl.innerHTML=`${this.head(true)}<div class="scr-ads" id="scrAds"></div>${this.laptop()}<div class="corner" data-drag="floatsize" title="Drag to resize"></div>`;this.placeFloat();this.tidy();this.adsPaint()}
  const sw=store.get('screenW',null);if(sw)app.style.setProperty('--screen-w',sw+'px');
 },
 placeFloat(){const fl=$('#screenFloat');if(!fl)return;const w=Math.max(300,Math.min(this.float.w||480,innerWidth-24));fl.style.width=w+'px';
  const h=fl.offsetHeight||w*.78;let x=this.float.x??innerWidth-w-24,y=this.float.y??innerHeight-h-24;x=Math.max(12,Math.min(x,innerWidth-w-12));y=Math.max(12,Math.min(y,innerHeight-h-12));fl.style.left=x+'px';fl.style.top=y+'px'},
 // The stream page is same-origin, so its own toolbar can be hidden: only the screen should show.
 tidy(){const f=$('#scrFrame');if(!f)return;f.onload=()=>{try{const d=f.contentDocument;const st=d.createElement('style');st.textContent='#noVNC_control_bar_anchor,#noVNC_control_bar,#noVNC_control_bar_hint,#noVNC_status{display:none!important}html,body,#noVNC_container{background:#0b0c10!important}';d.head.append(st)}catch{}this.clipboard(f)}},
 /* Copy and paste with the remote screen. Ctrl+V: your text is typed into the field that has focus there (the
    remote's own clipboard is not involved, so it always pastes what you copied). Copying inside the screen puts
    that text on this computer's clipboard. Only while you are in control. */
 clipboard(f){const w=f.contentWindow,d=f.contentDocument;if(!w||!d||w.__aqClip)return;w.__aqClip=1;let pasted=0;
  w.addEventListener('keydown',e=>{if(!this.control||!(e.ctrlKey||e.metaKey)||e.altKey||e.key.toLowerCase()!=='v')return;
   e.stopImmediatePropagation();const t0=Date.now();   // noVNC must not send Ctrl+V itself; the browser's paste follows
   setTimeout(()=>{if(pasted>=t0)return;w.navigator.clipboard?.readText?.().then(t=>{if(t)this.typeText(t)}).catch(()=>toast('Allow clipboard access for this site to paste into the screen','err'))},200)},true);
  d.addEventListener('paste',e=>{if(!this.control)return;const t=e.clipboardData?.getData('text');if(!t)return;e.preventDefault();e.stopImmediatePropagation();pasted=Date.now();this.typeText(t)},true);
  const ta=d.getElementById('noVNC_clipboard_text');let last=ta?.value||'';
  clearInterval(this._clip);if(ta)this._clip=setInterval(()=>{if(!ta.isConnected){clearInterval(this._clip);return}if(ta.value===last)return;last=ta.value;if(!last||!this.control)return;
   w.navigator.clipboard?.writeText(last).then(()=>toast('Copied from the screen'),()=>navigator.clipboard?.writeText(last).then(()=>toast('Copied from the screen'),()=>{}))},600)},
 async typeText(t){if(t.length>8000)return toast('That is too long to paste (8,000 characters at most)','err');
  try{await post((p,o)=>call('',p,o),'/ui/screens/'+encodeURIComponent(this.agent())+'/type'+(this.ads?'?screen=ads':''),{text:t});toast('Pasted into the screen')}catch(e){fail(e)}},
};
ACT['screen']=()=>Screen.toggle();
document.addEventListener('change',e=>{if(e.target.id==='scrPick')Screen.choose(e.target.value)});
ACT['scr-control']=()=>Screen.setControl(!Screen.control);
ACT['scr-mode']=()=>Screen.setMode(Screen.mode==='float'?'dock':'float');
ACT['scr-pop']=()=>window.open(Screen.src().replace('view_only=1','view_only=0'),'_blank','noopener');
ACT['scr-start']=async a=>{a.disabled=true;a.innerHTML='<span class="spinner"></span>Turning on…';try{Screen.st=await post((p,o)=>call('',p,o),'/ui/screens/'+encodeURIComponent(Screen.agent())+'/start');Screen.paint(true)}catch(e){fail(e);a.disabled=false;a.textContent='Turn on now'}};
// start an agent's own AdsPower (admins), from the screen or from Connected accounts
ACT['ads-start']=async a=>{const ag=a.dataset.agent;a.disabled=true;a.innerHTML='<span class="spinner tiny"></span>Starting…';try{const r=await post((p,o)=>call('',p,o),'/ui/screens/'+encodeURIComponent(ag)+'/adspower/start');if(Screen.agent().split('--')[0]===ag){Screen.adsSt=r;Screen.adsPaint()}toast('AdsPower is starting on '+ident(ag).name+'’s screen');if(route().page?.id==='logins')reload()}catch(e){a.disabled=false;a.innerHTML=icon('power',14)+'Start AdsPower';fail(e)}};
ACT['ads-stop']=async a=>{const ag=a.dataset.agent;a.disabled=true;try{await post((p,o)=>call('',p,o),'/ui/screens/'+encodeURIComponent(ag)+'/adspower/stop');toast('AdsPower stopped for '+ident(ag).name);reload()}catch(e){a.disabled=false;fail(e)}};
// open an agent's screen on the AI box in its own tab, ready to click and type (to sign in to its AdsPower)
ACT['ads-screen']=a=>window.open('/screen/vnc.html?autoconnect=1&reconnect=1&reconnect_delay=1500&resize=scale&show_dot=1&path='+encodeURIComponent('screen/websockify?agent='+a.dataset.agent)+'&view_only=0','_blank','noopener');
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
if(Screen.open)setTimeout(()=>{Screen.watch();Screen.mirror()},300);
ACT['scr-src']=a=>{Screen.setSrc(a.dataset.v);paintTop()};
// the two top-bar buttons: each opens the panel on its screen, or closes it when that screen is already showing
const openScreen=v=>{if(Screen.open&&Screen.src_===v){Screen.toggle();return}Screen.src_=v;store.set('screenSrc',v);if(!Screen.open)Screen.toggle();else{Screen.paint(true);Screen.mirror();paintTop()}};
ACT['screen-box']=()=>openScreen('box');ACT['screen-mine']=()=>openScreen('mine');
ACT['lb-focus']=async()=>{try{const r=await post((p,o)=>call('',p,o),'/ui/local-browser/focus?session='+encodeURIComponent(Chat.id||''));if(r.offline)toast('Your browser isn’t connected','err');else if(r.none)toast('No agent tab yet','err');else toast('Brought to the front in Chrome')}catch(e){fail(e)}};
ACT['lb-retry']=()=>{const n=$('#lbNote');if(n){n.dataset.h='';n.innerHTML='<span class="spinner"></span><span>Connecting to your browser…</span>'}Screen.mirror()};
