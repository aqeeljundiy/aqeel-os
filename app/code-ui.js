// Code: the aqeelOS Code desktop app (on this computer) shown inside aqeelOS. The aqeelOS sidebar stays; under it
// the app's projects and chats; the main area is the app itself (chat, preview, artifacts, files, changes, browser).
// No app on this computer: Code is locked with the downloads for Windows and Mac, and opens once the app answers.
// The page and the app talk only by messages (hello, pair, open, new chat, theme, language; the app sends its state).
const CODE_APP='http://127.0.0.1:4321';
const CodeUI={where:(()=>{try{const w=localStorage.getItem('aq-code-where');return w==='online'||w==='live'?'live':'computer'}catch{return 'computer'}})(),live:null,app:CODE_APP,st:{projects:[],project:'',chat:''},state:'wait',open:{},q:'',filter:'All',frame:null,timer:null,
 post(m){this.frame?.contentWindow?.postMessage(m,this.app)},
 // this computer (the desktop app) or online (the copy on the AI box, behind sign-in)
 online(){return true},   // everyone: online projects are private to each person until their owner shares them
 // the bottom-left card in Code: Code's agent (No agent by default) and its model
 agentCard(){const a=(this.st.agents||[]).find(x=>x.id===this.st.agent);return {id:a?a.id:'',name:a?a.name:'No agent',model:this.st.model||'Default',none:!a}},
 whereBar(){if(!this.online())return '';return `<div class="code-where" role="tablist" aria-label="Build or Live">${[['computer','Build','terminal'],['live','Live','globe']].map(([k,t,i])=>`<button role="tab" aria-selected="${this.where===k}" class="${this.where===k?'on':''}" data-act="code-where" data-w="${k}">${icon(i,14)}${t}</button>`).join('')}</div>`},
 // the left list, under the aqeelOS sections, like the chat list
 sidebar(){if(this.where==='live')return this.liveSide();const ps=this.st.projects||[],q=this.q.toLowerCase();
  if(this.state==='lock')return `<div class="side-sub">${this.whereBar()}<p class="hint" style="margin:6px 18px">${/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)?"Your projects show here in the desktop app on your computer.":"Install aqeelOS Code on this computer to see your projects here."}</p></div>`;
  if(this.state!=='on')return `<div class="side-sub">${this.whereBar()}<div class="code-skel" role="status" aria-label="${this.where==='online'?'Opening your online projects':'Connecting to aqeelOS Code'}"><span class="ring"></span><i></i><i></i><i></i></div></div>`;
  const chats=p=>(p.chats||[]).filter(c=>(!q||(c.title+' '+p.name).toLowerCase().includes(q))&&(this.filter!=='Active'||c.busy)&&(this.filter!=='Unread'||c.unread)).sort((a,b)=>(b.updated||0)-(a.updated||0));
  return `<div class="side-sub">${this.whereBar()}<div style="padding:4px 12px 8px"><button style="width:100%" data-act="code-new">${icon('plus',16)}New chat</button></div>
   <div class="side-search">${icon('search',16)}<input id="codeQ" placeholder="Search chats" value="${esc(this.q)}" aria-label="Search chats"></div>
   <div class="code-filter">${['All','Active','Unread'].map(f=>`<button class="${this.filter===f?'on':''}" data-act="code-filter" data-f="${f}">${f}</button>`).join('')}</div>
   <div class="side-list code-tree">${ps.map(p=>{const open=this.open[p.id]??p.id===this.st.project,cs=chats(p);if(q&&!cs.length&&!p.name.toLowerCase().includes(q))return '';
    return `<div class="code-proj${p.id===this.st.project?' on':''}"><button class="item code-p" data-act="code-proj" data-id="${esc(p.id)}" aria-expanded="${open}">${icon(open?'chevD':'chevR',14)}${icon('folder',15)}<span class="t">${esc(p.name)}</span><span class="n">${cs.length||''}</span></button><button class="code-more" data-act="code-menu" data-p="${esc(p.id)}" aria-label="Project actions for ${esc(p.name)}" title="Project actions">${icon('more',15)}</button>
     ${open?`<div class="code-chats">${cs.map(c=>`<div class="code-row"><button class="item code-c${c.id===this.st.chat?' on':''}" data-act="code-chat" data-p="${esc(p.id)}" data-c="${esc(c.id)}">${c.busy?'<i class="spinner tiny"></i>':c.unread?'<i class="code-dot" aria-label="Unread"></i>':''}<span class="t">${esc(c.title)}</span>${c.from?`<small class="code-from">from ${esc(c.from)}</small>`:''}</button><button class="code-more" data-act="code-menu" data-p="${esc(p.id)}" data-c="${esc(c.id)}" aria-label="Chat actions for ${esc(c.title)}" title="Chat actions">${icon('more',15)}</button></div>`).join('')||'<p class="hint" style="margin:4px 34px">No chats yet</p>'}</div>`:''}</div>`}).join('')||`<div class="code-empty"><span class="code-empty-ic">${icon('folder',18)}</span><b>Start your first project</b><p>Code works inside a project folder. Make one or open one you have, then chat.</p><button class="ghost small" data-act="code-newproj">${icon('plus',14)}New project</button></div>`}</div>
   <div class="code-foot"><button class="ghost small" data-act="code-newproj">${icon('folder',14)}New project</button>${(this.old||[]).length?`<button class="ghost small" data-act="oldcode-open" title="Sign-ins Code made by itself on the AI box">${icon('user',14)}Old sign-ins</button>`:''}</div></div>`},
 paintSide(){if(route().sec?.id!=='code')return;const s=$('.side .side-sub');const h=this.sidebar();if(s)s.outerHTML=h;const i=$('#codeQ');if(i)i.oninput=e=>{this.q=e.target.value;const pos=e.target.selectionStart;this.paintSide();const n=$('#codeQ');n?.focus();n?.setSelectionRange(pos,pos)}},
 // the page: the app in a frame, or the lock screen
 async page(p,el){const pg=el.closest('.page');pg?.classList.add('page-full');setActions('');clearTimeout(this.timer);if(this.old==null){this.old=[];this.oldLoad()}
  if(this.where==='live')return this.livePage(el);
  if(!CodeUI._dl){CodeUI._dl=true;document.addEventListener('click',async e=>{const a=e.target.closest?.('a[href^="/ui/code/download/"]');if(!a||a.dataset.ok)return;e.preventDefault();
   try{const r=await UI(a.getAttribute('href')+'?check=1');if(r.ok){a.dataset.ok='1';a.click();delete a.dataset.ok}else toast('The aqeelOS app for '+(/mac$/.test(a.getAttribute('href'))?'Mac':'Windows')+' isn’t ready yet. Ask an admin.','err')}catch(er){fail(er)}},true)}
  // Code works in the aqeelOS app (its real browser lives there); in a normal browser, open the app or get it
  // an iPad in desktop mode reports a Mac: touch points give it away
  const phone=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent));
  if(!window.aqDesktop&&!phone){this.state='lock';this.paintSide();const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
   el.innerHTML=`<div class="code-host"><div class="code-lock card"><span class="code-lock-ic">${icon('monitor',26)}</span><h2>Code works in the aqeelOS app</h2><p>Code builds with a real browser for your projects, which lives in the aqeelOS app on your computer. Open the app to use Code; everything else in aqeelOS works here too.</p>
    <div class="code-dl"><a class="btn primary" href="aqeelos://code">${icon('popout',16)}Open the aqeelOS app</a><a class="btn" href="/ui/code/download/${mac?'mac':'windows'}" download>${icon('download',16)}Download for ${mac?'Mac':'Windows'}</a></div>
    <p class="code-or">Just looking? <button class="linkish" data-act="code-where" data-w="live">See what’s live</button>: the apps your team published.</p></div></div>`;return}
  // on a phone or tablet there is no desktop app to find: say so, and offer what works here (Live)
  if(phone){this.state='lock';this.paintSide();el.innerHTML=`<div class="code-host"><div class="code-lock card"><span class="code-lock-ic">${icon('monitor',26)}</span><h2>Code runs in the desktop app</h2><p>Building apps, slides and documents with Code needs the aqeelOS Code app on a Windows or Mac computer. Open aqeelOS on your computer to install it there.</p><p class="code-or">On this phone you can <button class="linkish" data-act="code-where" data-w="live">see what’s live</button>: the apps your team published.</p></div></div>`;return}
  el.innerHTML=`<div class="code-host"><div class="code-wait"><span class="ring"></span><span>${this.where==='online'?'Opening your online projects…':'Looking for aqeelOS Code on this computer…'}</span></div>
   <iframe class="code-frame" title="aqeelOS Code" allow="local-network-access; clipboard-read; clipboard-write; microphone" hidden></iframe></div>`;
  const f=el.querySelector('iframe');this.frame=f;this.state='wait';this.paintSide();
  f.onload=()=>{this.post({aq:'hello'});if(this.where==='online')return;clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},3500)};
  if(!this.online())this.where='computer';
  if(this.where==='online'){try{const r=await UI('/ui/code/online');this.app=r.origin;f.src=r.url}catch(e){this.app='';el.querySelector('.code-host').innerHTML=`<div class="code-lock card"><h2>Online projects aren’t available</h2><p>${esc(e.message)}</p></div>`;return}
   clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.state!=='on'&&el.isConnected){el.querySelector('.code-wait span:last-child')&&(el.querySelector('.code-wait span:last-child').textContent='The online copy is slow to answer. It starts by itself; this page retries.');this.timer=setTimeout(()=>this.page(p,el),8000)}},15000);return}
  if(window.aqDesktop&&!this._frameRep){{const off=()=>window.aqDesktop.frame({visible:false});addEventListener('pagehide',off);addEventListener('beforeunload',off)}this._frameRep=setInterval(()=>{const fr=this.frame,on=fr&&fr.isConnected&&!fr.hidden&&route().sec?.id==='code';const overlays=[...document.querySelectorAll('.menu,.drawer,dialog[open],.palette:not([hidden]),.scrim,.cron-pop,.toast')].filter(e=>e.offsetWidth).map(e=>{const r=e.tagName==='DIALOG'||e.classList.contains('scrim')?{left:0,top:0,width:innerWidth,height:innerHeight}:e.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height}});
    if(!on){window.aqDesktop.frame({visible:false});return}const r=fr.getBoundingClientRect();window.aqDesktop.frame({x:r.left,y:r.top,width:r.width,height:r.height,visible:true,overlays})},250);document.documentElement.classList.add('aq-desktop')}
  this.app=CODE_APP;f.src=CODE_APP+'/?embed=aqeelos';this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},9000)},
 // the app answers a ping every 10 s; if it stops (it quit, the computer slept), Code waits for it again
 beat(){clearInterval(this.hb);this.hb=setInterval(()=>{const el=this.frame?.closest('#pg');if(!el?.isConnected||route().sec?.id!=='code'){clearInterval(this.hb);return}
   if(this.state==='on'&&Date.now()-(this.seen||0)>25000){clearInterval(this.hb);this.state='wait';this.paintSide();this.page(null,el)}else this.post({aq:'ping'})},10000)},
 lock(el){if(!el.isConnected||route().sec?.id!=='code')return;this.state='lock';this.paintSide();const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  let seen=false;try{seen=localStorage.getItem('aq-code-seen')==='1'}catch{}
  // a phone can't run the app: no Windows or Mac download there, the link goes to the person's computer instead
  const phone=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||matchMedia('(hover:none) and (pointer:coarse)').matches;
  if(phone){el.querySelector('.code-host').innerHTML=`<div class="code-lock card">
   <span class="code-lock-ic">${icon('terminal',26)}</span><h2>Code runs on a computer</h2>
   <p>Code builds apps, websites, decks, docs and designs with a live preview, in the aqeelOS Code app on Windows or Mac. Open this page on your computer to install it there.</p>
   <div class="code-dl"><button class="primary" data-act="code-send-link">${icon('copy',16)}Send the link to my computer</button></div>
   ${this.online()?'':'<!--'}<p class="code-or">Just looking? <button class="linkish" data-act="code-where" data-w="live">See what’s live</button>: apps your team published.</p>${this.online()?'':'-->'}</div>`;return}
  el.querySelector('.code-host').innerHTML=seen?`<div class="code-lock card">
   <span class="code-lock-ic">${icon('terminal',26)}</span><h2>aqeelOS Code isn’t running on this computer</h2>
   <p>It is installed here but not answering: the computer may have just started or woken up, or the app was closed.</p>
   <ol class="code-steps"><li>${mac?'It starts by itself when you log in to your Mac. If it doesn’t, run the installer from the download again: it starts it and keeps your projects.':'Open the <b>Start menu</b> and choose <b>aqeelOS Code</b>.'}</li><li>Code opens here by itself as soon as it answers.</li></ol>
   <p class="code-perm hint" hidden></p>
   <p class="hint code-retry"><span class="spinner tiny"></span>Waiting for the app…</p>
   <details class="code-new"><summary>Not installed on this computer?</summary><div class="code-dl"><a class="btn" href="/ui/code/download/windows" download>${icon('download',16)}Download for Windows</a><a class="btn" href="/ui/code/download/mac" download>${icon('download',16)}Download for Mac</a></div></details></div>`:`<div class="code-lock card">
   <span class="code-lock-ic">${icon('terminal',26)}</span><h2>Code needs the aqeelOS Code app on this computer</h2>
   <p>Code builds apps, websites, decks, docs and designs with a live preview and its own guarded browser, using your agents and everything connected to aqeelOS. It runs on your own computer, so install it once.</p>
   <div class="code-dl"><a class="btn ${mac?'':'primary'}" href="/ui/code/download/windows" download>${icon('download',16)}Download for Windows</a><a class="btn ${mac?'primary':''}" href="/ui/code/download/mac" download>${icon('download',16)}Download for Mac</a></div>
   ${mac?'<ol class="code-steps"><li>Open <b>aqeelOS.dmg</b> and drag <b>aqeelOS</b> into Applications. It runs on Apple Silicon and Intel Macs.</li><li>Open it. The first time macOS stops it (the app isn’t from the App Store): go to <b>System Settings › Privacy &amp; Security</b> and choose <b>Open Anyway</b>. <a href="https://github.com/aqeeljundiy/aqeel-os/blob/main/docs/install-mac.md" target="_blank" rel="noopener">Step by step</a></li><li>Sign in there. Code works in the app, with a real built-in browser for your projects, and the app keeps Code up to date by itself.</li></ol>':'<ol class="code-steps"><li>Open <b>aqeelOS Setup</b>. It installs the aqeelOS app and opens it (Windows may ask first: More info › Run anyway).</li><li>Sign in there. Code works in the app, with a real built-in browser for your projects.</li><li>The app keeps Code up to date by itself.</li></ol>'}
   <p class="code-perm hint" hidden></p>
   <p class="hint code-retry"><span class="spinner tiny"></span>Waiting for the app… this opens by itself once it runs.</p>
   ${this.online()?'':'<!--'}<p class="code-or">Just looking? <button class="linkish" data-act="code-where" data-w="live">See what’s live</button>: apps your team published.</p>${this.online()?'':'-->'}</div>`;
  // Chrome asks before a website may reach apps on this computer; once refused, Code stays locked until it is allowed
  (async()=>{let st='';for(const n of ['local-network-access','loopback-network']){try{st=(await navigator.permissions.query({name:n})).state;break}catch{}}
   const box=el.querySelector('.code-perm');if(!box)return;
   if(st==='denied'){box.hidden=false;box.innerHTML=`${icon('alert',14)}<span>This browser is blocking aqeelOS from reaching apps on this computer. Click the icon left of the address bar › <b>Site settings</b> › <b>Local network access</b> › <b>Allow</b>, then reload. Already installed the app? This is why Code stays locked.</span>`}
   else if(st==='prompt'){box.hidden=false;box.innerHTML=`${icon('shield',14)}<span>When the app runs, Chrome asks whether aqeelOS may reach apps on this computer. Choose <b>Allow</b>.</span>`}})();
  // keep checking quietly while the page is open
  clearTimeout(this.timer);this.timer=setTimeout(()=>{if(route().sec?.id==='code'&&this.state==='lock')this.page(null,el.closest('#pg')||el)},6000)},
 async onMessage(e){if(!this.app||e.origin!==this.app||!e.data?.cba)return;const m=e.data;
  if(m.type==='pong'){this.seen=Date.now();return}
  if(m.type==='openModels'){go('/models/models');return}
  if(m.type==='openFiles'&&m.path&&this.where==='online'){if(typeof fAgent==='function')S._fileAgent=fAgent();S.filePath=String(m.path);S._placesOk=null;go('/agents/files');return}
  if(m.type==='hello'){try{if(this.where!=='online')localStorage.setItem('aq-code-seen','1')}catch{}clearTimeout(this.timer);this.state='on';this.seen=Date.now();this.beat();this.st={projects:m.projects||[],project:m.project,chat:m.chat,agent:m.agent||'',agents:m.agents||[],model:m.model||''};setTimeout(()=>typeof paintSide==='function'&&paintSide());
   const f=this.frame;if(f){f.hidden=false;f.closest('.code-host')?.querySelector('.code-wait')?.remove()}
   this.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});if(typeof Brand!=='undefined'&&Brand.custom)this.post({aq:'brand',name:Brand.name});this.post({aq:'lang',lang:(typeof Lang!=='undefined'&&Lang.cur)||'en'});this.post({aq:'currency',code:currency(),rate:FX.rate});
   this.post({aq:'viewing',id:S.profile||'default'});   // the agent you are on here is Code's agent for a project nobody chose one for yet
   if(this.handoff){const id=this.handoff;this.handoff=null;UI('/ui/code/handoff?id='+encodeURIComponent(id)).then(h=>this.post({aq:'prefill',prompt:h.text,agent:h.agent})).catch(fail)}
   if(!m.paired&&this.where!=='online'){try{const r=await post(UI,'/ui/code/pair',{name:(/Mac/i.test(navigator.platform)?'Mac':/Win/i.test(navigator.platform)?'Windows PC':'Computer')+(()=>{const b=navigator.userAgentData?.brands?.find(b=>/Chrome|Edge/.test(b.brand))?.brand;return b?' · '+b:''})()});this.post({aq:'pair',token:r.token,base:location.origin})}catch(er){fail(er)}}
   this.paintSide()}
  if(m.type==='state'){const st={projects:m.projects||[],project:m.project,chat:m.chat,agent:m.agent||'',agents:m.agents||[],model:m.model||''};if(JSON.stringify(st)===JSON.stringify(this.st))return;const foot=st.agent!==this.st.agent||st.model!==this.st.model||JSON.stringify(st.agents)!==JSON.stringify(this.st.agents);this.st=st;this.paintSide();if(foot&&typeof paintSide==='function')paintSide()}
  if(m.type==='paired'){if(m.ok)toast('This computer is paired with aqeelOS');else toast('Pairing didn’t work: '+(m.error||'unknown'),'err')}
  if(m.type==='error')toast(m.error,'err')}};
