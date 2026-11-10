// Automations › n8n: one n8n, and in it one space per agent with its own workflows, as a Connections table (10 Nov 2026).
// Each space belongs to its agent; other agents it is shared with get a second n8n tool acting in that space. Open opens
// the space in a new tab, already signed in; admins can also open every workflow as the n8n owner.
PAGES.n8n=async(p,el)=>{viewPick([]);const admin=S.me?.admin!==false;
 const ns=await UI('/ui/n8n/status?agent=default');
 if(!ns.ready){setActions('');
  if(!admin){el.innerHTML=emptyBox('n8n isn’t connected yet','Ask an admin to connect aqeelOS to n8n on this page.','');return}
  // nothing answers at the n8n address: say so and let the admin fix the address here (not "already has an owner")
  if(ns.reach&&!ns.reach.ok){el.innerHTML=`<div class="panel card n8n-setup"><h2>aqeelOS can’t reach n8n</h2><p class="sub">${esc(ns.reach.why||'Nothing answers at that address.')} Type the address where your n8n runs, then press Check and save. No n8n yet? Install it on this server first, then come back.</p>
   <label for="n8nBase">n8n address</label><input id="n8nBase" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://n8n.example.com" value="${esc(ns.base||'')}">
   <p class="hint" id="n8nWhy" aria-live="polite"></p>
   <div style="display:flex;gap:10px;align-items:center;margin-top:6px"><button class="primary" id="n8nCheck">Check and save</button></div></div>`;
   el.querySelector('#n8nCheck').onclick=async e=>{const b=e.currentTarget;b.disabled=true;const why=el.querySelector('#n8nWhy');why.textContent='Checking…';
    try{const r=await post(UI,'/ui/n8n/base',{url:el.querySelector('#n8nBase').value});if(r.ok){toast('n8n found');reload()}else why.textContent=r.why||'Nothing answers at that address.'}catch(er){why.textContent='';fail(er)}finally{b.disabled=false}};return}
  el.innerHTML=`<div class="panel card n8n-setup"><h2>Connect aqeelOS to n8n</h2><p class="sub">This n8n already has an owner, so aqeelOS can’t set itself up. Type that n8n login once here, or have n8n reset so aqeelOS owns it and nobody ever signs in. Then every agent gets its own n8n space, opened without signing in.</p>
   <label for="n8nEmail">n8n owner email (your n8n login, not aqeelOS)</label><input id="n8nEmail" type="email" autocomplete="off" placeholder="the email you sign in to n8n with">
   <label for="n8nPw">n8n owner password</label><input id="n8nPw" type="password" autocomplete="new-password">
   <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="primary" id="n8nGo">Connect</button><a class="hint" href="${esc(ns.base)}" target="_blank" rel="noopener">Open n8n</a></div></div>`;
  el.querySelector('#n8nGo').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await post(UI,'/ui/n8n/owner',{email:$('#n8nEmail').value,password:$('#n8nPw').value});toast('n8n connected');reload()}catch(er){fail(er)}finally{b.disabled=false}};return}
 setActions(admin?`<button data-act="n8n-open" data-owner="1">${icon('popout',16)}All workflows</button>`:'');
 const gone=pageTok(el);const d=await UI('/ui/n8n/spaces');if(gone())return;for(const x of d.spaces)x.name=ident(x.agent).name;for(const g of d.agents)g.name=ident(g.id).name;N8N.d=d;
 el.innerHTML=d.spaces.length?`<div class="card list cn-list cn-5"><div class="cn-head" aria-hidden="true"><span>n8n space</span><span>Belongs to</span><span>Who can use</span><span>Workflows</span><span></span></div><div class="cn-rows">${d.spaces.map(N8N.row).join('')}</div></div>
  <p class="hint cn-foot">${d.canEdit?'Click a row to see who can use it and to give it to other agents.':'Click a row to see who can use it.'}</p>`
  :emptyBox('No n8n spaces yet','Every agent gets its own n8n space within a few minutes.');
 if(N8N.dr?.isConnected)N8N.paint()};
