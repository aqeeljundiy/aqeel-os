// Models › Accounts: every account that does the thinking (Claude accounts, ChatGPT and the engine's other subscriptions,
// Google AI Pro, providers with an API key), each on the same card: who it is, one status, its limits, the agents on it
// and one ⋯ menu. Above them the priority list as a live overview, and switching automatically.
const PLUGIN_ID='claude-subscription-directsdk-experimental';
const PROV_DOMAINS={'openai-codex':'chatgpt.com','openai-api':'openai.com',openrouter:'openrouter.ai',gemini:'gemini.google.com',antigravity:'gemini.google.com','google-antigravity':'gemini.google.com',agy:'gemini.google.com',xai:'x.ai','xai-oauth':'x.ai',deepseek:'deepseek.com',copilot:'github.com',huggingface:'huggingface.co','kimi-coding':'moonshot.ai',minimax:'minimax.io',zai:'z.ai'};
const provDomain=(slug,name='')=>PROV_DOMAINS[slug]||(/antigravity|gemini|google/i.test(slug+' '+name)?'gemini.google.com':'');
// the kind decides Reconnect and Remove: claude (its own sign-in), sub (the engine's sign-in, Sign out), google (Antigravity's
// Connect on this page), gemini (the Gemini CLI card), key (a provider with an API key)
const acctKind=(key,oauth)=>{const s=key.slice(2);return key.startsWith('claude:')?'claude':/antigravity|^agy/.test(s)?'google':s==='gemini-subscription'?'gemini':oauth.has(s)?'sub':'key'};
// windows: {label, used, resets, scope}; scope 'account' counts for switching, 'model' (Opus, Sonnet) and 'image' (Pictures) are shown only
function acctSources(d,oauth=new Set()){const L=d.labels||{};
 const claudeModels=(Chat.models||[]).filter(m=>m.provider===PLUGIN_ID).map(m=>m.id);
 const claude=d.accounts.map(a=>{const u=a.usage||{};const ws=[['Session (5 h)',u.session,'account'],['This week',u.week,'account'],['This week, Opus',u.opus,'model'],['This week, Sonnet',u.sonnet,'model']].filter(([,w])=>w).map(([label,w,scope])=>({label,used:w.used,resets:w.resets,scope}));
  return {key:'claude:'+a.id,id:a.id,kind:'claude',name:a.label,sub:accountText({email:a.email})||'Claude',logo:'claude.ai',models:claudeModels,status:a.partial?'checking':a.signedIn?'ok':'out',windows:ws,
   note:a.usage?'':a.usageError||'Its limits show after its first check.'}});
 const prov=(d.providers||[]).map(p=>({key:'p:'+p.slug,kind:acctKind('p:'+p.slug,oauth),name:L['p:'+p.slug]||provLabel(p),sub:p.name,logo:provDomain(p.slug,p.name),models:p.models,status:'ok',
  windows:p.windows.map(w=>({label:w.scope==='image'?'Pictures (separate from chat)':w.label,used:w.used,resets:w.resets,scope:w.scope||'account'})),details:p.details||[]}));
 // a provider that signed out is gone from the engine's list: its card stays, signed out, with Reconnect
 const gone=(d.signedOut||[]).filter(x=>x.key.startsWith('p:')&&!prov.some(p=>p.key===x.key)).map(x=>({key:x.key,kind:acctKind(x.key,oauth),name:L[x.key]||x.name,sub:x.name,logo:provDomain(x.key.slice(2),x.name),models:[],status:'out',windows:[],gone:true}));
 const out=[...claude,...prov,...gone];
 for(const s of out){const a=s.windows.filter(w=>w.scope==='account');s.used=a.length?Math.max(...a.map(w=>w.used)):null;s.ok=s.status!=='out';
  // the two windows the priority list shows: the short one (session, 5 h) and the week
  s.sess=a.find(w=>/session|5\s*h|hour/i.test(w.label))||a.find(w=>!/week/i.test(w.label))||null;s.week=a.find(w=>/week/i.test(w.label)&&w!==s.sess)||null}
 return out}
const acctHint=t=>`<p class="hint acct-none">${esc(t)}</p>`;
// a short time for Recent switches: "Today 4:32 PM", "Yesterday 9:10 AM", older ones by date
const shortWhen=t=>{const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const days=Math.round((new Date(n.toDateString())-new Date(d.toDateString()))/864e5);
 return days===0?'Today '+tm:days===1?'Yesterday '+tm:d.toLocaleDateString([],{day:'numeric',month:'short',...(d.getFullYear()!==n.getFullYear()?{year:'numeric'}:{})})};
