/* ---------- Set up Google, step by step (11 Nov 2026: the owner found Google Cloud too hard by hand). An admin does it
   once for the install: seven steps with a progress line, each with a button that opens the exact Google Cloud page
   (the project ID filled in once it is entered), what to do there in short lines, and this install's own values with
   Copy buttons (home page, domain, return address). The last step takes the JSON file: aqeelOS checks it against this
   install (/ui/google/client/check), saves it, and asks Google whether it takes the client. Where you are and the
   project ID are kept in this browser, so closing it halfway loses nothing. Opened from Connections › Add › A Google
   account while no client is saved, from Health, and from the agents' guidance. The same steps with the reasons
   behind them: docs/google-setup.md. ---------- */
const GSetup={
 KEY:'aq.gsetup',GUIDE:'https://github.com/aqeeljundiy/aqeel-os/blob/main/docs/google-setup.md',
 STEPS:[['project','Project'],['screen','Sign-in screen'],['links','Links'],['publish','Publish'],['client','Client'],['apis','Services'],['file','File']],
 mem(){try{return JSON.parse(localStorage.getItem(this.KEY)||'{}')||{}}catch{return {}}},
 keep(){try{localStorage.setItem(this.KEY,JSON.stringify({i:this.i,project:this.project,seen:[...this.seen]}))}catch{}},
 forget(){try{localStorage.removeItem(this.KEY)}catch{}},
 // a project ID, or the address of any of the project's pages (…?project=aqeelos-482915)
 pid(v){v=String(v||'').trim();const m=/[?&]project=([a-z][a-z0-9-]{4,28}[a-z0-9])\b/.exec(v);if(m)return m[1];return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v)?v:''},
 url(p,api){const q=this.project?(p.includes('?')?'&':'?')+'project='+encodeURIComponent(this.project):'';return 'https://console.cloud.google.com/'+(api?'apis/library/'+api:p)+q},
 async open(opt={}){this.opt=opt;const m=this.mem();this.project=this.pid(m.project);this.seen=new Set(Array.isArray(m.seen)?m.seen:[]);
  this.i=opt.step==='file'?6:Math.min(Math.max(+m.i||0,0),6);if(!this.project&&this.i>0&&opt.step!=='file')this.i=0;
  const d=drawer('Set up Google',`<div class="gs-wrap"><div class="skel" style="height:44px;border-radius:12px"></div><div class="skel" style="height:220px;border-radius:14px;margin-top:14px"></div></div>`,
   `<span class="gs-count hint"></span><div class="gs-nav"><button class="ghost" id="gsBack">Back</button><button class="primary" id="gsNext">Next</button></div>`,{size:'lg'});
  d.classList.add('gs-dlg');this.d=d;
  try{this.st=await UI('/ui/google/state')}catch{if(d.isConnected)d.querySelector('.gs-wrap').innerHTML=errLine('the Google settings');return}if(!d.isConnected)return;
  if(this.st.canSetUp===false){d.querySelector('.gs-wrap').innerHTML=`<div class="gc-noset">${icon('clock',18)}<div><b>An admin sets up Google</b><p class="hint" style="margin:4px 0 0">An admin does this once for everyone. After that you connect your own Google account in Connections › Add › A Google account.</p></div></div>`;d.querySelector('.drawer-foot').innerHTML='<button class="primary" data-act="close">Close</button>';return}
  const s=this.st.site||{};
  d.querySelector('.gs-wrap').innerHTML=`<p class="gs-lead">You do this once for everyone on this aqeelOS. It is free and takes about 10 minutes. Keep this window open next to Google Cloud.</p>
   <ol class="gs-rail" style="--n:${this.STEPS.length}">${this.STEPS.map(([,l],k)=>`<li><button type="button" class="gs-dot" data-go="${k}" aria-label="Step ${k+1}: ${esc(l)}"><span class="gs-num"><span>${k+1}</span>${icon('check',13)}</span><span class="gs-lb">${esc(l)}</span></button></li>`).join('')}<i class="gs-fill" aria-hidden="true"></i></ol>
   ${s.issue?`<div class="gs-issue">${alertBox(esc(s.issue),{act:''})}</div>`:''}<div class="gs-step" aria-live="polite"></div>`;
  d.querySelector('.gs-rail').onclick=e=>{const b=e.target.closest('[data-go]');if(b)this.go(+b.dataset.go)};
  d.querySelector('#gsBack').onclick=()=>this.go(this.i-1);
  d.querySelector('#gsNext').onclick=()=>{if(this.i===0&&!this.saveProject())return;this.go(this.i+1)};
  this.go(this.i,true)},
 saveProject(){const inp=this.d.querySelector('#gsProj'),e=this.d.querySelector('#gsPErr');if(!inp)return true;const v=this.pid(inp.value);
  if(!v){e.textContent=inp.value.trim()?'That does not look like a project ID. It looks like aqeelos-482915: small letters, numbers and dashes.':'Paste the project ID first. You find it on the project’s Dashboard in Google Cloud.';e.hidden=false;inp.focus();return false}
  e.hidden=true;inp.value=v;this.project=v;this.keep();return true},
 go(i,first){if(!this.d?.isConnected||i<0||i>6)return;if(i>0&&!this.project&&!(i===6&&this.st.client)){this.i=0;this.paint(first);const e=this.d.querySelector('#gsPErr');if(e&&!first){e.textContent='Start here: make the project and paste its ID.';e.hidden=false}return}
  this.i=i;this.keep();this.paint(first)},
 paint(first){const d=this.d,i=this.i,n=this.STEPS.length;
  d.querySelectorAll('.gs-dot').forEach((b,k)=>{b.classList.toggle('done',k<i);b.classList.toggle('on',k===i);if(k===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});
  d.querySelector('.gs-rail').style.setProperty('--p',i/(n-1));
  d.querySelector('.gs-count').textContent='Step '+(i+1)+' of '+n;
  d.querySelector('#gsBack').hidden=i===0;d.querySelector('#gsNext').hidden=i===n-1;
  const box=d.querySelector('.gs-step');box.classList.remove('gs-in');box.innerHTML=this['s_'+this.STEPS[i][0]]();void box.offsetWidth;if(!first)box.classList.add('gs-in');
  if(!first)d.querySelector('.drawer-body').scrollTo({top:0,behavior:calm()?'auto':'smooth'});this.wire(box);if(!first)box.querySelector('input:not([readonly]),button.primary:not([disabled])')?.focus({preventScroll:true})},
 // the pieces each step is made of
 btn(page,label='Open this page in Google Cloud'){const need=page!=='projectcreate'&&!this.project;
  return `<div class="gs-go"><button class="primary" data-url="${esc(this.url(page))}"${need?' disabled':''}>${icon('popout',15)}${esc(label)}</button>${need?'<span class="hint">Enter the project ID in step 1 first.</span>':''}</div>`},
 todo(l){return `<ol class="gs-do">${l.map(t=>`<li>${t}</li>`).join('')}</ol>`},
 copy(label,value,hint=''){return `<div class="gs-copy"><span class="gs-cl">${esc(label)}</span><div class="gs-cv"><code>${esc(value||'')}</code><button class="ghost small" data-copy="${esc(value||'')}" aria-label="Copy ${esc(label)}">${icon('copy',14)}Copy</button></div>${hint?`<small class="hint">${esc(hint)}</small>`:''}</div>`},
 head(t,p){return `<h3 class="gs-h">${esc(t)}</h3><p class="gs-p">${esc(p)}</p>`},
 s_project(){return this.head('Make a Google Cloud project','A project holds everything Google needs to know about this aqeelOS. It is free, and no card is needed.')+this.btn('projectcreate','Open Google Cloud to make the project')+
  this.todo(['Project name: aqeelOS. Any name works.','Leave the rest as it is and press Create.','When it is ready, copy its project ID. It shows under the name while you type, and on the project’s Dashboard.'])+
  `<div class="gs-field"><label for="gsProj">Project ID</label><input id="gsProj" value="${esc(this.project||'')}" placeholder="aqeelos-482915" autocomplete="off" spellcheck="false"><small class="hint">Or paste the address of any page of the project. aqeelOS finds the ID in it.</small><p class="err-line" id="gsPErr" hidden></p></div>`},
 s_screen(){const me=S.me?.email||'';return this.head('Set up the sign-in screen','This is what people see when they sign in with Google from aqeelOS.')+this.btn('auth/overview')+
  this.todo(['Press Get started.','App name: aqeelOS. User support email: your email. Press Next.','Audience: External. Press Next.','Contact information: your email. Press Next.','Tick that you agree to the Google API Services User Data Policy, then press Continue and Create.'])+
  `<div class="gs-copies">${this.copy('App name','aqeelOS')}${me?this.copy('Your email',me):''}</div>
  <p class="gs-tip">${icon('help',15)}<span>Is everyone who will use it in your company’s Google Workspace? Then you may pick Internal instead of External, and skip steps 3 and 4.</span></p>`},
 s_links(){const s=this.st.site||{};return this.head('Add your links','Google asks for these before it lets you publish the app in the next step.')+this.btn('auth/branding')+
  this.todo(['Under App domain, fill in the three links below.','Under Authorised domains, press Add domain and paste the domain.','Press Save at the bottom.'])+
  `<div class="gs-copies">${this.copy('Application home page',s.home)}${this.copy('Privacy policy link',s.home,'Your company’s privacy page is better, if it has one on the same domain.')}${this.copy('Terms of service link',s.home)}
  ${s.domain?this.copy('Authorised domain',s.domain,'The main domain of this aqeelOS’s address.'):`<p class="gs-tip">${icon('help',15)}<span>${s.local?'This aqeelOS runs on this computer, so leave Authorised domains empty.':'This aqeelOS has no domain name yet. Google needs one: set the address in System › Settings first.'}</span></p>`}</div>`},
 s_publish(){return this.head('Publish the app','Publishing makes sign-ins last. It takes two clicks.')+this.btn('auth/audience')+
  this.todo(['Under Publishing status, press Publish app.','Press Confirm. The status now says In production.'])+
  `<ul class="gs-facts"><li class="warn">${icon('alert',16)}<span>Never leave it on Testing. Google then ends every sign-in after 7 days, and the agents lose Gmail and Drive without warning.</span></li>
  <li>${icon('shield',16)}<span>The first time someone signs in, Google shows “Google hasn’t verified this app”. Press Advanced, then Go to aqeelOS. This is normal for your own install.</span></li>
  <li>${icon('user',16)}<span>Until Google verifies the app, up to 100 Google accounts can sign in. That is plenty for most teams.</span></li></ul>
  <a class="gs-more" href="${this.GUIDE}" target="_blank" rel="noopener">Why, and how verification works</a>`},
 s_client(){return this.head('Make the sign-in client','The client lets aqeelOS ask Google for a sign-in, and brings people back here afterwards.')+this.btn('auth/clients/create')+
  this.todo(['Application type: Web application.','Name: aqeelOS.','Under Authorised redirect URIs, press Add URI and paste the return address below.','Press Create.','In the window that opens, press Download JSON. Do it now: Google shows the secret only once.'])+
  `<div class="gs-copies">${this.copy('Name','aqeelOS')}${this.copy('Authorised redirect URI',this.st.redirect,'It must match exactly: https, and no slash at the end.')}</div>`},
 s_apis(){return this.head('Turn on the Google services','Each Google service the agents use is turned on once in the project. Open each one and press Enable.')+
  `<div class="gs-apis">${(this.st.apis||[]).map((a,k)=>{const on=this.seen.has(a.api);return `<div class="gs-api${on?' seen':''}" ${st(k)}><span class="gs-api-t"><b>${esc(a.name)}</b><small>For ${esc(a.label)}</small></span>
   <button class="${on?'ghost ':''}small" data-api="${esc(a.api)}" ${this.project?'':'disabled'}>${on?icon('check',14)+'Opened':icon('popout',14)+'Open'}</button></div>`}).join('')}</div>
  <p class="hint gs-api-h">Already on? Google says Manage instead of Enable. Nothing more to do there.</p>`},
 s_file(){const c=this.st.client;return this.head('Add the file','The JSON file you downloaded in step 5. aqeelOS checks it, saves it, and asks Google whether it takes it.')+
  (c?`<p class="gs-tip">${icon('help',15)}<span>${esc('A Google client is already saved'+(c.project?' (project '+c.project+')':'')+'. A new file replaces it.')}</span></p>`:'')+
  `<div class="gs-filebox"><div class="gc-drop" id="gsDrop" tabindex="0" role="button" aria-label="Add the Google client file">${icon('upload',20)}<span><b>Drop the file here</b> or choose it</span><small class="hint">client_secret_….json</small><input type="file" id="gsFile" accept=".json,application/json" hidden></div>
   <button class="link-btn gc-pastebtn" id="gsPasteT">Paste the file’s text instead</button>
   <div class="gc-pastebox" id="gsPasteBox" hidden><textarea id="gsJson" rows="4" placeholder='{"web":{"client_id":"…"}}' spellcheck="false"></textarea><button class="primary small" id="gsSaveJ">Check and save</button></div></div>
  <div class="gs-run" hidden></div>`},
 wire(box){box.onclick=e=>{const u=e.target.closest('[data-url]'),c=e.target.closest('[data-copy]'),a=e.target.closest('[data-api]');
   if(u&&!u.disabled)window.open(u.dataset.url,'_blank','noopener');
   if(c)copyText(c.dataset.copy);
   if(a&&!a.disabled){window.open(this.url('',a.dataset.api),'_blank','noopener');if(!this.seen.has(a.dataset.api)){this.seen.add(a.dataset.api);this.keep();a.className='ghost small';a.innerHTML=icon('check',14)+'Opened';a.closest('.gs-api').classList.add('seen')}}};
  const inp=box.querySelector('#gsProj');if(inp)inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.d.querySelector('#gsNext').click()}};
  if(this.STEPS[this.i][0]!=='file')return;
  const file=box.querySelector('#gsFile'),drop=box.querySelector('#gsDrop'),read=f=>{if(!f)return;if(f.size>65536)return this.run(null,'That file is too big to be the Google client file.');f.text().then(t=>this.run(t))};
  drop.onclick=()=>file.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click()}};file.onchange=()=>{read(file.files[0]);file.value=''};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('on')};drop.ondragleave=()=>drop.classList.remove('on');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('on');read(e.dataTransfer.files[0])};
  box.querySelector('#gsPasteT').onclick=e=>{const b=box.querySelector('#gsPasteBox');b.hidden=false;e.target.hidden=true;b.querySelector('textarea').focus()};
  box.querySelector('#gsSaveJ').onclick=()=>this.run(box.querySelector('#gsJson').value)},
 // the file, checked → saved → tested, one line each
 async run(text,early){const box=this.d?.querySelector('.gs-step');if(!box)return;const runEl=box.querySelector('.gs-run'),fb=box.querySelector('.gs-filebox');
  const L=[['read','Read the file'],['match','Made for this aqeelOS'],['save','Saved'],['google','Google takes it']];
  runEl.hidden=false;fb.hidden=true;runEl.innerHTML=`<ul class="gs-checks">${L.map(([k,l],j)=>`<li data-k="${k}" ${st(j)}><span class="gs-ck"></span><span class="gs-ct">${esc(l)}</span></li>`).join('')}</ul><div class="gs-out"></div>`;
  const set=(k,state,why)=>{const li=runEl.querySelector(`[data-k="${k}"]`);if(!li)return;li.className=state;li.querySelector('.gs-ck').innerHTML=state==='doing'?'<span class="spinner tiny"></span>':state==='ok'?icon('check',13):state==='bad'?icon('x',13):state==='warn'?icon('alert',13):'';
   li.querySelector('small')?.remove();if(why)li.querySelector('.gs-ct').insertAdjacentHTML('beforeend',`<small>${esc(why)}</small>`)};
  const out=runEl.querySelector('.gs-out'),again=m=>{out.innerHTML=`<div class="gs-again"><button class="primary" id="gsRe">${icon('upload',15)}Choose another file</button></div>`;out.querySelector('#gsRe').onclick=()=>{runEl.hidden=true;fb.hidden=false;box.querySelector('#gsDrop')?.focus()};if(m)out.querySelector('#gsRe').focus()};
  if(early){set('read','bad',early);return again(true)}
  set('read','doing');let r;
  try{r=await post(UI,'/ui/google/client/check',{json:text,project:this.project||''})}
  catch(e){const fileErr=/not the JSON file|no client ID|service account|does not look like/.test(e.message);if(fileErr)set('read','bad',e.message);else{set('read','ok');set('match','bad',e.message)}return again(true)}
  set('read','ok');set('match','ok');set('save','doing');
  try{const s=await post(UI,'/ui/google/client',{json:text});this.st={...this.st,...s};set('save','ok')}catch(e){set('save','bad',e.message);return again(true)}
  this.opt.onSaved?.();this.test(set,out)},
 async test(set,out){set('google','doing');out.innerHTML='';let g;try{g=(await post(UI,'/ui/google/client/check',{test:true})).google}catch(e){g={ok:null,why:e.message}}
  if(!this.d?.isConnected)return;
  if(g.ok===false){set('google','warn',g.why);out.innerHTML=`<div class="gs-again"><button class="primary" id="gsTest">${icon('refresh',15)}Test again</button><span class="hint">The file is saved. Fix it in Google Cloud, then test again.</span></div>`;out.querySelector('#gsTest').onclick=()=>this.test(set,out);return}
  set('google',g.ok?'ok':'warn',g.ok?'':g.why);this.forget();this.done()},
 done(){const d=this.d;if(!d?.isConnected)return;d.querySelectorAll('.gs-dot').forEach(b=>{b.classList.add('done');b.classList.remove('on');b.removeAttribute('aria-current')});d.querySelector('.gs-rail').style.setProperty('--p',1);
  d.querySelector('.gs-count').textContent='All done';
  d.querySelector('.gs-step .gs-out').innerHTML=`<div class="gs-done">${icon('check',22)}<div><b>Done. People can now connect Google from their agent.</b><span>Each person signs in with their own Google account, in Connections › Add › A Google account.</span></div></div>`;
  d.querySelector('.gs-nav').innerHTML=`<button class="ghost" data-act="close">Close</button><button class="primary" id="gsConn">${logoImg('google.com','G')}Connect a Google account</button>`;
  d.querySelector('#gsConn').onclick=()=>GC.open(this.opt.then||{});d.querySelector('#gsConn').focus();
  if(route().page?.id==='connections')Cx.refresh?.();
  // Health's "Google isn't set up" card goes away
  document.querySelector('.gs-health')?.remove()}};
