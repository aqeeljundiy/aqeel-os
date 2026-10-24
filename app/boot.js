// Event wiring and startup.
function openMenu(el){const k=el.dataset.menu;
 if(k==='convo'){const id=el.dataset.id;const pinned=store.get('pinned',[]);const isPin=pinned.includes(id);
  menu(el,[{label:'Rename',icon:'edit',run:()=>renameSession(id)},{label:isPin?'Unpin':'Pin',icon:'pin',run:()=>{store.set('pinned',isPin?pinned.filter(x=>x!==id):[id,...pinned]);paintSide()}},{label:'Fork',icon:'fork',run:()=>Chat.fork(id)},{label:'Export JSON',icon:'download',run:()=>ACT['hist-export']({dataset:{id}})},'-',{label:'Delete',icon:'trash',bad:true,run:()=>deleteSession(id)}])}
 if(k==='model')Chat.modelMenu(el);
 if(k==='effort')Chat.effortMenu(el);
 if(k==='workspace')Chat.workspaceMenu(el);
 if(k==='profile'){const ad=S.me?.admin!==false;H('/profiles').then(pr=>{const cur=ident(S.profile||'default').name;
  const inCode=route().sec?.id==='code'&&typeof CodeUI!=='undefined'&&CodeUI.state==='on';
  const codeAgents=()=>{const c=CodeUI.st;menu(el,[{header:'Code works with'},{label:'No agent',sub:'Code asks the right agent when it needs one',icon:'user',on:!c.agent,run:()=>CodeUI.post({aq:'agent',id:''})},...(c.agents||[]).map(a=>({label:a.name,icon:'user',on:c.agent===a.id,run:()=>CodeUI.post({aq:'agent',id:a.id})}))],{search:(c.agents||[]).length>7})};
  const agents=()=>inCode?codeAgents():menu(el,[{header:'Switch agent'},...(pr.profiles||[]).map(p=>({label:ident(p.name).name,icon:'user',ava:agentAvatar(p.name,20,{title:false}),on:(S.profile||'default')===p.name,run:()=>switchAgent(p.name)})),...(ad?['-',{label:'Manage agents',icon:'settings',run:()=>go('/agents/profiles')}]:[])],{search:(pr.profiles||[]).length>7});
  const prefs=()=>{const dark=document.documentElement.classList.contains('dark');menu(el,[{header:'Preferences'},{label:dark?'Light mode':'Dark mode',icon:dark?'sun':'moon',run:theme},{label:'Language: '+(Lang.cur==='id'?'Bahasa Indonesia':'English'),icon:'globe',run:()=>Lang.set(Lang.cur==='id'?'en':'id')},{label:'Costs in: '+(currency()==='IDR'?'Rupiah (Rp)':'US dollars ($)'),icon:'chart',run:()=>setCurrency(currency()==='IDR'?'USD':'IDR')},{label:'Keyboard shortcuts',icon:'cmd',kbd:MOD+' /',run:shortcuts},...(ad?[{label:'Development board',icon:'list',run:()=>window.open('/backlog','_blank','noopener')}]:[])])};
  const gs=gwState(S.status);
  menu(el,[...(S.me?.name?[{header:S.me.name+' · '+({owner:'Owner',admin:'Admin',member:'Member'}[S.me.role]||'')}]:[]),...(inCode?[]:[...(ad?[{label:'Agents: '+gs.label,sub:gs.say||'Open System › Health',icon:'activity',run:()=>go('/system/health')}]:[]),{label:'Your chats',sub:S.status?.active_sessions?plural(S.status.active_sessions,'chat')+' active now':'',icon:'chat',run:()=>go('/chat/manage')},'-']),...(S.me?[{label:'Your profile',icon:'user',ava:personAvatar(S.me,20,{title:false}),run:()=>ACT['me-profile']()}]:[]),{label:'Agent: '+(inCode?CodeUI.agentCard().name:cur),icon:'user',kbd:'›',run:()=>setTimeout(agents)},{label:'Preferences',icon:'settings',kbd:'›',run:()=>setTimeout(prefs)},'-',{label:'Sign out',icon:'logout',run:signOut}])}).catch(fail)}
 if(k==='acct')Pages.acctMenu(el);
 if(k==='acct-new')Pages.acctNewMenu(el);
 if(k==='person')Pages.personMenu(el);
 if(k==='pri-add')Pages.priAddMenu(el);
 if(k==='chat-tools')Chat.toolsMenu(el);
 if(k==='file')Pages.fileMenu(el);
 if(k==='cron')Pages.cronMenu(el);
 if(k==='plugin')Pages.pluginMenu(el);
 if(k==='profilecard')Pages.profileMenu(el);
}
// the agent you chat with rides in the address (?agent=<name>), so a reloaded or shared link opens on the same agent
function agentUrl(){try{const u=new URL(location.href),n=S.profile||'default';if(u.searchParams.get('agent')===n)return;u.searchParams.set('agent',n);history.replaceState(history.state,'',u)}catch{}}
function switchAgent(name){const was=S.profile||'default';if(was===name)return;S.profile=name;store.set('profile',name);agentUrl();Chat.resetLive(was);Chat.id=null;Chat.model=null;S.sessions=[];S.sessionsLoaded=false;toast('Now talking to '+ident(name).name);go('/chat');boot()}
function shortcuts(){drawer('Keyboard shortcuts',`<table>${[[MOD+' K','Search and commands'],[MOD+' B','Collapse the sidebar'],[MOD+' 1–'+Math.max(...SECTIONS.map(s=>+s.key||0)),'Jump to '+[...SECTIONS].sort((a,b)=>a.key-b.key).map(s=>s.label).join(', ')],['Enter','Send'],['Shift Enter','New line'],['Esc','Stop aqeelOS, or close a panel'],['/','Chat commands'],[MOD+' /','This list']].map(([k,v])=>`<tr><td style="white-space:nowrap"><span class="chip">${esc(k)}</span></td><td>${esc(v)}</td></tr>`).join('')}</table>`)}

