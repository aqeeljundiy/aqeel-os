/* ---------- System › Health (agreed mock-up, 11 Nov 2026, HEALTH-1 to 9): one verdict on top, then Now and History.
   Now: Needs you (only what a person must do, grouped), the fixer (what it does now, why the rest waits, its line with
   move, skip and pause), code changes, every agent with the memory it uses, the AI box's status, this week's cost by
   agent and by person, and the AI box itself. History: what was fixed, resolved by itself or closed. Agents, status and
   the fixer refresh every 15 s while you look. #/system/status and #/system/host open this page. ---------- */
{const oldStatus=PAGES.status,oldHost=PAGES.host;
 PAGES.health=async(p,el,r)=>{const tok=S._htok=(S._htok||0)+1,stale=()=>tok!==S._htok,admin=S.me?.admin!==false,V={};
  const sk=h=>'<div class="skel" style="height:'+h+'px;border-radius:18px;margin-bottom:14px"></div>',hist=admin&&S.tab.health==='History';
  setActions('');el.innerHTML=admin?'<div id="hVerdict">'+sk(104)+'</div>'+tabs('health',['Now','History'],hist?'History':'Now')+'<div id="hNow"'+(hist?' hidden':'')+'><div id="hNeed"></div><div id="hFixer"></div><div id="hCode"></div><h2 class="ach-cat">Agents</h2><div id="hAgents">'+sk(120)+'</div><div id="hStatus">'+sk(110)+'</div><div id="hCost"></div><div id="hEsc"></div><h2 class="ach-cat">The AI box</h2><div id="hHost">'+sk(160)+'</div></div><div id="hHist"'+(hist?'':' hidden')+'></div>'
   :'<h2 class="ach-cat" style="margin-top:0">Agents</h2><div id="hStatus">'+sk(110)+'</div><h2 class="ach-cat">The AI box</h2><div id="hHost">'+sk(160)+'</div>';
  const q=s=>el.querySelector(s),sBox=q('#hStatus'),hBox=q('#hHost'),aBox=q('#hAgents'),vBox=q('#hVerdict');
  // Now and History switch in place (the tab bar's pill slides; the page is not drawn again)
  q('[data-tabs=health]')?.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;const h=b.dataset.tab==='History';
   for(const [x,on] of [[q('#hNow'),!h],[q('#hHist'),h]]){if(!x||x.hidden===!on)continue;x.hidden=!on;if(on&&!calm()){x.style.animation='none';x.offsetWidth;x.style.animation='viewIn 260ms var(--ease) both'}}});
  const verdict=()=>{if(vBox&&!stale()&&vBox.isConnected)HealthVerdict.draw(vBox,V)};
  const drawIssues=async()=>{if(!q('#hNeed'))return;let d;try{d=await UI('/ui/health/issues')}catch{return}if(stale()||!el.isConnected)return;V.iss=d;
   HealthIssues.draw({need:q('#hNeed'),fixer:q('#hFixer'),hist:q('#hHist'),esc:q('#hEsc')},d,drawIssues);verdict()};
  HealthIssues.again=drawIssues;
  const cBox=q('#hCode');const drawCode=async()=>{if(!cBox)return;let d;try{d=await UI('/ui/health/code-changes')}catch{return}if(stale()||!cBox.isConnected)return;HealthCode.draw(cBox,d,drawCode)};
  const drawAgents=async()=>{if(!aBox)return;let d,m;try{[d,m]=await Promise.all([UI('/ui/health/agents'),UI('/ui/health/memory').catch(()=>null)])}catch(e){if(!stale()&&aBox.isConnected&&aBox.querySelector('.skel'))aBox.innerHTML=alertBox(esc(e.message));V.ag={failed:true};verdict();return}
   if(stale()||!aBox.isConnected)return;V.ag=d;V.mem=m;AgentHealth.draw(aBox,d,drawAgents,m);verdict()};
  const drawCost=async()=>{const b=q('#hCost');if(!b)return;let d;try{d=await UI('/ui/health/cost')}catch{return}if(stale()||!b.isConnected)return;HealthCost.draw(b,d)};
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
  drawIssues();drawCode();drawCost();await Promise.all([drawAgents(),drawStatus(),oldHost(p,hb,r).then(()=>{if(stale()){hb.remove();return}hb.hidden=false;hBox.replaceChildren(hb)},e=>{hb.remove();hBox.innerHTML=alertBox(esc(e.message))})]);
  if(stale())return;
  // Report an issue and the engine console (1 Nov 2026: Restart is in Start and stop agents, Check again in the engine updates card)
  setActions(admin?`<button data-act="issue-report">${icon('plus',16)}Report an issue</button><button data-act="console-open" title="Type the engine’s own commands">${icon('terminal',16)}Engine console</button>`:'');
  // agents, channels and the fixer change often: refresh those, while the page is open and visible
  const tick=()=>{clearTimeout(Pages._healthT);Pages._healthT=setTimeout(async()=>{if(stale()||route().page?.id!=='health')return;if(!document.hidden)await Promise.all([drawStatus().catch(()=>{}),drawAgents().catch(()=>{}),drawIssues().catch(()=>{}),q('#hCost')?.dataset.drawn?null:drawCost()]);tick()},15000)};tick()}}
