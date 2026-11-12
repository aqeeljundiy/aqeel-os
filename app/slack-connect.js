/* ---------- Connect Slack (11 Nov 2026): the official Slack MCP for every agent, with no chat, file or command.
   Slack lets no app register itself, so an admin makes this install's Slack app once: the first button opens Slack
   with the app already filled in (scopes and return address), they install it and paste its Client ID and Secret.
   After that each person presses Connect for their agent and clicks Allow on Slack (app/slack-connect.mjs). Uses the
   same look as Connect Google (gc-* styles). ---------- */
const SlackSetup={
 async open(opt={}){this.opt=opt;const d=drawer('Connect Slack','<div class="gc-body"><div class="skel" style="height:64px;border-radius:var(--r-md)"></div><div class="skel" style="height:64px;border-radius:var(--r-md);margin-top:8px"></div></div>',`<span class="gc-foot-l hint"></span><button class="ghost" data-act="close">Done</button>`,{size:'md'});d.classList.add('gc-dlg');this.d=d;
  try{this.st=await UI('/ui/slack/state')}catch(e){if(d.isConnected)d.querySelector('.gc-body').innerHTML=errLine('the Slack settings');return}if(!d.isConnected)return;this.paint()},
 body(){return this.d?.querySelector('.gc-body')},
 swap(html){const b=this.body();if(!b)return;b.classList.remove('gc-in');b.innerHTML=html;void b.offsetWidth;b.classList.add('gc-in')},
 foot(html){const f=this.d?.querySelector('.gc-foot-l');if(f)f.innerHTML=html;return f},
 paint(){const s=this.st;if(!s.client)return this.setup();
  this.foot(`Slack app: ${esc(s.client.id)}${s.canSetUp?' <button class="link-btn" data-sl="change">Change</button>':''}`).onclick=e=>{if(e.target.closest('[data-sl="change"]'))this.setup(true)};
  const ags=s.agents||[];
  this.swap(`${this.opt.why?`<p class="hint gc-why">${esc(this.opt.why)}</p>`:''}<h3 class="gc-h">Your agents</h3>
   <div class="gc-cards">${ags.length?ags.map((a,i)=>this.card(a,i)).join(''):'<p class="hint" style="margin:0">You have no agent of your own to connect Slack to yet.</p>'}</div>
   <p class="hint" style="margin:12px 0 0">Each agent signs in to Slack as the person who presses Connect, and can then search, read and send in Slack for them.</p>`);
  this.body().onclick=e=>{const b=e.target.closest('[data-sl="go"]');if(b)this.connect(b,ags[+b.dataset.i])}},
 card(a,i){const x=a.slack||{},on=x.has&&x.signedIn;
  const stat=on?'<span class="chip gc-stat ok"><i class="dot"></i>Connected</span>':x.has&&x.own?'<span class="chip gc-stat"><i class="dot"></i>Its own Slack app</span>':'<span class="chip gc-stat warn"><i class="dot"></i>Not connected</span>';
  return `<div class="gc-card" ${st(i)}>${logoImg('slack.com','S')}<div class="gc-c-t"><b>${esc(ident(a.id).name||a.name)}</b><small>${x.has?'Slack MCP · '+esc(x.name):'Slack is added when you connect'}${x.has&&x.own?' · signs in with an app made earlier':''}</small></div>
   <div class="gc-c-r">${stat}<div class="gc-acts"><button class="${on?'ghost':'primary'} small" data-sl="go" data-i="${i}">${icon(on?'refresh':'plug',14)}${on?'Reconnect':'Connect'}</button></div></div></div>`},
 // the tab opens on the click itself (a tab opened after a wait is blocked as a pop-up)
 async connect(btn,a){if(!a)return;const w=window.open('about:blank','_blank');btn.disabled=true;
  try{const r=await post(UI,'/ui/slack/connect',{agent:a.id});if(w){w.opener=null;w.location.href=r.url}this.wait(r,a,!w)}
  catch(e){w?.close();btn.disabled=false;fail(e)}},
 wait(r,a,blocked){const who=ident(a.id).name||a.name;
  this.swap(`<div class="gc-wait"><div class="gc-wait-h"><span class="spinner"></span><div><b>Connecting Slack for ${esc(who)}</b><span class="hint">${blocked?'Open Slack to sign in.':'Press Allow in the Slack tab that opened. This updates by itself.'}</span></div></div>
   <a class="gc-again" href="${esc(r.url)}" target="_blank" rel="noopener">${blocked?'Open Slack':'Open Slack again'}</a>
   <p class="hint" style="margin:0">If Slack says the app needs approval, a Slack workspace admin approves it once under Manage apps.</p>
   <p class="err-line" id="slWErr" hidden></p><button class="link-btn gc-back" id="slBack">Back</button></div>`);
  const b=this.body(),stop=()=>{clearTimeout(this._t);this._t=null};let n=0;
  b.querySelector('#slBack').onclick=()=>{stop();this.refresh()};
  const bad=m=>{stop();const e=b.querySelector('#slWErr');if(e){e.textContent=m;e.hidden=false}b.querySelector('.gc-wait-h .spinner')?.remove();const h=b.querySelector('.gc-wait-h b');if(h)h.textContent='Not connected';b.querySelector('.gc-wait-h .hint')?.remove();const k=b.querySelector('#slBack');if(k)k.textContent='Try again'};
  if(!r.flow)return;
  const poll=async()=>{if(!this.d?.isConnected)return stop();try{const x=await UI('/ui/slack/flow?agent='+encodeURIComponent(a.id)+'&id='+encodeURIComponent(r.flow));if(!this.d?.isConnected)return;
    if(/complete|success|done|approved/.test(x.status||'')){stop();toast('Slack is connected to '+who);this.opt.onDone?.(a);return this.refresh()}
    if(/fail|error|expired|cancel/.test(x.status||''))return bad('Slack did not finish the sign-in'+(x.error?': '+x.error:'')+'. Press Try again.')}catch{}
   if(++n>150)return bad('This sign-in took too long. Press Try again.');this._t=setTimeout(poll,2000)};
  this._t=setTimeout(poll,2000)},
 async refresh(){try{this.st=await UI('/ui/slack/state')}catch{}if(!this.d?.isConnected)return;this.opt={...this.opt,why:''};this.paint();if(route().page?.id==='connections')Cx.refresh?.()},
 // once per install: make the Slack app from the filled-in settings, install it, paste its ID and secret
 setup(change=false){const s=this.st,f=this.foot(change?'<button class="link-btn" data-sl="back">Back</button>':'');
  if(!s.canSetUp){this.swap(`<div class="gc-noset">${icon('clock',18)}<div><b>Slack isn’t set up on this aqeelOS yet</b><p class="hint" style="margin:4px 0 0">An admin does this once for everyone (about 3 minutes, free) in Connections › Add › Slack. After that you connect your own Slack here, and your agent can use it.</p></div></div>`);return}
  if(f&&change)f.querySelector('[data-sl="back"]').onclick=()=>this.paint();
  this.swap(`<p class="gc-lead">${change?'Use another Slack app. Agents already connected keep working until you press Reconnect on them.':'Slack needs an app of your own before an agent can sign in. You do this once for everyone; it takes about 3 minutes and is free.'}</p>
   ${s.https?'':`<div class="gc-alert">${alertBox('Slack only accepts return addresses that start with https://. Set this install’s web address first (System › Install), then come back.',{act:'',label:'',ic:'alert'})}</div>`}
   <ol class="gc-steps">
    <li><b>Make the app.</b> This opens Slack with everything filled in. Pick your workspace, press Next, then Create.
     <div class="sl-go"><button class="primary" id="slCreate">${logoImg('slack.com','S')}Create the Slack app</button><button class="link-btn" id="slMan">Copy the app settings instead</button></div></li>
    <li><b>Install it.</b> On the app’s page, open Install App and press Install to Workspace, then Allow. If your workspace needs approval, a Slack admin approves it.</li>
    <li><b>Copy its keys.</b> Open Basic Information. Under App Credentials, copy the Client ID, then press Show next to Client Secret and copy that.
     <div class="sl-keys"><div><label for="slId">Client ID</label><input id="slId" autocomplete="off" spellcheck="false" placeholder="1234567890123.1234567890123"></div>
     <div><label for="slSec">Client Secret</label><input id="slSec" type="password" autocomplete="new-password" spellcheck="false" placeholder="32 letters and digits"></div></div></li></ol>
   <details class="sl-more"><summary>Made the app by hand?</summary><p class="hint">Add these return addresses under OAuth &amp; Permissions › Redirect URLs, and the ${esc(String(s.scopes))} user scopes from the app settings (Copy the app settings above).</p>${(s.redirects||[]).map(u=>`<div class="sc-row gc-redir"><input readonly value="${esc(u)}" aria-label="Return address"><button class="ghost small" data-copy="${esc(u)}">${icon('copy',14)}Copy</button></div>`).join('')}</details>
   <p class="err-line" id="slErr" hidden></p>
   <div class="gc-go">${change?`<button class="ghost small" id="slRm" style="color:var(--bad);margin-right:auto">${icon('trash',14)}Remove the app</button>`:''}<button class="primary" id="slSave">Save</button></div>`);
  const b=this.body(),err=m=>{const e=b.querySelector('#slErr');e.textContent=m;e.hidden=!m};
  b.querySelector('#slCreate').onclick=()=>window.open(s.createUrl,'_blank','noopener');
  b.querySelector('#slMan').onclick=()=>copyText(s.manifest,'App settings copied. In Slack: Create New App › From a manifest, then paste them.');
  b.querySelectorAll('[data-copy]').forEach(x=>x.onclick=()=>copyText(x.dataset.copy,'Address copied'));
  const save=b.querySelector('#slSave');save.onclick=async()=>{err('');const id=b.querySelector('#slId').value.trim(),sec=b.querySelector('#slSec').value.trim();
   if(!id)return err('Paste the Client ID first.');if(!sec)return err('Paste the Client Secret too.');
   save.disabled=true;save.innerHTML='<span class="spinner tiny"></span>Checking with Slack…';
   try{const r=await post(UI,'/ui/slack/client',{client_id:id,client_secret:sec});this.st={...this.st,...r};toast('Slack app saved');this.paint()}
   catch(e){err(e.message)}finally{if(save.isConnected){save.disabled=false;save.textContent='Save'}}};
  b.querySelector('#slRm')?.addEventListener('click',async()=>{if(!await confirmBox('Remove the Slack app?','New Slack sign-ins stop until an app is added again. Agents already connected keep working.','Remove'))return;try{this.st={...this.st,...await del(UI,'/ui/slack/client')};this.setup()}catch(e){fail(e)}})}};
ACT['slack-open']=a=>SlackSetup.open({why:a?.dataset?.why||''});
// an app sign-in that needs an app of its own: Slack goes to this guided setup instead of the plain Client ID form
{const base=typeof mcpClientDrawer==='function'?mcpClientDrawer:null;if(base)mcpClientDrawer=function(name,reason,agent){if(/slack/i.test(String(name||'')))return SlackSetup.open({why:'Slack needs this install’s Slack app first. After it is saved, press Connect.'});return base(name,reason,agent)}}
