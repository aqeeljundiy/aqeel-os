// Code: the aqeelOS Code desktop app (on this computer) shown inside aqeelOS. The aqeelOS sidebar stays; under it
// the app's projects and chats; the main area is the app itself (chat, preview, artifacts, files, changes, browser).
// No app on this computer: Code is locked with the downloads for Windows and Mac, and opens once the app answers.
// The page and the app talk only by messages (hello, pair, open, new chat, theme, language; the app sends its state).
const CODE_APP='http://127.0.0.1:4321';
const CodeUI={where:(()=>{try{return localStorage.getItem('aq-code-where')||'computer'}catch{return 'computer'}})(),app:CODE_APP,st:{projects:[],project:'',chat:''},state:'wait',open:{},q:'',filter:'All',frame:null,timer:null,
 post(m){this.frame?.contentWindow?.postMessage(m,this.app)},
 // this computer (the desktop app) or online (the copy on the AI box, behind sign-in)
 admin(){return S.me?.admin!==false},
 // the bottom-left card in Code: Code's agent (No agent by default) and its model
 agentCard(){const a=(this.st.agents||[]).find(x=>x.id===this.st.agent);return {name:a?a.name:'No agent',initial:a?a.name.trim()[0].toUpperCase():'–',model:this.st.model||'Default',none:!a}},
 whereBar(){if(!this.admin())return '';return `<div class="code-where" role="tablist" aria-label="Where projects live">${[['computer','This computer','monitor'],['online','Online','globe']].map(([k,t,i])=>`<button role="tab" aria-selected="${this.where===k}" class="${this.where===k?'on':''}" data-act="code-where" data-w="${k}">${icon(i,14)}${t}</button>`).join('')}</div>`},
 // the left list, under the aqeelOS sections, like the chat list
 sidebar(){const ps=this.st.projects||[],q=this.q.toLowerCase();
  if(this.state!=='on')return `<div class="side-sub">${this.whereBar()}<p class="hint" style="margin:6px 18px">${this.state==='lock'?'Install aqeelOS Code on this computer to see your projects here.':this.where==='online'?'Opening your online projects…':'Connecting to aqeelOS Code on this computer…'}</p></div>`;
  const chats=p=>(p.chats||[]).filter(c=>(!q||(c.title+' '+p.name).toLowerCase().includes(q))&&(this.filter!=='Active'||c.busy)&&(this.filter!=='Unread'||c.unread)).sort((a,b)=>(b.updated||0)-(a.updated||0));
  return `<div class="side-sub">${this.whereBar()}<div style="padding:4px 12px 8px"><button style="width:100%" data-act="code-new">${icon('plus',16)}New chat</button></div>
   <div class="side-search">${icon('search',16)}<input id="codeQ" placeholder="Search chats" value="${esc(this.q)}" aria-label="Search chats"></div>
   <div class="code-filter">${['All','Active','Unread'].map(f=>`<button class="${this.filter===f?'on':''}" data-act="code-filter" data-f="${f}">${f}</button>`).join('')}</div>
   <div class="side-list code-tree">${ps.map(p=>{const open=this.open[p.id]??p.id===this.st.project,cs=chats(p);if(q&&!cs.length&&!p.name.toLowerCase().includes(q))return '';
    return `<div class="code-proj${p.id===this.st.project?' on':''}"><button class="item code-p" data-act="code-proj" data-id="${esc(p.id)}" aria-expanded="${open}">${icon(open?'chevD':'chevR',14)}${icon('folder',15)}<span class="t">${esc(p.name)}</span><span class="n">${cs.length||''}</span></button><button class="code-more" data-act="code-menu" data-p="${esc(p.id)}" aria-label="Project actions for ${esc(p.name)}" title="Project actions">${icon('more',15)}</button>
     ${open?`<div class="code-chats">${cs.map(c=>`<div class="code-row"><button class="item code-c${c.id===this.st.chat?' on':''}" data-act="code-chat" data-p="${esc(p.id)}" data-c="${esc(c.id)}">${c.busy?'<i class="spinner tiny"></i>':c.unread?'<i class="code-dot" aria-label="Unread"></i>':''}<span class="t">${esc(c.title)}</span></button><button class="code-more" data-act="code-menu" data-p="${esc(p.id)}" data-c="${esc(c.id)}" aria-label="Chat actions for ${esc(c.title)}" title="Chat actions">${icon('more',15)}</button></div>`).join('')||'<p class="hint" style="margin:4px 34px">No chats yet</p>'}</div>`:''}</div>`}).join('')||'<p class="hint" style="margin:6px 18px">No projects yet. Start a chat to make one.</p>'}</div>
   <div class="code-foot"><button class="ghost small" data-act="code-newproj">${icon('folder',14)}New project</button></div></div>`},
 paintSide(){if(route().sec?.id!=='code')return;const s=$('.side .side-sub');const h=this.sidebar();if(s)s.outerHTML=h;const i=$('#codeQ');if(i)i.oninput=e=>{this.q=e.target.value;const pos=e.target.selectionStart;this.paintSide();const n=$('#codeQ');n?.focus();n?.setSelectionRange(pos,pos)}},
 // the page: the app in a frame, or the lock screen
 async page(p,el){const pg=el.closest('.page');pg?.classList.add('page-full');setActions('');clearTimeout(this.timer);
  el.innerHTML=`<div class="code-host"><div class="code-wait"><span class="spinner"></span><span>Looking for aqeelOS Code on this computer…</span></div>
   <iframe class="code-frame" title="aqeelOS Code" allow="local-network-access; clipboard-read; clipboard-write; microphone" hidden></iframe></div>`;
  const f=el.querySelector('iframe');this.frame=f;this.state='wait';this.paintSide();
  f.onload=()=>{this.post({aq:'hello'});if(this.where==='online')return;clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},3500)};
  if(!this.admin())this.where='computer';
  if(this.where==='online'){try{const r=await UI('/ui/code/online');this.app=r.origin;f.src=r.url}catch(e){this.app='';el.querySelector('.code-host').innerHTML=`<div class="code-lock card"><h2>Online projects aren’t available</h2><p>${esc(e.message)}</p></div>`;return}
   clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.state!=='on'&&el.isConnected){el.querySelector('.code-wait span:last-child')&&(el.querySelector('.code-wait span:last-child').textContent='The online copy is slow to answer. It starts by itself; this page retries.');this.timer=setTimeout(()=>this.page(p,el),8000)}},15000);return}
  this.app=CODE_APP;f.src=CODE_APP+'/?embed=aqeelos';this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},9000)},
 // the app answers a ping every 10 s; if it stops (it quit, the computer slept), Code waits for it again
 beat(){clearInterval(this.hb);this.hb=setInterval(()=>{const el=this.frame?.closest('#pg');if(!el?.isConnected||route().sec?.id!=='code'){clearInterval(this.hb);return}
   if(this.state==='on'&&Date.now()-(this.seen||0)>25000){clearInterval(this.hb);this.state='wait';this.paintSide();this.page(null,el)}else this.post({aq:'ping'})},10000)},
 lock(el){if(!el.isConnected||route().sec?.id!=='code')return;this.state='lock';this.paintSide();const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  let seen=false;try{seen=localStorage.getItem('aq-code-seen')==='1'}catch{}
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
   <ol class="code-steps"><li>Unzip it, then open <b>${mac?'Install aqeelOS Code.command':'Install aqeelOS Code.cmd'}</b>${mac?' (the first time: right-click › Open)':''}.</li><li>It installs Node.js if needed, starts in the background and comes back here.</li><li>Chrome may ask to let aqeelOS reach apps on this computer: allow it.</li></ol>
   <p class="code-perm hint" hidden></p>
   <p class="hint code-retry"><span class="spinner tiny"></span>Waiting for the app… this opens by itself once it runs.</p>
   ${this.admin()?'':'<!--'}<p class="code-or">No install needed for <button class="linkish" data-act="code-where" data-w="online">online projects</button>: they live on the AI box and open here.</p>${this.admin()?'':'-->'}</div>`;
  // Chrome asks before a website may reach apps on this computer; once refused, Code stays locked until it is allowed
  (async()=>{let st='';for(const n of ['local-network-access','loopback-network']){try{st=(await navigator.permissions.query({name:n})).state;break}catch{}}
   const box=el.querySelector('.code-perm');if(!box)return;
   if(st==='denied'){box.hidden=false;box.innerHTML=`${icon('alert',14)}<span>This browser is blocking aqeelOS from reaching apps on this computer. Click the icon left of the address bar › <b>Site settings</b> › <b>Local network access</b> › <b>Allow</b>, then reload. Already installed the app? This is why Code stays locked.</span>`}
   else if(st==='prompt'){box.hidden=false;box.innerHTML=`${icon('shield',14)}<span>When the app runs, Chrome asks whether aqeelOS may reach apps on this computer. Choose <b>Allow</b>.</span>`}})();
  // keep checking quietly while the page is open
  clearTimeout(this.timer);this.timer=setTimeout(()=>{if(route().sec?.id==='code'&&this.state==='lock')this.page(null,el.closest('#pg')||el)},6000)},
 async onMessage(e){if(!this.app||e.origin!==this.app||!e.data?.cba)return;const m=e.data;
  if(m.type==='pong'){this.seen=Date.now();return}
  if(m.type==='hello'){try{if(this.where!=='online')localStorage.setItem('aq-code-seen','1')}catch{}clearTimeout(this.timer);this.state='on';this.seen=Date.now();this.beat();this.st={projects:m.projects||[],project:m.project,chat:m.chat,agent:m.agent||'',agents:m.agents||[],model:m.model||''};setTimeout(()=>typeof paintSide==='function'&&paintSide());
   const f=this.frame;if(f){f.hidden=false;f.closest('.code-host')?.querySelector('.code-wait')?.remove()}
   this.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});if(typeof Brand!=='undefined'&&Brand.custom)this.post({aq:'brand',name:Brand.name});this.post({aq:'lang',lang:(typeof Lang!=='undefined'&&Lang.cur)||'en'});
   if(!m.paired&&this.where!=='online'){try{const r=await post(UI,'/ui/code/pair',{name:(/Mac/i.test(navigator.platform)?'Mac':/Win/i.test(navigator.platform)?'Windows PC':'Computer')+(()=>{const b=navigator.userAgentData?.brands?.find(b=>/Chrome|Edge/.test(b.brand))?.brand;return b?' · '+b:''})()});this.post({aq:'pair',token:r.token,base:location.origin})}catch(er){fail(er)}}
   this.paintSide()}
  if(m.type==='state'){const st={projects:m.projects||[],project:m.project,chat:m.chat,agent:m.agent||'',agents:m.agents||[],model:m.model||''};if(JSON.stringify(st)===JSON.stringify(this.st))return;const foot=st.agent!==this.st.agent||st.model!==this.st.model||JSON.stringify(st.agents)!==JSON.stringify(this.st.agents);this.st=st;this.paintSide();if(foot&&typeof paintSide==='function')paintSide()}
  if(m.type==='paired'){if(m.ok)toast('This computer is paired with aqeelOS');else toast('Pairing didn’t work: '+(m.error||'unknown'),'err')}
  if(m.type==='error')toast(m.error,'err')}};
addEventListener('message',e=>CodeUI.onMessage(e));
PAGES.code=(p,el)=>CodeUI.page(p,el);
ACT['code-new']=()=>CodeUI.post({aq:'newChat',project:CodeUI.st.project});
ACT['code-newproj']=()=>CodeUI.post({aq:'newProject'});
ACT['code-chat']=a=>{CodeUI.st.project=a.dataset.p;CodeUI.st.chat=a.dataset.c;CodeUI.post({aq:'open',project:a.dataset.p,chat:a.dataset.c});CodeUI.paintSide()};
ACT['code-proj']=a=>{const id=a.dataset.id,was=CodeUI.open[id]??id===CodeUI.st.project;CodeUI.open[id]=!was;if(!was&&id!==CodeUI.st.project)CodeUI.post({aq:'open',project:id});CodeUI.paintSide()};
ACT['code-where']=a=>{CodeUI.where=a.dataset.w;try{localStorage.setItem('aq-code-where',CodeUI.where)}catch{}CodeUI.st={projects:[],project:'',chat:''};CodeUI.state='wait';const el=$('#pg .code-host')?.parentElement||$('#pg');if(el)CodeUI.page(null,el);CodeUI.paintSide()};
ACT['code-menu']=a=>{const f=CodeUI.frame;if(!f)return;const y=a.getBoundingClientRect().top-f.getBoundingClientRect().top;CodeUI.post({aq:'menu',project:a.dataset.p,chat:a.dataset.c||'',y})};
ACT['code-filter']=a=>{CodeUI.filter=a.dataset.f;CodeUI.paintSide()};
// the theme switch follows into the app
{const t0=theme;theme=(...a)=>{const r=t0(...a);CodeUI.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});return r}}
