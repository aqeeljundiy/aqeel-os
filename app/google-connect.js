/* ---------- Connect Google (7 Nov 2026): one dialog for every Google account the agents use, with no chat, file or
   command. Without the Google client file it shows the plain steps to make one (once, about 5 minutes) and takes the
   file; then each account is a card with what it may use (Gmail, Drive…), whether it still works, Reconnect and Remove,
   and "Connect an account" opens Google's sign-in in a new tab. A Web-application client finishes by itself; a Desktop
   client needs the address Google ends on pasted back. Backups, Google shares and the agents' Google tools all read
   the same sign-in files (app/google-connect.mjs). ---------- */
const GC={
 SVC_IC:{gmail:'mail',calendar:'clock',drive:'folder',sheets:'list',docs:'file',contacts:'user'},
 chips(svcs,labels){return (svcs||[]).map(k=>`<span class="chip gc-svc">${icon(this.SVC_IC[k]||'check',12)}${esc(labels?.[k]||k)}</span>`).join('')||'<span class="hint">No Google services</span>'},
 async open(opt={}){this.opt=opt;const d=drawer('Connect Google','<div class="gc-body"><div class="skel" style="height:64px;border-radius:12px"></div><div class="skel" style="height:64px;border-radius:12px;margin-top:8px"></div></div>',`<span class="gc-foot-l hint"></span><button class="ghost" data-act="close">Done</button>`,{size:'md'});d.classList.add('gc-dlg');this.d=d;
  try{this.st=await UI('/ui/google/state')}catch(e){if(d.isConnected)d.querySelector('.gc-body').innerHTML=errLine('the Google settings');return}if(!d.isConnected)return;this.paint()},
 body(){return this.d?.querySelector('.gc-body')},
 swap(html){const b=this.body();if(!b)return;b.classList.remove('gc-in');b.innerHTML=html;void b.offsetWidth;b.classList.add('gc-in')},
 paint(){const s=this.st;if(!s.client)return this.setup();const f=this.d.querySelector('.gc-foot-l');
  if(f)f.innerHTML=`Google client: ${s.client.type==='web'?'Web application':'Desktop app'}${s.client.project?' · '+esc(s.client.project):''}${s.canSetUp===false?'':' <button class="link-btn" data-gc="client">Change</button>'}`;
  this.swap(`${s.client.redirectOk?'':`<div class="gc-alert">${alertBox('Google does not list this address for the client yet: <code>'+esc(s.redirect)+'</code>. Add it under Authorised redirect URIs, or sign-ins stop at an error.',{act:'',id:'gcCopyR',label:'Copy address',ic:'copy'})}</div>`}
   ${this.opt.why?`<p class="hint gc-why">${esc(this.opt.why)}</p>`:''}
   <h3 class="gc-h">Google accounts</h3><div class="gc-cards">${s.accounts.length?s.accounts.map((a,i)=>this.card(a,i)).join(''):'<p class="hint" style="margin:0">None yet. Connect the first one below.</p>'}</div>
   <h3 class="gc-h">Connect an account</h3><div class="gc-new">${this.form()}</div>`);
  this.wire();this.checkAll()},
 card(a,i){return `<div class="gc-card" data-i="${i}" ${st(Math.min(i,8))}>${logoImg('google.com','G')}<div class="gc-c-t"><b>${esc(a.email||'Google account')}</b>
   <small>${esc(ident(a.agent).name||a.agentName)}${a.name?' · '+esc(pretty(a.name)):' · main account'}${a.by==='agent'?' · connected by the agent':''}</small><div class="gc-chips">${this.chips(a.services,this.st.services)}</div></div>
   <div class="gc-c-r"><span class="chip gc-stat" data-k="${esc(a.agent+'|'+a.name)}"><span class="spinner tiny"></span>Checking</span><div class="gc-acts"><button class="ghost small" data-gc="re" data-i="${i}">${icon('refresh',14)}Reconnect</button><button class="ghost icon" data-gc="rm" data-i="${i}" aria-label="Remove ${esc(a.email)}" title="Remove">${icon('trash',15)}</button></div></div></div>`},
 form(){const ags=this.st.agents;if(!ags.length)return '<p class="hint" style="margin:0">You have no agent of your own to connect Google to yet.</p>';
  const ag=this.opt.agent&&ags.some(x=>x.id===this.opt.agent)?this.opt.agent:ags.some(x=>x.id==='default')?'default':ags[0].id,want=this.opt.services||Object.keys(this.st.services);
  return `<div class="gc-grid"><div><label for="gcAg">For</label><select id="gcAg">${ags.map(x=>`<option value="${esc(x.id)}"${x.id===ag?' selected':''}>${esc(ident(x.id).name||x.name)}</option>`).join('')}</select></div>
   <div><label for="gcName">Short name</label><input id="gcName" maxlength="40" placeholder="work" autocomplete="off"></div></div>
   <p class="hint gc-name-h">Only needed when the agent already has a Google account, so it can tell them apart.</p>
   <label>What it may use</label><div class="gc-pick" role="group" aria-label="Google services">${Object.entries(this.st.services).map(([k,l])=>`<label class="gc-opt"><input type="checkbox" value="${k}"${want.includes(k)?' checked':''}>${icon(this.SVC_IC[k],14)}<span>${esc(l)}</span></label>`).join('')}</div>
   ${this.opt.services?.includes('drive')?'<p class="hint">Keep Drive on: backups are saved there.</p>':''}
   <p class="err-line" id="gcErr" hidden></p><div class="gc-go"><button class="primary" data-gc="go">${logoImg('google.com','G')}Connect Google</button></div>`},
 wire(){const b=this.body();b.onclick=e=>{const x=e.target.closest('[data-gc]');if(!x)return;const a=this.st.accounts[+x.dataset.i];
   if(x.dataset.gc==='go')this.connect(x);if(x.dataset.gc==='re'&&a)this.connect(x,a);if(x.dataset.gc==='rm'&&a)this.remove(a);if(x.dataset.gc==='client')this.setup(true)};
  this.d.querySelector('.gc-foot-l').onclick=e=>{if(e.target.closest('[data-gc="client"]'))this.setup(true)};
  b.querySelector('#gcCopyR')?.addEventListener('click',()=>copyText(this.st.redirect))},
 // each card asks Google whether its sign-in still works
 checkAll(){this.st.accounts.forEach(a=>post(UI,'/ui/google/check',{agent:a.agent,name:a.name}).then(r=>this.stat(a,r),()=>this.stat(a,{ok:null}))) },
 stat(a,r){const c=this.d?.querySelector(`.gc-stat[data-k="${CSS.escape(a.agent+'|'+a.name)}"]`);if(!c)return;c.className='chip gc-stat '+(r.ok?'ok':r.ok===false?'warn':'');c.innerHTML=r.ok?'<i class="dot"></i>Works':r.ok===false?'<i class="dot"></i>Needs reconnect':'<i class="dot"></i>Not checked';if(r.why)c.title=r.why;
  if(r.ok===false){const card=c.closest('.gc-card');card.querySelector('[data-gc="re"]')?.classList.replace('ghost','primary');if(!card.querySelector('.gc-why-l'))card.querySelector('.gc-c-t').insertAdjacentHTML('beforeend',`<small class="gc-why-l">${esc(r.why||'')}</small>`)}},
 async connect(btn,re){const b=this.body(),err=b.querySelector('#gcErr');if(err)err.hidden=true;
  const body=re?{agent:re.agent,name:re.name,reconnect:true}:{agent:b.querySelector('#gcAg').value,name:b.querySelector('#gcName').value,services:[...b.querySelectorAll('.gc-pick input:checked')].map(i=>i.value)};
  if(!re&&!body.services.length){err.textContent='Pick at least one thing it may use.';err.hidden=false;return}
  // the tab opens on the click itself (a tab opened after a wait is blocked as a pop-up)
  const w=window.open('about:blank','_blank');btn.disabled=true;
  try{const r=await post(UI,'/ui/google/connect',body);if(w){w.opener=null;w.location.href=r.url}this.wait(r,body,re,!w)}
  catch(e){w?.close();btn.disabled=false;if(err&&!re){err.textContent=e.message;err.hidden=false}else fail(e)}},
 wait(r,body,re,blocked){const who=ident(body.agent).name;
  this.swap(`<div class="gc-wait"><div class="gc-wait-h"><span class="spinner"></span><div><b>${re?'Reconnecting '+esc(re.email):'Connecting a Google account for '+esc(who)}</b><span class="hint">${blocked?'Open Google to sign in.':'Finish in the Google tab that opened. This updates by itself.'}</span></div></div>
   <a class="gc-again" href="${esc(r.url)}" target="_blank" rel="noopener">${blocked?'Open Google':'Open Google again'}</a>
   ${r.paste?`<div class="gc-paste"><label for="gcAddr">The address Google ended on</label><p class="hint">Your client is a Desktop app, so after you press Allow, Google opens a page that does not load. Copy that page’s whole address from the address bar and paste it here.</p><div class="sc-row"><input id="gcAddr" placeholder="http://localhost/?state=…&code=…" autocomplete="off"><button class="primary small" id="gcFin">Finish</button></div></div>`:''}
   <p class="err-line" id="gcWErr" hidden></p><button class="link-btn gc-back" id="gcBack">Back</button></div>`);
  const b=this.body(),stop=()=>{clearTimeout(this._t);this._t=null};
  b.querySelector('#gcBack').onclick=()=>{stop();this.paint()};
  const done=x=>{stop();toast((x.email||'The account')+' is connected to '+ident(x.agent).name);this.opt.onDone?.(x);this.refresh(x)};
  const bad=m=>{const e=b.querySelector('#gcWErr');if(e){e.textContent=m;e.hidden=false}b.querySelector('.gc-wait-h .spinner')?.remove();if(!r.paste){const h=b.querySelector('.gc-wait-h b');if(h)h.textContent='Not connected';b.querySelector('.gc-wait-h .hint')?.remove();const a=b.querySelector('.gc-again');if(a)a.hidden=true;const k=b.querySelector('#gcBack');if(k)k.textContent='Try again'}};
  b.querySelector('#gcFin')?.addEventListener('click',async ev=>{const v=b.querySelector('#gcAddr').value.trim();if(!v)return bad('Paste the address first.');ev.target.disabled=true;
   try{done(await post(UI,'/ui/google/finish',{address:v}))}catch(e){ev.target.disabled=false;bad(e.message)}});
  const poll=async()=>{if(!this.d?.isConnected)return stop();try{const x=await UI('/ui/google/result?state='+encodeURIComponent(r.state));if(!this.d?.isConnected)return;if(x.ok)return done(x);if(x.ok===false){stop();return bad(x.error)}}catch{}this._t=setTimeout(poll,2000)};
  this._t=setTimeout(poll,2000)},
 async refresh(x){try{this.st=await UI('/ui/google/state')}catch{}if(!this.d?.isConnected)return;this.opt={...this.opt,why:''};this.paint();
  if(route().page?.id==='connections')Cx.refresh?.();if(route().page?.id==='health')reload()},
 async remove(a){const who=ident(a.agent).name;if(!await confirmBox('Remove '+(a.email||'this account')+' from '+who+'?',who+' can no longer use this Google account. Other agents that use the same account keep it. Google is not told; to end it everywhere, remove aqeelOS under myaccount.google.com.','Remove'))return;
  try{await del(UI,'/ui/google/account',{agent:a.agent,name:a.name});toast((a.email||'The account')+' removed from '+who);this.refresh()}catch(e){fail(e)}},
 // once: the plain steps to make the Google client, and the file
 setup(change=false){const s=this.st,f=this.d.querySelector('.gc-foot-l');if(f)f.innerHTML=change?'<button class="link-btn" data-gc="back">Back</button>':'';
  // not an admin (11 Nov 2026): the install's Google client is an admin's one-time setup; say so plainly instead of the Google Cloud steps
  if(s.canSetUp===false){this.swap(`<div class="gc-noset">${icon('clock',18)}<div><b>Google isn’t set up on this aqeelOS yet</b><p class="hint" style="margin:4px 0 0">An admin does this once for everyone (about 5 minutes, free) in Connections › Add › A Google account. After that you connect your own Google account here, and your agent can use it.</p></div></div>`);return}
  if(f&&change)f.querySelector('[data-gc="back"]').onclick=()=>this.paint();
  const L=(u,t)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  this.swap(`<p class="gc-lead">${change?'Replace the Google client with a new file. Accounts connected with the old one keep working until you Reconnect them.':'Google needs to know aqeelOS before an agent can sign in. You do this once; it takes about 5 minutes.'}</p>
   <ol class="gc-steps">
    <li><b>Make a project.</b> Open ${L('https://console.cloud.google.com/projectcreate','Google Cloud')} and make a new project (any name, for example aqeelOS).</li>
    <li><b>Turn on what the agents will use.</b> In the ${L('https://console.cloud.google.com/apis/library','API library')}, enable Gmail API, Google Drive API, Google Calendar API, Google Sheets API, Google Docs API and People API.</li>
    <li><b>Set up the sign-in screen.</b> In ${L('https://console.cloud.google.com/auth/overview','Google Auth Platform')}, give the app a name and your email. Under Audience, pick Internal if your Google account is a company Workspace. Otherwise pick External and press Publish app: without it, Google ends every sign-in after 7 days.</li>
    <li><b>Make the client.</b> Under ${L('https://console.cloud.google.com/auth/clients','Clients')}, press Create client and pick Web application. Under Authorised redirect URIs, add this address:
     <div class="sc-row gc-redir"><input readonly value="${esc(s.redirect)}" aria-label="Redirect address"><button class="ghost small" id="gcCopy">${icon('copy',14)}Copy</button></div></li>
    <li><b>Download its file</b> (the download button next to the new client) and add it here.</li></ol>
   <div class="gc-drop" id="gcDrop" tabindex="0" role="button" aria-label="Add the Google client file">${icon('upload',20)}<span><b>Drop the file here</b> or choose it</span><small class="hint">client_secret_….json</small><input type="file" id="gcFile" accept=".json,application/json" hidden></div>
   <button class="link-btn gc-pastebtn" id="gcPasteT">Paste the file’s text instead</button>
   <div class="gc-pastebox" id="gcPasteBox" hidden><textarea id="gcJson" rows="4" placeholder='{"web":{"client_id":"…"}}' spellcheck="false"></textarea><button class="primary small" id="gcSaveJ">Save</button></div>
   <p class="err-line" id="gcSErr" hidden></p>${change?`<button class="ghost small gc-rmc" id="gcRmC" style="color:var(--bad)">${icon('trash',14)}Remove the client</button>`:''}`);
  const b=this.body(),err=m=>{const e=b.querySelector('#gcSErr');e.textContent=m;e.hidden=false};
  b.querySelector('#gcCopy').onclick=()=>copyText(s.redirect,'Address copied');
  const save=async text=>{b.querySelector('#gcSErr').hidden=true;try{const r=await post(UI,'/ui/google/client',{json:text});this.st={...this.st,...r};toast('Google client saved');this.paint()}catch(e){err(e.message)}};
  const file=b.querySelector('#gcFile'),drop=b.querySelector('#gcDrop'),read=f=>{if(!f)return;if(f.size>65536)return err('That file is too big to be the Google client file.');f.text().then(save)};
  drop.onclick=()=>file.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click()}};file.onchange=()=>read(file.files[0]);
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('on')};drop.ondragleave=()=>drop.classList.remove('on');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('on');read(e.dataTransfer.files[0])};
  b.querySelector('#gcPasteT').onclick=e=>{const box=b.querySelector('#gcPasteBox');box.hidden=!box.hidden;e.target.hidden=true;box.querySelector('textarea').focus()};
  b.querySelector('#gcSaveJ').onclick=()=>save(b.querySelector('#gcJson').value);
  b.querySelector('#gcRmC')?.addEventListener('click',async()=>{if(!await confirmBox('Remove the Google client?','New sign-ins stop until a client is added again. Accounts already connected keep working.','Remove'))return;try{this.st={...this.st,...await del(UI,'/ui/google/client')};this.setup()}catch(e){fail(e)}})}};
