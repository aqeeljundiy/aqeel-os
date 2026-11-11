// Abilities › Connected accounts (31 Oct 2026): every login where an agent acts as you, not as a bot (app/connected-accounts.mjs).
// One card each: who it is, the agents on it, what they may do (Can: Read · Draft · Send, changed in a small popover),
// its state and when it was last used, its last actions (all 10 in a side panel), and Pause / Resume and Disconnect.
// A login no agent registered says so first, with Approve. Admins only; the all-agents view of Connected apps lists them too.
const CA_STATE={connected:['ok','Connected'],'signed-out':['warn','Signed out'],paused:['','Paused'],pausing:['','Pausing…'],resuming:['','Resuming…'],applying:['','Saving…'],failed:['bad','Did not finish'],off:['','Off in Connected apps'],checking:['','Checking…']};
const CA_CAN={read:['Read','Look things up and read'],edit:['Edit','Change Sheets, Docs and Drive files'],draft:['Draft','Save drafts, never send them'],send:['Send','Send, post and change things as you']};
const CA_HOW={gapi:'Google refuses the rest at once.',tools:'The tools for the rest are taken away from the agents, in about a minute.',note:'Kept as a note: aqeelOS cannot hold this login to it yet.'};
const caBusy=x=>['pausing','resuming','applying'].includes(x.state);
const caChip=x=>{const [c,t]=CA_STATE[x.state]||['',x.state];return `<span class="chip${c?' '+c:''}"${x.why?` title="${esc(x.why)}"`:''}>${caBusy(x)?'<span class="spinner tiny"></span>':'<i class="dot"></i>'}${esc(t)}</span>`};
const caCan=x=>`<span class="ca-can-l" aria-label="Can ${esc(x.can.map(c=>CA_CAN[c][0]).join(', ')||'only look')}">${['read','edit','draft','send'].map(c=>`<span class="ca-c${x.can.includes(c)?' on':''}">${CA_CAN[c][0]}</span>`).join('<i>·</i>')}</span>`;
const caAct=(e,i)=>`<li class="ca-a${e.ok?'':' bad'}" ${st(i)}>${agentAvatar(e.agent,18,{title:false})}<span class="ca-at">${esc(e.text)}</span><time title="${esc(new Date(e.at).toLocaleString())}">${esc(ago(e.at/1000))}</time></li>`;
PAGES.logins=async(p,el)=>{const gone=pageTok(el);
 setActions(`<button data-act="ca-refresh">${icon('refresh',16)}Check now</button>`);
 const [d,ads]=await Promise.all([UI('/ui/connected-accounts'+(Pages._caFresh?'?fresh=1':'')),UI('/ui/adspower').catch(()=>({items:[]}))]);Pages._caFresh=false;if(gone())return;Pages._ca=d.items;
 if(!d.items.length){el.innerHTML=emptyBox('No logins as you yet','When an agent signs in to Google, Slack, Notion or Telegram as you, it shows here with what it did, and you can pause or disconnect it.')+caAds(ads.items);return}
 const card=(x,i)=>`<div class="card tile acct ca-card${x.registered?'':' ca-new'}" data-ca="${esc(x.id)}" ${st(i)}>
  <div class="tile-top">${logoImg(x.logo,(x.app||'?')[0].toUpperCase())}<div class="acct-id"><h3>${esc(x.label)}</h3><span class="acct-mail" title="${esc(x.where)}">${esc(x.identity||x.where)}</span></div>${x.registered?'':'<span class="chip warn ca-reg">Not registered</span>'}</div>
  ${x.registered?'':`<p class="hint ca-note">An agent signed in as you without registering it. Approve it if you meant it, or disconnect it.</p>`}
  <div class="acct-st">${caChip(x)}<span class="ca-used">${x.lastUsed?'Last used '+esc(ago(x.lastUsed/1000)):'Not used yet'}</span></div>
  <div class="ca-row"><span class="th">Can</span>${caCan(x)}<button class="ghost small ca-edit" data-act="ca-can" data-id="${esc(x.id)}" aria-haspopup="dialog" aria-label="Change what agents may do with ${esc(x.label)}">${icon('edit',14)}Change</button></div>
  <div class="ca-recent">${x.recent.length?`<ul>${x.recent.slice(0,4).map(caAct).join('')}</ul>${x.recent.length>4?`<button class="link-btn ca-all" data-act="ca-actions" data-id="${esc(x.id)}">All ${x.recent.length} recent actions</button>`:''}`:'<p class="hint">Nothing done with it in the last days.</p>'}</div>
  <div class="acct-agents"><span class="th">Used by</span>${x.agents.length?Access.who({users:x.agents})+`<span class="acct-names">${esc(x.agents.map(a=>a.name).join(', '))}</span>`:'<span class="hint" style="margin:0">No agent</span>'}</div>
  <div class="ca-btns">${x.registered?'':`<button class="primary small" data-act="ca-approve" data-id="${esc(x.id)}">${icon('check',14)}Approve</button>`}
   ${x.mayPause?(x.state==='paused'||x.state==='resuming'||x.state==='failed'&&x.pausedAt?`<button class="small" data-act="ca-pause" data-id="${esc(x.id)}" data-on="0" ${caBusy(x)?'disabled':''}>${icon('play',14)}Resume</button>`:`<button class="small" data-act="ca-pause" data-id="${esc(x.id)}" data-on="1" ${caBusy(x)?'disabled':''}>${icon('pause',14)}Pause</button>`):''}
   <button class="ghost small ca-dis" data-act="ca-disconnect" data-id="${esc(x.id)}" ${caBusy(x)?'disabled':''}>${icon('trash',14)}Disconnect</button></div></div>`;
 const fresh=d.items.filter(x=>!x.registered).length;
 el.innerHTML=`${fresh?alertBox(`<b>${fresh===1?'1 login':fresh+' logins'} acting as you ${fresh===1?'was':'were'} not registered by the agent that made ${fresh===1?'it':'them'}.</b> Approve or disconnect ${fresh===1?'it':'each one'} below.`,{act:''}):''}
  <div class="grid-cards acct-grid ca-grid">${d.items.map(card).join('')}</div>
  ${caAds(ads.items)}
  <p class="hint ca-foot">Bots people message are under Channels; services like n8n, and keys, under Connected apps and Keys.</p>`;
 caAccess(el,d.items,gone).catch(()=>{});
 // a Pause, Resume or change still going (the engine drops and adds an app on its own clock): looked at again shortly
 clearTimeout(Pages._caT);if(d.items.some(caBusy))Pages._caT=setTimeout(()=>{if(route().page?.id==='logins'&&!document.hidden)(pageRun(el),PAGES.logins(p,el)).catch(()=>{})},4000)};