addEventListener('message',e=>CodeUI.onMessage(e));
// "Open in Code" from a chat (#/code/code/<id>): Build opens, and once the app answers it gets the request and the agent
PAGES.code=(p,el)=>{const id=route().arg?.[0]||'';if(/^[\w-]{10,40}$/.test(id)){CodeUI.handoff=id;CodeUI.where='computer';history.replaceState(null,'','#/code/code')}return CodeUI.page(p,el)};
ACT['code-new']=()=>CodeUI.post({aq:'newChat',project:CodeUI.st.project});
ACT['code-newproj']=()=>CodeUI.post({aq:'newProject'});
ACT['code-chat']=a=>{CodeUI.st.project=a.dataset.p;CodeUI.st.chat=a.dataset.c;CodeUI.post({aq:'open',project:a.dataset.p,chat:a.dataset.c});CodeUI.paintSide()};
ACT['code-proj']=a=>{const id=a.dataset.id,was=CodeUI.open[id]??id===CodeUI.st.project;CodeUI.open[id]=!was;if(!was&&id!==CodeUI.st.project)CodeUI.post({aq:'open',project:id});CodeUI.paintSide()};
ACT['code-where']=a=>{CodeUI.where=a.dataset.w;try{localStorage.setItem('aq-code-where',CodeUI.where)}catch{}CodeUI.st={projects:[],project:'',chat:''};CodeUI.state='wait';const el=$('#pg .code-host')?.parentElement||$('#pg');if(el)CodeUI.page(null,el);CodeUI.paintSide()};
// from other pages: open Code on Live, whichever tab was used last
// phone: share sheet when there is one (mail it, message it to yourself), else the link is copied
ACT['code-send-link']=async()=>{const url=location.origin+'/#/code/code';
 if(navigator.share){try{await navigator.share({title:'aqeelOS Code',text:'Open this on your computer to install aqeelOS Code',url});return}catch(e){if(e?.name==='AbortError')return}}
 copyText(url,'Link copied. Open it on your computer.')};
