// Automations › Runs itself (5 Nov 2026): agents can start a fresh run of themselves (run_self) to test or redo their
// work. This page is where an admin decides who may make them, how often, and sees every run: what needs action first
// (paused agents, runs going), then each agent's switch and limits, the trusted people (added by a one-time code they
// send from their own chat), the runs, and recent refusals.
const SR={
 when:t=>{const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?tm:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+tm},
 dur:s=>s==null?'':s<60?s+' s':Math.round(s/60)+' min',
 state:{waiting:['blue','Waiting for its lock'],running:['blue','Running'],ok:['ok','Finished'],failed:['bad','Failed'],timeout:['bad','Ran out of time'],stopped:['warn','Stopped'],interrupted:['warn','Lost in a restart']},
 pf:{telegram:'Telegram',whatsapp:'WhatsApp',slack:'Slack',discord:'Discord',signal:'Signal',api_server:'aqeelOS chat',cron:'schedule',webhook:'webhook',subagent:'helper'},
 by:b=>{if(!b)return '';const w=b.who||'';const c=SR.pf[b.platform]||SR.pf[b.kind]||b.kind||'';return b.kind==='cron'?(w||'schedule'):w&&c?w+' on '+c:w||c},
 mask:v=>{v=String(v||'');return v.length>6?v.slice(0,3)+'…'+v.slice(-3):v},
 chip:s=>{const [k,l]=SR.state[s]||['',s];return `<span class="chip ${k}">${esc(l)}</span>`}};

