/* Channels › Kirimdev (7 Nov 2026, was a box on Channels › Connections). Kirimdev is the team's WhatsApp CRM, not one of
   the agents' channels: the owner, "Kirimdev is WhatsApp CRM. Kirimdev we only use API key, desktop ver is a bonus if
   we want to setup webhook or something." So the page starts with the API key (what it is, whether Kirimdev takes it,
   Change key), then one row per Kirimdev line (kirimdev.mjs): who answers it, Test (only its testers get answers), Draft
   (a person approves every reply) or Live (every customer), whether the Kirimdev API answers for it, the optional webhook
   (Connect webhook), the quiet time after a team member replies, chats paused now, drafts waiting, and where handoffs go
   (the Questions topic of the agent's team group, team-group.mjs). aqeelOS checks the key, the API and the webhooks every
   10 minutes; Check now runs it at once. The Team group box stays on Channels › Connections (it is Telegram). Admins only.
   Plug and play (7 Nov 2026): the numbers come from Kirimdev itself once the key is saved. A number nobody answers has
   Connect, a setup dialog (agent or a new support agent, testers, handoff group and topic, language, quiet time, reset,
   payments); every setting is editable later from the line's ⋯ menu, with Disconnect, Renew webhook secret and Send test
   message. Without a public address the line shows "Checking every 20 s" (polling) instead of "Webhook". */
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
 hook(l){if(l.gone)return ['bad','No longer in Kirimdev'];if(l.delivery==='poll')return [l.pollError?'warn':'ok','Checking every 20 s'];const w=l.health?.webhook;if(!w)return ['ok','Webhook'];
  return {ok:['ok','Webhook'],none:['ok','Checking every 20 s'],off:['bad','Webhook off'],late:['warn','Messages not arriving'],failing:['warn','Webhook failing'],unknown:['warn','Webhook unknown']}[w.state]||['','Webhook']},
 line(l,team){const [ac,at]=Kirim.api(l.health),[hc,ht]=Kirim.hook(l),h=l.health||{};
  const facts=[Kirim.modeText(l),
   h.api&&!h.api.ok?h.api.text:'',
   l.gone?'Kirimdev no longer has this number. Connect it in Kirimdev again, or disconnect the line.':'',
   l.gone?'':l.delivery==='poll'?(l.pollError?'The last look at Kirimdev failed: '+l.pollError:'No webhook: aqeelOS reads new messages from Kirimdev every 20 seconds'+(l.polledAt?', last look '+Kirim.when(l.polledAt):'')+'.')+(l.last?' Last customer message '+Kirim.when(l.last)+'.':'')
    :h.webhook&&!['ok','none'].includes(h.webhook.state)?h.webhook.text:l.last?'Last customer message '+Kirim.when(l.last)+'.':'Webhook on; no customer message yet.',
   l.connected&&!l.hearsTeam?'Team replies are not sent here yet; added at the next start.':'',
   'Quiet for '+l.pauseMin+' min after a team member replies in a chat.',
   team?'Handoffs go to '+(team.name||'the team group')+(team.topics?.questions!=null?', Questions topic '+team.topics.questions:'')+'.':'No team group set, so handoffs cannot be posted.',
   l.handoffsWaiting?l.handoffsWaiting+' handoff'+(l.handoffsWaiting===1?'':'s')+' waiting to be posted (tried again by itself).':'',
   l.paused.length?'Paused now: '+l.paused.map(p=>p.who+' until '+Kirim.when(p.until)).join(', ')+'.':''].filter(Boolean);
  return `<div class="km-line" data-line="${esc(l.agent)}"${l.phone?` data-phone="${esc(l.phone)}"`:''}><div class="km-id">${agentAvatar(l.agent,36)}<div class="txt"><b>${esc(l.persona)} · ${esc(l.business)}</b>${l.phone?`<span class="km-num-ph">${esc(l.phone)}</span>`:''}
    <div class="km-chips">${Kirim.chip(ac,at)}${Kirim.chip(hc,ht)}</div>${facts.map(f=>`<p>${esc(f)}</p>`).join('')}
    ${l.connected||Kirim.d?.reach?.ok===false||l.gone?'':`<button class="ghost km-hook" data-act="kd-connect" data-agent="${esc(l.agent)}">${icon('link',15)}Connect webhook</button>`}</div></div>
   <div class="km-act"><div class="seg-mini" role="group" aria-label="Mode">${['test','draft','live'].map(m=>`<button data-act="kd-mode" data-agent="${esc(l.agent)}" data-mode="${m}" class="${l.mode===m?'on':''}" aria-pressed="${l.mode===m}">${m==='test'?'Test':m==='draft'?'Draft':'Live'}</button>`).join('')}</div>
    <button class="ghost icon" data-act="km-more" data-agent="${esc(l.agent)}" aria-label="More for ${esc(l.persona)}">${icon('more',18)}</button></div></div>`+
  l.drafts.map(d=>`<div class="km-draft" data-draft="${d.id}"><div class="txt"><b>Draft #${d.id} for ${esc(d.name)} (${esc(d.who)}) · ${esc(Kirim.when(d.at))}</b><p class="km-text">${esc(d.text)}</p>
    ${d.posted?'':'<p>Not posted in Telegram: decide here.</p>'}${d.canSend?'':'<p>The customer last wrote over 24 hours ago, so WhatsApp no longer allows a reply.</p>'}</div>
   <div class="km-act"><button class="ghost" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="discard">Drop</button>${d.canSend?`<button class="primary" data-act="kd-draft" data-agent="${esc(l.agent)}" data-id="${d.id}" data-do="send">Send</button>`:''}</div></div>`).join('')},
 // first paint rises in; later paints change only what changed, with a short fade, so the page never jumps
 // a number in Kirimdev that no agent answers yet
 number:n=>`<div class="km-line km-free" data-num="${esc(n.phoneNumberId)}"><div class="km-id"><span class="km-ph" aria-hidden="true">${icon('whatsapp',18)}</span><div class="txt"><b>${esc(n.name||n.phone||'Number')}</b><span>${esc([n.phone,n.status&&n.status!=='connected'?'Kirimdev: '+n.status:''].filter(Boolean).join(' · '))}</span><p>No agent answers it yet.</p></div></div>
   <div class="km-act"><button class="primary" data-act="km-connect" data-pid="${esc(n.phoneNumberId)}">${icon('plus',15)}Connect</button></div></div>`,
 rows(d,teams){const N=d.numbers||{list:[]},byAgent=Object.fromEntries((d.lines||[]).map(l=>[l.agent,l])),used=new Set(),out=[];
  for(const n of N.list||[]){const l=n.agent&&byAgent[n.agent];if(l){used.add(l.agent);out.push(Kirim.line({...l,gone:!!n.gone,phone:n.phone},teams[l.agent]))}else if(!n.agent)out.push(Kirim.number(n))}
  for(const l of d.lines||[])if(!used.has(l.agent))out.push(Kirim.line(l,teams[l.agent]));
  const note=!N.ok?`<p class="hint km-none">${esc(N.why==='nokey'?'Add the API key above and the numbers in your Kirimdev account show up here.':'Could not read the numbers from Kirimdev: '+(N.text||'no answer')+' Lines already set up keep working.')}</p>`:'';
  return note+(out.join('')||(N.ok?`<p class="hint km-none">Kirimdev has no WhatsApp number yet. Add one in Kirimdev, then press Check now.</p>`:''))},
 // first paint rises in; later paints change only what changed, with a short fade, so the page never jumps
 paint(el,d,teams){Kirim.d=d;
  const parts={acct:Kirim.acct(d),reach:d.reach&&!d.reach.ok?`<p class="km-reach">${esc(d.reach.why)}</p>`:'',lines:Kirim.rows(d,teams)};
  let root=el.querySelector('.km');
  if(!root){el.innerHTML=`<div class="km"><div class="panel card km-p" ${st(0)}><h2>Connection</h2><p class="sub">One key for every Kirimdev line. It is separate from the agents’ own WhatsApp channel on Channels.</p><div data-part="acct"></div></div>
    <div class="panel card km-p" ${st(1)}><h2>Numbers</h2><p class="sub">Every WhatsApp number in your Kirimdev account. Connect one so an agent answers it; it starts in Test, so only its testers get answers. aqeelOS checks the API and each line every 10 minutes and puts a problem on System › Health.</p><div data-part="reach"></div><div data-part="lines"></div></div></div>`;root=el.querySelector('.km')}
  for(const [k,html] of Object.entries(parts)){const box=root.querySelector(`[data-part="${k}"]`);if(box._html===html)continue;const first=box._html==null;box._html=html;box.innerHTML=html;if(!first){box.classList.remove('km-fresh');void box.offsetWidth;box.classList.add('km-fresh')}}},
 // a menu from a button that looks like a field (never a native select)
 pick(e,items,onPick){e.stopPropagation();const btn=e.currentTarget;btn.classList.add('open');menu(btn,items.map(i=>i.header||i==='-'?i:{...i,run:()=>onPick(i)}),{matchWidth:true,onClose:()=>btn.classList.remove('open'),onOpen:m=>{if(btn.closest('.stack'))m.style.zIndex=70}});
  const obs=new MutationObserver(()=>{if(!document.querySelector('.menu')){btn.classList.remove('open');obs.disconnect()}});obs.observe(document.body,{childList:true})},
 field:(id,label)=>`<button type="button" class="sel-btn" id="${id}" aria-haspopup="menu"><span class="sv">${esc(label)}</span>${icon('chevD',15)}</button>`,
 // a part of the form that comes and goes rises in and fades out, never just appears
 reveal(el,on){if(!el)return;clearTimeout(el._t);if(on){if(!el.hidden&&!el.classList.contains('closing'))return;el.classList.remove('closing');el.hidden=false;el.classList.remove('km-in');void el.offsetWidth;el.classList.add('km-in')}
  else if(!el.hidden){el.classList.add('closing');el._t=setTimeout(()=>{el.hidden=true;el.classList.remove('closing')},170)}},
 // Connect (a number nobody answers) and Line settings (a line's settings later): one dialog, setup only
 async setup(o){const edit=!!o.agent,l=edit?(Kirim.d?.lines||[]).find(x=>x.agent===o.agent):null,s=l?.settings||{};if(edit&&!l)return;
  const num=edit?null:(Kirim.d?.numbers?.list||[]).find(x=>x.phoneNumberId===o.pid);if(!edit&&!num)return;
  let cfg;try{cfg=await UI('/ui/kirimdev/setup?agent='+encodeURIComponent(o.agent||''))}catch(e){return fail(e)}
  const V={agent:o.agent||'',fresh:false,group:cfg.team?.chatId?String(cfg.team.chatId):'',gtype:false,topic:cfg.team?.topics?.questions??null,ttype:false,
   lang:['','Indonesian','English'].includes(s.language||'')?(s.language||''):'other',pay:s.payment?.helper?.path||'',ptype:false,style:s.payment?.helper?.style||'picture'};
  if(V.pay&&!cfg.helpers.some(h=>h.path===V.pay)){V.ptype=true}
  const free=cfg.agents.filter(a=>!a.line),i=(id,label,v,ph='',x='')=>`<label for="${id}">${esc(label)}</label><input id="${id}" value="${esc(v??'')}" placeholder="${esc(ph)}" autocomplete="off" ${x}>`;
  const LANGS=[['','Customer’s own'],['Indonesian','Indonesian'],['English','English'],['other','Other']];
  const body=`<div class="km-form">
   ${edit?`<div class="km-who">${agentAvatar(l.agent,32)}<div class="txt"><b>${esc(l.persona)} answers ${esc((Kirim.d?.numbers?.list||[]).find(n=>n.agent===l.agent)?.phone||'this number')}</b><span>${esc(l.business)}</span></div></div>`
    :`<div class="km-who"><span class="km-ph" aria-hidden="true">${icon('whatsapp',18)}</span><div class="txt"><b>${esc(num.name||num.phone)}</b><span>${esc(num.phone)}</span></div></div>`}
   <section class="km-sec"><h3>Who answers</h3>
    ${edit?'':`<label for="kmf-agent">Agent</label>${Kirim.field('kmf-agent','Pick an agent')}
    <div class="km-reveal" id="kmf-newbox" hidden>${i('kmf-newid','Name for the new support agent','','support','maxlength="64" autocapitalize="off" spellcheck="false"')}<p class="hint">Lowercase letters, numbers, - and _. It is made with aqeelOS’s tools and its own space on the AI box; that takes about a minute.</p></div>`}
    <div class="km-2"><div>${i('kmf-persona','Name customers see',s.persona,'Gilang','maxlength="40"')}</div><div>${i('kmf-biz','Business',s.business??(num?.name||''),'Biomarkers by Newtech Labs','maxlength="80"')}</div></div></section>
   <section class="km-sec"><h3>Testers</h3><p class="hint">In Test the agent answers only these numbers. Country code first, like 6281234567890.</p><div id="kmf-testers"></div>
    <button type="button" class="ghost km-add" id="kmf-addt">${icon('plus',15)}Add tester</button></section>
   <section class="km-sec"><h3>Handoffs</h3><p class="hint">A question the agent cannot answer goes to this Telegram group and topic, for a person.</p>
    <label for="kmf-group">Group</label>${Kirim.field('kmf-group','No group yet')}<div class="km-reveal" id="kmf-gbox" hidden>${i('kmf-gid','Group id','','-1001234567890','inputmode="numeric"')}</div>
    <label for="kmf-topic">Topic</label>${Kirim.field('kmf-topic','The main chat')}<div class="km-reveal" id="kmf-tbox" hidden>${i('kmf-tn','Topic number','','3','inputmode="numeric"')}</div></section>
   <section class="km-sec"><h3>Replies</h3><label>Language</label><div class="seg-mini km-seg" role="group" aria-label="Language" id="kmf-lang">${LANGS.map(([k,t])=>`<button type="button" data-v="${k}" class="${V.lang===k?'on':''}" aria-pressed="${V.lang===k}">${esc(t)}</button>`).join('')}</div>
    <div class="km-reveal" id="kmf-lbox" hidden><input id="kmf-lo" class="km-lo" aria-label="Language" value="${esc('other'===V.lang?s.language||'':'')}" placeholder="Type the language, like Malay" maxlength="30" autocomplete="off"></div>
    ${i('kmf-quiet','Quiet time after a team reply (minutes)',s.pauseMin??15,'15','inputmode="numeric" maxlength="4"')}<p class="hint">After a team member writes in a chat, the agent stays out of it this long. 0 means it never waits.</p>
    <div class="km-2"><div>${i('kmf-rw','Reset word',(s.resetWords||['reset']).join(', '),'reset','maxlength="60"')}</div><div>${i('kmf-rt','Reset reply',s.resetText,'Test reset. Start again as a new customer.','maxlength="300"')}</div></div><p class="hint">A tester who sends the reset word starts over as a new customer.</p></section>
   <section class="km-sec"><h3>Payments</h3><label for="kmf-pay">Payment helper</label>${Kirim.field('kmf-pay','None')}
    <div class="km-reveal" id="kmf-pbox" hidden>${i('kmf-pp','File in the agent’s folder',V.ptype?V.pay:'','.tools/qris','spellcheck="false"')}<div class="seg-mini km-seg" role="group" aria-label="What it does" id="kmf-style">${[['picture','Makes a QR picture'],['send','Sends it itself']].map(([k,t])=>`<button type="button" data-v="${k}" class="${V.style===k?'on':''}" aria-pressed="${V.style===k}">${t}</button>`).join('')}</div></div>
    <div class="km-reveal" id="kmf-limits" hidden><div class="km-3"><div>${i('kmf-cur','Currency',s.payment?.currency??'Rp','Rp','maxlength="6"')}</div><div>${i('kmf-min','Lowest amount',s.payment?.min??'','10000','inputmode="numeric"')}</div><div>${i('kmf-max','Highest amount',s.payment?.max??'','5000000','inputmode="numeric"')}</div></div></div></section>
   <p class="km-note" aria-live="polite"></p><p class="km-err" role="alert"></p></div>`;
  const {d,close}=stackPop(edit?'Line settings':'Connect '+(num.name||num.phone),body,`<button class="ghost" data-x>Cancel</button><button class="primary" id="kmf-ok">${edit?'Save':'Connect'}</button>`);
  d.classList.add('km-dlg');const q=x=>d.querySelector(x),err=q('.km-err'),note=q('.km-note'),ok=q('#kmf-ok');
  const groups=cfg.groups||[],gOf=id=>groups.find(g=>g.chatId===String(id));
  const set=(id,t)=>{const b=q('#'+id);if(b)b.querySelector('.sv').textContent=t};
  const paintAgent=()=>{if(edit)return;set('kmf-agent',V.fresh?'A new support agent':V.agent?(cfg.agents.find(a=>a.id===V.agent)?.name||V.agent):'Pick an agent');Kirim.reveal(q('#kmf-newbox'),V.fresh)};
  const paintGroup=()=>{const g=gOf(V.group);set('kmf-group',V.gtype?'Another group (type its id)':V.group?(g?.name||'Group '+V.group):'No group yet');Kirim.reveal(q('#kmf-gbox'),V.gtype);
   const t=(g?.topics||[]).find(x=>x.n===Number(V.topic));set('kmf-topic',V.ttype?'Another topic (type its number)':V.topic!=null&&V.topic!==''?(t?t.label+' · topic '+t.n:'Topic '+V.topic):'The main chat');Kirim.reveal(q('#kmf-tbox'),V.ttype)};
  const paintPay=()=>{const h=cfg.helpers.find(x=>x.path===V.pay);set('kmf-pay',V.ptype?'Another file':V.pay?V.pay+(h?.style==='send'?' (sends it itself)':' (makes a QR picture)'):'None');Kirim.reveal(q('#kmf-pbox'),V.ptype);Kirim.reveal(q('#kmf-limits'),!!(V.pay||V.ptype))};
  if(V.gtype)q('#kmf-gid').value=V.group;
  // testers: rows that rise in and fold away
  const tbox=q('#kmf-testers');
  const addT=(t={},anim=true)=>{const r=document.createElement('div');r.className='km-trow'+(anim?' km-in':'');r.innerHTML=`<input class="kmf-tw" placeholder="Name" aria-label="Tester name" maxlength="40" autocomplete="off"><input class="kmf-tp" placeholder="6281234567890" aria-label="Tester phone" inputmode="tel" autocomplete="off"><button type="button" class="ghost icon" aria-label="Remove tester">${icon('x',16)}</button>`;
   r.querySelector('.kmf-tw').value=t.who||'';r.querySelector('.kmf-tp').value=t.phone||'';r.querySelector('button').onclick=()=>{r.classList.add('closing');setTimeout(()=>r.remove(),170)};tbox.append(r);return r};
  (s.testers||[]).forEach(t=>addT(t,false));if(!(s.testers||[]).length)addT({},false);
  q('#kmf-addt').onclick=()=>addT().querySelector('input').focus();
  paintAgent();paintGroup();paintPay();Kirim.reveal(q('#kmf-lbox'),V.lang==='other');
  if(!edit)q('#kmf-agent').onclick=e=>Kirim.pick(e,[...(free.length?[{header:'Agents without a number'},...free.map(a=>({label:a.name,sub:a.id!==a.name.toLowerCase()?a.id:'',ava:agentAvatar(a.id,22),v:a.id,on:V.agent===a.id&&!V.fresh}))]:[]),'-',{label:'Make a new support agent',icon:'plus',v:'',fresh:true,on:V.fresh}],
   it=>{V.fresh=!!it.fresh;V.agent=it.v;paintAgent();if(V.fresh)setTimeout(()=>q('#kmf-newid').focus(),60);else if(!q('#kmf-persona').value)q('#kmf-persona').value=cfg.agents.find(a=>a.id===V.agent)?.name||''});
  q('#kmf-group').onclick=e=>{const own=groups.filter(g=>g.own),oth=groups.filter(g=>!g.own),it=g=>({label:g.name||'Group '+g.chatId,sub:g.chatId,v:g.chatId,on:!V.gtype&&V.group===g.chatId});
   Kirim.pick(e,[...(own.length?[{header:'This agent’s groups'},...own.map(it)]:[]),...(oth.length?[{header:'Other agents’ groups'},...oth.map(it)]:[]),'-',{label:'Another group (type its id)',icon:'edit',type:true,on:V.gtype},{label:'No group yet',v:'',on:!V.gtype&&!V.group}],
    x=>{V.gtype=!!x.type;if(!x.type){V.group=x.v;const g=gOf(x.v);if(!(g?.topics||[]).some(t=>t.n===Number(V.topic))){V.topic=(g?.topics||[]).find(t=>/^Questions/.test(t.label))?.n??null;V.ttype=false}}paintGroup();if(V.gtype)setTimeout(()=>q('#kmf-gid').focus(),60)})};
  q('#kmf-topic').onclick=e=>{const g=gOf(V.group);Kirim.pick(e,[...((g?.topics||[]).length?[{header:'Topics known in this group'},...g.topics.map(t=>({label:t.label,sub:'topic '+t.n,v:t.n,on:!V.ttype&&Number(V.topic)===t.n}))]:[]),'-',{label:'Another topic (type its number)',icon:'edit',type:true,on:V.ttype},{label:'The main chat',v:null,on:!V.ttype&&(V.topic==null||V.topic==='')}],
   x=>{V.ttype=!!x.type;if(!x.type)V.topic=x.v;paintGroup();if(V.ttype)setTimeout(()=>q('#kmf-tn').focus(),60)})};
  q('#kmf-pay').onclick=e=>Kirim.pick(e,[{label:'None',sub:'The agent makes no payments',v:'',on:!V.pay&&!V.ptype},...(cfg.helpers.length?[{header:'In the agent’s folder'},...cfg.helpers.map(h=>({label:h.path,sub:h.style==='send'?'Sends the payment itself':'Makes a QR picture for the reply',v:h.path,on:!V.ptype&&V.pay===h.path}))]:[]),'-',{label:'Another file',icon:'edit',type:true,on:V.ptype}],
   x=>{V.ptype=!!x.type;if(!x.type){V.pay=x.v;V.style=cfg.helpers.find(h=>h.path===x.v)?.style||'picture'}paintPay();if(V.ptype)setTimeout(()=>q('#kmf-pp').focus(),60)});
  const seg=(id,on)=>q('#'+id).addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;q('#'+id).querySelectorAll('button').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b)});on(b.dataset.v)});
  seg('kmf-lang',v=>{V.lang=v;Kirim.reveal(q('#kmf-lbox'),v==='other');if(v==='other')setTimeout(()=>q('#kmf-lo').focus(),60)});seg('kmf-style',v=>{V.style=v});
  const val=x=>q(x)?.value.trim()??'';
  const go=async()=>{err.textContent='';note.textContent='';
   if(!edit&&!V.fresh&&!V.agent){err.textContent='Pick the agent that answers this number.';return}
   const fresh=!edit&&V.fresh?val('#kmf-newid'):'';if(!edit&&V.fresh&&!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(fresh)){err.textContent='The new agent’s name uses only lowercase letters, numbers, - and _.';q('#kmf-newid').focus();return}
   if(!val('#kmf-persona')){err.textContent='Give the name customers see.';q('#kmf-persona').focus();return}
   const group=V.gtype?val('#kmf-gid'):V.group,topic=V.ttype?val('#kmf-tn'):V.topic;
   const pay=V.ptype?val('#kmf-pp'):V.pay;
   const b={agent:edit?l.agent:fresh||V.agent,phoneNumberId:edit?l.phoneNumberId:num.phoneNumberId,persona:val('#kmf-persona'),business:val('#kmf-biz'),
    testers:[...tbox.querySelectorAll('.km-trow:not(.closing)')].map(r=>({who:r.querySelector('.kmf-tw').value.trim(),phone:r.querySelector('.kmf-tp').value.trim()})),
    language:V.lang==='other'?val('#kmf-lo'):V.lang,pauseMin:val('#kmf-quiet'),resetWords:val('#kmf-rw'),resetText:val('#kmf-rt'),
    payment:pay?{helper:{path:pay,style:V.ptype?V.style:cfg.helpers.find(h=>h.path===pay)?.style||'picture'},currency:val('#kmf-cur'),min:val('#kmf-min'),max:val('#kmf-max')}:null,
    team:group?{chatId:group,questions:topic??''}:null};
   const bt=ok.textContent;ok.disabled=true;
   try{if(fresh){ok.innerHTML='<span class="spinner tiny"></span>Making the agent…';note.textContent='Making '+fresh+' with aqeelOS’s tools and its own space on the AI box. This takes about a minute.';
     await post(H,'/profiles',{name:fresh,description:'Answers customers on '+(num.name||num.phone)+' (Kirimdev)',clone_from_default:false});
     const r=await post(UI,'/ui/accounts/setup-agent',{name:fresh}).catch(e=>({ok:false,failed:[e.message]}));if(r?.ok===false)note.textContent='The agent is made; part of its setup did not finish ('+(r.failed||[]).join(' · ')+'). Connecting the number anyway.';
     V.fresh=false;V.agent=fresh;cfg.agents.push({id:fresh,name:fresh,line:false})}
    ok.innerHTML='<span class="spinner tiny"></span>'+(edit?'Saving…':'Connecting…');
    const r=await UI('/ui/kirimdev/line',{method:'POST',body:b});close();
    toast(edit?'Saved. The agent uses it from its next message.':r.delivery?.how==='webhook'?'Connected in Test. Kirimdev sends this number’s messages to aqeelOS now.':'Connected in Test. aqeelOS checks this number every 20 seconds.');Kirim.refresh()}
   catch(e){err.textContent=e.message||'Could not save it';ok.disabled=false;ok.textContent=bt;note.textContent=''}};
  ok.onclick=go;setTimeout(()=>(edit?q('#kmf-persona'):q('#kmf-agent')).focus(),40)},
 async show(el){const gone=pageTok(el);
  if(S.me?.admin===false){el.innerHTML=emptyBox('Only admins','Kirimdev holds the team’s API key, so only admins see it.');return}
  setActions(`<button class="ghost" data-act="km-check">${icon('refresh',15)}Check now</button>`);const fresh=Kirim.fresh;Kirim.fresh=false;
  if(!el.querySelector('.km'))el.innerHTML='<div class="skel" style="height:150px;border-radius:18px;margin-bottom:16px"></div><div class="skel" style="height:220px;border-radius:18px"></div>';
  let d;try{d=await UI('/ui/kirimdev'+(fresh?'?fresh=1':''))}catch(e){if(!gone())el.innerHTML=emptyBox('Kirimdev did not load',e.message||'Try again in a moment.');return}if(gone())return;
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
ACT['km-check']=async b=>{b.disabled=true;b.classList.add('busy');try{await UI('/ui/kirimdev/check',{method:'POST',body:{}});Kirim.fresh=true;await Kirim.refresh();toast('Checked just now.')}catch(e){fail(e)}finally{b.disabled=false;b.classList.remove('busy')}};
ACT['km-key']=()=>{const has=Kirim.d?.keySaved;
 const {d,close}=stackPop(has?'Change the Kirimdev API key':'Add the Kirimdev API key',`<p class="hint" style="margin:0 0 12px">In Kirimdev, open Settings, then API keys, and copy a key. aqeelOS checks it with Kirimdev before it saves it, so a wrong key never replaces a working one. It is kept on the AI box and never shown again.</p>
  <label for="km-k">API key</label><input id="km-k" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key"><p class="km-err" role="alert"></p>`,
  `<button class="ghost" data-x>Cancel</button><button class="primary" id="km-ok">Check and save</button>`);
 const inp=d.querySelector('#km-k'),ok=d.querySelector('#km-ok'),err=d.querySelector('.km-err');
 const go=async()=>{const v=inp.value.trim();if(!v){inp.focus();return}ok.disabled=true;ok.textContent='Checking…';err.textContent='';
  try{await UI('/ui/kirimdev/key',{method:'POST',body:{key:v}});close();toast('Saved. Kirimdev took the key.');Kirim.fresh=true;Kirim.refresh()}catch(e){err.textContent=e.message||'Could not save it';ok.disabled=false;ok.textContent='Check and save';inp.select()}};
 ok.onclick=go;inp.onkeydown=e=>{if(e.key==='Enter')go()};setTimeout(()=>inp.focus(),30)};
ACT['km-more']=b=>{const l=(Kirim.d?.lines||[]).find(x=>x.agent===b.dataset.agent);if(!l)return;const reach=Kirim.d?.reach?.ok!==false;
 const T=(l.settings?.testers||[]).map((t,i)=>({...t,i})).filter(t=>t.phone);
 menu(b,[{label:'Line settings',icon:'sliders',sub:'Testers, handoffs, language, quiet time, payments',run:()=>Kirim.setup({agent:l.agent})},
  {label:'Team group',icon:'telegram',run:()=>Team.edit(l.agent)},
  {label:'Send test message',icon:'send',sub:T.length?'':'Add a tester with a phone number first',disabled:!T.length,run:()=>T.length===1?ACT['km-test']({dataset:{agent:l.agent,i:T[0].i,who:T[0].who}}):setTimeout(()=>menu(b,[{header:'Send a test message to'},...T.map(t=>({label:t.who,sub:t.phone,icon:'user',run:()=>ACT['km-test']({dataset:{agent:l.agent,i:t.i,who:t.who}})}))]),60)},
  '-',reach?{label:l.connected?'Connect the webhook again':'Connect webhook',icon:'link',run:()=>ACT['kd-connect']({dataset:{agent:l.agent},disabled:false})}:null,
  l.connected?{label:'Renew webhook secret',icon:'key',run:()=>ACT['km-renew']({dataset:{agent:l.agent}})}:null,
  '-',{label:'Disconnect',icon:'power',bad:true,run:()=>ACT['km-disc']({dataset:{agent:l.agent}})}])};
ACT['km-connect']=b=>Kirim.setup({pid:b.dataset.pid});
ACT['km-test']=async b=>{try{const r=await UI('/ui/kirimdev/test',{method:'POST',body:{agent:b.dataset.agent,tester:Number(b.dataset.i)}});toast('Test message sent to '+r.to+'.')}catch(e){toast(e.message||'Could not send it','err')}};
ACT['km-renew']=async b=>{if(!await confirmBox('Renew the webhook secret?','Kirimdev makes a new signing secret and aqeelOS keeps it; the old one is revoked. Messages keep arriving while it changes.','Renew',false))return;
 try{const r=await UI('/ui/kirimdev/renew',{method:'POST',body:{agent:b.dataset.agent}});toast(r.note||'Renewed. Only the new secret signs from now on.')}catch(e){toast(e.message||'Could not renew it','err')}};
ACT['km-disc']=async b=>{const l=(Kirim.d?.lines||[]).find(x=>x.agent===b.dataset.agent);if(!l)return;
 if(!await confirmBox('Disconnect '+l.persona+'’s line?','The webhook is deleted in Kirimdev and '+l.persona+' stops answering this number. Its chats and history stay, and its settings come back if you connect the number again.','Disconnect'))return;
 const row=document.querySelector(`.km-line[data-line="${CSS.escape(l.agent)}"]`);
 try{await UI('/ui/kirimdev/disconnect',{method:'POST',body:{agent:l.agent}});toast('Disconnected. The history is kept.');if(row){row.classList.add('km-out');await new Promise(r=>setTimeout(r,200))}Kirim.fresh=true;Kirim.refresh()}catch(e){toast(e.message||'Could not disconnect it','err')}};
ACT['kd-connect']=async b=>{b.disabled=true;try{await UI('/ui/kirimdev/connect',{method:'POST',body:{agent:b.dataset.agent}});toast('Webhook on. Kirimdev now sends this line’s messages to aqeelOS.');Kirim.refresh()}catch(e){b.disabled=false;toast(e.message||'Could not connect it','err')}};
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
