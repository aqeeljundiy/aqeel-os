// Claude-style chat on top of Hermes: conversation list (dashboard API), history, and live turns
// streamed from the gateway's session-chat SSE endpoint, with tool cards, approvals, stop and steer.
const EFFORTS=['low','medium','high','xhigh','max'];
const AUTOMATION_SOURCES=['cron','api_server_runs','tool','acp','webhook'];
// Where a chat came from, said plainly on hover.
const SRC_LABEL={api_server:'Started in this app',whatsapp:'From WhatsApp',telegram:'From Telegram',cron:'A schedule ran this',webhook:'Started by a webhook',cli:'From the command line',tui:'From the command line',oneshot:'A one-off task',discord:'From Discord',slack:'From Slack',email:'From email'};
// Shown until the server has starters written from recent chats.
const STARTER_DEFAULTS={admin:[['Check my sites','See if every site on the VPS is up, and tell me if anything is slow.'],['Plan a schedule','Every weekday at 8, send me a short report on how my sites are doing.'],['Tidy the server','Find what is using disk space on this box and suggest a safe clean-up.'],['Research','Find three new AI tools worth trying this week and say what each one is good for.']],member:[['Plan my week','Help me plan this week: ask me what is coming up, then make a simple day-by-day list.'],['Dinner ideas','Suggest five easy dinners for this week with a shopping list.'],['Write a message','Help me write a friendly message. Ask me who it is for and what I want to say.'],['Learn something','Explain something interesting in simple words. Ask me what I am curious about first.']]};
const Chat={
 models:null,model:store.get('model',null),effort:store.get('effort','medium'),
 live:{},        // sessionId → {turns, running, runId, abort}
 cwd:store.get('cwd',''),
 sendMode:store.get('sendMode','steer'),   // while busy: 'steer' (into the running reply) or 'queue' (after it)

 /* ---------- sidebar ---------- */
 sidebar(r){
  const q=S.search.toLowerCase();
  const list=S.sessions.filter(c=>(S.chatFilter==='all'||(S.chatFilter==='chats')!==AUTOMATION_SOURCES.includes(c.source))&&(!q||((c.title||'')+' '+(c.preview||'')).toLowerCase().includes(q)));
  const pinned=store.get('pinned',[]);const pins=list.filter(c=>pinned.includes(c.id)),rest=list.filter(c=>!pinned.includes(c.id));
  const groups={};rest.forEach(c=>(groups[groupOf(c.last_active||c.started_at)]??=[]).push(c));
  const row=c=>`<button class="item ${r.chat===c.id?'on':''}" data-go="/chat/${esc(c.id)}">${c.is_active||this.live[c.id]?.running?`<span class="live">${icon('activity',14)}</span>`:`<span class="src" title="${esc(SRC_LABEL[c.source]||('From '+pretty(c.source||'this app')))}">${icon(srcIcon(c.source),14)}</span>`}<span class="t">${esc(c.title||c.preview||'Untitled chat')}</span><span class="more" role="button" tabindex="0" data-menu="convo" data-id="${esc(c.id)}" aria-label="More">${icon('more',16)}</span></button>`;
  const body=!S.sessionsLoaded?'<div class="skel skel-row" style="height:30px;margin:12px 10px"></div>'.repeat(5):list.length?`${pins.length?`<div class="group-label">Pinned</div>${pins.map(row).join('')}`:''}${Object.entries(groups).map(([g,l])=>`<div class="group-label">${g}</div>${l.map(row).join('')}`).join('')}`:`<p style="padding:16px 12px;color:var(--muted);font-size:13px">${q?'No chats match.':'No chats yet.'}</p>`;
  return `<div class="side-sub"><div style="padding:12px 12px 8px"><button style="width:100%" data-act="new">${icon('plus',16)}New chat</button></div>
   <div class="side-search">${icon('search',15)}<input id="chatSearch" placeholder="Search chats" aria-label="Search chats" value="${esc(S.search)}"></div>
   <div style="padding:0 12px 6px"><div class="tabs" data-tabs="chatFilter" style="margin:0;display:flex">${[['chats','Chats'],['automation','Automation'],['all','All']].map(([k,l])=>`<button class="${S.chatFilter===k?'on':''}" data-tab="${k}" style="flex:1;padding:6px 8px;font-size:12.5px">${l}</button>`).join('')}<span class="pill"></span></div></div>
   <div class="side-list">${body}</div>
   <div style="padding:6px 10px 10px;border-top:1px solid var(--border)"><button class="item ${r.chat==='manage'?'on':''}" data-go="/chat/manage">${icon('list',16)}<span class="t">Manage chats</span><span class="n">${S.sessionsTotal??''}</span></button></div></div>`;
 },
 async loadSessions(){
  try{const d=await H('/sessions'+qp({limit:100,offset:0,order:'recent'}));const noTools=s=>String(s||'').replace(/^\[Use these tools for this: [^\]]*\]\s*/,'');S.sessions=(d.sessions||[]).map(x=>({...x,preview:noTools(x.preview),title:noTools(x.title)}));S.sessionsTotal=d.total;S.sessionsLoaded=true}catch(e){S.sessionsLoaded=true;fail(e)}
  if(route().sec.id==='chat'&&$('.side')){paintSide();placePills()}
 },

 /* ---------- models ---------- */
 async loadModels(){
  try{const d=await G('/api/model/options');const out=[];
   for(const p of d.providers||[]){if(!usableProvider(p))continue;for(const m of p.models||[])out.push({id:m,provider:p.slug,providerName:provLabel(p),label:modelLabel(m),reasoning:p.capabilities?.[m]?.reasoning!==false,current:p.is_current&&m===d.model})}
   this.usage=Object.fromEntries((d.providers||[]).filter(p=>p.usage?.windows?.length).map(p=>[p.slug,p.usage.windows]));this.defProv=d.provider;
   // Current provider first, then everything else signed in.
   out.sort((a,b)=>(b.provider===d.provider)-(a.provider===d.provider));
   this.models=out;this.defaultModel={id:d.model,provider:d.provider};S.model=d.model;
   if(!this.model||!out.some(m=>m.id===this.model.id&&m.provider===this.model.provider))this.model=null;
  }catch(e){this.models=[]}
 },
 cur(){return this.model||this.defaultModel||{}},
 setModel(m){this.model=m?{id:m.id,provider:m.provider}:null;store.set('model',this.model);this.paintComposerBar();toast('Model: '+(m?m.label:'default'))},
 setEffort(e){this.effort=e;store.set('effort',e);this.paintComposerBar()},

 /* ---------- view ---------- */
 view(el,id){
  if(id==='manage')return Pages.manageChats(el);
  this.id=id;
  el.innerHTML=`<div class="chat"><div class="chat-scroll" id="scroll">${id?'<div class="thread" id="thread"><div class="skel" style="height:60px;width:60%;align-self:flex-end"></div><div class="skel" style="height:120px"></div></div>':this.emptyHtml()}</div>${this.composerHtml()}</div>`;
  this.bindComposer();this.paintQueue();
  if(id){if(this.live[id])this.paint();else this.loadHistory(id)}
  else this.loadStarters();
 },
 emptyHtml(){if(S.me&&!S.me.admin&&!Object.keys(S.me.agents||{}).length)return `<div class="chat-empty"><div class="halo">${icon('user',28)}</div><h1>Welcome, ${esc(S.me.name)}</h1><p>No agents are shared with you yet. Ask the person who invited you to share one, then refresh this page.</p></div>`;
  const h=new Date().getHours();const hi=h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  return `<div class="chat-empty"><div class="halo">${avatarImg(30)}</div><h1>${hi}</h1><p>${S.me&&!S.me.admin?`What can <span class="agent-name">${esc(AGENT())}</span> help you with today?`:`What should <span class="agent-name">${esc(AGENT())}</span> work on? It runs on your AI box, so it keeps going when you close this tab.`}</p>
  <div class="prompts" id="starters">${this.startersHtml(this.starters[S.profile||'default']||STARTER_DEFAULTS[S.me&&!S.me.admin?'member':'admin'])}</div></div>`},
 // Starter prompts come from the person's recent chats with this agent (server: starters.mjs); cached here per agent.
 starters:{},
 startersHtml(list){return (list||[]).map(([a,b])=>`<button class="card prompt" data-prompt="${esc(b)}"><b>${esc(a)}</b>${esc(b)}</button>`).join('')},
 async loadStarters(){const k=S.profile||'default';try{const d=await UI('/ui/starters?agent='+encodeURIComponent(k));const same=JSON.stringify(d.prompts)===JSON.stringify(this.starters[k]);this.starters[k]=d.prompts;const el=$('#starters');
  if(el&&!same&&(S.profile||'default')===k){el.classList.add('swap');setTimeout(()=>{el.innerHTML=this.startersHtml(d.prompts);el.classList.remove('swap')},180)}}catch{}},
 composerHtml(){const running=this.live[this.id]?.running;
  return `<div class="composer-wrap"><div style="position:relative;max-width:780px;margin:0 auto"><div id="slash"></div><div class="composer" id="composer">
  <div id="queueList"></div><div id="toolChips" class="tool-chips">${this.toolChipsHtml()}</div><div id="attachList" style="display:flex;gap:6px;flex-wrap:wrap"></div>
  <textarea id="msg" rows="1" placeholder="${esc(this.placeholder())}" aria-label="Message"></textarea>
  <div class="composer-bar" id="cbar">${this.barHtml()}</div></div>
  <p class="hint-line">${S.me&&!S.me.admin?`<span class="agent-name">${esc(AGENT())}</span> can make mistakes. Check anything important.`:`<span class="agent-name">${esc(AGENT())}</span> runs on your AI box and can use its terminal, files and the web.`}</p></div></div>`},
 // How much of the current account's limit is used (worst of its session/week windows), next to the model.
 meterHtml(){const prov=this.cur()?.provider||this.defProv;const ws=(this.usage||{})[prov];if(!ws)return '';const acct=ws.filter(w=>w.scope!=='model');const u=Math.round(Math.max(0,...(acct.length?acct:ws).map(w=>Number(w.used_percent)||0)));
  const tip=ws.map(w=>`${w.label}: ${Math.round(w.used_percent||0)}% used${w.resets_at?' · resets '+when(w.resets_at):''}`).join('\n');const c=u>=90?'bad':u>=70?'warn':'ok';const R=7,L=2*Math.PI*R;
  return `<button class="meter ${c}" ${S.me&&!S.me.admin?'':'data-go="/models/accounts"'} title="${esc(tip)}" aria-label="${u}% of this account's limit used"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="${R}" class="trk"/><circle cx="9" cy="9" r="${R}" class="val" stroke-dasharray="${L}" stroke-dashoffset="${L*(1-u/100)}"/></svg><span>${u}%</span></button>`},
 refreshUsage(){clearTimeout(this._uT);this._uT=setTimeout(async()=>{await this.loadModels().catch(()=>{});const m=$('.meter');if(m){const t=document.createElement('div');t.innerHTML=this.meterHtml();const n=t.firstElementChild;if(n)m.replaceWith(n)}},1500)},
 barHtml(){const running=this.live[this.id]?.running;const m=this.cur();const known=(this.models||[]).find(x=>x.id===m.id&&x.provider===m.provider);
  return `<span class="cb-l"><button class="ghost icon" data-act="attach" title="Attach images" aria-label="Attach images">${icon('clip',18)}</button>${this.canTools()?`<button class="ghost icon ${this.tools.length?'on':''}" data-menu="chat-tools" title="Use a tool" aria-label="Use a tool">${icon('plug',18)}</button>`:''}<span id="voiceSlot" class="voice-slot">${Voice.btn()}</span>${this.id||(S.me&&!S.me.admin)?'':`<button class="pick" data-menu="workspace" title="Folder for this chat">${icon('folder',15)}<span>${esc(this.cwd?this.cwd.replace(/^\/home\/claude/,'~'):'~')}</span></button>`}</span><span class="cb-r"><button class="pick" data-menu="model">${esc(known?known.label:modelLabel(m.id))}${icon('chevD',14)}</button>${this.meterHtml()}${(!known||known.reasoning)?`<button class="pick" data-menu="effort"><span>Effort </span>${esc(this.effort)}${icon('chevD',14)}</button>`:''}
  ${running?`<button class="pick busy-mode" data-act="send-mode" data-mode="${this.sendMode==='queue'?'steer':'queue'}" title="${this.sendMode==='queue'?'Queue: your message waits until this reply is done. Click to steer instead.':'Steer: your message joins the reply in progress. Click to queue instead.'}">${icon(this.sendMode==='queue'?'clock':'wand',14)}<span>${this.sendMode==='queue'?'Queue':'Steer'}</span></button><button class="ghost icon" data-act="send-busy" title="${this.sendMode==='queue'?'Queue (Enter)':'Steer (Enter)'}" aria-label="${this.sendMode==='queue'?'Queue message':'Steer'}">${icon('send',17)}</button>`:''}<button class="primary send ${running?'stop':''}" id="send" aria-label="${running?'Stop':'Send'}" title="${running?'Stop (Esc)':'Send (Enter)'}">${icon(running?'stop':'send',18)}</button></span>`},
 placeholder(){const s=this.live[this.id];if(!s?.running)return 'Message '+AGENT()+'… (type / for commands)';return this.sendMode==='queue'?'Queue a message for after this reply…':'Steer '+AGENT()+' while it works…'},
 setSendMode(m){this.sendMode=m;store.set('sendMode',m);this.paintComposerBar();$('#msg')?.focus()},
 paintQueue(){const el=$('#queueList');if(!el)return;const s=this.live[this.id];const q=s?.queue||[];
  el.innerHTML=q.length?`<div class="queue">${q.map((m,i)=>`<span class="qchip" title="${esc(m.text)}"><b>${i+1}</b><span class="qt">${esc(m.text)}</span><button class="ghost icon" data-act="unqueue" data-i="${i}" aria-label="Remove from queue">${icon('x',12)}</button></span>`).join('')}${s.paused&&!s.running?`<span class="qnote">Paused after Stop</span><button class="qgo" data-act="queue-go">${icon('play',13)}Send next</button>`:`<span class="qnote">${s.running?'Runs after this reply':''}</span>`}</div>`:''},
 runQueue(id){const s=this.live[id];if(!s||s.running||s.paused||!s.queue?.length)return;const next=s.queue.shift();if(this.id===id)this.paintQueue();setTimeout(()=>this.send(next.text,next.images||[],id),250)},
 paintComposerBar(){const b=$('#cbar');if(b)b.innerHTML=this.barHtml();const ta=$('#msg');if(ta)ta.placeholder=this.placeholder();this.paintQueue()},
 bindComposer(){const ta=$('#msg');if(!ta)return;ta.focus();
  ta.oninput=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px';this.slash(ta.value)};
  ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();const first=$('#slash .item');if(first&&/^\/\S*$/.test(ta.value))return this.pickSlash(first.dataset.cmd);this.submit()}if(e.key==='Escape'&&this.live[this.id]?.running)this.stop()};
  ta.onpaste=e=>{const f=[...(e.clipboardData?.files||[])].filter(x=>x.type.startsWith('image/'));if(f.length){e.preventDefault();this.addFiles(f)}};
  const box=$('#composer');box.ondragover=e=>{e.preventDefault();box.classList.add('drop')};box.ondragleave=()=>box.classList.remove('drop');box.ondrop=e=>{e.preventDefault();box.classList.remove('drop');this.addFiles([...e.dataTransfer.files])};
 },

 /* ---------- attachments (images go inline to the model) ---------- */
 files:[],
 addFiles(list){for(const f of list){if(!f.type.startsWith('image/')){toast('Only images can be attached to a chat. Upload other files in Abilities › Files.','err');continue}if(f.size>8e6){toast(f.name+' is larger than 8 MB','err');continue}const r=new FileReader();r.onload=()=>{this.files.push({name:f.name,url:r.result});this.paintFiles()};r.readAsDataURL(f)}},
 paintFiles(){const el=$('#attachList');if(!el)return;el.innerHTML=this.files.map((f,i)=>`<span class="chip" style="margin-bottom:6px">${icon('file',13)}${esc(f.name)}<button class="ghost icon" style="width:20px;min-height:20px" data-act="unattach" data-i="${i}" aria-label="Remove">${icon('x',12)}</button></span>`).join('')},

 /* ---------- history ---------- */
 async loadHistory(id){
  try{const d=await H('/sessions/'+encodeURIComponent(id)+'/messages?limit=500&order=latest');if(this.id!==id)return;
   if(this.live[id]?.running)return;this.live[id]={turns:this.toTurns(d.messages||[]),running:false};this.paint();this.follow(id);
   // A session that was continued after compaction: offer the newest continuation.
   H('/sessions/'+encodeURIComponent(id)+'/latest-descendant').then(x=>{const nid=x?.latest_id||x?.session_id||x?.id;if(nid&&nid!==id&&this.id===id){const th=$('#thread');th?.insertAdjacentHTML('afterbegin',`<div class="approval" style="background:var(--blue-soft);border-color:transparent"><h4>${icon('fork',16)}This chat continues in a newer one</h4><p>aqeelOS compacted it and carried on in a follow-up chat.</p><div class="btns"><button class="primary" data-go="/chat/${esc(nid)}">Open the latest</button></div></div>`)}}).catch(()=>{});
  }catch(e){if(this.id===id)showError($('#scroll'),e)}
 },
 toTurns(msgs){const turns=[];let ai=null;const byCall={};
  for(const m of msgs){if(m.active===0)continue;
   if(m.role==='user'){ai=null;turns.push({role:'user',text:typeof m.content==='string'?m.content:this.contentText(m.content)});continue}
   if(m.role==='system')continue;
   if(!ai){ai={role:'ai',steps:[],text:'',think:''};turns.push(ai)}
   if(m.role==='assistant'){const r=m.reasoning_content||m.reasoning;if(r&&typeof r==='string')ai.think+=(ai.think?'\n\n':'')+r;
    for(const tc of m.tool_calls||[]){let args={};try{args=JSON.parse(tc.function?.arguments||'{}')}catch{}const s={tool:tc.function?.name||'tool',args,sum:this.summary(tc.function?.name,args),out:'',done:true};ai.steps.push(s);byCall[tc.id||tc.call_id]=s}
    const t=this.contentText(m.content);if(t)ai.text+=(ai.text?'\n\n':'')+t;if(m.finish_reason==='stop'&&m.timestamp)ai.meta=new Date(m.timestamp*1000).toLocaleString([], {hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}
   if(m.role==='tool'){const s=byCall[m.tool_call_id];const out=this.toolOut(m.content);if(s){s.out=out;s.failed=/"error":\s*"(?!null)|BLOCKED:/.test(String(m.content||''))}else ai.steps.push({tool:m.tool_name||'tool',sum:m.tool_name||'tool',out,done:true})}
  }return turns},
 contentText(c){if(c==null)return '';if(typeof c==='string')return c;if(Array.isArray(c))return c.map(p=>p.text||(p.type==='image_url'?'[image]':'')).join('');return String(c)},
 toolOut(c){const s=this.contentText(c);try{const j=JSON.parse(s);if(j&&typeof j==='object'){if('output' in j)return String(j.output??'')+(j.error?'\n'+j.error:'');return JSON.stringify(j,null,2)}}catch{}return s},
 summary(name,a={}){if(!a||typeof a!=='object')return name;return a.command||a.query||a.url||a.path||a.file_path||a.pattern||a.name||a.prompt?.slice?.(0,80)||name},

 /* ---------- painting ---------- */
 paint(follow=true){const s=this.live[this.id];const th=$('#thread')||(()=>{const sc=$('#scroll');if(!sc)return null;sc.innerHTML='<div class="thread" id="thread"></div>';return $('#thread')})();if(!th||!s)return;
  const sc=$('#scroll');const atBottom=!sc||sc.scrollHeight-sc.scrollTop-sc.clientHeight<120;
  const keep=$$('.step.open',th).map(x=>x.dataset.k);
  th.innerHTML=s.turns.map((t,i)=>this.turnHtml(t,i,s)).join('')||'';
  keep.forEach(k=>th.querySelector(`.step[data-k="${k}"]`)?.classList.add('open'));
  if(follow&&atBottom&&sc)sc.scrollTop=sc.scrollHeight},
 turnHtml(t,i,s){
  if(t.role==='user')return `<div class="msg user ${t.steer?'steer':''}">${this.userHtml(t.text)}${t.steer?`<span class="attach">${icon(t.steer==='failed'?'alert':'zap',12)} ${t.steer==='failed'?esc(t.err||'Not delivered'):t.steer==='delivered'?'Read while working':'Sent while working'}</span>`:''}${t.images?`<span class="attach">${icon('clip',12)} ${plural(t.images,'image')}</span>`:''}</div>`;
  const last=i===s.turns.length-1;if(!last&&!t.text&&!(t.steps||[]).length&&!t.think&&!t.approval&&!t.error)return '';
  const think=t.think?`<button class="think" data-act="think">${icon('brain',15)}${s.running&&last&&!t.text?'Thinking…':'Thought'}${t.thinkSecs?' for '+t.thinkSecs+' s':''}${icon('chevR',14)}</button><div class="think-body" hidden>${esc(t.think)}</div>`:'';
  const steps=t.steps?.length?`<div class="steps">${t.steps.map((x,k)=>this.stepHtml(x,i+'-'+k)).join('')}</div>`:'';
  const appr=t.approval?this.approvalHtml(t.approval):'';
  const typing=s.running&&last&&!t.text&&!t.approval&&!(t.steps||[]).some(x=>!x.done);
  const text=t.text?`<div class="text md ${s.running&&last?'streaming':''}">${md(t.text)}</div>`:typing?'<div class="text"><span class="typing"><i></i><i></i><i></i></span></div>':'';
  const err=t.error?`<p class="err-line">${icon('alert',14)} ${esc(t.error)}</p>`:'';
  const tools=!s.running||!last?`<div class="msg-tools"><button title="Copy" aria-label="Copy" data-act="copymsg" data-i="${i}">${icon('copy',15)}</button>${last?`<button title="Retry" aria-label="Retry" data-act="retry">${icon('retry',15)}</button>`:''}<button title="Fork from here" aria-label="Fork from here" data-act="fork">${icon('fork',15)}</button>${t.meta?`<span class="meta">${esc(t.meta)}</span>`:''}</div>`:'';
  return `<div class="msg ai"><span class="who">${avatarImg(16)}</span><div class="body">${think}${steps}${appr}${text}${err}${tools}</div></div>`},
 stepHtml(x,k){const ic={terminal:'terminal',web_search:'globe',web_extract:'globe',browser_navigate:'globe',read_file:'file',write_file:'file',patch:'edit',search_files:'search'}[x.tool]||(/browser|web/.test(x.tool)?'globe':/file|patch/.test(x.tool)?'file':'terminal');
  const state=!x.done?'<span class="spinner"></span>Running':x.failed?`<span style="color:var(--bad)">${icon('x',14)}</span>Failed`:`<span class="ok-ic">${icon('check',14)}</span>${x.secs?x.secs+' s':'Done'}`;
  const sum=x.tool==='terminal'?`<code>${esc(x.sum)}</code>`:`<b style="font-weight:600">${esc(x.tool.replace(/_/g,' '))}</b> ${esc(x.sum&&x.sum!==x.tool?x.sum:'')}`;
  const detail=[x.args&&Object.keys(x.args).length?JSON.stringify(x.args,null,2):'',x.out].filter(Boolean).join('\n\n— output —\n');
  return `<div class="step" data-k="${k}"><button class="step-head" data-act="step"><span class="si">${icon(ic,14)}</span><span class="sum">${sum}</span><span class="state">${state}</span><span class="chev">${icon('chevR',14)}</span></button><div class="step-body"><div><pre>${esc(detail.slice(0,20000)||'(no output)')}</pre></div></div></div>`},
 approvalHtml(a){if(a.resolved)return `<div class="steps"><div class="step"><div class="step-head"><span class="si">${icon(a.resolved==='deny'?'x':'check',14)}</span><span class="sum">${a.resolved==='deny'?'Denied':'Approved'}${a.command?': <code>'+esc(a.command)+'</code>':''}</span></div></div></div>`;
  const label={once:'Approve once',session:'Allow for this chat',always:'Always allow',deny:'Deny'};
  return `<div class="approval"><h4>${icon('shield',16)}${esc(a.title||AGENT()+' needs your OK')}</h4><p>${esc(a.description||a.reason||'This command could change or delete things on the box.')}</p>${a.command?`<pre>${esc(a.command)}</pre>`:''}<div class="btns">${(a.choices||['once','deny']).map((c,i)=>`<button class="${i===0?'primary':c==='deny'?'ghost':''}" data-act="approval" data-choice="${c}">${label[c]||c}</button>`).join('')}</div></div>`},

 /* ---------- sending ---------- */
 async submit(){if(Voice.on)Voice.stop();const ta=$('#msg');const text=ta.value.trim();if(!text&&!this.files.length)return;
  const s=this.live[this.id];
  if(s?.running&&this.sendMode==='queue'){const images=this.files;this.files=[];this.paintFiles();(s.queue??=[]).push({text,images});ta.value='';ta.style.height='';this.paintQueue();return}
  if(s?.running){if(!s.runId)return toast(AGENT()+' is starting, try again in a second');ta.value='';ta.style.height='';
   const u={role:'user',text,steer:'sending'};const n={role:'ai',steps:[],text:'',think:''};s.turns.push(u,n);s.ai=n;s.runTurns.push(n);this.paint();
   try{await post(G,'/v1/runs/'+s.runId+'/steer',{text});if(u.steer==='sending')u.steer='sent'}catch(e){u.steer='failed';u.err=e.message;s.turns.splice(s.turns.indexOf(n),1);s.runTurns.pop();s.ai=s.runTurns[s.runTurns.length-1]}this.paint();return}
  if(s)s.paused=false;
  if(text.startsWith('/')&&this.command(text))return;
  ta.value='';ta.style.height='';$('#slash').innerHTML='';
  const images=this.files;this.files=[];this.paintFiles();
  await this.send(text,images)},
 // Tools picked for the next message (MCP servers or built-in tools). Hermes has no per-message tool switch,
 // so they travel as a short instruction in front of the message; the bubble shows them as chips.
 tools:[],
 canTools(){return !S.me||S.me.admin||Object.values(S.me.agents||{}).some(l=>l!=='chat')},
 toolChipsHtml(){return this.tools.map((t,i)=>`<span class="tchip">${icon(t.kind==='mcp'?'plug':'zap',13)}${esc(t.label)}<button class="ghost icon" data-act="tool-off" data-i="${i}" aria-label="Remove ${esc(t.label)}">${icon('x',12)}</button></span>`).join('')},
 paintTools(){const el=$('#toolChips');if(el)el.innerHTML=this.toolChipsHtml();$$('[data-menu="chat-tools"]').forEach(b=>b.classList.toggle('on',this.tools.length>0))},
 TOOL_RE:/^\[Use these tools for this: ([^\]]+)\]\n\n/,
 userHtml(text){const m=this.TOOL_RE.exec(text||'');const body=m?text.slice(m[0].length):text||'';
  return (m?`<span class="tchips">${m[1].split(', ').map(x=>`<span class="tchip">${icon(/\(MCP\)$/.test(x)?'plug':'zap',12)}${esc(x.replace(/ \(MCP\)$/,''))}</span>`).join('')}</span>`:'')+esc(body).replace(/\n/g,'<br>')},
 async toolsMenu(el){const k=S.profile||'default';const c=this._toolCache?.[k];let d=c&&Date.now()-c.t<60000?c.d:null;
  if(!d){try{const [m,t]=await Promise.all([H('/mcp/servers').catch(()=>({servers:[]})),H('/tools/toolsets').catch(()=>[])]);d={mcp:(m.servers||m||[]).filter(s=>s.enabled!==false),built:(Array.isArray(t)?t:t.toolsets||[]).filter(x=>x.enabled)};(this._toolCache||={})[k]={t:Date.now(),d}}catch(e){return fail(e)}}
  explainFor('mcp',d.mcp.map(s=>({id:s.name,name:s.name,desc:s.url||s.command||''})));explainFor('tool',d.built.map(t=>({id:t.name,name:t.label||t.name,desc:t.description||''})));
  const has=(kind,name)=>this.tools.some(t=>t.kind===kind&&t.name===name);
  const flip=(kind,name,label)=>{const i=this.tools.findIndex(t=>t.kind===kind&&t.name===name);if(i>=0)this.tools.splice(i,1);else this.tools.push({kind,name,label});this.paintTools();$('#msg')?.focus()};
  menu(el,[{header:'MCP tools'},...(d.mcp.length?d.mcp.map(s=>({label:ex('mcp',s.name)?.title||pretty(s.name),sub:ex('mcp',s.name)?.summary,icon:'plug',on:has('mcp',s.name),run:()=>flip('mcp',s.name,pretty(s.name))})):[{label:'No MCP tools yet',icon:'plug',run:()=>go('/abilities/mcp')}]),
   '-',{header:'Built-in tools'},...d.built.map(t=>({label:t.label||pretty(t.name),sub:ex('tool',t.name)?.summary||String(t.description||'').slice(0,90),icon:'zap',on:has('tool',t.name),run:()=>flip('tool',t.name,t.label||pretty(t.name))})),
   '-',{label:'Manage tools…',icon:'sliders',run:()=>go('/abilities/mcp')}])},
 async send(text,images=[],target){
  if(this.tools.length&&!target){text='[Use these tools for this: '+this.tools.map(t=>t.label+(t.kind==='mcp'?' (MCP)':'')+' = '+t.name).join(', ').replace(/ = [^,]+/g,'')+']\n\n'+text;this.tools=[];this.paintTools()}
  let id=target||this.id;
  if(!id){try{const body=this.cwd?{cwd:this.cwd}:{};const d=await post(G,'/api/sessions',body);id=d.session?.id||d.id;}catch(e){return fail(e)}
   S.sessions.unshift({id,title:'',preview:text.replace(this.TOOL_RE,'').slice(0,80),source:'api_server',last_active:Date.now()/1000,is_active:true});this.id=id;history.replaceState(null,'','#/chat/'+id);this.live[id]={turns:[],running:false};$('#scroll').innerHTML='<div class="thread" id="thread"></div>'}
  const s=this.live[id]||(this.live[id]={turns:[],running:false});
  s.turns.push({role:'user',text,images:images.length||0});const ai={role:'ai',steps:[],text:'',think:''};s.turns.push(ai);s.ai=ai;s.runTurns=[ai];
  s.running=true;s.started=Date.now();if(this.id===id){this.paint();this.paintComposerBar()}paintSide();
  const m=this.cur();const body={message:images.length?[{type:'text',text},...images.map(f=>({type:'image_url',image_url:{url:f.url}}))]:text};
  if(this.model){body.model=m.id;body.provider=m.provider}
  body.model_options={reasoning_effort:this.effort};
  const ctl=new AbortController();s.abort=ctl;
  try{const r=await G('/api/sessions/'+encodeURIComponent(id)+'/chat/stream',{method:'POST',body,raw:true,signal:ctl.signal});
   if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error?.message||d.error||d.detail||('The server answered '+r.status))}
   await this.readStream(r,ev=>this.onEvent(id,ev));
  }catch(e){if(e.name!=='AbortError'){(s.ai||ai).error=e.message||String(e)}}
  finally{s.running=false;s.abort=null;s.runId=null;for(const t of s.runTurns||[ai])t.steps.forEach(x=>{if(!x.done){x.done=true;x.failed=x.failed||!!t.error}});
   for(const t of s.turns)if(t.steer==='sending')t.steer='sent';
   const last=s.ai||ai;if(!last.meta)last.meta=[modelLabel(last.model||ai.model||m.id),this.effort,Math.round((Date.now()-s.started)/1000)+' s'].filter(Boolean).join(' · ');
   if(this.id===id){this.paint();this.paintComposerBar()}this.loadSessions();this.runQueue(id)}
 },
 /* A reply still running (sent before a refresh, or from another tab): pick it up from the start and follow it. */
 async follow(id){const s=this.live[id];if(!s||s.running||s.following)return;s.following=true;
  try{const r=await fetch('/ui/live?agent='+encodeURIComponent(S.profile||'default')+'&session='+encodeURIComponent(id),{headers:{'x-hui':'1'},credentials:'same-origin'});
   if(r.status!==200||!r.body)return;const ai={role:'ai',steps:[],text:'',think:''};let shown=false;
   s.ai=ai;s.runTurns=[ai];s.running=true;s.started=Date.now();
   const show=um=>{if(shown)return;shown=true;const txt=typeof um==='string'?um:Array.isArray(um)?um.filter(x=>x.type==='text').map(x=>x.text).join(' '):'';
    const last=s.turns[s.turns.length-1];if(txt&&!(last?.role==='user'&&last.text===txt))s.turns.push({role:'user',text:txt});s.turns.push(ai);if(this.id===id){this.paint();this.paintComposerBar()}paintSide()};
   await this.readStream(r,ev=>{if(!shown)show(ev.type==='run.started'?ev.user_message?.content:'');this.onEvent(id,ev)});
   s.running=false;s.runId=null;ai.steps.forEach(x=>x.done=true);if(shown&&!ai.meta)ai.meta=[modelLabel(ai.model||''),Math.round((Date.now()-s.started)/1000)+' s'].filter(Boolean).join(' · ');
   if(this.id===id){this.paint();this.paintComposerBar()}this.loadSessions()}
  catch{if(s.running){s.running=false;if(this.id===id){this.paint();this.paintComposerBar()}}}finally{s.following=false}},
 // other tabs: notice when a reply starts on the open chat
 watchLive(){clearInterval(this._lv);this._lv=setInterval(async()=>{const id=this.id,s=this.live[id];if(!id||document.hidden||!s||s.running||s.following)return;
  try{const r=await fetch('/ui/live?peek=1&agent='+encodeURIComponent(S.profile||'default')+'&session='+encodeURIComponent(id),{headers:{'x-hui':'1'},credentials:'same-origin'});const j=await r.json();if(j.live&&this.id===id)this.follow(id)}catch{}},3000)},
 async readStream(r,on){const rd=r.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
   while((i=buf.search(/\r?\n\r?\n/))>=0){const raw=buf.slice(0,i);buf=buf.slice(i).replace(/^\r?\n\r?\n/,'');let ev='message',data='';for(const line of raw.split(/\r?\n/)){if(line.startsWith(':'))continue;if(line.startsWith('event:'))ev=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trimStart()}if(!data)continue;let d;try{d=JSON.parse(data)}catch{d={text:data}}on({type:d.type||ev,...d})}}},
 onEvent(id,e){const s=this.live[id];if(!s)return;const ai=s.ai;if(!ai)return;
  if(e.type==='tool.started'&&id===this.id&&/adspower|:9333|:50325/i.test(JSON.stringify([e.tool_name,e.preview,e.args])))Screen.useAds?.();
  switch(e.type){
   case 'run.started':s.runId=e.run_id;ai.model=e.runtime?.model||'';break;
   case 'assistant.delta':ai.text+=e.delta||e.text||'';break;
   case 'assistant.commentary':if(!e.already_streamed&&e.text)ai.text+=(ai.text?'\n\n':'')+e.text;break;
   case 'tool.started':ai.steps.push({tool:e.tool_name||'tool',args:e.args||{},sum:e.preview||this.summary(e.tool_name,e.args),out:'',done:false,t0:Date.now()});break;
   case 'tool.completed':case 'tool.failed':{const x=[...ai.steps].reverse().find(t=>!t.done&&t.tool===e.tool_name)||[...ai.steps].reverse().find(t=>!t.done);if(x){x.done=true;x.failed=e.type==='tool.failed';x.secs=((Date.now()-x.t0)/1000).toFixed(1);if(e.result||e.output)x.out=this.toolOut(e.result||e.output)}break}
   case 'tool.progress':if(e.tool_name==='_thinking'){if(!ai.t0think)ai.t0think=Date.now();ai.think+=e.delta||'';ai.thinkSecs=Math.max(1,Math.round((Date.now()-ai.t0think)/1000))}break;
   case 'reasoning.delta':case 'assistant.reasoning':ai.think+=e.delta||e.text||'';break;
   case 'approval.request':ai.approval={...e,choices:e.choices,command:e.command,description:e.description||e.reason,request_id:e.request_id};break;
   case 'approval.responded':if(ai.approval)ai.approval.resolved=e.choice;break;
   case 'assistant.completed':{let c=this.contentText(e.content||'');const prev=(s.runTurns||[]).filter(t=>t!==ai).map(t=>t.text).join('');if(prev&&c.startsWith(prev))c=c.slice(prev.length).trim();if(c&&(!ai.text||c.length>=ai.text.length))ai.text=c}ai.model=e.runtime?.model||ai.model;break;
   case 'run.completed':this.refreshUsage();if(e.pending_steer){/* the reply ended before the agent read it: send it as the next message instead */const u=[...s.turns].reverse().find(t=>t.steer&&t.steer!=='delivered');if(u){const i=s.turns.indexOf(u);const nx=s.turns[i+1];s.turns.splice(i,nx&&nx.role==='ai'&&!nx.text&&!(nx.steps||[]).length?2:1);if(s.ai===nx)s.ai=s.turns[s.turns.length-1];(s.queue??=[]).unshift({text:u.text,images:[]})}}if(e.messages){/* fill tool outputs from the final transcript */const t=this.toTurns(e.messages.map(m=>({...m,active:1})));const last=t[t.length-1];if(last?.role==='ai'){last.steps.forEach((x,k)=>{if(ai.steps[k]&&!ai.steps[k].out)ai.steps[k].out=x.out});if(!ai.text)ai.text=last.text}}const u=e.usage;if(u)ai.usage=u;break;
   case 'run.failed':ai.error=e.error?.message||e.error||AGENT()+' stopped with an error.';break;
   case 'run.steered':{const u=[...s.turns].reverse().find(t=>t.steer==='sending'||t.steer==='sent');if(u)u.steer='delivered';break}
   case 'run.cancelled':case 'run.interrupted':ai.text+=(ai.text?'\n\n':'')+'*Stopped.*';break;
  }
  if(this.id===id){cancelAnimationFrame(this.raf);this.raf=requestAnimationFrame(()=>this.paint())}
 },
 async stop(){const s=this.live[this.id];if(!s?.running)return;s.paused=true;try{if(s.runId)await post(G,'/v1/runs/'+s.runId+'/stop')}catch{}setTimeout(()=>s.abort?.abort(),1500);toast('Stopping…')},
 async approve(choice){const s=this.live[this.id];const t=s?.turns[s.turns.length-1];if(!s?.runId||!t?.approval)return;try{await post(G,'/v1/runs/'+s.runId+'/approval',{choice,...(t.approval.request_id?{request_id:t.approval.request_id}:{})});t.approval.resolved=choice;this.paint()}catch(e){fail(e)}},
 async newChat(){this.id=null;go('/chat')},
 async retry(){const s=this.live[this.id];if(!s||s.running)return;const lastUser=[...s.turns].reverse().find(t=>t.role==='user');if(lastUser)this.send(lastUser.text)},
 async fork(){try{const d=await post(G,'/api/sessions/'+encodeURIComponent(this.id)+'/fork',{});const nid=d.session?.id||d.id;await this.loadSessions();if(nid)go('/chat/'+nid);toast('Forked into a new chat')}catch(e){fail(e)}},

 /* ---------- slash commands (handled in the app; everything else goes to aqeelOS) ---------- */
 SLASH:[['/new','Start a fresh chat'],['/model','Switch the model for this chat'],['/reasoning','Set effort: low, medium, high, xhigh, max'],['/title','Rename this chat'],['/fork','Branch this chat into a new one'],['/compress','Ask aqeelOS to summarise and shrink this chat'],['/reload','Re-read aqeelOS config.yaml'],['/clear','Same as /new']],
 slash(v){const box=$('#slash');if(!box)return;if(!/^\/\S*$/.test(v)){box.innerHTML='';return}const l=this.SLASH.filter(s=>s[0].startsWith(v));box.innerHTML=l.length?`<div class="card slash">${l.map(s=>`<button class="item" data-cmd="${s[0]}"><b style="font-weight:600">${s[0]}</b><small>${s[1]}</small></button>`).join('')}</div>`:''},
 pickSlash(cmd){const ta=$('#msg');ta.value=cmd+' ';$('#slash').innerHTML='';ta.focus()},
 command(text){const [cmd,...rest]=text.split(/\s+/);const arg=rest.join(' ').trim();const ta=$('#msg');const clear=()=>{ta.value='';$('#slash').innerHTML=''};
  if(cmd==='/new'||cmd==='/clear'){clear();this.newChat();return true}
  if(cmd==='/model'){clear();const b=$('[data-menu=model]');if(b)openMenu(b);return true}
  if(cmd==='/reasoning'){if(EFFORTS.includes(arg)){this.setEffort(arg);clear();toast('Effort: '+arg)}else{clear();const b=$('[data-menu=effort]');if(b)openMenu(b)}return true}
  if(cmd==='/title'){clear();if(this.id)renameSession(this.id,arg||undefined);return true}
  if(cmd==='/fork'){clear();if(this.id)this.fork();return true}
  if(cmd==='/reload'){clear();toast('Settings are read fresh on every message, so changes already apply.');return true}
  return false},
};

async function renameSession(id,title){const c=S.sessions.find(x=>x.id===id);if(title===undefined){title=await promptBox('Rename chat','Title',c?.title||'');if(title===null)return}
 try{await H('/sessions/'+encodeURIComponent(id),{method:'PATCH',body:{title}});if(c)c.title=title;paintSide();paintTop();toast('Renamed')}catch(e){fail(e)}}
async function deleteSession(id){const c=S.sessions.find(x=>x.id===id);if(!await confirmBox('Delete this chat?',`“${esc(c?.title||c?.preview||id)}” and all its messages will be removed. This can't be undone.`))return;
 try{await del(H,'/sessions/'+encodeURIComponent(id));S.sessions=S.sessions.filter(x=>x.id!==id);delete Chat.live[id];toast('Chat deleted');if(route().chat===id)go('/chat');else paintSide()}catch(e){fail(e)}}

Chat.watchLive();