/* Each agent's own AdsPower (1 Nov 2026): it runs on that agent's screen with its own sign-in, which you make yourself
   there. One card per agent: Signed in, Not signed in or Off, with Open its screen and Start / Stop. */
const CA_ADS={running:['ok','Signed in'],'signed-out':['warn','Not signed in'],starting:['','Starting…'],off:['','Off'],missing:['','Not installed']};
const caAds=items=>!items?.length?'':`<section class="ads-sec"><h2>AdsPower on each agent’s screen</h2><p class="hint" style="margin:0">Every agent has its own AdsPower with its own login. Open its screen and sign in yourself; its AdsPower tool works once it is signed in.</p>
 <div class="grid-cards acct-grid ads-grid">${items.map((x,i)=>{const [c,t]=CA_ADS[x.state]||['',x.state];return `<div class="card tile acct" ${st(i)}>
  <div class="tile-top">${logoImg('adspower.com','A')}<div class="acct-id"><h3>AdsPower, ${esc(ident(x.agent).name)}</h3><span class="acct-mail">On ${esc(ident(x.agent).name)}’s screen · port ${esc(x.port)}</span></div></div>
  <div class="acct-st"><span class="chip${c?' '+c:''}"><i class="dot"></i>${esc(t)}</span><span class="ca-used">${x.state==='signed-out'?'Sign in on its screen':x.state==='missing'?'Install AdsPower for Linux in ~/apps/adspower':x.state==='off'?'Not running':x.state==='starting'?'Opening on its screen':'Its tool works'}</span></div>
  <div class="ca-btns"><button class="${x.state==='signed-out'?'primary ':''}small" data-act="ads-screen" data-agent="${esc(x.agent)}">${icon('monitor',14)}Open its screen</button>
   ${x.state==='missing'?'':x.state==='off'?`<button class="small" data-act="ads-start" data-agent="${esc(x.agent)}">${icon('power',14)}Start AdsPower</button>`:`<button class="ghost small" data-act="ads-stop" data-agent="${esc(x.agent)}">${icon('pause',14)}Stop</button>`}</div></div>`}).join('')}</div></section>`;
