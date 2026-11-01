// "All agents" in the Showing picker: on Plugins, Keys, Webhooks, Channels (both tabs), Agents' models and Usage
// you can look at every agent's at once, each row saying which agent owns it, instead of switching one by one.
// Changing something still happens on the owner: "Open" switches the page to that agent. (Scheduled runs already
// show every agent with their own filter.)
// the one picker for "whose" (1 Nov 2026): Usage and Channels › Connections had pickers of their own, now gone
const ALL_PAGES=new Set(['mcp','plugins','keys','webhooks','channels','models','usage']);
const allHere=()=>{const id=route().page?.id;if(!ALL_PAGES.has(id))return false;if(id==='models')return S.tab.models==='Agents’ models';return true};
const showingAll=()=>(S.viewAll??true)&&allHere()&&!(['keys','files'].includes(route().page?.id)&&S.me?.admin===false);
// the picker says "All agents" while that is what you see
{const base=viewPick;viewPick=list=>{base(list);if(!showingAll())return;const b=$('.page-head .head-actions .view-pick');if(!b)return;b.classList.add('other');b.title='Every agent’s, each with its owner';
 b.innerHTML=`<span class="vp-ava all">${icon('layers',14)}</span><span class="vp-t"><small>Showing</small><b>All agents</b></span>${icon('chevD',15)}`}}
ACT['view-pick']=async a=>{const list=await viewAgents(),me=S.profile||'default';
 menu(a,[{header:'Show whose'},...(allHere()?[{label:'All agents',icon:'layers',on:showingAll(),sub:'Everything at once, with owners',run:()=>{S.viewAll=true;S.viewAgent=null;reload()}},'-']:[]),
  ...list.map(n=>({label:ident(n).name,icon:'user',ava:agentAvatar(n,20,{title:false}),on:!showingAll()&&n===viewing(),sub:n===me?'You chat with this one':'',run:()=>{S.viewAll=false;S.viewAgent=n===me?null:n;Pages._toolCache=null;Pages._dirty=null;reload()}}))],{search:list.length>6,matchWidth:true})};
ACT['all-open']=a=>{S.viewAll=false;const n=a.dataset.agent,me=S.profile||'default';S.viewAgent=n===me?null:n;Pages._toolCache=null;reload()};
const allOpen=(agent,label='Open')=>`<button class="ghost small" data-act="all-open" data-agent="${esc(agent)}" title="Open on ${esc(ident(agent).name)}">${esc(label)}${icon('chevR',14)}</button>`;
let ALL_AGENTS=[],ALL_EDIT=false,ALL_IT={};   // ALL_IT: the rows on screen by kind|id, for their ⋯ menu
const allRow=(i,logo,title,sub,it,extra='')=>{if(it)ALL_IT[it.kind+'|'+it.id]=it;return `<div class="row all-row" ${st(i)}><div class="main-c">${logo}<div class="txt"><b>${title}</b>${sub?`<span>${sub}</span>`:''}${extra}</div></div><div class="act">${it?Access.owner(it,ALL_AGENTS,ALL_EDIT)+(ALL_EDIT?Access.btn(it):Access.who(it))+`<button class="ghost icon" data-act="all-more" data-kind="${it.kind}" data-id="${esc(it.id)}" data-owner="${esc(it.owner)}" aria-label="More">${icon('more',18)}</button>`:''}</div></div>`};
// the ⋯ menu: what the one-agent page offers on that row, done on its owner (the same actions, given the agent)
ACT['all-more']=a=>{const it=ALL_IT[a.dataset.kind+'|'+a.dataset.id];if(!it)return;const o=it.owner,on=ident(o).name,k=it.kind,d={name:it.id,agent:o},x=it.gacc;
 menu(a,[{header:it.label+' · '+on},
  k==='mcp'&&ALL_EDIT&&it.oauth&&{label:'Sign in',icon:'user',run:()=>ACT['mcp-auth']({dataset:d})},
  k==='mcp'&&{label:'Test',icon:'activity',run:()=>ACT['mcp-test']({dataset:d})},
  k==='mcp'&&ALL_EDIT&&!it.own&&{label:it.off?'Turn on':'Turn off',icon:'power',run:async()=>{if(await ACT['mcp-toggle']({dataset:d,checked:!!it.off}))reload()}},
  k==='mcp'&&ALL_EDIT&&!it.own&&{label:'Rename',icon:'edit',run:()=>ACT['mcp-rename']({dataset:d})},
  k==='google'&&x&&it.gEdit&&{label:'Name and note',icon:'edit',run:()=>ACT['gacc-edit']({dataset:{agent:o,n:x.name}})},
  k==='google'&&x&&!x.renews&&{label:'Sign in again',icon:'user',run:()=>ACT['gacc-add']()},
  k==='key'&&ALL_EDIT&&!it.bot&&{label:'Change value',icon:'edit',run:()=>ACT['key-edit']({dataset:{k:it.label,agent:o}})},
  ALL_EDIT&&!it.bot&&!it.own&&{label:'Who can use',icon:'user',run:()=>Access.open(k,it.id)},
  {label:'Open on '+on,icon:'chevR',run:()=>ACT['all-open']({dataset:{agent:o}})},
  ...(ALL_EDIT&&!it.own&&k!=='plugin'&&!(k==='google'&&!x)?['-',{label:'Remove from '+on,icon:'trash',bad:true,run:()=>k==='mcp'?ACT['mcp-del']({dataset:d}):k==='key'?ACT['key-del']({dataset:{k:it.label,agent:o}}):ACT['gacc-del']({dataset:{agent:o,n:x.name,e:it.id,email:it.id}})}]:[])])};
