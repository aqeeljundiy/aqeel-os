/* ---------- System › Teams (7 Nov 2026, plug and play): what a new owner used to set by editing files on the box
   (team-settings.mjs). Teams: the owner, each team's members and contact, which agents it covers (a fix that needs a
   person goes to the contact, else the owner). Agents: each one's team and the Test agent switch (its alerts are not
   sent). The fixer: on or off, which agent fixes, daily limit, minutes per run. Alerts: where alerts for the owner go,
   Send test, and Pause alerts until… Setup opens in a dialog, quick picks in a popover. Admins only. ---------- */
const Teams={
 d:null,
 who:p=>[p?.telegram?.length?'Telegram '+p.telegram.join(', '):'',p?.telegram_names?.length?'@'+p.telegram_names.join(', @'):'',p?.whatsapp?.length?'WhatsApp '+p.whatsapp.join(', '):''].filter(Boolean).join(' · ')||'Hasn’t messaged aqeelOS yet',
 teamOf:a=>(Teams.d.teams||[]).find(t=>(t.agents||[]).includes(a)),
 // the name people know the agent by, the same as everywhere else in the app
 name:a=>(typeof ident==='function'&&ident(a)?.name)||(Teams.d.agents.find(x=>x.id===a)||{}).name||a,
 when:t=>{const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?'today '+tm:d.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})+' '+tm},
 chip:(cls,t)=>`<span class="chip km-chip${cls?' '+cls:''}"><i class="dot"></i>${esc(t)}</span>`,

 teamsHtml(){const d=Teams.d,o=d.owner||{},none=d.agents.filter(a=>!Teams.teamOf(a.id));
  const on=o.name&&!/^owner$/i.test(o.name.trim())?o.name:'';   // "Owner · owner" said it twice
  return `<div class="tm-row"><div class="km-id">${personAvatar({name:on||'Owner'},36)}<div class="txt"><b>${on?esc(on)+' <span class="tm-role">Owner</span>':'Owner'}</b><p>${esc(Teams.who(o))}</p></div></div>
    <div class="km-act"><button class="small" data-act="tm-owner">${icon('edit',14)}Edit</button></div></div>`+
   (d.teams||[]).map((t,i)=>{const c=t.contact||(t.members||[])[0]?.name;
    return `<div class="tm-row" ${st(i+1)}><div class="km-id"><span class="tm-ic">${icon('user',18)}</span><div class="txt"><b>${esc(t.name)}</b>
     <p>${(t.agents||[]).length?esc((t.agents||[]).map(Teams.name).join(', ')):'No agents yet.'}</p>
     <p>${(t.members||[]).length?'Members: '+esc(t.members.map(m=>m.name).join(', '))+'. ':'No members. '}${c?esc(c)+' hears when a fix needs a person.':'The owner hears when a fix needs a person.'}</p></div></div>
     <div class="km-act"><button class="small" data-act="tm-team" data-i="${i}">${icon('edit',14)}Edit</button></div></div>`}).join('')+
   (none.length?`<details class="tm-none"><summary><span class="tm-note">${icon('alert',16)}<span>${none.length===1?'1 agent has no team':none.length+' agents have no team'}. The owner hears about ${none.length===1?'it':'them'}.</span></span><span class="tm-see">See ${none.length===1?'it':'them'}</span></summary><div class="tm-none-list">${none.map(a=>`<span class="tm-none-a">${agentAvatar(a.id,20,{title:false})}${esc(Teams.name(a.id))}</span>`).join('')}</div></details>`:'')},
 agentsHtml(){const d=Teams.d,tests=new Set(d.tests||[]);
  return d.agents.map((a,i)=>{const t=Teams.teamOf(a.id);
   return `<div class="tm-row tm-agent" ${st(i)}><div class="km-id">${agentAvatar(a.id,32)}<div class="txt"><b>${esc(Teams.name(a.id))}</b><p>${t?'Team '+esc(t.name):'No team'}${tests.has(a.id)?' · test agent: nobody is alerted about it':''}</p></div></div>
    <div class="km-act"><label class="tm-sw"><span>Test agent</span>${toggle(tests.has(a.id),'Test agent '+Teams.name(a.id),`data-test="${esc(a.id)}"`)}</label></div></div>`}).join('')},
 fixerHtml(){const f=Teams.d.fixer;
  return `<div class="tm-row tm-first"><div class="txt"><b>${f.on?'On':'Off'}</b><p>${f.on?'Every issue on System › Health is fixed, reloaded safely and proven by itself. A person hears only when a fix needs one.':'Issues wait on System › Health and nothing is fixed by itself.'+(f.off_why?' Why: '+esc(f.off_why):'')}</p></div>
    <div class="km-act">${toggle(f.on,'Fixer on','data-fx="on"')}</div></div>
   <div class="tm-grid${f.on?'':' tm-dim'}">
    <div><label>Fixes with</label><button type="button" class="sel-btn" data-act="tm-fixer-agent"><span class="sv">${esc(Teams.name(f.agent))}</span>${icon('chevD',15)}</button></div>
    <div><label for="fxCap">Fix runs a day</label><input id="fxCap" type="number" min="1" max="100" value="${f.cap}" data-fx="cap"></div>
    <div><label for="fxMin">Minutes per fix run</label><input id="fxMin" type="number" min="5" max="60" value="${f.minutes}" data-fx="minutes"></div>
    <div><label for="fxPr">Minutes per proof run</label><input id="fxPr" type="number" min="5" max="60" value="${f.proof_minutes}" data-fx="proof_minutes"></div></div>`},
 alertsHtml(){const d=Teams.d,t=d.alerts,p=d.pause,ch=t&&d.channels.find(c=>c.id===t.channel);
  const to=t?(ch?(t.name||ch.name):'A channel that is no longer connected, so the main agent’s own chat is used'):(d.channels.length?'Not chosen: the main agent’s own chat ('+d.channels[0].name+')':'No channel yet: alerts wait in the bell');
  return `<div class="tm-row tm-first"><div class="txt"><b>Alerts go to</b><p>${esc(to)}</p></div>
    <div class="km-act"><button class="small" data-act="tm-alert-test">${icon('send',14)}Send test</button><button class="small" data-act="tm-alert-to">Change</button></div></div>
   <div class="tm-row"><div class="txt"><b>${p?'Paused until '+esc(Teams.when(p.until)):'Alerts are on'}</b><p>${p?esc(p.why||'')+'. Alerts are logged, not sent. Automatic engine restarts and fixer reloads wait too.':'Pause them for a long build or a quiet evening. Automatic engine restarts and fixer reloads wait while paused.'}</p></div>
    <div class="km-act">${p?'<button class="small" data-act="tm-resume">Resume now</button>':''}<button class="small" data-act="tm-pause">${p?'Change':'Pause until…'}</button></div></div>`},

 // first paint rises in; later paints change only the part that changed
 paint(el){const parts={teams:Teams.teamsHtml(),agents:Teams.agentsHtml(),fixer:Teams.fixerHtml(),alerts:Teams.alertsHtml()};let root=el.querySelector('.tm');
  if(!root){el.innerHTML=`<div class="tm">
    <div class="panel card km-p" ${st(0)}><h2>Teams</h2><p class="sub">Who works with which agents. When a fix needs a person, the team’s contact hears it in the team group; for agents without a team, the owner does.</p><div data-part="teams"></div><button class="ghost tm-add" data-act="tm-team" data-i="new">${icon('plus',15)}Add a team</button></div>
    <div class="panel card km-p" ${st(1)}><h2>Alerts for the owner</h2><p class="sub">Where aqeelOS reaches you when something truly needs you. When no channel works, the alert waits in the bell.</p><div data-part="alerts"></div></div>
    <div class="panel card km-p" ${st(2)}><h2>The fixer</h2><p class="sub">Fixes the issues on System › Health by itself: backs up, changes, reloads when nothing is busy, and proves the fix. 3 tries per issue.</p><div data-part="fixer"></div></div>
    <div class="panel card km-p" ${st(3)}><h2>Agents</h2><p class="sub">A test agent still shows its problems on System › Health, but nobody is alerted about it and the fixer does not reach out for it.</p><div data-part="agents"></div></div></div>`;root=el.querySelector('.tm')}
  for(const [k,html] of Object.entries(parts)){const box=root.querySelector(`[data-part="${k}"]`);if(box._html===html)continue;const first=box._html==null;box._html=html;
   // a later paint changes only what changed, in place (the whole part used to fade out and in for one switch)
   if(first)box.innerHTML=html;else{morph(box,html);box.querySelectorAll('.tm-row').forEach(r=>r.style.animation='none')}}
  Teams.bind(root)},
 bind(root){
  root.querySelectorAll('input[data-test]').forEach(x=>x.onchange=async()=>{x.disabled=true;try{const r=await put(UI,'/ui/teams/test',{agent:x.dataset.test,on:x.checked});Teams.d.tests=r.tests;toast(x.checked?Teams.name(x.dataset.test)+' is a test agent: nobody is alerted about it.':Teams.name(x.dataset.test)+' is a real agent again.')}catch(e){x.checked=!x.checked;toast(e.message,'err')}x.disabled=false;Teams.repaint()});
  const fx=root.querySelector('[data-part="fixer"]');
  fx.querySelectorAll('[data-fx]').forEach(x=>{const k=x.dataset.fx;
   if(k==='on')x.onchange=()=>Teams.saveFixer({on:x.checked},x);
   else x.onchange=()=>{const v=+x.value;if(!x.value||!(v>=+x.min&&v<=+x.max)){toast('Use a number from '+x.min+' to '+x.max+'.','err');x.value=Teams.d.fixer[k];return}if(v!==Teams.d.fixer[k])Teams.saveFixer({[k]:v},x)}})},
 async saveFixer(ch,x){if(x)x.disabled=true;try{const r=await put(UI,'/ui/teams/fixer',ch);Teams.d.fixer=r.fixer;toast(ch.on===true?'The fixer is on.':ch.on===false?'The fixer is off. Issues wait on Health.':'Saved.')}catch(e){toast(e.message,'err')}if(x)x.disabled=false;Teams.repaint()},
 repaint(){const el=document.querySelector('.tm')?.parentElement;if(el&&Teams.d)Teams.paint(el)},
 async show(el){const gone=pageTok(el);setActions('');
  if(S.me?.admin===false){el.innerHTML=emptyBox('Only admins','Teams decide who hears about problems, so only admins see them.');return}
  if(!el.querySelector('.tm'))el.innerHTML='<div class="skel" style="height:200px;border-radius:18px;margin-bottom:16px"></div><div class="skel" style="height:140px;border-radius:18px"></div>';
  let d;try{d=await UI('/ui/teams',{fresh:true})}catch(e){if(!gone())el.innerHTML=emptyBox('Teams did not load',e.message||'Try again in a moment.');return}if(gone())return;
  Teams.d=d;Teams.paint(el)},
 async save(teams,owner){const r=await put(UI,'/ui/teams',{teams,owner:owner||Teams.d.owner});Teams.d=r;Teams.repaint();return r}};