const caItem=id=>(Pages._ca||[]).find(x=>x.id===id);
ACT['ca-refresh']=()=>{Pages._caFresh=true;reload()};
ACT['ca-approve']=async a=>{const x=caItem(a.dataset.id);a.disabled=true;try{await post(UI,'/ui/connected-accounts/approve',{id:a.dataset.id});toast((x?.label||'It')+' is registered');reload()}catch(e){a.disabled=false;fail(e)}};
ACT['ca-pause']=async a=>{const x=caItem(a.dataset.id),on=a.dataset.on==='1';a.disabled=true;const was=a.innerHTML;a.innerHTML='<span class="spinner tiny"></span>'+(on?'Pausing…':'Resuming…');
 try{const r=await post(UI,'/ui/connected-accounts/pause',{id:a.dataset.id,on});toast((x?.label||'It')+(on?' is paused for every agent':' works again')+(r.background?' · the agents follow in about a minute':''));reload()}catch(e){a.disabled=false;a.innerHTML=was;fail(e)}};
ACT['ca-disconnect']=async a=>{const x=caItem(a.dataset.id);if(!x)return;
 const rev=x.provider==='google'||x.provider==='slack';
 if(!await confirmBox('Disconnect '+x.label+'?',(x.identity?x.identity+'. ':'')+'Every agent loses it at once'+(x.agents.length?' ('+x.agents.map(g=>g.name).join(', ')+')':'')+'. '+(rev?'aqeelOS also signs it out at '+x.app+' and deletes the saved sign-in.':'aqeelOS deletes the saved sign-in.')+' To use it again, someone has to sign in again.','Disconnect'))return;
 a.disabled=true;a.innerHTML='<span class="spinner tiny"></span>Disconnecting…';
 try{const r=await post(UI,'/ui/connected-accounts/disconnect',{id:x.id});toast(x.label+' is disconnected'+(r.revoked===false?' · '+x.app+' could not be told, the sign-in is deleted here':''));reload()}catch(e){a.disabled=false;a.innerHTML=icon('trash',14)+'Disconnect';fail(e)}};
// Can: three switches in a small popover, each saved as you flip it (Read always stays: an account that may not even look is a paused one)
ACT['ca-can']=a=>{const x=caItem(a.dataset.id);if(!x)return;let can=[...x.can];
 const html=`<div class="ca-pop" role="dialog" aria-label="What agents may do with ${esc(x.label)}"><div class="mh">What agents may do</div>${['read','edit','draft','send'].map(c=>`<label class="ca-pr"><span><b>${CA_CAN[c][0]}</b><small>${CA_CAN[c][1]}</small></span>${toggle(can.includes(c),CA_CAN[c][0],'data-can="'+c+'"'+(c==='read'?' disabled':''))}</label>`).join('')}<p class="hint">${esc(CA_HOW[x.enforce]||'')}</p></div>`;
 menu(a,[],{html,onOpen:m=>{m.classList.add('ca-menu');m.onclick=e=>e.stopPropagation();m.querySelector('input:not([disabled])')?.focus();
  m.querySelectorAll('input[data-can]').forEach(i=>i.onchange=async()=>{const c=i.dataset.can;const next=i.checked?[...new Set([...can,c])]:can.filter(y=>y!==c);i.disabled=true;
   try{const r=await post(UI,'/ui/connected-accounts/can',{id:x.id,can:next});can=r.can||next;x.can=can;const card=document.querySelector(`[data-ca="${CSS.escape(x.id)}"] .ca-can-l`);if(card)card.outerHTML=caCan(x);toast(x.label+': '+(can.map(y=>CA_CAN[y][0]).join(', ')||'Read')+(r.background?' · in about a minute':''))}
   catch(er){i.checked=!i.checked;fail(er)}finally{i.disabled=false}})}})};