// One way to show shared things (10 Nov 2026): the Connections table. Each agent's space belongs to that agent; who can
// use it are the owner and the agents it is shared with (a second n8n tool working in that space). Open stays on the
// row, the main thing to do; the row opens one centered panel like a connection's.
const N8N={d:null,dr:null,at:null,changed:false,
 space(id){return this.d?.spaces.find(s=>s.agent===id)},
 users:x=>[{id:x.agent,name:x.name},...x.shared.map(a=>({id:a,name:ident(a).name}))],
 row(x,i){const u=N8N.users(x),wf=x.workflows==null?'':plural(x.workflows,'workflow');
  return `<div class="row clickable cn-row" data-act="n8n-panel" data-space="${esc(x.agent)}" tabindex="0" role="button" aria-label="${esc(x.name)}’s n8n: belongs to ${esc(x.name)}${wf?', '+esc(wf):''}" ${st(i)}>
  <div class="main-c">${logoImg('n8n.io','n')}<div class="txt"><b>${esc(x.name)}’s n8n</b><span>${esc(wf||'Workflows not counted yet')}</span></div></div>
  <div class="cn-own"><small class="cn-lbl">Belongs to</small>${cxOwner({owner:x.agent,ownerName:x.name})}</div>
  <div class="cn-who"><small class="cn-lbl">Who can use</small><span class="acc-who" aria-label="Used by ${esc(u.map(y=>y.name).join(', '))}">${u.slice(0,3).map(y=>Access.av(y)).join('')}${u.length>3?`<span class="acc-more">+${u.length-3}</span>`:''}</span></div>
  <div class="cn-st"><span class="cn-o" aria-label="${esc(wf)}">${x.workflows==null?'–':x.workflows}</span></div>
  <button class="small cn-go" data-act="n8n-open" data-space="${esc(x.agent)}" aria-label="Open ${esc(x.name)}’s n8n">${icon('popout',14)}Open</button></div>`},
 open(id){const x=this.space(id);if(!x)return toast('That n8n space is gone. Reload the page.','err');this.at=id;this.changed=false;
  const dr=drawer(x.name+'’s n8n',`<div class="cn-p cn-in"></div>`,`<button class="primary" data-act="close">Done</button>`,{size:'md'});dr.classList.add('cn-drawer');this.dr=dr;this.paint();
  setTimeout(()=>dr.querySelector('.cn-p')?.classList.remove('cn-in'),700);
  // a change shows on the list once the panel closes
  const mo=new MutationObserver(()=>{if(!dr.isConnected){mo.disconnect();if(this.changed)reload()}});mo.observe(document.body,{childList:true});},
 paint(){const b=this.dr?.querySelector('.cn-p'),x=this.space(this.at);if(!b)return;if(!x){closeLayers();return}b.innerHTML=this.body(x)},
 body(x){const edit=this.d?.canEdit,others=this.d.agents.filter(g=>g.id!==x.agent&&!x.shared.includes(g.id));
  const top=`<div class="cn-top">${logoImg('n8n.io','n')}<div class="cn-top-t"><span class="hint">n8n space</span><p>${esc(x.name)}’s own workflows in n8n. Open goes straight in, without signing in.</p><div class="cn-top-st"><span class="chip"><i class="dot"></i>${esc(x.workflows==null?'Workflows not counted yet':plural(x.workflows,'workflow'))}</span></div></div></div>`;
  const own=`<section class="cn-sec"><h3>Belongs to</h3><div class="cn-line">${agentAvatar(x.agent,30,{title:false})}<span class="cn-lt"><b>${esc(x.name)}</b><small>Every agent has its own space, so it stays with this agent</small></span></div></section>`;
  const lines=`<div class="cn-line">${agentAvatar(x.agent,30,{title:false})}<span class="cn-lt"><b>${esc(x.name)}</b><small>It belongs to this agent</small></span></div>`+x.shared.map(g=>`<div class="cn-line">${agentAvatar(g,30,{title:false})}<span class="cn-lt"><b>${esc(ident(g).name)}</b><small>Can find and run its workflows</small></span>${edit?`<button class="ghost icon cn-rm" data-act="n8n-rm" data-agent="${esc(g)}" title="Take it from ${esc(ident(g).name)}" aria-label="Take ${esc(x.name)}’s n8n from ${esc(ident(g).name)}">${icon('x',15)}</button>`:''}</div>`).join('');
  const n=x.shared.length+1;
  const acc=`<section class="cn-sec"><h3>Who can use it <small class="hint">${n===1?'only '+esc(x.name):n+' agents'}</small></h3><p class="hint cn-how">Agents added here get a second n8n tool that works in this space. They pick it up by themselves once nobody is mid-reply.</p><div class="cn-lines">${lines}</div>
   ${edit&&others.length?`<button class="small cn-addag" data-act="n8n-add" aria-haspopup="menu">${icon('plus',14)}Add agent</button>`:''}</section>`;
  const B=[`<button class="small" data-act="n8n-open" data-space="${esc(x.agent)}">${icon('popout',14)}Open</button>`];if(edit)B.push(`<button class="small" data-act="n8n-open" data-owner="1">${icon('popout',14)}Open all workflows</button>`);
  return top+own+acc+`<section class="cn-sec cn-do"><div class="cn-btns">${B.join('')}</div><p class="hint cn-signst">Turn on “Available in MCP” in a workflow’s settings so agents can run it.</p></section>`},
 async share(btn,g,on){const x=this.space(this.at);if(!x)return;const was=btn?.innerHTML;if(btn){btn.disabled=true;btn.innerHTML='<span class="spinner tiny"></span>'}
  try{await post(UI,'/ui/n8n/share',{space:x.agent,agent:g,on});this.changed=true;x.shared=on?[...new Set([...x.shared,g])]:x.shared.filter(y=>y!==g);toast(x.name+'’s n8n '+(on?'on for ':'taken from ')+ident(g).name+' · ready in about a minute');this.paint()}
  catch(e){if(btn?.isConnected){btn.disabled=false;btn.innerHTML=was}fail(e)}}};
ACT['n8n-open']=async a=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/n8n/open',a.dataset.owner?{owner:true}:{agent:a.dataset.space});if(w)w.location=r.url;else window.open(r.url,'_blank')}catch(e){w?.close();fail(e)}};
ACT['n8n-panel']=a=>N8N.open(a.dataset.space);
ACT['n8n-who']=ACT['n8n-panel'];
ACT['n8n-add']=a=>{const x=N8N.space(N8N.at);if(!x)return;const l=N8N.d.agents.filter(g=>g.id!==x.agent&&!x.shared.includes(g.id));
 menu(a,[{header:'Give '+x.name+'’s n8n to'},...l.map(g=>({label:g.name,ava:agentAvatar(g.id,20,{title:false}),run:()=>N8N.share(a,g.id,true)}))],{search:l.length>6})};
ACT['n8n-rm']=async a=>{const x=N8N.space(N8N.at),g=a.dataset.agent;if(!x)return;
 if(!await confirmBox('Take '+x.name+'’s n8n from '+ident(g).name+'?',ident(g).name+' can’t find or run its workflows until it is given again here.','Take it away'))return;N8N.share(a,g,false)};