PAGES.teams=async(p,el)=>{viewPick([]);await Teams.show(el)};

// a person's fields (owner or member): name, Telegram ids and names, WhatsApp numbers
Teams.personFields=(p,k,named=true)=>`${named?`<label>Name</label><input data-f="name" maxlength="60" value="${esc(p.name||'')}" placeholder="Ari">`:''}
 <div class="tm-two"><div><label>Telegram user ID</label><input data-f="telegram" value="${esc((p.telegram||[]).join(', '))}" inputmode="numeric" placeholder="1000000002"></div>
 <div><label>Telegram name</label><input data-f="telegram_names" value="${esc((p.telegram_names||[]).join(', '))}" placeholder="ari"></div></div>
 <label>WhatsApp number</label><input data-f="whatsapp" value="${esc((p.whatsapp||[]).join(', '))}" inputmode="tel" placeholder="+62 812 3456 7890">`;
Teams.readPerson=box=>{const v=f=>box.querySelector(`[data-f="${f}"]`)?.value||'',l=f=>v(f).split(',').map(x=>x.trim()).filter(Boolean);
 return {name:v('name').trim(),telegram:l('telegram'),telegram_names:l('telegram_names'),whatsapp:l('whatsapp')}};

ACT['tm-owner']=()=>{const o=Teams.d.owner||{};
 const d=drawer('The owner',`<p class="hint" style="margin-top:0">aqeelOS knows it is you by these ids, on any channel. Several ids: separate them with commas.</p><div class="tm-person">${Teams.personFields(o,'o')}</div><p class="km-err"></p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="tmSave">Save</button>`);
 d.querySelector('#tmSave').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const p=Teams.readPerson(d.querySelector('.tm-person'));if(!p.name){d.querySelector('.km-err').textContent='Add a name.';b.disabled=false;return}
  try{await Teams.save(Teams.d.teams,{...o,...p});closeLayers();toast('Saved.')}catch(err){d.querySelector('.km-err').textContent=err.message;b.disabled=false}}};

