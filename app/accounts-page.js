// Models › Accounts: every account that does the thinking (Claude accounts plus signed-in providers such as
// ChatGPT or OpenRouter), how much each has left, the priority order they are used in, and which agent uses what.
const PLUGIN_ID='claude-subscription-directsdk-experimental';
const PROV_DOMAINS={'openai-codex':'chatgpt.com','openai-api':'openai.com',openrouter:'openrouter.ai',gemini:'gemini.google.com',antigravity:'gemini.google.com','google-antigravity':'gemini.google.com',agy:'gemini.google.com',xai:'x.ai','xai-oauth':'x.ai',deepseek:'deepseek.com',copilot:'github.com',huggingface:'huggingface.co','kimi-coding':'moonshot.ai',minimax:'minimax.io',zai:'z.ai'};
function acctSources(d){
 const claudeModels=(Chat.models||[]).filter(m=>m.provider===PLUGIN_ID).map(m=>m.id);
 const claude=d.accounts.map(a=>({key:'claude:'+a.id,name:a.label,sub:accountText({email:a.email})||'Claude',logo:'claude.ai',models:claudeModels,ok:a.partial||a.signedIn,details:a.partial?['Still checking this account. Refresh in a moment.']:[],
  used:a.usage?Math.max(a.usage.session?.used||0,a.usage.week?.used||0):null,bars:a.usage?[['Session (5 h)',a.usage.session],['This week',a.usage.week],['This week, Opus',a.usage.opus],['This week, Sonnet',a.usage.sonnet]].filter(([,w])=>w):[],menu:a.id}));
 // the ChatGPT pictures limit is its own quota: said in words, never counted as chat use
 const chatW=p=>p.windows.filter(w=>w.scope!=='model'&&w.scope!=='image');
 const prov=(d.providers||[]).map(p=>({key:'p:'+p.slug,name:provLabel(p),sub:p.name,logo:PROV_DOMAINS[p.slug]||(/antigravity|gemini|google/i.test(p.slug+' '+p.name)?'gemini.google.com':''),models:p.models,ok:true,
  used:chatW(p).length?Math.max(0,...chatW(p).map(w=>w.used)):null,bars:p.windows.filter(w=>w.scope!=='image').map(w=>[w.label,{used:w.used,resets:w.resets}]),
  details:[...p.windows.filter(w=>w.scope==='image').map(w=>'Pictures limit reached '+new Date(w.at).toLocaleString([],{dateStyle:'medium',timeStyle:'short'})+' (separate from chat use)'),...(p.details||[])],menu:S.me?.admin!==false?'p:'+p.slug:''}));
 // a provider that signed out is gone from the engine's list: its card stays, signed out, with Reconnect
 const gone=(d.signedOut||[]).filter(x=>x.key.startsWith('p:')&&!prov.some(p=>p.key===x.key)).map(x=>({key:x.key,name:x.name,sub:'Signed out',logo:PROV_DOMAINS[x.key.slice(2)]||(/antigravity|gemini|google/i.test(x.key+' '+x.name)?'gemini.google.com':''),models:[],ok:false,used:null,bars:[],details:[],menu:S.me?.admin!==false?x.key:''}));
 return [...claude,...prov,...gone]}
const usedChip=u=>u==null?'<span class="chip">No limit info</span>':`<span class="chip ${u>=90?'bad':u>=70?'warn':'ok'}"><i class="dot"></i>${u}% used</span>`;

