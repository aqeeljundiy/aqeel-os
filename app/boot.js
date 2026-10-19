// Event wiring and startup.
function openMenu(el){const k=el.dataset.menu;
 if(k==='convo'){const id=el.dataset.id;const pinned=store.get('pinned',[]);const isPin=pinned.includes(id);
  menu(el,[{label:'Rename',icon:'edit',run:()=>renameSession(id)},{label:isPin?'Unpin':'Pin',icon:'pin',run:()=>{store.set('pinned',isPin?pinned.filter(x=>x!==id):[id,...pinned]);paintSide()}},{label:'Fork',icon:'fork',run:async()=>{Chat.id=id;await Chat.fork()}},{label:'Export JSON',icon:'download',run:()=>ACT['hist-export']({dataset:{id}})},'-',{label:'Delete',icon:'trash',bad:true,run:()=>deleteSession(id)}])}
 if(k==='model'){const ms=Chat.models||[];const cur=Chat.cur();menu(el,[{label:'Default ('+modelLabel(Chat.defaultModel?.id)+')',icon:'cpu',on:!Chat.model,run:()=>Chat.setModel(null)},'-',...ms.map(m=>({label:m.label+' · '+m.providerName,icon:'cpu',on:!!Chat.model&&m.id===cur.id&&m.provider===cur.provider,run:()=>Chat.setModel(m)})),'-',{label:'Sign in to more models…',icon:'key',run:()=>go('/models/models')}])}
 if(k==='effort')menu(el,EFFORTS.map(e=>({label:e[0].toUpperCase()+e.slice(1),on:e===Chat.effort,run:()=>Chat.setEffort(e)})));
 if(k==='workspace'){H('/chat/workspaces').then(w=>{const items=[{label:'Home (~)',icon:'folder',on:!Chat.cwd,run:()=>{Chat.cwd='';store.set('cwd','');Chat.paintComposerBar()}},...[...(w.projects||[]),...(w.repos||[])].map(x=>{const p=x.path||x;return {label:String(p).replace(/^\/home\/claude/,'~'),icon:'folder',on:Chat.cwd===p,run:()=>{Chat.cwd=p;store.set('cwd',p);Chat.paintComposerBar()}}}),'-',{label:'Other path…',icon:'plus',run:async()=>{const p=await promptBox('Folder for new chats','Full path on the box',Chat.cwd||'/home/claude/');if(p){Chat.cwd=p.trim();store.set('cwd',Chat.cwd);Chat.paintComposerBar()}}},{label:'Rescan for repos',icon:'refresh',run:()=>H('/chat/workspaces?scan=1').then(()=>toast('Rescanned'))}];menu(el,items)}).catch(fail)}
 if(k==='profile'){const ad=S.me?.admin!==false;H('/profiles').then(pr=>{const cur=ident(S.profile||'default').name;
  const agents=()=>menu(el,[{header:'Switch agent'},...(pr.profiles||[]).map(p=>({label:ident(p.name).name,icon:'user',on:(S.profile||'default')===p.name,run:()=>switchAgent(p.name)})),...(ad?['-',{label:'Manage agents',icon:'settings',run:()=>go('/agents/profiles')}]:[])],{search:(pr.profiles||[]).length>7});
  const prefs=()=>{const dark=document.documentElement.classList.contains('dark');menu(el,[{header:'Preferences'},{label:dark?'Light mode':'Dark mode',icon:dark?'sun':'moon',run:theme},{label:'Language: '+(Lang.cur==='id'?'Bahasa Indonesia':'English'),icon:'globe',run:()=>Lang.set(Lang.cur==='id'?'en':'id')},{label:'Costs in: '+(currency()==='IDR'?'Rupiah (Rp)':'US dollars ($)'),icon:'chart',run:()=>setCurrency(currency()==='IDR'?'USD':'IDR')},{label:'Keyboard shortcuts',icon:'cmd',kbd:MOD+' /',run:shortcuts},...(ad?[{label:'Development board',icon:'list',run:()=>window.open('/backlog','_blank','noopener')}]:[])])};
  menu(el,[...(S.me?.name?[{header:S.me.name+' · '+({owner:'Owner',admin:'Admin',member:'Member'}[S.me.role]||'')}]:[]),...(S.me?[{label:'Your profile',icon:'user',run:()=>ACT['me-profile']()}]:[]),{label:'Agent: '+cur,icon:'user',kbd:'›',run:()=>setTimeout(agents)},{label:'Preferences',icon:'settings',kbd:'›',run:()=>setTimeout(prefs)},'-',{label:'Sign out',icon:'logout',run:signOut}])}).catch(fail)}
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
function switchAgent(name){if((S.profile||'default')===name)return;S.profile=name;store.set('profile',name);Chat.live={};Chat.id=null;Chat.model=null;S.sessions=[];S.sessionsLoaded=false;toast('Now talking to '+ident(name).name);go('/chat');boot()}
function shortcuts(){drawer('Keyboard shortcuts',`<table>${[[MOD+' K','Search and commands'],[MOD+' B','Collapse the sidebar'],[MOD+' 1–7','Jump to Chat, Agents, Automations, Channels, Abilities, Models, System'],['Enter','Send'],['Shift Enter','New line'],['Esc','Stop aqeelOS, or close a panel'],['/','Chat commands'],[MOD+' /','This list']].map(([k,v])=>`<tr><td style="white-space:nowrap"><span class="chip" style="font-family:var(--mono)">${esc(k)}</span></td><td>${esc(v)}</td></tr>`).join('')}</table>`)}

document.addEventListener('click',e=>{
 const g=e.target.closest('[data-go]');if(g&&!e.target.closest('[data-menu]')&&!e.target.closest('.switch')){e.preventDefault();go(g.dataset.go);return}
 const m=e.target.closest('[data-menu]');if(m){e.stopPropagation();e.preventDefault();openMenu(m);return}
 const t=e.target.closest('[data-tab]');if(t){const box=t.closest('[data-tabs]');const key=box.dataset.tabs;
  if(key==='chatFilter'){S.chatFilter=t.dataset.tab;store.set('chatFilter',S.chatFilter);paintSide();placePills();return}
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
  case 'banner':S.bannerDismissed=a.dataset.key;store.set('bannerDismissed',a.dataset.key);$('#bannerSlot').innerHTML='';break;
  case 'new':Chat.newChat();break;
  case 'close':closeLayers();break;
  case 'reload':reload();break;
  case 'step':a.closest('.step').classList.toggle('open');break;
  case 'think':{const b=a.nextElementSibling;b.hidden=!b.hidden;a.querySelector('svg:last-child').style.transform=b.hidden?'':'rotate(90deg)';break}
  case 'approval':Chat.approve(a.dataset.choice);break;
  case 'perm-menu':Chat.permMenu(a);break;
  case 'perm-toggle':{if(!Chat.id){toast('Send the first message, then choose Allow all for this chat.');break}const on=!Chat.allowAll(Chat.id);Chat.setAllowAll(Chat.id,on);Chat.paintComposerBar();toast(on?'Allow all in this chat: no approval prompts (blocked commands stay blocked).':'Ask me: risky commands wait for your OK again.');break}
  case 'attach':pickFile('*/*',f=>Chat.addFiles(f),true);break;
  case 'att-zoom':{const d=document.createElement('div');d.className='att-zoom';d.innerHTML=`<img src="${esc(a.src)}" alt="">`;d.onclick=()=>{d.classList.add('out');setTimeout(()=>d.remove(),200)};document.body.append(d);break}
  case 'unattach':{const f=Chat.files[+a.dataset.i];if(f?.blob&&!Chat._sentAtt)setTimeout(()=>URL.revokeObjectURL(f.blob),60000)}Chat.files.splice(+a.dataset.i,1);Chat.paintFiles();break;
  case 'copymsg':{const t=Chat.live[Chat.id]?.turns[+a.dataset.i];navigator.clipboard.writeText(t?.text||'').then(()=>toast('Reply copied'));break}
  case 'copycode':navigator.clipboard.writeText(a.closest('.codeblock').querySelector('pre').textContent).then(()=>toast('Code copied'));break;
  case 'copy-text':navigator.clipboard.writeText(a.dataset.text).then(()=>toast('Copied'));break;
  case 'retry':Chat.retry();break;
  case 'send-mode':Chat.setSendMode(a.dataset.mode);break;
  case 'steer-now':Chat.steerNow();break;
  case 'send-busy':Chat.submit();break;
  case 'unqueue':{const s=Chat.live[Chat.id];s?.queue?.splice(+a.dataset.i,1);Chat.paintQueue();break}
  case 'queue-go':{const s=Chat.live[Chat.id];if(s){s.paused=false;Chat.runQueue(Chat.id)}break}
  case 'fork':Chat.fork();break;
  case 'rename-current':if(Chat.id)renameSession(Chat.id);break;
  case 'plugin-page':window.open(location.protocol+'//'+location.hostname+':9119'+a.dataset.path,'_blank','noopener');toast('Opens in the original dashboard (tunnel needed)');break;
 }
});
document.addEventListener('input',e=>{if(e.target.id==='chatSearch'){S.search=e.target.value;const pos=e.target.selectionStart;paintSide();placePills();const i=$('#chatSearch');i.focus();i.setSelectionRange(pos,pos)}});
document.addEventListener('keydown',e=>{
 if(e.target.closest?.('[data-menu]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openMenu(e.target.closest('[data-menu]'));return}
 const mod=isMac?e.metaKey:e.ctrlKey;if(!S.signedIn)return;
 if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();palette()}
 if(mod&&e.key.toLowerCase()==='b'){e.preventDefault();$('[data-act="collapse"]')?.click()}
 if(mod&&/^[1-7]$/.test(e.key)&&SECTIONS[+e.key-1]){e.preventDefault();go('/'+SECTIONS[+e.key-1].id)}
 if(mod&&e.key==='/'){e.preventDefault();shortcuts()}
 if(e.key==='Escape'&&$('.palette,.drawer,.menu'))closeLayers();
});
addEventListener('hashchange',()=>{if(S.signedIn)render()});
addEventListener('resize',placePills);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.signedIn){refreshStatus();Chat.loadSessions()}});

