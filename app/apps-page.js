// Abilities › Apps (12 Nov 2026, owner: "how can I see the catalog separately? It's not a menu, which is weird. Why would
// you remove that?"). The catalog was a tab of Connected apps ("Your servers | Catalog") until 1 Nov 2026, when Connections
// replaced that page (395f352) and the catalog was left reachable only through Add › "An app from the catalog". This is
// the catalog as a page of its own again, built for its job: see what there is to connect, what each app does, whether it
// is connected and for which agents, and connect it with one button (the same add flow as Connections, for the agent you
// pick). Apps that are connected come first; apps added by their address are listed too, so "Connected" is the whole truth.
{const ab=SECTIONS.find(s=>s.id==='abilities'),at=ab.pages.findIndex(p=>p.id==='connections');
 ab.pages.splice(at+1,0,{id:'apps',label:'Apps',icon:'grid',desc:'Every app your agents can connect to: what each does, whether it is connected, and for which agents.'})}
// what kind of app it is, from its name (the engine's catalog has no categories); only kinds that have an app show as a filter
const AP_CATS=[['Messages and meetings',/slack|discord|telegram|whatsapp|gmail|outlook|twilio|zoom|teams\b|front\b|zendesk|kirim|fireflies|calendly/],
 ['Sales and customers',/attio|close\b|hubspot|salesforce|pipedrive|intercom|indeed|rentahuman|crm/],
 ['Social and marketing',/tebar|higgsfield|canva|meta\b|facebook|instagram|threads|tiktok|youtube|linkedin|mailchimp|klaviyo|shopify|buffer|webflow|wordpress|cloudinary|gamma|comfy/],
 ['Documents and design',/notion|google|drive|docs|sheets|airtable|confluence|dropbox|onedrive|obsidian|coda\b|craft|figma|miro/],
 ['Projects and tasks',/linear|jira|asana|trello|clickup|monday|todoist|basecamp|atlassian/],
 ['Data and analytics',/algolia|amplitude|mixpanel|motherduck|wolfram|twelve|posthog|bigquery|snowflake|metabase|analytics/],
 ['Money',/stripe|paypal|xero|quickbooks|wise\b|plaid|tripay|midtrans|square|robinhood/],
 ['Travel and sport',/alltrails|kiwi|trivago|strava|maps/],
 ['Code and servers',/github|gitlab|sentry|vercel|cloudflare|supabase|postgres|neon|docker|aws|render|netlify|dokploy|n8n|mongo|redis|kubernetes|datadog|betterstack|buildkite|circleci|grafana|postman|prisma|railway|semgrep|context7|deepwiki|microsoft-learn|hugging|unreal|globalping|search|browser|fetch|background runs/]];
