// Help (24 Oct 2026, replaces System › Guide): the person's own chat about how aqeelOS works and what went wrong,
// at the bottom of the menu. The server (help.mjs) adds what Help may know about them to each question and reads the
// ticket Help files at the end of a reply; this view sends the page they came from and their recent errors in this
// tab (Oops, core.js), streams the answer with Chat's reader and draws it with the same message styles. It is the same
// whichever agent is picked, and never part of any agent's chats.
const Help={ID:'aqeelos-help',st:null,draft:'',turns:[],running:false,abort:null,unseen:0,from:null,nodes:[],_th:null,
 // the ticket marker Help ends a reply with is read by the server; people never see it, not even half-written
 TICKET_RE:/\[\[ticket\]\][\s\S]*?(\[\[\/ticket\]\]|$)/gi,
 shown(t){let s=String(t||'').replace(this.TICKET_RE,'');const k=s.lastIndexOf('[[');if(k>=0&&s.length-k<11&&'[[ticket]]'.startsWith(s.slice(k).toLowerCase()))s=s.slice(0,k);return s.trim()},
 // a page Help names ([Health](#/system/health)) is a link that only opens that page; any other link (a web address,
 // a file, a picture) shows as its plain words, so a reply never leads out of aqeelOS
 html(t){return md(this.shown(t)).replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi,(m,inner)=>'<span class="help-nolink">'+inner.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()+'</span>').replace(/<img\b[^>]*>/gi,'').replace(/\[([^\]<>]{1,80})\]\(#(\/[\w\/-]{0,80})\)/g,(m,l,h)=>`<button type="button" class="link help-go" data-go="${esc(h)}">${l}</button>`)},
 sidebar(r){const tk=this.st?.tickets||[],adm=(r||route()).arg?.[0]==='admin'&&S.me?.admin!==false;
  return `<div class="side-sub"><div class="side-sub-head"><span class="th">Help</span></div><div class="side-list"><button class="item ${adm?'':'on'}" data-go="/help">${icon('chat',16)}<span class="t">Conversation</span></button><button class="item" data-act="help-new">${icon('plus',16)}<span class="t">New conversation</span></button>
   ${S.me?.admin!==false?`<div class="group-label">For admins</div><button class="item ${adm?'on':''}" data-go="/help/admin">${icon('mail',16)}<span class="t">Tickets and settings</span>${HelpAdmin.open?`<span class="chip warn">${HelpAdmin.open}</span>`:''}</button>`:''}
   ${tk.length?`<div class="group-label">Your tickets</div>${tk.slice(0,8).map(t=>`<div class="item help-tk" title="${esc(t.what)}">${icon(t.status==='resolved'?'check':'mail',15)}<span class="t">${esc(t.what)}</span><span class="chip ${t.status==='resolved'?'ok':'warn'}">${t.status==='resolved'?'Resolved':'Open'}</span></div>`).join('')}`:''}</div></div>`},
 // the page someone came from (Help itself is never "the page"), in the words of the menu
 pageOf(h){const p=String(h||'').replace(/^#\/?/,'').split('?')[0].split('/'),s=SECTIONS.find(x=>x.id===p[0]);if(!s)return '';if(!s.pages)return s.label+(s.id==='chat'&&p[1]?' (a chat)':'');const g=s.pages.find(x=>x.id===p[1])||s.pages[0];return s.label+' › '+g.label},
 view(v){v.innerHTML=`<div class="chat help-chat"><div class="chat-scroll" id="hScroll"><div class="thread" id="hThread" data-anim></div></div><div class="composer-wrap"><div style="position:relative;max-width:780px;margin:0 auto"><div class="composer" id="hComposer">
  <textarea id="hMsg" rows="1" placeholder="Ask how something works, or what went wrong" aria-label="Message Help"></textarea>
  <div class="composer-bar"><button type="button" class="ghost small" data-act="help-new" id="hNew" hidden>${icon('plus',14)}New conversation</button><span class="grow"></span><span class="help-left" id="hLeft"></span><button class="primary send" id="hSend" aria-label="Send" title="Send (Enter)">${icon('send',18)}</button></div></div>
  <p class="hint-line" id="hHint">Help explains aqeelOS and checks what went wrong. It can’t change anything: for that, ask your agent.</p></div></div></div>`;
  this._th=null;this._history=true;this.bind();this.paint(true);this.load()},   // what is already there shows at once, without rising in again
 bind(){const ta=$('#hMsg'),b=$('#hSend');if(!ta)return;const fit=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px'};
  // the half-written question outlives a redraw of Help (a page draw, a reload of its state)
  if(this.draft&&!ta.value){ta.value=this.draft;fit()}
  ta.oninput=()=>{this.draft=ta.value;fit()};ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.go()}if(e.key==='Escape'&&this.running){e.preventDefault();this.stop()}};
  b.onclick=()=>this.running?this.stop():this.go();setTimeout(()=>{if(matchMedia('(pointer:fine)').matches)ta.focus()},60)},
 async load(){try{const d=await UI('/ui/help/state');this.st=d;this.unseen=0;
   if(!this.running){const seen=d.seenBefore||0,h=(d.turns||[]).map(t=>({...t}));
    // tickets sit under the reply that sent them (the closest one before), notices from admins where they happened
    for(const t of d.tickets||[]){const ai=[...h].reverse().find(x=>x.role==='ai'&&(x.at||0)<=t.at/1000+10);if(ai&&!ai.ticket)ai.ticket={ticket:t}}
    const all=[...h,...(d.notices||[]).filter(n=>d.session&&h.length?n.at/1000>=(h[0].at||0):n.at>seen).map(n=>({role:'notice',text:n.text,at:n.at/1000,fresh:n.at>seen}))];
    this.turns=all.sort((a,b)=>(a.at||0)-(b.at||0));this._history=true}
   else for(const t of this.turns)if(t.ticket?.ticket){const f=(d.tickets||[]).find(x=>x.id===t.ticket.ticket.id);if(f)t.ticket.ticket=f}}
  catch(e){if(e?.stale)return;this.st={ready:false,why:'Help couldn’t load: '+(e.message||e),err:true,tickets:[]}}
  paintSide();this.paint(true)},
 async peek(){if(!S.signedIn||document.hidden)return;try{const d=await UI('/ui/help/peek',{keep:true});const n=route().help?0:d.unseen||0;if(n!==this.unseen){this.unseen=n;paintSide()}}catch{}},
 items(){return this.turns},
 itemHtml(t,i,last){if(t.role==='user')return esc(t.text).replace(/\n/g,'<br>');
  if(t.role==='notice')return `${icon('check',15)}<span>${esc(t.text)}</span>${t.at?`<small>${esc(msgStamp(t.at))}</small>`:''}`;
  const typing=this.running&&last&&!this.shown(t.text)&&!t.error,body=this.shown(t.text)?`<div class="text md ${this.running&&last?'streaming':''}">${this.html(t.text)}</div>`:typing?'<div class="text"><span class="typing"><i></i><i></i><i></i></span></div>':'';
  const err=t.error?`<div class="err-box"><p class="err-line">${icon('alert',14)} ${esc(t.error)}</p>${last&&!t.limit?`<div class="err-acts"><button class="ghost" data-act="help-retry">${icon('refresh',14)}Try again</button></div>`:''}</div>`:'';
  return `<span class="who"><span class="help-ava">${icon('help',16)}</span></span><div class="body">${body}${err}${t.ticket?this.ticketHtml(t.ticket):''}</div>`},
 ticketHtml(x){if(x.error)return `<div class="help-ticket bad">${icon('alert',15)}<span><b>No ticket sent.</b> ${x.error==='limit'?'You already sent today’s tickets. Tell an admin directly.':'Help’s ticket couldn’t be read. Ask it again in other words.'}</span></div>`;
  const t=x.ticket||{},ok=t.status==='resolved';return `<div class="help-ticket ${ok?'ok':''}">${icon(ok?'check':'mail',15)}<span><b>${ok?'Ticket resolved':x.dup?'Already sent':'Ticket sent'}</b> ${esc(t.what||'')}</span><span class="chip ${ok?'ok':'warn'}">${ok?'Resolved':'Waiting for an admin'}</span></div>`},
 emptyHtml(){const st=this.st;if(st&&!st.ready&&st.why)return `<div class="chat-empty help-empty"><div class="halo"><span class="help-ava lg">${icon('help',26)}</span></div><h1>Help isn’t ready</h1>${alertBox(esc(st.why),{act:'help-reload',style:'text-align:left'})}</div>`;
  const errs=Oops.recent().length;
  return `<div class="chat-empty help-empty"><div class="halo"><span class="help-ava lg">${icon('help',26)}</span></div><h1>How can I help?</h1><p>Ask how something in aqeelOS works, or tell me what went wrong. I see the page you came from and the errors in this tab, and I send the admins a ticket when something needs fixing.</p>${errs?`<button class="ghost" data-act="help-ask" data-q="What went wrong just now?">${icon('alert',15)}What went wrong just now?</button>`:''}</div>`},
 paint(jump){const th=$('#hThread'),sc=$('#hScroll');if(!th)return;if(th!==this._th){this._th=th;this.nodes=[];th.innerHTML=''}
  const list=this.items(),st=this.st;
  if(!list.length){if(!th.querySelector('.chat-empty')||th._e!==this.emptyHtml()){th._e=this.emptyHtml();th.innerHTML=th._e}this.nodes=[];this.bar();return}
  if(th.querySelector('.chat-empty')){th.innerHTML='';this.nodes=[]}
  const atBottom=!sc||sc.scrollHeight-sc.scrollTop-sc.clientHeight<120,hist=this._history;this._history=false;
  list.forEach((t,i)=>{let n=this.nodes[i];const cls=t.role==='notice'?'help-notice msg'+(t.fresh?' fresh':''):'msg '+(t.role==='user'?'user':'ai');
   if(!n){n=document.createElement('div');n.className=cls+(hist?' still':'');th.append(n);this.nodes[i]=n}else if(!n.className.startsWith(cls))n.className=cls+(n.classList.contains('still')?' still':'');
   const h=this.itemHtml(t,i,i===list.length-1);if(n._h!==h){n.innerHTML=h;n._h=h}});
  while(this.nodes.length>list.length)this.nodes.pop().remove();
  if(sc&&(jump||atBottom)){sc.style.scrollBehavior='auto';sc.scrollTop=sc.scrollHeight;requestAnimationFrame(()=>{sc.scrollTop=sc.scrollHeight;sc.style.scrollBehavior=''})}
  this.bar()},
 // the composer: Send or Stop, what is left today when it gets low, closed when Help isn't ready or the limit is reached
 bar(){const b=$('#hSend'),ta=$('#hMsg'),left=$('#hLeft'),hint=$('#hHint'),nw=$('#hNew');if(!b)return;const st=this.st||{},out=st.left===0&&!this.running,off=st.ready===false||out;
  b.classList.toggle('stop',this.running);b.innerHTML=icon(this.running?'stop':'send',18);b.setAttribute('aria-label',this.running?'Stop':'Send');b.title=this.running?'Stop (Esc)':'Send (Enter)';b.disabled=off&&!this.running;
  ta.disabled=off;if(nw){nw.hidden=!this.turns.length||this.running;nw.style.display=nw.hidden?'none':''}
  if(left)left.textContent=st.left!=null&&st.left<=10&&!out?st.left+' of '+st.limit+' left today':'';
  if(hint){const t=out?'You used today’s '+st.limit+' Help messages. Help is back tomorrow; for anything urgent, ask your agent or an admin.':'Help explains aqeelOS and checks what went wrong. It can’t change anything: for that, ask your agent.';if(hint.textContent!==t)hint.textContent=t;hint.classList.toggle('warn-t',out)}},
 async go(text){const ta=$('#hMsg');text=String(text??ta?.value??'').trim();if(!text||this.running)return;if(this.st?.ready===false)return toast(this.st.why||'Help isn’t ready yet','err');
  if(ta&&!arguments.length){ta.value='';this.draft='';ta.style.height='auto'}
  const from=this.from,ai={role:'ai',text:''};this.turns.push({role:'user',text,at:Date.now()/1000},ai);this.running=true;this.paint(true);
  const ctl=new AbortController();this.abort=ctl;
  try{const r=await callRaw('','/ui/help/send',{method:'POST',raw:true,signal:ctl.signal,body:{text,page:from||'(opened Help directly)',pageName:from?this.pageOf(from):'',agent:S.profile||'default',errors:Oops.recent()}});
   if(!r.ok){let d={};try{d=await r.json()}catch{}ai.error=d.error||'Help couldn’t answer ('+r.status+'). Try again in a moment.';ai.limit=!!d.limit;if(d.limit&&this.st)this.st.left=0;return}
   await Chat.readStream(r,e=>{switch(e.type){
    case 'aqeelos.help':if(this.st){this.st.left=e.left;this.st.session=e.session}break;
    case 'run.started':this.runId=e.run_id;break;
    case 'assistant.delta':ai.text+=e.delta||e.text||'';break;
    case 'assistant.completed':{const c=Chat.contentText(e.content||'');if(c&&c.length>=ai.text.length)ai.text=c;break}
    case 'run.failed':ai.error=e.error?.message||e.error||'Help stopped with an error.';break;
    case 'run.cancelled':case 'run.interrupted':ai.text+=(ai.text?'\n\n':'')+'*Stopped.*';break;
    case 'aqeelos.ticket':ai.ticket=e;if(e.ticket){toast(e.dup?'The admins already have this ticket':'Ticket sent to the admins');const l=this.st?.tickets;if(l&&!l.some(x=>x.id===e.ticket.id)){l.unshift(e.ticket);paintSide()}}break}
    cancelAnimationFrame(this._raf);this._raf=requestAnimationFrame(()=>this.paint())})}
  catch(e){if(e.name!=='AbortError'&&!e.stale)ai.error=/network|failed to fetch|load failed/i.test(e.message||'')?'Couldn’t reach aqeelOS. Check your connection, then try again.':e.message||String(e)}
  finally{if(!ai.text&&!ai.error&&ctl.signal.aborted)ai.text='*Stopped.*';this.running=false;this.abort=null;this.runId=null;this.paint()}},
 async stop(){if(!this.running)return;const a=this.abort;try{await post(UI,'/ui/help/stop')}catch{}setTimeout(()=>{if(this.abort===a)a?.abort()},1500)},
 retry(){const u=[...this.turns].reverse().find(t=>t.role==='user');if(!u||this.running)return;const i=this.turns.lastIndexOf(u);this.turns.splice(i);this.go(u.text)},
 async fresh(){if(this.running)return toast('Wait for the answer to finish, or stop it first','err');try{await post(UI,'/ui/help/new');this.turns=[];if(this.st)this.st.session=null;if(!route().help||route().arg?.[0])go('/help');else this.paint();toast('New conversation');$('#hMsg')?.focus()}catch(e){fail(e)}}};
ACT['help-new']=()=>Help.fresh();
ACT['help-retry']=()=>Help.retry();
ACT['help-reload']=()=>Help.load();
ACT['help-ask']=a=>Help.go(a.dataset.q);
// where the person was before opening Help: that is the page Help is asked about
addEventListener('hashchange',e=>{const old='#'+(String(e.oldURL||'').split('#')[1]||'');if(old.length>2&&!/^#\/help(\/|$)/.test(old))Help.from=old.split('?')[0]});
Poll.add(()=>Help.peek(),120000,6000);

/* ---------- Help › Tickets and settings (admins, 1 Nov 2026): the admin side of Help in one place. The tickets people sent
   (Resolve tells them in their Help chat; Not now puts one off a day), a support report for whoever helps (was on
   System › Health) and the Help model and daily limit (were under System › Settings). Bottlenecks only points here. ---------- */
const HelpAdmin={open:0,
 view(v){v.innerHTML=`<div class="page">${head({label:'Tickets and settings',desc:'What people asked admins to fix through Help, a support report for whoever helps you, and the model Help uses.'})}<div id="pg"></div></div>`;const pg=v.querySelector('#pg');
  pg.innerHTML=`<div class="panel card ha-tickets"><h2>Open tickets</h2><p class="sub">Resolve one once it is fixed: the person is told in their Help chat.</p><div id="haList">${skeleton()}</div></div>
   <div class="panel card help-set"><h2>Help model</h2><p class="sub">Everyone uses this model, whatever their role; people’s own model lists and daily limits don’t apply to it.</p><div id="helpSet">${skeleton()}</div></div>
   <div class="panel card ha-report"><div class="bk-head"><div><h2>Support report</h2><p class="sub">System details and the latest logs as links for whoever helps you. They delete themselves after a few hours.</p></div><div class="bk-acts"><button data-act="debug-share">${icon('link',15)}Share a support report</button></div></div></div>`;
  const gone=pageRun(pg);this.tickets(pg.querySelector('#haList'),gone);HelpSet.draw(pg.querySelector('.help-set'),gone)},
 async tickets(box,gone){let d;try{d=await UI('/ui/help/tickets')}catch(e){if(!e.stale&&!gone())box.innerHTML=errLine('the tickets');return}if(gone())return;
  const l=d.items||[];const n=l.filter(t=>!t.later).length;if(n!==this.open){this.open=n;paintSide()}
  const when=t=>new Date(t).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  box.innerHTML=l.length?'<div class="ha-list">'+l.map((t,i)=>`<div class="ha-item${t.later?' later':''}" ${st(Math.min(i,8))}><div class="txt"><b>${esc(t.what)}</b><span class="ha-meta">${esc(t.who)} · ${esc(when(t.at))}${t.page?' · '+esc(t.page):''}${t.count>1?' · sent '+t.count+' times':''}${t.later?' · <span class="chip">Put off until tomorrow</span>':''}</span>${t.said?`<p>“${esc(t.said)}”</p>`:''}${t.checked?`<p class="hint">Help checked: ${esc(t.checked)}</p>`:''}${t.error?`<p class="err-line">${esc(t.error)}</p>`:''}</div><div class="ha-acts"><button class="primary small" data-ha="done" data-id="${esc(t.id)}">Resolve</button>${t.later?'<span aria-hidden="true"></span>':`<button class="ghost small" data-ha="later" data-id="${esc(t.id)}">Not now</button>`}</div></div>`).join('')+'</div>'
   :`<div class="bn-empty">${icon('check',22)}<b>No open tickets</b><p class="hint">When Help can’t fix something for someone, it sends a ticket here.</p></div>`;
  box.onclick=async e=>{const b=e.target.closest('[data-ha]');if(!b)return;b.disabled=true;const it=b.closest('.ha-item');
   try{await post(UI,'/ui/help/tickets/decide',{id:b.dataset.id,how:b.dataset.ha});toast(b.dataset.ha==='done'?'Resolved · they’ll see it in Help':'Put off until tomorrow');
    if(b.dataset.ha==='done'&&it){it.classList.add('out');await new Promise(r=>setTimeout(r,220))}if(typeof Bottlenecks!=='undefined')Bottlenecks.check();if(!gone())this.tickets(box,gone)}catch(er){b.disabled=false;fail(er)}}},
 // the number on Tickets and settings in the Help menu: open tickets not put off
 async peek(){if(!S.signedIn||S.me?.admin===false||document.hidden)return;try{const d=await UI('/ui/help/tickets');const n=(d.items||[]).filter(t=>!t.later).length;if(n!==this.open){this.open=n;paintSide()}}catch{}}};
Poll.add(()=>HelpAdmin.peek(),120000,7000);
// #/help/admin draws the admin side; anyone else (or #/help) gets the conversation
{const view=Help.view.bind(Help);Help.view=v=>{if(route().arg?.[0]==='admin'&&S.me?.admin!==false)return HelpAdmin.view(v);return view(v)}}
// the Help model and the daily message limit, picked from menus
const HelpSet={async draw(box,gone){const host=box.querySelector('#helpSet');let d;try{d=await UI('/ui/help/settings')}catch(e){if(!e.stale&&!gone())host.innerHTML=errLine('the Help settings');return}if(gone())return;
  const cur=d.model?modelLabel(d.model)+' · '+((d.providers||[]).find(x=>x.slug===d.provider)?.name||d.provider):'The main agent’s model'+(d.fallback?.model?' ('+modelLabel(d.fallback.model)+')':'');
  host.innerHTML=`<div class="help-set-row"><div><b>Model</b><p class="hint">Picked from the models the engine offers.</p></div><button type="button" class="sel-btn inline" id="hsModel" aria-haspopup="menu"><span class="sv">${esc(cur)}</span>${icon('chevD',15)}</button></div>
   <div class="help-set-row"><div><b>Messages per person a day</b><p class="hint">Shown to people when they reach it.</p></div><button type="button" class="sel-btn inline" id="hsLimit" aria-haspopup="menu"><span class="sv">${d.limit} a day</span>${icon('chevD',15)}</button></div>`;
  // the page's click handler closes any open menu: these open their own, so the click stops here
  const save=async(body,msg)=>{try{await put(UI,'/ui/help/settings',body);toast(msg);if(!gone())this.draw(box,gone)}catch(e){fail(e)}};
  host.querySelector('#hsModel').onclick=e=>{e.stopPropagation();menu(e.currentTarget,[{label:'The main agent’s model',sub:d.fallback?.model?modelLabel(d.fallback.model):'',on:!d.model,run:()=>save({model:'',provider:''},'Help uses the main agent’s model')},
   ...(d.providers||[]).flatMap(pv=>['-',{header:pv.name},...pv.models.map(m=>({label:modelLabel(m),icon:'cpu',find:pv.name+' '+m,on:d.model===m&&d.provider===pv.slug,run:()=>save({model:m,provider:pv.slug},'Help uses '+modelLabel(m)+' now')}))])],{search:(d.providers||[]).reduce((a,x)=>a+x.models.length,0)>8,matchWidth:true})};
  host.querySelector('#hsLimit').onclick=e=>{e.stopPropagation();menu(e.currentTarget,(d.limits||[]).map(n=>({label:n+' a day',on:n===d.limit,run:()=>save({limit:n},'Help limit: '+n+' messages a day')})),{matchWidth:true})}}};

/* ---------- Share a support report (Help › Tickets and settings; was on System › Health until 1 Nov 2026): the engine uploads system details and recent logs to a public paste site and
   hands back links to send to whoever helps (they delete themselves after a few hours). ---------- */
ACT['debug-share']=()=>{const d=drawer('Share a support report',`<p class="sub" style="margin:0 0 14px">Uploads system details and the latest logs to a public paste site and gives you links to send to whoever helps you. Anyone with a link can read it until it deletes itself.</p><div class="field" style="border:0;padding-top:0"><label>Hide keys and passwords first<small>Recommended. Anything that looks like a key or token is blanked out.</small></label><div>${toggle(true,'Hide keys and passwords','id="dsR"')}</div></div><div id="dsOut"></div>`,`<button class="ghost" data-act="close">Close</button><button class="primary" id="dsGo">${icon('upload',15)}Create links</button>`,{size:'md'});
 const outEl=d.querySelector('#dsOut'),go=d.querySelector('#dsGo');let busy=false;
 go.onclick=async()=>{if(busy)return;const redact=d.querySelector('#dsR').checked;if(!redact&&!await confirmBox('Upload without hiding keys?','Keys and passwords in the logs would be readable by anyone with the link.','Upload anyway'))return;
  busy=true;go.classList.add('is-busy');go.setAttribute('aria-busy','true');outEl.innerHTML='<div class="skel" style="height:96px;border-radius:var(--r-md);margin-top:6px"></div>';
  try{const r=await post(H,'/ops/debug-share',{redact,lines:200});const urls=Object.entries(r.urls||{}),hrs=Math.max(1,Math.round((r.auto_delete_seconds||21600)/3600));
   outEl.innerHTML=`<div class="ds-res"><div class="ds-meta"><span class="chip ok">${icon('check',13)}Uploaded</span>${r.redacted?'<span class="chip">Keys hidden</span>':'<span class="chip warn">Keys not hidden</span>'}<span class="chip">${icon('clock',13)}Deletes itself in ${plural(hrs,'hour')}</span>${urls.length>1?`<button class="ghost" data-ds-copy="${esc(urls.map(([l,u])=>l+': '+u).join('\n'))}">${icon('copy',15)}Copy all</button>`:''}</div>${urls.map(([l,u])=>`<div class="ds-link"><span class="ds-l">${esc(l)}</span><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a><button class="ghost icon" data-ds-copy="${esc(u)}" aria-label="Copy the ${esc(l)} link" title="Copy">${icon('copy',15)}</button></div>`).join('')||'<p class="hint">Nothing was uploaded.</p>'}${(r.failures||[]).length?`<p class="err-line" style="margin:8px 0 0">Some logs could not be uploaded: ${esc(r.failures.join('; '))}</p>`:''}</div>`;
   toast(plural(urls.length,'link')+' ready'+(r.redacted?' · keys hidden':''))}
  catch(e){outEl.innerHTML='';fail(e)}finally{busy=false;go.classList.remove('is-busy');go.removeAttribute('aria-busy')}};
 outEl.addEventListener('click',e=>{const b=e.target.closest('[data-ds-copy]');if(!b)return;copyText(b.dataset.dsCopy,'').then(ok=>{if(!ok)return toast('Couldn’t copy','err');const was=b.innerHTML;b.innerHTML=icon('check',15)+(b.classList.contains('icon')?'':'Copied');setTimeout(()=>{if(b.isConnected)b.innerHTML=was},1500)})})};
