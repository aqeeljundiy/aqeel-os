/* ---------- Connect Microsoft (11 Nov 2026): Outlook mail, Calendar and OneDrive for the agents, like Connect Google.
   Without the install's Microsoft app it shows the plain steps to register one in Microsoft Entra (once, about 5
   minutes) and takes its ID and secret; then each account is a card with what it may use, whether it still works,
   Reconnect and Remove, and "Connect Microsoft" opens Microsoft's sign-in in a new tab, which finishes by itself
   (app/microsoft-connect.mjs). Same look as Connect Google (gc-* styles). ---------- */
const MsConnect={
 SVC_IC:{mail:'mail',calendar:'clock',files:'folder'},
 chips(svcs){return (svcs||[]).map(k=>`<span class="chip gc-svc">${icon(this.SVC_IC[k]||'check',12)}${esc(this.st.services?.[k]||k)}</span>`).join('')||'<span class="hint">Nothing yet</span>'},
 async open(opt={}){this.opt=opt;const d=drawer('Connect Microsoft','<div class="gc-body"><div class="skel" style="height:64px;border-radius:12px"></div><div class="skel" style="height:64px;border-radius:12px;margin-top:8px"></div></div>',`<span class="gc-foot-l hint"></span><button class="ghost" data-act="close">Done</button>`,{size:'md'});d.classList.add('gc-dlg');this.d=d;
  try{this.st=await UI('/ui/microsoft/state')}catch(e){if(d.isConnected)d.querySelector('.gc-body').innerHTML=errLine('the Microsoft settings');return}if(!d.isConnected)return;this.paint()},
 body(){return this.d?.querySelector('.gc-body')},
 swap(html){const b=this.body();if(!b)return;b.classList.remove('gc-in');b.innerHTML=html;void b.offsetWidth;b.classList.add('gc-in')},
 foot(html){const f=this.d?.querySelector('.gc-foot-l');if(f)f.innerHTML=html;return f},
 paint(){const s=this.st;if(!s.client)return this.setup();
  this.foot(`Microsoft app: ${esc(s.client.id)}${s.client.tenant&&s.client.tenant!=='common'?' · '+esc(s.client.tenant):''}${s.canSetUp?' <button class="link-btn" data-ms="change">Change</button>':''}`).onclick=e=>{if(e.target.closest('[data-ms="change"]'))this.setup(true)};
  this.swap(`${this.opt.why?`<p class="hint gc-why">${esc(this.opt.why)}</p>`:''}
   <h3 class="gc-h">Microsoft accounts</h3><div class="gc-cards">${s.accounts.length?s.accounts.map((a,i)=>this.card(a,i)).join(''):'<p class="hint" style="margin:0">None yet. Connect the first one below.</p>'}</div>
   <h3 class="gc-h">Connect an account</h3><div class="gc-new">${this.form()}</div>`);
  this.wire();this.checkAll()},
 card(a,i){return `<div class="gc-card" data-i="${i}" ${st(Math.min(i,8))}>${logoImg('microsoft.com','M')}<div class="gc-c-t"><b>${esc(a.email||'Microsoft account')}</b>
   <small>${esc(ident(a.agent).name||a.agentName)}${a.name?' · '+esc(pretty(a.name)):' · main account'}</small><div class="gc-chips">${this.chips(a.services)}</div></div>
   <div class="gc-c-r"><span class="chip gc-stat" data-k="${esc(a.agent+'|'+a.name)}"><span class="spinner tiny"></span>Checking</span><div class="gc-acts"><button class="ghost small" data-ms="re" data-i="${i}">${icon('refresh',14)}Reconnect</button><button class="ghost icon" data-ms="rm" data-i="${i}" aria-label="Remove ${esc(a.email)}" title="Remove">${icon('trash',15)}</button></div></div></div>`},
 form(){const ags=this.st.agents||[];if(!ags.length)return '<p class="hint" style="margin:0">You have no agent of your own to connect Microsoft to yet.</p>';
  const ag=this.opt.agent&&ags.some(x=>x.id===this.opt.agent)?this.opt.agent:ags.some(x=>x.id==='default')?'default':ags[0].id;
  return `<div class="gc-grid"><div><label for="msAg">For</label><select id="msAg">${ags.map(x=>`<option value="${esc(x.id)}"${x.id===ag?' selected':''}>${esc(ident(x.id).name||x.name)}</option>`).join('')}</select></div>
   <div><label for="msName">Short name</label><input id="msName" maxlength="40" placeholder="work" autocomplete="off"></div></div>
   <p class="hint gc-name-h">Only needed when the agent already has a Microsoft account, so it can tell them apart.</p>
   <label>What it may use</label><div class="gc-pick" role="group" aria-label="Microsoft services">${Object.entries(this.st.services).map(([k,l])=>`<label class="gc-opt"><input type="checkbox" value="${k}" checked>${icon(this.SVC_IC[k],14)}<span>${esc(l)}</span></label>`).join('')}</div>
   <p class="err-line" id="msErr" hidden></p><div class="gc-go"><button class="primary" data-ms="go">${logoImg('microsoft.com','M')}Connect Microsoft</button></div>`},
 wire(){const b=this.body();b.onclick=e=>{const x=e.target.closest('[data-ms]');if(!x)return;const a=this.st.accounts[+x.dataset.i];
  if(x.dataset.ms==='go')this.connect(x);if(x.dataset.ms==='re'&&a)this.connect(x,a);if(x.dataset.ms==='rm'&&a)this.remove(a)}},
 checkAll(){this.st.accounts.forEach(a=>post(UI,'/ui/microsoft/check',{agent:a.agent,name:a.name}).then(r=>this.stat(a,r),()=>this.stat(a,{ok:null})))},
 stat(a,r){const c=this.d?.querySelector(`.gc-stat[data-k="${CSS.escape(a.agent+'|'+a.name)}"]`);if(!c)return;c.className='chip gc-stat '+(r.ok?'ok':r.ok===false?'warn':'');c.innerHTML=r.ok?'<i class="dot"></i>Works':r.ok===false?'<i class="dot"></i>Needs reconnect':'<i class="dot"></i>Not checked';if(r.why)c.title=r.why;
  if(r.ok===false){const card=c.closest('.gc-card');card.querySelector('[data-ms="re"]')?.classList.replace('ghost','primary');if(!card.querySelector('.gc-why-l'))card.querySelector('.gc-c-t').insertAdjacentHTML('beforeend',`<small class="gc-why-l">${esc(r.why||'')}</small>`)}},
 async connect(btn,re){const b=this.body(),err=b.querySelector('#msErr');if(err)err.hidden=true;
  const body=re?{agent:re.agent,name:re.name,reconnect:true}:{agent:b.querySelector('#msAg').value,name:b.querySelector('#msName').value,services:[...b.querySelectorAll('.gc-pick input:checked')].map(i=>i.value)};
  if(!re&&!body.services.length){err.textContent='Pick at least one thing it may use.';err.hidden=false;return}
  const w=window.open('about:blank','_blank');btn.disabled=true;
  try{const r=await post(UI,'/ui/microsoft/connect',body);if(w){w.opener=null;w.location.href=r.url}this.wait(r,body,re,!w)}
  catch(e){w?.close();btn.disabled=false;if(err&&!re){err.textContent=e.message;err.hidden=false}else fail(e)}},
 wait(r,body,re,blocked){const who=ident(body.agent).name;
  this.swap(`<div class="gc-wait"><div class="gc-wait-h"><span class="spinner"></span><div><b>${re?'Reconnecting '+esc(re.email):'Connecting a Microsoft account for '+esc(who)}</b><span class="hint">${blocked?'Open Microsoft to sign in.':'Finish in the Microsoft tab that opened. This updates by itself.'}</span></div></div>
   <a class="gc-again" href="${esc(r.url)}" target="_blank" rel="noopener">${blocked?'Open Microsoft':'Open Microsoft again'}</a>
   <p class="err-line" id="msWErr" hidden></p><button class="link-btn gc-back" id="msBack">Back</button></div>`);
  const b=this.body(),stop=()=>{clearTimeout(this._t);this._t=null};
  b.querySelector('#msBack').onclick=()=>{stop();this.paint()};
  const done=x=>{stop();toast((x.email||'The account')+' is connected to '+ident(x.agent).name);this.opt.onDone?.(x);this.refresh()};
  const bad=m=>{const e=b.querySelector('#msWErr');if(e){e.textContent=m;e.hidden=false}b.querySelector('.gc-wait-h .spinner')?.remove();const h=b.querySelector('.gc-wait-h b');if(h)h.textContent='Not connected';b.querySelector('.gc-wait-h .hint')?.remove();const a=b.querySelector('.gc-again');if(a)a.hidden=true;const k=b.querySelector('#msBack');if(k)k.textContent='Try again'};
  const poll=async()=>{if(!this.d?.isConnected)return stop();try{const x=await UI('/ui/microsoft/result?state='+encodeURIComponent(r.state));if(!this.d?.isConnected)return;if(x.ok)return done(x);if(x.ok===false){stop();return bad(x.error)}}catch{}this._t=setTimeout(poll,2000)};
  this._t=setTimeout(poll,2000)},
 async refresh(){try{this.st=await UI('/ui/microsoft/state')}catch{}if(!this.d?.isConnected)return;this.opt={...this.opt,why:''};this.paint();if(route().page?.id==='connections')Cx.refresh?.()},
 async remove(a){const who=ident(a.agent).name;if(!await confirmBox('Remove '+(a.email||'this account')+' from '+who+'?',who+' can no longer use this Microsoft account. Microsoft is not told; to end it everywhere, remove aqeelOS under account.microsoft.com › Privacy › Apps and services (or myapps.microsoft.com for a work account).','Remove'))return;
  try{await del(UI,'/ui/microsoft/account',{agent:a.agent,name:a.name});toast((a.email||'The account')+' removed from '+who);this.refresh()}catch(e){fail(e)}},
 // once per install: register the app in Microsoft Entra and paste its ID and secret
 setup(change=false){const s=this.st,f=this.foot(change?'<button class="link-btn" data-ms="back">Back</button>':'');
  if(!s.canSetUp){this.swap(`<div class="gc-noset">${icon('clock',18)}<div><b>Microsoft isn’t set up on this aqeelOS yet</b><p class="hint" style="margin:4px 0 0">An admin does this once for everyone (about 5 minutes, free) in Connections › Add › A Microsoft account. After that you connect your own Microsoft account here, and your agent can use it.</p></div></div>`);return}
  if(f&&change)f.querySelector('[data-ms="back"]').onclick=()=>this.paint();
  const L=(u,t)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  this.swap(`<p class="gc-lead">${change?'Use another Microsoft app, or a new secret. Accounts connected with the old one keep working until you Reconnect them.':'Microsoft needs to know aqeelOS before an agent can sign in. You do this once for everyone; it takes about 5 minutes and is free.'}</p>
   ${s.https?'':`<div class="gc-alert">${alertBox('Microsoft only accepts return addresses that start with https://. Set this install’s web address first (System › Install), then come back.',{act:'',label:'',ic:'alert'})}</div>`}
   <ol class="gc-steps">
    <li><b>Register the app.</b> Open ${L('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade','App registrations')} in the Azure portal and press New registration. Name it aqeelOS. Under Supported account types, pick <i>Accounts in any organizational directory and personal Microsoft accounts</i>.</li>
    <li><b>Give it this return address.</b> Under Redirect URI, pick Web and paste:
     <div class="sc-row gc-redir"><input readonly value="${esc(s.redirect)}" aria-label="Redirect address"><button class="ghost small" id="msCopy">${icon('copy',14)}Copy</button></div>Then press Register.</li>
    <li><b>Let it read and send for you.</b> Open API permissions › Add a permission › Microsoft Graph › Delegated permissions, tick these and press Add permissions:
     <div class="gc-chips ms-perms">${(s.permissions||[]).map(p=>`<span class="chip gc-svc">${esc(p)}</span>`).join('')}</div></li>
    <li><b>Make a secret.</b> Open Certificates &amp; secrets › New client secret, pick 24 months and press Add. Copy the <b>Value</b> right away (it is hidden later).</li>
    <li><b>Paste both here.</b> The Application (client) ID is on the app’s Overview page.
     <div class="sl-keys"><div><label for="msId">Application (client) ID</label><input id="msId" autocomplete="off" spellcheck="false" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
     <div><label for="msSec">Client secret Value</label><input id="msSec" type="password" autocomplete="new-password" spellcheck="false"></div></div></li></ol>
   <details class="sl-more"><summary>Only people from one organisation?</summary><p class="hint">Paste its Directory (tenant) ID from the Overview page. Leave it empty to let any work, school or personal Microsoft account sign in.</p><input id="msTen" autocomplete="off" spellcheck="false" placeholder="common" aria-label="Directory (tenant) ID"></details>
   <p class="err-line" id="msSErr" hidden></p>
   <div class="gc-go">${change?`<button class="ghost small" id="msRm" style="color:var(--bad);margin-right:auto">${icon('trash',14)}Remove the app</button>`:''}<button class="primary" id="msSave">Save</button></div>`);
  const b=this.body(),err=m=>{const e=b.querySelector('#msSErr');e.textContent=m;e.hidden=!m};
  b.querySelector('#msCopy').onclick=()=>copyText(s.redirect,'Address copied');
  const save=b.querySelector('#msSave');save.onclick=async()=>{err('');const id=b.querySelector('#msId').value.trim(),sec=b.querySelector('#msSec').value.trim();
   if(!id)return err('Paste the Application (client) ID first.');if(!sec)return err('Paste the client secret’s Value too.');
   save.disabled=true;try{const r=await post(UI,'/ui/microsoft/client',{client_id:id,client_secret:sec,tenant:b.querySelector('#msTen').value.trim()});this.st={...this.st,...r};toast('Microsoft app saved');this.paint()}
   catch(e){err(e.message)}finally{if(save.isConnected)save.disabled=false}};
  b.querySelector('#msRm')?.addEventListener('click',async()=>{if(!await confirmBox('Remove the Microsoft app?','New sign-ins stop until an app is added again. Accounts already connected keep working until their secret expires.','Remove'))return;try{this.st={...this.st,...await del(UI,'/ui/microsoft/client')};this.setup()}catch(e){fail(e)}})}};
ACT['ms-open']=a=>MsConnect.open({agent:a?.dataset?.agent,why:a?.dataset?.why||''});
