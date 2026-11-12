/* ---------- Connect a model account (Plan 2, 25 Oct 2026): one way for every provider. Add account opens one dialog:
   pick the provider (every one the engine lists, Claude, Google AI Pro and your own endpoint), then Sign in (where it
   has one) or Use an API key. Every sign-in looks the same: 1 open the page, 2 approve, 3 paste the code (or the code
   to type is shown here, with Copy), one countdown, Try again and Cancel, and closing the dialog any way cancels the
   sign-in on the server too. A key is tested by aqeelOS before it is saved (Works, or the provider's own words) and is
   never shown again. Reconnect is the same dialog for the account that is there, so its name, priority and agents stay.
   No name is asked first: Rename is on the card. ---------- */
const CX_NAMES={'openai-codex':'ChatGPT','openai-api':'OpenAI API',anthropic:'Anthropic API',gemini:'Gemini API',xai:'xAI',deepseek:'DeepSeek',openrouter:'OpenRouter',nous:'Nous Portal','antigravity-subscription':'Google AI Pro',minimax:'MiniMax',huggingface:'Hugging Face',copilot:'GitHub Copilot'};
// the ones most people look for first; the rest follow by name
const CX_FIRST=['claude','openai-codex','antigravity-subscription','anthropic','openai-api','openrouter','xai','deepseek','nous','gemini'];
const cxClean=n=>String(n||'').replace(/\s*\([^)]*\)/g,'').replace(/\s*OAuth\b/gi,'').replace(/\s+(Subscription|Account)$/i,'').trim();
const cxLeft=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const Connect={
 // every provider: {id,name,logo,sub,signin:{kind:'claude'|'engine'|'google'|'external',id,flow,cmd},key:{slug},custom,many}
 async list(){const [oa,env,agy]=await Promise.all([H('/providers/oauth?profile=default').catch(()=>({providers:[]})),H('/env?profile=default').catch(()=>({})),UI('/ui/antigravity/status').catch(()=>null)]);
  const P=new Map(),get=(id,name)=>{if(!P.has(id))P.set(id,{id,name:CX_NAMES[id]||cxClean(name)||id,logo:provDomain(id,name)});return P.get(id)};
  Object.assign(get('claude'),{name:'Claude',logo:'claude.ai',sub:'Your Claude plan (Pro or Max)',signin:{kind:'claude'},many:true});
  // the keys the engine knows, by provider (a Claude plan token is not a key)
  for(const [k,v] of Object.entries(env))if(v.category==='provider'&&v.provider&&/_(API_KEY|TOKEN|KEY)$/.test(k)&&!/^(ANTHROPIC_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|HERMES_)/.test(k))get(v.provider,v.provider_label).key={slug:v.provider};
  // the engine's sign-ins; xAI's and MiniMax's join their key under one name
  for(const o of oa.providers||[]){if(/^(anthropic|claude-code)$/.test(o.id))continue;const base=o.id.replace(/-(oauth|acp)$/,'');const x=get(P.has(base)?base:o.id,o.name);
   x.signin=o.flow==='external'?{kind:'external',id:o.id,cmd:o.cli_command||''}:{kind:'engine',id:o.id,flow:o.flow}}
  if(agy?.installed)Object.assign(get('antigravity-subscription'),{sub:'Gemini and Claude on your Google plan',signin:{kind:'google'}});
  Object.assign(get('custom'),{name:'Your own endpoint',sub:'Any OpenAI-compatible address',key:{slug:'custom'},custom:true,many:true,logo:''});
  const rank=x=>{const i=CX_FIRST.indexOf(x.id);return x.custom?999:i<0?(x.signin?.kind==='external'&&!x.key?500:100):i};
  return [...P.values()].sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name))},
 // the account a way of connecting makes ('p:<slug>'), so the list can say it is there already
 acctKey:(p,way)=>way==='signin'?(p.signin.kind==='google'?'p:antigravity-subscription':p.signin.kind==='engine'?'p:'+p.signin.id:''):p.custom?'':'p:'+p.key.slug,
 have(p,way){const k=Connect.acctKey(p,way);return !!k&&(Pages._acctSrc||[]).some(s=>s.key===k)},
 // one dialog; each step replaces the one before, its height easing from the old to the new (no jump)
 open(title){const d=drawer(title,`<div class="cx-step"><div class="skel" style="height:200px;border-radius:var(--r-md)"></div></div>`,`<button class="ghost" data-act="close">Cancel</button>`,{size:'md'});d.classList.add('cx');
  const obs=new MutationObserver(()=>{if(!d.isConnected){obs.disconnect();d._stop?.();d._stop=null}});obs.observe(document.body,{childList:true});return d},
 view(d,title,body,foot){d._stop?.();d._stop=null;const b=d.querySelector('.drawer-body'),h0=b.offsetHeight;d.querySelector('.drawer-head h2').textContent=title;d.setAttribute('aria-label',title);
  b.innerHTML=`<div class="cx-step">${body}</div>`;let f=d.querySelector('.drawer-foot');if(!f){f=document.createElement('div');f.className='drawer-foot';d.append(f)}f.innerHTML=foot;
  if(!calm()&&h0){const h1=b.offsetHeight;if(Math.abs(h1-h0)>2){b.style.height=h0+'px';b.style.overflow='hidden';b.offsetHeight;b.style.transition='height var(--t-med,.22s) var(--ease,ease)';b.style.height=h1+'px';setTimeout(()=>{b.style.height='';b.style.overflow='';b.style.transition=''},260)}}
  setTimeout(()=>d.querySelector('.drawer-body input:not([type=checkbox])')?.focus(),40)},
 async add(){const d=Connect.open('Add account');let list;try{list=await Connect.list()}catch(e){if(d.isConnected)Connect.view(d,'Add account',alertBox(esc(e.message||'Could not load the providers.'),{act:'acct-new'}),`<button class="ghost" data-act="close">Close</button>`);return}if(d.isConnected)Connect.pick(d,list)},
 pick(d,list){const way=p=>p.sub||(p.signin&&p.key?'Sign in or use an API key':p.signin?(p.signin.kind==='external'?'Signs in through its own app on the AI box':'Sign in with your plan'):'API key');
  const on=p=>!p.many&&((p.signin&&Connect.have(p,'signin'))||(p.key&&Connect.have(p,'key')));
  Connect.view(d,'Add account',`${list.length>10?`<div class="search cx-q">${icon('search',16)}<input id="cxQ" placeholder="Search providers" autocomplete="off" aria-label="Search providers"></div>`:''}
   <div class="cx-list" role="list">${list.map((p,i)=>`<button class="cx-row" role="listitem" data-id="${esc(p.id)}" ${st(i)}>${logoImg(p.logo,p.name[0].toUpperCase())}<span class="txt"><b>${esc(p.name)}${on(p)?' <span class="chip ok">Connected</span>':''}</b><small>${esc(way(p))}</small></span>${icon('chevR',16)}</button>`).join('')}</div>
   <p class="hint cx-one">Claude and your own endpoints can be added more than once. Every other provider holds one account here: the engine keeps one sign-in and one key for each.</p>`,`<button class="ghost" data-act="close">Cancel</button>`);
  const q=d.querySelector('#cxQ');if(q)q.oninput=()=>{const t=q.value.trim().toLowerCase();d.querySelectorAll('.cx-row').forEach(r=>{r.hidden=!!t&&!r.textContent.toLowerCase().includes(t)})};
  d.querySelectorAll('.cx-row').forEach(r=>r.onclick=()=>Connect.choose(d,list.find(x=>x.id===r.dataset.id),()=>Connect.pick(d,list)))},
 // exactly two ways; a provider with one of them goes straight to it
 choose(d,p,back){if(!p)return;if(!(p.signin&&p.key))return p.signin?Connect.signin(d,p,null,back):Connect.key(d,p,null,back);
  const again=w=>Connect.have(p,w)?'<span class="cx-have">Connected already: this replaces it.</span>':'';
  Connect.view(d,'Connect '+p.name,`<div class="cx-ways"><button class="cx-opt" data-way="signin">${icon('user',20)}<b>Sign in</b><small>${p.signin.kind==='external'?'Through its own app on the AI box':'With your '+esc(p.name)+' plan, in your browser'}</small>${again('signin')}</button>
   <button class="cx-opt" data-way="key">${icon('key',20)}<b>Use an API key</b><small>Paste a key from ${esc(p.name)}. aqeelOS tests it first.</small>${again('key')}</button></div>`,
   `<button class="ghost" id="cxBack">Back</button><span style="flex:1"></span><button class="ghost" data-act="close">Cancel</button>`);
  d.querySelector('#cxBack').onclick=back;const me=()=>Connect.choose(d,p,back);d.querySelectorAll('.cx-opt').forEach(b=>b.onclick=()=>b.dataset.way==='signin'?Connect.signin(d,p,null,me):Connect.key(d,p,null,me))},
 backFoot:(back,extra='')=>`${back?'<button class="ghost" id="cxBack">Back</button><span style="flex:1"></span>':''}<button class="ghost" data-act="close">Cancel</button>${extra}`,
 // the three kinds of sign-in, each the same four steps: start, send the code, ask how it is going, cancel
 flows:{
  claude:(p,again)=>{let id=again?.id||'';return {
   start:async()=>{const st=again?await post(UI,'/ui/accounts/'+encodeURIComponent(again.id)+'/reconnect'):await post(UI,'/ui/accounts',{});id=st.id||id;if(!st.url)throw new Error('Claude did not start a sign-in.');return {url:st.url,paste:true,expires:10*60000,every:4000,
    tips:['Use the Claude account you want '+(again?'to reconnect':'to add')+'. If Claude emails you a link, open it in this browser.','Then copy the code Claude shows (its Copy button copies all of it).']}},
   submit:async code=>{const r=await post(UI,'/ui/accounts/'+encodeURIComponent(id)+'/code',{code});return r.state==='done'?{done:true}:r.state==='running'?{pending:r.hint||'Still checking…'}:{error:r.hint||'The sign-in did not finish.'}},
   poll:async()=>{const l=await UI('/ui/accounts/'+encodeURIComponent(id)+'/login');return l.state==='done'?'done':l.state==='running'?'pending':{error:l.hint||'The sign-in did not finish.'}},
   cancel:()=>{if(id)post(UI,'/ui/accounts/'+encodeURIComponent(id)+'/cancel').catch(()=>{})}}},
  engine:p=>{const oid=encodeURIComponent(p.signin.id),P='/providers/oauth/',q='?profile=default';let s=null;return {
   start:async()=>{s=await post(H,P+oid+'/start'+q,{});const pk=s.flow==='pkce';return {url:pk?s.auth_url:s.verification_url,paste:pk,code:pk?'':s.user_code,expires:+s.expires_in>0?s.expires_in*1000:9e5,every:(s.poll_interval||3)*1000,
    tips:['Sign in with the '+p.name+' account you want to use.',pk?'Then copy the code it shows.':'This window finishes by itself once you approve.']}},
   submit:async code=>{const r=await post(H,P+oid+'/submit'+q,{session_id:s.session_id,code});return r.ok===false||r.status==='error'?{error:(r.message||'That code did not work')+'. Paste it again, or press Try again.'}:{done:true}},
   poll:async()=>{const r=await callRaw('/hapi',P+oid+'/poll/'+encodeURIComponent(s.session_id)+q,{keep:true});return r.status==='approved'?'done':r.status==='pending'?'pending':{error:r.error_message||(r.status==='denied'?'The sign-in was refused.':r.status==='expired'?'This code ran out of time.':'The sign-in did not finish.')}},
   cancel:()=>{if(s?.session_id)del(H,P+'sessions/'+encodeURIComponent(s.session_id)+q).catch(()=>{})}}},
  google:()=>({start:async()=>{const r=await post(UI,'/ui/antigravity/start');return r.signedIn?{done:true}:{url:r.url,paste:true,expires:20*60000,
    tips:['Choose the Google account that has Google AI Pro.','Allow access, then copy the code Google shows.']}},
   submit:async code=>{const x=await post(UI,'/ui/antigravity/code',{code});return x.ok?{done:true}:{error:x.error||'Google did not accept that code.'}},
   cancel:()=>post(UI,'/ui/antigravity/cancel').catch(()=>{})})},
 async signin(d,p,again,back){const title=(again?'Reconnect ':'Connect ')+(again?.name||p.name),s=p.signin;
  if(s.kind==='external'){const own=s.cmd&&!/hermes/i.test(s.cmd);return Connect.view(d,title,`<p class="cx-p">${esc(p.name)} signs in through its own app on the AI box, not here.${own?' Run this there once:':' Ask whoever looks after the AI box to sign it in there.'}</p>${own?`<div class="cmd-copy"><code>${esc(s.cmd)}</code><button class="ghost small" data-act="copy-text" data-text="${esc(s.cmd)}">${icon('copy',14)}Copy</button></div>`:''}`,Connect.backFoot(back)),back&&(d.querySelector('#cxBack').onclick=back)}
  const F=Connect.flows[s.kind](p,again);let over=false,timer=null;
  Connect.view(d,title,`<p class="hint cx-wait"><span class="spinner tiny"></span> Getting the sign-in link…</p>`,Connect.backFoot(back));if(back)d.querySelector('#cxBack').onclick=back;
  const stop=()=>{clearInterval(timer);if(!over){over=true;F.cancel()}};d._stop=stop;
  let r;try{r=await F.start()}catch(e){if(!d.isConnected||d._stop!==stop)return;over=true;d._stop=null;return Connect.view(d,title,alertBox(esc(e.message||'The sign-in did not start.'),{id:'cxRetry'}),Connect.backFoot(back)),d.querySelector('#cxRetry').onclick=()=>Connect.signin(d,p,again,back),back&&(d.querySelector('#cxBack').onclick=back)}
  if(!d.isConnected||d._stop!==stop)return F.cancel();
  if(r.done){over=true;return Connect.done(p,again)}
  // this flow's own next step: it must not cancel itself on the way
  const tips=r.tips||[];d._stop=null;
  Connect.view(d,title,`<ol class="cx-steps"><li><b>Open the sign-in page</b><span>${esc(tips[0]||'')}</span><a class="btn cx-open" href="${esc(r.url)}" target="_blank" rel="noopener">${icon('globe',15)}Open the sign-in page</a></li>
   ${r.paste?`<li><b>Approve</b><span>${esc(tips[1]||'')}</span></li><li><b>Paste the code</b><input id="cxCode" autocomplete="off" spellcheck="false" placeholder="Paste the code here" aria-label="The code from the sign-in page"></li>`
   :`<li><b>Enter this code there</b><div class="oauth-code">${esc(r.code)}</div><button class="ghost small" data-act="copy-text" data-text="${esc(r.code)}">${icon('copy',14)}Copy code</button></li><li><b>Approve</b><span>${esc(tips[1]||'')}</span></li>`}</ol>
   ${again?'<p class="hint">Its name, priority and agents stay as they are.</p>':''}<p class="hint cx-st" id="cxSt" role="status" aria-live="polite">${r.paste?'':'Waiting for you to approve…'}</p><p class="hint cx-t" id="cxT"></p><button id="cxRetry" hidden>${icon('refresh',15)}Try again</button>`,
   Connect.backFoot(back,r.paste?'<button class="primary" id="cxGo" disabled>Connect</button>':''));
  d._stop=stop;if(back)d.querySelector('#cxBack').onclick=back;
  const stEl=d.querySelector('#cxSt'),tEl=d.querySelector('#cxT'),retry=d.querySelector('#cxRetry'),goB=d.querySelector('#cxGo'),codeIn=d.querySelector('#cxCode');
  const say=(m,bad)=>{stEl.textContent=m;stEl.classList.toggle('err-line',!!bad)};
  const trouble=m=>{say(m,true);retry.hidden=false};
  retry.onclick=()=>{stop();Connect.signin(d,p,again,back)};
  const until=Date.now()+r.expires;
  timer=setInterval(()=>{if(!d.isConnected||over)return clearInterval(timer);const left=until-Date.now();if(left>0){tEl.textContent='The sign-in works for '+cxLeft(left)+' more';return}
   clearInterval(timer);tEl.textContent='';if(goB)goB.disabled=true;over=true;F.cancel();trouble('This sign-in ran out of time. Press Try again for a new one.')},1000);
  // Nous and Anthropic show as accounts once connected on purpose (accounts.mjs SKIP): say so before the page redraws
  const ok=async()=>{if(over&&!d.isConnected)return;clearInterval(timer);over=true;const k=Connect.acctKey(p,'signin');if(k)await post(UI,'/ui/accounts/allow',{key:k}).catch(()=>{});Connect.done(p,again)};
  // ask how it is going until it is done, refused or out of time; three failed asks in a row say so
  const watch=async()=>{let bad=0;while(d.isConnected&&!over&&Date.now()<until){await sleep(r.every||3000);if(!d.isConnected||over)return;
   try{const x=await F.poll();bad=0;if(x==='done')return ok();if(x!=='pending'){over=true;clearInterval(timer);tEl.textContent='';return trouble(x.error)}}catch(e){if(++bad>=3)trouble('Could not check the sign-in: '+(e.message||'no answer')+'. Still trying.')}}};
  if(!r.paste){watch();return}
  codeIn.oninput=()=>{goB.disabled=over||!codeIn.value.trim()};codeIn.onkeydown=e=>{if(e.key==='Enter'&&!goB.disabled){e.preventDefault();goB.click()}};
  let watching=false;
  goB.onclick=async()=>{const code=codeIn.value.trim();if(!code||over)return;goB.disabled=true;retry.hidden=true;say(s.kind==='google'?'Checking with Google…':'Checking the code…');
   try{const x=await F.submit(code);if(!d.isConnected)return;if(x.done)return ok();if(x.pending){say(x.pending);if(!watching&&F.poll){watching=true;watch()}return}trouble(x.error);goB.disabled=!codeIn.value.trim()}
   catch(e){trouble((e.message||'That code did not work')+'. Paste it again, or press Try again.');goB.disabled=!codeIn.value.trim()}}},
 key(d,p,again,back){const cu=p.custom,title=(again?'Reconnect ':'Connect ')+(again?.name||p.name);
  Connect.view(d,title,`${cu&&!again?`<label for="cxBase">Address</label><input id="cxBase" placeholder="https://api.example.com/v1" autocomplete="off" spellcheck="false" inputmode="url"><label for="cxName">Name</label><input id="cxName" placeholder="My models" maxlength="60" autocomplete="off">`:''}
   <label for="cxKey">API key${cu?' (if it needs one)':''}</label><input id="cxKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${again?'Paste the new key':'Paste the key'}">
   <p class="hint cx-st" id="cxSt" role="status" aria-live="polite">${again?'It replaces the saved key. ':''}aqeelOS tests it before saving. It is never shown again.</p>`,Connect.backFoot(back,'<button class="primary" id="cxGo" disabled>Connect</button>'));
  if(back)d.querySelector('#cxBack').onclick=back;
  const k=d.querySelector('#cxKey'),bs=d.querySelector('#cxBase'),go_=d.querySelector('#cxGo'),stEl=d.querySelector('#cxSt');
  const ready=()=>{go_.disabled=cu?!(again||bs.value.trim()):!k.value.trim()};[k,bs].forEach(i=>{if(!i)return;i.oninput=ready;i.onkeydown=e=>{if(e.key==='Enter'&&!go_.disabled){e.preventDefault();go_.click()}}});
  go_.onclick=async()=>{go_.disabled=true;stEl.classList.remove('err-line','t-ok');stEl.innerHTML='<span class="spinner tiny"></span> Testing it with '+esc(p.name)+'…';
   try{const r=await post(UI,'/ui/connect/key',{provider:cu?'custom':p.key.slug,key:k.value.trim(),base:bs?.value.trim()||'',name:d.querySelector('#cxName')?.value.trim()||'',id:again?.id||''});if(!d.isConnected)return;
    if(!r.ok){stEl.textContent=r.message||'It did not work.';stEl.classList.add('err-line');ready();return}
    if(r.key)await post(UI,'/ui/accounts/allow',{key:r.key}).catch(()=>{});k.value='';stEl.textContent=r.message||'Works';stEl.classList.add('t-ok');setTimeout(()=>Connect.done(p,again,r.state==='credit'?'It works, but it has no credit left':r.state==='untested'?'Saved without a test':''),r.state==='untested'?1800:700)}
   catch(e){stEl.textContent=e.message||'It did not work.';stEl.classList.add('err-line');ready()}}},
 done(p,again,note){if(document.querySelector('.drawer.cx'))closeLayers();toast((again?.name||p.name)+(again?' is connected again':' connected')+(note?'. '+note:''));Pages._acctFresh=true;Chat.loadModels().catch(()=>{});if(typeof Bottlenecks!=='undefined')Bottlenecks.check?.();reload()},
 // Reconnect: the same dialog for that account (key 'claude:<id>' or 'p:<slug>'), straight at its way of connecting
 async reconnect(key,name){const d=Connect.open('Reconnect '+name);
  if(key.startsWith('claude:'))return Connect.signin(d,{id:'claude',name:'Claude',signin:{kind:'claude'}},{id:key.slice(7),name,key});
  let list=[];try{list=await Connect.list()}catch{}if(!d.isConnected)return;
  const p=list.find(x=>x.signin&&Connect.acctKey(x,'signin')===key);if(p)return Connect.signin(d,p,{name,key});
  const q=list.find(x=>x.key&&!x.custom&&'p:'+x.key.slug===key);if(q)return Connect.key(d,q,{name,key});
  const cu=((await UI('/ui/connect/custom').catch(()=>({})))?.endpoints||[]).find(e=>'p:'+e.id===key);if(!d.isConnected)return;
  if(cu)return Connect.key(d,list.find(x=>x.custom)||{id:'custom',name,custom:true,key:{slug:'custom'}},{name,key,id:cu.id});
  Connect.view(d,'Reconnect '+name,alertBox(esc(name)+' is not one aqeelOS can sign in to from here any more. Add it again as a new account; the old one can then be removed.',{act:'acct-new',label:'Add an account',ic:'plus'}),`<button class="ghost" data-act="close">Close</button>`)},
 // a provider's key from System › Keys: the same key step
 async forKey(slug,label,set){const d=Connect.open((set?'Reconnect ':'Connect ')+label);let list=[];try{list=await Connect.list()}catch{}if(!d.isConnected)return;
  const p=list.find(x=>x.key?.slug===slug)||{id:slug,name:label,key:{slug}};Connect.key(d,p,set?{name:p.name,key:'p:'+slug}:null)}};
ACT['acct-new']=()=>Connect.add();
ACT['cx-key']=a=>Connect.forKey(a.dataset.p,a.dataset.l||a.dataset.p,a.dataset.set==='1');
