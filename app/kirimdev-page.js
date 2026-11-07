/* Channels › Kirimdev (7 Nov 2026, was a box on Channels › Connections). Kirimdev is the team's WhatsApp CRM, not one of
   the agents' channels: the owner, "Kirimdev is WhatsApp CRM. Kirimdev we only use API key, desktop ver is a bonus if
   we want to setup webhook or something." So the page starts with the API key (what it is, whether Kirimdev takes it,
   Change key), then one row per Kirimdev line (kirimdev.mjs): who answers it, Test (only its testers get answers), Draft
   (a person approves every reply) or Live (every customer), whether the Kirimdev API answers for it, the optional webhook
   (Connect webhook), the quiet time after a team member replies, chats paused now, drafts waiting, and where handoffs go
   (the Questions topic of the agent's team group, team-group.mjs). aqeelOS checks the key, the API and the webhooks every
   10 minutes; Check now runs it at once. The Team group box stays on Channels › Connections (it is Telegram). Admins only. */
const Kirim={
 when:t=>{if(!t)return '';const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?tm:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+tm},
 chip:(cls,t)=>`<span class="chip km-chip${cls?' '+cls:''}"><i class="dot"></i>${esc(t)}</span>`,
 modeText:l=>l.mode==='live'?'Live: answers every customer.':l.mode==='draft'?'Draft: writes every reply; a person approves it in Telegram or here before it is sent.':'Test: answers only '+(l.testers.join(', ')||'its testers')+'.',
 acct(d){const a=d.account;
  const [cls,label]=!d.keySaved&&!a?.ok?['bad','No key']:!a?['','Not checked yet']:a.ok?['ok','Working']:a.why==='key'?['bad','Key refused']:a.why==='nokey'?['bad','No key']:['warn','Not answering'];
  const who=a?.ok?[a.org,a.label?'key “'+a.label+'”':'',a.last4?'ending '+a.last4:''].filter(Boolean).join(' · '):a?.text||(d.keySaved?'Saved; the first check runs within a minute.':'Add the API key from Kirimdev (Settings, API keys) to connect.');
  return `<div class="km-acct"><div class="km-id">${logoImg('kirimdev.com','K')}<div class="txt"><b>Kirimdev API</b><span>${esc(who)}</span>${a?.at?`<span class="km-at">Checked ${esc(Kirim.when(a.at))}</span>`:''}</div></div>
   <div class="km-act">${Kirim.chip(cls,label)}<button class="${d.keySaved?'ghost':'primary'}" data-act="km-key">${icon('key',15)}${d.keySaved?'Change key':'Add key'}</button></div></div>`},
 api(h){if(!h?.api)return ['', 'Not checked yet'];if(h.api.ok)return ['ok','API answers'];return [h.api.why==='key'||h.api.why==='nokey'?'bad':'warn',h.api.why==='key'?'Key refused':h.api.why==='nokey'?'No key':'API not answering']},
 hook(l){const w=l.health?.webhook;if(!l.connected)return ['','No webhook'];if(!w)return ['ok','Webhook on'];
  return {ok:['ok','Webhook delivering'],none:['','No webhook'],off:['bad','Webhook off'],late:['warn','Messages not arriving'],failing:['warn','Webhook failing'],unknown:['warn','Webhook unknown']}[w.state]||['','Webhook']},
 line(l,team){const [ac,at]=Kirim.api(l.health),[hc,ht]=Kirim.hook(l),h=l.health||{};
  const facts=[Kirim.modeText(l),
   h.api&&!h.api.ok?h.api.text:'',
   !l.connected?'No webhook yet. Optional: with one, Kirimdev tells aqeelOS about each customer message and the agent answers at once.':h.webhook&&h.webhook.state!=='ok'&&h.webhook.state!=='none'?h.webhook.text:l.last?'Last customer message '+Kirim.when(l.last)+'.':'Webhook on; no customer message yet.',
   l.connected&&!l.hearsTeam?'Team replies are not sent here yet; added at the next start.':'',
   'Quiet for '+l.pauseMin+' min after a team member replies in a chat.',
   team?'Handoffs go to '+(team.name||'the team group')+(team.topics?.questions!=null?', Questions topic '+team.topics.questions:'')+'.':'No team group set, so handoffs cannot be posted.',
   l.handoffsWaiting?l.handoffsWaiting+' handoff'+(l.handoffsWaiting===1?'':'s')+' waiting to be posted (tried again by itself).':'',
   l.paused.length?'Paused now: '+l.paused.map(p=>p.who+' until '+Kirim.when(p.until)).join(', ')+'.':''].filter(Boolean);
  return `<div class="km-line" data-line="${esc(l.agent)}"><div class="km-id">${agentAvatar(l.agent,36)}<div class="txt"><b>${esc(l.persona)} · ${esc(l.business)}</b>
    <div class="km-chips">${Kirim.chip(ac,at)}${Kirim.chip(hc,ht)}</div>${facts.map(f=>`<p>${esc(f)}</p>`).join('')}
    ${l.connected?'':`<button class="ghost km-hook" data-act="kd-connect" data-agent="${esc(l.agent)}">${icon('link',15)}Connect webhook</button>`}</div></div>
   <div class="km-act"><div class="seg-mini" role="group" aria-label="Mode">${['test','draft','live'].map(m=>`<button data-act="kd-mode" data-agent="${esc(l.agent)}" data-mode="${m}" class="${l.mode===m?'on':''}" aria-pressed="${l.mode===m}">${m==='test'?'Test':m==='draft'?'Draft':'Live'}</button>`).join('')}</div>
    <button class="ghost icon" data-act="km-more" data-agent="${esc(l.agent)}" aria-label="More for ${esc(l.persona)}">${icon('more',18)}</button></div></div>`+
  l.drafts.map(d=>`<div class="km-draft" data-draft="${d.id}"><div class="txt"><b>Draft #${d.id} for ${esc(d.name)} (${esc(d.who)}) · ${esc(Kirim.when(d.at))}</b><p class="km-text">${esc(d.text)}</p>
    ${d.posted?'':'<p>Not posted in Telegram: decide here.</p>'}${d.canSend?'':'<p>The customer last wrote over 24 hours ago, so WhatsApp no longer allows a reply.</p>'}</div>
   <div class="km-act"><button class="ghost" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="discard">Drop</button>${d.canSend?`<button class="primary" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="send">Send</button>`:''}</div></div>`).join('')},
 // first paint rises in; later paints change only what changed, with a short fade, so the page never jumps
 paint(el,d,teams){Kirim.d=d;const lines=d.lines||[];
  const parts={acct:Kirim.acct(d),lines:lines.length?lines.map(l=>Kirim.line(l,teams[l.agent])).join(''):`<p class="hint km-none">No Kirimdev line yet. A line is a business number in Kirimdev that an agent answers; it is set up with the agent in aqeelOS.</p>`};
  let root=el.querySelector('.km');
  if(!root){el.innerHTML=`<div class="km"><div class="panel card km-p" ${st(0)}><h2>Connection</h2><p class="sub">One key for every Kirimdev line. It is separate from the agents’ own WhatsApp channel on Channels.</p><div data-part="acct"></div></div>
    <div class="panel card km-p" ${st(1)}><h2>Kirimdev lines</h2><p class="sub">Each line is a business number in Kirimdev and the agent that answers it. aqeelOS checks the API and each webhook every 10 minutes and puts a problem on System › Health.</p><div data-part="lines"></div></div></div>`;root=el.querySelector('.km')}
  for(const [k,html] of Object.entries(parts)){const box=root.querySelector(`[data-part="${k}"]`);if(box._html===html)continue;const first=box._html==null;box._html=html;box.innerHTML=html;if(!first){box.classList.remove('km-fresh');void box.offsetWidth;box.classList.add('km-fresh')}}},
 async show(el){const gone=pageTok(el);
  if(S.me?.admin===false){el.innerHTML=emptyBox('Only admins','Kirimdev holds the team’s API key, so only admins see it.');return}
  setActions(`<button class="ghost" data-act="km-check">${icon('refresh',15)}Check now</button>`);
  if(!el.querySelector('.km'))el.innerHTML='<div class="skel" style="height:150px;border-radius:18px;margin-bottom:16px"></div><div class="skel" style="height:220px;border-radius:18px"></div>';
  let d;try{d=await UI('/ui/kirimdev')}catch(e){if(!gone())el.innerHTML=emptyBox('Kirimdev did not load',e.message||'Try again in a moment.');return}if(gone())return;
  const teams={};await Promise.all((d.lines||[]).map(l=>UI('/ui/team-group?agent='+encodeURIComponent(l.agent)).then(r=>{teams[l.agent]=r.group;(Team.cache||={})[l.agent]=r}).catch(()=>{})));if(gone())return;
  Kirim.paint(el,d,teams)},
 refresh(){const el=document.querySelector('.km')?.parentElement;if(el)return Kirim.show(el);const ch=document.querySelector('.tg-box')?.parentElement;if(ch)Team.show(ch,Team.agents||[])}};
