// Automations › n8n: one n8n, owned by aqeelOS; every agent has its own n8n user with its own workflows. Tabs along
// the top pick whose n8n you see (admins also get All workflows, as the owner); it opens right here without signing in.
// The line above the tabs says who owns n8n and which agents have their own n8n.
PAGES.n8n=async(p,el)=>{viewPick([]);const list=await viewAgents();const admin=S.me?.admin!==false;
 const pick=S.n8nAgent&&(S.n8nAgent==='__owner'?admin:list.includes(S.n8nAgent))?S.n8nAgent:(list.includes(S.profile||'default')?S.profile||'default':list[0]);
 const st=await UI('/ui/n8n/status?agent='+encodeURIComponent(pick==='__owner'?'default':pick));
 if(!st.ready){setActions('');
  if(!admin){el.innerHTML=emptyBox('n8n isn’t connected yet','Ask an admin to connect aqeelOS to n8n on this page.','');return}
  el.innerHTML=`<div class="panel card n8n-setup"><h2>Connect aqeelOS to n8n</h2><p class="sub">This n8n already has an owner, so aqeelOS can’t set itself up. Type that n8n login once here, or have n8n reset so aqeelOS owns it and nobody ever signs in. Then every agent gets its own n8n user, opened here without signing in.</p>
   <label for="n8nEmail">n8n owner email (your n8n login, not aqeelOS)</label><input id="n8nEmail" type="email" autocomplete="off" placeholder="the email you sign in to n8n with">
   <label for="n8nPw">n8n owner password</label><input id="n8nPw" type="password" autocomplete="new-password">
   <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="primary" id="n8nGo">Connect</button><a class="hint" href="${esc(st.base)}" target="_blank" rel="noopener">Open n8n</a></div></div>`;
  el.querySelector('#n8nGo').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await post(UI,'/ui/n8n/owner',{email:$('#n8nEmail').value,password:$('#n8nPw').value});toast('n8n connected');reload()}catch(er){fail(er)}finally{b.disabled=false}};return}
 setActions(`<button data-act="n8n-tab">${icon('popout',16)}Open in a new tab</button>`);
 const users=st.users||{};const name=pick==='__owner'?'All workflows':ident(pick).name;
 const tabsHtml=[...list.map(a=>`<button class="n8n-tab${a===pick?' on':''}" data-act="n8n-pick" data-agent="${esc(a)}" aria-pressed="${a===pick}">${Access.av({id:a,name:ident(a).name},22)}<span>${esc(ident(a).name)}</span>${users[a]?'':'<small>new</small>'}</button>`),
  ...(admin?[`<button class="n8n-tab${pick==='__owner'?' on':''}" data-act="n8n-pick" data-agent="__owner" aria-pressed="${pick==='__owner'}" title="As the owner: every agent’s workflows"><span class="ic">${icon('layers',14)}</span><span>All workflows</span></button>`]:[])].join('');
 el.innerHTML=`<div class="n8n-head"><span class="n8n-own">${icon('shield',14)}n8n is owned by <b>aqeelOS</b> · each agent has its own n8n user and sees only its own workflows</span></div>
  <div class="n8n-tabs" role="tablist">${tabsHtml}</div>
  <div class="n8n-frame"><div class="n8n-wait"><span class="spinner"></span><span>Opening ${esc(name)}${pick==='__owner'?'':'’s n8n'}…</span></div><iframe title="${esc(name)} in n8n" allow="clipboard-read; clipboard-write" hidden></iframe></div>
  <p class="hint" style="margin:10px 2px 0">${pick==='__owner'?'You see every agent’s workflows as the n8n owner.':`${esc(name)} signs in as <b>${esc(users[pick]||'its own n8n user')}</b>. Turn on “Available in MCP” in a workflow’s settings so ${esc(name)} can run it.`}</p>`;
 let r;try{r=await post(UI,'/ui/n8n/open',pick==='__owner'?{owner:true}:{agent:pick})}catch(e){if(e.stale)return;el.querySelector('.n8n-frame').innerHTML=`<div class="card state-box err"><b>n8n didn’t open</b>${esc(e.message)}<br><button data-act="reload">${icon('refresh',15)}Try again</button></div>`;return}
 const f=el.querySelector('iframe');if(!f)return;f.onload=()=>{f.hidden=false;el.querySelector('.n8n-wait')?.remove()};f.src=r.url};
ACT['n8n-pick']=a=>{S.n8nAgent=a.dataset.agent;reload()};
ACT['n8n-tab']=async()=>{const a=S.n8nAgent||S.profile||'default';const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/n8n/open',a==='__owner'?{owner:true}:{agent:a});if(w)w.location=r.url;else window.open(r.url,'_blank')}catch(e){w?.close();fail(e)}};