ACT['code-open-live']=()=>{CodeUI.where='live';try{localStorage.setItem('aq-code-where','live')}catch{}go('/code/code')};
ACT['code-menu']=a=>{const f=CodeUI.frame;if(!f)return;const y=a.getBoundingClientRect().top-f.getBoundingClientRect().top;CodeUI.post({aq:'menu',project:a.dataset.p,chat:a.dataset.c||'',y})};
ACT['code-filter']=a=>{CodeUI.filter=a.dataset.f;CodeUI.paintSide()};
// the theme switch follows into the app
{const t0=theme;theme=(...a)=>{const r=t0(...a);CodeUI.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});return r}}

// Live: the apps published from Code (Build › a project's menu › Publish to Live), each at its own address
Object.assign(CodeUI,{
 stLabel:{live:'Live',building:'Publishing…',failed:'Didn’t start',offline:'Offline'},
 liveSide(){const apps=this.live?.apps||[];
  return `<div class="side-sub">${this.whereBar()}<div class="side-list live-side">${this.live?apps.map(a=>`<button class="item" data-act="live-jump" data-id="${esc(a.id)}"><i class="live-dot ${esc(a.status)}"></i><span class="t">${esc(a.name)}</span></button>`).join('')||`<div class="live-none"><span class="ln-ico">${icon("globe",20)}</span><b>Nothing is live yet</b><p>Publish a project from Build and it shows up here with its link.</p><button class="btn ln-go" data-act="code-where" data-w="computer">${icon("terminal",14)}Go to Build</button></div>`:'<div class="code-skel" role="status" aria-label="Loading"><span class="ring"></span><i></i><i></i></div>'}</div></div>`},
 async livePage(el){this.frame=null;this.state='live';
  if(!this.live)el.innerHTML=`<div class="code-host live-host"><div class="code-wait"><span class="ring"></span><span>Loading what’s live…</span></div></div>`;
  // the person may have switched to Build or left Code while this loaded: then leave the page alone
  const gone=()=>this.where!=='live'||!el.isConnected||route().sec?.id!=='code';
  // team folders (Plan 4) load beside the apps; without them the page still shows what is live
  try{const tf=UI('/ui/team-folders').catch(()=>null);this.live=await UI('/ui/apps');this.teams=await tf}catch(e){if(gone())return;el.innerHTML=`<div class="code-host live-host"><div class="code-lock card"><h2>Live isn’t available</h2><p>${esc(e.message)}</p></div></div>`;return}
  if(gone())return;this.paintSide();this.paintLive(el);this.watchLive(el)},
 paintLive(el){const d=this.live,apps=d.apps||[];
  const visL={public:'Public',unlisted:'Anyone with the link',private:'Only the team'},visI={public:'globe',unlisted:'link',private:'lock'};
  const visSel=a=>a.canManage?`<select class="live-vis" data-id="${esc(a.id)}" aria-label="Who can open it">${Object.entries(visL).map(([k,v])=>`<option value="${k}" ${a.visibility===k?'selected':''}>${v}</option>`).join('')}</select>`:`<span class="live-vchip">${icon(visI[a.visibility]||'link',12)}${esc(visL[a.visibility]||'')}</span>`;
  const seen=a=>a.visits30==null||!d.stats?'':a.visits30?esc(plural(a.visits30,'visit'))+' in 30 days':'No visits in 30 days';
  const onOff=a=>a.status==='offline'?`<button class="ghost small" data-act="live-online" data-on="1" data-id="${esc(a.id)}">Back online</button>`:`<button class="ghost small" data-act="live-online" data-on="0" data-id="${esc(a.id)}">Take offline</button>`;
  const card=a=>`<article class="live-card card" id="live-${esc(a.id)}">
    <div class="live-top"><h3>${esc(a.name)}</h3><span class="live-st ${esc(a.status)}"><i class="live-dot ${esc(a.status)}"></i>${esc(this.stLabel[a.status]||a.status)}</span></div>
    <a class="live-url" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url.replace(/^https:\/\//,''))}${icon('popout',13)}</a>
    <p class="live-meta">By ${esc(a.mine?'you':a.ownerName||'someone')} · ${esc(ago(Math.round((a.updated||a.created)/1000)))}${a.db?' · with a database':''}${seen(a)?' · '+seen(a):''}${a.unused?' · <b class="live-unused">Unused</b>':''}</p>
    ${a.repo?`<p class="live-meta">${icon('link',13)}<a href="${esc(/^https?:/.test(a.repo)?a.repo:'https://github.com/'+a.repo)}" target="_blank" rel="noopener">${esc(a.repo.replace(/^https:\/\/github.com\//,''))}</a></p>`:''}
    ${a.status==='failed'&&a.error?`<p class="live-err">${esc(a.error)}</p>`:''}
    <div class="live-acts">${a.status==='offline'?'':`<a class="btn small primary" href="${esc(a.url)}" target="_blank" rel="noopener">Open</a>`}${visSel(a)}${a.canManage?onOff(a)+`<button class="ghost small bad" data-act="live-remove" data-id="${esc(a.id)}">Delete</button>`:''}</div></article>`;
  const connect=d.admin&&!d.connected?`<div class="card live-connect"><h3>Connect Live to the server</h3><p class="hint">Once, so anyone can publish. In Dokploy: <b>Settings › Profile › API keys › Create</b>, then paste it here with the server’s address.</p>
    <label>Server address</label><input id="liveUrl" name="aq-dokploy-address" autocomplete="off" data-1p-ignore data-lpignore="true" placeholder="https://dokploy.example.com" value="${esc(/\./.test(d.domain||'')&&!/localhost/.test(d.domain)?'https://dokploy.'+d.domain:'')}"><label>API key</label><input id="liveKey" name="aq-dokploy-key" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true"><div class="live-acts"><button class="primary" data-act="live-connect">Connect</button></div></div>`:'';
  // admins: every app in one table, with filters and visits
  const F=this.liveF||'all',filters={all:'All',unused:'Unused',failed:'Didn’t start',offline:'Offline',public:'Public',unlisted:'Link only',private:'Team only'};
  const is=(a,k)=>k==='all'||(k==='unused'?a.unused:k==='failed'?a.status==='failed':k==='offline'?a.status==='offline':a.visibility===k);
  const when=t=>t?esc(ago(Math.round(t/1000))):'<span class="hint">never</span>';
  const table=d.admin&&apps.length?`<section class="card live-admin"><div class="live-admin-head"><div><h3>All apps</h3><p class="hint">${d.stats?'Visits are pages opened, counted from the server’s request log.':'Visits aren’t counted yet: the server’s request log is off.'}</p></div>${d.stats?'':`<button class="ghost small" data-act="live-visits">Count visits</button>`}</div>
    <div class="live-filters" role="tablist">${Object.entries(filters).map(([k,v])=>{const n=apps.filter(a=>is(a,k)).length;return n||k==='all'?`<button role="tab" class="live-f ${F===k?'on':''}" data-act="live-filter" data-f="${k}" aria-selected="${F===k}">${v} <span>${n}</span></button>`:''}).join('')}</div>
    <div class="live-tw"><table class="live-table"><thead><tr><th>App</th><th>Published by</th><th>Who can open it</th><th>Status</th><th>Updated</th><th class="num">7 days</th><th class="num">30 days</th><th>Last visit</th><th></th></tr></thead><tbody>
    ${apps.filter(a=>is(a,F)).map(a=>`<tr><td><a class="live-tname" href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.name)}</b><small>${esc(a.slug)}.${esc(d.domain)}</small></a>${a.unused?'<b class="live-unused">Unused</b>':''}</td><td>${esc(a.mine?'You':a.ownerName||'Someone')}</td><td>${visSel(a)}</td>
     <td><span class="live-st ${esc(a.status)}"><i class="live-dot ${esc(a.status)}"></i>${esc(this.stLabel[a.status]||a.status)}</span></td><td>${when(a.updated||a.created)}</td><td class="num">${d.stats?a.visits7||0:'–'}</td><td class="num">${d.stats?a.visits30||0:'–'}</td><td>${d.stats?when(a.lastVisit):'–'}</td>
     <td class="live-row-acts">${onOff(a)}<button class="ghost small bad" data-act="live-remove" data-id="${esc(a.id)}">Delete</button></td></tr>`).join('')||`<tr><td colspan="9" class="hint">Nothing here.</td></tr>`}</tbody></table></div></section>`:'';
  const mine=d.admin?apps.filter(a=>a.mine):apps;
  el.innerHTML=`<div class="code-host live-host"><div class="live-wrap"><div class="live-head"><h2>Live</h2><p class="hint">Apps your team published from Code, each at its own address on ${esc(d.domain)}. To publish, open a project in Build › its menu › <b>Publish to Live</b>.</p></div>${connect}
    ${mine.length?(d.admin?'<h3 class="live-sub">Yours</h3>':'')+`<div class="live-grid">${mine.map(card).join('')}</div>`:''}
    ${table}
    ${apps.length?'':`<div class="live-empty card"><span class="ln-ico">${icon('globe',22)}</span><b>Nothing is live yet</b><p class="hint">Build something in Code, then publish it from the project’s menu. It shows up here with its link.</p></div>`}${this.teamsHtml()}</div></div>`;
  for(const sel of el.querySelectorAll('select.live-vis'))sel.onchange=()=>liveVis(sel)},
 // Team folders: the shared Code folders a person is in (admins see all), who is in each and the last push; read only
 teamsHtml(){const tf=this.teams?.folders;if(!tf)return '';const role={owner:'shared it',push:'can push',pull:'can pull'};
  const card=f=>`<article class="live-card card"><div class="live-top"><h3>${esc(f.name)}</h3><span class="live-st">${f.chats?'Files and chats':'Files only'}</span></div>
    <p class="live-meta">${esc(f.ownerName)} shared it${f.members.length?' · '+esc(f.members.map(m=>m.name+' '+role[m.role]).join(', ')):' · no members yet'}</p>
    <p class="live-meta">${f.last?'Last push '+esc(ago(Math.round(f.last.at/1000)))+' by '+esc(f.last.name):'No pushes yet'}${f.role?'':' · you are not in it'}</p></article>`;
  return `<div class="live-head live-teams"><h2>Team folders</h2><p class="hint">Code projects shared with team members. Everyone works in their own copy on their computer and uses <b>Team › Push</b> and <b>Pull</b> in Code.</p></div>
   ${tf.length?`<div class="live-grid">${tf.map(card).join('')}</div>`:`<div class="live-empty card"><span class="ln-ico">${icon('folder',22)}</span><b>No team folders yet</b><p class="hint">In Code, open a project and choose <b>Team › Share to team</b>.</p></div>`}`},
 // apps that are still publishing are checked every 8 seconds; the whole list every 32, so changes made elsewhere show up
 watchLive(el){clearInterval(this.lt);let n=0;this.lt=setInterval(async()=>{if(!el.isConnected||this.where!=='live'||route().sec?.id!=='code'){clearInterval(this.lt);return}
   if(++n%4===0){try{const d=await UI('/ui/apps');if(!el.isConnected||this.where!=='live')return;
    if(JSON.stringify(d)!==JSON.stringify(this.live)&&!document.activeElement?.closest?.('.live-host input')){this.live=d;this.paintLive(el);this.paintSide()}}catch{}return}
   const busy=(this.live?.apps||[]).filter(a=>a.status==='building');if(!busy.length)return;let changed=false;
   for(const a of busy){try{const r=await post(UI,'/ui/apps/check',{id:a.id});if(r.status!==a.status){a.status=r.status;a.error=r.error;changed=true}}catch{}}
   if(changed){this.paintLive(el);this.paintSide()}},8000)}});
ACT['live-jump']=a=>{const c=document.getElementById('live-'+a.dataset.id);if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.remove('flash');void c.offsetWidth;c.classList.add('flash')}};
const liveReload=()=>{CodeUI.live=null;const el=$('#pg .code-host')?.parentElement||$('#pg');if(el)CodeUI.livePage(el)};
ACT['live-remove']=async a=>{const x=(CodeUI.live?.apps||[]).find(y=>y.id===a.dataset.id);if(!x)return;
 if(!await confirmBox('Delete '+x.name+'?','The app'+(x.db?' and its database are':' is')+' removed from the server and '+x.url.replace('https://','')+' stops working. This can’t be undone. The project itself stays in Code.'+(x.status!=='offline'?' To keep it for later, take it offline instead.':''),'Delete'))return;
 const t=liveBusy(a,'Deleting…');try{await post(UI,'/ui/apps/remove',{id:x.id});toast(x.name+' is deleted');CodeUI.live=null;const el=$('#pg .code-host')?.parentElement||$('#pg');if(el)CodeUI.livePage(el)}catch(e){fail(e)}finally{t()}};