const miniBar=(l,w)=>w?`<div class="mbar"><span class="mb-l">${l}</span><span class="mb-t"><i class="${w.used>=90?'bad':w.used>=70?'warn':'ok'}" style="width:${Math.min(100,w.used)}%"></i></span><b>${w.used}%</b>${w.resets?`<small>${esc(when(w.resets))}</small>`:''}</div>`:'';

PAGES.accounts=async(p,el)=>{const gone=pageTok(el);
 setActions(`<button data-act="acct-refresh">${icon('refresh',16)}Refresh</button><button class="primary" data-menu="acct-new">${icon('plus',16)}Add account</button>`);
 const [d,oa]=await Promise.all([UI('/ui/accounts'+(Pages._acctFresh?'?fresh=1':'')),H('/providers/oauth?profile=default').catch(()=>null)]);Pages._acctFresh=false;Pages._acct=d;if(!Chat.models)await Chat.loadModels().catch(()=>{});if(gone())return;
 const oauth=new Set((oa?.providers||[]).map(x=>x.id));
 const src=acctSources(d,oauth);Pages._acctSrc=src;const admin=S.me?.admin!==false;const byKey=Object.fromEntries(src.map(s=>[s.key,s]));
 // Used by: the agents really on it now (their route), not the old per-account choice
 const usedBy=k=>Object.entries(d.route||{}).filter(([,r])=>r.entry===k).map(([n])=>({id:n,name:ident(n).name}));
 const pri=(d.priority||[]).filter(e=>byKey[e.key]);Pages._pri=pri;
 // the 'Team of models' (Mixture of Agents) is not an account of its own: it borrows the others. Say so, and only show it when an agent uses it
 for(const s of src)if(/moa|mixture/i.test(s.key+' '+s.name)){s.isTeam=true;s.name='Team of models';s.sub='Several models answer, one combines them';s.windows=[];s.note='It runs on your other accounts, so it has no limits of its own. Set it up under Models › Team of models.'}
 // Active: the account most agents are on now (a tie goes to the one higher in the list)
 const active=pri.reduce((b,e)=>usedBy(e.key).length>(b?usedBy(b).length:0)?e.key:b,null);
 const state=s=>s.status==='out'?['out','Signed out']:s.status==='checking'?['','Checking…']:usedBy(s.key).length?['on','In use']:['','Standby'];
 const priRow=(e,i)=>{const s=byKey[e.key],u=usedBy(e.key),[sc,sl]=state(s);
  return `<div class="pri-row" draggable="true" data-pri="${i}" ${st(i)}><span class="pri-n">${i+1}</span>${logoImg(s.logo,s.name[0].toUpperCase())}
  <div class="txt"><b>${esc(s.name)}${e.key===active?'<span class="chip ok pri-active" title="Most agents are on this account now">Active</span>':''}</b><span class="pri-st ${sc}"><i class="dot"></i>${sl}</span></div>
  <div class="pri-lim">${s.sess||s.week?miniBar('Session',s.sess)+miniBar('Week',s.week):`<span class="hint">${s.status==='out'?'Reconnect to see its limits':'No limits reported'}</span>`}</div>
  <div class="pri-use">${u.length?Access.who({users:u})+`<span>In use by ${plural(u.length,'agent')}</span>`:'<span>No agent on it</span>'}</div>
  <div class="pri-sel"><select data-pri-model="${i}" style="width:auto" aria-label="Model on ${esc(s.name)}"><option value="">Keep each agent's model</option>${s.models.map(m=>`<option value="${esc(m)}" ${m===e.model?'selected':''}>${esc(modelLabel(m))}</option>`).join('')}</select></div>
  <span class="pri-btns"><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}>${icon('chevU',16)}</button><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="1" aria-label="Move down" ${i<pri.length-1?'':'disabled'}>${icon('chevD',16)}</button><button class="ghost icon-btn" data-act="pri-del" data-i="${i}" aria-label="Remove from priority">${icon('x',16)}</button></span></div>`};
 // one card for every kind: header, one status, limits (or why there are none) in the same spot, Used by, the same ⋯ menu
 const status=s=>s.isTeam?'':s.status==='out'?signChip(admin?`data-act="acct-reconnect" data-key="${esc(s.key)}" data-name="${esc(s.name)}"`:'','','Reconnect'):s.status==='checking'?'<span class="chip"><i class="dot"></i>Checking…</span>':usedBy(s.key).length?chipState(true,'Connected'):chipState(false,'','Standby','');
 const limits=s=>s.status==='out'?acctHint('Reconnect it to use this account and see its limits again.'):s.status==='checking'?acctHint('Still checking this account. Refresh in a moment.'):s.windows.length?`<div class="ubars">${s.windows.map(w=>pctBar(w.label,w)).join('')}</div>`
  :acctHint(s.note||'This provider doesn’t report limits.'+(s.kind==='key'?' It is billed per use.':''));
 const card=(s,i)=>{const u=usedBy(s.key);return `<div class="card tile acct" ${st(i)} style="cursor:default"><div class="tile-top">${logoImg(s.logo,s.name[0].toUpperCase())}<div class="acct-id"><h3>${esc(s.name)}</h3><span class="acct-mail">${esc(s.sub)}</span></div>
  ${admin?`<button class="ghost icon acct-more-btn" data-menu="acct" data-key="${esc(s.key)}" aria-label="More for ${esc(s.name)}">${icon('more',18)}</button>`:''}</div>
  <div class="acct-st">${status(s)}</div>
  <div class="acct-lim">${limits(s)}${(s.details||[]).map(x=>`<p class="hint" style="margin:6px 0 0">${esc(x)}</p>`).join('')}</div>
  <div class="acct-agents"><span class="th">Used by</span>${u.length?Access.who({users:u})+`<span class="acct-names">${esc(u.map(x=>x.name).join(', '))}</span>`:'<span class="hint" style="margin:0">No agent yet</span>'}</div></div>`};
 const left=src.filter(s=>!pri.some(e=>e.key===s.key)&&!(s.isTeam&&!usedBy(s.key).length));
 // signed out: one line each, with the same Reconnect as the card (it goes once the account works again)
 const outs=admin?(d.signedOut||[]):[];
 const ev=(d.events||[]).map(e=>{const to=byKey[e.to]||byKey['claude:'+e.to];return `<div class="sw-row"><span class="sw-t">${esc(shortWhen(e.t))}</span><span class="sw-who">${agentAvatar(e.profile,22,{title:false})}<b>${esc(ident(e.profile).name)}</b>${icon('chevR',14)}<span>${esc(to?.name||e.to)}</span></span>${e.why?`<span class="chip sw-why">${esc(e.why)}</span>`:''}</div>`});
 el.innerHTML=`${outs.map(x=>alertBox(`<b>${esc(byKey[x.key]?.name||x.name)}</b> signed out${x.since?' '+esc(ago(x.since/1000)):''}. Agents that use it can’t answer with it until it is reconnected.`,{act:'acct-reconnect',label:'Reconnect',ic:'plug',cls:'acct-out',attrs:`data-key="${esc(x.key)}" data-name="${esc(byKey[x.key]?.name||x.name)}"`})).join('')}<div class="panel card"><h2>Priority</h2><p class="sub">The order your accounts get used in. When an agent's account passes the limit you set, it moves to the next one with room. Drag to reorder.</p>
  <div class="pri-list">${pri.map(priRow).join('')||'<p class="hint">Nothing here yet. Add your accounts in the order you want them used.</p>'}</div>
  ${left.length?`<button class="ghost" data-menu="pri-add" style="margin-top:10px">${icon('plus',15)}Add to priority</button>`:''}</div>
 <div class="two" style="margin-top:16px"><div class="panel card"><h2>Switch automatically</h2><p class="sub">Checked every 5 minutes. ${pri.length?'Follows the priority list.':'Without a priority list, each agent moves to another account of the same kind with the most room.'}</p>
  <div class="auto-ctl"><div class="auto-on"><span><b>Switch when an account runs low</b><small>${d.auto.on?'On':'Off'}: agents ${d.auto.on?'move':'stay where they are'} when their account is nearly used up</small></span>${toggle(d.auto.on,'Switch automatically','id="acAuto"')}</div>
   <div class="auto-th"><span><b>Switch at</b><small>Session or weekly use</small></span><select id="acTh" aria-label="Switch at" style="width:auto">${[70,80,90,95].map(v=>`<option value="${v}" ${+d.auto.threshold===v?'selected':''}>${v}% used</option>`).join('')}</select></div></div>
  ${ev.length?`<h3 class="sw-h">Recent switches</h3><div class="sw-list">${ev.slice(0,6).join('')}</div>${ev.length>6?`<div class="sw-more"><div class="sw-list">${ev.slice(6).join('')}</div></div><button class="ghost small sw-all" data-act="sw-all" aria-expanded="false">Show all ${ev.length}</button>`:''}`:''}</div>
 <div class="panel card"><h2>Which agent uses what</h2><p class="sub">Takes effect on the agent's next message.</p>${Object.entries(d.route||{}).map(([n,r])=>fieldRow(esc(ident(n).name),esc(modelLabel(r.model)),`<select data-use="${esc(n)}">${src.map(s=>`<option value="${esc(s.key)}" ${s.key===r.entry?'selected':''} ${s.ok?'':'disabled'}>${esc(s.name)}${s.used!=null?' · '+s.used+'% used':''}</option>`).join('')}</select>`)).join('')}</div></div>
 <h2 class="ach-cat">All accounts</h2><div class="grid-cards acct-grid">${src.map(card).join('')}<a class="card tile acct acct-more" href="#/system/keys">${icon('plus',22)}<b>Connect another</b><span>Sign in to ChatGPT, or add an API key for OpenRouter, Gemini and more.</span></a></div>`;
 el.querySelectorAll('[data-pri-model]').forEach(s=>s.onchange=()=>{const l=pri.map(e=>({...e}));l[+s.dataset.priModel].model=s.value;savePri(l)});
 el.querySelectorAll('[data-use]').forEach(s=>s.onchange=async()=>{const e=pri.find(x=>x.key===s.value);try{await UI('/ui/accounts/use',{method:'POST',body:{profile:s.dataset.use,key:s.value,model:e?.model||''}});toast(ident(s.dataset.use).name+' now uses '+byKey[s.value].name);reload()}catch(er){fail(er);reload()}});
 // drag a row onto another to reorder
 let from=null;el.querySelectorAll('.pri-row').forEach(r=>{r.ondragstart=e=>{from=+r.dataset.pri;r.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/pri',r.dataset.pri)};r.ondragend=()=>r.classList.remove('dragging');
  r.ondragover=e=>{if(from==null)return;e.preventDefault();r.classList.add('over')};r.ondragleave=()=>r.classList.remove('over');
  r.ondrop=e=>{e.preventDefault();r.classList.remove('over');const to=+r.dataset.pri;if(from==null||from===to)return;const l=[...pri];l.splice(to,0,l.splice(from,1)[0]);from=null;savePri(l)}});
 const saveAuto=async()=>{const on=$('#acAuto').checked;const sm=el.querySelector('.auto-on small');if(sm)sm.textContent=(on?'On':'Off')+': agents '+(on?'move':'stay where they are')+' when their account is nearly used up';
  try{await UI('/ui/accounts/auto',{method:'PUT',body:{on,threshold:+$('#acTh').value}});toast(on?'Automatic switching on':'Automatic switching off')}catch(e){fail(e)}};
 $('#acAuto').onchange=saveAuto;$('#acTh').onchange=saveAuto;
};
// Recent switches: the rest fold open and shut smoothly
ACT['sw-all']=a=>{const m=a.previousElementSibling,open=!m.classList.contains('open');m.classList.toggle('open',open);a.setAttribute('aria-expanded',open);a.textContent=open?'Show fewer':'Show all '+(a.closest('.panel').querySelectorAll('.sw-row').length)};
async function savePri(list){try{await UI('/ui/accounts/priority',{method:'PUT',body:{priority:list}});reload()}catch(e){fail(e)}}
ACT['pri-move']=a=>{const l=[...Pages._pri],i=+a.dataset.i,j=i+ +a.dataset.dir;[l[i],l[j]]=[l[j],l[i]];savePri(l)};
ACT['pri-del']=a=>{const l=[...Pages._pri];l.splice(+a.dataset.i,1);savePri(l)};
Pages.priAddMenu=el=>{const used=new Set(Pages._pri.map(e=>e.key));menu(el,Pages._acctSrc.filter(s=>!used.has(s.key)).map(s=>({label:s.name,icon:s.key.startsWith('claude:')?'user':'cpu',run:()=>savePri([...Pages._pri,{key:s.key,model:''}])})))};

/* ---------- the ⋯ menu, the same on every account card: Reconnect, Rename, Choose agents…, its place in the priority
   list, and Remove (Sign out for a subscription). What does not apply to an account is shown greyed with why. ---------- */
Pages.acctMenu=el=>{const s=(Pages._acctSrc||[]).find(x=>x.key===el.dataset.key);if(!s)return;const pri=Pages._pri||[],i=pri.findIndex(e=>e.key===s.key);
 const move=dir=>{const l=[...pri];[l[i],l[i+dir]]=[l[i+dir],l[i]];savePri(l)};
 const out=s.kind==='claude'?s.id==='main'?null:'Remove account':s.gone?'Remove':s.kind==='key'?'Remove key':'Sign out';
 menu(el,[{label:'Reconnect',sub:s.kind==='key'?'Paste a new key':'Sign in again as this account',icon:'plug',run:()=>Pages.reconnect(s.key,s.name)},
  {label:'Rename',icon:'edit',run:()=>acctRename(s)},
  {label:'Choose agents…',sub:s.status==='out'?'Reconnect it first':plural((Object.values(Pages._acct?.route||{})).filter(r=>r.entry===s.key).length,'agent')+' on it',icon:'user',run:()=>acctAgents(s)},'-',
  ...(i<0?[{label:'Add to priority',icon:'plus',run:()=>savePri([...pri,{key:s.key,model:''}])}]:[{label:'Move up in priority',icon:'chevU',disabled:i===0,run:()=>move(-1)},{label:'Move down in priority',icon:'chevD',disabled:i>=pri.length-1,run:()=>move(1)}]),'-',
  out?{label:out,icon:out==='Sign out'?'logout':'trash',bad:true,run:()=>acctRemove(s)}:{label:'Remove account',sub:'The main account stays',icon:'trash',disabled:true}])};
async function acctRename(s){const v=await promptBox('Rename account','Name',s.name,'Rename');if(v==null||v.trim()===s.name)return;
 try{if(s.kind==='claude')await UI('/ui/accounts/'+encodeURIComponent(s.id),{method:'PATCH',body:{label:v}});else await put(UI,'/ui/accounts/label',{key:s.key,label:v});toast(s.name+' renamed to '+(v.trim()||s.sub));reload()}catch(e){fail(e)}}
async function acctRemove(s){const slug=s.key.slice(2);
 if(s.kind==='claude'){if(!await confirmBox('Remove '+s.name+'?','It is signed out and removed from the box. Agents must use another account first.','Remove'))return;try{await UI('/ui/accounts/'+encodeURIComponent(s.id),{method:'DELETE'});toast(s.name+' removed');reload()}catch(e){fail(e)}return}
 if(s.gone){if(!await confirmBox('Remove '+s.name+'?','Its card and the signed-out note go. Sign in to it again any time to bring it back.','Remove'))return;try{await post(UI,'/ui/accounts/forget',{key:s.key});toast(s.name+' removed');reload()}catch(e){fail(e)}return}
 if(s.kind==='google')return ACT['agy-out']();if(s.kind==='gemini')return ACT['gem-out']();
 if(s.kind==='sub')return ACT['oauth-out']({dataset:{id:slug,name:s.name}});
 let k='';try{k=await provKeyName(slug)}catch(e){return fail(e)}if(!k){store.set('keysOpen:LLM providers',true);return go('/system/keys')}ACT['key-del']({dataset:{k,agent:'default'}})}
// Choose agents: every agent with a switch, on when it is on this account now. Turning one off moves it to the next account in
// the priority list (or another signed-in one); nothing changes until Apply.
function acctAgents(s){const d=Pages._acct||{},src=Pages._acctSrc||[],route=d.route||{},ag=Object.keys(route),off=s.status==='out';
 const name=k=>src.find(x=>x.key===k)?.name||'another account';
 const spare=src.filter(x=>x.key!==s.key&&x.status==='ok'&&!x.isTeam),next=(d.priority||[]).map(e=>spare.find(x=>x.key===e.key)).find(Boolean)||spare[0];
 const dr=drawer('Agents on '+s.name,`${off?`<p class="hint" style="margin:0 0 12px">${esc(s.name)} is signed out, so no agent can be moved onto it. Reconnect it first.</p>`:`<p class="hint" style="margin:0 0 12px">Takes effect on each agent's next message.${next?' Turning one off moves it to '+esc(next.name)+'.':''}</p>`}
  <div class="ag-pick">${ag.map(n=>{const on=route[n].entry===s.key;return `<div class="ag-row">${agentAvatar(n,30,{title:false})}<span class="t"><b>${esc(ident(n).name)}</b><small>${on?'On this account':'On '+esc(name(route[n].entry))}</small></span>${toggle(on,'Use '+s.name+' for '+ident(n).name,`data-ag="${esc(n)}" ${off||on&&!next?'disabled':''}`)}</div>`}).join('')||'<p class="hint">No agents yet.</p>'}</div>`,
  off?`<button class="ghost" data-act="close">Close</button><button class="primary" id="agRe">${icon('plug',15)}Reconnect</button>`:`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="agGo" disabled>Apply</button>`,{size:'sm'});
 if(off){dr.querySelector('#agRe').onclick=()=>{closeLayers();Pages.reconnect(s.key,s.name)};return}
 const go_=dr.querySelector('#agGo'),sw=[...dr.querySelectorAll('[data-ag]')],changed=()=>sw.filter(x=>x.checked!==(route[x.dataset.ag].entry===s.key));
 dr.addEventListener('change',()=>{go_.disabled=!changed().length});
 go_.onclick=async()=>{go_.disabled=true;const model=k=>(d.priority||[]).find(e=>e.key===k)?.model||'';let n=0;
  for(const x of changed()){const k=x.checked?s.key:next.key;try{await UI('/ui/accounts/use',{method:'POST',body:{profile:x.dataset.ag,key:k,model:model(k)}});n++}catch(e){fail(e)}}
  closeLayers();if(n)toast(plural(n,'agent')+' moved'+(sw.some(x=>x.checked)?'':' off '+s.name));reload()}}

/* ---------- Gemini through your Google AI subscription (Pro / Ultra), via the official Gemini CLI: one Google sign-in,
   then it is a model like any other (Models, the chat model menu, the priority list). ---------- */
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;let g;try{g=await UI('/ui/gemini/status')}catch{return}if(gone())return;if(!g.installed||g.retired)return;
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
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;let g;try{g=await UI('/ui/antigravity/status')}catch{return}if(gone())return;if(!g.installed||g.partial)return;
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
{const base=PAGES.accounts;PAGES.accounts=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if(S.me?.admin===false)return;let r;try{r=await UI('/ui/accounts/old-code')}catch{return}if(gone())return;const l=r.signins||[];if(!l.length||!el.isConnected)return;
 const box=document.createElement('div');box.className='panel card old-code';box.style.marginTop='16px';
 box.innerHTML=`<h2>Old Code sign-ins</h2><p class="sub">Accounts Code signed in to by itself on the AI box. Code now uses the account each agent is on here, so these are no longer needed. Move a Claude one in to keep using it, or remove it.</p>
  ${l.map(x=>`<div class="ca-row">${logoImg(x.provider==='claude'?'claude.ai':'chatgpt.com',x.provider==='claude'?'C':'G')}<div class="ca-t"><b>${esc(x.label)}</b><span>${esc([x.provider==='claude'?'Claude':'Codex (ChatGPT)',x.signedIn?(x.email?accountText({email:x.email}):'Signed in'):'Not signed in',x.active?'Code’s choice right now':''].filter(Boolean).join(' · '))}</span></div>
   <span class="pri-btns">${x.provider==='claude'&&x.signedIn?`<button class="ghost small" data-act="oldcode-import" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Move in</button>`:''}<button class="ghost small" data-act="oldcode-remove" data-p="${esc(x.provider)}" data-id="${esc(x.id)}" data-l="${esc(x.label)}">Remove</button></span></div>`).join('')}`;
 el.append(box)}}
ACT['oldcode-import']=async a=>{if(!await confirmBox('Move '+a.dataset.l+' into aqeelOS?','It becomes one of your Claude accounts here, with its usage on its own card, and you can give it to agents. Code stops using it as its own.','Move in',false))return;
 a.disabled=true;try{const r=await post(UI,'/ui/accounts/old-code/import',{id:a.dataset.id});Pages._acctFresh=true;toast(r.label+' is now one of your accounts');reload()}catch(e){a.disabled=false;fail(e)}};
ACT['oldcode-remove']=async a=>{if(!await confirmBox('Remove '+a.dataset.l+'?','Its sign-in folder is deleted from the AI box. This cannot be undone; you can sign in to that account again here at any time.','Remove'))return;
 a.disabled=true;try{await del(UI,'/ui/accounts/old-code/'+a.dataset.p+'/'+a.dataset.id);toast(a.dataset.l+' removed');reload()}catch(e){a.disabled=false;fail(e)}};
