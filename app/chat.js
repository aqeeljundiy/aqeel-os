// why the chat list is empty after an error, and where to fix it (System › Health says what the engine needs)
function chatsErrText(){const e=S.install?.engine?.state,why=e==='auth'?'The engine needs one restart.':e==='down'?'The engine isn’t answering.':'The engine didn’t answer.';
 return "Couldn't load chats. "+why+(S.me?.admin!==false?' <a href="#/system/health">See Health</a>':' An admin can fix it.')}
// Claude-style chat on top of Hermes: conversation list (dashboard API), history, and live turns
// streamed from the gateway's session-chat SSE endpoint, with tool cards, approvals, stop and steer.
const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
const EFFORT_LABEL={none:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'};
const AUTOMATION_SOURCES=['cron','api_server_runs','tool','acp','webhook','oneshot','hermes_flow','vulcan_delegate'];
// the engine's context-compaction handoff (kept in sync with its context compressor)
const COMPACT_PREFIXES=['[CONTEXT COMPACTION — REFERENCE ONLY]','[CONTEXT COMPACTION - REFERENCE ONLY]','[CONTEXT SUMMARY]:'];
const COMPACT_END='--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---';
// connecting lasts a frame or two: its dot only (the word pushed the bar onto two lines and back, a 42 px bounce on every send)
const CONN_TEXT={connecting:'Connecting…',live:'Live',reconnecting:'Reconnecting…',lost:'Connection lost'};
// Where a chat came from, said plainly on hover.
/* what you have seen: per agent, each chat's last activity when you last had it open (in this browser) */
const ChatSeen={k:()=>'chatSeen:'+(S.profile||'default'),
 db(){let v=null;try{v=JSON.parse(localStorage.getItem(this.k()))}catch{}if(!v){v={base:Date.now()/1000,c:{}};this.save(v)}return v},   // first visit: nothing lights up at once
 save(v){try{localStorage.setItem(this.k(),JSON.stringify(v))}catch{}},
 mark(id,t){const v=this.db();const at=Math.max(t||0,Date.now()/1000);if((v.c[id]||0)<at-1){v.c[id]=at;this.save(v)}},
 isNew(c){const v=this.db();return (c.last_active||c.started_at||0)>(v.c[c.id]||v.base)+2}};
const SRC_LABEL={api_server:'Started in this app',whatsapp:'From WhatsApp',telegram:'From Telegram',cron:'A schedule ran this',webhook:'Started by a webhook',cli:'From the command line',tui:'From the command line',oneshot:'A one-off task',discord:'From Discord',slack:'From Slack',email:'From email'};
const Chat={
 models:null,model:store.get('model',null),effort:store.get('effort','medium'),
 live:{},        // sessionId → {turns, running, runId, abort}
 cwd:store.get('cwd',''),
 sendMode:store.get('sendMode','steer'),   // while busy: 'steer' (into the running reply) or 'queue' (after it)
 // folder and effort are kept per agent; an agent's effort starts at its saved default until the person picks one
 agentPrefs(){const k=S.profile||'default';this.cwd=store.get('cwd:'+k,k==='default'?store.get('cwd',''):'');const e=store.get('effort:'+k,null);
  if(EFFORTS.includes(e))this.effort=e;else{this.effort=EFFORTS.includes(store.get('effort','medium'))?store.get('effort','medium'):'medium';
   H('/config',{keep:true}).then(c=>{const v=String(c?.agent?.reasoning_effort||'').trim().toLowerCase();if(EFFORTS.includes(v)&&!store.get('effort:'+k,null)&&(S.profile||'default')===k&&v!==this.effort){this.effort=v;this.paintComposerBar()}}).catch(()=>{})}},
 setCwd(p){this.cwd=p||'';store.set('cwd:'+(S.profile||'default'),this.cwd);this.paintComposerBar()},

 /* ---------- sidebar ---------- */
 sidebar(r){
  const q=S.search.toLowerCase();
  const list=S.sessions.filter(c=>(S.chatFilter==='all'||(S.chatFilter==='chats')!==AUTOMATION_SOURCES.includes(c.source))&&(!q||((c.title||'')+' '+(c.preview||'')).toLowerCase().includes(q)));
  const pinned=store.get('pinned',[]);const pins=list.filter(c=>pinned.includes(c.id)),rest=list.filter(c=>!pinned.includes(c.id));
  const groups={};rest.forEach(c=>(groups[groupOf(c.last_active||c.started_at)]??=[]).push(c));
  /* each row: where it came from (always), a ring while the agent is really working, a dot when something is new */
  const now=Date.now()/1000;if(r.chat)ChatSeen.mark(r.chat,S.sessions.find(x=>x.id===r.chat)?.last_active);
  const row=c=>{const working=this.live[c.id]?.running||(c.is_active&&now-(c.last_active||0)<120);const unread=!working&&r.chat!==c.id&&ChatSeen.isNew(c);const from=SRC_LABEL[c.source]||('From '+pretty(c.source||'this app'));
   const tip=[ago(c.last_active||c.started_at),c.message_count!=null?plural(c.message_count,'message'):''].filter(Boolean).join(' · ');
   return `<button class="item ${r.chat===c.id?'on':''} ${unread?'unread':''}" data-go="/chat/${esc(c.id)}" title="${esc(tip)}"><span class="src ${working?'working':''}${Chat.live?.[c.id]?.running&&Chat.live[c.id].ai?.approval&&!Chat.live[c.id].ai.approval.resolved?' waiting':''}" title="${esc(from+(working?' · working now':unread?' · new since you last looked':''))}">${icon(srcIcon(c.source),14)}</span><span class="t">${esc(c.title||c.preview||'Untitled chat')}</span>${c.person?`<span class="who">${esc(c.person)}</span>`:''}${unread?'<i class="unread-dot" aria-label="New"></i>':''}<span class="more" role="button" tabindex="0" data-menu="convo" data-id="${esc(c.id)}" aria-label="More">${icon('more',16)}</span></button>`};
  const body=S.sessionsErr&&!S.sessions.length?`<div class="side-err">${alertBox(chatsErrText(),{act:'side-refresh'})}</div>`:!S.sessionsLoaded?'<div class="skel skel-row" style="height:30px;margin:12px 10px"></div>'.repeat(5):list.length?`${pins.length?`<div class="group-label">Pinned</div>${pins.map(row).join('')}`:''}${Object.entries(groups).map(([g,l])=>`<div class="group-label">${g}</div>${l.map(row).join('')}`).join('')}`:`<p style="padding:16px 12px;color:var(--muted);font-size:13px">${q?'No chats match.':'No chats yet.'}</p>`;
  return `<div class="side-sub"><div style="padding:12px 12px 8px;display:flex;gap:6px"><button style="flex:1" data-act="new">${icon('plus',16)}New chat</button><button class="ghost icon side-refresh" data-act="side-refresh" title="Refresh the chat list" aria-label="Refresh the chat list">${icon('refresh',16)}</button></div>
   <div class="side-search">${icon('search',15)}<input id="chatSearch" placeholder="Search chats" aria-label="Search chats" value="${esc(S.search)}"></div>
   <div style="padding:0 12px 6px"><div class="tabs" data-tabs="chatFilter" style="margin:0;display:flex">${[['chats','Chats'],['automation','Scheduled runs'],['all','All']].map(([k,l])=>`<button class="${S.chatFilter===k?'on':''}" data-tab="${k}" style="flex:1;padding:6px 8px;font-size:12.5px">${l}</button>`).join('')}<span class="pill"></span></div></div>
   <div class="side-list">${body}</div>
   <div style="padding:6px 10px 10px;border-top:1px solid var(--border)"><button class="item ${r.chat==='manage'?'on':''}" data-go="/chat/manage">${icon('list',16)}<span class="t">Manage chats</span><span class="n">${S.sessionsTotal??''}</span></button></div></div>`;
 },
 async loadSessions(quiet){
  // the tab's sources go to the engine, so scheduled runs never crowd chats out of the newest 100 (and the reverse)
  const src=S.chatFilter==='chats'?{exclude_sources:AUTOMATION_SOURCES.join(',')}:S.chatFilter==='automation'?{sources:AUTOMATION_SOURCES.join(',')}:{};
  try{const d=await H('/sessions'+qp({limit:100,offset:0,order:'recent',...src}),{keep:quiet});const noTools=s=>String(s||'').replace(/^\[Use these tools for this: [^\]]*\]\s*/,'');S.sessions=(d.sessions||[]).map(x=>({...x,preview:noThink(noTools(x.preview)),title:noTools(x.title)}));S.sessionsTotal=d.more?num(d.total??S.sessions.length)+'+':d.total;S.sessionsLoaded=true;S.sessionsErr=null}catch(e){if(e?.stale)return;S.sessionsLoaded=true;S.sessionsErr=e;if(!quiet&&S.sessions.length)fail(e)}
  if(route().sec.id==='chat'&&$('.side')){const f=document.activeElement?.id==='chatSearch'?document.activeElement.selectionStart:null,top=$('.side-list')?.scrollTop||0;paintSide();placePills();if($('.topbar'))paintTop();const sl=$('.side-list');if(sl&&top)sl.scrollTop=top;
   if(f!=null){const i=$('#chatSearch');if(i&&document.activeElement!==i){i.focus();i.setSelectionRange(f,f)}}}
 },
 // every 20 s while the chat is on screen: the list catches chats started elsewhere (channels, schedules, other tabs);
 // Manage chats redraws only when its newest chat changed and nothing is selected or opened there
 async tick(){if(document.hidden||!S.signedIn)return;const r=route();if(r.sec?.id!=='chat')return;await this.loadSessions(true);
  if(r.chat==='manage'&&!S.histQ&&!$$('.pick-row:checked').length&&!$('.hist-peek')){const h=S.sessions[0]?(S.sessions[0].id+'@'+S.sessions[0].last_active+'#'+S.sessionsTotal):'';if(Pages._histHead!==undefined&&h!==Pages._histHead&&$('#pg'))Pages.manageChats($('#view'),{soft:true});Pages._histHead=h}},

 /* ---------- models ---------- */
 async loadModels(){
  try{const d=await G('/api/model/options');const out=[];
   for(const p of d.providers||[]){if(!usableProvider(p))continue;for(const m of p.models||[])out.push({id:m,provider:p.slug,providerName:provLabel(p),label:modelLabel(m),reasoning:p.capabilities?.[m]?.reasoning!==false,current:p.is_current&&m===d.model})}
   this.usage=Object.fromEntries((d.providers||[]).filter(p=>p.usage?.windows?.length).map(p=>[p.slug,p.usage.windows]));this.defProv=d.provider;
   this.provWarn=Object.fromEntries((d.providers||[]).filter(p=>p.warning).map(p=>[p.slug,String(p.warning)]));this.modelsErr=null;
   // Current provider first, then everything else signed in.
   out.sort((a,b)=>(b.provider===d.provider)-(a.provider===d.provider));
   this.models=out;this.defaultModel={id:d.model,provider:d.provider};S.model=d.model;
   if(!this.model||!out.some(m=>m.id===this.model.id&&m.provider===this.model.provider))this.model=null;
  }catch(e){this.modelsErr=e;if(!this.models)this.models=[]}
 },
 cur(){return this.model||this.defaultModel||{}},
 setModel(m){this.model=m?{id:m.id,provider:m.provider}:null;store.set('model',this.model);this.paintComposerBar();toast('Model: '+(m?m.label:'default'))},
 setEffort(e){this.effort=e;store.set('effort:'+(S.profile||'default'),e);this.paintComposerBar()},
 // the composer's model list: one group per account ("Provider (n models)"), its warning under it, searchable by name, id or account
 modelMenu(el){const ms=this.models||[],cur=this.cur(),ad=!S.me||S.me.admin;
  if(!ms.length&&this.modelsErr)return menu(el,[{header:"Couldn't load models"},{label:'Try again',icon:'refresh',run:()=>this.reloadModels()}]);
  if(!ms.length)return menu(el,[{header:'No models yet: add a key or sign in'},...(ad?[{label:'Add a key',icon:'key',run:()=>go('/system/keys')},{label:'Sign in to a model',icon:'user',run:()=>go('/models/models')}]:[]),{label:'Refresh models',icon:'refresh',run:()=>this.reloadModels()}]);
  const groups=new Map();for(const m of ms){if(!groups.has(m.provider))groups.set(m.provider,[]);groups.get(m.provider).push(m)}
  // a pick here is for this chat only; the agent's own model is set on Models › Agents' models (1 Nov 2026)
  const items=[{header:'Model for this chat only'},{label:'Default ('+modelLabel(this.defaultModel?.id)+')',sub:'The agent’s own model',icon:'cpu',on:!this.model,run:()=>this.setModel(null)}];
  for(const [slug,l] of groups){items.push('-',{header:l[0].providerName+' ('+plural(l.length,'model')+')',title:slug});if(this.provWarn?.[slug])items.push({label:this.provWarn[slug],icon:'alert',disabled:true,find:slug});
   items.push(...l.map(m=>({label:m.label,title:m.id,find:m.id+' '+slug+' '+m.providerName,icon:'cpu',on:!!this.model&&m.id===cur.id&&m.provider===cur.provider,run:()=>this.setModel(m)})))}
  items.push('-',{label:'Refresh models',icon:'refresh',run:()=>this.reloadModels()},...(ad?[{label:'Sign in to more models…',icon:'key',run:()=>go('/models/models')}]:[]));
  menu(el,items,{search:ms.length>8})},
 async reloadModels(){const b=$('[data-menu=model]');b?.classList.add('is-busy');await this.loadModels();this.paintComposerBar();const n=$('[data-menu=model]');if(n)this.modelMenu(n);if(this.modelsErr)toast("Couldn't load models: "+(this.modelsErr.message||this.modelsErr),'err')},
 effortMenu(el){menu(el,[{header:'How hard it thinks'},...EFFORTS.map(e=>({label:EFFORT_LABEL[e],sub:e==='none'?'No thinking: fastest':e==='ultra'?'The most thinking the model allows':'',on:e===this.effort,run:()=>this.setEffort(e)}))])},
 // the folder a new chat starts in: the agent's projects (one row per folder) and repositories it found, newest first
 async workspaceMenu(el,w){if(!w){try{w=await H('/chat/workspaces')}catch(e){return fail(e)}}
  const home=String(w.home||boxHome()).replace(/\/+$/,''),short=p=>{p=String(p||'');return p===home?'~':p.startsWith(home+'/')?'~'+p.slice(home.length):p};
  const seen=new Set(),projs=[],repos=[],row=(label,p)=>({label,sub:short(p),find:p,icon:'folder',on:this.cwd===p,run:()=>this.setCwd(p)});
  for(const pj of w.projects||[]){if(pj.archived)continue;const fs=(pj.folders||[]).length?pj.folders:pj.primary_path?[{path:pj.primary_path}]:[];
   for(const f of fs){const p=typeof f==='string'?f:f.path;if(!p||seen.has(p))continue;seen.add(p);projs.push(row((pj.name||short(p))+(fs.length>1?' · '+(f.label||short(p)):''),p))}}
  for(const r of [...(w.repos||[])].sort((a,b)=>(b.last_active||0)-(a.last_active||0))){const p=typeof r==='string'?r:r.root||r.path;if(!p||seen.has(p))continue;seen.add(p);repos.push(row(r.label||short(p).split('/').pop(),p))}
  menu(el,[{label:'Home ('+short(w.default_cwd||home)+')',icon:'folder',on:!this.cwd,run:()=>this.setCwd('')},...(projs.length?['-',{header:'Projects'},...projs]:[]),...(repos.length?['-',{header:'Repositories'},...repos]:[]),
   '-',{label:'Other path…',icon:'plus',run:async()=>{const p=await promptBox('Folder for new chats','Full path on the box',this.cwd||home+'/');if(p)this.setCwd(p.trim())}},
   {label:'Rescan for repos',icon:'refresh',run:async()=>{el.classList.add('is-busy');try{const d=await H('/chat/workspaces?scan=1');el.classList.remove('is-busy');const n=(d.repos||[]).length;toast('Found '+n+' '+(n===1?'repository':'repositories'));if(el.isConnected)this.workspaceMenu(el,d)}catch(e){el.classList.remove('is-busy');fail(e)}}}],{search:projs.length+repos.length>8})},

 /* ---------- view ---------- */
 view(el,id){
  if(id==='manage')return Pages.manageChats(el);
  if(this.id!==id&&this.files.length){for(const f of this.files)if(f.blob)URL.revokeObjectURL(f.blob);this.files=[]}
  this.id=id;this._hit=S.chatHit&&S.chatHit.id===id?S.chatHit:null;S.chatHit=null;
  el.innerHTML=`<div class="chat"><div class="chat-scroll" id="scroll">${id?'<div class="thread" id="thread"><div class="skel" style="height:60px;width:60%;align-self:flex-end"></div><div class="skel" style="height:120px"></div></div>':this.emptyHtml()}</div><div id="secretSlot" class="secret-slot"></div>${this.composerHtml()}</div>`;Secrets.check();
  this.bindComposer();this.paintQueue();
  if(id){const c=(S.sessions||[]).find(x=>x.id===id),s=this.live[id];if(s&&(s.running||!c||!s.seenAt||(c.last_active||0)<=s.seenAt))this.paint();else this.loadHistory(id)}
  // no starter suggestions on a new chat (removed 19 Oct at the owner's request)
 },
 emptyHtml(){if(S.me&&!S.me.admin&&!Object.keys(S.me.agents||{}).length)return `<div class="chat-empty"><div class="halo">${icon('user',28)}</div><h1>Welcome, ${esc(S.me.name)}</h1><p>${esc(S.me.canMake?NO_AGENT_MAKE:NO_AGENT_TEXT)}</p>${S.me.canMake?`<button class="primary" data-act="prof-new" style="margin-top:14px">${icon('plus',16)}Create your agent</button>`:''}</div>`;
  const hi='Welcome to aqeelOS';
  return `<div class="chat-empty"><div class="halo">${agentAvatar(S.profile||'default',56,{title:false})}</div><h1>${hi}</h1><p>${S.me&&!S.me.admin?`What can <span class="agent-name">${esc(AGENT())}</span> help you with today?`:`What should <span class="agent-name">${esc(AGENT())}</span> work on? It runs on your AI box, so it keeps going when you close this tab.`}</p>
  </div>`},
 composerHtml(){const other=(S.sessions||[]).find(x=>x.id===this.id)?.person;if(other)return '<div class="composer-wrap"><p class="hint-line chat-readonly">'+esc(other)+'’s chat. You can read it, but not reply here.</p></div>';const running=this.live[this.id]?.running;
  return `<div class="composer-wrap"><div style="position:relative;max-width:780px;margin:0 auto"><div id="runBar" class="run-slot"></div><div id="slash"></div><div class="composer" id="composer">
  <div id="queueList"></div><div id="toolChips" class="tool-chips">${this.toolChipsHtml()}</div><div id="attachList" style="display:flex;gap:6px;flex-wrap:wrap"></div>
  <textarea id="msg" rows="1" placeholder="${esc(this.placeholder())}" aria-label="Message"></textarea>
  <div class="composer-bar" id="cbar">${this.barHtml()}</div></div>
  <p class="hint-line">${S.me&&!S.me.admin?`<span class="agent-name">${esc(AGENT())}</span> can make mistakes. Check anything important.`:`<span class="agent-name">${esc(AGENT())}</span> runs on your AI box and can use its terminal, files and the web.`}${S.supervised?' Admins can review chats here.':''}</p></div></div>`},
 // How much of the current account's limit is used (worst of its session/week windows), next to the model.
 meterHtml(){const prov=this.cur()?.provider||this.defProv;const ws=(this.usage||{})[prov];if(!ws)return '';const acct=ws.filter(w=>w.scope!=='model');const u=Math.round(Math.max(0,...(acct.length?acct:ws).map(w=>Number(w.used_percent)||0)));
  const tip=ws.map(w=>`${w.label}: ${Math.round(w.used_percent||0)}% used${w.resets_at?' · resets '+when(w.resets_at):''}`).join('\n');const c=u>=90?'bad':u>=70?'warn':'ok';const R=7,L=2*Math.PI*R;
  return `<button class="meter ${c}" data-act="meter-card" title="${esc(tip)}" aria-label="${u}% of this account's limit used"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="${R}" class="trk"/><circle cx="9" cy="9" r="${R}" class="val" stroke-dasharray="${L}" stroke-dashoffset="${L*(1-u/100)}"/></svg><span>${u}%</span></button>`},
 refreshUsage(){clearTimeout(this._uT);this._uT=setTimeout(async()=>{await this.loadModels().catch(()=>{});const m=$('.meter');if(m){const t=document.createElement('div');t.innerHTML=this.meterHtml();const n=t.firstElementChild;if(n)m.replaceWith(n)}},1500)},
 barHtml(){const s=this.live[this.id],running=s?.running;const m=this.cur();const known=(this.models||[]).find(x=>x.id===m.id&&x.provider===m.provider);
  // the engine answered on another model than the one chosen (it fell back): the pill says so while the reply runs
  const rm=running&&s.runModel&&m.id&&s.runModel!==m.id&&modelLabel(s.runModel)!==modelLabel(m.id)?s.runModel:'';
  const folder=S.me&&!S.me.admin?'':!this.id?`<button class="pick" data-menu="workspace" title="Folder for this chat">${icon('folder',15)}<span>${esc(this.cwd?this.cwd.replace(/^\/home\/claude/,'~'):'~')}</span></button>`:`<button class="ghost icon" data-menu="workspace" title="Folder for new chats: ${esc(this.cwd?this.cwd.replace(/^\/home\/claude/,'~'):'~')} (this chat keeps its own)" aria-label="Folder for new chats">${icon('folder',17)}</button>`;
  const conn=s?.conn&&(s.conn!=='live'||running)?`<span class="conn ${s.conn}" role="status" title="${esc(CONN_TEXT[s.conn])}"><i></i><span>${s.conn==='live'||s.conn==='connecting'?'':esc(CONN_TEXT[s.conn])}</span></span>`:'';
  return `<span class="cb-l"><button class="ghost icon" data-act="attach" title="Attach pictures, videos or files" aria-label="Attach files">${icon('clip',18)}</button><button class="ghost icon" data-act="secret-give" title="Send a password or key securely" aria-label="Send a password or key securely">${icon('lock',18)}</button>${this.canTools()?`<button class="ghost icon ${this.tools.length?'on':''}" data-menu="chat-tools" title="Use a tool" aria-label="Use a tool">${icon('plug',18)}</button>`:''}<span id="voiceSlot" class="voice-slot">${Voice.btn()}</span>${folder}</span><span class="cb-r">${conn}${this.permBtn()}<button class="pick ${rm?'fallback':''}" data-menu="model" ${rm?`title="${esc('This reply runs on '+modelLabel(rm)+': the chosen model was not available')}"`:''}>${esc(rm?modelLabel(rm)+' (fallback)':known?known.label:modelLabel(m.id))}${icon('chevD',14)}</button>${this.meterHtml()}${(!known||known.reasoning)?`<button class="pick" data-menu="effort"><span>Effort </span>${esc(EFFORT_LABEL[this.effort]||this.effort)}${icon('chevD',14)}</button>`:''}
  ${running?`<button class="pick busy-mode" data-act="send-mode" data-mode="${this.sendMode==='queue'?'steer':'queue'}" title="${this.sendMode==='queue'?'Queue: your message waits until this reply is done. Click to steer instead.':'Steer: your message joins the reply in progress. Click to queue instead.'}">${icon(this.sendMode==='queue'?'clock':'wand',14)}<span>${this.sendMode==='queue'?'Queue':'Steer'}</span></button><button class="ghost icon" data-act="send-busy" title="${this.sendMode==='queue'?'Queue (Enter)':'Steer (Enter)'}" aria-label="${this.sendMode==='queue'?'Queue message':'Steer'}">${icon('send',17)}</button>`:''}<button class="primary send ${running?'stop':''}" id="send" aria-label="${running?'Stop':'Send'}" title="${running?'Stop (Esc)':'Send (Enter)'}">${icon(running?'stop':'send',18)}</button></span>`},
 // per-chat permission level, kept in this browser: 'Ask me' (default) or 'Allow all' (auto-approve)
 allowAll(id){return !!id&&store.get('allowAll:'+id,false)},
 // three levels: Ask me (this chat), Smart (the whole agent: an AI reviewer passes safe commands and asks you about
 // risky ones) and Allow all (this chat). The engine's block list applies at every level.
 smart:{},
 permLevel(){if(this.allowAll(this.id))return 'all';const ag=S.profile||'default';if(!(ag in this.smart)){this.smart[ag]=null;UI('/ui/agent-approvals?agent='+encodeURIComponent(ag)).then(r=>{this.smart[ag]=r.mode==='smart';this.paintComposerBar()}).catch(()=>{})}return this.smart[ag]?'smart':'ask'},
 permBtn(){const l=this.permLevel();const L={ask:['shield','Ask me','Ask me: commands that could change things wait for your OK.'],smart:['sparkle','Smart','Smart: an AI reviewer approves safe commands and asks you only about risky ones.'],all:['zap','Allow all','Allow all: no approval prompts in this chat (blocked commands stay blocked).']}[l];
  return `<button class="pick perm ${l!=='ask'?'on':''} lvl-${l}" data-act="perm-menu" title="${esc(L[2])} Click to change.">${icon(L[0],14)}<span>${L[1]}</span></button>`},
 permMenu(el){const l=this.permLevel(),ag=S.profile||'default',me=this;
  const set=async lv=>{if(lv==='all'&&!me.id)return toast('Send the first message, then choose Allow all for this chat.');
   if(lv==='all'){me.setAllowAll(me.id,true);me.paintComposerBar();return toast('Allow all in this chat: no approval prompts (blocked commands stay blocked).')}
   me.setAllowAll(me.id,false);const want=lv==='smart';if(!!me.smart[ag]!==want){try{await put(UI,'/ui/agent-approvals',{agent:ag,mode:want?'smart':'manual'});me.smart[ag]=want}catch(e){return fail(e)}}
   me.paintComposerBar();toast(want?'Smart for '+ident(ag).name+': safe commands go ahead, risky ones still ask you.':'Ask me: commands that could change things wait for your OK.')};
  menu(el,[{header:'When a command needs approval'},{label:'Ask me',sub:'Every one waits for your OK (this chat)',icon:'shield',on:l==='ask',run:()=>set('ask')},
   {label:'Smart',sub:'An AI reviewer approves safe ones and asks you about risky ones (all of '+ident(ag).name+'’s chats and channels)',icon:'sparkle',on:l==='smart',run:()=>set('smart')},
   {label:'Allow all',sub:'No prompts in this chat. Blocked commands stay blocked.',icon:'zap',on:l==='all',run:()=>set('all')}])},
 setAllowAll(id,on){if(id)store.set('allowAll:'+id,!!on)},
 placeholder(){const s=this.live[this.id];if(!s?.running)return 'Message '+AGENT()+'… (type / for commands)';return this.sendMode==='queue'?'Queue a message for after this reply…':'Steer '+AGENT()+' while it works…'},
 setSendMode(m){this.sendMode=m;store.set('sendMode',m);this.paintComposerBar();$('#msg')?.focus()},
 paintQueue(){const el=$('#queueList');if(!el)return;const s=this.live[this.id];const q=s?.queue||[];
  el.innerHTML=q.length?`<div class="queue">${q.map((m,i)=>`<span class="qchip" title="${esc(m.text)}"><b>${i+1}</b><span class="qt">${esc(m.text)}</span><button class="ghost icon" data-act="unqueue" data-i="${i}" aria-label="Remove from queue">${icon('x',12)}</button></span>`).join('')}${s.paused&&!s.running?`<span class="qnote">Paused after Stop</span><button class="qgo" data-act="queue-go">${icon('play',13)}Send next</button>`:`<span class="qnote">${s.running?'Runs after this reply':''}</span>`}</div>`:''},
 runQueue(id){const s=this.live[id];if(!s||s.running||s.paused||!s.queue?.length)return;const next=s.queue.shift();if(this.id===id)this.paintQueue();setTimeout(()=>this.send(next.text,next.images||[],id),250)},
 async browserChip(){const id=this.id;if(!id)return;let st={};try{st=await UI('/ui/local-browser/status?session='+encodeURIComponent(id))}catch{return}if(this.id!==id)return;
  const l=$('.cb-l');if(!l)return;l.querySelector('.lb-chip')?.remove();if(!st.session)return;
  l.insertAdjacentHTML('beforeend','<span class="lb-chip" title="This chat browses in your own Chrome">'+icon('monitor',13)+'In my browser<button class="ghost icon" data-act="lb-off" title="Back to the AI box screen" aria-label="Back to the AI box screen">'+icon('x',12)+'</button></span>')},
 paintComposerBar(){const b=$('#cbar');if(b)morph(b,this.barHtml());this.browserChip();const ta=$('#msg');if(ta)ta.placeholder=this.placeholder();this.paintQueue()},
 draftKey(){return 'draft:'+(S.profile||'default')+'|'+(this.id||'new')},
 bindComposer(){const ta=$('#msg');if(!ta)return;ta.focus();
  try{const d=localStorage.getItem(this.draftKey());if(d&&!ta.value){ta.value=d;ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px'}}catch{}
  let dt=null;const key=this.draftKey();
  ta.oninput=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px';this.slash(ta.value);clearTimeout(dt);dt=setTimeout(()=>{try{ta.value.trim()?localStorage.setItem(key,ta.value):localStorage.removeItem(key)}catch{}},300)};
  ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();const first=$('#slash .item');if(first&&/^\/\S*$/.test(ta.value))return this.pickSlash(first.dataset.cmd);this.submit()}if(e.key==='Escape'&&this.live[this.id]?.running)this.stop()};
  ta.onpaste=e=>{const f=[...(e.clipboardData?.files||[])];if(f.length){e.preventDefault();this.addFiles(f)}};
  const box=$('#composer');box.ondragover=e=>{e.preventDefault();box.classList.add('drop')};box.ondragleave=()=>box.classList.remove('drop');box.ondrop=e=>{e.preventDefault();box.classList.remove('drop');this.addFiles([...e.dataTransfer.files])};
 },

 /* ---------- attachments (images go inline to the model) ---------- */
 files:[],
 addFiles(list){for(const f of list){const kind=attKind(f.name,f.type);
  if(kind==='image'&&f.size<=8e6){const r=new FileReader();r.onload=()=>{this.files.push({name:f.name,kind,url:r.result,size:f.size});this.paintFiles()};r.readAsDataURL(f);continue}
  if(f.size>200e6){toast(f.name+' is larger than 200 MB','err');continue}
  this.files.push({name:f.name,kind,file:f,blob:URL.createObjectURL(f),size:f.size});this.paintFiles()}},
 paintFiles(){const el=$('#attachList');if(!el)return;el.innerHTML=this.files.map((f,i)=>`<span class="att-chip ${f.kind}">${f.kind==='image'?`<img src="${esc(f.url||f.blob)}" alt="">`:f.kind==='video'?`<video src="${esc(f.blob)}#t=0.5" muted preload="metadata"></video><span class="att-play">${icon('play',14)}</span>`:`<span class="att-ic">${icon('file',18)}</span>`}<span class="att-txt"><b>${esc(f.name)}</b><small>${attSize(f.size)}</small></span><button class="att-x" data-act="unattach" data-i="${i}" aria-label="Remove ${esc(f.name)}">${icon('x',12)}</button></span>`).join('')},
 // files that are not sent inline go to the box first; the message names where they are
 async uploadAtt(list){const out=[];const base=boxHome().replace(/\/$/,'')+'/uploads';
  for(const f of list){const t=new Date().toISOString().slice(0,10);const path=base+'/'+t+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)+'-'+f.name.replace(/[^\w.\- ]+/g,'_');
   const fd=new FormData();fd.append('path',path);fd.append('overwrite','false');fd.append('file',f.file||dataFile(f),f.name);
   await H('/files/upload-stream',{method:'POST',body:fd});out.push(path)}return out},

 /* ---------- history ---------- */
 // a long chat opens with its newest 150 messages (big chats were over 1 MB with every tool output); the rest on request
 // each "Show earlier" doubles the window (2000, 4000…) while full pages keep coming back
 async loadHistory(id,all=false){const lim=all?Math.max(2000,(this.live[id]?.lim||0)*2):150;
  try{const d=await H('/sessions/'+encodeURIComponent(id)+'/messages?limit='+lim+'&order=latest');if(this.id!==id)return;
   if(this.live[id]?.running)return;const ms=d.messages||[];
   // messages queued for this chat (here, or before switching agents) wait on through the reload
   const pk=this.parked?.[S.profile||'default'],old=this.live[id]||pk?.[id];if(pk)delete pk[id];
   this.live[id]={turns:this.toTurns(ms),running:false,seenAt:Date.now()/1000,more:ms.length>=lim,lim,queue:old?.queue||[],paused:!!old?.paused};this._opening=id;this.paint();this.follow(id);
   // the thinking shown while each reply streamed (saved by aqeelOS; some models keep none themselves)
   UI('/ui/thinking?session='+encodeURIComponent(id)).then(x=>{const s=this.live[id];if(!s||s.running||!(x.items||[]).length)return;let changed=false;const T=s.turns;
    for(let i=0;i<T.length-1;i++){if(T[i].role!=='user')continue;const ai=T[i+1];if(ai?.role!=='ai'||ai.think)continue;const q=String(T[i].text||'').slice(0,300);const hit=x.items.find(y=>y.u===q||(q&&y.u.startsWith(q.slice(0,120))));if(hit){ai.think=hit.think;changed=true}}
    if(changed&&this.id===id)this.paint()}).catch(()=>{});
   // A session that was continued after compaction: offer the newest continuation.
   // The engine follows only chats compacted for length; a chat that was reset and carried on (WhatsApp does this)
   // names the chat it continues, so that chain is followed here to its newest chat.
   const chain=from=>{let cur=from,seen=new Set([from]);for(;;){const next=(S.sessions||[]).filter(c=>c.parent_session_id===cur&&!seen.has(c.id)).sort((a,b)=>(b.started_at||0)-(a.started_at||0))[0];if(!next)return cur;seen.add(next.id);cur=next.id}};
   H('/sessions/'+encodeURIComponent(id)+'/latest-descendant').then(x=>{let nid=x?.latest_id||x?.session_id||x?.id;if(!nid||nid===id)nid=chain(id);else nid=chain(nid);if(nid&&nid!==id&&this.id===id){const th=$('#thread');th?.insertAdjacentHTML('afterbegin',`<div class="approval" style="background:var(--blue-soft);border-color:transparent"><h4>${icon('fork',16)}This chat continues in a newer one</h4><p>It carried on in a follow-up chat (it got long, or the conversation was reset).</p><div class="btns"><button class="primary" data-go="/chat/${esc(nid)}">Open the latest</button></div></div>`)}}).catch(()=>{});
  }catch(e){if(this.id===id)showError($('#scroll'),e)}
 },
 toTurns(msgs){const turns=[];let ai=null;const byCall={};
  for(let m of msgs){if(m.active===0)continue;
   // a context handoff (the engine summarised the chat so far) shows as its own folded card; a reply merged after it stays a reply
   if(typeof m.content==='string'&&COMPACT_PREFIXES.some(p=>m.content.trimStart().startsWith(p))){const at=m.content.indexOf(COMPACT_END);turns.push({role:'handoff',text:(at<0?m.content:m.content.slice(0,at)).trim(),at:m.timestamp});ai=null;
    const rest=at<0?'':m.content.slice(at+COMPACT_END.length).replace(/^\s+/,'');if(!rest)continue;m={...m,content:rest}}
   if(m.role==='user'){ai=null;let text=typeof m.content==='string'?m.content:this.contentText(m.content);text=text.replace(/\[image\]/g,'');const imgs=Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').map(p=>p.image_url?.url||p.image_url).filter(u=>typeof u==='string'&&/^(data:image|https?:|\/)/.test(u)):[];
    // a steer is saved inside the engine's "[OUT-OF-BAND USER MESSAGE …]" frame (for the model); show what was typed, as a steer
    const st=/^\s*\[OUT-OF-BAND USER MESSAGE[^\]]*\]\s*([\s\S]*?)\s*(?:\[\/OUT-OF-BAND USER MESSAGE\])?\s*$/.exec(text);
    if(st||m.display_kind==='steer'){turns.push({role:'user',text:st?st[1]:text,steer:'delivered',at:m.timestamp});continue}
    turns.push({role:'user',text,imgs,images:imgs.length,at:m.timestamp});continue}
   if(m.role==='system'){const t=this.contentText(m.content).trim();if(t){if(ai)(ai.sys??=[]).push(t);else turns.push({role:'sys',text:t,at:m.timestamp})}continue}
   if(!ai){ai={role:'ai',steps:[],text:'',think:''};turns.push(ai)}
   if(m.role==='assistant'){const r=m.reasoning_content||m.reasoning;if(r&&typeof r==='string')ai.think+=(ai.think?'\n\n':'')+r;
    // arguments that are not valid JSON stay readable as they were sent
    for(const tc of m.tool_calls||[]){const raw=tc.function?.arguments;let args={};if(raw&&typeof raw==='object')args=raw;else try{args=JSON.parse(raw||'{}')}catch{args={_raw:String(raw)}}const s={tool:tc.function?.name||'tool',args,sum:this.summary(tc.function?.name,args),out:'',done:true,at:m.timestamp,callId:tc.id||tc.call_id||''};ai.steps.push(s);byCall[tc.id||tc.call_id]=s}
    const t=this.contentText(m.content);if(t)ai.text+=(ai.text?'\n\n':'')+t;if(m.finish_reason==='stop'&&m.timestamp)ai.meta=new Date(m.timestamp*1000).toLocaleString([], {hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}
   if(m.role==='tool'){const s=byCall[m.tool_call_id];const out=this.toolOut(m.content);if(s){s.out=out;s.failed=/"error":\s*"(?!null)|BLOCKED:/.test(String(m.content||''))}else ai.steps.push({tool:m.tool_name||'tool',sum:m.tool_name||'tool',out,done:true,at:m.timestamp,callId:m.tool_call_id||''})}
  }return turns},
 contentText(c){if(c==null)return '';if(typeof c==='string')return c;if(Array.isArray(c))return c.map(p=>p.text||(p.type==='image_url'?'[image]':'')).join('');return String(c)},
 toolOut(c){const s=this.contentText(c);try{const j=JSON.parse(s);if(j&&typeof j==='object'){if('output' in j)return String(j.output??'')+(j.error?'\n'+j.error:'');return JSON.stringify(j,null,2)}}catch{}return s},
 summary(name,a={}){if(!a||typeof a!=='object')return name;return a.command||a.query||a.url||a.path||a.file_path||a.pattern||a.name||a.prompt?.slice?.(0,80)||name},

 /* ---------- painting ---------- */
 paint(follow=true){const s=this.live[this.id];const th=$('#thread')||(()=>{const sc=$('#scroll');if(!sc)return null;sc.innerHTML='<div class="thread" id="thread"></div>';return $('#thread')})();if(!th||!s)return;
  const sc=$('#scroll');const atBottom=!sc||sc.scrollHeight-sc.scrollTop-sc.clientHeight<120;
  const keep=$$('.step.open',th).map(x=>x.dataset.k);
  // an opened chat shows its history at once (no rise-in for old messages); new turns still animate
  const opening=this._opening===this.id;if(opening){this._opening=null;s._seen={n:1e9,k:new Set()}}   // what is there when a chat opens is history: shown at once
  const parts=[s.more?`<div class="hist-more"><button class="ghost" data-act="hist-more">${icon('chevU',15)}Show earlier messages</button></div>`:'',...s.turns.map((t,i)=>this.turnHtml(t,i,s)),s.interrupted&&!s.running?this.resumeLine(s.interrupted,true):''];
  // only the messages that changed are redrawn; earlier ones (and their videos and pictures) stay as they are
  const frag=list=>{const f=document.createDocumentFragment(),n=[];for(const h of list){const x=document.createElement('template');x.innerHTML=h;n.push(x.content.childNodes.length);f.append(x.content)}return {f,n}};
  const old=th._parts;let j=0;if(old&&th.childNodes.length===th._cnt.reduce((a,b)=>a+b,0)&&old.length<=parts.length){while(j<old.length&&old[j]===parts[j])j++}else{j=-1}
  if(j<0){const {f,n}=frag(parts);th.replaceChildren(f);th._cnt=n}
  // the changed tail (mostly the reply being written, once per streamed word) is updated in place: its pictures, code,
  // open steps and selected text stay, where removing and adding it again every frame made them blink
  else if(j<parts.length){const keepN=th._cnt.slice(0,j).reduce((a,b)=>a+b,0),start=th.childNodes[keepN]||null;const {f,n}=frag(parts.slice(j));if(start)morphKids(th,f,start);else th.append(f);th._cnt=[...th._cnt.slice(0,j),...n]}
  th._parts=parts;
  // the thread is redrawn on every streamed word: only messages and steps that are new since the last paint rise in
  const seen=s._seen||(s._seen={n:0,k:new Set()});[...th.children].forEach((el,i)=>{if(i<seen.n)el.classList.add('still')});seen.n=th.children.length;
  th.querySelectorAll('.step[data-k]').forEach(x=>{if(opening||seen.k.has(x.dataset.k))x.classList.add('still');seen.k.add(x.dataset.k)});
  keep.forEach(k=>th.querySelector(`.step[data-k="${k}"]`)?.classList.add('open'));
  // jump, never glide: the chat area scrolls smoothly for people, but placing the view must be instant
  if((follow&&atBottom||opening)&&sc&&!this._hit){sc.style.scrollBehavior='auto';sc.scrollTop=sc.scrollHeight;if(opening)requestAnimationFrame(()=>{sc.scrollTop=sc.scrollHeight;requestAnimationFrame(()=>{sc.scrollTop=sc.scrollHeight;sc.style.scrollBehavior=''})});else sc.style.scrollBehavior=''}
  if(this._hit)this.markHits()},
 // opened from a search: the words found are marked in the messages and the view jumps to the first one
 markHits(){const h=this._hit,th=$('#thread'),s=this.live[this.id];if(!h||!th||!s||h.id!==this.id)return;
  const words=[...new Set(String(h.q||'').toLowerCase().replace(/["*()^:]/g,' ').split(/\s+/).filter(w=>w.length>1&&!/^(and|or|not|near)$/.test(w)))];if(!words.length){this._hit=null;return}
  const re=new RegExp(words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).sort((a,b)=>b.length-a.length).join('|'),'gi');let first=null;
  for(const box of th.querySelectorAll('.text.md,.u-text')){const tw=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('mark,pre,code,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});const ns=[];while(tw.nextNode())ns.push(tw.currentNode);
   for(const n of ns){const t=n.nodeValue;re.lastIndex=0;if(!re.test(t))continue;re.lastIndex=0;const f=document.createDocumentFragment();let i=0,m;while((m=re.exec(t))){f.append(t.slice(i,m.index));const k=document.createElement('mark');k.className='hit';k.textContent=m[0];f.append(k);first??=k;i=m.index+m[0].length}f.append(t.slice(i));n.replaceWith(f)}}
  if(!first&&s.more&&!h.deeper){h.deeper=true;return this.loadHistory(this.id,true)}
  this._hit=null;const sc=$('#scroll');if(!first){if(sc)sc.scrollTop=sc.scrollHeight;return toast('The words you searched for are not in the messages shown here')}
  setTimeout(()=>{if(!first.isConnected)return;if(sc)sc.style.scrollBehavior='auto';first.scrollIntoView({block:'center'});first.classList.add('first');if(sc)requestAnimationFrame(()=>sc.style.scrollBehavior='')},60)},
 // a reply a restart interrupted is continued by aqeelOS with a system note as the next message (app/resume.mjs): the
 // chat shows it as one small line, not as something the person wrote
 RESUME_RE:/^\[System note from aqeelOS: you were interrupted by (an update|a restart) at [^\]]*\]\s*/,
 resumeLine(why,going){return `<div class="resume-line${going?' going':''}">${going?'<span class="spinner"></span>':icon('refresh',13)}Interrupted by ${why==='update'||why==='an update'?'an update':'a restart'}, ${going?'continuing…':'continued by itself'}</div>`},
 turnHtml(t,i,s){
  if(t.role==='user'){const rm=this.RESUME_RE.exec(t.text||'');if(rm){const rest=t.text.slice(rm[0].length).trim(),going=s.running&&i>=s.turns.length-2;
   return this.resumeLine(rm[1],going)+(rest?`<div class="msg user">${this.userHtml(rest,t)}</div>`:'')}}
  if(t.role==='sys'||t.role==='handoff')return `<details class="sys-msg ${t.role}"${t.at?` title="${esc(msgStamp(t.at))}"`:''}><summary>${icon(t.role==='handoff'?'layers':'sliders',14)}${t.role==='handoff'?'Context handoff: the chat so far, summarised':'System message'}${icon('chevR',13)}</summary><div class="sys-body">${esc(t.text)}</div></details>`;
  if(t.role==='user')return `<div class="msg user"${t.at?` title="${esc(msgStamp(t.at))}"`:''}>${this.userHtml(t.text,t)}${t.images&&!(t.imgs||[]).length?`<span class="attach">${icon('clip',12)} ${plural(t.images,'image')}</span>`:''}</div>${t.steer&&t.steer!=='delivered'?`<div class="steer-meta ${t.steer}">${t.steer==='failed'?icon('alert',12)+esc(t.err||'Not delivered'):t.steer==='sending'?'Sending…':`<span class="sm-hint" title="${esc(AGENT())} reads it as soon as the step it is on finishes, without stopping its work">In the reply in progress</span><button class="steer-now" data-act="steer-now" title="Stops the step it is on and sends this message right away">Send now</button>`}</div>`:''}`;
  const last=i===s.turns.length-1;if(!last&&!t.text&&!(t.steps||[]).length&&!t.think&&!t.approval&&!t.error&&!t.dropped)return '';
  const rm=t.text?reasonMarkup(t.text):null,thinkTxt=[t.think,rm?.think].filter(Boolean).join('\n\n');
  const think=thinkTxt?`<button class="think" data-act="think" data-i="${i}" aria-expanded="${!!t.thinkOpen}">${icon('brain',15)}${s.running&&last&&!t.text?'Thinking…':'Thought'}${t.thinkSecs?' for '+t.thinkSecs+' s':''}${icon('chevR',14)}</button><div class="think-body" ${t.thinkOpen?'':'hidden'}>${esc(thinkTxt)}</div>`:'';
  const sys=(t.sys||[]).map(x=>`<details class="sys-msg"><summary>${icon('sliders',14)}System message${icon('chevR',13)}</summary><div class="sys-body">${esc(x)}</div></details>`).join('');
  // steps stay lean: slim rows; a longer run folds into one line ("Ran 6 steps"), the latest two stay in view while working
  const stp=t.steps||[],live=s.running&&last,fold=live?stp.length>3:stp.length>2;
  const rows=(list,off)=>list.map((x,k)=>this.stepHtml(x,i+'-'+(k+off))).join('');
  const failed=stp.filter(x=>x.failed).length;
  const steps=!stp.length?'':!fold?`<div class="steps">${rows(stp,0)}</div>`:live
   ?`<div class="steps"><details class="steps-fold" data-f="${i}" ${this._folds?.has(i+'')?'open':''}><summary>${icon('chevR',13)}${plural(stp.length-2,'earlier step')}</summary>${rows(stp.slice(0,-2),0)}</details>${rows(stp.slice(-2),stp.length-2)}</div>`
   :`<div class="steps"><details class="steps-fold" data-f="${i}" ${this._folds?.has(i+'')?'open':''}><summary>${icon('chevR',13)}Ran ${plural(stp.length,'step')}${failed?` · <span class="bad-t">${failed} failed</span>`:''}</summary>${rows(stp,0)}</details></div>`;
  const appr=t.approval?this.approvalHtml(t.approval):'';
  const typing=s.running&&last&&!t.text&&!t.approval&&!(t.steps||[]).some(x=>!x.done);
  const body=t.text?this.replyHtml(t.text,rm):'';
  const text=t.text?`<div class="text md ${s.running&&last?'streaming':''}">${body}</div>`:typing?'<div class="text"><span class="typing"><i></i><i></i><i></i></span></div>':'';
  const err=t.error||t.dropped&&!(s.running&&last)&&!s.interrupted?this.errHtml(t,last):'';
  const tools=!s.running||!last?`<div class="msg-tools"><button title="Copy" aria-label="Copy" data-act="copymsg" data-i="${i}">${icon('copy',15)}</button>${last?`<button title="Retry" aria-label="Retry" data-act="retry">${icon('retry',15)}</button>`:''}${last?`<button title="Fork this chat" aria-label="Fork this chat" data-act="fork">${icon('fork',15)}</button>`:''}${t.meta?`<span class="meta">${esc(t.meta)}</span>`:''}</div>`:'';
  return `<div class="msg ai"><span class="who">${agentAvatar(S.profile||'default',28,{title:false})}</span><div class="body">${sys}${think}${steps}${appr}${text}${err}${last&&!s.running&&t.result?RunStatus.endHtml(t.result):''}${tools}</div></div>`},
 // a reply's text: tagged reasoning as labelled cards (its thinking goes in the Thought fold), the rest as markdown
 replyHtml(text,rm=reasonMarkup(text)){return rm?rm.segs.map(x=>x.type==='prose'?md(x.t):`<div class="rm-card ${x.type}"><span class="rm-l">${x.type==='action'?'Action':'Result'}</span>${md(x.t)}</div>`).join(''):md(text)},
 // what went wrong with a reply, in plain words, and what you can do about it right there
 errHtml(t,last){const ad=!S.me||S.me.admin,s=this.live[this.id],btn=(act,ic,l,x='')=>`<button class="ghost" ${act.startsWith('/')?`data-go="${act}"`:`data-act="${act}"`} ${x}>${icon(ic,14)}${l}</button>`;
  if(t.dropped)return `<div class="err-box"><p class="err-line">${icon('alert',14)} ${s?.conn==='reconnecting'?'The connection to this reply dropped. Reconnecting…':'The connection to this reply dropped. '+esc(AGENT())+' may still be working on your AI box.'}</p>${last?`<div class="err-acts">${btn('chat-reconnect','refresh','Reconnect')}${ad?btn('/system/health','server','Check server'):''}</div>`:''}</div>`;
  const cred=/api[ _-]?key|credential|unauthori[sz]ed|authenticat|not (signed|logged) in|no (api )?key|invalid (x-)?api|permission denied for model|401\b/i.test(t.error);
  const acts=last?[cred&&ad?btn('/system/keys','key','Add a key'):'',cred?btn('chat-model','cpu','Switch model'):'',t.reload?btn('chat-reload','refresh','Reload page'):'',ad&&!t.reload?btn('/system/logs','list','Open logs'):''].join(''):'';
  return `<div class="err-box"><p class="err-line">${icon('alert',14)} ${esc(t.error)}</p>${acts?`<div class="err-acts">${acts}</div>`:''}</div>`},
 stepHtml(x,k){const ic={terminal:'terminal',web_search:'globe',web_extract:'globe',browser_navigate:'globe',read_file:'file',write_file:'file',patch:'edit',search_files:'search'}[x.tool]||(/browser|web/.test(x.tool)?'globe':/file|patch/.test(x.tool)?'file':'terminal');
  const state=!x.done?'<span class="spinner"></span>Running':x.failed?`<span style="color:var(--bad)">${icon('x',14)}</span>Failed`:`<span class="ok-ic">${icon('check',14)}</span>${x.secs?x.secs+' s':'Done'}`;
  // tools reached through the lookup step ("tool call") show the real tool and what it was asked
  let tool=x.tool,sumText=x.sum&&x.sum!==x.tool?x.sum:'';const a=x.args||{};
  if(/^(tool_call|call_tool|use_tool)$/.test(tool)){const calls=Array.isArray(a.calls)?a.calls:[a],c=calls[0]||{};const inner=c.name||c.tool||c.tool_name||c.function;if(inner){tool=String(inner).replace(/^mcp__/,'').replace(/__/g,' · ')+(calls.length>1?' +'+(calls.length-1):'');const ia=c.arguments||c.args||c.input||{};const v=typeof ia==='string'?ia:(ia.prompt||ia.query||ia.url||ia.text||ia.path||ia.command||'');sumText=String(v).slice(0,140)}}
  else if(/^(tool_describe|tool_search)$/.test(tool)){tool='looked up tools';const q=a.names||a.queries||a.query;sumText=Array.isArray(q)?q.join(', '):String(q||'')}
  const said=tool===x.tool?RunStatus.plain(tool):String(tool).replace(/_/g,' ');const sum=x.tool==='terminal'?`<b>${esc(said)}</b> <code>${esc(plainPaths(x.sum))}</code>`:`<b>${esc(said)}</b> <span class="sub-t">${esc(plainPaths(sumText))}</span>`;
  // the arguments are shown whole; only a long output is cut
  const argText=!x.args||!Object.keys(x.args).length?'':typeof x.args._raw==='string'&&Object.keys(x.args).length===1?x.args._raw:JSON.stringify(x.args,null,2);
  const outText=String(x.out||'');const detail=[argText,outText.length>20000?outText.slice(0,20000)+'\n… (output cut at 20 000 characters)':outText].filter(Boolean).join('\n\n— output —\n');
  return `<div class="step" data-k="${k}"><button class="step-head" data-act="step"${x.at?` title="${esc(msgStamp(x.at))}"`:''}><span class="si">${icon(ic,14)}</span><span class="sum">${sum}</span><span class="state">${state}</span><span class="chev">${icon('chevR',14)}</span></button><div class="step-body"><div>${x.callId?`<small class="step-id">Call ${esc(x.callId)}</small>`:''}<pre>${esc(detail||'(no output)')}</pre></div></div></div>`},
 approvalHtml(a){if(a.resolved)return `<div class="steps"><div class="step"><div class="step-head"><span class="si">${icon(a.resolved==='deny'?'x':'check',14)}</span><span class="sum">${a.resolved==='deny'?'Denied':a.auto?'Approved automatically (Allow all)':'Approved'}${a.command?': <code>'+esc(a.command)+'</code>':''}</span></div></div></div>`;
  const label={once:'Approve once',session:'Allow for this chat',always:'Always allow',deny:'Deny'};
  return `<div class="approval"><h4>${icon('shield',16)}${esc(a.title||AGENT()+' needs your OK')}</h4><p>${esc(a.description||a.reason||'This command could change or delete things on the box.')}</p>${a.command?`<pre>${esc(a.command)}</pre>`:''}<div class="btns">${(a.choices||['once','deny']).map((c,i)=>`<button class="${i===0?'primary':c==='deny'?'ghost':''}" data-act="approval" data-choice="${esc(c)}"${a.request_id?` data-rid="${esc(a.request_id)}"`:''}>${esc(label[c]||c)}</button>`).join('')}</div></div>`},

 /* ---------- sending ---------- */
 async submit(){if(this._sending)return;this._sending=true;try{return await this._submit()}finally{this._sending=false}},
 async _submit(){if(Voice.on)Voice.stop();if(Voice._wait)await Promise.race([Voice._wait,sleep(30000)]);const ta=$('#msg');const text=ta.value.trim();if(!text&&!this.files.length)return;try{localStorage.removeItem(this.draftKey());localStorage.removeItem('draft:'+(S.profile||'default')+'|new')}catch{}
  const s=this.live[this.id];
  if(this.files.some(f=>f.kind!=='image'||!f.url)||s?.running&&this.sendMode!=='queue'&&this.files.length){const up=s?.running&&this.sendMode!=='queue'?this.files:this.files.filter(f=>f.kind!=='image'||!f.url);
   const sp=$('#attachList');sp?.classList.add('busy');let paths;try{paths=await this.uploadAtt(up)}catch(e){sp?.classList.remove('busy');return fail(e)}sp?.classList.remove('busy');
   this._sentAtt=up;this.files=this.files.filter(f=>!up.includes(f));this.paintFiles();ta.value=(text+'\n\n'+paths.map(p=>'[Attached file: '+p+']').join('\n')).trim();return this._submit()}
  if(s?.running&&this.sendMode==='queue'){const images=this.files;this.files=[];this.paintFiles();(s.queue??=[]).push({text,images});ta.value='';ta.style.height='';this.paintQueue();return}
  if(s?.running){if(!s.runId)return toast(AGENT()+' is starting, try again in a second');ta.value='';ta.style.height='';return this.steer(this.id,text,this.takeSent())}
  if(s)s.paused=false;
  if(text.startsWith('/')&&this.command(text))return;
  ta.value='';ta.style.height='';$('#slash').innerHTML='';
  const images=this.files;this.files=[];this.paintFiles();
  this.send(text,images)},
 async steer(id,text,local={}){const s=this.live[id];if(!s?.runId)return;
  const u={role:'user',text,steer:'sending',local};const n={role:'ai',steps:[],text:'',think:''};s.turns.push(u,n);s.ai=n;s.runTurns.push(n);if(this.id===id)this.paint();
  try{await post(G,'/v1/runs/'+s.runId+'/steer',{text});if(u.steer==='sending')u.steer='sent'}catch(e){u.steer='failed';u.err=e.message;s.turns.splice(s.turns.indexOf(n),1);s.runTurns.pop();s.ai=s.runTurns[s.runTurns.length-1]}if(this.id===id)this.paint()},
 // a message from the app itself (a secret's note): steers a running reply, waits in the queue while one starts, else
 // is sent; the composer's draft and attachments stay as they are
 tell(text,id=this.id){const s=id&&this.live[id];if(s?.running){if(s.runId)return this.steer(id,text);(s.queue??=[]).unshift({text,images:[]});if(this.id===id)this.paintQueue();return}return this.send(text,[],id)},
 // Tools picked for the next message (MCP servers or built-in tools). Hermes has no per-message tool switch,
 // so they travel as a short instruction in front of the message; the bubble shows them as chips.
 tools:[],
 canTools(){return !S.me||S.me.admin||Object.values(S.me.agents||{}).some(l=>l!=='chat')},
 toolChipsHtml(){return this.tools.map((t,i)=>`<span class="tchip">${icon(t.kind==='mcp'?'plug':'zap',13)}${esc(t.label)}<button class="ghost icon" data-act="tool-off" data-i="${i}" aria-label="Remove ${esc(t.label)}">${icon('x',12)}</button></span>`).join('')},
 paintTools(){const el=$('#toolChips');if(el)el.innerHTML=this.toolChipsHtml();$$('[data-menu="chat-tools"]').forEach(b=>b.classList.toggle('on',this.tools.length>0))},
 TOOL_RE:/^\[Use these tools for this: ([^\]]+)\]\n\n/,
 ATT_RE:/\n*\[Attached file: ([^\]\n]+)\]/g,
 userText(t){return String(t||'').replace(this.TOOL_RE,'').replace(this.ATT_RE,'').trim()},
 takeSent(){const l=this._sentAtt||[];this._sentAtt=null;const m={};for(const f of l)if(f.blob)m[f.name]=f.blob;return m},
 // the attachments of a sent message, as previews: pictures and videos play right in the chat
 attHtml(paths,imgs,local){const one=p=>{const name=p.split('/').pop().replace(/^\d{4}-\d\d-\d\d-(?:[a-z0-9]{8,12}-)?/,''),k=attKind(name),src=(local||{})[name]||fileUrl(p,k==='video'?'stream':'download');
   if(k==='image')return `<img class="att-img" src="${esc(src)}" alt="${esc(name)}" loading="lazy" data-act="att-zoom">`;
   if(k==='video')return `<video class="att-vid" src="${esc(src)}" controls preload="metadata" playsinline></video>`;
   return `<a class="att-file" href="${esc(fileUrl(p))}" download="${esc(name)}">${icon('file',18)}<span><b>${esc(name)}</b><small>${esc(p.replace(/^\/home\/[^/]+/,'~'))}</small></span></a>`};
  const all=[...(imgs||[]).filter(Boolean).map(u=>`<img class="att-img" src="${esc(u)}" alt="" loading="lazy" data-act="att-zoom">`),...paths.map(one)];
  return all.length?`<div class="att-row">${all.join('')}</div>`:''},
 userHtml(text,t={}){const m=this.TOOL_RE.exec(text||'');let body=m?text.slice(m[0].length):text||'';const paths=[];body=body.replace(this.ATT_RE,(x,p)=>{paths.push(p.trim());return ''}).trim();
  return (m?`<span class="tchips">${m[1].split(', ').map(x=>`<span class="tchip">${icon(/\(MCP\)$/.test(x)?'plug':'zap',12)}${esc(x.replace(/ \(MCP\)$/,''))}</span>`).join('')}</span>`:'')+this.attHtml(paths,t.imgs,t.local)+(body?`<div class="u-text">${esc(body).replace(/\n/g,'<br>')}</div>`:'')},
 async toolsMenu(el){const k=S.profile||'default';const c=this._toolCache?.[k];let d=c&&Date.now()-c.t<60000?c.d:null;
  if(!d){try{const [m,t]=await Promise.all([H('/mcp/servers').catch(()=>({servers:[]})),H('/tools/toolsets').catch(()=>[])]);d={mcp:(m.servers||m||[]).filter(s=>s.enabled!==false),built:(Array.isArray(t)?t:t.toolsets||[]).filter(x=>x.enabled)};(this._toolCache||={})[k]={t:Date.now(),d}}catch(e){return fail(e)}}
  explainFor('mcp',d.mcp.map(s=>({id:s.name,name:s.name,desc:s.url||s.command||''})));explainFor('tool',d.built.map(t=>({id:t.name,name:t.label||t.name,desc:t.description||''})));
  const has=(kind,name)=>this.tools.some(t=>t.kind===kind&&t.name===name);
  const flip=(kind,name,label)=>{const i=this.tools.findIndex(t=>t.kind===kind&&t.name===name);if(i>=0)this.tools.splice(i,1);else this.tools.push({kind,name,label});this.paintTools();$('#msg')?.focus()};
  menu(el,[{header:'MCP tools'},...(d.mcp.length?d.mcp.map(s=>({label:ex('mcp',s.name)?.title||pretty(s.name),sub:ex('mcp',s.name)?.summary,icon:'plug',on:has('mcp',s.name),run:()=>flip('mcp',s.name,pretty(s.name))})):[{label:'No MCP tools yet',icon:'plug',run:()=>go('/abilities/connections')}]),
   '-',{header:'Built-in tools'},...d.built.map(t=>({label:t.label||pretty(t.name),sub:ex('tool',t.name)?.summary||String(t.description||'').slice(0,90),icon:'zap',on:has('tool',t.name),run:()=>flip('tool',t.name,t.label||pretty(t.name))})),
   '-',{label:'Manage tools…',icon:'sliders',run:()=>go('/abilities/connections')}])},
 async send(text,images=[],target){
  if(this.tools.length&&!target){text='[Use these tools for this: '+this.tools.map(t=>t.label+(t.kind==='mcp'?' (MCP)':'')+' = '+t.name).join(', ').replace(/ = [^,]+/g,'')+']\n\n'+text;this.tools=[];this.paintTools()}
  let id=target||this.id;const prof=S.profile||'default';
  if(!id){try{const body=this.cwd?{cwd:this.cwd}:{};const d=await post(G,'/api/sessions',body);id=d.session?.id||d.id;}catch(e){return fail(e)}
   // the agent was switched while the chat was being made: don't send through the new one
   if((S.profile||'default')!==prof)return toast('You switched agents before the chat started, so the message was not sent','err');
   S.sessions.unshift({id,title:'',preview:text.replace(this.TOOL_RE,'').slice(0,80),source:'api_server',last_active:Date.now()/1000,is_active:true});this.id=id;history.replaceState(null,'','#/chat/'+id);this.live[id]={turns:[],running:false};if($('#scroll'))$('#scroll').innerHTML='<div class="thread" id="thread"></div>'}
  const s=this.live[id]||(this.live[id]={turns:[],running:false});
  s.turns.push({role:'user',text,images:images.length||0,imgs:images.map(f=>f.url),local:this.takeSent()});const ai={role:'ai',steps:[],text:'',think:''};s.turns.push(ai);s.ai=ai;s.runTurns=[ai];
  s.running=true;s.started=Date.now();s.lastAct=Date.now();RunStatus.askNotify();if(this.id===id){this.paint();this.paintComposerBar()}paintSide();
  const m=this.cur();const body={message:images.length?[{type:'text',text},...images.map(f=>({type:'image_url',image_url:{url:f.url}}))]:text};
  // always the model shown in the chat bar, with its own account: left out, the engine reuses the chat's last model
  // name with the agent's default account (Gemini sent to the Claude account, 18 Oct)
  // the lock makes the engine use exactly this model on this account (and remember both for the chat); without it
  // a chat's earlier model name beats the request and runs on the agent's default account
  if(m.id&&m.provider){body.model=m.id;body.provider=m.provider;body.require_model_lock=true}
  body.model_options={reasoning_effort:this.effort};
  const ctl=new AbortController();s.abort=ctl;s.conn='connecting';let gotResp=false;s.runModel='';if(this.id===id)this.paintComposerBar();
  try{const r=await G('/api/sessions/'+encodeURIComponent(id)+'/chat/stream',{method:'POST',body,raw:true,signal:ctl.signal});
   if(!r.ok){let d={};try{d=await r.json()}catch{}const said=d.error?.message||d.error||d.detail||'';
    // a refused stream says why in plain words; signed out, not shared or a missing chat need a fresh page
    const why={401:'You were signed out, or this agent is no longer shared with you.',403:'You are not allowed to chat with this agent here.',404:'This chat was not found. It may have been deleted.',429:'Too many messages at once. Wait a moment and try again.'}[r.status]||(r.status>=500?'The engine had a problem starting this reply (error '+r.status+').':'');
    throw Object.assign(new Error(why?why+(said&&typeof said==='string'&&said.length<160?' ('+said+')':''):said||('The server answered '+r.status)),{reload:[401,403,404].includes(r.status)})}
   s.conn='live';gotResp=true;if(this.id===id)this.paintComposerBar();
   await this.readStream(r,ev=>this.onEvent(id,ev));
  }catch(e){if(e.name!=='AbortError'){const t=s.ai||ai;
   // the stream broke on the way (network, sleep, proxy): the reply may well still be running on the box
   if(/network|failed to fetch|load failed|terminated|input stream|body stream|connection (was )?(lost|reset|closed)/i.test(e.message||'')){if(gotResp){t.dropped=true;s.conn='reconnecting'}else t.error="Couldn't reach your AI box. Check your connection, then try again."}else{t.error=e.message||String(e);t.reload=!!e.reload}if(t.error)Oops.add('chat',AGENT()+': '+t.error)}}
  finally{if(s.conn!=='reconnecting')s.conn=null;s.running=false;s.abort=null;s.runId=null;s.runModel='';s.stopWanted=false;s.seenAt=Date.now()/1000;for(const t of s.runTurns||[ai])t.steps.forEach(x=>{if(!x.done){x.done=true;x.failed=x.failed||!!t.error}});
   for(const t of s.turns)if(t.steer==='sending')t.steer='sent';
   if(s.autoGo){s.autoGo=false;s.paused=false;(s.queue??=[]).unshift({text:'Go ahead in my browser.',images:[]})}   // the person chose their browser: its tools load with this next turn
   RunStatus.finish(s,s.ai||ai,{title:chatTitle(id)});
   const last=s.ai||ai;if(!last.meta)last.meta=[modelLabel(last.model||ai.model||m.id),this.effort,Math.round((Date.now()-s.started)/1000)+' s'].filter(Boolean).join(' · ');
   if(this.id===id){this.paint();this.paintComposerBar()}this.loadSessions();this.runQueue(id)}
 },
 /* A reply still running (sent before a refresh, or from another tab): pick it up from the start and follow it. */
 async follow(id){const s=this.live[id];if(!s||s.running||s.following)return;s.following=true;
  const ctl=new AbortController();   // switching agents stops reading it (the reply goes on on the box)
  try{const r=await fetch('/ui/live?agent='+encodeURIComponent(S.profile||'default')+'&session='+encodeURIComponent(id),{headers:{'x-hui':'1'},credentials:'same-origin',signal:ctl.signal});
   if(r.status!==200||!r.body)return;const ai={role:'ai',steps:[],text:'',think:''};let shown=false;
   const was=await this.peek(id).catch(()=>null);this.undrop(s);s.interrupted=null;s.ai=ai;s.runTurns=[ai];s.running=true;s.started=was?.since||Date.now();s.lastAct=Date.now();s.conn='live';s.abort=ctl;
   const show=um=>{if(shown)return;shown=true;const txt=typeof um==='string'?um:Array.isArray(um)?um.filter(x=>x.type==='text').map(x=>x.text).join(' '):'';
    const last=s.turns[s.turns.length-1];if(txt&&!(last?.role==='user'&&last.text===txt))s.turns.push({role:'user',text:txt});s.turns.push(ai);if(this.id===id){this.paint();this.paintComposerBar()}paintSide()};
   await this.readStream(r,ev=>{if(!shown)show(ev.type==='run.started'?ev.user_message?.content:'');this.onEvent(id,ev)});
   s.running=false;s.runId=null;s.conn=null;s.runModel='';s.seenAt=Date.now()/1000;ai.steps.forEach(x=>x.done=true);if(shown)RunStatus.finish(s,ai,{title:chatTitle(id)});if(shown&&!ai.meta)ai.meta=[modelLabel(ai.model||''),Math.round((Date.now()-s.started)/1000)+' s'].filter(Boolean).join(' · ');
   if(this.id===id){this.paint();this.paintComposerBar()}this.loadSessions()}
  catch{if(s.running){s.running=false;s.runId=null;const t=s.ai;if(t&&!t.error&&!ctl.signal.aborted){t.dropped=true;s.conn='reconnecting'}if(this.id===id){this.paint();this.paintComposerBar()}}}finally{s.following=false;if(s.abort===ctl)s.abort=null;if(!s.running&&s.conn!=='reconnecting')this.runQueue(id)}},
 // a reply whose connection dropped gives way to the same reply picked up again
 undrop(s){const t=s.turns[s.turns.length-1];if(t?.dropped){t.dropped=false;if(t.role==='ai')s.turns.pop()}},
 // other tabs: notice when a reply starts on the open chat; after a dropped connection, pick the reply up again
 // (or load how it ended). A server that does not answer is asked less and less often.
 watchLive(){clearInterval(this._lv);this._lv=setInterval(async()=>{const id=this.id,s=this.live[id];if(!id||document.hidden||!s||s.running||s.following)return;if(this._lvSkip>0){this._lvSkip--;return}
  try{const j=await this.peek(id);this._lvFail=0;if(this.id!==id)return;if(j.live)this.follow(id);
   // a restart interrupted this chat's reply: say so, and wait; aqeelOS continues it and the reply is followed like any other
   else if(j.interrupted){if(s.interrupted!==j.interrupted){s.interrupted=j.interrupted;s.conn=null;this.paint();this.paintComposerBar()}}
   else if(s.interrupted){s.interrupted=null;s.conn=null;this.loadHistory(id)}   // it was finished or left alone meanwhile: show how it ended
   else if(s.turns[s.turns.length-1]?.dropped){s.conn=null;this.loadHistory(id)}}
  catch{this._lvFail=(this._lvFail||0)+1;this._lvSkip=Math.min(2**this._lvFail,20);if(s.conn==='reconnecting'&&this._lvFail>=4&&this.id===id){s.conn='lost';this.paint();this.paintComposerBar()}}},3000)},
 async peek(id){const r=await fetch('/ui/live?peek=1&agent='+encodeURIComponent(S.profile||'default')+'&session='+encodeURIComponent(id),{headers:{'x-hui':'1'},credentials:'same-origin'});if(!r.ok)throw new Error('The server answered '+r.status);return r.json()},
 reconnect(){const p=(async()=>{const id=this.id,s=this.live[id];if(!s)return;s.conn='reconnecting';this._lvFail=0;this._lvSkip=0;this.paint();this.paintComposerBar();
  let j;try{j=await this.peek(id)}catch(e){s.conn='lost';this.paint();this.paintComposerBar();return toast("Couldn't reach your AI box: "+e.message,'err')}
  if(this.id!==id)return;if(j.live)return this.follow(id);s.conn=null;this.undrop(s);await this.loadHistory(id)})();pressBusy(p);return p},
 async readStream(r,on){const rd=r.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
   while((i=buf.search(/\r?\n\r?\n/))>=0){const raw=buf.slice(0,i);buf=buf.slice(i).replace(/^\r?\n\r?\n/,'');let ev='message',data='';for(const line of raw.split(/\r?\n/)){if(line.startsWith(':'))continue;if(line.startsWith('event:'))ev=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trimStart()}if(!data)continue;let d;try{d=JSON.parse(data)}catch{d={text:data}}on({type:d.type||ev,...d})}}},
 onEvent(id,e){const s=this.live[id];if(!s)return;const ai=s.ai;if(!ai)return;s.lastAct=Date.now();
  if(e.tool_name==='todo_list')RunStatus.readTodos(ai,{args:e.args,result:e.result||e.output});
  // The engine slips a steer in right before the agent's next model call (once the step it is on finishes) and
  // says nothing on this stream when it does. So a steer that was waiting when a step finished has been read as
  // soon as the agent shows anything new after that step.
  if(s.turns.some(t=>t.steer==='sent')){
   if(e.type==='tool.completed'||e.type==='tool.failed'){for(const t of s.turns)if(t.steer==='sent')t.afterStep=true}
   else if(/^(assistant\.(delta|commentary|reasoning)|reasoning\.delta|tool\.started)$/.test(e.type)||e.type==='tool.progress'&&e.tool_name==='_thinking'){for(const t of s.turns)if(t.steer==='sent'&&t.afterStep)t.steer='delivered'}}
  switch(e.type){
   case 'run.started':Secrets.start();s.runId=e.run_id;if(s.stopWanted){s.stopWanted=false;post(G,'/v1/runs/'+s.runId+'/stop').catch(()=>{});setTimeout(()=>s.abort?.abort(),1500)}ai.model=e.runtime?.model||'';if(ai.model&&s.runModel!==ai.model){s.runModel=ai.model;if(this.id===id)this.paintComposerBar()}break;
   case 'assistant.delta':ai.text+=e.delta||e.text||'';break;
   case 'assistant.commentary':if(!e.already_streamed&&e.text)ai.text+=(ai.text?'\n\n':'')+e.text;break;
   case 'tool.started':ai.steps.push({tool:e.tool_name||'tool',args:e.args||{},sum:e.preview||this.summary(e.tool_name,e.args),out:'',done:false,t0:Date.now(),at:Date.now()/1000,callId:e.tool_call_id||e.call_id||''});break;
   case 'tool.completed':case 'tool.failed':{const x=[...ai.steps].reverse().find(t=>!t.done&&t.tool===e.tool_name)||[...ai.steps].reverse().find(t=>!t.done);if(x){x.done=true;x.failed=e.type==='tool.failed';x.secs=((Date.now()-x.t0)/1000).toFixed(1);if(e.result||e.output)x.out=this.toolOut(e.result||e.output)}break}
   case 'tool.progress':if(e.tool_name==='_thinking'){if(!ai.t0think)ai.t0think=Date.now();ai.think+=e.delta||'';ai.thinkSecs=Math.max(1,Math.round((Date.now()-ai.t0think)/1000))}break;
   case 'reasoning.delta':case 'assistant.reasoning':ai.think+=e.delta||e.text||'';break;
   case 'approval.request':ai.approval={...e,choices:e.choices,command:e.command,description:e.description||e.reason,request_id:e.request_id};
    // this chat is set to Allow all: answer it right away (the engine's block list still applies)
    if(this.allowAll(id)&&s.runId){const pick=(e.choices||['once']).includes('session')?'session':'once';post(G,'/v1/runs/'+s.runId+'/approval',{choice:pick,...(e.request_id?{request_id:e.request_id}:{})}).then(()=>{ai.approval.resolved=pick;ai.approval.auto=true;if(this.id===id)this.paint()}).catch(()=>{})}break;
   case 'approval.responded':if(ai.approval)ai.approval.resolved=e.choice;break;
   case 'assistant.completed':{let c=this.contentText(e.content||'');const prev=(s.runTurns||[]).filter(t=>t!==ai).map(t=>t.text).join('');if(prev&&c.startsWith(prev))c=c.slice(prev.length).trim();if(c&&(!ai.text||c.length>=ai.text.length))ai.text=c}ai.model=e.runtime?.model||ai.model;break;
   case 'run.completed':this.refreshUsage();if(!e.pending_steer)for(const t of s.turns){if(t.steer==='sent')t.steer='delivered'}   // nothing left unread: the agent took every steer in
   if(e.pending_steer){/* the reply ended before the agent read it: send it as the next message instead */const u=[...s.turns].reverse().find(t=>t.steer&&t.steer!=='delivered');if(u){const i=s.turns.indexOf(u);const nx=s.turns[i+1];s.turns.splice(i,nx&&nx.role==='ai'&&!nx.text&&!(nx.steps||[]).length?2:1);if(s.ai===nx)s.ai=s.turns[s.turns.length-1];(s.queue??=[]).unshift({text:u.text,images:[]})}}if(e.messages){/* fill tool outputs from the final transcript */const t=this.toTurns(e.messages.map(m=>({...m,active:1})));const last=t[t.length-1];if(last?.role==='ai'){last.steps.forEach((x,k)=>{if(ai.steps[k]&&!ai.steps[k].out)ai.steps[k].out=x.out});if(!ai.text)ai.text=last.text}}const u=e.usage;if(u)ai.usage=u;break;
   case 'run.failed':ai.error=e.error?.message||e.error||AGENT()+' stopped with an error.';Oops.add('chat',AGENT()+': '+ai.error);break;
   case 'aqeelos.steer':{if(e.text&&!s.turns.some(t=>t.steer&&t.text===e.text)){const n={role:'ai',steps:[],text:'',think:''};s.turns.push({role:'user',text:e.text,steer:'sent'},n);s.ai=n;(s.runTurns??=[]).push(n)}break}
   case 'run.steered':{const u=[...s.turns].reverse().find(t=>t.steer==='sending'||t.steer==='sent');if(u)u.steer='delivered';break}
   case 'run.cancelled':case 'run.interrupted':ai.text+=(ai.text?'\n\n':'')+'*Stopped.*';break;
  }
  if(this.id===id){cancelAnimationFrame(this.raf);this.raf=requestAnimationFrame(()=>this.paint())}
 },
 // the waiting steers leave the running reply and are sent first, as soon as the stopped step ends
 async steerNow(){const s=this.live[this.id];if(!s?.running)return;const wait=s.turns.filter(t=>t.steer==='sent'||t.steer==='sending');if(!wait.length)return;
  for(const t of wait){const i=s.turns.indexOf(t);const nx=s.turns[i+1];s.turns.splice(i,nx&&nx.role==='ai'&&!nx.text&&!(nx.steps||[]).length?2:1);if(s.ai===nx){s.runTurns=s.runTurns.filter(x=>x!==nx);s.ai=s.runTurns[s.runTurns.length-1]||s.turns[s.turns.length-1]}}
  (s.queue??=[]).unshift(...wait.map(t=>({text:t.text,images:[]})));s.paused=false;this.paint();this.paintQueue();
  try{if(s.runId)await post(G,'/v1/runs/'+s.runId+'/stop')}catch{}setTimeout(()=>s.abort?.abort(),1500);toast('Stopping the current step; your message goes next')},
 // pressed before the run has an id: remembered and sent when run.started arrives (cutting the stream alone leaves the
 // reply running on the box); a run that never starts is let go after 10 s
 async stop(){const s=this.live[this.id];if(!s?.running)return;s.paused=true;toast('Stopping…');
  if(!s.runId){s.stopWanted=true;const a=s.abort;setTimeout(()=>{if(s.stopWanted&&s.abort===a)a?.abort()},10000);return}
  try{await post(G,'/v1/runs/'+s.runId+'/stop')}catch{}setTimeout(()=>s.abort?.abort(),1500)},
 // the button's own turn (found by request_id): an earlier turn's Approve used to look only at the last turn
 async approve(choice,rid){const s=this.live[this.id];const t=rid?s?.turns.find(x=>x.approval?.request_id===rid):[...(s?.turns||[])].reverse().find(x=>x.approval&&!x.approval.resolved);if(!s?.runId||!t?.approval)return;try{await post(G,'/v1/runs/'+s.runId+'/approval',{choice,...(t.approval.request_id?{request_id:t.approval.request_id}:{})});t.approval.resolved=choice;this.paint()}catch(e){fail(e)}},
 resetLive(from){const keep={};for(const [id,s] of Object.entries(this.live||{})){s?.abort?.abort();if(s?.queue?.length)keep[id]={queue:s.queue,paused:s.paused}}(this.parked??={})[from||'default']=keep;this.live={}},
 async newChat(){this.id=null;go('/chat')},
 async retry(){const s=this.live[this.id];if(!s||s.running)return;const lastUser=[...s.turns].reverse().find(t=>t.role==='user');if(lastUser)this.send(lastUser.text,(lastUser.imgs||[]).filter(Boolean).map(url=>({url})))},
 async fork(id=this.id){if(!id)return;try{const d=await post(G,'/api/sessions/'+encodeURIComponent(id)+'/fork',{});const nid=d.session?.id||d.id;await this.loadSessions();if(nid)go('/chat/'+nid);toast('Forked into a new chat')}catch(e){fail(e)}},

 /* ---------- slash commands (handled in the app; everything else goes to aqeelOS) ---------- */
 SLASH:[['/new','Start a fresh chat'],['/model','Switch the model for this chat'],['/reasoning','Set effort: off, minimal, low, medium, high, xhigh, max, ultra'],['/title','Rename this chat'],['/fork','Branch this chat into a new one'],['/compress','Ask aqeelOS to summarise and shrink this chat'],['/reload','Re-read aqeelOS config.yaml'],['/clear','Same as /new']],
 slash(v){const box=$('#slash');if(!box)return;if(!/^\/\S*$/.test(v)){box.innerHTML='';return}const l=this.SLASH.filter(s=>s[0].startsWith(v));box.innerHTML=l.length?`<div class="card slash">${l.map(s=>`<button class="item" data-cmd="${s[0]}"><b style="font-weight:600">${s[0]}</b><small>${s[1]}</small></button>`).join('')}</div>`:''},
 pickSlash(cmd){const ta=$('#msg');ta.value=cmd+' ';$('#slash').innerHTML='';ta.focus()},
 command(text){const [cmd,...rest]=text.split(/\s+/);const arg=rest.join(' ').trim();const ta=$('#msg');const clear=()=>{ta.value='';$('#slash').innerHTML=''};
  if(cmd==='/new'||cmd==='/clear'){clear();this.newChat();return true}
  if(cmd==='/model'){clear();const b=$('[data-menu=model]');if(b)openMenu(b);return true}
  if(cmd==='/reasoning'){const a=arg.toLowerCase()==='off'?'none':arg.toLowerCase();if(EFFORTS.includes(a)){this.setEffort(a);clear();toast('Effort: '+EFFORT_LABEL[a])}else{clear();const b=$('[data-menu=effort]');if(b)openMenu(b)}return true}
  if(cmd==='/title'){clear();if(this.id)renameSession(this.id,arg||undefined);return true}
  if(cmd==='/fork'){clear();if(this.id)this.fork();return true}
  if(cmd==='/reload'){clear();toast('Settings are read fresh on every message, so changes already apply.');return true}
  return false},
};

async function renameSession(id,title){const c=S.sessions.find(x=>x.id===id);if(title===undefined){title=await promptBox('Rename chat','Title',c?.title||'');if(title===null)return}
 try{await H('/sessions/'+encodeURIComponent(id),{method:'PATCH',body:{title}});if(c)c.title=title;paintSide();paintTop();toast('Renamed')}catch(e){fail(e)}}
async function deleteSession(id){const c=S.sessions.find(x=>x.id===id);if(!await confirmBox('Delete this chat?',`“${esc(c?.title||c?.preview||id)}” and all its messages will be removed. This can't be undone.`))return;
 try{const sid=encodeURIComponent(id);await del(G,'/api/sessions/'+sid).catch(e=>{if(e?.status===404||/not.?found|404/i.test(String(e?.message||e)))return del(H,'/sessions/'+sid);throw e});S.sessions=S.sessions.filter(x=>x.id!==id);delete Chat.live[id];toast('Chat deleted');if(route().chat===id)go('/chat');else paintSide()}catch(e){fail(e)}}

Chat.watchLive();RunStatus.start();
// remember which folded step runs are open, so a repaint keeps them open
document.addEventListener('toggle',e=>{const d=e.target;if(!d?.matches?.('details.steps-fold'))return;(Chat._folds??=new Set())[d.open?'add':'delete'](d.dataset.f)},true);

/* ---------- Secrets: when an agent asks for a password or key (its ask_secret tool), a protected field shows above
   the composer. The value goes straight to the box (typed into the agent's screen, or saved as a key); it is never
   part of the chat, and the agent never sees it. ---------- */
const Secrets={timer:null,
 start(){if(!this.timer)this.timer=setInterval(()=>this.check(),2500);this.check()},
 async check(){const slot=$('#secretSlot');if(!slot||document.hidden)return;let items=[];try{items=(await UI('/ui/secrets/pending?agent='+encodeURIComponent(agentProfile()||'default'))).items||[]}catch{return}
  const ids=new Set(items.map(x=>x.id));slot.querySelectorAll('.secret-card:not(.done):not(.give)').forEach(c=>{if(!ids.has(c.dataset.id)){Secrets.drop(c)}});
  for(const x of items)if(!slot.querySelector('[data-id="'+x.id+'"]')){slot.insertAdjacentHTML('beforeend',this.card(x));const c=slot.lastElementChild;const i=c.querySelector('input');
   if(i){i.focus();i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.send(c)}}}this.tick(c,x.expires)}
  if(!items.length&&!Object.values(Chat.live||{}).some(s=>s?.running)){clearInterval(this.timer);this.timer=null}},
 // the chat the agent is working in (a choice applies to that chat)
 runningChat(){if(Chat.live[Chat.id]?.running)return Chat.id;const live=Object.entries(Chat.live||{}).find(([,s])=>s?.running);return live?.[0]||Chat.id||''},
 browserCard(x){const who=esc(AGENT()),mine=x.suggest==='yours';
  return `<div class="secret-card choice" data-id="${esc(x.id)}" data-kind="browser"><span class="ic">${icon('globe',17)}</span><div class="sc-main"><b>Where should ${who} do this?</b>
   <span class="hint">${esc(x.task)}${x.why?' · '+esc(x.why):''}</span>
   <div class="choice-row">
    <button class="pick ${mine?'rec':''}" data-act="browser-pick" data-where="yours"><b>${icon('monitor',15)}My browser</b><span>A separate window on this computer, with your sign-ins. Stops if your computer sleeps.${x.connected?'':' Needs the aqeelOS extension (one-time setup).'}</span>${mine?'<em>Suggested</em>':''}</button>
    <button class="pick ${mine?'':'rec'}" data-act="browser-pick" data-where="server"><b>${icon('server',15)}The AI box screen</b><span>Keeps working when your computer is off. Watch it with the screen button.</span>${mine?'':'<em>Suggested</em>'}</button>
   </div><span class="sc-err"></span>
   <div class="sc-actions"><span class="sc-left"></span></div></div></div>`},
 async pickBrowser(c,where){const err=c.querySelector('.sc-err');err.textContent='';c.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const sid=this.runningChat();await post(UI,'/ui/browser-choice/'+encodeURIComponent(c.dataset.id),{where,session:sid,title:chatTitle(sid)});if(where==='yours'&&Chat.live[sid])Chat.live[sid].autoGo=true;c.classList.add('done');
   c.querySelector('.sc-main').innerHTML='<b>'+icon('check',15)+' '+(where==='yours'?'Using your browser':'Using the AI box screen')+'</b><span class="hint">'+(where==='yours'?esc(AGENT())+' works in a new Chrome window on this computer. You can watch, and take over by clicking.':esc(AGENT())+' carries on on its own screen.')+'</span>';setTimeout(()=>this.drop(c),3500)}
  catch(e){c.querySelectorAll('button').forEach(b=>b.disabled=false);if(/not connected|extension/i.test(e.message)){err.textContent='Your browser isn’t connected yet.';BrowserSetup.open()}else err.textContent=e.message}},
 card(x){if(x.kind==='browser')return this.browserCard(x);const who=esc(AGENT());const where=x.mode==='type'?'It is typed into the field on '+who+'’s screen'+(x.enter?' and sent':'')+'.':'It is saved as <code>'+esc(x.name)+'</code> for '+who+'.';
  return `<div class="secret-card" data-id="${esc(x.id)}"><span class="ic">${icon('lock',17)}</span><div class="sc-main"><b>${who} needs: ${esc(x.label)}</b>
   <span class="hint">${where} ${who} never sees it, and it is not saved in this chat.</span>
   <div class="sc-lblrow"><span class="sc-lbl">Value</span><button type="button" class="sc-show" data-act="secret-eye" aria-pressed="false">${icon('eye',14)}<span>Show</span></button></div><input type="password" data-val autocomplete="off" spellcheck="false" aria-label="${esc(x.label)}" placeholder="Type or paste it here">
   <span class="sc-err"></span>
   <div class="sc-actions"><span class="sc-left"></span><span class="grow"></span><button class="ghost" data-act="secret-cancel">Not now</button><button class="primary" data-act="secret-send">${icon('lock',14)}Send securely</button></div></div></div>`},
 // the person sends one on their own: what it is (the agent sees this) and the value (it never does)
 nameOf(label){return String(label||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').split('_').filter(w=>!/^(MY|THE|A|AN|FOR|OF|TO|AND)$/.test(w)).slice(0,4).join('_').slice(0,40)},
 give(){const slot=$('#secretSlot');if(!slot)return;if(slot.querySelector('.give'))return slot.querySelector('.give [data-ctx]').focus();const who=esc(AGENT());
  slot.insertAdjacentHTML('beforeend',`<div class="secret-card give" data-id="give"><span class="ic">${icon('lock',17)}</span><div class="sc-main"><b>Send a secret to ${who}</b>
   <span class="hint">${who} never sees the value. It stays on your AI box as a key ${who} can type into a login or use in a command.</span>
   <label class="sc-lbl">What is it?</label><input data-ctx autocomplete="off" placeholder="e.g. Gmail password for ops@example.com"><span class="sc-name"></span>
   <div class="sc-lblrow"><label class="sc-lbl">Value</label><button type="button" class="sc-show" data-act="secret-eye" aria-pressed="false">${icon('eye',14)}<span>Show</span></button></div><input type="password" data-val autocomplete="off" spellcheck="false" placeholder="Type or paste it here">
   <span class="sc-err"></span>
   <div class="sc-actions"><span class="grow"></span><button class="ghost" data-act="secret-cancel">Cancel</button><button class="primary" data-act="secret-send">${icon('lock',14)}Send securely</button></div></div></div>`);
  const c=slot.lastElementChild,ctx=c.querySelector('[data-ctx]'),val=c.querySelector('[data-val]'),nm=c.querySelector('.sc-name');
  ctx.oninput=()=>{const n=this.nameOf(ctx.value);nm.textContent=n?'Saved as '+n:''};ctx.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();val.focus()}};val.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.giveSend(c)}};
  c.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel(c)});ctx.focus()},
 async giveSend(c){const ctx=c.querySelector('[data-ctx]'),val=c.querySelector('[data-val]'),err=c.querySelector('.sc-err'),b=c.querySelector('[data-act="secret-send"]');
  if(!ctx.value.trim()){err.textContent='Say what it is, so '+AGENT()+' knows when to use it.';return ctx.focus()}if(!val.value){err.textContent='Type or paste the value.';return val.focus()}
  b.disabled=true;err.textContent='';
  try{const r=await post(UI,'/ui/secrets/give',{agent:agentProfile()||'default',label:ctx.value.trim(),name:this.nameOf(ctx.value),value:val.value});val.value='';c.classList.add('done');
   c.querySelector('.sc-main').innerHTML='<b>'+icon('check',15)+' Saved as '+esc(r.name)+'</b><span class="hint">'+esc(AGENT())+' now knows it has “'+esc(ctx.value.trim())+'” and can use it without seeing it.</span>';setTimeout(()=>{Secrets.drop(c)},3500);
   // tell the agent (as a steer while it is working, otherwise as a message); the value is not in it
   await Chat.tell(r.message,Chat.id)}
  catch(e){err.textContent=e.message;b.disabled=false}},
 drop(c){const slot=c.parentElement;if(!slot)return;c.classList.add('out');if(![...slot.children].some(x=>!x.classList.contains('out')))slot.classList.add('closing');
  setTimeout(()=>{c.remove();if(!slot.children.length)slot.classList.remove('closing')},calm()?0:260)},
 tick(c,exp){const el=c.querySelector('.sc-left');const t=setInterval(()=>{if(!c.isConnected||c.classList.contains('done'))return clearInterval(t);const s=Math.max(0,Math.round((exp-Date.now())/1000));el.textContent=s?'Open for '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):'Expired';if(!s)clearInterval(t)},1000)},
 async send(c){if(c.classList.contains('give'))return this.giveSend(c);const i=c.querySelector('input[data-val]'),err=c.querySelector('.sc-err'),b=c.querySelector('[data-act="secret-send"]');const v=i.value;if(!v){err.textContent='Type or paste it first.';return i.focus()}
  b.disabled=true;err.textContent='';
  try{const r=await post(UI,'/ui/secrets/'+encodeURIComponent(c.dataset.id),{value:v});i.value='';c.classList.add('done');
   c.querySelector('.sc-main').innerHTML='<b>'+icon('check',15)+' '+esc(r.text||'Sent')+'</b><span class="hint">'+esc(AGENT())+' carries on without seeing it.</span>';setTimeout(()=>{Secrets.drop(c)},4000)}
  catch(e){err.textContent=e.message;b.disabled=false}},
 async cancel(c){if(!c.classList.contains('give'))try{await post(UI,'/ui/secrets/'+encodeURIComponent(c.dataset.id),{cancel:true})}catch{}Secrets.drop(c)}};

