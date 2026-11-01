/* ---------- System › Health (agreed layout, 18 Oct): Status and Host on one page, put together from the two old
   pages so every control works as before. Agents: what is running and connected (refreshed every 15 s while you
   look). The AI box: resources, what uses RAM, background helpers, maintenance, access. "Recent sessions" is
   left out: the chat list and Manage chats already show it. #/system/status and #/system/host open this page. ---------- */
{const oldStatus=PAGES.status,oldHost=PAGES.host;
 PAGES.health=async(p,el,r)=>{const tok=S._htok=(S._htok||0)+1,stale=()=>tok!==S._htok;
  setActions('');el.innerHTML=`<h2 class="ach-cat" style="margin-top:0">Agents</h2><div id="hStatus"><div class="skel" style="height:110px;border-radius:18px"></div></div><h2 class="ach-cat">The AI box</h2><div id="hHost"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;
  const sBox=el.querySelector('#hStatus'),hBox=el.querySelector('#hHost');
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
  await Promise.all([drawStatus(),oldHost(p,hb,r).then(()=>{if(stale()){hb.remove();return}hb.hidden=false;hBox.replaceChildren(hb)},e=>{hb.remove();hBox.innerHTML=alertBox(esc(e.message))})]);
  if(stale())return;
  // one button here (1 Nov 2026): Restart is in Start and stop agents, Check again in the engine updates card
  setActions(S.me?.admin!==false?`<button data-act="console-open" title="Type the engine’s own commands">${icon('terminal',16)}Engine console</button>`:'');
  // agents and channels change often: refresh that part only, while the page is open and visible
  const tick=()=>{clearTimeout(Pages._healthT);Pages._healthT=setTimeout(async()=>{if(stale()||route().page?.id!=='health')return;if(!document.hidden)await drawStatus().catch(()=>{});tick()},15000)};tick()}}

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
