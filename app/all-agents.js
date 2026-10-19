// "All agents" in the Showing picker: on Connected apps, Plugins, Keys, Webhooks, Who can message and Agents' models
// you can look at every agent's at once, each row saying which agent owns it, instead of switching one by one.
// Changing something still happens on the owner: "Open" switches the page to that agent. (Scheduled runs already
// show every agent with their own filter.)
const ALL_PAGES=new Set(['mcp','plugins','keys','webhooks','channels','models']);
const allHere=()=>{const id=route().page?.id;if(!ALL_PAGES.has(id))return false;if(id==='channels')return (S.tab.channels||'Connections')==='Who can message';if(id==='models')return S.tab.models==='Agents’ models';return true};
const showingAll=()=>!!S.viewAll&&allHere();
// the picker says "All agents" while that is what you see
{const base=viewPick;viewPick=list=>{base(list);if(!showingAll())return;const b=$('.page-head .head-actions .view-pick');if(!b)return;b.classList.add('other');b.title='Every agent’s, each with its owner';
 b.innerHTML=`<span class="vp-ava all">${icon('layers',14)}</span><span class="vp-t"><small>Showing</small><b>All agents</b></span>${icon('chevD',15)}`}}
ACT['view-pick']=async a=>{const list=await viewAgents(),me=S.profile||'default';
 menu(a,[{header:'Show whose'},...(allHere()?[{label:'All agents',icon:'layers',on:showingAll(),sub:'Everything at once, with owners',run:()=>{S.viewAll=true;S.viewAgent=null;reload()}},'-']:[]),
  ...list.map(n=>({label:ident(n).name,icon:'user',on:!showingAll()&&n===viewing(),sub:n===me?'You chat with this one':'',run:()=>{S.viewAll=false;S.viewAgent=n===me?null:n;Pages._toolCache=null;Pages._dirty=null;reload()}}))],{search:list.length>6,matchWidth:true})};
ACT['all-open']=a=>{S.viewAll=false;const n=a.dataset.agent,me=S.profile||'default';S.viewAgent=n===me?null:n;Pages._toolCache=null;reload()};
const allOpen=(agent,label='Open')=>`<button class="ghost small" data-act="all-open" data-agent="${esc(agent)}" title="Open on ${esc(ident(agent).name)}">${esc(label)}${icon('chevR',14)}</button>`;
const allRow=(i,logo,title,sub,it,extra='')=>`<div class="row" ${st(i)}><div class="main-c">${logo}<div class="txt"><b>${title}</b>${sub?`<span>${sub}</span>`:''}${it?Access.from(it):''}</div></div><div class="act">${extra}${it?Access.btn(it):''}${it?allOpen(it.owner):''}</div></div>`;
const allSection=(title,rows,empty)=>`<h2 class="ach-cat" style="margin-top:0">${esc(title)} <small class="hint">${rows.length}</small></h2>${rows.length?`<div class="card list">${rows.join('')}</div>`:`<p class="hint">${esc(empty)}</p>`}`;
const notSigned=it=>{const n=it.users.filter(u=>!u.signed).map(u=>u.name);return n.length?`<span class="acc-nosign" title="Set up but not signed in">Not signed in on ${esc(n.join(', '))}</span>`:''};