// "Connect a Google account" everywhere (Connected apps, All agents, Connections) opens this dialog, never a chat
ACT['gacc-add']=a=>GC.open({agent:a?.dataset?.agent||(typeof viewing==='function'?viewing():'default')});
ACT['gc-open']=a=>GC.open({agent:a?.dataset?.agent,services:a?.dataset?.svc?a.dataset.svc.split(','):undefined,why:a?.dataset?.why||''});

/* ---------- Connections › Add › A login: the owner adds a login an agent uses as them (until 7 Nov 2026 only the agent's
   register_account tool could). Google and app sign-ins point to where they are made; another login is named here. ---------- */
const AccAdd={open(){const ags=Pages._cx?.agents?.length?Pages._cx.agents:[{id:'default',name:ident('default').name}];let kind='google';
 const d=drawer('Add a login',`<p class="hint" style="margin:0 0 12px">A login an agent uses as you. It shows under Connections, where you see what the agent does with it and can pause or disconnect it.</p>
  <div class="seg-mini aa-kind" role="tablist">${[['google','Google account'],['app','App sign-in'],['telegram-user','Personal Telegram'],['other','Other']].map(([k,l])=>`<button type="button" role="tab" data-k="${k}"${k===kind?' class="on" aria-selected="true"':''}>${l}</button>`).join('')}</div>
  <div class="aa-body"></div>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="aaGo" hidden>Add</button>`,{size:'md'});
 const body=d.querySelector('.aa-body'),go=d.querySelector('#aaGo');
 const paint=()=>{go.hidden=kind==='google'||kind==='app';body.classList.remove('gc-in');void body.offsetWidth;body.classList.add('gc-in');
  if(kind==='google'){body.innerHTML=`<p class="aa-say">Google accounts are added with Connect Google. They show under Connections at once, already registered as yours.</p><button class="primary" id="aaG">${logoImg('google.com','G')}Connect Google</button>`;body.querySelector('#aaG').onclick=()=>GC.open({});return}
  if(kind==='app'){body.innerHTML=`<p class="aa-say">Add the app (Slack, Notion and others), then press Sign in on it. Its sign-in shows under Connections by itself.</p><button class="primary" id="aaA">${icon('plug',15)}Add an app</button>`;body.querySelector('#aaA').onclick=()=>Cx.catalog();return}
  const tg=kind==='telegram-user';
  body.innerHTML=`<div class="gc-grid"><div><label for="aaAg">Agent that uses it</label><select id="aaAg">${ags.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
   <div><label for="aaL">Name</label><input id="aaL" maxlength="80" placeholder="${tg?'Telegram, me':'Shopee seller, me'}"></div></div>
   <label for="aaW">Where it is kept on the AI box</label><input id="aaW" placeholder="${tg?'~/.hermes/profiles/sales/telegram.session':'~/workspaces/sales/shopee-login.json'}" autocomplete="off" spellcheck="false">
   <p class="hint">The file that holds the sign-in. The agent that made it can tell you where it is.</p>
   <label>What it may do</label><div class="gc-pick">${[['read','Read'],['draft','Draft'],['send','Send and post']].map(([k,l],i)=>`<label class="gc-opt"><input type="checkbox" value="${k}"${i===0?' checked':''}><span>${l}</span></label>`).join('')}</div>
   <label for="aaN">What it is for <span class="hint">(optional)</span></label><input id="aaN" maxlength="300" placeholder="Orders and chats with buyers">
   <p class="err-line" id="aaErr" hidden></p>`};
 d.querySelector('.aa-kind').onclick=e=>{const b=e.target.closest('[data-k]');if(!b||b.dataset.k===kind)return;kind=b.dataset.k;d.querySelectorAll('.aa-kind button').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-selected',x===b)});paint()};
 go.onclick=async()=>{const v=id=>body.querySelector(id)?.value.trim()||'',err=body.querySelector('#aaErr'),bad=m=>{err.textContent=m;err.hidden=false};err.hidden=true;
  if(!v('#aaL'))return bad('Give it a name, for example “Shopee seller, me”.');if(!v('#aaW'))return bad('Say where the sign-in is kept on the AI box.');
  go.disabled=true;try{await post(UI,'/ui/connected-accounts/add',{agent:v('#aaAg'),kind,label:v('#aaL'),where:v('#aaW'),note:v('#aaN'),can:[...body.querySelectorAll('.gc-pick input:checked')].map(i=>i.value)});
   closeLayers();toast(v('#aaL')+' added');Pages._cxFresh=true;if(route().page?.id==='connections')reload()}catch(e){bad(e.message)}finally{go.disabled=false}};
 paint()}};

/* ---------- Edit an app that is already added (7 Nov 2026): its address, how it signs in and its key, or its command,
   arguments and settings (app/mcp-edit.mjs). A key is never shown; an empty field keeps the saved one. ---------- */
const McpEdit={async open(agent,name){const d=drawer('Edit '+pretty(name),'<div class="me-body">'+skeleton()+'</div>',`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="meGo" disabled>Save</button>`,{size:'md'});
 let m,keys=[];try{[m,keys]=await Promise.all([UI('/ui/mcp/server?agent='+encodeURIComponent(agent)+'&name='+encodeURIComponent(name)),UI('/ui/mcp/keys?agent='+encodeURIComponent(agent)).then(r=>r.keys,()=>[])])}catch(e){if(d.isConnected)d.querySelector('.me-body').innerHTML=errLine(pretty(name)+'’s settings');return}if(!d.isConnected)return;
 const body=d.querySelector('.me-body'),go=d.querySelector('#meGo'),k=keys.find(x=>x.key===m.key);go.disabled=false;
 const keyNote=k&&!k.used?`<div class="me-k">${alertBox(esc(k.text),{act:'',id:'meRmK',label:'Remove key',ic:'trash'})}</div>`:'';
 body.innerHTML=`<p class="hint" style="margin:0 0 4px">On ${esc(ident(agent).name)}. Saving restarts the agents so they use it.</p>`+(m.kind==='url'?`<label for="meUrl">Address</label><input id="meUrl" type="url" value="${esc(m.url)}" spellcheck="false">
  <label for="meAuth">How it signs in</label><select id="meAuth"><option value="none"${m.auth==='none'?' selected':''}>No sign-in</option><option value="header"${m.auth==='header'?' selected':''}>A key</option><option value="oauth"${m.auth==='oauth'?' selected':''}>Sign in with the service</option></select>
  <div id="meTokBox"${m.auth==='header'?'':' hidden'}><label for="meTok">Key</label><input id="meTok" type="password" autocomplete="new-password" placeholder="${m.hasKey?'Saved. Paste a new one to replace it.':'Paste the key'}"><p class="hint">Kept as ${esc(m.key)} in this agent’s settings. It is never shown again.</p></div>
  <p class="hint" id="meOa"${m.auth==='oauth'?'':' hidden'}>After saving, open it under Connections and press Sign in.</p>`
  :`<label for="meCmd">Command</label><input id="meCmd" value="${esc(m.command)}" spellcheck="false"><label for="meArgs">Arguments</label><input id="meArgs" value="${esc(m.args.join(' '))}" spellcheck="false">
  <label for="meEnv">Settings</label><textarea id="meEnv" rows="4" spellcheck="false" placeholder="NAME=value">${esc(m.envSet.map(x=>x+'=').join('\n'))}</textarea><p class="hint">One NAME=value a line. A value left empty keeps what is saved; a line taken out removes it.</p>`)+keyNote+'<p class="err-line" id="meErr" hidden></p>';
 const auth=body.querySelector('#meAuth');if(auth)auth.onchange=()=>{body.querySelector('#meTokBox').hidden=auth.value!=='header';body.querySelector('#meOa').hidden=auth.value!=='oauth'};
 body.querySelector('#meRmK')?.addEventListener('click',async e=>{e.target.closest('button').disabled=true;try{await del(UI,'/ui/mcp/keys',{agent,key:m.key});body.querySelector('.me-k')?.remove();toast(m.key+' removed');Cx.keys?.()}catch(er){e.target.closest('button').disabled=false;fail(er)}});
 go.onclick=async()=>{const v=id=>body.querySelector(id)?.value??'',err=body.querySelector('#meErr');err.hidden=true;const b={agent,name};
  if(m.kind==='url'){b.url=v('#meUrl').trim();b.auth=v('#meAuth');if(v('#meTok').trim())b.token=v('#meTok').trim()}
  else{b.command=v('#meCmd');b.args=v('#meArgs');b.env=Object.fromEntries(v('#meEnv').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const i=l.indexOf('=');return i<0?[l,'']:[l.slice(0,i).trim(),l.slice(i+1).trim()]}))}
  go.disabled=true;try{await put(UI,'/ui/mcp/server',b);closeLayers();toast(pretty(name)+' saved · the agents restart to use it');Cx.refresh?.();Cx.keys?.()}catch(e){err.textContent=e.message;err.hidden=false}finally{go.disabled=false}}}};