PAGES.selfruns=async(p,el)=>{viewPick([]);setActions('');const gone=pageTok(el);
 if(S.me?.admin===false){el.innerHTML=emptyBox('Admins only','An admin decides which agents may run themselves and who may ask them to.');return}
 let d;try{d=await UI('/ui/self-runs')}catch(e){el.innerHTML=emptyBox('Could not load this page',e.message||'Try again in a moment.');return}if(gone())return;SR.d=d;
 setActions(`<button class="primary" data-act="sr-add">${icon('plus',16)}Add a trusted person</button>`);
 const name=a=>ident(a).name||a,i0={n:0},row=html=>`<div class="row" ${st(i0.n++)}>${html}</div>`;
 // what needs someone now: paused agents and runs going
 const paused=d.agents.filter(a=>a.paused),running=d.agents.flatMap(a=>a.running);
 const need=[...paused.map(a=>row(`<div class="main-c">${agentAvatar(a.agent,32)}<div class="txt"><b>${esc(name(a.agent))}: self-runs paused</b><span>${a.paused.why==='cap'?'It reached today’s limit of '+a.cap+'. They start again tomorrow, or raise the limit.':'Its last 3 runs failed. Look at them below, then resume.'}</span></div></div><div class="act">${a.paused.why==='cap'?`<button class="ghost" data-act="sr-set" data-agent="${esc(a.agent)}">Raise the limit</button>`:''}<button class="primary" data-act="sr-resume" data-agent="${esc(a.agent)}">Resume</button></div>`)),
  ...running.map(r=>row(`<div class="main-c">${agentAvatar(r.agent,32)}<div class="txt"><b>${esc(r.reason)}</b><span>${esc(name(r.agent))} · ${esc(SR.by(r.by))} · since ${esc(SR.when(r.started||r.at))} · ${r.minutes} min at most</span></div></div><div class="act">${SR.chip(r.state)}<button class="ghost" data-act="sr-run" data-id="${esc(r.id)}">Details</button><button class="ghost" data-act="sr-stop" data-id="${esc(r.id)}">Stop</button></div>`))];
 const agents=d.agents.map(a=>row(`<div class="main-c">${agentAvatar(a.agent,32)}<div class="txt"><b>${esc(name(a.agent))}</b><span>${a.on?`Today ${a.today} of ${a.cap}`+(a.cron?'':' · not from schedules')+(a.chat?'':' · not from the aqeelOS chat'):'Switched off: it cannot run itself'}</span></div></div><div class="act"><button class="ghost" data-act="sr-set" data-agent="${esc(a.agent)}">Limits</button>${toggle(a.on,'Let '+name(a.agent)+' run itself',`data-act="sr-on" data-agent="${esc(a.agent)}"`)}</div>`));
 const people=[...d.codes.map(c=>row(`<div class="main-c"><span class="ic blue">${icon('clock',16)}</span><div class="txt"><b>Waiting for ${esc(c.name||'someone')} to send ${esc(c.code)}</b><span>Works until ${esc(SR.when(c.exp))}</span></div></div><div class="act"><button class="ghost" data-act="sr-code-cancel" data-code="${esc(c.code)}">Cancel</button></div>`)),
  ...d.trusted.map(t=>row(`<div class="main-c"><span class="ic">${icon(t.platform==='telegram'?'telegram':'chat',16)}</span><div class="txt"><b>${esc(t.name)}</b><span>${esc(SR.pf[t.platform]||t.platform)} · ${esc(SR.mask(t.uid))} · added ${esc(SR.when(t.at))}</span></div></div><div class="act"><button class="ghost" data-act="sr-untrust" data-id="${esc(t.id)}" data-name="${esc(t.name)}">Remove</button></div>`))];
 const runs=d.recent.filter(r=>r.state!=='running'&&r.state!=='waiting').map(r=>row(`<div class="main-c">${agentAvatar(r.agent,28)}<div class="txt"><b>${esc(r.reason)}</b><span>${esc(name(r.agent))} · ${esc(SR.by(r.by))} · ${esc(SR.when(r.at))}${r.secs!=null?' · '+SR.dur(r.secs):''}</span></div></div><div class="act">${SR.chip(r.state)}<button class="ghost" data-act="sr-run" data-id="${esc(r.id)}">Details</button></div>`));
 const refused=d.refused.slice(0,6).map(e=>row(`<div class="main-c"><span class="ic">${icon('shield',16)}</span><div class="txt"><b>${esc(name(e.agent))}: ${esc(SR.by(e.by)||'unknown chat')}</b><span>${esc(e.why||'')} · ${esc(SR.when(e.at))}</span></div></div><div class="act"></div>`));
 const sec=(title,hint,rows,empty)=>`<h2 class="ach-cat" style="margin-top:22px">${title}</h2>${hint?`<p class="hint" style="margin:0 0 10px">${hint}</p>`:''}${rows.length?`<div class="card list">${rows.join('')}</div>`:`<p class="hint">${empty}</p>`}`;
 el.innerHTML=`<div class="sr-page">${need.length?`<div class="card list">${need.join('')}</div>`:''}
  ${sec('Agents','Each agent can start a fresh run of itself to test or redo its work, as its own user in its own folder. At most 2 at once, 25 minutes each. It may be asked from the aqeelOS chat by people who can edit it, from its own schedules, and by trusted people. Never from webhooks.',agents,'No agent can run itself yet: it needs its own user on the AI box, which every agent but the main one gets.')}
  ${sec('Trusted people','People who may ask an agent to run itself from Telegram, WhatsApp or another channel. Add one with a code they send from their own chat.',people,'Nobody yet. Until you add someone, only the aqeelOS chat and schedules can start runs.')}
  ${sec('Runs','The prompt’s start, who asked and how it ended. Kept 30 days.',runs,'No runs yet.')}
  ${refused.length?sec('Refused lately','Someone asked an agent to run itself and was not allowed.',refused,''):''}</div>`;
 // while a run is going or a code is waiting, the page stays current by itself
 clearTimeout(Pages._srT);if(running.length||d.codes.length)Pages._srT=setTimeout(()=>{if(!gone()&&route().page?.id==='selfruns'&&!document.hidden&&!$('.drawer,.scrim'))(pageRun(el),PAGES.selfruns(p,el)).catch(()=>{})},5000)};