const ALLVIEW={
 async mcp(p,el){setActions('');const [m,g]=await Promise.all([Access.load('mcp'),Access.load('google')]);if(!m)throw new Error('Only admins can see every agent’s apps.');
  const host=d=>hostOf(d)||'';
  el.innerHTML=`<div class="all-view">${allSection('Connected apps',m.items.map((it,i)=>allRow(i,host(it.detail)?logoImg(baseDomain(host(it.detail)),it.label[0].toUpperCase()):`<span class="ic">${icon('plug',17)}</span>`,esc(it.label),esc(host(it.detail)||it.detail),it,notSigned(it))),'No connected apps yet.')}
   <div style="height:18px"></div>${allSection('Google accounts',(g?.items||[]).map((it,i)=>allRow(i,logoImg('google.com','G'),esc(it.label),esc(it.detail),it)),'No Google accounts yet.')}</div>`},
 async plugins(p,el){setActions('');const d=await Access.load('plugin');if(!d)throw new Error('Only admins can see every agent’s plugins.');
  el.innerHTML=`<div class="all-view">${allSection('Plugins turned on',d.items.map((it,i)=>{const v=ex('plugin',it.id);return allRow(i,`<span class="ic blue">${icon('layers',17)}</span>`,esc(v?.title||pretty(it.id))+` <small class="realname">${esc(it.id)}</small>`,esc(v?.summary||''),it)}),'No plugins are turned on.')}</div>`},
 async keys(p,el){setActions('');const d=await Access.load('key');if(!d)throw new Error('Only admins can see every agent’s keys.');
  el.innerHTML=`<div class="all-view"><p class="hint" style="margin:0 0 14px">Values stay hidden. Open an agent to change or remove its keys.</p>${allSection('Keys and secrets',d.items.map((it,i)=>allRow(i,`<span class="ic">${icon('key',16)}</span>`,`<span style="font-family:var(--mono);font-size:13px">${esc(it.label)}</span>`,esc(it.detail),it)),'No keys yet.')}</div>`},
 async webhooks(p,el){setActions('');const list=await viewAgents();
  const all=(await Promise.all(list.map(async a=>((await H('/webhooks?profile='+encodeURIComponent(a)).catch(()=>({})))?.subscriptions||[]).map(s=>({...s,__a:a}))))).flat();
  el.innerHTML=`<div class="all-view">${allSection('Webhooks',all.map((s,i)=>`<div class="row" ${st(i)}><div class="main-c"><span class="ic">${icon('hook',17)}</span><div class="txt"><b>${esc(s.name||s.id||'Webhook')}</b><span>${esc(s.description||s.path||s.url||'')}</span><span class="acc-from">${Access.av({id:s.__a,name:ident(s.__a).name},16)}Owned by ${esc(ident(s.__a).name)}</span></div></div><div class="act">${allOpen(s.__a)}</div></div>`),'No webhooks on any agent.')}</div>`},
 async pairing(el){const list=await viewAgents();
  const per=await Promise.all(list.map(async a=>({a,d:await H('/pairing?profile='+encodeURIComponent(a)).catch(()=>({pending:[],approved:[]}))})));
  const who=(u,a)=>`${logoImg(CH_DOMAINS[u.platform],(u.platform||'?')[0].toUpperCase(),CH_COLORS[u.platform])}<div class="txt"><b>${esc(u.user_name||u.user_id)} · ${esc(pretty(u.platform))}</b><span>${u.request_id?'Code '+esc(u.request_id)+' · ':''}${u.age_minutes!=null?Math.round(u.age_minutes)+' min ago':'ID '+esc(u.user_id)}</span><span class="acc-from">${Access.av({id:a,name:ident(a).name},16)}For ${esc(ident(a).name)}</span></div>`;
  const pend=per.flatMap(x=>(x.d.pending||[]).map(u=>({u,a:x.a}))),appr=per.flatMap(x=>(x.d.approved||[]).map(u=>({u,a:x.a})));
  el.innerHTML=`<div class="panel card"><h2>People waiting</h2><p class="sub">Someone messaged one of your agents’ channels and needs your OK before the agent answers them.</p>${pend.map(({u,a})=>`<div class="row" style="padding:12px;margin:0 -12px;border:0"><div class="main-c">${who(u,a)}</div><div class="act"><button class="primary" data-act="pair-ok" data-p="${esc(u.platform)}" data-r="${esc(u.request_id)}" data-prof="${esc(a)}">Approve</button></div></div>`).join('')||'<p class="hint" style="margin:0">Nobody is waiting.</p>'}</div>
   <div class="panel card"><h2>Approved</h2><p class="sub">Who can message which agent.</p>${appr.map(({u,a})=>`<div class="row" style="padding:12px;margin:0 -12px;border:0"><div class="main-c">${who(u,a)}</div><div class="act"><button class="ghost" data-act="pair-revoke" data-p="${esc(u.platform)}" data-u="${esc(u.user_id)}" data-prof="${esc(a)}">Remove access</button></div></div>`).join('')||'<p class="hint" style="margin:0">No one yet.</p>'}</div>`},
 async models(el){let d={agents:[]};try{d=await UI('/ui/models/agents')}catch(e){throw e}
  el.innerHTML=`<div class="all-view">${allSection('Each agent’s model',d.agents.map((a,i)=>`<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a.id,name:a.name},34)}<div class="txt"><b>${esc(a.name)}</b><span>${esc(modelLabel(a.model))}${a.provider?' · '+esc(pretty(String(a.provider).replace(/-subscription.*$/,'').replace(/^custom:/,''))):''}</span></div></div><div class="act">${allOpen(a.id,'Change')}</div></div>`),'No agents yet.')}</div>`}};

