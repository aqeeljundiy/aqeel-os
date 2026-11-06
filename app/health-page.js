/* ---------- System › Health (agreed layout, 18 Oct): Status and Host on one page, put together from the two old
   pages so every control works as before. Agents: what is running and connected (refreshed every 15 s while you
   look). The AI box: resources, what uses RAM, background helpers, maintenance, access. "Recent sessions" is
   left out: the chat list and Manage chats already show it. #/system/status and #/system/host open this page. ---------- */
{const oldStatus=PAGES.status,oldHost=PAGES.host;
 PAGES.health=async(p,el,r)=>{const tok=S._htok=(S._htok||0)+1,stale=()=>tok!==S._htok;
  setActions('');el.innerHTML=`<h2 class="ach-cat" style="margin-top:0">Agents</h2>${S.me?.admin!==false?'<div id="hIssues"></div><div id="hAgents"><div class="skel" style="height:120px;border-radius:18px;margin-bottom:14px"></div></div>':''}<div id="hStatus"><div class="skel" style="height:110px;border-radius:18px"></div></div><h2 class="ach-cat">The AI box</h2><div id="hHost"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;
  const sBox=el.querySelector('#hStatus'),hBox=el.querySelector('#hHost'),aBox=el.querySelector('#hAgents');
  const iBox=el.querySelector('#hIssues');const drawIssues=async()=>{if(!iBox)return;let d;try{d=await UI('/ui/health/issues')}catch{return}if(stale()||!iBox.isConnected)return;HealthIssues.draw(iBox,d,drawIssues)};
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
  const head=bad?'<div class="ah-sum bad">'+icon('alert',16)+'<b>'+(bad===1?'1 needs':bad+' need')+' attention</b><span>Fix what is listed under each one. You get a Telegram message when something new breaks.</span></div>'
   :'<div class="ah-sum ok">'+icon('check',16)+'<b>Every agent is working</b><span>You get a Telegram message if one breaks.</span></div>';
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

/* ---------- Issues and the fixer, and how often the team still went to the main agent (issues.mjs, escalations.mjs,
   6 Nov 2026). Waiting ones have Approve / Decline here too (the owner also gets one message with a link). ---------- */
const HealthIssues={
 ST:{approved:'Fixer will run',fixing:'Being fixed',fixed:'Fixed',waiting:'Waits for your OK',failed:'Fix failed',declined:'Declined',open:'Open'},
 draw(box,d,again){const it=d.items||[],esc2=d.escalations?.agents||{},names={};for(const i of it)names[i.agent]=i.agentName;
  const rows=Object.entries(esc2);const t=(x)=>esc(String(x??''));
  const escHtml=rows.length?'<div class="card list" style="margin-bottom:14px"><div class="list-head">Team had to go to the main agent (this week · last week)</div>'+rows.map(([a,v])=>'<div class="row"><div class="main-c"><div class="txt"><b>'+t(names[a]||a)+'</b><span>'+v.thisWeek+' this week · '+v.lastWeek+' last week'+(v.examples?.length?' — e.g. “'+t(v.examples[0])+'”':'')+'</span></div></div></div>').join('')+'</div>':'';
  const open=it.filter(i=>!['fixed','declined'].includes(i.state)),done=it.filter(i=>['fixed','declined'].includes(i.state)).slice(0,8);
  const row=i=>'<div class="row"><div class="main-c"><div class="txt"><b>'+t(i.agentName)+': '+t(i.missing)+'</b><span>'+t(HealthIssues.ST[i.state]||i.state)+(i.byName?' · asked by '+t(i.byName):'')+' · '+t(i.decision||'')+(i.result?.summary?' · '+t(i.result.summary):'')+'</span>'+(i.state==='waiting'?'<div style="margin-top:6px"><button class="primary small" data-ok="1" data-id="'+t(i.id)+'">Approve</button> <button class="ghost small" data-ok="0" data-id="'+t(i.id)+'">Decline</button></div>':'')+'</div></div></div>';
  box.innerHTML='<h2 class="ach-cat" style="margin-top:0">Issues</h2>'+escHtml+'<div class="card list" style="margin-bottom:22px"><div class="list-head">Problems agents filed outside their own files; the fixer on this server fixes them and answers where they were reported</div>'+(open.length?open.map(row).join(''):'<div class="row"><div class="main-c"><div class="txt"><span>No open issues.</span></div></div></div>')+(done.length?done.map(row).join(''):'')+'</div>';
  box.querySelectorAll('button[data-id]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await UI('/ui/health/issues/decide',{method:'POST',body:JSON.stringify({id:b.dataset.id,ok:b.dataset.ok==='1'})})}catch(e){alert(e.message)}again()})}};