// a team: name, agents (an agent in another team moves here), what else people call each agent, members, the contact
ACT['tm-team']=b=>{const isNew=b.dataset.i==='new',t=isNew?{name:'',agents:[],members:[],aliases:{}}:structuredClone(Teams.d.teams[+b.dataset.i]);let members=structuredClone(t.members||[]);const sel=new Set(t.agents||[]);
 const memberHtml=(m,i)=>`<div class="tm-member" data-m="${i}"><div class="tm-mhead"><b>${esc(m.name||'New member')}</b><button class="ghost icon" data-rm="${i}" aria-label="Remove ${esc(m.name||'this member')}">${icon('x',16)}</button></div>${Teams.personFields(m,'m'+i)}</div>`;
 const agentsHtml=()=>Teams.d.agents.map(a=>{const other=Teams.teamOf(a.id),moves=other&&other.name!==t.name;return `<button type="button" class="tm-pick${sel.has(a.id)?' on':''}" data-a="${esc(a.id)}" aria-pressed="${sel.has(a.id)}">${agentAvatar(a.id,22)}<span>${esc(Teams.name(a.id))}${moves&&!sel.has(a.id)?`<small>in ${esc(other.name)}</small>`:''}</span></button>`}).join('');
 const aliasHtml=()=>[...sel].map(a=>`<div class="tm-alias"><span>${esc(Teams.name(a))}</span><input data-al="${esc(a)}" value="${esc((t.aliases?.[a]||[]).join(', '))}" placeholder="Other names, e.g. Rory"></div>`).join('')||'<p class="hint">Pick agents first.</p>';
 const d=drawer(isNew?'New team':'Edit '+t.name,`<label for="tmName">Team name</label><input id="tmName" maxlength="40" value="${esc(t.name)}" placeholder="Support">
  <label>Agents</label><div class="tm-picks">${agentsHtml()}</div>
  <label>Also called</label><p class="hint tm-sub">What people call each agent in chats, so aqeelOS can tell when the team asks the main agent about it.</p><div class="tm-aliases">${aliasHtml()}</div>
  <label>Members</label><div class="tm-members">${members.map(memberHtml).join('')}</div><button type="button" class="ghost tm-add" id="tmAddM">${icon('plus',15)}Add a member</button>
  <label>Contact</label><p class="hint tm-sub">Hears when a fix for one of these agents needs a person.</p><select id="tmContact"></select><p class="km-err"></p>`,
  `${isNew?'':`<button class="ghost danger" id="tmDel">Remove team</button>`}<span style="flex:1"></span><button class="ghost" data-act="close">Cancel</button><button class="primary" id="tmSave">Save</button>`,{size:'lg'});
 const grab=()=>{d.querySelectorAll('.tm-member').forEach(x=>{const i=+x.dataset.m;members[i]={...members[i],...Teams.readPerson(x)}});d.querySelectorAll('[data-al]').forEach(x=>{(t.aliases||={})[x.dataset.al]=x.value.split(',').map(s=>s.trim()).filter(Boolean)})};
 const contact=()=>{const s=d.querySelector('#tmContact'),cur=s.value||t.contact||'';s.innerHTML='<option value="">Nobody: the owner hears</option>'+members.filter(m=>m.name).map(m=>`<option${m.name===cur?' selected':''}>${esc(m.name)}</option>`).join('');s._sync?.()};contact();
 const paintMembers=()=>{const box=d.querySelector('.tm-members');box.innerHTML=members.map(memberHtml).join('');box.querySelectorAll('[data-rm]').forEach(x=>x.onclick=()=>{grab();const row=x.closest('.tm-member');row.classList.add('tm-gone');setTimeout(()=>{members.splice(+x.dataset.rm,1);paintMembers();contact()},calm()?0:180)});
  box.querySelectorAll('[data-f="name"]').forEach(x=>x.onchange=()=>{grab();contact();x.closest('.tm-member').querySelector('.tm-mhead b').textContent=x.value||'New member'})};paintMembers();
 d.querySelector('#tmAddM').onclick=()=>{grab();members.push({name:''});paintMembers();const last=d.querySelector('.tm-member:last-child');last.classList.add('tm-new');last.querySelector('[data-f="name"]').focus()};
 d.querySelector('.tm-picks').onclick=e=>{const p=e.target.closest('[data-a]');if(!p)return;grab();const a=p.dataset.a;sel.has(a)?sel.delete(a):sel.add(a);p.classList.toggle('on',sel.has(a));p.setAttribute('aria-pressed',sel.has(a));d.querySelector('.tm-aliases').innerHTML=aliasHtml()};
 d.querySelector('#tmDel')?.addEventListener('click',async()=>{if(!await confirmBox('Remove '+t.name+'?','Its agents will have no team, so the owner hears about them. Members are removed with it.','Remove team'))return;
  try{await Teams.save(Teams.d.teams.filter((x,i)=>i!==+b.dataset.i));closeLayers();toast(t.name+' removed.')}catch(err){toast(err.message,'err')}});
 d.querySelector('#tmSave').onclick=async e=>{const btn=e.currentTarget,err=d.querySelector('.km-err');grab();const name=d.querySelector('#tmName').value.trim();if(!name){err.textContent='Give the team a name.';return}
  if(members.some(m=>!m.name)){err.textContent='Every member needs a name.';return}
  const next={...t,name,agents:[...sel],members,contact:d.querySelector('#tmContact').value,aliases:Object.fromEntries(Object.entries(t.aliases||{}).filter(([a])=>sel.has(a)))};
  // an agent picked here leaves the team it was in
  const teams=(isNew?Teams.d.teams:Teams.d.teams.filter((x,i)=>i!==+b.dataset.i)).map(x=>({...x,agents:(x.agents||[]).filter(a=>!sel.has(a))}));
  if(isNew)teams.push(next);else teams.splice(+b.dataset.i,0,next);
  btn.disabled=true;try{await Teams.save(teams);closeLayers();toast('Saved.')}catch(x){err.textContent=x.message;btn.disabled=false}}};