// these can take up to 30 s on the server: the button shows it is working until then
const liveBusy=(a,txt)=>{const was=a.textContent;a.disabled=true;a.classList.add('is-busy','say');a.setAttribute('aria-busy','true');a.textContent=txt;return()=>{if(!a.isConnected)return;a.disabled=false;a.classList.remove('is-busy','say');a.removeAttribute('aria-busy');a.textContent=was}};
ACT['live-connect']=async a=>{const t=liveBusy(a,'Connecting…');try{await post(UI,'/ui/apps/connect',{url:$('#liveUrl').value,key:$('#liveKey').value});toast('Live is connected');CodeUI.live=null;const el=$('#pg .code-host')?.parentElement||$('#pg');if(el)CodeUI.livePage(el)}catch(e){fail(e)}finally{t()}};

/* ---------- Old Code sign-ins (moved here from Models › Accounts on 1 Nov 2026: they are Code's own): the accounts aqeelOS
   Code signed in to by itself on the AI box. Code's runs there use the agents' AI accounts now, so these are only listed:
   a Claude one can be moved in as an AI account (the same kind of folder), a Codex one only removed. Nothing is removed
   without asking first. Admins see a small button at the foot of Code's list while there are any. ---------- */
CodeUI.oldLoad=async function(){if(S.me?.admin===false)return;try{this.old=(await UI('/ui/accounts/old-code')).signins||[]}catch{this.old=[]}this.paintSide()};
const oldCodeRows=l=>l.map((x,i)=>`<div class="ca-row" ${st(i)}>${logoImg(x.provider==='claude'?'claude.ai':'chatgpt.com',x.provider==='claude'?'C':'G')}<div class="ca-t"><b>${esc(x.label)}</b><span>${esc([x.provider==='claude'?'Claude':'Codex (ChatGPT)',x.signedIn?(x.email?accountText({email:x.email}):'Signed in'):'Not signed in',x.active?'Code’s choice right now':''].filter(Boolean).join(' · '))}</span></div>
 <span class="pri-btns">${x.provider==='claude'&&x.signedIn?`<button class="ghost small" data-act="oldcode-import" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Move in</button>`:''}<button class="ghost small" data-act="oldcode-remove" data-p="${esc(x.provider)}" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Remove</button></span></div>`).join('')||'<p class="hint" style="margin:0">None left. Code uses the AI account each agent is on.</p>';