ACT['issue-report']=()=>HealthIssues.report(HealthIssues.again||(()=>{}));

/* ---------- the verdict (HEALTH-1): one sentence, "Everything is patched and working" or exactly what needs you, then a
   short line of facts. Made from what the parts below already loaded. ---------- */
const HealthVerdict={
 draw(box,V){const iss=V.iss,ag=V.ag,mem=V.mem;if(!iss&&!ag)return;
  const f=iss?.fixer||{},need=iss?HealthIssues.needGroups(iss.items||[]):[],line=(f.line||[]).length+(f.now?1:0)+(f.wait?1:0);
  const rows=(ag?.agents||[]).filter(r=>r.agent),bad=rows.filter(r=>!r.ok).length,grow=Object.entries(mem?.agents||{}).filter(([,m])=>m.growing).map(([a])=>mem.names?.[a]||ident(a).name);
  const n=need.length,pl=(k,one,many)=>k===1?one:k+' '+many;
  let head,sub=[],tone='ok';
  if(n){tone='need';head=(n===1?'1 thing needs':n+' things need')+' you.'+(line?' The fixer handles the rest.':'');
   sub.push(need.slice(0,2).map(g=>g.title).join('; ')+(n>2?'; and '+(n-2)+' more':'')+'.')}
  else if(f.paused){tone='need';head='Nothing needs you. The fixer is paused'+(line?' with '+pl(line,'problem','problems')+' in line':'')+'.';sub.push('Press Resume on the fixer when it may go on.')}
  else if(f.on===false){tone='need';head='Nothing needs you, but the fixer is switched off.';sub.push('New problems wait until it is on again (System › Teams).')}
  else if(line){tone='work';head='Nothing needs you. The fixer is working on '+pl(line,'problem','problems')+'.';sub.push(HealthIssues.waitLine(f)||'You hear only if one turns out to need a person.')}
  else if(bad){tone='work';head=pl(bad,'agent has','agents have')+' a problem. The fixer looks at it by itself.'}
  else head='Everything is patched and working.';
  if(!n&&!line&&grow.length){tone=tone==='ok'?'work':tone;sub.push(grow.join(', ')+(grow.length===1?'’s memory keeps':' keep')+' growing (see Agents).')}
  if(tone==='ok')sub.push(rows.length?'Every agent answers and nothing waits for a fix.':'Nothing waits for a fix.');
  const facts=[];if(rows.length)facts.push([bad?'a':'g',(rows.length-bad)+' of '+rows.length+' agents working']);
  if(f.now)facts.push(['b','Fixer: '+(f.now.step==='prove'?'proving a fix':'fixing')]);else if(f.paused)facts.push(['a','Fixer paused']);else if(f.wait&&!f.wait.quiet)facts.push(['a','Fixer waits for quiet hours']);else if(line)facts.push(['b','Fixer: '+line+' in line']);else facts.push(['g','Fixer: nothing in line']);
  if(f.cap&&f.cap.used>=f.cap.cap)facts.push(['a','All '+f.cap.cap+' fix runs used today']);
  if(n)facts.push(['a',pl(n,'thing needs you','things need you')]);
  if(mem)facts.push(grow.length?['a',pl(grow.length,'agent’s memory keeps growing','agents’ memory keeps growing')]:['g','Memory steady']);
  const key=tone+'|'+head;const again=box.dataset.k===key;box.dataset.k=key;
  box.innerHTML='<section class="hv '+(tone==='ok'?'ok':tone==='need'?'need':'work')+'"'+(again?' style="animation:none"':'')+' aria-live="polite"><span class="hv-ic">'+icon(tone==='ok'?'check':tone==='need'?'alert':'activity',20)+'</span><div class="hv-t"><h2>'+esc(head)+'</h2>'+(sub.length?'<p>'+esc(sub.join(' '))+'</p>':'')+
   '<div class="hv-f">'+facts.map(([c,t])=>'<span><i class="'+c+'"></i>'+esc(t)+'</span>').join('')+'</div></div></section>'},
 // a small line of the last days (and now), drawn to its own scale
 spark(v,warn){v=(v||[]).filter(x=>x>0);if(v.length<2)return '';const w=96,h=26,mx=Math.max(...v)*1.04,mn=Math.min(...v)*.92;
  const pts=v.map((x,i)=>[2+i*(w-4)/(v.length-1),h-3-(x-mn)/((mx-mn)||1)*(h-6)]),l='M'+pts.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L'),e=pts.at(-1);
  return '<svg class="hv-spark'+(warn?' warn':'')+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"><path class="f" d="'+l+'L'+e[0].toFixed(1)+' '+h+'L2 '+h+'Z"/><path class="l" d="'+l+'"/><circle cx="'+e[0].toFixed(1)+'" cy="'+e[1].toFixed(1)+'" r="2.4"/></svg>'}};

/* ---------- Each agent's health (agent-health.mjs, 5 Nov 2026): working, or what is wrong with the fix for it (the same
   items and buttons as Bottlenecks), and its failed messages this week when there were any. Broken ones first.
   11 Nov 2026 (HEALTH-6): the memory each agent's programs hold, its last 7 days, and a warning when it keeps growing. ---------- */
const AgentHealth={
 dropLine(d){if(!d||!d.n)return '';const saved=d.recovered?', '+d.recovered+' answered after trying again by itself':'';
  return d.n+' failed message'+(d.n===1?'':'s')+' this week'+saved+(d.failed&&d.top?'. Mostly: '+(AgentHealth.REASON[d.top]||String(d.top).replace(/_/g,' ')):'')},
 REASON:{rate_limit:'the AI model was busy',upstream_rate_limit:'the AI model was busy',overloaded:'the AI model was busy',server_error:'the AI model did not answer',timeout:'the AI model did not answer in time',gateway_connection:'the connection to the AI model broke',empty_response:'the AI model sent an empty answer',auth:'the AI account needs signing in again',auth_permanent:'the AI account needs signing in again',billing:'the AI account is out of credit',context_overflow:'the chat grew too long',interpreter_shutdown:'the system restarted mid-reply',loop_error:'something went wrong while answering',unknown:'the cause was not recorded'},
 memWarn(name,g,mem){const lim=mem?.limit,used=mem?.used,left=lim&&used&&g.perDay>0?Math.ceil((lim-used)/g.perDay):null;
  return esc(name)+'’s memory grew every day for '+g.days+' days, from '+bytes(g.from)+' to '+bytes(g.to)+', and has not come back down.'+(left!=null&&left<=30?' At this pace the AI box ('+bytes(lim)+') is full in about '+left+' day'+(left===1?'':'s')+'.':'')},
 draw(box,d,again,mem){const rows=d.agents||[],first=!!box.querySelector('.skel'),M=mem?.agents||{};
  const head=mem?'<p class="hint ah-hint">What each agent’s programs hold in memory now, and its last 7 days. The main agent’s line includes the engine.</p>':'';
  box.innerHTML=head+'<div class="card list ah-list">'+rows.map((r,i)=>{const dl=AgentHealth.dropLine(r.drops),m=r.agent?M[r.agent]:null,g=m?.growing;
   const memH=m&&m.now?'<div class="ah-mem'+(g?' warn':'')+'">'+((m.days||[]).length>=2?HealthVerdict.spark([...m.days,m.now],!!g):'')+'<span><b>'+bytes(m.now)+'</b><small>'+(g?'+'+bytes(g.to-g.from)+' in '+g.days+' days':(m.days||[]).length>=2?'last '+m.days.length+' days':'now')+'</small></span></div>':'';
   return '<div class="row ah-row'+(r.ok?'':' bad')+'"'+(first?' style="animation-delay:'+Math.min(i,8)*30+'ms"':'')+'><div class="main-c"><i class="ah-dot'+(r.ok?' ok':'')+'"></i><div class="txt"><b>'+esc(r.name)+'</b><span>'+(r.ok?'Working':r.problems.length===1?'1 problem':r.problems.length+' problems')+(dl?' · '+esc(dl):'')+'</span>'+
    (g?'<div class="ah-warn">'+icon('alert',15)+'<span>'+AgentHealth.memWarn(r.name,g,mem)+'</span></div>':'')+
    (r.ok?'':'<div class="ah-probs">'+r.problems.map((x,j)=>'<div class="ah-p"><i class="bn-ic bn-'+esc(x.kind)+'">'+icon(Bottlenecks.icon[x.kind]||'alert',15)+'</i><div><b>'+esc(x.kind==='report'?'Blocked: '+(x.missing||x.title):x.title)+'</b>'+(x.text?'<p>'+esc(x.text)+'</p>':'')+'<div class="bn-acts" data-r="'+i+'" data-j="'+j+'"></div></div></div>').join('')+'</div>')+'</div>'+memH+'</div></div>'}).join('')+'</div>';
  if(!first)box.querySelectorAll('.row').forEach(x=>x.style.animation='none');
  box.querySelectorAll('.bn-acts').forEach(b=>{const x=rows[+b.dataset.r].problems[+b.dataset.j];for(const [label,run,primary] of Bottlenecks.actions({...x,agentName:x.agentName||rows[+b.dataset.r].name})){const btn=document.createElement('button');btn.type='button';btn.className=primary?'primary small':'ghost small';btn.textContent=label;
   btn.onclick=async()=>{btn.disabled=true;try{await run();await Bottlenecks.check();await again()}catch(e){btn.disabled=false;fail(e)}};b.append(btn)}})}};

/* ---------- this week's cost by agent and by person, side by side (HEALTH-7). By person counts the chats each person
   started; schedules and channel customers nobody in aqeelOS started have a line of their own. Usage has the detail. ---------- */
const HealthCost={
 draw(box,d){const A=(d.byAgent||[]).slice(0,6),P=(d.byPerson||[]).slice(0,6);if(!A.length&&!P.length){box.innerHTML='';return}
  const usd=x=>money(x,{cents:true})||('$'+x.toFixed(2));
  const col=(t,rows)=>{const mx=Math.max(...rows.map(r=>r.cost),0.01);return '<div class="panel card hc-col"><h2>'+t+'</h2>'+(rows.length?rows.map((r,i)=>'<div class="hc-r"><span>'+esc(r.name)+'</span><b>'+usd(r.cost)+'</b><i style="--w:'+Math.max(2,Math.round(r.cost/mx*100))+'%;animation-delay:'+i*40+'ms"></i></div>').join(''):'<p class="sub">Nothing this week.</p>')+'</div>'};
  const first=!box.dataset.drawn;box.dataset.drawn='1';
  box.innerHTML='<div class="hi-top"><h2 class="ach-cat" style="margin:0">Cost this week</h2><a class="hc-all" href="#/system/usage">All usage</a></div><div class="two hc-two">'+col('By agent',A)+col('By person',P)+'</div>'+
   '<p class="hint" style="margin:8px 2px 22px">Estimates from the engine’s records. By person counts who started each chat, here or on a channel; work nobody started has lines of its own'+(d.failed?.length?'; some agents could not be read, so it is incomplete':'')+'.</p>';
  if(!first)box.querySelectorAll('.hc-r i,.panel').forEach(x=>x.style.animation='none')}};


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
 // raw internals that never lead a line: key names, ids, exit codes, versions, errors, paths
 RAW:/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\bexit (?:code )?\d+\b|\bv\d+\.\d+|\b[A-Z]\w*(?:Error|Exception)\b|Traceback|\bHTTP \d{3}\b|(?:^|\s)[~.]?\/[\w.-]+\/|\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b|\b(?:[Ss]kill|[Pp]lugin) [a-z0-9]+[-_][\w-]+/,
 // a plain title for an issue (10 Nov 2026 audit: "Skill process-aqeel-statements…", "PIXEL_SLACK_BOT_TOKEN", "Engine
 // v0.23.0"); text that is already plain stays as it is
 plain(m,ag){m=String(m||'').trim();if(!m)return 'Something needs a look';if(!HealthIssues.RAW.test(m))return m[0].toUpperCase()+m.slice(1);
  const parts=m.split(/\s*;\s*/).filter(Boolean),one=p=>{const SV={slack:'Slack',telegram:'Telegram',discord:'Discord',whatsapp:'WhatsApp',github:'GitHub',notion:'Notion',google:'Google',openai:'OpenAI',anthropic:'Anthropic',elevenlabs:'ElevenLabs'};
   const svc=(/(?:^|[^a-z])(slack|telegram|discord|whatsapp|github|notion|google|openai|anthropic|elevenlabs)(?![a-z])/i.exec(p)||[])[1]||'';
   const S_=svc?SV[svc.toLowerCase()]+' ':'',who=ag?' for '+ag:'';
   if(/\bno (?:clear )?(?:one-line )?description\b/i.test(p))return /^\s*key\b/i.test(p)?'A '+S_+'key has no description':/^\s*skill\b/i.test(p)?'A skill has no description':'Something has no description';
   if(/\bkey\b|_(?:TOKEN|KEY|SECRET)\b/i.test(p)&&/stop|invalid|revok|expir|fail|denied|401|403|unauth|not work|rejected/i.test(p))return 'A '+S_+'key'+who+' stopped working';
   if(/\bkey\b|_(?:TOKEN|KEY|SECRET)\b/i.test(p)&&/missing|not set|not there|no value|empty/i.test(p))return 'A '+S_+'key'+who+' is missing';
   if(/\bskill\b/i.test(p)&&/load|fail|error|broken|crash/i.test(p))return 'A skill failed to load';
   if(/\bskill\b/i.test(p)&&/file that is not there|missing file|not found/i.test(p))return 'A skill points to a file that is missing';
   if(/\bengine\b.*\bv?\d+\.\d+/i.test(p)&&/ready|available|install/i.test(p))return 'An engine update is ready to install';
   if(/\bengine\b.*\bv?\d+\.\d+/i.test(p)&&/fail/i.test(p))return 'An engine update failed';
   if(/\bplugin\b/i.test(p)&&/load|fail|error/i.test(p))return 'A plugin failed to load';
   if(/\b(?:tool server|mcp)\b/i.test(p))return 'A tool server stopped answering';
   // nothing known: the sentence with its internals taken out
   let s=p.replace(/\s*\([^)]*\)/g,'').replace(/\bkey [A-Z][A-Z0-9_]+\b/gi,'a key').replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g,'a key').replace(/\b(skill|plugin|tool|file) [\w./-]+/gi,'a $1').replace(/\bv?\d+\.\d+(?:\.\d+)*\b/g,'a new version').replace(/\s*\bexit (?:code )?\d+\b/gi,'').replace(/\s+/g,' ').trim();
   return s?s[0].toUpperCase()+s.slice(1):'Something needs a look'};
  const l=[...new Set(parts.map(one))];return l.length>2?l[0]+', and '+(l.length-1)+' more things':l.join('. ')},
 // the title a person reads: the sorter's plain one, else the problem made plain
 // (one not sorted yet: its first sentence, without the bracketed details, at most about 100 characters)
 title(i){if(i.title)return i.title;let s=HealthIssues.plain(i.missing,i.agentName||'').replace(/\s*\([^)]*\)/g,'').split(/(?<=[.!?])\s+|;\s+|\s+—\s+/)[0].replace(/[.:,;]+$/,'').trim();
  if(s.length>104){s=s.slice(0,100);s=s.slice(0,Math.max(60,s.lastIndexOf(' ')))+'…'}return s||'Something needs a look'},
 // Needs you (HEALTH-3): only what a person must do (needs a person, or stuck with something only a person can do),
 // one card per task: the same sign-in for four agents is one card
 needGroups(items){const g=new Map(),need=i=>i&&(i.state==='needs_human'||i.state==='stuck'&&i.need),by=new Map(items.map(i=>[i.id,i]));
  // one card per task: the group the sorter named, else the issue this one is a duplicate of (when that one needs a person too)
  const keyOf=(i,n=0)=>{if(i.group)return i.group.toLowerCase().trim();const d=by.get(i.dupOf);return d&&need(d)&&n<10?keyOf(d,n+1):i.id};
  for(const i of items){if(!need(i))continue;
   const k=keyOf(i);let x=g.get(k);if(!x)g.set(k,x={key:k,title:i.group||HealthIssues.title(i),need:i.need||'',ids:[],agents:new Set(),reports:0,told:i.told||null,stuck:false});
   x.ids.push(i.id);x.reports+=i.count||1;x.stuck||=i.state==='stuck';for(const a of [i.agentName||i.agent,...(i.reports||[]).map(r=>r.agentName||r.agent)])if(a)x.agents.add(a)}
  return [...g.values()].map(x=>({...x,agents:[...x.agents]}))},
 // why the fixer is not starting the next one, in one sentence (also used by the verdict)
 waitLine(f){const at=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),day=t=>new Date(t).toDateString()===new Date().toDateString()?'today':'tomorrow';
  if(f.paused)return 'Paused'+(f.paused.by?' by '+f.paused.by:'')+' at '+at(f.paused.at)+'. Nothing new starts until you press Resume; new problems still join the line.';
  if(f.on===false)return 'The fixer is switched off in System › Teams, so nothing starts.';
  if(f.wait){const w=f.wait,what=w.back?'Putting a change back':'This change';
   if(w.kind==='engine'&&!w.quiet)return what+' needs the engine reloaded, and engine reloads wait for the quiet hours ('+String(f.quiet?.from??1).padStart(2,'0')+':00–'+String(f.quiet?.to??5).padStart(2,'0')+':00) so no one’s reply is cut off. Until then proof runs and urgent fixes go on; other fixes wait, so nothing lands on top of a change that is not loaded yet.';
   return what+' reloads as soon as no agent is in the middle of a reply.'}
  const l=f.line||[];if(!l.length)return '';
  if(f.cap&&f.cap.used>=f.cap.cap&&!l.some(i=>i.why!=='line'))return 'All '+f.cap.cap+' fix runs of today are used. The next fix starts '+day(f.cap.resetAt)+' at '+at(f.cap.resetAt)+'.';
  const nb=l.find(i=>i.notBefore);if(!f.now&&nb&&l.every(i=>i.notBefore))return 'The next try starts at '+at(nb.notBefore)+'.';
  return ''},
 draw(B,d,again){const it=d.items||[],t=x=>esc(String(x??''));HealthIssues.agents=d.agents||[];const f=d.fixer||{};
  // a refresh that changes nothing leaves the page alone (no flicker under the mouse)
  const sig=JSON.stringify([f,it.map(i=>[i.id,i.state,i.tries,i.count,i.title,i.need,i.updated])]);if(B.fixer.dataset.sig===sig)return;const first=!B.fixer.dataset.sig;B.fixer.dataset.sig=sig;
  const END=HealthIssues.END,cut=(x,n)=>{x=String(x||'');return x.length>n?x.slice(0,n)+'…':x},hm=ms=>new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const btn=(k,id,label,cls='')=>'<button type="button" class="small '+cls+'" data-iss="'+k+'" data-id="'+t(id)+'">'+label+'</button>';
  // Needs you
  const groups=HealthIssues.needGroups(it);
  B.need.innerHTML=groups.length?'<div class="hi-top"><h2 class="ach-cat" style="margin:0">Needs you</h2><span class="hint">Only what a person has to do. Everything technical stays with the fixer.</span></div><div class="card list hn-list">'+groups.map((g,k)=>{const ag=g.agents;
    const who=ag.length>1?ag.slice(0,-1).join(', ')+' and '+ag.at(-1):ag[0]||'';
    return '<div class="row hn-row" style="animation-delay:'+Math.min(k,6)*40+'ms"><div class="main-c"><i class="hn-ic">'+icon('user',16)+'</i><div class="txt"><b>'+t(g.title)+(g.reports>1?'<span class="hi-tag">'+g.reports+' reports, merged</span>':'')+'</b>'+
     '<p>'+t(g.need||'Someone has to do this before the fixer can go on.')+'</p><span>'+t(who)+(ag.length>1?' · one fix covers all '+ag.length:'')+(g.told&&g.told!=='logged'?' · told '+t(g.told):'')+'</span>'+
     '<div class="hi-acts"><button type="button" class="primary small" data-need="retry" data-ids="'+t(g.ids.join(','))+'">Done, check again</button><button type="button" class="ghost small hi-close" data-need="close" data-ids="'+t(g.ids.join(','))+'">Not needed</button></div></div></div></div>'}).join('')+'</div>':'';
  // the fixer
  const L=f.line||[],run=f.now,w=f.wait,cap=f.cap||{used:0,cap:20};
  const state=f.paused?['paused','Paused']:f.on===false?['paused','Switched off']:run?['run',run.step==='prove'?'Proving a fix':'Fixing']:w?['wait',w.kind==='engine'&&!w.quiet?'Waiting for quiet hours':'Reloading soon']:L.length?['wait','Waiting']:['idle','Idle'];
  const steps=on=>'<div class="hf-steps">'+['Fix','Reload','Prove'].map((l,i)=>(i?'<span class="hf-bar'+(i<=on?' done':'')+'"></span>':'')+'<span class="hf-step'+(i<on?' done':i===on?' on':'')+'"><span class="d">'+(i<on?icon('check',11):'')+'</span>'+l+'</span>').join('')+'</div>';
  const mdl=(m,e)=>m?' · '+t(m)+(e?', '+t(e)+' effort':''):'';
  const nowH=run?'<div class="hf-now"><div class="hf-lbl">Now</div><b>'+t(run.agentName)+': '+t(HealthIssues.title(run))+'</b>'+steps(run.step==='prove'?2:0)+'<div class="hf-meta">Try '+Math.max(1,run.tries)+' of 3'+(run.kind==='proof'?' · proof run':'')+mdl(run.model,run.effort)+' · started '+t(hm(run.at))+', stops by itself after '+run.minutes+' min</div></div>':'';
  const waitH=w?'<div class="hf-now"><div class="hf-lbl">'+(w.back?'Putting back':'Waiting to reload')+'</div><b>'+t(w.agentName)+': '+t(HealthIssues.title(w))+'</b>'+steps(1)+'<div class="hf-meta">Try '+Math.max(1,w.tries)+' of 3'+mdl(w.model,w.effort)+(w.since?' · ready since '+t(hm(w.since)):'')+'</div></div>':'';
  const why=HealthIssues.waitLine(f);
  const capH='<div class="hf-cap"><span><b>'+cap.used+' of '+cap.cap+'</b> fix runs used today</span><span class="hf-meter'+(cap.used>=cap.cap?' full':'')+'"><i style="width:'+Math.min(100,Math.round(cap.used/Math.max(1,cap.cap)*100))+'%"></i></span><span class="hint">Proof runs and urgent agents don’t count. Resets at '+t(hm(cap.resetAt||Date.now()))+'.</span></div>';
  const WHY={proof:'Proof run',urgent:'Urgent agent',line:'In line'};
  const li=(i,k)=>'<li class="hf-qi" data-id="'+t(i.id)+'"><span class="n">'+(k+1)+'</span><div class="txt"><b title="'+t(HealthIssues.title(i))+'">'+t(HealthIssues.title(i))+'</b><span>'+t([i.agentName,WHY[i.why],i.tries&&i.why!=='proof'?'try '+(i.tries+1)+' of 3 next':'',i.count>1?i.count+' reports, merged':'',i.notBefore?'starts after '+hm(i.notBefore):'',i.moved?'moved by hand':''].filter(Boolean).join(' · '))+'</span></div>'+
   '<div class="hf-ctl"><button type="button" class="ib" data-fx="up" aria-label="Move up"'+(k?'':' disabled')+'>'+icon('chevU',15)+'</button><button type="button" class="ib" data-fx="down" aria-label="Move down"'+(k<L.length-1?'':' disabled')+'>'+icon('chevD',15)+'</button><button type="button" class="ib" data-fx="skip" aria-label="Skip for today" title="Skip for today">'+icon('skip',15)+'</button></div></li>';
  const sk=f.skipped||[],st=f.stuck||[];
  // open items that are none of the above: a fix waiting for the daily deploy, one stopped by a person, one filed while the fixer was off
  const shown=new Set([...L,...sk,...st,run,w].filter(Boolean).map(i=>i.id));for(const g of groups)for(const id of g.ids)shown.add(id);
  const other=it.filter(i=>!END.includes(i.state)&&!shown.has(i.id)&&!['fixing','verifying'].includes(i.state));
  const sp=d.spend,usd=x=>'$'+(x<1?x.toFixed(2):x.toFixed(x<10?1:0));
  const foot=[sp&&(sp.today.runs||sp.month.runs)?'Fixer spend: '+sp.today.runs+(sp.today.runs===1?' run':' runs')+' today ('+usd(sp.today.cost)+') · '+sp.month.runs+' this month ('+usd(sp.month.cost)+'). Estimates from the engine’s records.':'',
   'Each new problem is sorted by one short call to the sorting model (System › Teams › Fixer) before it joins the line: the same problem merges into the first report, and what only a person can do goes to Needs you.'+(f.sorting?' Sorting '+f.sorting+' now.':'')].filter(Boolean);
  B.fixer.innerHTML='<div class="card hf'+(first?'':' still')+'"><div class="hf-head"><h2>Fixer</h2><span class="hf-state '+state[0]+'"><i></i>'+state[1]+'</span>'+
    (f.on===false?'<a class="hf-link" href="#/system/teams">Switch it on</a>':'<button type="button" class="ghost small" data-fx="'+(f.paused?'resume':'pause')+'">'+icon(f.paused?'play':'pause',14)+(f.paused?'Resume':'Pause')+'</button>')+'</div>'+
   '<div class="hf-body">'+nowH+waitH+(why?'<div class="hf-why'+(f.paused||f.on===false?' calm':'')+'">'+icon('clock',16)+'<span>'+t(why)+'</span></div>':!run&&!w&&!L.length?'<div class="hf-why calm">'+icon('check',16)+'<span>Nothing in line.</span></div>':'')+capH+'</div>'+
   (L.length?'<div class="hf-qh"><b>In line <span>· '+L.length+'</span></b><span class="hint">Proof runs first, then urgent agents, then oldest first. Moving one up puts it ahead.</span></div><ol class="hf-q">'+L.slice(0,HealthIssues.allLine?L.length:8).map(li).join('')+'</ol>'+(L.length>8?'<div class="hf-sub"><button type="button" class="hf-link" data-fx="all">'+(HealthIssues.allLine?'Show the first 8':'Show all '+L.length)+'</button></div>':''):'')+
   (sk.length?'<div class="hf-sub">Skipped for today: '+sk.map(i=>t(HealthIssues.title(i))+' <button type="button" class="hf-link" data-fx="unskip" data-id="'+t(i.id)+'">Put back</button>').join(' · ')+'. They come back at '+t(hm(cap.resetAt||Date.now()))+'.</div>':'')+
   (st.length?'<div class="hf-qh"><b>Stuck after 3 tries <span>· '+st.length+'</span></b><span class="hint">Nothing a person can do was found. Try again after a change, or close it.</span></div><div class="hf-stuck">'+st.map(i=>'<div class="hf-qi"><span class="n"></span><div class="txt"><b>'+t(HealthIssues.title(i))+'</b><span>'+t(i.agentName)+'</span></div><div class="hi-acts" style="margin:0">'+btn('retry',i.id,'Try again')+btn('close',i.id,'Close','ghost hi-close')+'</div></div>').join('')+'</div>':'')+
   (other.length?'<div class="hf-qh"><b>Also waiting <span>· '+other.length+'</span></b></div><div class="hf-stuck">'+other.map(i=>'<div class="hf-qi"><span class="n"></span><div class="txt"><b>'+t(HealthIssues.title(i))+'</b><span>'+t([i.agentName,i.sorting?'Being sorted':HealthIssues.ST[i.state]||i.state].filter(Boolean).join(' · '))+'</span></div><div class="hi-acts" style="margin:0">'+(['stopped','open'].includes(i.state)?btn('retry',i.id,'Try again'):'')+btn('close',i.id,'Close','ghost hi-close')+'</div></div>').join('')+'</div>':'')+
   '<div class="hf-foot">'+foot.map(x=>'<span>'+t(x)+'</span>').join('')+'</div></div>';
  // the team had to go to the main agent (escalations.mjs)
  const er=Object.entries(d.escalations?.agents||{}),names={};for(const i of it)names[i.agent]=i.agentName;
  B.esc.innerHTML=er.length?'<div class="card list" style="margin-bottom:22px"><div class="list-head">Team had to go to the main agent (this week · last week)</div>'+er.map(([a,v])=>'<div class="row"><div class="main-c"><div class="txt"><b>'+t(names[a]||a)+'</b><span>'+v.thisWeek+' this week · '+v.lastWeek+' last week'+(v.examples?.length?', e.g. “'+t(v.examples[0])+'”':'')+'</span></div></div></div>').join('')+'</div>':'';
  // History (HEALTH-4): what ended, newest first, by day
  const OUT={fixed:'Fixed and proven',gone:'Resolved by itself',closed:'Closed',expired:'Closed after 7 days',declined:'Declined'},KIND=s=>s==='fixed'?'fixed':s==='gone'?'gone':'closed';
  const done=it.filter(i=>END.includes(i.state)).sort((a,b)=>(b.updated||0)-(a.updated||0)),flt=HealthIssues.flt||'all';
  const dayOf=ms=>{const x=new Date(ms),n=new Date();const y=new Date(n);y.setDate(n.getDate()-1);return x.toDateString()===n.toDateString()?'Today':x.toDateString()===y.toDateString()?'Yesterday':x.toLocaleDateString([],{weekday:'long',day:'numeric',month:'short'})};
  const hrow=i=>{const k=KIND(i.state);const bits=[i.agentName,OUT[i.state]||i.state,i.tries&&i.state==='fixed'?'try '+i.tries:'',i.count>1?i.count+' reports, merged':'',i.mergedInto?'merged into another issue':'',hm(i.updated||i.created)].filter(Boolean);
   const det=[i.proof?'Proof: '+cut(i.proof,600):'',i.result?.summary?cut(i.result.summary,600):'',HealthIssues.title(i)!==String(i.missing||'').trim()?String(i.missing||''):''].filter(Boolean);
   return '<div class="hh-row" data-k="'+k+'"><span class="hh-oc '+k+'">'+icon(k==='closed'?'minus':'check',12)+'</span><div class="txt"><b>'+t(HealthIssues.title(i))+'</b><span>'+t(bits.join(' · '))+'</span>'+
    (det.length?'<button type="button" class="act-more" aria-expanded="false">'+(i.state==='fixed'?'Proof':'Details')+icon('chevR',12)+'</button><div class="act-raw"><div><div>'+t(det.join('\n\n'))+'</div></div></div>':'')+'</div></div>'};
  let last='';const hl=done.filter(i=>flt==='all'||KIND(i.state)===flt).map(i=>{const dd=dayOf(i.updated||i.created||0);const h=dd!==last?'<div class="hh-day">'+t(dd)+'</div>':'';last=dd;return h+hrow(i)}).join('');
  const chip=(k,l)=>'<button type="button" class="hh-chip" data-hf="'+k+'" aria-pressed="'+(flt===k)+'">'+l+'</button>';
  B.hist.innerHTML='<div class="hi-top"><h2 class="ach-cat" style="margin:0">History</h2><div class="hh-chips">'+chip('all','All')+chip('fixed','Fixed and proven')+chip('gone','Resolved by itself')+chip('closed','Closed')+'</div></div><div class="card hh-list">'+(hl||'<div class="hh-row"><div class="txt"><span>Nothing here yet.</span></div></div>')+'</div>';
  if(!first)[B.need,B.esc].forEach(b=>b.querySelectorAll('.row').forEach(x=>x.style.animation='none'));HealthIssues.drawn=true;
  // Details open in place; History's filters; one listener per box
  for(const b of [B.hist,B.fixer])if(!b.dataset.det){b.dataset.det='1';b.addEventListener('click',e=>{const m=e.target.closest('.act-more');if(m){const on=m.getAttribute('aria-expanded')!=='true';m.setAttribute('aria-expanded',String(on));m.nextElementSibling?.classList.toggle('open',on);return}
   const c=e.target.closest('[data-hf]');if(c){HealthIssues.flt=c.dataset.hf;B.fixer.dataset.sig='';HealthIssues.draw(B,d,again)}})}
  // Needs you: done (the fixer tries again) or not needed (closed)
  B.need.querySelectorAll('button[data-need]').forEach(b=>b.onclick=async()=>{const ids=b.dataset.ids.split(',').filter(Boolean),k=b.dataset.need;
   if(k==='close'&&!await confirmBox('Not needed?','It closes'+(ids.length>1?' for all '+ids.length+' reports':'')+' and goes to History. If the problem comes back, it is filed again.','Close',false))return;
   b.disabled=true;try{for(const id of ids)await post(UI,'/ui/health/issues/'+(k==='retry'?'retry':'close'),{id});toast(k==='retry'?'The fixer checks it again.':'Closed.')}catch(e){b.disabled=false;toast(e.message,'err');return}
   const row=b.closest('.row');if(!calm()&&row){row.style.animation='cardOut 180ms var(--ease) both';await new Promise(r=>setTimeout(r,180))}B.fixer.dataset.sig='';again()});
  // the fixer's line: move, skip and put back, pause and resume
  B.fixer.querySelectorAll('button[data-fx]').forEach(b=>b.onclick=async()=>{const k=b.dataset.fx,li=b.closest('.hf-qi'),id=b.dataset.id||li?.dataset.id||'';if(k==='all'){HealthIssues.allLine=!HealthIssues.allLine;B.fixer.dataset.sig='';return HealthIssues.draw(B,d,again)}b.disabled=true;
   if(k==='pause'&&!await confirmBox('Pause the fixer?','A run already going finishes its step. Nothing new starts until you press Resume. New problems still join the line.','Pause',false)){b.disabled=false;return}
   try{const path=k==='up'||k==='down'?'move':k;await post(UI,'/ui/health/fixer/'+path,{id,dir:k});
    if(k==='skip'&&li&&!calm()){li.classList.add('out');await new Promise(r=>setTimeout(r,220))}
    if(k==='pause'||k==='resume')toast(k==='pause'?'The fixer is paused.':'The fixer goes on.');else if(k==='skip')toast('Skipped for today.')}catch(e){b.disabled=false;toast(e.message,'err');return}
   HealthIssues.moved=k==='up'||k==='down'?{id,dir:k}:null;B.fixer.dataset.sig='';await again()});
  if(HealthIssues.moved){const m=HealthIssues.moved;HealthIssues.moved=null;const li=B.fixer.querySelector('.hf-qi[data-id="'+CSS.escape(m.id)+'"]');if(li){if(!calm())li.classList.add('moved');const nb=li.querySelector('[data-fx="'+m.dir+'"]:not(:disabled)')||li.querySelector('[data-fx="skip"]');nb?.focus()}}
  B.fixer.querySelectorAll('button[data-iss]').forEach(b=>b.onclick=async()=>{const k=b.dataset.iss;
   if(k==='close'&&!await confirmBox('Close this issue?','The fixer stops working on it, and it goes to History.','Close issue',false))return;
   b.disabled=true;try{await post(UI,'/ui/health/issues/'+k,{id:b.dataset.id});toast(k==='retry'?'The fixer tries again.':'Closed.')}catch(e){b.disabled=false;toast(e.message,'err');return}B.fixer.dataset.sig='';again()})},
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