const apCat=n=>(AP_CATS.find(([,re])=>re.test(String(n).toLowerCase()))||['Other'])[0];
const Apps={list:[],
 // a catalog app and the connections that are it (the same name, a numbered copy, or the same address)
 hostOf:u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}},
 rowsOf(m){const h=m.url?this.hostOf(m.url):'';return (Pages._cx?.rows||[]).filter(r=>r.kind==='mcp'&&!r.own&&(r.id===m.name||new RegExp('^'+m.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-\\d+$').test(r.id)||h&&(r.what==='An app at '+h||r.where===h)))},
 // everything on the page: catalog apps with who has them, then connected apps that are not in the catalog
 build(cat,cx){const rows=(cx?.rows||[]).filter(r=>r.kind==='mcp'&&!r.own),used=new Set();
  const out=(cat||[]).map(m=>{const rs=this.rowsOf(m);rs.forEach(r=>used.add(r.key));const title=m.title||pretty(m.name);
   return {id:'c:'+m.name,m,title,say:m.description||'',cat:apCat(m.name+' '+title),rows:rs,logo:logoImg(m.logo_domain||mcpDomain(m),title[0].toUpperCase())}});
  for(const r of rows)if(!used.has(r.key))out.push({id:'r:'+r.key,m:null,title:cxName(r),say:r.what||'',cat:'Added by its address',rows:[r],logo:cxLogo(r),custom:true});
  for(const a of out){a.users=[...new Set(a.rows.flatMap(r=>cxUsing(r).map(u=>u.id)))];a.need=a.rows.some(cxNeeds);a.on=a.rows.length>0}
  return out.sort((x,y)=>(y.on?1:0)-(x.on?1:0)||x.title.localeCompare(y.title))},
 how(m){if(!m)return '';const k=(m.required_env||[]).length;return m.auth_type==='oauth'?'Signs in with your account':k||/key|token|header/.test(m.auth_type||'')?'Needs a key':m.url?'No sign-in needed':'Runs on the AI box'},
 card(a,i){const u=a.users,who=u.map(x=>ident(x).name);
  const state=a.on?`<span class="ap-st"><span class="chip ${a.need?'warn':'ok'}"><i class="dot"></i>${a.need?'Needs sign-in':'Connected'}</span>${u.length?`<span class="acc-who" title="${esc(who.join(', '))}" aria-label="For ${esc(who.join(', '))}">${u.slice(0,4).map(x=>Access.av({id:x,name:ident(x).name},22)).join('')}${u.length>4?`<span class="acc-more">+${u.length-4}</span>`:''}</span>`:'<span class="hint">No agent uses it</span>'}</span>`:`<span class="ap-st"><span class="hint">${esc(this.how(a.m))}</span></span>`;
  const btn=a.on?`<button class="small" data-act="ap-manage" data-key="${esc(a.rows.find(cxNeeds)?.key||a.rows[0].key)}" aria-label="Manage ${esc(a.title)}">${a.need?'Sign in':'Manage'}</button>`:`<button class="small" data-act="ap-connect" data-name="${esc(a.m.name)}" aria-label="Connect ${esc(a.title)}">${icon('plus',14)}Connect</button>`;
  return `<div class="card tile ap-card${a.on?' on':''}" ${st(Math.min(i,14))} data-id="${esc(a.id)}"><div class="tile-top">${a.logo}<div class="ap-t"><h3>${esc(a.title)}</h3><span class="ap-cat">${esc(a.cat)}</span></div></div><p>${esc(a.say)}</p>${a.m?.plan?`<p class="t-meta">${esc(a.m.plan)}</p>`:''}<div class="tile-foot">${state}${btn}</div></div>`},
 match(a){const f=S.tab.apps||'All';if(f==='Connected'?!a.on:f!=='All'&&a.cat!==f)return false;const q=(S.apQ||'').trim().toLowerCase();return !q||[a.title,a.m?.name,a.say,a.cat,...a.users.map(x=>ident(x).name)].join(' ').toLowerCase().includes(q)},
 paint(el,first=false){const box=el.querySelector('#apGrid');if(!box)return;const l=this.list.filter(a=>this.match(a));
  const key=(S.tab.apps||'All')+'|'+(S.apQ||'');if(first||this._for!==key){this.shown=48;this._for=key}const vis=l.slice(0,this.shown);
  const draw=()=>{const html=l.length?`<div class="grid-cards ap-grid">${vis.map((a,i)=>this.card(a,first?i:0)).join('')}</div>${l.length>vis.length?`<button class="ghost cn-more" data-act="ap-more">Show ${Math.min(48,l.length-vis.length)} more of ${l.length-vis.length}</button>`:''}`:`<div class="state-box">${S.apQ?`No app matches “${esc(S.apQ)}”. <button class="link" data-act="ap-clear">Clear the search</button> or <button class="link" data-act="ap-addr">add one by its address</button>.`:'No app of this kind yet.'}</div>`;
   if(first)box.innerHTML=html;else{morph(box,html);box.querySelectorAll('.ap-card').forEach(c=>c.style.animation='none')}};
  first?draw():smoothHeight(box,draw)},
 // Connect: which agent, the keys it needs, one button. The add itself is the one Connections uses (Cx.addApp).
 connect(name){const a=this.list.find(x=>x.m?.name===name);if(!a)return;const m=a.m;Cx.forAg||=S.profile||'default';
  const req=(m.required_env||[]).map(v=>typeof v==='string'?{name:v,prompt:v,required:true}:{name:v.name||v.key,prompt:v.prompt||v.name||v.key,required:v.required!==false,help:v.help}).filter(v=>v.name);
  const d=drawer('Connect '+a.title,`<div class="ap-top">${a.logo}<div><p class="ap-say">${esc(a.say)}</p><span class="hint">${esc(this.how(m))}${m.url?' · '+esc(this.hostOf(m.url)):''}</span></div></div>${Cx.forBtn()}<p class="hint ap-have" hidden></p>
   ${req.map(v=>`<label>${esc(v.prompt)}${v.required?' <span aria-hidden="true">*</span>':''}</label><input type="password" autocomplete="new-password" data-k="${esc(v.name)}" data-req="${v.required?1:''}">${v.help?`<p class="hint" style="margin:2px 0 0"><a href="${esc(v.help)}" target="_blank" rel="noopener">Where to get it</a></p>`:''}`).join('')}
   <p class="hint ap-next">${m.auth_type==='oauth'?'After it is added, its panel opens: press Sign in there and allow access on '+esc(a.title)+'’s own page.':'It is ready to use as soon as it is added.'}</p><p class="err-line" id="apErr" role="alert" hidden></p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="apGo">${icon('plus',15)}Connect</button>`,{size:'md'});
  const go_=d.querySelector('#apGo'),have=d.querySelector('.ap-have');
  // an agent that has it already can't get it twice from here: say so instead of failing after the click
  const check=()=>{const ag=Cx.forAg||S.profile||'default',has=a.rows.some(r=>r.users.some(u=>u.id===ag));have.hidden=!has;have.textContent=has?ident(ag).name+' already has '+a.title+'. Pick another agent, or press Manage on its card to change it.':'';go_.disabled=has};
  Cx.onFor=()=>{if(d.isConnected)check()};check();
  go_.onclick=async()=>{const err=d.querySelector('#apErr'),miss=[...d.querySelectorAll('[data-req="1"]')].filter(i=>!i.value.trim());err.hidden=true;
   if(miss.length){err.textContent='Fill in '+miss.map(i=>i.previousElementSibling?.textContent.replace(/\s*\*$/,'')).join(', ')+'.';err.hidden=false;miss[0].focus();return}
   const env={};d.querySelectorAll('[data-k]').forEach(i=>{if(i.value.trim())env[i.dataset.k]=i.value.trim()});const ag=Cx.forAg||S.profile||'default';
   go_.disabled=true;go_.innerHTML='<span class="spinner tiny"></span>Connecting…';
   try{const r=await Cx.addApp(m,ag,env);closeLayers();if(r.action)actionDrawer('Installing '+a.title,r.action);else toast(a.title+' added to '+ident(ag).name+(r.oauth?' · press Sign in on it':' · ready to use'));
    // an app that signs in opens on its panel in Connections, where Sign in is the one button left to press
    if(r.oauth&&!r.action){Cx.openKey='mcp:'+m.name;S.tab.connections='Apps';S.cxQ='';go('/abilities/connections')}else reload()}
   catch(e){go_.disabled=false;go_.innerHTML=icon('plus',15)+'Connect';err.textContent=e.message||'Could not add it.';err.hidden=false}}}};
PAGES.apps=async(p,el)=>{const gone=pageTok(el);
 setActions(`<button data-act="cn-go" data-to="/abilities/connections">${icon('plug',16)}Open Connections</button><button class="primary" data-act="ap-addr">${icon('link',16)}Add by address</button>`);
 if(!el.querySelector('#apGrid'))el.innerHTML=`<div class="grid-cards">${'<div class="card tile"><div class="skel" style="height:132px"></div></div>'.repeat(8)}</div>`;
 const [c,cx]=await Promise.all([H('/mcp/catalog').catch(e=>({err:e})),UI('/ui/connections').catch(()=>null)]);if(gone())return;
 if(cx)Pages._cx=cx;Pages._mcpCat=c.entries||[];Apps.list=Apps.build(c.entries||[],cx);
 if(!Apps.list.length){el.innerHTML=`<div class="panel card"><h2>The catalog did not load</h2><p class="sub">${esc(c.err?.message||'The engine did not answer.')} The engine may be busy or restarting.</p><button class="primary" data-act="reload">Try again</button></div>`;return}
 const cats=AP_CATS.map(x=>x[0]).concat('Other','Added by its address').filter(k=>Apps.list.some(a=>a.cat===k)),nOn=Apps.list.filter(a=>a.on).length,tabsL=['All',...(nOn?['Connected']:[]),...cats];if(!tabsL.includes(S.tab.apps))S.tab.apps='All';
 el.innerHTML=`<div class="toolbar cn-bar ap-bar"><div class="search${S.apQ?' has-q':''}">${icon('search',16)}<input id="apQ" type="search" enterkeyhint="search" placeholder="Search ${Apps.list.length} apps" value="${esc(S.apQ||'')}" aria-label="Search apps"><button class="ghost icon s-clear" data-act="ap-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div>${tabs('apps',tabsL)}</div>
  ${c.err?errLine('the catalog (only what is connected shows)'):''}<div id="apGrid"></div>
  <p class="hint cn-foot">Connect adds the app to the agent you pick; it then shows under Connections, where you choose which other agents can use it and how much. An app that is not here can be added by its address.</p>`;placePills();
 {const b=el.querySelector('[data-tabs="apps"] [data-tab="Connected"]');if(b)b.insertAdjacentHTML('beforeend',` <span class="tab-n">${nOn}</span>`)}
 Apps.paint(el,true);
 const q=el.querySelector('#apQ');let t;q.oninput=()=>{q.closest('.search').classList.toggle('has-q',!!q.value);clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected)return;S.apQ=q.value;Apps.paint(el)},120)};
 el.querySelector('[data-tabs="apps"]').addEventListener('click',e=>{if(e.target.closest('[data-tab]'))setTimeout(()=>Apps.paint(el),0)})};
ACT['ap-connect']=a=>Apps.connect(a.dataset.name);
ACT['ap-manage']=a=>{Cx.openKey=a.dataset.key;S.tab.connections='Apps';S.cxQ='';go('/abilities/connections')};
ACT['ap-more']=()=>{const el=$('#apGrid')?.parentElement;Apps.shown=(Apps.shown||48)+48;if(el)Apps.paint(el)};
ACT['ap-clear']=()=>{S.apQ='';const i=$('#apQ');if(i){i.value='';i.closest('.search')?.classList.remove('has-q');i.focus()}const el=$('#apGrid')?.parentElement;if(el)Apps.paint(el)};
ACT['ap-addr']=()=>Cx.byAddress();
