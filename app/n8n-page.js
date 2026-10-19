// Automations › n8n: the agent you show has its own n8n user, and its n8n opens right here without signing in.
// The first time, an admin connects aqeelOS to n8n with the n8n owner login (typed once, kept on the box).
PAGES.n8n=async(p,el)=>{viewPick(await viewAgents());const ag=viewing(),name=ident(ag).name;
 const st=await UI('/ui/n8n/status?agent='+encodeURIComponent(ag));
 if(!st.ready){setActions('');
  if(S.me?.admin===false){el.innerHTML=emptyBox('n8n isn’t connected yet','Ask an admin to connect aqeelOS to n8n on this page.','');return}
  el.innerHTML=`<div class="panel card n8n-setup"><h2>Connect aqeelOS to n8n</h2><p class="sub">Once only. With the n8n owner login, aqeelOS gives each agent its own n8n user, connects the agent’s n8n tool to it, and opens it here without signing in. The login stays on the AI box.</p>
   <label for="n8nEmail">n8n owner email</label><input id="n8nEmail" type="email" autocomplete="username" placeholder="you@example.com">
   <label for="n8nPw">n8n owner password</label><input id="n8nPw" type="password" autocomplete="current-password">
   <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="primary" id="n8nGo">Connect</button><a class="hint" href="${esc(st.base)}" target="_blank" rel="noopener">Open n8n</a></div></div>`;
  el.querySelector('#n8nGo').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await post(UI,'/ui/n8n/owner',{email:$('#n8nEmail').value,password:$('#n8nPw').value});toast('n8n connected');reload()}catch(er){fail(er)}finally{b.disabled=false}};return}
 setActions(`<button data-act="n8n-tab">${icon('popout',16)}Open in a new tab</button>`);
 el.innerHTML=`<div class="n8n-frame"><div class="n8n-wait"><span class="spinner"></span><span>Opening ${esc(name)}’s n8n…</span></div><iframe title="${esc(name)}’s n8n" allow="clipboard-read; clipboard-write" hidden></iframe></div>
  <p class="hint" style="margin:10px 2px 0">${st.user?`${esc(name)} signs in to n8n as <b>${esc(st.user.email)}</b> and only sees its own workflows.`:`The first time, aqeelOS makes ${esc(name)}’s own n8n user (a few seconds).`} Turn on “Available in MCP” in a workflow’s settings so ${esc(name)} can run it.</p>`;
 let r;try{r=await post(UI,'/ui/n8n/open',{agent:ag})}catch(e){if(e.stale)return;el.querySelector('.n8n-frame').innerHTML=`<div class="card state-box err"><b>n8n didn’t open</b>${esc(e.message)}<br><button data-act="reload">${icon('refresh',15)}Try again</button></div>`;return}
 const f=el.querySelector('iframe');if(!f)return;f.onload=()=>{f.hidden=false;el.querySelector('.n8n-wait')?.remove()};f.src=r.url};
ACT['n8n-tab']=async a=>{const w=window.open('about:blank','_blank');try{const r=await post(UI,'/ui/n8n/open',{agent:viewing()});if(w)w.location=r.url;else window.open(r.url,'_blank')}catch(e){w?.close();fail(e)}};