// an empty section looks like an empty one-agent page (emptyBox)
const allSection=(title,rows,empty,text='')=>`<h2 class="ach-cat" style="margin-top:0">${esc(title)} <small class="hint">${rows.length}</small></h2>${rows.length?`<div class="card list">${rows.join('')}</div>`:emptyBox(empty,text)}`;
// set up on some agents but not signed in there: the one sign-in chip, saying on which (Sign in on the first, for apps)
const notSigned=it=>{const n=it.users.filter(u=>!u.signed);return n.length?`<span class="acc-nosign">${signChip(it.kind==='mcp'&&ALL_EDIT?`data-act="mcp-auth" data-name="${esc(it.id)}" data-agent="${esc(n[0].id)}"`:'')}<small>on ${esc(n.map(u=>u.name).join(', '))}</small></span>`:''};

const ALLVIEW={
 async mcp(p,el){setActions('');const gone=pageTok(el);const [m,g]=await Promise.all([Access.load('mcp'),Access.load('google')]);if(gone())return;if(!m)throw new Error('Your agents’ apps couldn’t be loaded.');ALL_AGENTS=m.agents;ALL_EDIT=!!m.canEdit;
  const host=d=>hostOf(d)||'';
  // each Google account as its owner shows it: the name you gave it, its note and the permissions it really has
  const gOwn=[...new Set((g?.items||[]).map(it=>it.owner))],gl=Object.fromEntries(await Promise.all(gOwn.map(async a=>[a,await UI('/ui/google-accounts?agent='+encodeURIComponent(a)).then(r=>r.accounts||[]).catch(()=>null)])));if(gone())return;
  for(const [a,l] of Object.entries(gl))if(l)(Pages._gaccBy||={})[a]=l;
  const gRow=(it,i)=>{const x=(gl[it.owner]||[]).find(y=>y.email===it.id);it.gacc=x;it.gEdit=mayEdit(it.owner);
   return allRow(i,logoImg('google.com','G'),esc(accountText({email:it.id},{label:x?gaccTitle(x):''}))+(x&&!x.renews?' '+signChip('data-act="gacc-add"','Sign in asks '+ident().name+', the agent you chat with'):''),esc(x?gaccWhat(x.scopes)||plural(x.scopes.length,'permission'):it.detail),it,(x?.note?`<span class="gacc-note">${icon('edit',12)}${esc(x.note)}</span>`:'')+notSigned(x?{...it,users:it.users.filter(u=>u.id!==it.owner)}:it))};   // the owner's own state is the chip above
  const gBox=g?allSection('Google accounts',g.items.map(gRow),'No Google accounts yet.')+`<button data-act="gacc-add" style="margin-top:10px">${icon('plus',15)}Connect ${g.items.length?'another':'a'} Google account</button><p class="hint" style="margin:6px 0 0">Asks ${esc(ident().name)}, the agent you chat with, for a sign-in link. Pick an agent under Showing to connect one there.</p>`:`<h2 class="ach-cat" style="margin-top:0">Google accounts</h2>${errLine('your agents’ Google accounts')}`;
  el.innerHTML=`<div class="all-view">${allSection('Connected apps',m.items.map((it,i)=>allRow(i,host(it.detail)?logoImg(baseDomain(host(it.detail)),it.label[0].toUpperCase()):`<span class="ic">${icon('plug',17)}</span>`,esc(it.label)+(it.off?' <span class="chip">Off</span>':''),esc(host(it.detail)||it.detail)+(it.mixed?' · not the same account on every agent':''),it,notSigned(it))),'No connected apps yet.')}
   <div style="height:18px"></div>${gBox}</div>`;Access.bindOwners(el)},
 async plugins(p,el){setActions('');const gone=pageTok(el);const d=await Access.load('plugin');if(gone())return;if(!d)throw new Error('Your agents’ plugins couldn’t be loaded.');ALL_AGENTS=d.agents;ALL_EDIT=!!d.canEdit;
  // on or off per agent, like skills: a chip per agent (admins; others see who has it on)
  el.innerHTML=`${tabs('plugins',['Installed','Browse'])}<div class="all-view">${allSection('Plugins turned on',d.items.map((it,i)=>{const v=ex('plugin',it.id),lb=v?.title||pretty(it.id),on=new Set(it.users.map(u=>u.id));return allRow(i,`<span class="ic blue">${icon('layers',17)}</span>`,esc(lb)+` <small class="realname">${esc(it.id)}</small>`,esc(v?.summary||''),it,`<span class="aam-ags">${d.agents.map(a=>ALL_EDIT?allChip('all-pl',a.id,it.id,on.has(a.id)):allAv(a.id,on.has(a.id))).join('')}</span>`)}),'No plugins are turned on.')}</div>`;placePills();Access.bindOwners(el)},
 async keys(p,el){setActions(S.me?.admin===false?'':`<button class="primary" data-act="key-add">${icon('plus',16)}Add a key</button>`);const gone=pageTok(el);const [d,env]=await Promise.all([Access.load('key'),H(prof('/env',S.profile||'default')).catch(()=>({}))]);if(gone())return;if(!d)throw new Error('Keys couldn’t be loaded.');ALL_AGENTS=d.agents;ALL_EDIT=!!d.canEdit;
  // secrets only, as on one agent's Keys (1 Nov 2026): a channel's bot token lives in that channel, settings on Settings
  const notKey=k=>['messaging','setting'].includes(env[k]?.category)||/^(TELEGRAM|WHATSAPP|SLACK|DISCORD|SIGNAL|MATTERMOST|MATRIX|SMS|TWILIO|EMAIL|WEIXIN|QQ|BUZZ)_/.test(k);d.items=d.items.filter(it=>!notKey(it.label));
  el.innerHTML=`<div class="all-view"><p class="hint" style="margin:0 0 14px">Values stay hidden. Change or remove a key from its ⋯ menu; it changes on the agent that owns it.</p><p class="hint" style="margin:-8px 0 14px">Each agent keeps its keys in its own .env file on the AI box. Add a key adds one to the agent you chat with. A channel’s bot token is in that channel on <a href="#/channels/channels">Channels</a>.</p>${allSection('Keys and secrets',d.items.map((it,i)=>allRow(i,`<span class="ic">${icon('key',16)}</span>`,`<span style="font-size:13px">${esc(it.label)}</span>`,esc(it.detail),it)),'No keys yet.')}</div>`;Access.bindOwners(el)},
 async webhooks(p,el){const gone=pageTok(el);const list=await viewAgents();if(gone())return;
  const bad=[],off=new Set(),per=await Promise.all(list.map(async a=>{const d=await H('/webhooks?profile='+encodeURIComponent(a)).catch(()=>{bad.push(ident(a).name);return null});if(d&&!d.enabled)off.add(a);return (d?.subscriptions||[]).map(s=>({...s,__a:a}))})),all=per.flat();if(gone())return;
  const me=agentProfile()||'default',meOff=off.has(me),allOff=list.length>0&&list.every(a=>off.has(a)||bad.includes(ident(a).name));
  setActions(meOff?'':`<button class="primary" data-act="wh-new">${icon('plus',16)}New webhook</button>`);
  // switched off: the saved webhooks stay visible (greyed), like the one-agent view
  const row=(s,i)=>{const url=location.origin+(s.url_path||'/webhooks/'+encodeURIComponent(s.name));const dim=off.has(s.__a);return `<div class="row ${dim?'wh-off':''}" ${st(i)}><div class="main-c"><span class="ic ${s.enabled!==false&&!dim?'blue':''}">${icon('hook',17)}</span><div class="txt"><b>${esc(s.name||s.id||'Webhook')}${s.deliver_only?` <span class="chip sm-chip" title="Sent on as it arrives, without the agent">Direct</span>`:''}</b>${s.description?`<span class="sched-desc">${esc(s.description)}</span>`:''}<span>${esc(url)} · ${esc((s.events||[]).join(', ')||'any event')} · ${esc(whDeliverName(s.deliver))}</span>${dim?`<span class="acc-from">Webhooks are off on ${esc(ident(s.__a).name)}</span>`:''}</div></div><div class="act">${Access.owner({owner:s.__a})}<button class="ghost icon" title="Copy URL" aria-label="Copy URL" data-act="copy-text" data-text="${esc(url)}">${icon('copy',16)}</button>${toggle(s.enabled!==false,'Enabled','data-act="wh-toggle" data-name="'+esc(s.name)+'" data-agent="'+esc(s.__a)+'"'+(dim?' disabled':''))}<button class="ghost icon" title="Delete" aria-label="Delete" data-act="wh-del" data-name="${esc(s.name)}" data-agent="${esc(s.__a)}">${icon('trash',16)}</button>${allOpen(s.__a)}</div></div>`};
  const offNote=meOff?`<div class="panel card wh-alloff"><h2>Webhooks are off</h2><p class="sub">Turn on the webhook channel so other services can send events to aqeelOS.</p><p class="hint" style="margin:0 0 12px">For ${esc(ident(me).name)}, the agent you chat with.</p><button class="primary" data-act="wh-enable">Turn on webhooks</button></div>`:'';
  el.innerHTML=`<div class="all-view">${bad.length?errLine('webhooks for '+bad.join(', ')):''}${offNote}${off.size&&all.some(s=>off.has(s.__a))?`<p class="hint" style="margin:0 0 12px">${allOff?'':'Greyed ones belong to agents whose webhooks are off. '}These are saved and start working again once webhooks are on.</p>`:''}${allSection('Webhooks',all.map(row),'No webhooks on any agent.')}</div>`},
 async pairing(el,gone=pageTok(el)){const base=await viewAgents();const lk=((await UI('/ui/channels/links').catch(()=>({links:[]}))).links||[]).filter(l=>base.includes(l.agent)&&l.name),extra=lk.map(l=>l.name);const list=[...base,...extra.filter(n=>!base.includes(n))];if(gone())return;
  Pages._pairAdd={profs:list.map(a=>{const l=lk.find(x=>x.name===a);return {prof:a,label:l?linkTitle(l):''}}),all:true};
  const [per,whos]=await Promise.all([Promise.all(list.map(async a=>({a,d:await H('/pairing?profile='+encodeURIComponent(a)).catch(()=>({pending:[],approved:[],err:true}))}))),pairWho(Pages._pairAdd.profs)]);if(gone())return;const bad=[...new Set(per.filter(x=>x.d.err).map(x=>ident(x.a.split('--')[0]).name))];
  const who=(u,a)=>`${logoImg(CH_DOMAINS[u.platform],(u.platform||'?')[0].toUpperCase(),CH_COLORS[u.platform])}<div class="txt"><b>${esc(u.user_name||u.user_id)} · ${esc(pretty(u.platform))}</b><span>${u.request_id?'Code '+esc(u.request_id)+' · ':''}${u.age_minutes!=null?Math.round(u.age_minutes)+' min ago':'ID '+esc(u.user_id)}</span><span class="acc-from">${Access.av({id:a.split('--')[0],name:ident(a.split('--')[0]).name},16)}For ${esc(ident(a.split('--')[0]).name)}</span></div>`;
  const pend=per.flatMap(x=>(x.d.pending||[]).map(u=>({u,a:x.a}))),appr=per.flatMap(x=>(x.d.approved||[]).map(u=>({u,a:x.a})));
  Pages._pairProfs=[...new Set(pend.map(x=>x.a))];setActions('');
  el.innerHTML=`${bad.length?errLine('requests for '+bad.join(', ')):''}<div class="panel card">${pairWaitHead(pend.length)}<p class="sub">Someone messaged one of your agents’ channels and needs your OK before the agent answers them.</p>${pend.map(({u,a})=>`<div class="row" style="padding:12px;margin:0 -12px;border:0"><div class="main-c">${who(u,a)}</div><div class="act"><button class="primary" data-act="pair-ok" data-p="${esc(u.platform)}" data-r="${esc(u.request_id)}" data-prof="${esc(a)}">Approve</button></div></div>`).join('')||'<p class="hint" style="margin:0">Nobody is waiting.</p>'}</div>
   ${pairPeople(whos,true)}`;pairMarks(el)},
 // el is a detached box (Models swaps it in): the page's drawing says when it is stale
 async models(el,gone=()=>false){let d={agents:[]};try{d=await UI('/ui/models/agents')}catch(e){if(gone())return;throw e}if(gone())return;
  el.innerHTML=`<div class="all-view">${allSection('Each agent’s model',d.agents.map((a,i)=>`<div class="row" ${st(i)}><div class="main-c">${agentAvatar(a.id,34,{title:false})}<div class="txt"><b>${esc(ident(a.id).name)}</b><span>${esc(modelLabel(a.model)||'Not set yet')}${a.provider?' · '+esc(provLabel({slug:String(a.provider),name:pretty(String(a.provider).replace(/-subscription.*$/,'').replace(/^custom:/,''))})):''}</span></div></div><div class="act">${allOpen(a.id,'Change')}</div></div>`),'No agents yet.')}</div>`}};