ACT['gs-open']=a=>GSetup.open({step:a?.dataset?.step});

// System › Health (admins): while no Google client is saved, a card says so with the setup button. It goes on top of
// Now as soon as the page starts, and is looked for again once it is drawn (with the engine down there is no Now part)
{const base=PAGES.health;PAGES.health=async(p,el,r)=>{const gone=pageTok(el),run=base(p,el,r);GSetup.health(el,gone);try{return await run}finally{GSetup.health(el,gone)}}}
GSetup.health=async function(el,gone=()=>false){if(S.me?.admin===false)return;let s;try{s=await UI('/ui/google/state')}catch{return}
 const now=el.querySelector('#hNow')||el;if(gone()||!now.isConnected||s.client||s.canSetUp===false||el.querySelector('.gs-health'))return;
 const at=now===el&&el.querySelector('#engNote');at?at.insertAdjacentHTML('afterend',x()):now.insertAdjacentHTML('afterbegin',x());
 function x(){return`<div class="bk-connect gs-health">${logoImg('google.com','G')}<div class="txt"><b>Google isn’t set up yet</b><span>Agents can’t use Gmail, Drive, Sheets, Docs or Calendar until an admin sets it up once. It takes about 10 minutes and is free.</span></div><button class="primary small" data-act="gs-open">Set up Google</button></div>`}};