const Team={
 sum:(g,roles)=>g?.chatId?`${esc(g.name||'Group')} (${esc(g.chatId)}) · `+roles.map(r=>esc(r.label)+' '+(g.topics?.[r.key]!=null?esc(g.topics[r.key]):'not set')).join(' · ')+(g.mention?' · mentions '+esc(g.mention):''):'Not set yet. Questions, orders and logs have nowhere to go.',
 async show(el,agents){Team.agents=agents;let box=el.querySelector('.tg-box');if(!agents.length){box?.remove();return}
  const got=await Promise.all(agents.map(a=>UI('/ui/team-group?agent='+encodeURIComponent(a)).then(r=>[a,r]).catch(()=>null)));const ok=got.filter(Boolean);if(!ok.length){box?.remove();return}
  if(!box){box=document.createElement('div');box.className='panel tg-box';el.append(box)}
  box.innerHTML=`<h2>Team group</h2><p class="hint">The Telegram group and topics this agent uses for questions, orders and logs. The agent reads it from here, not from its instructions, and changes it when the owner tells it to in chat.</p>`+
   ok.map(([a,r],i)=>`<div class="row" ${st(i)}><div class="main-c">${agentAvatar(a,32)}<div class="txt"><b>${esc(ident(a).name||a)}</b><span>${Team.sum(r.group,r.roles)}</span>${r.group?.by?`<span>Changed by ${esc(r.group.by)}, ${esc(Kirim.when(r.group.at))}.</span>`:''}</div></div>
    <div class="act"><button class="ghost" data-act="tg-edit" data-agent="${esc(a)}">${r.group?.chatId?'Change':'Set it'}</button></div></div>`).join('');
  Team.cache={...(Team.cache||{}),...Object.fromEntries(ok)}},
 edit(agent){const r=Team.cache?.[agent]||{group:null,roles:[]};const g=r.group||{topics:{}};
  const f=(id,label,v,ph='')=>`<label for="tg-${id}">${esc(label)}</label><input id="tg-${id}" value="${esc(v??'')}" placeholder="${esc(ph)}" autocomplete="off">`;
  const {d,close}=stackPop('Team group',f('name','Group name',g.name,'Support team')+f('chatId','Group id',g.chatId,'-1001234567890')+
   r.roles.map(x=>f(x.key,x.label+' topic: '+x.what,g.topics?.[x.key],'e.g. 3')).join('')+f('mention','Who to mention for a person',g.mention,'@name @name'),
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="tg-ok">Save</button>`);
  d.querySelector('#tg-ok').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const v=k=>d.querySelector('#tg-'+k).value.trim();
   const body={agent,name:v('name'),chatId:v('chatId'),mention:v('mention'),topics:Object.fromEntries(r.roles.map(x=>[x.key,v(x.key)]))};
   try{await UI('/ui/team-group',{method:'POST',body});close();toast('Saved. The agent uses it from now on.');Kirim.refresh()}catch(err){b.disabled=false;toast(err.message||'Could not save it')}};
  setTimeout(()=>d.querySelector('#tg-name')?.focus(),30)}};
PAGES.kirimdev=async(p,el)=>{viewPick([]);await Kirim.show(el)};
// Channels › Connections keeps the Team group (Telegram) of the agents with a Kirimdev line; the lines themselves are on Kirimdev
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if((S.tab.channels||'Connections')!=='Connections'||S.me?.admin===false)return;
 let d;try{d=await UI('/ui/kirimdev')}catch{return}if(gone())return;const a=showingAll()?'':viewing();Team.show(el,(d.lines||[]).map(l=>l.agent).filter(x=>!a||x===a))}}
ACT['km-check']=async b=>{b.disabled=true;b.classList.add('busy');try{await UI('/ui/kirimdev/check',{method:'POST',body:{}});await Kirim.refresh();toast('Checked just now.')}catch(e){fail(e)}finally{b.disabled=false;b.classList.remove('busy')}};
ACT['km-key']=()=>{const has=Kirim.d?.keySaved;
 const {d,close}=stackPop(has?'Change the Kirimdev API key':'Add the Kirimdev API key',`<p class="hint" style="margin:0 0 12px">In Kirimdev, open Settings, then API keys, and copy a key. aqeelOS checks it with Kirimdev before it saves it, so a wrong key never replaces a working one. It is kept on the AI box and never shown again.</p>
  <label for="km-k">API key</label><input id="km-k" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key"><p class="km-err" role="alert"></p>`,
  `<button class="ghost" data-x>Cancel</button><button class="primary" id="km-ok">Check and save</button>`);
 const inp=d.querySelector('#km-k'),ok=d.querySelector('#km-ok'),err=d.querySelector('.km-err');
 const go=async()=>{const v=inp.value.trim();if(!v){inp.focus();return}ok.disabled=true;ok.textContent='Checking…';err.textContent='';
  try{await UI('/ui/kirimdev/key',{method:'POST',body:{key:v}});close();toast('Saved. Kirimdev took the key.');Kirim.refresh()}catch(e){err.textContent=e.message||'Could not save it';ok.disabled=false;ok.textContent='Check and save';inp.select()}};
 ok.onclick=go;inp.onkeydown=e=>{if(e.key==='Enter')go()};setTimeout(()=>inp.focus(),30)};
ACT['km-more']=b=>{const l=(Kirim.d?.lines||[]).find(x=>x.agent===b.dataset.agent);if(!l)return;
 menu(b,[{label:'Quiet time after a team reply',icon:'clock',run:()=>ACT['kd-pause']({dataset:{agent:l.agent,min:l.pauseMin}})},
  {label:'Team group',icon:'telegram',run:()=>Team.edit(l.agent)},
  {label:l.connected?'Connect the webhook again':'Connect webhook',icon:'link',run:()=>ACT['kd-connect']({dataset:{agent:l.agent},disabled:false})}])};
ACT['kd-connect']=async b=>{b.disabled=true;try{await UI('/ui/kirimdev/connect',{method:'POST',body:{agent:b.dataset.agent}});toast('Webhook on. Kirimdev now tells aqeelOS about this line’s messages.');Kirim.refresh()}catch(e){b.disabled=false;toast(e.message||'Could not connect it','err')}};
ACT['kd-mode']=async b=>{const m=b.dataset.mode;if(b.classList.contains('on'))return;
 if(m==='live'&&!await confirmBox('Answer every customer?','From now on this agent answers every customer who writes to this Kirimdev line, not only the testers.','Go live',false))return;
 if(m==='draft'&&!await confirmBox('Draft every reply?','The agent writes a reply for every customer who writes to this line and posts it in the team group’s Questions topic. Nothing reaches a customer until a person approves it there or here.','Use Draft',false))return;
 b.disabled=true;try{await UI('/ui/kirimdev/mode',{method:'POST',body:{agent:b.dataset.agent,mode:m}});toast(m==='live'?'Live: it answers every customer now.':m==='draft'?'Draft: replies wait for a person to approve them.':'Test: only testers get answers.');Kirim.refresh()}catch(e){b.disabled=false;toast(e.message||'Could not change it','err')}};
ACT['kd-pause']=async b=>{const v=await promptBox('Quiet time after a team reply','Minutes the agent stays quiet in a chat after a team member writes there (0 = never)',b.dataset.min,'Save');if(v==null)return;
 try{const r=await UI('/ui/kirimdev/pause',{method:'POST',body:{agent:b.dataset.agent,min:Number(v)}});toast('The agent now waits '+r.pauseMin+' min after a team reply.');Kirim.refresh()}catch(e){toast(e.message||'Could not change it','err')}};
// a draft that was sent or dropped folds away first, then the page catches up
ACT['kd-draft']=async b=>{const send=b.dataset.do==='send';
 if(send&&!await confirmBox('Send this draft?','It goes to the customer now, exactly as shown.','Send',false))return;
 b.disabled=true;try{await UI('/ui/kirimdev/draft',{method:'POST',body:{agent:b.dataset.agent,id:Number(b.dataset.id),action:b.dataset.do}});toast(send?'Sent to the customer.':'Dropped. Nothing was sent.');
  const row=b.closest('.km-draft');if(row){row.style.height=row.offsetHeight+'px';void row.offsetHeight;row.classList.add('km-gone');await new Promise(r=>setTimeout(r,260))}Kirim.refresh()}catch(e){b.disabled=false;toast(e.message||'Could not do it','err')}};
ACT['tg-edit']=b=>Team.edit(b.dataset.agent);
