/* ---------- System › Health (agreed layout, 18 Oct): Status and Host on one page, put together from the two old
   pages so every control works as before. Agents: what is running and connected (refreshed every 15 s while you
   look). The AI box: resources, what uses RAM, background helpers, maintenance, access. "Recent sessions" is
   left out: the chat list and Manage chats already show it. #/system/status and #/system/host open this page. ---------- */
{const oldStatus=PAGES.status,oldHost=PAGES.host;
 PAGES.health=async(p,el,r)=>{const tok=S._htok=(S._htok||0)+1,stale=()=>tok!==S._htok;
  setActions('');el.innerHTML=`<h2 class="ach-cat" style="margin-top:0">Agents</h2>${S.me?.admin!==false?'<div id="hIssues"></div><div id="hCode"></div><div id="hAgents"><div class="skel" style="height:120px;border-radius:18px;margin-bottom:14px"></div></div>':''}<div id="hStatus"><div class="skel" style="height:110px;border-radius:18px"></div></div><h2 class="ach-cat">The AI box</h2><div id="hHost"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;
  const sBox=el.querySelector('#hStatus'),hBox=el.querySelector('#hHost'),aBox=el.querySelector('#hAgents');
  const iBox=el.querySelector('#hIssues');const drawIssues=async()=>{if(!iBox)return;let d;try{d=await UI('/ui/health/issues')}catch{return}if(stale()||!iBox.isConnected)return;HealthIssues.draw(iBox,d,drawIssues);drawCode()};
  const cBox=el.querySelector('#hCode');const drawCode=async()=>{if(!cBox)return;let d;try{d=await UI('/ui/health/code-changes')}catch{return}if(stale()||!cBox.isConnected)return;HealthCode.draw(cBox,d,drawCode)};
  const drawAgents=async()=>{if(!aBox)return;let d;try{d=await UI('/ui/health/agents')}catch(e){if(!stale()&&aBox.isConnected&&aBox.querySelector('.skel'))aBox.innerHTML=alertBox(esc(e.message));return}if(stale()||!aBox.isConnected)return;AgentHealth.draw(aBox,d,drawAgents)};
  // a refresh keeps this page's buttons (the Agents part sets its own as it starts)
  const drawStatus=async()=>{const b=document.createElement('div');b.hidden=true;document.body.append(b);const ha=$('.head-actions'),keep=sBox.querySelector('.skel')?null:ha?.innerHTML;try{const run=oldStatus(p,b,r);if(keep!=null&&ha.isConnected)ha.innerHTML=keep;await run}catch(e){b.remove();throw e}
   if(stale()||!sBox.isConnected){b.remove();return}clearTimeout(Pages._statusT);
   for(const l of b.querySelectorAll('.card.list'))if(/Recent sessions/.test(l.querySelector('.list-head')?.textContent||''))l.remove();
   // the version is in the engine updates card below (1 Nov 2026), so the Agents part does not repeat it
   for(const c of b.querySelectorAll('.stats .stat'))if(c.querySelector('.th')?.textContent==='Version')c.remove();
   b.querySelectorAll('.two').forEach(t=>{if(t.children.length===1)t.classList.remove('two')});
   // the 15-second refresh swaps in new cards: only the first draw plays the entrance animation
   if(!sBox.querySelector('.skel'))b.querySelectorAll('.stat,.row,.card,.panel').forEach(x=>x.style.animation='none');b.hidden=false;sBox.replaceChildren(b)};
  const hb=document.createElement('div');hb.hidden=true;document.body.append(hb);
  drawIssues();await Promise.all([drawAgents(),drawStatus(),oldHost(p,hb,r).then(()=>{if(stale()){hb.remove();return}hb.hidden=false;hBox.replaceChildren(hb)},e=>{hb.remove();hBox.innerHTML=alertBox(esc(e.message))})]);
  if(stale())return;
  // one button here (1 Nov 2026): Restart is in Start and stop agents, Check again in the engine updates card
  setActions(S.me?.admin!==false?`<button data-act="console-open" title="Type the engine’s own commands">${icon('terminal',16)}Engine console</button>`:'');
  // agents and channels change often: refresh that part only, while the page is open and visible
  const tick=()=>{clearTimeout(Pages._healthT);Pages._healthT=setTimeout(async()=>{if(stale()||route().page?.id!=='health')return;if(!document.hidden)await Promise.all([drawStatus().catch(()=>{}),drawAgents().catch(()=>{})]);tick()},15000)};tick()}}

/* ---------- Each agent's health (agent-health.mjs, 5 Nov 2026): working, or what is wrong with the fix for it (the same
   items and buttons as Bottlenecks), and its failed messages this week when there were any. Broken ones first. ---------- */
const AgentHealth={
 dropLine(d){if(!d||!d.n)return '';const saved=d.recovered?', '+d.recovered+' answered after trying again by itself':'';
  return d.n+' failed message'+(d.n===1?'':'s')+' this week'+saved+(d.failed&&d.top?'. Mostly: '+(AgentHealth.REASON[d.top]||String(d.top).replace(/_/g,' ')):'')},
 REASON:{rate_limit:'the AI model was busy',upstream_rate_limit:'the AI model was busy',overloaded:'the AI model was busy',server_error:'the AI model did not answer',timeout:'the AI model did not answer in time',gateway_connection:'the connection to the AI model broke',empty_response:'the AI model sent an empty answer',auth:'the AI account needs signing in again',auth_permanent:'the AI account needs signing in again',billing:'the AI account is out of credit',context_overflow:'the chat grew too long',interpreter_shutdown:'the system restarted mid-reply',loop_error:'something went wrong while answering',unknown:'the cause was not recorded'},
 draw(box,d,again){const rows=d.agents||[],bad=rows.filter(r=>!r.ok).length,first=!!box.querySelector('.skel');
  const head=bad?'<div class="ah-sum bad">'+icon('alert',16)+'<b>'+(bad===1?'1 needs':bad+' need')+' attention</b><span>Each problem goes to the fixer, which fixes and proves it by itself. A person hears only when a fix needs one.</span></div>'
   :'<div class="ah-sum ok">'+icon('check',16)+'<b>Every agent is working</b><span>If one breaks, the fixer works on it by itself. You hear only when a fix needs you.</span></div>';
  box.innerHTML=head+'<div class="card list ah-list">'+rows.map((r,i)=>{const dl=AgentHealth.dropLine(r.drops);
   return '<div class="row ah-row'+(r.ok?'':' bad')+'"'+(first?' style="animation-delay:'+Math.min(i,8)*30+'ms"':'')+'><div class="main-c"><i class="ah-dot'+(r.ok?' ok':'')+'"></i><div class="txt"><b>'+esc(r.name)+'</b><span>'+(r.ok?'Working':r.problems.length===1?'1 problem':r.problems.length+' problems')+(dl?' · '+esc(dl):'')+'</span>'+
    (r.ok?'':'<div class="ah-probs">'+r.problems.map((x,j)=>'<div class="ah-p"><i class="bn-ic bn-'+esc(x.kind)+'">'+icon(Bottlenecks.icon[x.kind]||'alert',15)+'</i><div><b>'+esc(x.kind==='report'?'Blocked: '+(x.missing||x.title):x.title)+'</b>'+(x.text?'<p>'+esc(x.text)+'</p>':'')+'<div class="bn-acts" data-r="'+i+'" data-j="'+j+'"></div></div></div>').join('')+'</div>')+'</div></div></div>'}).join('')+'</div>';
  if(!first)box.querySelectorAll('.row').forEach(x=>x.style.animation='none');
  box.querySelectorAll('.bn-acts').forEach(b=>{const x=rows[+b.dataset.r].problems[+b.dataset.j];for(const [label,run,primary] of Bottlenecks.actions({...x,agentName:x.agentName||rows[+b.dataset.r].name})){const btn=document.createElement('button');btn.type='button';btn.className=primary?'primary small':'ghost small';btn.textContent=label;
   btn.onclick=async()=>{btn.disabled=true;try{await run();await Bottlenecks.check();await again()}catch(e){btn.disabled=false;fail(e)}};b.append(btn)}})}};


/* ---------- Engine console (admins): the engine's own commands, one at a time, its answers shown as they come.
   This server relays it and refuses shell, chat and server commands (app/engine-console.mjs). ---------- */
const EngConsole={hist:[]};
// the engine's own name and colour codes never reach the screen
const conText=t=>String(t??'').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/\x1b\][^\x07]*\x07/g,'').replace(/\r(?!\n)/g,'').replace(/(^|\n|[.!?]\s+)Hermes Agent\b/g,'$1The engine').replace(/\bHermes Agent\b/g,'the engine').replace(/\bHermes\b/g,Brand.name).replace(/\bhermes(?=[ >-])/g,Brand.name.toLowerCase());
ACT['console-open']=()=>{if(S.me?.admin===false)return toast('Only admins can use the engine console.','err');
 const ag=agentProfile()||S.profile||'default',name=ident(ag).name;
 const d=drawer('Engine console',`<div class="con-bar"><span class="chip" id="conSt"><i class="dot"></i>Connecting</span><span class="con-for">For ${esc(name)}${S.viewAll?', the agent you chat with':''}</span><button class="ghost" id="conRe" hidden>${icon('refresh',15)}Reconnect</button></div><div class="con-out" id="conOut" role="log" aria-live="polite"></div><div class="con-in"><span id="conPr">engine&gt;</span><input id="conIn" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Command"></div><p class="hint">Enter runs it · ↑ ↓ earlier commands · Ctrl+C stops · Ctrl+L clears. The engine’s own commands only, no shell.</p>`,`<button class="primary" data-act="close">Done</button>`,{size:'lg'});
 const out=d.querySelector('#conOut'),inp=d.querySelector('#conIn'),pr=d.querySelector('#conPr'),stEl=d.querySelector('#conSt'),re=d.querySelector('#conRe');
 let ws=null,state='connecting',pending=null,hi=null,prompt='engine>',told=false,beat=0;
 const STATES={connecting:['','Connecting'],ready:['ok','Ready'],running:['warn','Running'],closed:['','Closed'],error:['bad','Not connected']};
 const setSt=s=>{state=s;const [c,l]=STATES[s];stEl.className='chip '+c;stEl.innerHTML='<i class="dot"></i>'+esc(l);re.hidden=!(s==='closed'||s==='error');inp.readOnly=s!=='ready';inp.placeholder=s==='running'?'Running… Ctrl+C stops it':s==='ready'?(pending!=null?'Type y to go ahead, anything else cancels':'Type a command, for example config show'):'';if(s==='ready')inp.focus()};
 const linkify=h=>h.replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<>"'])+/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
 const write=(t,cls='')=>{const atEnd=out.scrollHeight-out.scrollTop-out.clientHeight<40;for(const l of conText(t).replace(/\n$/,'').split('\n')){const r=document.createElement('div');if(cls)r.className=cls;r.innerHTML=linkify(esc(l))||'&nbsp;';out.append(r)}while(out.childElementCount>3000)out.firstElementChild.remove();if(atEnd)out.scrollTop=out.scrollHeight};
 const frame=f=>{
  if(f.type==='ready'){prompt=conText(f.prompt||'engine> ').trim()||'engine>';pr.textContent=prompt;out.innerHTML='';write('Connected for '+name+'. Type a command and press Enter.','d');setSt('ready');return}
  if(f.type==='output'){if(f.data)write(f.data,f.stream==='stderr'?'w':'');return}
  if(f.type==='error'){told=true;write(f.message||'The command failed.','e');return}
  if(f.type==='confirm_required'){pending=String(f.command||'');if(f.message)write(f.message,'w');pr.textContent='Go ahead? y/N';setSt('ready');return}
  if(f.type==='complete'){if(f.prompt)prompt=conText(f.prompt).trim()||prompt;if(f.status==='confirm_required')return;if(f.status==='exit'){setSt('closed');write('Console closed.','d');ws?.close();return}
   if(f.status==='timeout')write('The command took too long and was stopped.','e');if(f.status==='cancelled')write('Cancelled.','w');pending=null;pr.textContent=prompt;setSt('ready');return}
  if(f.type==='clear')out.innerHTML=''};
 const send=o=>{if(ws?.readyState!==1)return false;ws.send(JSON.stringify(o));return true};
 const connect=()=>{try{ws?.close()}catch{}ws=null;pending=null;told=false;setSt('connecting');write('Connecting…','d');
  const w=ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ui/console/ws?agent='+encodeURIComponent(ag));
  w.onmessage=e=>{if(ws!==w)return;let f;try{f=JSON.parse(e.data)}catch{return write('The engine sent something the console could not read.','e')}frame(f)};
  w.onclose=()=>{if(ws!==w)return;ws=null;pending=null;pr.textContent=prompt;if(state==='closed')return;if(!told)write(state==='connecting'?'The console could not connect. Check that the agents are running, then press Reconnect.':'The console lost its connection. Press Reconnect to try again.','e');setSt('error')}};
 re.onclick=connect;connect();
 // closing the window ends the connection; a ping every 20 s keeps an idle one open
 const t=setInterval(()=>{if(!d.isConnected){clearInterval(t);const w=ws;ws=null;try{w?.close()}catch{}return}if(++beat%20===0)send({type:'ping'})},1000);
 inp.onkeydown=e=>{const k=e.key.toLowerCase();
  if(e.ctrlKey&&k==='l'){e.preventDefault();out.innerHTML='';return}
  if(e.ctrlKey&&k==='c'&&!getSelection().toString()&&inp.selectionStart===inp.selectionEnd){e.preventDefault();write(pr.textContent+' '+inp.value+'^C','d');if(state==='running'||pending!=null){pending=null;send({type:'cancel'})}inp.value='';hi=null;return}
  if(k==='arrowup'||k==='arrowdown'){const h=EngConsole.hist;if(!h.length||state!=='ready'||pending!=null)return;e.preventDefault();
   if(k==='arrowup')hi=hi==null?h.length-1:Math.max(0,hi-1);else{if(hi==null)return;if(++hi>=h.length){hi=null;inp.value='';return}}inp.value=h[hi];requestAnimationFrame(()=>inp.setSelectionRange(inp.value.length,inp.value.length));return}
  if(k==='enter'){e.preventDefault();if(state!=='ready')return;const line=inp.value.trim();inp.value='';hi=null;write(pr.textContent+' '+line,'cmd');
   if(pending!=null){const c=pending;pending=null;pr.textContent=prompt;if(/^(y|yes)$/i.test(line)){setSt('running');send({type:'confirm',command:c})}else{setSt('running');send({type:'cancel'})}return}
   if(!line)return;EngConsole.hist=[...EngConsole.hist.filter(x=>x!==line),line].slice(-200);setSt('running');if(!send({type:'input',line})){write('The console is not connected.','e');setSt('error')}}}};

/* ---------- Issues and the fixer, and how often the team still went to the main agent (issues.mjs, escalations.mjs).
   Since 7 Nov 2026 nobody approves: the fixer fixes, reloads safely and proves it. Only "needs a person" and "stuck"
   reach someone; both have Try again here for when that person has done their part. ---------- */
// code changes on the box that git does not have yet (code-changes.mjs): what a deploy found changed before it unpacked,
// and proven fixer changes to aqeelOS's own code. Shown only when there is one; each waits for a coding session to take
// it into git, then "Taken into git" clears it.
const HealthCode={
 draw(box,d,again){const it=d.items||[],t=x=>esc(String(x??''));if(!it.length){box.innerHTML='';return}
  const when=ms=>new Date(ms).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const files=f=>f.length?f.slice(0,4).join(', ')+(f.length>4?' and '+(f.length-4)+' more':''):'no file names';
  const row=c=>'<div class="row" data-cc="'+t(c.kind+'/'+c.name)+'"><div class="main-c"><div class="txt"><b>'+(c.kind==='drift'?'Changed on the box before a deploy':'Fixer change to code, issue '+t(c.issue))+'</b><span>'+t(files(c.files))+' · '+t(when(c.at))+'</span>'+
   (c.kind==='drift'?'<span>The deploy saved this before it put the files from git in place. If it is a fix, take it into git or it stays lost.</span>':'')+
   '<div class="hi-acts"><button class="ghost small" data-cc-act="view" data-kind="'+t(c.kind)+'" data-name="'+t(c.name)+'">View</button><button class="ghost small" data-cc-act="done" data-kind="'+t(c.kind)+'" data-name="'+t(c.name)+'">Taken into git</button></div></div></div></div>';
  box.innerHTML='<div class="card list" style="margin-bottom:22px"><div class="list-head"><span>Code changes git does not have yet. A coding session takes each into git; the next deploy would otherwise put the old files back.</span></div>'+it.map(row).join('')+'</div>';
  if(HealthCode.drawn)box.querySelectorAll('.row').forEach(x=>x.style.animation='none');HealthCode.drawn=true;
  box.querySelectorAll('button[data-cc-act]').forEach(b=>b.onclick=async()=>{const k=b.dataset.kind,n=b.dataset.name;
   if(b.dataset.ccAct==='view'){let r;try{r=await UI('/ui/health/code-changes?kind='+encodeURIComponent(k)+'&name='+encodeURIComponent(n))}catch(e){toast(e.message,'err');return}
    const d=drawer(n,'<pre class="cc-patch">'+t(r.text)+'</pre>','<button class="ghost" id="ccCopy">'+icon('copy',15)+'Copy</button><button class="primary" data-act="close">Done</button>',{size:'lg'});
    d.querySelector('#ccCopy').onclick=async()=>{const ok=await copyText(r.text,'');toast(ok?'Copied.':'Could not copy.',ok?undefined:'err')};return}
   if(!await confirmBox('Taken into git?','It leaves this list. The file stays on the box in the done folder.','Taken into git',false))return;
   b.disabled=true;try{await post(UI,'/ui/health/code-changes/done',{kind:k,name:n});toast('Cleared.')}catch(e){b.disabled=false;toast(e.message,'err');return}
   const row=b.closest('.row');if(!calm()&&row){row.style.animation='cardOut 180ms var(--ease) both';await new Promise(r=>setTimeout(r,180))}again()})}};
const HealthIssues={
 ST:{queued:'Queued',fixing:'Being fixed',applying:'Waiting to reload safely',rollback:'Putting the change back',verify:'Proof run next',verifying:'Proving the fix','reloaded-back':'Put back',
  fixed:'Fixed and proven',needs_human:'Needs a person',stuck:'Stuck after 3 tries',gone:'Resolved by itself',expired:'Closed after 7 days',open:'Waiting (fixer off)',declined:'Declined',failed:'Fix failed',closed:'Closed',stopped:'Stopped retrying',deploy:'Fix waits for the daily deploy'},
 END:['fixed','declined','gone','closed','expired'],RUN:['fixing','applying','verify','verifying','rollback','reloaded-back'],
 draw(box,d,again){const it=d.items||[],esc2=d.escalations?.agents||{},names={};for(const i of it)names[i.agent]=i.agentName;HealthIssues.agents=d.agents||[];
  const rows=Object.entries(esc2);const t=(x)=>esc(String(x??''));const cut=(x,n)=>{x=String(x||'');return x.length>n?x.slice(0,n)+'…':x};
  const escHtml=rows.length?'<div class="card list" style="margin-bottom:14px"><div class="list-head">Team had to go to the main agent (this week · last week)</div>'+rows.map(([a,v])=>'<div class="row"><div class="main-c"><div class="txt"><b>'+t(names[a]||a)+'</b><span>'+v.thisWeek+' this week · '+v.lastWeek+' last week'+(v.examples?.length?', e.g. “'+t(v.examples[0])+'”':'')+'</span></div></div></div>').join('')+'</div>':'';
  const END=HealthIssues.END,RUN=HealthIssues.RUN,open=it.filter(i=>!END.includes(i.state)),done=it.filter(i=>END.includes(i.state)).slice(0,8);
  const from=i=>i.source==='health'?'found by Health':i.byName?'asked by '+i.byName:'filed by the agent';
  const btn=(k,id,label)=>'<button class="ghost small" data-iss="'+k+'" data-id="'+t(id)+'">'+label+'</button>';
  const row=i=>{const bits=[HealthIssues.ST[i.state]||i.state];if(i.tries&&!END.includes(i.state)&&i.state!=='stopped')bits.push('try '+i.tries+' of 3');bits.push(from(i));
   if(RUN.includes(i.state)&&i.noRetry)bits.push(i.closeAfter?'closes after this try':'stops after this try');
   const note=i.state==='fixed'&&i.proof?'Proof: '+cut(i.proof,240):['needs_human','stuck'].includes(i.state)&&i.need?'Needs: '+i.need+(i.told?' (told '+i.told+')':''):i.result?.summary?cut(i.result.summary,240):'';
   const patch=i.patch?'<span>Code change saved as '+t(i.patch)+' until it is in git.</span>':'';
   const acts=END.includes(i.state)?'':[['needs_human','stuck','stopped'].includes(i.state)?btn('retry',i.id,'Try again'):'',(i.state==='queued'||RUN.includes(i.state))&&!i.noRetry?btn('stop',i.id,'Stop retrying'):'',!i.closeAfter?btn('close',i.id,'Close'):''].join('');
   return '<div class="row" data-row="'+t(i.id)+'"><div class="main-c"><div class="txt"><b>'+t(i.agentName)+': '+t(i.missing)+'</b><span>'+t(bits.join(' · '))+'</span>'+(note?'<span>'+t(note)+'</span>':'')+patch+
    (acts?'<div class="hi-acts">'+acts+'</div>':'')+'</div></div></div>'};
  const fx=d.policy?.fixer||{},who=(d.policy?.teams||[]).map(x=>x.name+': '+(x.contact||'the owner')).join(' · ');
  const head=fx.on===false?'<span>The fixer is switched off, so these wait.</span><a href="#/system/teams">Switch it on</a>':'<span>The fixer on this server fixes these by itself and proves each fix. A person hears only when a fix needs one'+(who?' ('+t(who)+')':'')+'.</span><a href="#/system/teams">Teams</a>';
  box.innerHTML='<div class="hi-top"><h2 class="ach-cat" style="margin:0">Issues</h2><button class="ghost" data-iss="report">'+icon('plus',15)+'Report an issue</button></div>'+escHtml+'<div class="card list" style="margin-bottom:22px"><div class="list-head">'+head+'</div>'+(open.length?open.map(row).join(''):'<div class="row"><div class="main-c"><div class="txt"><span>No open issues.</span></div></div></div>')+(done.length?done.map(row).join(''):'')+'</div>';
  if(HealthIssues.drawn)box.querySelectorAll('.row').forEach(x=>x.style.animation='none');HealthIssues.drawn=true;
  box.querySelectorAll('button[data-iss]').forEach(b=>b.onclick=async()=>{const k=b.dataset.iss;if(k==='report')return HealthIssues.report(again);
   if(k==='close'&&!await confirmBox('Close this issue?','The fixer stops working on it. If it is in the middle of a try, it closes when that try ends.','Close issue',false))return;
   b.disabled=true;try{const r=await post(UI,'/ui/health/issues/'+k,{id:b.dataset.id});
    toast(k==='retry'?'The fixer tries again.':k==='stop'?(r.after?'It stops after this try.':'Stopped. Try again starts it over.'):(r.after?'It closes when this try ends.':'Closed.'))}catch(e){b.disabled=false;toast(e.message,'err');return}
   const row=b.closest('.row');if(k==='close'&&!calm()&&row){row.style.animation='cardOut 180ms var(--ease) both';await new Promise(r=>setTimeout(r,180))}again()})},
 // a person files one for the fixer: which agent, what is wrong, what they saw
 async report(again){let ags=HealthIssues.agents;if(!ags?.length){try{ags=(await UI('/ui/teams')).agents}catch{ags=[]}}
  const cur=agentProfile()||S.profile||'default';
  const d=drawer('Report an issue',`<p class="hint" style="margin-top:0">The fixer looks into it by itself, fixes it, reloads safely and proves the fix. You hear only if it needs you.</p>
   <label for="riA">Agent</label><select id="riA">${ags.map(a=>`<option value="${esc(a.id)}"${a.id===cur?' selected':''}>${esc(a.name)}</option>`).join('')}</select>
   <label for="riM">What is wrong</label><textarea id="riM" rows="3" maxlength="500" placeholder="Rory stopped answering on WhatsApp since this morning"></textarea>
   <label for="riE">What you saw (optional)</label><textarea id="riE" rows="3" maxlength="2000" placeholder="The customer wrote at 09:12 and got no reply"></textarea><p class="km-err"></p>`,
   `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="riGo">Report</button>`);
  d.querySelector('#riGo').onclick=async e=>{const b=e.currentTarget,err=d.querySelector('.km-err'),m=d.querySelector('#riM').value.trim();if(!m){err.textContent='Say what is wrong.';return}
   b.disabled=true;try{const r=await post(UI,'/ui/health/issues/report',{agent:d.querySelector('#riA').value,missing:m,evidence:d.querySelector('#riE').value.trim()});closeLayers();
    toast(r.again?'Already reported: added to that issue.':r.state==='open'?'Reported. The fixer is off, so it waits.':'Reported. The fixer is on it.');again()}catch(x){err.textContent=x.message;b.disabled=false}}}};
