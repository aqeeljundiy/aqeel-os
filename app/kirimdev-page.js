/* Channels › Connections: WhatsApp lines through Kirimdev (kirimdev.mjs, 5 Nov 2026), for admins. One row per line:
   who answers it, Test (only its testers get answers), Draft (replies wait for a person to approve) or Live (every
   customer), whether Kirimdev's messages arrive, the quiet time after a team member replies, chats paused now and
   drafts waiting. Below: the Team group of the agent shown (team-group.mjs), where its questions, orders and logs go. */
const Kirim={
 when:t=>{if(!t)return '';const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?tm:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+tm},
 modeText:l=>l.mode==='live'?'Live: answers every customer.':l.mode==='draft'?'Draft: writes every reply, a person approves it in Telegram or here before it is sent.':'Test: answers only '+esc(l.testers.join(', ')||'its testers')+'.',
 line:(l,i)=>`<div class="row kd-line" ${st(i)}><div class="main-c">${agentAvatar(l.agent,32)}<div class="txt"><b>${esc(l.persona)} · ${esc(l.business)}</b>
   <span>${Kirim.modeText(l)} ${l.connected?(l.last?'Last message '+esc(Kirim.when(l.last))+'.':'Connected, no message yet.'):'Not connected: Kirimdev does not send it messages yet.'}</span>
   <span>Waits ${l.pauseMin} min after a team member replies in a chat${l.connected&&!l.hearsTeam?' (not yet: Kirimdev does not send team replies here; it is added at the next start)':''}.${l.team?'':' No team group set: handoffs cannot be posted.'}${l.handoffsWaiting?' '+l.handoffsWaiting+' handoff'+(l.handoffsWaiting===1?'':'s')+' waiting to be posted (tried again by itself).':''}</span>
   ${l.paused.length?`<span>Paused now: ${l.paused.map(p=>esc(p.who)+' until '+esc(Kirim.when(p.until))).join(', ')}.</span>`:''}</div></div>
   <div class="act"><div class="seg-mini" role="group" aria-label="Mode">${['test','draft','live'].map(m=>`<button data-act="kd-mode" data-agent="${esc(l.agent)}" data-mode="${m}" class="${l.mode===m?'on':''}" aria-pressed="${l.mode===m}">${m==='test'?'Test':m==='draft'?'Draft':'Live'}</button>`).join('')}</div>
   <button class="ghost" data-act="kd-pause" data-agent="${esc(l.agent)}" data-min="${l.pauseMin}">Quiet time</button>
   ${l.connected?'':`<button class="primary" data-act="kd-connect" data-agent="${esc(l.agent)}">Connect</button>`}</div></div>`+
  l.drafts.map(d=>`<div class="row kd-draft"><div class="main-c"><div class="txt"><b>Draft #${d.id} for ${esc(d.name)} (${esc(d.who)}) · ${esc(Kirim.when(d.at))}</b><span class="kd-text">${esc(d.text)}</span>
   ${d.posted?'':'<span>Not posted in Telegram: decide here.</span>'}${d.canSend?'':'<span>The customer last wrote over 24 hours ago, so WhatsApp no longer allows a reply.</span>'}</div></div>
   <div class="act"><button class="ghost" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="discard">Drop</button>${d.canSend?`<button class="primary" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="send">Send</button>`:''}</div></div>`).join(''),
 async show(el){if(S.me?.admin===false)return;let d;try{d=await UI('/ui/kirimdev')}catch{return}
  const a=showingAll()?'':viewing();const lines=(d.lines||[]).filter(l=>!a||l.agent===a);
  let box=el.querySelector('.kd-box');if(!lines.length)box?.remove();
  else{if(!box){box=document.createElement('div');box.className='panel kd-box';el.append(box)}
   box.innerHTML=`<h2>WhatsApp through Kirimdev</h2>`+lines.map(Kirim.line).join('')}
  Team.show(el,a?[a]:lines.map(l=>l.agent))},
 refresh:b=>{const el=b.closest('.kd-box,.tg-box')?.parentElement;if(el)Kirim.show(el)}};