for(const id of ['mcp','plugins','keys','webhooks']){const base=PAGES[id];PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);viewPick(await viewAgents());
 if(id==='mcp'||id==='plugins'){/* keep the page's own tabs (Catalog, Browse) */}return ALLVIEW[id](p,el)}}
// Who can message and Agents' models live inside tabbed pages: their tab content is swapped for the all-agents view
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{await base(p,el,r);if(!showingAll())return;const box=el.querySelector('#chtab');if(!box)return;
 viewPick(await viewAgents());box.innerHTML='<div class="skel" style="height:140px;border-radius:18px"></div>';try{await ALLVIEW.pairing(box)}catch(e){showError(box,e)}}}
{const base=PAGES.models;PAGES.models=async(p,el,r)=>{await base(p,el,r);if(!showingAll())return;const box=el.querySelector('#mtab');if(!box)return;
 viewPick(await viewAgents());const keep=[...box.querySelectorAll('.panel')].filter(x=>/^(Helper models|Which account each agent uses)/.test(x.querySelector('h2')?.textContent||''));
 const top=document.createElement('div');try{await ALLVIEW.models(top)}catch(e){showError(top,e)}box.replaceChildren(top,...keep.map(k=>{k.style.marginTop='16px';return k}))}}
// Channels › Connections lists every agent's channels; the same picker narrows it to one agent's (rows stay, others fold away)
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{await base(p,el,r);if((S.tab.channels||'Connections')!=='Connections')return;
 const list=await viewAgents();const box=$('.page-head .head-actions');if(!box||list.length<2)return;let b=box.querySelector('.view-pick');
 if(!b){b=document.createElement('button');b.type='button';b.className='view-pick';b.dataset.act='ch-pick';box.prepend(b)}b.dataset.act='ch-pick';
 const a=S.chAgent&&list.includes(S.chAgent)?S.chAgent:'';const i=a?ident(a):null;b.classList.toggle('other',!!a);
 b.innerHTML=a?`<span class="vp-ava">${i.avatar?`<img src="${esc(i.avatar)}" alt="">`:esc(i.name[0]||'?')}</span><span class="vp-t"><small>Showing</small><b>${esc(i.name)}</b></span>${icon('chevD',15)}`:`<span class="vp-ava all">${icon('layers',14)}</span><span class="vp-t"><small>Showing</small><b>All agents</b></span>${icon('chevD',15)}`;
 const apply=()=>{for(const s of el.querySelectorAll('[data-chmove][data-from]')){const row=s.closest('.row');if(row)row.hidden=!!a&&s.dataset.from.split('--')[0]!==a}};apply();
 const mo=new MutationObserver(apply);mo.observe(el,{childList:true,subtree:true});setTimeout(()=>mo.disconnect(),20000)}}
ACT['ch-pick']=async a=>{const list=await viewAgents();menu(a,[{header:'Show whose channels'},{label:'All agents',icon:'layers',on:!S.chAgent,run:()=>{S.chAgent='';reload()}},'-',
 ...list.map(n=>({label:ident(n).name,icon:'user',on:S.chAgent===n,run:()=>{S.chAgent=n;reload()}}))],{matchWidth:true})};
// the shared AdsPower screen says which agents can draw on it, so one screen per agent stays clear
// (screen.js loads after this file)
setTimeout(()=>{if(typeof Screen==='undefined')return;const ads={who:'',at:0};const load=async()=>{if(Date.now()-ads.at<300000||S.me?.admin===false)return;ads.at=Date.now();const d=await Access.load('mcp');const it=d?.items.find(x=>/adspower/i.test(x.id));ads.who=it?it.users.map(u=>u.name).join(', '):''};
 const base=Screen.picker.bind(Screen);Screen.picker=function(){load().catch(()=>{});return base().split('AdsPower screen').join(ads.who?'AdsPower screen (shared: '+ads.who+')':'AdsPower screen')};
 const tip=Screen.noteTip.bind(Screen);Screen.noteTip=function(){return this.ads&&ads.who?'AdsPower browsers of '+ads.who+' draw here, on one shared screen':tip()}},0);