// all recent actions of one login, in the side panel
ACT['ca-actions']=async a=>{const x=caItem(a.dataset.id);if(!x)return;const d=sideDrawer(x.label,`<p class="hint" style="margin:0 0 12px">${esc(x.identity||'')} · the last 10 things agents did with it, newest first.</p><div id="caAll">${skeletonRows(4)}</div>`,`<button class="primary" data-act="close">Done</button>`);
 try{const r=await UI('/ui/connected-accounts/actions?id='+encodeURIComponent(x.id));if(!d.isConnected)return;const box=d.querySelector('#caAll');
  box.innerHTML=r.items.length?`<ul class="ca-full">${r.items.map((e,i)=>`<li class="ca-a${e.ok?'':' bad'}" ${st(i)}>${agentAvatar(e.agent,22,{title:false})}<span class="ca-at"><b>${esc(e.text)}</b><small>${esc(ident(e.agent).name)} · ${esc(new Date(e.at).toLocaleString([],{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}))}${e.tools?.length?' · '+esc(e.tools.join(', ')):''}</small></span></li>`).join('')}</ul>`:'<p class="hint">Nothing done with it in the last days.</p>'}
 catch(e){if(d.isConnected)d.querySelector('#caAll').innerHTML=errLine('the recent actions')}};
// Connected apps under "All agents": the logins as you get their own short list with a way to the page
{const base=PAGES.mcp;PAGES.mcp=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if(S.me?.admin===false||typeof showingAll!=='function'||!showingAll())return;const host=el.querySelector('.all-view');if(!host)return;
 let d;try{d=await UI('/ui/connected-accounts')}catch{return}if(gone()||!d.items.length)return;
 host.insertAdjacentHTML('beforeend',`<div style="height:18px"></div><h2 class="ach-cat" style="margin-top:0">Connected accounts <small class="hint">${d.items.length}</small></h2><p class="hint" style="margin:-4px 0 10px">Logins where an agent acts as you.</p><div class="card list">${d.items.map((x,i)=>`<div class="row all-row" ${st(i)}><div class="main-c">${logoImg(x.logo,(x.app||'?')[0].toUpperCase())}<div class="txt"><b>${esc(x.label)}${x.registered?'':' <span class="chip warn sign-chip">Not registered</span>'}</b><span>${esc(x.identity||x.where)}</span></div></div><div class="act">${caChip(x)}${x.agents.length?Access.who({users:x.agents}):''}<button class="ghost small" data-act="ca-open" title="Open Connected accounts">Open${icon('chevR',14)}</button></div></div>`).join('')}</div>`)}}
ACT['ca-open']=()=>go('/abilities/logins');

// Access (sharing levels, 6 Nov 2026): one owner per login, the other agents at Manager, Editor or Viewer (read only). Admins change it here.
const CA_LV={owner:'Owner',manager:'Manager',editor:'Editor',viewer:'Viewer',none:'No access'};
async function caAccess(el,items,gone){const d=await UI('/ui/sharing');if(gone()||!d.enabled)return;const by={};for(const r of d.items||[])if(r.type==='account')by[r.id]=r;
 const rows=items.filter(x=>by[x.id]).map(x=>{const r=by[x.id],ag=Object.entries(r.grants||{});
  return `<div class="row all-row"><div class="main-c"><div class="txt"><b>${esc(x.label)}</b><span>${esc(x.identity||x.where)}</span></div></div><div class="act" style="flex-wrap:wrap;gap:6px">
   <span class="chip ok" title="Owner">${esc(agentLabel(r.owner))} · Owner</span>${ag.map(([a,l])=>`<label class="chip">${esc(agentLabel(a))} <select data-ca-lv="${esc(x.id)}" data-agent="${esc(a)}">${['manager','editor','viewer','none'].map(v=>`<option value="${v}"${v===l?' selected':''}>${CA_LV[v]}</option>`).join('')}</select></label>`).join('')}</div></div>`});
 if(!rows.length)return;el.insertAdjacentHTML('beforeend',`<h2 class="ach-cat">Access <small class="hint">${rows.length}</small></h2><p class="hint" style="margin:-4px 0 10px">Who may use each login. Viewer: read only. Editor: what the login allows. Manager: also shares it. No access: the agent cannot use it.</p><div class="card list ca-access">${rows.join('')}</div>`);
 el.querySelectorAll('select[data-ca-lv]').forEach(s=>s.addEventListener('change',async()=>{s.disabled=true;try{await UI('/ui/sharing/share',{method:'POST',body:{type:'account',id:s.dataset.caLv,agent:s.dataset.agent,level:s.value}});toast?.('Saved')}catch(e){alert(e.message||'Could not change it')}s.disabled=false}))}