ACT['sr-on']=async b=>{const on=b.checked;b.disabled=true;try{await UI('/ui/self-runs/settings',{method:'POST',body:{agent:b.dataset.agent,on}});toast(on?'It can run itself again':'Switched off');reload()}catch(e){b.checked=!on;fail(e)}finally{b.disabled=false}};
ACT['sr-resume']=async b=>{b.disabled=true;try{await UI('/ui/self-runs/resume',{method:'POST',body:{agent:b.dataset.agent}});toast('Resumed');reload()}catch(e){b.disabled=false;fail(e)}};
ACT['sr-stop']=async b=>{if(!await confirmBox('Stop this run?','The agent’s run ends now. What it already did stays done.','Stop'))return;b.disabled=true;try{await UI('/ui/self-runs/stop',{method:'POST',body:{id:b.dataset.id}});toast('Stopping');setTimeout(reload,1500)}catch(e){b.disabled=false;fail(e)}};
ACT['sr-code-cancel']=async b=>{b.disabled=true;try{await UI('/ui/self-runs/code/cancel',{method:'POST',body:{code:b.dataset.code}});reload()}catch(e){b.disabled=false;fail(e)}};
ACT['sr-untrust']=async b=>{if(!await confirmBox('Remove '+b.dataset.name+'?','They can no longer ask agents to run themselves. Add them again any time with a new code.','Remove'))return;b.disabled=true;try{await UI('/ui/self-runs/untrust',{method:'POST',body:{id:b.dataset.id}});toast('Removed');reload()}catch(e){b.disabled=false;fail(e)}};
// limits: a dialog for one agent (daily limit, and where runs may be asked from)
ACT['sr-set']=async b=>{const a=(SR.d?.agents||[]).find(x=>x.agent===b.dataset.agent);if(!a)return;const nm=ident(a.agent).name||a.agent;
 const {d,close}=stackPop(nm+': limits',`<label for="srCap">Runs a day at most</label><input id="srCap" type="number" inputmode="numeric" min="1" max="500" value="${a.cap}">
  <p class="hint" style="margin:6px 0 16px">Reaching it pauses its self-runs until tomorrow and tells you on Telegram. 3 failed runs in a row also pause them, until you resume.</p>
  <div class="row" style="padding:10px 0;border:0"><div class="main-c"><div class="txt"><b>From its schedules</b><span>Its own scheduled jobs may start runs</span></div></div><div class="act">${toggle(a.cron,'From its schedules','id="srCron"')}</div></div>
  <div class="row" style="padding:10px 0"><div class="main-c"><div class="txt"><b>From the aqeelOS chat</b><span>People who can edit ${esc(nm)} may ask in the aqeelOS chat</span></div></div><div class="act">${toggle(a.chat,'From the aqeelOS chat','id="srChat"')}</div></div>`,
  `<button class="ghost" data-x>Cancel</button><button class="primary" id="srSave">Save</button>`);
 d.querySelector('#srSave').onclick=async e=>{const s=e.currentTarget;s.disabled=true;try{await UI('/ui/self-runs/settings',{method:'POST',body:{agent:a.agent,cap:Number(d.querySelector('#srCap').value),cron:d.querySelector('#srCron').checked,chat:d.querySelector('#srChat').checked}});close();toast('Saved');reload()}catch(er){s.disabled=false;fail(er)}};
 setTimeout(()=>d.querySelector('#srCap')?.focus(),40)};
