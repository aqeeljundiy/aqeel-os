// Code: the aqeelOS Code desktop app (on this computer) shown inside aqeelOS. The aqeelOS sidebar stays; under it
// the app's projects and chats; the main area is the app itself (chat, preview, artifacts, files, changes, browser).
// No app on this computer: Code is locked with the downloads for Windows and Mac, and opens once the app answers.
// The page and the app talk only by messages (hello, pair, open, new chat, theme, language; the app sends its state).
const CODE_APP='http://127.0.0.1:4321';
const CodeUI={st:{projects:[],project:'',chat:''},state:'wait',open:{},q:'',filter:'All',frame:null,timer:null,
 post(m){this.frame?.contentWindow?.postMessage(m,CODE_APP)},
 // the left list, under the aqeelOS sections, like the chat list
 sidebar(){const ps=this.st.projects||[],q=this.q.toLowerCase();
  if(this.state!=='on')return `<div class="side-sub"><div class="side-sub-head"><span class="th">Code</span></div><p class="hint" style="margin:6px 18px">${this.state==='lock'?'Install aqeelOS Code on this computer to see your projects here.':'Connecting to aqeelOS Code on this computer…'}</p></div>`;
  const chats=p=>(p.chats||[]).filter(c=>(!q||(c.title+' '+p.name).toLowerCase().includes(q))&&(this.filter!=='Active'||c.busy)).sort((a,b)=>(b.updated||0)-(a.updated||0));
  return `<div class="side-sub"><div style="padding:12px 12px 8px"><button style="width:100%" data-act="code-new">${icon('plus',16)}New chat</button></div>
   <div class="side-search">${icon('search',16)}<input id="codeQ" placeholder="Search chats" value="${esc(this.q)}" aria-label="Search chats"></div>
   <div class="code-filter">${['All','Active'].map(f=>`<button class="${this.filter===f?'on':''}" data-act="code-filter" data-f="${f}">${f}</button>`).join('')}</div>
   <div class="side-list code-tree">${ps.map(p=>{const open=this.open[p.id]??p.id===this.st.project,cs=chats(p);if(q&&!cs.length&&!p.name.toLowerCase().includes(q))return '';
    return `<div class="code-proj${p.id===this.st.project?' on':''}"><button class="item code-p" data-act="code-proj" data-id="${esc(p.id)}" aria-expanded="${open}">${icon(open?'chevD':'chevR',14)}${icon('folder',15)}<span class="t">${esc(p.name)}</span><span class="n">${cs.length||''}</span></button>
     ${open?`<div class="code-chats">${cs.map(c=>`<button class="item code-c${c.id===this.st.chat?' on':''}" data-act="code-chat" data-p="${esc(p.id)}" data-c="${esc(c.id)}">${c.busy?'<i class="spinner tiny"></i>':''}<span class="t">${esc(c.title)}</span></button>`).join('')||'<p class="hint" style="margin:4px 34px">No chats yet</p>'}</div>`:''}</div>`}).join('')||'<p class="hint" style="margin:6px 18px">No projects yet. Start a chat to make one.</p>'}</div>
   <div class="code-foot"><button class="ghost small" data-act="code-newproj">${icon('folder',14)}New project</button></div></div>`},
 paintSide(){if(route().sec?.id!=='code')return;const s=$('.side .side-sub');const h=this.sidebar();if(s)s.outerHTML=h;const i=$('#codeQ');if(i)i.oninput=e=>{this.q=e.target.value;const pos=e.target.selectionStart;this.paintSide();const n=$('#codeQ');n?.focus();n?.setSelectionRange(pos,pos)}},
 // the page: the app in a frame, or the lock screen
 async page(p,el){const pg=el.closest('.page');pg?.classList.add('page-full');setActions('');clearTimeout(this.timer);
  el.innerHTML=`<div class="code-host"><div class="code-wait"><span class="spinner"></span><span>Looking for aqeelOS Code on this computer…</span></div>
   <iframe class="code-frame" title="aqeelOS Code" allow="local-network-access; clipboard-read; clipboard-write; microphone" hidden></iframe></div>`;
  const f=el.querySelector('iframe');this.frame=f;this.state='wait';this.paintSide();
  f.onload=()=>{this.post({aq:'hello'});clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},3500)};
  f.src=CODE_APP+'/?embed=aqeelos';this.timer=setTimeout(()=>{if(this.state!=='on')this.lock(el)},9000)},
 lock(el){if(!el.isConnected||route().sec?.id!=='code')return;this.state='lock';this.paintSide();const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  el.querySelector('.code-host').innerHTML=`<div class="code-lock card">
   <span class="code-lock-ic">${icon('terminal',26)}</span><h2>Code needs the aqeelOS Code app on this computer</h2>
   <p>Code builds apps, websites, decks, docs and designs with a live preview and its own guarded browser, using your agents and everything connected to aqeelOS. It runs on your own computer, so install it once.</p>
   <div class="code-dl"><a class="btn ${mac?'':'primary'}" href="/ui/code/download/windows" download>${icon('download',16)}Download for Windows</a><a class="btn ${mac?'primary':''}" href="/ui/code/download/mac" download>${icon('download',16)}Download for Mac</a></div>
   <ol class="code-steps"><li>Unzip it, then open <b>${mac?'Install aqeelOS Code.command':'Install aqeelOS Code.cmd'}</b>${mac?' (the first time: right-click › Open)':''}.</li><li>It installs Node.js if needed, starts in the background and comes back here.</li><li>Chrome may ask to let aqeelOS reach apps on this computer: allow it.</li></ol>
   <p class="hint code-retry"><span class="spinner tiny"></span>Waiting for the app… this opens by itself once it runs.</p></div>`;
  // keep checking quietly while the page is open
  clearTimeout(this.timer);this.timer=setTimeout(()=>{if(route().sec?.id==='code'&&this.state==='lock')this.page(null,el.closest('#pg')||el)},6000)},
 async onMessage(e){if(e.origin!==CODE_APP||!e.data?.cba)return;const m=e.data;
  if(m.type==='hello'){clearTimeout(this.timer);this.state='on';this.st={projects:m.projects||[],project:m.project,chat:m.chat};
   const f=this.frame;if(f){f.hidden=false;f.closest('.code-host')?.querySelector('.code-wait')?.remove()}
   this.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});this.post({aq:'lang',lang:(typeof Lang!=='undefined'&&Lang.cur)||'en'});
   if(!m.paired){try{const r=await post(UI,'/ui/code/pair',{name:(/Mac/i.test(navigator.platform)?'Mac':/Win/i.test(navigator.platform)?'Windows PC':'Computer')+' · '+(navigator.userAgentData?.brands?.find(b=>/Chrome|Edge/.test(b.brand))?.brand||'browser')});this.post({aq:'pair',token:r.token,base:location.origin})}catch(er){fail(er)}}
   this.paintSide()}
  if(m.type==='state'){this.st={projects:m.projects||[],project:m.project,chat:m.chat};this.paintSide()}
  if(m.type==='paired'){if(m.ok)toast('This computer is paired with aqeelOS');else toast('Pairing didn’t work: '+(m.error||'unknown'),'err')}
  if(m.type==='error')toast(m.error,'err')}};
addEventListener('message',e=>CodeUI.onMessage(e));
PAGES.code=(p,el)=>CodeUI.page(p,el);
ACT['code-new']=()=>CodeUI.post({aq:'newChat',project:CodeUI.st.project});
ACT['code-newproj']=()=>CodeUI.post({aq:'newProject'});
ACT['code-chat']=a=>{CodeUI.st.project=a.dataset.p;CodeUI.st.chat=a.dataset.c;CodeUI.post({aq:'open',project:a.dataset.p,chat:a.dataset.c});CodeUI.paintSide()};
ACT['code-proj']=a=>{const id=a.dataset.id,was=CodeUI.open[id]??id===CodeUI.st.project;CodeUI.open[id]=!was;if(!was&&id!==CodeUI.st.project)CodeUI.post({aq:'open',project:id});CodeUI.paintSide()};
ACT['code-filter']=a=>{CodeUI.filter=a.dataset.f;CodeUI.paintSide()};
// the theme switch follows into the app
{const t0=theme;theme=(...a)=>{const r=t0(...a);CodeUI.post({aq:'theme',dark:document.documentElement.classList.contains('dark')});return r}}