ACT['oldcode-open']=()=>{const d=drawer('Old Code sign-ins',`<p class="hint" style="margin:0 0 12px">Accounts Code signed in to by itself on the AI box. Code now uses the AI account each agent is on, so these are no longer needed. Move a Claude one in to keep using it as an AI account, or remove it.</p><div class="old-code">${oldCodeRows(CodeUI.old||[])}</div>`,`<button class="primary" data-act="close">Done</button>`,{size:'sm'});CodeUI._oldD=d};
const oldCodeAgain=async()=>{await CodeUI.oldLoad();const b=CodeUI._oldD?.querySelector('.old-code');if(b?.isConnected)b.innerHTML=oldCodeRows(CodeUI.old||[])};
ACT['oldcode-import']=async a=>{if(!await confirmBox('Move '+a.dataset.l+' into aqeelOS?','It becomes one of your AI accounts on Models, with its usage on its own card, and you can give it to agents. Code stops using it as its own.','Move in',false))return;
 a.disabled=true;try{const r=await post(UI,'/ui/accounts/old-code/import',{id:a.dataset.id});Pages._acctFresh=true;toast(r.label+' is now one of your AI accounts');oldCodeAgain()}catch(e){a.disabled=false;fail(e)}};
ACT['oldcode-remove']=async a=>{if(!await confirmBox('Remove '+a.dataset.l+'?','Its sign-in folder is deleted from the AI box. This cannot be undone; you can sign in to that account again on Models at any time.','Remove'))return;
 a.disabled=true;try{await del(UI,'/ui/accounts/old-code/'+a.dataset.p+'/'+a.dataset.id);toast(a.dataset.l+' removed');oldCodeAgain()}catch(e){a.disabled=false;fail(e)}};