ACT['mcp-edit']=a=>{const r=Cx.cur;McpEdit.open(a.dataset.agent||r?.owner||'default',a.dataset.name||r?.id)};

/* Connections: app keys nothing reads, each with what to do (Notion signs in with the account: open it and Sign in) */
Cx.keys=async function(){const el=Pages._cxEl;if(!el?.isConnected||S.me?.admin===false)return;let l;try{l=(await UI('/ui/mcp/keys?all=1')).keys.filter(k=>!k.used)}catch{return}
 let slot=el.querySelector('.cn-keys-slot');if(!slot){slot=document.createElement('div');slot.className='cn-keys-slot';(el.querySelector('.cn-needs-slot')||el.firstElementChild)?.after(slot)}
 slot.innerHTML=l.length?`<div class="card cn-keys"><div class="cn-keys-h">${icon('key',15)}<b>${l.length===1?'1 key nothing uses':l.length+' keys nothing uses'}</b></div>${l.map((k,i)=>{const row=k.server&&Cx.rows().find(r=>r.kind==='mcp'&&r.id===k.server&&(r.owner||'default')===k.agent);
  return `<div class="cn-key" ${st(i)}><div class="txt"><code>${esc(k.key)}</code><span>${esc(k.text)}${Pages._cx?.agents?.length>1?' ('+esc(ident(k.agent).name)+')':''}</span></div><div class="act">${row?`<button class="small${k.why==='oauth'?' primary':''}" data-act="cn-open" data-key="${esc(row.key)}">${k.why==='oauth'?'Open and sign in':'Open '+esc(pretty(k.server))}</button>`:''}<button class="ghost small" data-rmk="${esc(k.key)}" data-ag="${esc(k.agent)}">${icon('trash',14)}Remove key</button></div></div>`}).join('')}</div>`:'';
 slot.onclick=async e=>{const b=e.target.closest('[data-rmk]');if(!b)return;b.disabled=true;try{await del(UI,'/ui/mcp/keys',{agent:b.dataset.ag,key:b.dataset.rmk});toast(b.dataset.rmk+' removed');const x=b.closest('.cn-key');leave(x,200);setTimeout(()=>Cx.keys(),220)}catch(er){b.disabled=false;fail(er)}}};
{const base=PAGES.connections;PAGES.connections=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;Cx.keys()}}
// the side panel of a Google login: what it may use, and Reconnect (the same sign-in again); an app: Edit
{const body=Cx.body.bind(Cx);Cx.body=function(r){let h=body(r);const admin=Pages._cx?.canEdit||!!r.may?.level;   // an agent's owner too, on its own apps (11 Nov 2026)
 if(admin&&r.kind==='mcp'&&r.type==='app'&&!r.own)h=h.replace('<div class="cn-btns">',`<div class="cn-btns"><button class="small" data-act="mcp-edit">${icon('edit',14)}Edit</button>`);
 if(admin&&r.kind==='google')h=h.replace('<div class="cn-btns">',`<div class="cn-btns"><button class="small${r.status==='signin'?' primary':''}" data-act="gc-open" data-agent="${esc(r.owner||'default')}" data-why="${esc('Press Reconnect on '+r.id+' and sign in to it again.')}">${icon('refresh',14)}Reconnect</button>`).replace(/<button class="primary small" data-act="gacc-add">.*?<\/button>/,'');
 return h}}