async function boot(){
 await Brand.load();
 try{const r=await fetch('/auth/me');S.signedIn=r.ok}catch{S.signedIn=false}
 if(!S.signedIn)return render();
 await loadMe();
 S.profile=store.get('profile','');if(S.me&&!S.me.admin&&!S.me.agents[S.profile||'default']){const first=Object.keys(S.me.agents)[0]||'';S.profile=first==='default'?'':first}
 render();
 await Promise.all([loadIdentities(),refreshStatus(),Chat.loadModels(),Chat.loadSessions(),H('/dashboard/plugins').then(p=>S.dashPlugins=p).catch(()=>{})]);
 $$('.agent-name').forEach(e=>e.textContent=AGENT());const msg=$('#msg');if(msg)msg.placeholder=Chat.placeholder();if(S.signedIn&&$('.app')){paintSide();paintTop();placePills();Screen.paint();if(route().chat!==undefined&&route().chat!=='manage')Chat.paintComposerBar()}
 clearInterval(S.statusT);S.statusT=setInterval(()=>{if(!document.hidden)refreshStatus()},30000);
}
// Tell the user when a newer aqeelOS was deployed (checked every minute and when the tab comes back).
const BUILD=document.querySelector('meta[name=build]')?.content;
async function checkUpdate(){if(!BUILD||$('#updBanner'))return;try{const r=await (await fetch('/healthz',{cache:'no-store'})).json();if(r.build&&r.build!==BUILD){const b=document.createElement('div');b.id='updBanner';b.className='toast';b.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:70;gap:12px';b.innerHTML=`${icon('sparkle',15)}aqeelOS was updated<button class="primary" style="min-height:30px;padding:0 14px;font-size:12.5px">Reload</button>`;b.querySelector('button').onclick=()=>location.reload();document.body.append(b)}}catch{}}
setInterval(()=>{if(!document.hidden)checkUpdate()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdate()});
boot();

// F26 rows you can reach with Tab (schedules, inbox items, file tiles, agent cards) open with Enter or Space too
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[tabindex="0"][data-act]')&&!e.target.matches('input,textarea,select,button')){e.preventDefault();e.target.click()}});
ACT['panel-full']=()=>window.open(location.origin+'/'+location.hash,'_blank');