// a trusted person: they send a one-time code to any agent from their own chat; the page waits until it arrives
ACT['sr-add']=async()=>{const {d,close}=stackPop('Add a trusted person',`<label for="srWho">Their name</label><input id="srWho" maxlength="60" placeholder="e.g. Sam" autocomplete="off">
  <p class="hint" style="margin:8px 0 0">You get a short code. They send it as a message to any agent from their own Telegram, WhatsApp or other chat, and that chat becomes trusted. The code works once, for 15 minutes.</p>`,
  `<button class="ghost" data-x>Cancel</button><button class="primary" id="srMake">Get the code</button>`);
 setTimeout(()=>d.querySelector('#srWho')?.focus(),40);let timer=null;d.addEventListener('cancel',()=>clearInterval(timer));
 d.querySelector('#srMake').onclick=async e=>{const btn=e.currentTarget;btn.disabled=true;let c;try{c=await UI('/ui/self-runs/code',{method:'POST',body:{name:d.querySelector('#srWho').value}})}catch(er){btn.disabled=false;return fail(er)}
  const before=(SR.d?.trusted||[]).length;
  d.querySelector('.drawer-body').innerHTML=`<p style="margin:0 0 10px;color:var(--ink-2)">Have them send exactly this message to any agent:</p>
   <div style="display:flex;gap:8px;align-items:center"><code style="font-size:20px;letter-spacing:.06em;padding:10px 14px;border-radius:var(--r-md);background:var(--soft,#f1f2f5);flex:1;text-align:center">${esc(c.code)}</code><button class="ghost icon" id="srCopy" aria-label="Copy the code">${icon('copy',17)}</button></div>
   <p class="hint sr-wait" style="margin:12px 0 0">${icon('clock',13)} Waiting for it to arrive. Works until ${esc(SR.when(c.exp))}.</p>`;
  d.querySelector('.drawer-foot').innerHTML=`<button class="ghost" data-x2>Close</button>`;d.querySelector('[data-x2]').onclick=()=>{clearInterval(timer);close();reload()};
  d.querySelector('#srCopy').onclick=()=>{navigator.clipboard?.writeText(c.code).then(()=>toast('Code copied'),()=>{})};
  timer=setInterval(async()=>{if(!d.isConnected)return clearInterval(timer);const x=await UI('/ui/self-runs').catch(()=>null);if(!x)return;
   if(x.trusted.length>before){clearInterval(timer);const t=x.trusted[x.trusted.length-1];const w=d.querySelector('.sr-wait');if(w)w.innerHTML=`<span style="color:var(--ok,#1f6b3a)">${icon('check',14)} ${esc(t.name)} on ${esc(SR.pf[t.platform]||t.platform)} is trusted now.</span>`;toast(t.name+' is trusted now');setTimeout(()=>{if(d.isConnected){close();reload()}},1600)}
   else if(!x.codes.some(k=>k.code===c.code)){clearInterval(timer);const w=d.querySelector('.sr-wait');if(w)w.textContent='The code expired or was cancelled. Make a new one.'}},3000)}};
// one run: what it was asked, who asked, how it ended, its last output
ACT['sr-run']=async b=>{let r;try{r=await UI('/ui/self-runs/run?id='+encodeURIComponent(b.dataset.id))}catch(e){return fail(e)}
 const line=(k,v)=>v?`<div style="display:grid;grid-template-columns:120px 1fr;gap:10px;padding:6px 0"><span class="hint">${k}</span><span>${v}</span></div>`:'';
 drawer('Run '+r.id,`${SR.chip(r.state)}<div style="margin-top:12px">${line('Agent',esc(ident(r.agent).name||r.agent))}${line('Asked by',esc(SR.by(r.by)))}${line('Why',esc(r.reason))}${line('Started',esc(SR.when(r.started||r.at)))}${line('Took',esc(SR.dur(r.secs)))}${line('Time limit',r.minutes+' min')}${line('Lock',r.lock?'<code>'+esc(r.lock)+'</code>':'')}${line('Exit code',r.exit!=null&&r.state!=='ok'?esc(String(r.exit)):'')}${line('Stopped by',esc(r.stoppedBy||''))}${line('Note',esc(r.error||''))}</div>
  <h3 style="margin:16px 0 6px;font-size:14px">The prompt (its start)</h3><pre style="white-space:pre-wrap;margin:0;font-size:12.5px">${esc(r.prompt)}</pre>
  ${r.answer?`<h3 style="margin:16px 0 6px;font-size:14px">Its last output</h3><pre style="white-space:pre-wrap;margin:0;font-size:12.5px;max-height:50vh;overflow:auto">${esc(r.answer)}</pre>`:''}`,'',{side:true})};