// a folded list of steps rises in when it is opened
document.addEventListener('toggle',e=>{const d=e.target;if(!d.classList?.contains('steps-fold')||!d.open||calm())return;d.classList.add('opening');setTimeout(()=>d.classList.remove('opening'),360)},true);

function attKind(name,type=''){if(/^image\//.test(type)||/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name))return 'image';if(/^video\//.test(type)||/\.(mp4|mov|webm|m4v|mkv)$/i.test(name))return 'video';return 'file'}
function attSize(n){return !n?'':n<1e6?Math.max(1,Math.round(n/1e3))+' KB':(n/1e6).toFixed(n<1e7?1:0)+' MB'}
function dataFile(f){const [h,b]=String(f.url||'').split(',');const bin=atob(b||'');const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:(/data:([^;]+)/.exec(h)||[])[1]||'application/octet-stream'})}
// step lines show the engine's folders in plain words (the exact command stays in the step's details)
function plainPaths(t){return String(t||'').replace(/\/home\/[\w.-]+\/\.hermes\/profiles\/([\w-]+)/g,(m,a)=>'['+ident(a).name+']').replace(/\/home\/[\w.-]+\/\.hermes(?=\/|\b)/g,'[aqeelOS]').replace(/~\/\.hermes(?=\/|\b)/g,'[aqeelOS]').replace(/(^|[\s;&|(])hermes(?=\s)/g,'$1aqeelos').replace(/(?<![\w\/.-])Hermes Agent\b/g,'aqeelOS').replace(/(?<![\w\/.-])Hermes(?![\w-])/g,'aqeelOS')}


function msgStamp(sec){return new Date(sec*1000).toLocaleString([],{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short',year:'numeric'})}
// replies that think in tags: <thinking> and <reflection> become the folded thinking, <action> and <result> labelled
// cards; code blocks are left exactly as written, and a tag that is never closed stays text
function reasonMarkup(text){const src=String(text||'');if(!/<(thinking|reflection|action|result)>/i.test(src))return null;
 const chunks=[];let buf=[],code=false;for(const l of src.split('\n')){if(/^```/.test(l)){if(!code&&buf.length){chunks.push({code:false,t:buf.join('\n')});buf=[]}buf.push(l);if(code){chunks.push({code:true,t:buf.join('\n')});buf=[]}code=!code;continue}buf.push(l)}if(buf.length)chunks.push({code,t:buf.join('\n')});
 const think=[],segs=[];const prose=t=>{if(!t)return;const p=segs[segs.length-1];if(p?.type==='prose')p.t+='\n'+t;else segs.push({type:'prose',t})};
 const parse=(t,inThink)=>{let out=0,from=0;const open=/<(thinking|reflection|action|result)>/gi;
  for(;;){open.lastIndex=from;const o=open.exec(t);if(!o)break;const tag=o[1].toLowerCase(),re=new RegExp('</?'+tag+'>','gi');re.lastIndex=open.lastIndex;let d=1,c;while((c=re.exec(t))){if(c[0][1]==='/'){if(!--d)break}else d++}
   if(!c||d){from=open.lastIndex;continue}const before=t.slice(out,o.index);if(inThink)think.push(before);else prose(before);const inner=t.slice(open.lastIndex,c.index);
   if(tag==='action'||tag==='result'){if(inner.trim())segs.push({type:tag,t:inner.trim()})}else parse(inner,true);out=from=re.lastIndex}
  const rest=t.slice(out);if(inThink)think.push(rest);else prose(rest)};
 for(const c of chunks)if(c.code)prose(c.t);else parse(c.t,false);
 if(!segs.some(x=>x.type!=='prose')&&!think.join('').trim())return null;
 return {think:think.map(x=>x.trim()).filter(Boolean).join('\n\n'),segs:segs.filter(x=>x.type!=='prose'||x.t.trim())}}

function chatTitle(id){const c=(S.sessions||[]).find(x=>x.id===id);return c?String(c.title||c.preview||'').slice(0,80):''}