document.addEventListener('click',e=>{
 if($('.app.nav-open')&&!e.target.closest('.side,[data-act="nav"]'))$('.app').classList.remove('nav-open');
 const g=e.target.closest('[data-go]');if(g&&!e.target.closest('[data-menu]')&&!e.target.closest('.switch')){e.preventDefault();go(g.dataset.go);return}
 const m=e.target.closest('[data-menu]');if(m){e.stopPropagation();e.preventDefault();openMenu(m);return}
 const t=e.target.closest('[data-tab]');if(t){const box=t.closest('[data-tabs]');const key=box.dataset.tabs;
  if(key==='chatFilter'){S.chatFilter=t.dataset.tab;store.set('chatFilter',S.chatFilter);paintSide();placePills();Chat.loadSessions(true);return}
  S.tab[key]=t.dataset.tab;box.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===t));placePills();
  if(['skills','mcp','plugins','usage','currency','models','channels','hist'].includes(key)){if(key==='hist')Pages.manageChats($('#view'));else reload()}return}
 const ts=e.target.closest('[data-tabset]');if(ts){const [k,v]=ts.dataset.tabset.split(':');S.tab[k]=v;reload();return}
 const c=e.target.closest('[data-cmd]');if(c){Chat.pickSlash(c.dataset.cmd);return}
 const pr=e.target.closest('[data-prompt]');if(pr){Chat.send(pr.dataset.prompt);return}
 if(!e.target.closest('.menu'))$$('.menu:not(.closing)').forEach(x=>leave(x,150));
 if(e.target.closest('#send')){if(Chat.live[Chat.id]?.running)Chat.stop();else Chat.submit();return}
 const a=e.target.closest('[data-act]');if(!a)return;const act=a.dataset.act;
 if(ACT[act])return ACT[act](a,e);
 switch(act){
  case 'collapse':S.collapsed=!S.collapsed;store.set('collapsed',S.collapsed);$('.app').classList.toggle('collapsed',S.collapsed);paintSide();placePills();break;
  case 'nav':$('.app').classList.toggle('nav-open');break;
  case 'palette':palette();break;
  case 'theme':theme();break;
  case 'banner':{BannerOff.add(a.dataset.key);const b=a.closest('.banner');if(b)leave(b,200);setTimeout(()=>{const s=$('#bannerSlot');if(s){s._h=null;paintBanner()}},220);break}
  case 'banner-mux':go('/system/health');setTimeout(()=>ACT['gw-migrate']?.(),400);break;
  case 'new':Chat.newChat();break;
  case 'close':closeLayers();break;
  case 'reload':reload();break;
  case 'step':a.closest('.step').classList.toggle('open');break;
  case 'think':{const b=a.nextElementSibling;b.hidden=!b.hidden;a.setAttribute('aria-expanded',String(!b.hidden));const t=Chat.live[Chat.id]?.turns[+a.dataset.i];if(t)t.thinkOpen=!b.hidden;break}
  case 'approval':Chat.approve(a.dataset.choice,a.dataset.rid);break;
  case 'perm-menu':Chat.permMenu(a);break;
  case 'perm-toggle':{if(!Chat.id){toast('Send the first message, then choose Allow all for this chat.');break}const on=!Chat.allowAll(Chat.id);Chat.setAllowAll(Chat.id,on);Chat.paintComposerBar();toast(on?'Allow all in this chat: no approval prompts (blocked commands stay blocked).':'Ask me: risky commands wait for your OK again.');break}
  case 'attach':pickFile('*/*',f=>Chat.addFiles(f),true);break;
  case 'att-zoom':{const d=document.createElement('div');d.className='att-zoom';d.innerHTML=`<img src="${esc(a.src)}" alt="">`;d.onclick=()=>{d.classList.add('out');setTimeout(()=>d.remove(),200)};document.body.append(d);break}
  case 'unattach':{const f=Chat.files[+a.dataset.i];if(f?.blob&&!Chat._sentAtt)setTimeout(()=>URL.revokeObjectURL(f.blob),60000)}Chat.files.splice(+a.dataset.i,1);Chat.paintFiles();break;
  case 'copymsg':{const t=Chat.live[Chat.id]?.turns[+a.dataset.i];copyText(t?.text||'','Reply copied');break}
  case 'copycode':copyText(a.closest('.codeblock').querySelector('pre').textContent,'Code copied');break;
  case 'copy-text':copyText(a.dataset.text);break;
  case 'retry':Chat.retry();break;
  case 'side-refresh':Chat.loadSessions();break;
  case 'chat-reconnect':Chat.reconnect();break;
  case 'chat-model':{const b=$('[data-menu=model]');if(b)openMenu(b);break}
  case 'chat-reload':location.reload();break;
  case 'send-mode':Chat.setSendMode(a.dataset.mode);break;
  case 'steer-now':Chat.steerNow();break;
  case 'send-busy':Chat.submit();break;
  case 'unqueue':{const cid=Chat.id,s=Chat.live[cid],i=+a.dataset.i,m=s?.queue?.splice(i,1)[0];Chat.paintQueue();if(m)toastUndo('Removed from queue',()=>{s.queue.splice(Math.min(i,s.queue.length),0,m);if(Chat.id===cid)Chat.paintQueue();Chat.runQueue(cid)});break}
  case 'queue-go':{const s=Chat.live[Chat.id];if(s){s.paused=false;Chat.runQueue(Chat.id)}break}
  case 'fork':Chat.fork();break;
  case 'rename-current':if(Chat.id)renameSession(Chat.id);break;
  case 'plugin-page':Plugins.open(a.dataset.name);break;
 }
});
document.addEventListener('input',e=>{if(e.target.id==='chatSearch'){S.search=e.target.value;const pos=e.target.selectionStart;paintSide();placePills();const i=$('#chatSearch');i.focus();i.setSelectionRange(pos,pos)}});
document.addEventListener('keydown',e=>{
 if(e.target.closest?.('[data-menu]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openMenu(e.target.closest('[data-menu]'));return}
 const mod=isMac?e.metaKey:e.ctrlKey;if(!S.signedIn)return;
 if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();palette()}
 if(mod&&e.key.toLowerCase()==='b'){e.preventDefault();$('[data-act="collapse"]')?.click()}
 if(mod&&/^[1-9]$/.test(e.key)){const s=SECTIONS.find(x=>x.key===e.key);if(s){e.preventDefault();go('/'+s.id)}}
 if(mod&&e.key==='/'){e.preventDefault();shortcuts()}
 if(e.key==='Escape'&&$('.palette,.drawer,.menu'))closeLayers();
 else if(e.key==='Escape')$('.app')?.classList.remove('nav-open');
});
addEventListener('hashchange',()=>{if(S.signedIn)render()});
addEventListener('resize',placePills);
// back on the tab: status and the chat list again, at most every 15 s (flipping tabs quickly asked each time)
document.addEventListener('visibilitychange',()=>{if(document.hidden||!S.signedIn||Date.now()-(S._visAt||0)<15000)return;S._visAt=Date.now();refreshStatus();Chat.loadSessions()});

async function boot(){
 await Brand.load();
 try{const r=await fetch('/auth/me');S.signedIn=r.ok}catch{S.signedIn=false}
 // a link naming an agent survives the sign-in page (which drops the address's ?agent=)
 const want=new URLSearchParams(location.search).get('agent')||sessionStorage.getItem('hui-wantAgent');
 if(!S.signedIn){if(want)try{sessionStorage.setItem('hui-wantAgent',want)}catch{}return render()}
 try{sessionStorage.removeItem('hui-wantAgent')}catch{}
 await loadMe();
 // the agent: the one the link names, else the one this browser used last, else (first visit) the one the command line uses
 let pf=store.get('profile',null);
 if(want&&want!==(pf||'default')){const ok=S.me&&!S.me.admin?!!S.me.agents?.[want]:await H('/profiles',{keep:true}).then(r=>(r.profiles||[]).some(x=>x.name===want)).catch(()=>false);if(ok){pf=want;store.set('profile',want)}}
 else if(pf==null&&S.me?.admin!==false){const a=await H('/profiles/active',{keep:true}).catch(()=>null);if(a?.active&&a.active!=='default')pf=a.active}
 S.profile=pf||'';if(S.me&&!S.me.admin&&!S.me.agents[S.profile||'default']){const first=Object.keys(S.me.agents)[0]||'';S.profile=first==='default'?'':first}
 // an admin's remembered agent may have been deleted (here or elsewhere): back to the main agent then (unknown = keep it)
 else if(S.profile&&S.profile!=='default'&&!await H('/profiles',{keep:true}).then(r=>(r.profiles||[]).some(x=>x.name===S.profile)).catch(()=>true)){S.profile='';store.set('profile','default')}
 agentUrl();
 Chat.agentPrefs();
 render();
 await Promise.all([loadIdentities(),refreshStatus(),Chat.loadModels(),Chat.loadSessions(),Plugins.load()]);
 $$('.agent-name').forEach(e=>e.textContent=AGENT());const msg=$('#msg');if(msg)msg.placeholder=Chat.placeholder();if(S.signedIn&&$('.app')){paintSide();paintTop();placePills();Screen.paint();if(route().chat!==undefined&&route().chat!=='manage')Chat.paintComposerBar()}
 clearInterval(S.statusT);S.statusT=setInterval(()=>{if(!document.hidden)refreshStatus()},30000);
 if(S.me?.admin!==false)Metrics.ask();
 clearInterval(S.sessT);S.sessT=setInterval(()=>Chat.tick().catch(()=>{}),20000);
}
/* Anonymous usage stats (the engine's shared metrics): each agent's own choice, on System › Settings, for owners and admins
   (the server refuses members). Asked once per browser session while an agent has no answer yet, or once more when the
   engine re-asks because an older version may have saved "No thanks" before anyone saw the question. */
const Metrics={c:{},
 who:()=>agentProfile()||'default',
 say(c){return c.managed?'Set by your organisation’s policy, so it can’t be changed here.':!c.decided?'Not chosen yet.':!c.enabled?'Off: nothing is counted.':c.send?'On: counts are shared with Nous, the engine’s makers.':'On: counts stay on this box only.'},
 async save(enabled,send,box){const ag=this.who();try{const c=await put(H,'/shared-metrics/consent',{enabled,send});this.c[ag]=c;toast(!enabled?'Usage stats are off':send?'Thanks: anonymous usage counts will be shared':'Usage counts stay on this box');if(box?.isConnected)this.paint(box,c);return c}catch(e){fail(new Error('Your choice couldn’t be saved: '+(e.message||e)));if(box?.isConnected)this.paint(box,this.c[ag]||null,true)}},
 card(){const ag=ident(this.who()).name;return `<div class="panel card" id="metricsBox" style="margin:0"><h2>Anonymous usage stats</h2><p class="sub">For ${esc(ag)}${typeof showingAll==='function'&&showingAll()?' (the agent you chat with)':''}. Helps the engine’s makers see which features are used and what breaks.</p>
  <ul class="hint" style="margin:0 0 14px;padding-left:18px;line-height:1.55"><li>Only counts: how often features run, how long things take, how often something fails.</li><li>Never what you or the agent write, your files, folder names, keys or error text.</li><li>Counting happens on this box. Sending the counts is a separate choice.</li></ul><div class="mt-body">${skeleton(1)}</div></div>`},
 paint(box,c,failed){const b=box.querySelector('.mt-body');if(!b)return;if(!c){b.innerHTML=alertBox(failed?'Your choice couldn’t be saved.':'This agent’s choice couldn’t be loaded.',{style:'margin:0'});return}
  const cur=!c.decided?'':!c.enabled?'off':c.send?'send':'local',btn=(k,l,en,sd)=>`<button class="${cur===k?'primary':''}" data-mt="${en?1:0}${sd?1:0}" ${c.managed?'disabled':''} aria-pressed="${cur===k}">${l}</button>`;
  b.innerHTML=`<p style="margin:0 0 10px;font-size:13.5px">${esc(this.say(c))}</p>${c.reask&&!c.managed?'<p class="hint" style="margin:0 0 10px">Asking once more: an older version could save “No thanks” before you saw this question.</p>':''}<div style="display:flex;gap:8px;flex-wrap:wrap">${btn('send','Share',1,1)}${btn('local','Keep on this box',1,0)}${btn('off','No thanks',0,0)}</div>`;
  b.querySelectorAll('[data-mt]').forEach(x=>x.onclick=()=>this.save(x.dataset.mt[0]==='1',x.dataset.mt[1]==='1',box))},
 async mount(el){if(S.me?.admin===false||el.querySelector('#metricsBox'))return;const col=el.querySelector('[data-act="cfg-defaults"]')?.closest('.panel')?.parentElement;
  // "All agents" shows a list instead of the form: the card goes under it, for the agent you chat with
  if(col)col.insertAdjacentHTML('beforeend',this.card());else{el.insertAdjacentHTML('beforeend',`<div style="margin-top:16px;max-width:560px">${this.card()}</div>`)}
  const box=el.querySelector('#metricsBox'),ag=this.who();if(this.c[ag])this.paint(box,this.c[ag]);
  try{const c=await H('/shared-metrics/consent');this.c[ag]=c;if(box.isConnected)this.paint(box,c)}catch(e){if(e?.stale)return;if(box.isConnected&&!this.c[ag])this.paint(box,null)}},
 async ask(){const k='hui-metricsAsked:'+this.who();try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1')}catch{}
  const c=await H('/shared-metrics/consent',{keep:true}).catch(()=>null);if(!c||c.managed||(c.decided&&!c.reask))return;this.c[this.who()]=c;
  Notices.show({icon:'chart',kind:'blue',key:'metrics-ask',life:600000,title:c.reask?'Usage stats: asking once more':'Share anonymous usage stats?',text:c.reask?'An older version could save “No thanks” before you saw this question. To share, choose on System › Settings.':'Only counts, never what you write or your files. You choose per agent.',actions:[c.reask?{label:'No thanks',run:()=>this.save(false,false)}:{label:'Choose',go:'/system/settings'}]})}};
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{await settings(p,el,r);Metrics.mount(el)}}
boot();

// F26 rows you can reach with Tab (schedules, inbox items, file tiles, agent cards) open with Enter or Space too
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[tabindex="0"]:is([data-act],[data-inbox])')&&!e.target.matches('input,textarea,select,button')){e.preventDefault();e.target.click()}});
ACT['panel-full']=()=>window.open(location.origin+'/'+location.hash,'_blank');