// take offline (stopped, everything kept) or back online
ACT['live-online']=async a=>{const x=(CodeUI.live?.apps||[]).find(y=>y.id===a.dataset.id);if(!x)return;const on=a.dataset.on==='1';
 if(!on&&!await confirmBox('Take '+x.name+' offline?',x.url.replace('https://','')+' stops answering until it is put back online. Nothing is deleted.','Take offline'))return;
 const t=liveBusy(a,on?'Starting…':'Stopping…');try{await post(UI,'/ui/apps/online',{id:x.id,on});toast(on?x.name+' is back online':x.name+' is offline');liveReload()}catch(e){fail(e)}finally{t()}};
// who can open it: public (listed for the team), anyone with the link, or only people signed in to aqeelOS
async function liveVis(sel){const x=(CodeUI.live?.apps||[]).find(y=>y.id===sel.dataset.id);if(!x)return;const v=sel.value,was=x.visibility;sel.disabled=true;
 try{await post(UI,'/ui/apps/visibility',{id:x.id,visibility:v});x.visibility=v;for(const o of document.querySelectorAll('select.live-vis[data-id="'+x.id+'"]'))o.value=v;
  toast(v==='private'?x.name+' now asks people to sign in to aqeelOS':v==='public'?x.name+' is public and listed for the team':x.name+' opens for anyone with the link')}catch(e){sel.value=was;fail(e)}finally{sel.disabled=false}}
ACT['live-filter']=a=>{CodeUI.liveF=a.dataset.f;const el=$('#pg .code-host')?.parentElement||$('#pg');if(el&&CodeUI.live)CodeUI.paintLive(el)};
ACT['live-visits']=async a=>{if(!await confirmBox('Count visits?','The server starts keeping a request log so aqeelOS can count how often each app is opened. Turning it on restarts the web server for a few seconds, so every site on the server blinks once.','Count visits'))return;
 const t=liveBusy(a,'Turning on…');try{await post(UI,'/ui/apps/visits',{on:true});toast('Visits are counted from now on');liveReload()}catch(e){fail(e)}finally{t()}};