const Team={
 sum:(g,roles)=>g?.chatId?`${esc(g.name||'Group')} (${esc(g.chatId)}) · `+roles.map(r=>esc(r.label)+' '+(g.topics?.[r.key]!=null?esc(g.topics[r.key]):'not set')).join(' · ')+(g.mention?' · mentions '+esc(g.mention):''):'Not set yet. Questions, orders and logs have nowhere to go.',
 async show(el,agents){let box=el.querySelector('.tg-box');if(!agents.length){box?.remove();return}
  const got=await Promise.all(agents.map(a=>UI('/ui/team-group?agent='+encodeURIComponent(a)).then(r=>[a,r]).catch(()=>null)));const ok=got.filter(Boolean);if(!ok.length){box?.remove();return}
  if(!box){box=document.createElement('div');box.className='panel tg-box';el.append(box)}
  box.innerHTML=`<h2>Team group</h2><p class="hint">The Telegram group and topics this agent uses for questions, orders and logs. The agent reads it from here, not from its instructions, and changes it when the owner tells it to in chat.</p>`+
   ok.map(([a,r],i)=>`<div class="row" ${st(i)}><div class="main-c">${agentAvatar(a,32)}<div class="txt"><b>${esc(ident(a).name||a)}</b><span>${Team.sum(r.group,r.roles)}</span>${r.group?.by?`<span>Changed by ${esc(r.group.by)}, ${esc(Kirim.when(r.group.at))}.</span>`:''}</div></div>
    <div class="act"><button class="ghost" data-act="tg-edit" data-agent="${esc(a)}">${r.group?.chatId?'Change':'Set it'}</button></div></div>`).join('');
  Team.cache=Object.fromEntries(ok)},
 edit(agent){const r=Team.cache?.[agent]||{group:null,roles:[]};const g=r.group||{topics:{}};
  const f=(id,label,v,ph='')=>`<label for="tg-${id}">${esc(label)}</label><input id="tg-${id}" value="${esc(v??'')}" placeholder="${esc(ph)}" autocomplete="off">`;
  const {d,close}=stackPop('Team group',f('name','Group name',g.name,'Continue')+f('chatId','Group id',g.chatId,'-1003999095054')+
   r.roles.map(x=>f(x.key,x.label+' topic: '+x.what,g.topics?.[x.key],'e.g. 3')).join('')+f('mention','Who to mention for a person',g.mention,'@name @name'),
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="tg-ok">Save</button>`);
  d.querySelector('#tg-ok').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const v=k=>d.querySelector('#tg-'+k).value.trim();
   const body={agent,name:v('name'),chatId:v('chatId'),mention:v('mention'),topics:Object.fromEntries(r.roles.map(x=>[x.key,v(x.key)]))};
   try{await UI('/ui/team-group',{method:'POST',body});close();toast('Saved. The agent uses it from now on.');const el=document.querySelector('.tg-box')?.parentElement;if(el)Kirim.show(el)}catch(err){b.disabled=false;toast(err.message||'Could not save it')}};
  setTimeout(()=>d.querySelector('#tg-name')?.focus(),30)}};
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if((S.tab.channels||'Connections')!=='Connections')return;Kirim.show(el)}}
ACT['kd-connect']=async b=>{b.disabled=true;try{await UI('/ui/kirimdev/connect',{method:'POST',body:{agent:b.dataset.agent}});toast('Connected. Kirimdev now sends this line’s messages here.');Kirim.refresh(b)}catch(e){b.disabled=false;toast(e.message||'Could not connect it')}};
ACT['kd-mode']=async b=>{const m=b.dataset.mode;if(b.classList.contains('on'))return;
 if(m==='live'&&!await confirmBox('Answer every customer?','From now on this agent answers every customer who writes to this WhatsApp number, not only the testers.','Go live',false))return;
 if(m==='draft'&&!await confirmBox('Draft every reply?','The agent writes a reply for every customer who writes to this number and posts it in the team group’s Questions topic. Nothing reaches a customer until a person approves it there or here.','Use Draft',false))return;
 b.disabled=true;try{await UI('/ui/kirimdev/mode',{method:'POST',body:{agent:b.dataset.agent,mode:m}});toast(m==='live'?'Live: it answers every customer now.':m==='draft'?'Draft: replies wait for a person to approve them.':'Test: only testers get answers.');Kirim.refresh(b)}catch(e){b.disabled=false;toast(e.message||'Could not change it')}};
ACT['kd-pause']=async b=>{const v=await promptBox('Quiet time after a team reply','Minutes the agent stays quiet in a chat after a team member writes there (0 = never)',b.dataset.min,'Save');if(v==null)return;
 try{const r=await UI('/ui/kirimdev/pause',{method:'POST',body:{agent:b.dataset.agent,min:Number(v)}});toast('The agent now waits '+r.pauseMin+' min after a team reply.');Kirim.refresh(b)}catch(e){toast(e.message||'Could not change it')}};
ACT['kd-draft']=async b=>{const send=b.dataset.do==='send';
 if(send&&!await confirmBox('Send this draft?','It goes to the customer on WhatsApp now, exactly as shown.','Send',false))return;
 b.disabled=true;try{await UI('/ui/kirimdev/draft',{method:'POST',body:{agent:b.dataset.agent,id:Number(b.dataset.id),action:b.dataset.do}});toast(send?'Sent to the customer.':'Dropped. Nothing was sent.');Kirim.refresh(b)}catch(e){b.disabled=false;toast(e.message||'Could not do it')}};
ACT['tg-edit']=b=>Team.edit(b.dataset.agent);