PAGES.accounts=async(p,el)=>{
 setActions(`<button data-act="acct-refresh">${icon('refresh',16)}Refresh</button><button class="primary" data-menu="acct-new">${icon('plus',16)}Add account</button>`);
 const d=await UI('/ui/accounts'+(Pages._acctFresh?'?fresh=1':''));Pages._acctFresh=false;Pages._acct=d;if(!Chat.models)await Chat.loadModels().catch(()=>{});
 const src=acctSources(d);Pages._acctSrc=src;const admin=S.me?.admin!==false;const byKey=Object.fromEntries(src.map(s=>[s.key,s]));
 const users=k=>Object.entries(d.route||{}).filter(([,r])=>r.entry===k).map(([n])=>ident(n).name);
 const usedBy=k=>Object.entries(d.route||{}).filter(([,r])=>r.entry===k).map(([n])=>({id:n,name:ident(n).name}));   // Used by: the shared component (Access.who)
 const pri=(d.priority||[]).filter(e=>byKey[e.key]);Pages._pri=pri;
 const priRow=(e,i)=>{const s=byKey[e.key];const u=users(e.key);return `<div class="pri-row" draggable="true" data-pri="${i}" ${st(i)}><span class="pri-n">${i+1}</span>
  ${logoImg(s.logo,s.name[0].toUpperCase())}<div class="txt"><b>${esc(s.name)}</b><span>${u.length?'In use by '+esc(u.join(', ')):'Standby'}</span></div>
  <select data-pri-model="${i}" style="width:auto"><option value="">Keep each agent's model</option>${s.models.map(m=>`<option value="${esc(m)}" ${m===e.model?'selected':''}>${esc(modelLabel(m))}</option>`).join('')}</select>
  ${usedChip(s.used)}<span class="pri-btns"><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}>${icon('chevU',16)}</button><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="1" aria-label="Move down" ${i<pri.length-1?'':'disabled'}>${icon('chevD',16)}</button><button class="ghost icon-btn" data-act="pri-del" data-i="${i}" aria-label="Remove">${icon('x',16)}</button></span></div>`};
 const card=(s,i)=>`<div class="card tile acct" ${st(i)} style="cursor:default"><div class="tile-top">${logoImg(s.logo,s.name[0].toUpperCase())}<div style="min-width:0;flex:1"><h3>${esc(s.name)}</h3><span class="acct-mail">${esc(s.sub)}</span></div>${s.isTeam?'':s.ok===false?signChip(admin?`data-act="acct-reconnect" data-key="${esc(s.key)}" data-name="${esc(s.name)}"`:'','',`Reconnect`):usedChip(s.used)}</div>
  ${s.isTeam?'':s.bars.length?`<div class="ubars">${s.bars.map(([l,w])=>pctBar(l,w)).join('')}</div>`:`<p class="hint">${s.ok?(s.key.startsWith('p:')?'This provider does not report limits.'+(/subscription|codex|antigravity/i.test(s.key)?'':' It is billed per use.'):'Usage appears after the first chat.'):'Reconnect it to use this account again.'}</p>`}
  ${(s.details||[]).map(x=>`<p class="hint" style="margin:4px 0">${esc(x)}</p>`).join('')}
  <div class="acct-agents"><span class="th">Used by</span>${usedBy(s.key).length?Access.who({users:usedBy(s.key)})+`<span class="hint" style="margin:0">${esc(users(s.key).join(', '))}</span>`:'<span class="hint" style="margin:0">No agent yet</span>'}</div>
  ${s.menu?`<div class="tile-foot"><span></span><button class="ghost icon" data-menu="acct" data-id="${esc(s.menu)}" data-name="${esc(s.name)}" aria-label="More">${icon('more',18)}</button></div>`:''}</div>`;
 // the 'Team of models' (Mixture of Agents) is not an account of its own: it borrows the others. Say so, and only show it when an agent uses it
 for(const s of src)if(/moa|mixture/i.test(s.key+' '+s.name)){s.isTeam=true;s.name='Team of models';s.sub='Several models answer, one combines them';s.details=['It runs on your other accounts above, so it has no limits of its own. Set it up under Models › Team of models.']}
 const left=src.filter(s=>!pri.some(e=>e.key===s.key)&&!(s.isTeam&&!users(s.key).length));
 // signed out: one line each, with the same Reconnect as the card (it goes once the account works again)
 const outs=admin?(d.signedOut||[]):[];
 el.innerHTML=`${outs.map(x=>alertBox(`<b>${esc(x.name)}</b> signed out${x.since?' '+esc(ago(x.since/1000)):''}. Agents that use it can’t answer with it until it is reconnected.`,{act:'acct-reconnect',label:'Reconnect',ic:'plug',cls:'acct-out',attrs:`data-key="${esc(x.key)}" data-name="${esc(x.name)}"`})).join('')}<div class="panel card"><h2>Priority</h2><p class="sub">The order your accounts get used in. When an agent's account passes the limit you set, it moves to the next one with room. Drag to reorder.</p>
  <div class="pri-list">${pri.map(priRow).join('')||'<p class="hint">Nothing here yet. Add your accounts in the order you want them used.</p>'}</div>
  ${left.length?`<button class="ghost" data-menu="pri-add" style="margin-top:10px">${icon('plus',15)}Add to priority</button>`:''}</div>
 <div class="two" style="margin-top:16px"><div class="panel card"><h2>Switch automatically</h2><p class="sub">Checked every 5 minutes. ${pri.length?'Follows the priority list.':'Without a priority list, each agent moves to another account of the same kind with the most room.'}</p>
  <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:6px 0 14px">Switch when an account runs low ${toggle(d.auto.on,'Switch automatically','id="acAuto"')}</label>
  ${fieldRow('Switch at','Session or weekly use',`<select id="acTh">${[70,80,90,95].map(v=>`<option value="${v}" ${+d.auto.threshold===v?'selected':''}>${v}% used</option>`).join('')}</select>`)}
  ${(d.events||[]).length?`<h3 style="font-size:13.5px;margin:16px 0 6px">Recent switches</h3>${d.events.slice(0,6).map(e=>`<p class="hint" style="margin:2px 0">${esc(new Date(e.t).toLocaleString())} · ${esc(ident(e.profile).name)} → ${esc(byKey[e.to]?.name||byKey['claude:'+e.to]?.name||e.to)} · ${esc(e.why)}</p>`).join('')}`:''}</div>
 <div class="panel card"><h2>Which agent uses what</h2><p class="sub">Takes effect on the agent's next message.</p>${Object.entries(d.route||{}).map(([n,r])=>fieldRow(esc(ident(n).name),esc(modelLabel(r.model)),`<select data-use="${esc(n)}">${src.map(s=>`<option value="${esc(s.key)}" ${s.key===r.entry?'selected':''} ${s.ok?'':'disabled'}>${esc(s.name)}${s.used!=null?' · '+s.used+'% used':''}</option>`).join('')}</select>`)).join('')}</div></div>
 <h2 class="ach-cat">All accounts</h2><div class="grid-cards acct-grid">${src.map(card).join('')}<a class="card tile acct acct-more" href="#/system/keys">${icon('plus',22)}<b>Connect another</b><span>Sign in to ChatGPT, or add an API key for OpenRouter, Gemini and more.</span></a></div>`;
 el.querySelectorAll('[data-pri-model]').forEach(s=>s.onchange=()=>{const l=pri.map(e=>({...e}));l[+s.dataset.priModel].model=s.value;savePri(l)});
 el.querySelectorAll('[data-use]').forEach(s=>s.onchange=async()=>{const e=pri.find(x=>x.key===s.value);try{await UI('/ui/accounts/use',{method:'POST',body:{profile:s.dataset.use,key:s.value,model:e?.model||''}});toast(ident(s.dataset.use).name+' now uses '+byKey[s.value].name);reload()}catch(er){fail(er);reload()}});
 // drag a row onto another to reorder
 let from=null;el.querySelectorAll('.pri-row').forEach(r=>{r.ondragstart=e=>{from=+r.dataset.pri;r.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/pri',r.dataset.pri)};r.ondragend=()=>r.classList.remove('dragging');
  r.ondragover=e=>{if(from==null)return;e.preventDefault();r.classList.add('over')};r.ondragleave=()=>r.classList.remove('over');
  r.ondrop=e=>{e.preventDefault();r.classList.remove('over');const to=+r.dataset.pri;if(from==null||from===to)return;const l=[...pri];l.splice(to,0,l.splice(from,1)[0]);from=null;savePri(l)}});
 const saveAuto=async()=>{try{await UI('/ui/accounts/auto',{method:'PUT',body:{on:$('#acAuto').checked,threshold:+$('#acTh').value}});toast($('#acAuto').checked?'Automatic switching on':'Automatic switching off')}catch(e){fail(e)}};
 $('#acAuto').onchange=saveAuto;$('#acTh').onchange=saveAuto;
};
async function savePri(list){try{await UI('/ui/accounts/priority',{method:'PUT',body:{priority:list}});reload()}catch(e){fail(e)}}
ACT['pri-move']=a=>{const l=[...Pages._pri],i=+a.dataset.i,j=i+ +a.dataset.dir;[l[i],l[j]]=[l[j],l[i]];savePri(l)};
ACT['pri-del']=a=>{const l=[...Pages._pri];l.splice(+a.dataset.i,1);savePri(l)};
Pages.priAddMenu=el=>{const used=new Set(Pages._pri.map(e=>e.key));menu(el,Pages._acctSrc.filter(s=>!used.has(s.key)).map(s=>({label:s.name,icon:s.key.startsWith('claude:')?'user':'cpu',run:()=>savePri([...Pages._pri,{key:s.key,model:''}])})))};

/* ---------- Gemini through your Google AI subscription (Pro / Ultra), via the official Gemini CLI: one Google sign-in,
   then it is a model like any other (Models, the chat model menu, the priority list). ---------- */
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{await base(p,el);let g;try{g=await UI('/ui/gemini/status')}catch{return}if(!g.installed||g.retired)return;
 const admin=S.me?.admin!==false;const box=document.createElement('div');box.className='panel card gem-card';box.style.marginTop='16px';
 box.innerHTML=`<div class="gem-top">${logoImg('gemini.google.com','G')}<div class="txt"><h2 style="margin:0">Gemini with your Google AI plan</h2>
  <p class="sub" style="margin:4px 0 0">${g.signedIn?`Connected${g.account?' as <b>'+esc(accountText({email:g.account}))+'</b>':''}. Gemini models now show up under Models and in the chat's model menu.`:'Use Gemini through your Google AI Pro or Ultra subscription, the same way Claude runs on your Claude plan. Sign in once with the Google account that has the plan.'}</p></div>
  ${admin?(g.signedIn?`<button class="ghost" data-act="gem-out">Sign out</button>`:`<button class="primary" data-act="gem-start">${icon('plug',15)}Connect</button>`):''}</div><div id="gemFlow"></div>`;
 el.append(box)}}
ACT['gem-start']=async a=>{a.disabled=true;const f=$('#gemFlow');f.innerHTML=`<p class="hint" style="margin-top:12px"><span class="spinner"></span> Getting the Google sign-in link…</p>`;
 try{const r=await post(UI,'/ui/gemini/start');if(r.signedIn){toast('Gemini is connected');return reload()}
  f.innerHTML=`<ol class="qr-steps" style="margin-top:14px"><li><a href="${esc(r.url)}" target="_blank" rel="noopener">Open the Google sign-in</a> and choose the account that has Google AI Pro.</li><li>Allow access. Google then shows a code: copy it.</li><li>Paste it here and press <b>Connect</b>.</li></ol>
   <div style="display:flex;gap:8px;margin-top:10px"><input id="gemCode" placeholder="Paste the code from Google" autocomplete="off" style="flex:1"><button class="primary" id="gemGo">Connect</button></div><p class="hint" id="gemMsg"></p>`;
  const go=async()=>{const b=$('#gemGo'),m=$('#gemMsg');b.disabled=true;m.textContent='Checking with Google…';try{const x=await post(UI,'/ui/gemini/code',{code:$('#gemCode').value});
   if(x.ok){S.geminiOn=true;Pages._acctFresh=true;Chat.loadModels().catch(()=>{});toast('Gemini connected'+(x.account?' as '+x.account:''));reload()}else{m.textContent=x.error;b.disabled=false}}catch(e){m.textContent=e.message;b.disabled=false}};
  $('#gemGo').onclick=go;$('#gemCode').onkeydown=e=>{if(e.key==='Enter')go()};$('#gemCode').focus()}catch(e){f.innerHTML=`<p class="err-line" style="margin-top:12px">${esc(e.message)}</p>`;a.disabled=false}};
ACT['gem-out']=async()=>{if(!await confirmBox('Sign Gemini out?','Agents that use a Gemini model switch to their next account in the priority list.','Sign out'))return;try{await post(UI,'/ui/gemini/logout');S.geminiOn=false;Pages._acctFresh=true;Chat.loadModels().catch(()=>{});toast('Gemini signed out');reload()}catch(e){fail(e)}};

/* ---------- Google AI Pro / Ultra through Antigravity (Google's official agy tool, which replaced the Gemini CLI for
   personal plans): Gemini 4, Gemini Flash and Claude 5.5 on your Google plan. One Google sign-in, link and code. ---------- */
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{await base(p,el);let g;try{g=await UI('/ui/antigravity/status')}catch{return}if(!g.installed||g.partial)return;
 const admin=S.me?.admin!==false;const box=document.createElement('div');box.className='panel card gem-card';box.style.marginTop='16px';
 box.innerHTML=`<div class="gem-top">${logoImg('gemini.google.com','G')}<div class="txt"><h2 style="margin:0">Google AI Pro (Antigravity)</h2>
  <p class="sub" style="margin:4px 0 0">${g.signedIn?`Connected${g.account?' as <b>'+esc(accountText({email:g.account}))+'</b>':''}. ${g.models?.length?esc(plural(g.models.length,'model'))+' on your Google plan: '+esc(g.models.slice(0,4).join(', '))+(g.models.length>4?'…':'')+'.':''}`:'Use your Google AI Pro plan for Gemini 4, Gemini Flash and Claude 5.5 through Google’s official Antigravity tool, the same way Claude runs on your Claude plan. Sign in once with the Google account that has the plan.'}</p></div>
  ${admin?(g.signedIn?`<button class="ghost" data-act="agy-out">Sign out</button>`:`<button class="primary" data-act="agy-start">${icon('plug',15)}Connect</button>`):''}</div><div id="agyFlow"></div>`;
 el.append(box)}}
ACT['agy-start']=async a=>{a.disabled=true;const f=$('#agyFlow');f.innerHTML=`<p class="hint" style="margin-top:12px"><span class="spinner"></span> Getting the Google sign-in link…</p>`;
 try{const r=await post(UI,'/ui/antigravity/start');if(r.signedIn){toast('Google AI Pro is connected');return reload()}
  f.innerHTML=`<ol class="qr-steps" style="margin-top:14px"><li><a href="${esc(r.url)}" target="_blank" rel="noopener">Open the Google sign-in</a> and choose the account that has Google AI Pro.</li><li>Allow access. Google then shows a code: copy it.</li><li>Paste it here and press <b>Connect</b> within a minute.</li></ol>
   <div style="display:flex;gap:8px;margin-top:10px"><input id="agyCode" placeholder="Paste the code from Google" autocomplete="off" style="flex:1"><button class="primary" id="agyGo">Connect</button></div><p class="hint" id="agyMsg"></p>`;
  const go=async()=>{const b=$('#agyGo'),m=$('#agyMsg');b.disabled=true;m.textContent='Checking with Google…';try{const x=await post(UI,'/ui/antigravity/code',{code:$('#agyCode').value});
   if(x.ok){Pages._acctFresh=true;Chat.loadModels().catch(()=>{});toast('Google AI Pro connected');reload()}else{m.innerHTML=esc(x.error)+' <button class="ghost small" data-act="agy-start">Get a new link</button>';b.disabled=false;a.disabled=false}}catch(e){m.textContent=e.message;b.disabled=false}};
  $('#agyGo').onclick=go;$('#agyCode').onkeydown=e=>{if(e.key==='Enter')go()};$('#agyCode').focus()}catch(e){f.innerHTML=`<p class="err-line" style="margin-top:12px">${esc(e.message)}</p>`;a.disabled=false}};
ACT['agy-out']=async()=>{if(!await confirmBox('Sign Google AI Pro out?','Agents that use one of its models switch to their next account in the priority list.','Sign out'))return;try{const r=await post(UI,'/ui/antigravity/logout');Pages._acctFresh=true;
 // who moved where, and anyone it could not move (they stay on Google AI Pro and their next message fails)
 const mv=Object.entries(r?.moved||{}),stuck=r?.stuck||[];toast('Signed out'+(mv.length?'. Moved '+mv.map(([a])=>ident(a).name).join(', '):''));
 if(stuck.length)fail(new Error('Could not move '+stuck.map(a=>ident(a).name).join(', ')+'. Pick another model for '+(stuck.length>1?'them':'it')+' under Which agent uses what.'));reload()}catch(e){fail(e)}};

/* ---------- Old Code sign-ins: the accounts aqeelOS Code signed in to by itself on the AI box. Code's runs there use the
   agents' accounts from this page now, so these are only listed: a Claude one can be moved in as an account here (the
   same kind of folder), a Codex one only removed (the engine's ChatGPT sign-in is kept differently). Nothing is removed
   without asking first. ---------- */
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;let r;try{r=await UI('/ui/accounts/old-code')}catch{return}const l=r.signins||[];if(!l.length||!el.isConnected)return;
 const box=document.createElement('div');box.className='panel card old-code';box.style.marginTop='16px';
 box.innerHTML=`<h2>Old Code sign-ins</h2><p class="sub">Accounts Code signed in to by itself on the AI box. Code now uses the account each agent is on here, so these are no longer needed. Move a Claude one in to keep using it, or remove it.</p>
  ${l.map(x=>`<div class="ca-row">${logoImg(x.provider==='claude'?'claude.ai':'chatgpt.com',x.provider==='claude'?'C':'G')}<div class="ca-t"><b>${esc(x.label)}</b><span>${esc([x.provider==='claude'?'Claude':'Codex (ChatGPT)',x.signedIn?(x.email?accountText({email:x.email}):'Signed in'):'Not signed in',x.active?'Code’s choice right now':''].filter(Boolean).join(' · '))}</span></div>
   <span class="pri-btns">${x.provider==='claude'&&x.signedIn?`<button class="ghost small" data-act="oldcode-import" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Move in</button>`:''}<button class="ghost small" data-act="oldcode-remove" data-p="${esc(x.provider)}" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Remove</button></span></div>`).join('')}`;
 el.append(box)}}
ACT['oldcode-import']=async a=>{if(!await confirmBox('Move '+a.dataset.l+' into aqeelOS?','It becomes one of your Claude accounts here, with its usage on its own card, and you can give it to agents. Code stops using it as its own.','Move in',false))return;
 a.disabled=true;try{const r=await post(UI,'/ui/accounts/old-code/import',{id:a.dataset.id});Pages._acctFresh=true;toast(r.label+' is now one of your accounts');reload()}catch(e){a.disabled=false;fail(e)}};
ACT['oldcode-remove']=async a=>{if(!await confirmBox('Remove '+a.dataset.l+'?','Its sign-in folder is deleted from the AI box. This cannot be undone; you can sign in to that account again here at any time.','Remove'))return;
 a.disabled=true;try{await del(UI,'/ui/accounts/old-code/'+a.dataset.p+'/'+a.dataset.id);toast(a.dataset.l+' removed');reload()}catch(e){a.disabled=false;fail(e)}};