// which agent's engine runs the fixer: a quick pick
ACT['tm-fixer-agent']=b=>{const f=Teams.d.fixer;menu(b,Teams.d.agents.map(a=>({label:Teams.name(a.id),sub:a.id==='default'?'The main agent':'',ava:agentAvatar(a.id,20),on:a.id===f.agent,run:()=>{if(a.id!==f.agent)Teams.saveFixer({agent:a.id})}})),{search:Teams.d.agents.length>12,matchWidth:true})};

// where alerts go: a channel the main agent can send on, and the chat on it (setup, so a dialog)
ACT['tm-alert-to']=()=>{const D=Teams.d,t=D.alerts||{};
 const d=drawer('Alerts go to',`<p class="hint" style="margin-top:0">Alerts for the owner come from the main agent. Pick the channel and, if it reaches more than one person, the chat.</p>
  <label for="alCh">Channel</label><select id="alCh"><option value="">The main agent’s own chat (default)</option>${D.channels.map(c=>`<option value="${esc(c.id)}"${c.id===t.channel?' selected':''}>${esc(c.name)}</option>`).join('')}</select>
  <div id="alChatBox" hidden><label for="alChat">Chat</label><select id="alChat"></select></div><p class="km-err"></p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="alSave">Save</button>`);
 const ch=d.querySelector('#alCh'),cb=d.querySelector('#alChatBox'),chat=d.querySelector('#alChat'),err=d.querySelector('.km-err');
 const load=async()=>{err.textContent='';if(!ch.value){cb.hidden=true;return}chat.innerHTML='<option value="">Loading…</option>';chat._sync?.();cb.hidden=false;
  try{const r=await post(UI,'/ui/alerts/chats',{channel:ch.value});chat.innerHTML='<option value="">Your own chat on it (default)</option>'+r.chats.map(c=>`<option value="${esc(c.id)}"${c.id===t.chat?' selected':''}>${esc(c.name)}</option>`).join('');chat._sync?.()}
  catch(e){err.textContent=e.message;cb.hidden=true}};
 ch.onchange=load;load();
 d.querySelector('#alSave').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const o=chat.selectedOptions[0];
  try{const r=await put(UI,'/ui/alerts',{channel:ch.value,chat:cb.hidden?'':chat.value,chatName:!cb.hidden&&chat.value?o?.textContent:''});Teams.d.alerts=r.alerts;closeLayers();Teams.repaint();toast('Saved. Send a test to check it arrives.')}catch(x){err.textContent=x.message;b.disabled=false}}};