for(const id of ['mcp','plugins','keys','webhooks']){const base=PAGES[id];PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);const gone=pageTok(el);viewPick(await viewAgents());if(gone())return;
 if(id==='plugins'&&(S.tab.plugins||'Installed')==='Browse')return base(p,el,r);return ALLVIEW[id](p,el)}}
// Who can message and Agents' models live inside tabbed pages: their tab content is swapped for the all-agents view
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if(!showingAll()||S.tab.channels!=='Who can message')return;const box=el.querySelector('#chtab');if(!box)return;
 viewPick(await viewAgents());if(gone())return;box.innerHTML=skeletonRows(3);try{await ALLVIEW.pairing(box,gone)}catch(e){if(!gone())showError(box,e)}}}
{const base=PAGES.models;PAGES.models=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if(!showingAll())return;const box=el.querySelector('#mtab');if(!box)return;
 viewPick(await viewAgents());if(gone())return;const keep=[...box.querySelectorAll('.panel')].filter(x=>/^(Helper models|Which account each agent uses)/.test(x.querySelector('h2')?.textContent||''));
 const top=document.createElement('div');try{await ALLVIEW.models(top,gone)}catch(e){showError(top,e)}if(gone())return;box.replaceChildren(top,...keep.map(k=>{k.style.marginTop='16px';return k}))}}

// Channels › Connections lists every agent's channels (All agents); the same Showing picker narrows it to one agent's,
// and that agent's channels are the ones set up from the cards below it (1 Nov 2026: it had its own picker)
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;if((S.tab.channels||'Connections')!=='Connections')return;
 const list=await viewAgents();if(gone())return;viewPick(list);const a=showingAll()||list.length<2?'':viewing();
 const apply=()=>{for(const row of el.querySelectorAll('.row[data-from]'))row.hidden=!!a&&row.dataset.from.split('--')[0]!==a;   // every row says whose it is, extra numbers too
  const h=[...el.querySelectorAll('.panel h2')].find(x=>/channels$/.test(x.textContent)),t=a?ident(a).name+'’s channels':'Every agent’s channels';if(h&&h.textContent!==t)h.textContent=t};apply();
 const mo=new MutationObserver(apply);mo.observe(el,{childList:true,subtree:true});setTimeout(()=>mo.disconnect(),20000)}}
