// Automations › n8n, laid out like Channels: one n8n (owned by aqeelOS), and in it one space per agent with its own
// workflows. Each row says which agent owns that space and which other agents may use it (they get a second n8n
// tool acting in that space). Open opens the space's n8n in a new tab, already signed in; admins can also open
// every workflow as the n8n owner.
PAGES.n8n=async(p,el)=>{viewPick([]);const admin=S.me?.admin!==false;
 const ns=await UI('/ui/n8n/status?agent=default');
 if(!ns.ready){setActions('');
  if(!admin){el.innerHTML=emptyBox('n8n isn’t connected yet','Ask an admin to connect aqeelOS to n8n on this page.','');return}
  el.innerHTML=`<div class="panel card n8n-setup"><h2>Connect aqeelOS to n8n</h2><p class="sub">This n8n already has an owner, so aqeelOS can’t set itself up. Type that n8n login once here, or have n8n reset so aqeelOS owns it and nobody ever signs in. Then every agent gets its own n8n space, opened without signing in.</p>
   <label for="n8nEmail">n8n owner email (your n8n login, not aqeelOS)</label><input id="n8nEmail" type="email" autocomplete="off" placeholder="the email you sign in to n8n with">
   <label for="n8nPw">n8n owner password</label><input id="n8nPw" type="password" autocomplete="new-password">
   <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="primary" id="n8nGo">Connect</button><a class="hint" href="${esc(ns.base)}" target="_blank" rel="noopener">Open n8n</a></div></div>`;
  el.querySelector('#n8nGo').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await post(UI,'/ui/n8n/owner',{email:$('#n8nEmail').value,password:$('#n8nPw').value});toast('n8n connected');reload()}catch(er){fail(er)}finally{b.disabled=false}};return}
 setActions(admin?`<button data-act="n8n-open" data-owner="1">${icon('popout',16)}All workflows</button>`:'');
 const d=await UI('/ui/n8n/spaces');for(const x of d.spaces)x.name=ident(x.agent).name;for(const g of d.agents)g.name=ident(g.id).name;N8N.d=d;
 const row=(x,i)=>{const users=[{id:x.agent,name:x.name},...x.shared.map(a=>({id:a,name:ident(a).name}))];
  return `<div class="row n8n-row" ${st(i)}><div class="main-c">${logoImg('n8n.io','n')}<div class="txt"><b>${esc(x.name)}’s n8n</b>
    <span>${x.workflows==null?'':plural(x.workflows,'workflow')+' · '}${esc(x.email)}</span></div></div>
   <div class="act"><span class="n8n-owner"><span class="ab-lbl">Owned by</span>${Access.av({id:x.agent,name:x.name},22)}<b>${esc(x.name)}</b></span>
    <button class="ghost small acc-btn" data-act="n8n-who" data-space="${esc(x.agent)}" title="Who can use ${esc(x.name)}’s n8n"><span class="acc-who">${users.slice(0,5).map(u=>Access.av(u)).join('')}</span><span>${users.length>1?users.length+' agents':'Only '+esc(x.name)}</span></button>
    <button data-act="n8n-open" data-space="${esc(x.agent)}">${icon('popout',15)}Open</button>
    <button class="ghost icon" data-act="n8n-more" data-space="${esc(x.agent)}" aria-label="More">${icon('more',18)}</button></div></div>`};
 el.innerHTML=`<div class="panel card"><h2>Every agent’s n8n</h2><p class="sub">One n8n, owned by aqeelOS. Each agent has its own space there with its own workflows; give other agents access and they can run that space’s workflows too. Open goes straight in, without signing in. Turn on “Available in MCP” in a workflow’s settings so agents can run it.</p>
  <div class="n8n-list">${d.spaces.map(row).join('')||'<p class="hint">No agent has n8n yet. It is made for every agent within a few minutes.</p>'}</div></div>`};
const N8N={};
ACT['n8n-open']=async a=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/n8n/open',a.dataset.owner?{owner:true}:{agent:a.dataset.space});if(w)w.location=r.url;else window.open(r.url,'_blank')}catch(e){w?.close();fail(e)}};
ACT['n8n-more']=a=>menu(a,[{label:'Open in a new tab',icon:'popout',run:()=>ACT['n8n-open'](a)},N8N.d?.canEdit&&{label:'Who can use',icon:'user',run:()=>ACT['n8n-who'](a)}].filter(Boolean));
// who can use a space: the owner always, others with one switch each
ACT['n8n-who']=a=>{const d=N8N.d;const x=d?.spaces.find(s=>s.agent===a.dataset.space);if(!x)return;
 const dr=drawer('Who can use '+x.name+'’s n8n',`<p class="hint" style="margin:0 0 14px">${esc(x.name)} owns this n8n space. Agents you turn on get a second n8n tool that works in ${esc(x.name)}’s space, so they can find and run its workflows. The agents restart by themselves once nobody is mid-reply.</p>
  <div class="share-agents">${d.agents.map((g,i)=>{const owner=g.id===x.agent,on=owner||x.shared.includes(g.id);return `<div class="share-row${owner?' has':''}" ${st(i)}>${Access.av(g,34)}<span class="txt"><b>${esc(g.name)}</b><span>${owner?'Owner':on?'Can use it':'Not yet'}</span></span>${owner?'<span class="chip blue">Owner</span>':''}${toggle(on,g.name,'data-ag="'+esc(g.id)+'"'+(owner||!d.canEdit?' disabled':''))}</div>`}).join('')}</div>`,`<button class="primary" data-act="close">Done</button>`);
 let changed=false;const mo=new MutationObserver(()=>{if(!dr.isConnected){mo.disconnect();if(changed)reload()}});mo.observe(document.body,{childList:true,subtree:true});
 dr.querySelectorAll('input[data-ag]:not([disabled])').forEach(c=>c.onchange=async()=>{c.disabled=true;try{await post(UI,'/ui/n8n/share',{space:x.agent,agent:c.dataset.ag,on:c.checked});changed=true;c.closest('.share-row').querySelector('.txt span').textContent=c.checked?'Can use it':'Not yet';toast(c.checked?ident(c.dataset.ag).name+' can use '+x.name+'’s n8n · ready in about a minute':'Taken from '+ident(c.dataset.ag).name)}catch(e){c.checked=!c.checked;fail(e)}finally{c.disabled=false}})};