ACT['tm-alert-test']=async b=>{b.disabled=true;try{const r=await post(UI,'/ui/alerts/test',{});toast(r.bell?'No channel to you yet, so the test is in the bell.':'Test sent on '+r.sent+'.')}catch(e){toast('Not sent: '+e.message+' It is in the bell instead.','err')}b.disabled=false};

// Pause alerts until…: quick picks in a popover, or a day and time in a small dialog
Teams.pause=async(until,why)=>{try{const r=await put(UI,'/ui/alerts/pause',{until,why});Teams.d.pause=r.pause;Teams.repaint();toast(r.pause?'Alerts paused until '+Teams.when(r.pause.until)+'.':'Alerts are on again.')}catch(e){toast(e.message,'err')}};
ACT['tm-resume']=()=>Teams.pause(0);
ACT['tm-pause']=b=>{const h=n=>Date.now()+n*3600e3,morning=()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(8,0,0,0);return +d};
 menu(b,[{header:'Pause alerts'},{label:'For 1 hour',run:()=>Teams.pause(h(1),'Paused for an hour')},{label:'For 4 hours',run:()=>Teams.pause(h(4),'Paused for 4 hours')},{label:'Until tomorrow 08:00',run:()=>Teams.pause(morning(),'Paused until the morning')},'-',{label:'Pick a day and time…',icon:'clock',run:()=>Teams.pausePick()}])};
Teams.pausePick=()=>{const p=Teams.d.pause,base=new Date(p?.until||Date.now()+2*3600e3),v=base.getFullYear()+'-'+pad2(base.getMonth()+1)+'-'+pad2(base.getDate())+'T'+pad2(base.getHours())+':'+pad2(Math.floor(base.getMinutes()/5)*5);
 const d=drawer('Pause alerts until',`<label>Until</label><input id="pzAt" data-pick="datetime" value="${v}"><label for="pzWhy">Why (optional)</label><input id="pzWhy" maxlength="160" value="${esc(p?.why||'')}" placeholder="A long build"><p class="hint">Two weeks at most. Automatic engine restarts and fixer reloads wait too.</p><p class="km-err"></p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="pzSave">Pause</button>`);
 d.querySelector('#pzSave').onclick=async()=>{const t=Date.parse(d.querySelector('#pzAt').value);if(!(t>Date.now())){d.querySelector('.km-err').textContent='Pick a time in the future.';return}
  closeLayers();await Teams.pause(t,d.querySelector('#pzWhy').value.trim())}};
