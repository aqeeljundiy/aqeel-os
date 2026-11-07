// Models › Accounts: every account that does the thinking (Claude accounts, ChatGPT and the engine's other subscriptions,
// Google AI Pro, providers with an API key), each on the same card: who it is, one status, its limits, the agents on it
// and one ⋯ menu. Above them the priority list as a live overview, and switching automatically.
const PLUGIN_ID='claude-subscription-directsdk-experimental';
const PROV_DOMAINS={anthropic:'anthropic.com',nous:'nousresearch.com','openai-codex':'chatgpt.com','openai-api':'openai.com',openrouter:'openrouter.ai',gemini:'gemini.google.com',antigravity:'gemini.google.com','google-antigravity':'gemini.google.com',agy:'gemini.google.com',xai:'x.ai','xai-oauth':'x.ai',deepseek:'deepseek.com',copilot:'github.com',huggingface:'huggingface.co','kimi-coding':'moonshot.ai',minimax:'minimax.io',zai:'z.ai'};
const provDomain=(slug,name='')=>PROV_DOMAINS[slug]||(/antigravity|gemini|google/i.test(slug+' '+name)?'gemini.google.com':'');
// the kind decides how Remove works (Reconnect is the Connect dialog for every kind): claude (its own sign-in), sub (the
// engine's sign-in), google (Antigravity), key (a provider with an API key, or your own endpoint)
const acctKind=(key,oauth)=>{const s=key.slice(2);return key.startsWith('claude:')?'claude':/antigravity|^agy/.test(s)?'google':oauth.has(s)?'sub':'key'};
// one status, said the same way on every card, the priority list, the banner and Bottlenecks (25 Oct)
const ACCT_WORD={ok:'Connected',out:'Needs sign-in',rejected:'Key rejected',credit:'Out of credit',checking:'Checking…'};
// windows: {label, used, resets, scope}; scope 'account' counts for switching, 'model' (Opus, Sonnet) and 'image' (Pictures) are shown only
function acctSources(d,oauth=new Set()){const L=d.labels||{};
 const claudeModels=(Chat.models||[]).filter(m=>m.provider===PLUGIN_ID).map(m=>m.id);
 const claude=d.accounts.map(a=>{const u=a.usage||{};const ws=[['Session (5 h)',u.session,'account'],['This week',u.week,'account'],['This week, Opus',u.opus,'model'],['This week, Sonnet',u.sonnet,'model']].filter(([,w])=>w).map(([label,w,scope])=>({label,used:w.used,resets:w.resets,scope}));
  return {key:'claude:'+a.id,id:a.id,kind:'claude',name:a.label,sub:accountText({email:a.email})||'Claude',logo:'claude.ai',models:claudeModels,status:a.partial?'checking':a.signedIn?'ok':'out',windows:ws,
   note:a.usage?(a.usageAt&&Date.now()-a.usageAt>10*60e3?'Last checked '+new Date(a.usageAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''):a.usageError||'Its limits show after its first check.'}});
 // a key's last test (every 5 minutes on the server): refused, or no credit left
 const kc=d.keys||{};const prov=(d.providers||[]).map(p=>({key:'p:'+p.slug,kind:acctKind('p:'+p.slug,oauth),name:L['p:'+p.slug]||provLabel(p),sub:p.name,logo:provDomain(p.slug,p.name),models:p.models,status:/^(rejected|credit)$/.test(kc['p:'+p.slug]?.state)?kc['p:'+p.slug].state:'ok',keyNote:kc['p:'+p.slug]?.message||'',
  windows:p.windows.map(w=>({label:w.scope==='image'?'Pictures (separate from chat)':w.label,used:w.used,resets:w.resets,scope:w.scope||'account'})),details:p.details||[]}));
 // a provider that signed out is gone from the engine's list: its card stays, signed out, with Reconnect
 const gone=(d.signedOut||[]).filter(x=>x.key.startsWith('p:')&&!prov.some(p=>p.key===x.key)).map(x=>({key:x.key,kind:acctKind(x.key,oauth),name:L[x.key]||x.name,sub:x.name,logo:provDomain(x.key.slice(2),x.name),models:[],status:'out',windows:[],gone:true}));
 const out=[...claude,...prov,...gone];
 for(const s of out){const a=s.windows.filter(w=>w.scope==='account');s.used=a.length?Math.max(...a.map(w=>w.used)):null;s.ok=s.status==='ok'||s.status==='checking';
  // the two windows the priority list shows: the short one (session, 5 h) and the week
  s.sess=a.find(w=>/session|5\s*h|hour/i.test(w.label))||a.find(w=>!/week/i.test(w.label))||null;s.week=a.find(w=>/week/i.test(w.label)&&w!==s.sess)||null}
 return out}
const acctHint=t=>`<p class="hint acct-none">${esc(t)}</p>`;
// a short time for Recent switches: "Today 4:32 PM", "Yesterday 9:10 AM", older ones by date
const shortWhen=t=>{const d=new Date(t),n=new Date(),tm=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const days=Math.round((new Date(n.toDateString())-new Date(d.toDateString()))/864e5);
 return days===0?'Today '+tm:days===1?'Yesterday '+tm:d.toLocaleDateString([],{day:'numeric',month:'short',...(d.getFullYear()!==n.getFullYear()?{year:'numeric'}:{})})};
const miniBar=(l,w)=>w?`<div class="mbar"><span class="mb-l">${l}</span><span class="mb-t"><i class="${w.used>=90?'bad':w.used>=70?'warn':'ok'}" style="width:${Math.min(100,w.used)}%"></i></span><b>${w.used}%</b>${w.resets?`<small>${esc(when(w.resets))}</small>`:''}</div>`:'';

PAGES.accounts=async(p,el)=>{const gone=pageTok(el);
 setActions(`<button data-act="acct-refresh">${icon('refresh',16)}Refresh</button>${S.me?.admin!==false?`<button class="primary" data-act="acct-new">${icon('plus',16)}Add account</button>`:''}`);
 const [d,oa]=await Promise.all([UI('/ui/accounts'+(Pages._acctFresh?'?fresh=1':'')),H('/providers/oauth?profile=default').catch(()=>null)]);Pages._acctFresh=false;Pages._acct=d;if(d.allow)S.acctAllow=d.allow;if(!Chat.models)await Chat.loadModels().catch(()=>{});if(gone())return;
 const oauth=new Set((oa?.providers||[]).map(x=>x.id));
 const src=acctSources(d,oauth);Pages._acctSrc=src;Pages._acctD=d;const admin=S.me?.admin!==false;const byKey=Object.fromEntries(src.map(s=>[s.key,s]));
 // Used by: the agents really on it now (their route), not the old per-account choice
 const usedBy=k=>Object.entries(d.route||{}).filter(([,r])=>r.entry===k).map(([n])=>({id:n,name:ident(n).name}));
 const pri=(d.priority||[]).filter(e=>byKey[e.key]);Pages._pri=pri;
 // the 'Team of models' (Mixture of Agents) is not an account of its own: it borrows the others. Say so, and only show it when an agent uses it
 for(const s of src)if(/moa|mixture/i.test(s.key+' '+s.name)){s.isTeam=true;s.name='Team of models';s.sub='Several models answer, one combines them';s.windows=[];s.note='It runs on your other accounts, so it has no limits of its own. Set it up under Models › Team of models.'}
 // Active: the account most agents are on now (a tie goes to the one higher in the list)
 const active=pri.reduce((b,e)=>usedBy(e.key).length>(b?usedBy(b).length:0)?e.key:b,null);
 const state=s=>s.status==='checking'?['',ACCT_WORD.checking]:s.status==='ok'?['on',ACCT_WORD.ok]:['out',ACCT_WORD[s.status]];
 const priRow=(e,i)=>{const s=byKey[e.key],u=usedBy(e.key),[sc,sl]=state(s);
  return `<div class="pri-row" draggable="true" data-pri="${i}" ${st(i)}><span class="pri-n">${i+1}</span>${logoImg(s.logo,s.name[0].toUpperCase())}
  <div class="txt"><b>${esc(s.name)}${e.key===active?'<span class="chip ok pri-active" title="Most agents are on this account now">Active</span>':''}</b><span class="pri-st ${sc}"><i class="dot"></i>${sl}</span></div>
  <div class="pri-lim">${s.sess||s.week?miniBar('Session',s.sess)+miniBar('Week',s.week):`<span class="hint">${s.ok?'No limits reported':'Reconnect it to use it again'}</span>`}</div>
  <div class="pri-use">${u.length?Access.who({users:u})+`<span>In use by ${plural(u.length,'agent')}</span>`:'<span>No agent on it</span>'}</div>
  <div class="pri-sel"><select data-pri-model="${i}" style="width:auto" aria-label="Model on ${esc(s.name)}"><option value="">Keep each agent's model</option>${s.models.map(m=>`<option value="${esc(m)}" ${m===e.model?'selected':''}>${esc(modelLabel(m))}</option>`).join('')}</select></div>
  <span class="pri-btns"><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="-1" aria-label="Move up" ${i?'':'disabled'}>${icon('chevU',16)}</button><button class="ghost icon-btn" data-act="pri-move" data-i="${i}" data-dir="1" aria-label="Move down" ${i<pri.length-1?'':'disabled'}>${icon('chevD',16)}</button><button class="ghost icon-btn" data-act="pri-del" data-i="${i}" aria-label="Remove from priority">${icon('x',16)}</button></span></div>`};
 // one card for every kind: header, one status, limits (or why there are none) in the same spot, Used by, the same ⋯ menu
 const status=s=>s.isTeam?'':s.status==='checking'?`<span class="chip"><i class="dot"></i>${ACCT_WORD.checking}</span>`:s.status==='ok'?chipState(true,ACCT_WORD.ok)
  :`<span class="chip ${s.status==='out'?'warn':'bad'}"><i class="dot"></i>${ACCT_WORD[s.status]}</span>${admin?`<button class="link sign-go" data-act="acct-reconnect" data-key="${esc(s.key)}" data-name="${esc(s.name)}">Reconnect</button>`:''}`;
 // a member can't reconnect: they are told what happens instead (1 Nov 2026)
 const limits=s=>s.status==='out'?acctHint(admin?'Reconnect it to use this account and see its limits again.':'It needs signing in again by an admin. Until then your agents use their next account.'):s.status==='rejected'||s.status==='credit'?acctHint((s.keyNote?s.keyNote+'. ':'')+(admin?'Reconnect it with a new key.':'An admin needs to add a new key. Until then your agents use their next account.')):s.status==='checking'?acctHint('Still checking this account. Refresh in a moment.'):s.windows.length?`<div class="ubars">${s.windows.map(w=>pctBar(w.label,w)).join('')}</div>`
  :acctHint(s.note||'This provider doesn’t report limits.'+(s.kind==='key'?' It is billed per use.':''));
 const card=(s,i)=>{const u=usedBy(s.key);return `<div class="card tile acct" ${st(i)} style="cursor:default"><div class="tile-top">${logoImg(s.logo,s.name[0].toUpperCase())}<div class="acct-id"><h3>${esc(s.name)}</h3><span class="acct-mail">${esc(s.sub)}</span></div>
  ${admin?`<button class="ghost icon acct-more-btn" data-menu="acct" data-key="${esc(s.key)}" aria-label="More for ${esc(s.name)}">${icon('more',18)}</button>`:''}</div>
  <div class="acct-st">${status(s)}</div>
  <div class="acct-lim">${limits(s)}${(s.details||[]).map(x=>`<p class="hint" style="margin:6px 0 0">${esc(x)}</p>`).join('')}</div>
  <div class="acct-agents"><span class="th">Used by</span>${u.length?Access.who({users:u})+`<span class="acct-names">${esc(u.map(x=>x.name).join(', '))}</span>`:'<span class="hint" style="margin:0">No agent yet</span>'}</div></div>`};
 // an account can be in the list again with another model (more than one entry per account, 6 Nov 2026)
 const left=src.filter(s=>!(s.isTeam&&!usedBy(s.key).length)&&(!pri.some(e=>e.key===s.key)||(s.models||[]).some(m=>!pri.some(e=>e.key===s.key&&e.model===m))));
 // needs sign-in, key rejected or out of credit: one line each, with the same Reconnect as the card (it goes once it works again)
 const outs=admin?(d.signedOut||[]):[];
 const ev=(d.events||[]).map(e=>{const to=byKey[e.to]||byKey['claude:'+e.to];return `<div class="sw-row"><span class="sw-t">${esc(shortWhen(e.t))}</span><span class="sw-who">${agentAvatar(e.profile,22,{title:false})}<b>${esc(ident(e.profile).name)}</b>${icon('chevR',14)}<span>${esc(to?.name||e.to)}</span></span>${e.why?`<span class="chip sw-why">${esc(e.why)}</span>`:''}</div>`});
 el.innerHTML=`${outs.map(x=>alertBox(`<b>${esc(byKey[x.key]?.name||x.name)}</b>: ${esc(ACCT_WORD[x.state]||ACCT_WORD.out)}${x.since?', '+esc(ago(x.since/1000)):''}. Agents that use it can’t answer with it until it is reconnected.`,{act:'acct-reconnect',label:'Reconnect',ic:'plug',cls:'acct-out',attrs:`data-key="${esc(x.key)}" data-name="${esc(byKey[x.key]?.name||x.name)}"`})).join('')}<div class="panel card"><h2>Priority</h2><p class="sub">The order your accounts get used in. When an agent's account passes the limit you set, it moves to the next one with room. Drag to reorder.</p>
  <div class="pri-list">${pri.map(priRow).join('')||'<p class="hint">Nothing here yet. Add your accounts in the order you want them used.</p>'}</div>
  ${left.length?`<button class="ghost" data-menu="pri-add" style="margin-top:10px">${icon('plus',15)}Add to priority</button>`:''}</div>
 <div class="two" style="margin-top:16px"><div class="panel card if-fails"><h2>If an account fails</h2><p class="sub">What aqeelOS does by itself so your agents keep answering.</p>
  <h3 class="if-h">${icon('gauge',15)}An account runs low</h3><p class="hint if-p">Checked every 5 minutes. ${pri.length?'An agent moves to the next account in the priority list that has room.':'Without a priority list, each agent moves to another account of the same kind with the most room.'}</p>
  <div class="auto-ctl"><div class="auto-on"><span><b>Switch when an account runs low</b><small>${d.auto.on?'On':'Off'}: agents ${d.auto.on?'move':'stay where they are'} when their account is nearly used up</small></span>${toggle(d.auto.on,'Switch automatically','id="acAuto"')}</div>
   <div class="auto-th"><span><b>Switch at</b><small>Session or weekly use</small></span><select id="acTh" aria-label="Switch at" style="width:auto">${[70,80,90,95].map(v=>`<option value="${v}" ${+d.auto.threshold===v?'selected':''}>${v}% used</option>`).join('')}</select></div>
   <div class="auto-on"><span><b>Go back up the list</b><small>An agent that was moved returns to a higher entry once it has room again, also when switching is off</small></span>${toggle(d.auto.backHome!==false,'Go back up the list','id="acBack"')}</div>
   <div class="auto-th"><span><b>Go back when it has</b><small>Free on the higher entry, checked twice in a row</small></span><select id="acFree" aria-label="Go back when it has" style="width:auto">${[10,20,30,50].map(v=>`<option value="${v}" ${(+d.auto.backFree||20)===v?'selected':''}>${v}% free</option>`).join('')}</select></div></div>
  ${ev.length?`<h3 class="sw-h">Recent switches</h3><div class="sw-list">${ev.slice(0,6).join('')}</div>${ev.length>6?`<div class="sw-more"><div class="sw-list">${ev.slice(6).join('')}</div></div><button class="ghost small sw-all" data-act="sw-all" aria-expanded="false">Show all ${ev.length}</button>`:''}`:''}
  ${admin?`<h3 class="if-h">${icon('refresh',15)}A model stops answering</h3><p class="hint if-p">After 3 failed tries the engine answers that one reply with the agent’s fallback models, in this order, and starts on its own model again next time. They follow the priority list.</p><div class="fb-list" id="ifFb">${skeleton(1)}</div>`:''}</div>
 <div class="panel card"><div class="h-row"><h2 style="margin:0">Which agent uses what</h2>${admin&&Object.keys(d.route||{}).length>1?`<button class="ghost" data-act="use-bulk">${icon('users',15)}Set several</button>`:''}</div><p class="sub">Takes effect on the agent's next message.</p>${Object.entries(d.route||{}).map(([n,r])=>fieldRow(esc(ident(n).name),esc(modelLabel(r.model)),`<select data-use="${esc(n)}">${src.map(s=>`<option value="${esc(s.key)}" ${s.key===r.entry?'selected':''} ${s.ok?'':'disabled'}>${esc(s.name)}${s.used!=null?' · '+s.used+'% used':''}</option>`).join('')}</select>`)).join('')}</div></div>
 <h2 class="ach-cat">All accounts</h2><div class="grid-cards acct-grid">${(admin?src:src.filter(s=>usedBy(s.key).some(x=>S.me?.agents?.[x.id]))).map(card).join('')||(admin?'':'<p class="hint">None of your agents uses an AI account yet.</p>')}${admin?`<button class="card tile acct acct-more" data-act="acct-new">${icon('plus',22)}<b>Add account</b><span>Claude, ChatGPT, Google AI Pro, or any provider with an API key.</span></button>`:''}</div>`;
 el.querySelectorAll('[data-pri-model]').forEach(s=>s.onchange=()=>{const l=pri.map(e=>({...e}));l[+s.dataset.priModel].model=s.value;savePri(l)});
 el.querySelectorAll('[data-use]').forEach(s=>s.onchange=async()=>{const e=pri.find(x=>x.key===s.value);try{await UI('/ui/accounts/use',{method:'POST',body:{profile:s.dataset.use,key:s.value,model:e?.model||''}});toast(ident(s.dataset.use).name+' now uses '+byKey[s.value].name);reload()}catch(er){fail(er);reload()}});
 // drag a row onto another to reorder
 let from=null;el.querySelectorAll('.pri-row').forEach(r=>{r.ondragstart=e=>{from=+r.dataset.pri;r.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/pri',r.dataset.pri)};r.ondragend=()=>r.classList.remove('dragging');
  r.ondragover=e=>{if(from==null)return;e.preventDefault();r.classList.add('over')};r.ondragleave=()=>r.classList.remove('over');
  r.ondrop=e=>{e.preventDefault();r.classList.remove('over');const to=+r.dataset.pri;if(from==null||from===to)return;const l=[...pri];l.splice(to,0,l.splice(from,1)[0]);from=null;savePri(l)}});
 const saveAuto=async()=>{const on=$('#acAuto').checked;const sm=el.querySelector('.auto-on small');if(sm)sm.textContent=(on?'On':'Off')+': agents '+(on?'move':'stay where they are')+' when their account is nearly used up';
  try{await UI('/ui/accounts/auto',{method:'PUT',body:{on,threshold:+$('#acTh').value,backHome:$('#acBack').checked,backFree:+$('#acFree').value}});toast('Saved')}catch(e){fail(e)}};
 $('#acAuto').onchange=saveAuto;$('#acTh').onchange=saveAuto;$('#acBack').onchange=saveAuto;$('#acFree').onchange=saveAuto;
 // each agent's fallback models (backup-models.mjs) and the engine's extra keys, filled in once read: the page shows first
 if(admin)(async()=>{const box=el.querySelector('#ifFb');const [fb,pool,mine]=await Promise.all([UI('/ui/models/fallbacks').catch(()=>null),H('/credentials/pool').catch(()=>null),viewAgents().catch(()=>[])]);if(gone()||!box?.isConnected)return;
  const rows=(fb?.agents||[]).filter(x=>x.models?.length&&!x.agent.includes('--')&&(!mine.length||mine.includes(x.agent)))   /* the agents you may look at (not a member's private one) */,keys=(pool?.providers||[]).map(pv=>{const l=pv.entries||pv.keys||[],s=pv.provider||pv.name;return [provLabel({slug:s,name:pretty(s)}),l.length,l.filter(k=>XKEY_BAD.test(k.last_status||'')).length]}).filter(x=>x[1]),nBad=keys.reduce((t,x)=>t+x[2],0);
  box.innerHTML=(fb?.outages||[]).map(o=>`<p class="tz-note warn">${icon('alert',15)}<span><b>${esc(o.brand)}</b> keeps failing${o.since?' since '+esc(ago(o.since/1000)):''}, so ${esc((o.moved||[]).join(', ')||'its agents')} use ${esc((o.to||[]).join(', ')||'their fallback')} until it works again.</span></p>`).join('')
   +(rows.map((x,i)=>`<div class="fb-row" ${st(i)}>${agentAvatar(x.agent,24,{title:false})}<b>${esc(ident(x.agent).name)}</b><span class="fb-chain">${x.models.map(m=>`<span class="chip">${esc(modelLabel(m))}</span>`).join(icon('chevR',12))}</span>${x.byHand?'<small>set by hand</small>':''}</div>`).join('')||`<p class="hint" style="margin:0">${fb?'No agent has a fallback yet. Add a second AI account (another provider works best); the next check, within 5 minutes, fills them in.':'The fallback models couldn’t be read right now.'}</p>`)
   +`<div class="fb-keys">${icon('key',14)}<span>${keys.length?'Extra keys the engine rotates through when one hits its limit: '+esc(keys.map(([n,c])=>n+' '+plural(c,'key')).join(', '))+(nBad?` <span class="chip warn">${nBad===1?'1 is used up or failing':nBad+' are used up or failing'}</span>`:''):'No extra keys. Add one to let the engine rotate to it when a key hits its limit.'}</span><button class="ghost small" data-act="xkeys-open">${nBad?'Check them':keys.length?'Manage':'Add a key'}</button></div>`;Pages._xkeys=pool?.providers||[]})();
};
/* ---------- Extra keys (the engine's credential pool, 1 Nov 2026: moved here from System › Health): more API keys for one
   provider that the engine rotates through when one hits its limit. One small window lists them, adds one, removes one. */
const XKEY_BAD=/exhaust|limit|fail|error|invalid/i;
const xkeysBody=l=>(l.flatMap(pv=>(pv.entries||pv.keys||[]).map((k,i)=>{const tp=k.token_preview||k.redacted||k.preview||'',bad=XKEY_BAD.test(k.last_status||'');
  return `<div class="ca-row" ${st(i)}><span class="ic">${icon('key',15)}</span><div class="ca-t"><b>${esc(provLabel({slug:pv.provider||pv.name,name:pretty(pv.provider||pv.name)}))} · ${esc(k.label||'Key '+((k.index??i)+1))}</b><span>${esc([tp,k.last_status?pretty(k.last_status):''].filter(Boolean).join(' · '))}</span></div>${bad?'<span class="chip warn">Needs a look</span>':''}<button class="ghost small" data-act="xkey-del" data-p="${esc(pv.provider||pv.name)}" data-i="${esc(String(k.index??i))}">Remove</button></div>`}))).join('')||'<p class="hint" style="margin:0">No extra keys yet.</p>';
ACT['xkeys-open']=()=>{const d=drawer('Extra keys',`<p class="hint" style="margin:0 0 12px">More API keys for a provider. When one hits its limit, the engine goes on with the next.</p><div class="xkeys">${xkeysBody(Pages._xkeys||[])}</div>
  <h3 class="if-h" style="margin-top:18px">Add a key</h3><label for="xkP">Provider</label><input id="xkP" placeholder="openrouter" autocomplete="off"><label for="xkK">API key</label><input id="xkK" type="password" autocomplete="off"><label for="xkL">Label (optional)</label><input id="xkL" placeholder="work account" autocomplete="off">`,`<button class="ghost" data-act="close">Done</button><button class="primary" id="xkGo">Add key</button>`,{size:'sm'});Pages._xkD=d;xkeysAgain(d);
 d.querySelector('#xkGo').onclick=async e=>{const b=e.currentTarget,pv=d.querySelector('#xkP').value.trim(),k=d.querySelector('#xkK').value.trim();if(!pv||!k)return toast('Give the provider and the key','err');b.disabled=true;
  try{await post(H,'/credentials/pool',{provider:pv,api_key:k,label:d.querySelector('#xkL').value.trim()||undefined});toast('Key added');d.querySelectorAll('input').forEach(i=>i.value='');await xkeysAgain(d)}catch(er){fail(er)}finally{b.disabled=false}}};
const xkeysAgain=async d=>{try{Pages._xkeys=(await H('/credentials/pool')).providers||[]}catch{}const b=d?.querySelector('.xkeys');if(b?.isConnected)b.innerHTML=xkeysBody(Pages._xkeys)};
ACT['xkey-del']=async a=>{if(!await confirmBox('Remove this key?','The engine stops rotating to it.','Remove'))return;a.disabled=true;try{await del(H,'/credentials/pool/'+encodeURIComponent(a.dataset.p)+'/'+a.dataset.i);toast('Key removed');await xkeysAgain(Pages._xkD)}catch(e){a.disabled=false;fail(e)}};
// Recent switches: the rest fold open and shut smoothly
ACT['sw-all']=a=>{const m=a.previousElementSibling,open=!m.classList.contains('open');m.classList.toggle('open',open);a.setAttribute('aria-expanded',open);a.textContent=open?'Show fewer':'Show all '+(a.closest('.panel').querySelectorAll('.sw-row').length)};
// several agents onto one account and model at once (owner, 6 Nov 2026): tick the agents, pick where, Apply
ACT['use-bulk']=()=>{const d=Pages._acctD,src=Pages._acctSrc||[];const route=d?.route||{};const names=Object.keys(route).filter(n=>!n.includes('--'));
 const opts=[...(Pages._pri||[]).map(e=>({key:e.key,model:e.model})),...src.filter(s=>s.ok&&!s.isTeam&&!(Pages._pri||[]).some(e=>e.key===s.key)).map(s=>({key:s.key,model:''}))];
 const name=o=>{const s=src.find(x=>x.key===o.key);return (s?.name||o.key)+(o.model?' · '+modelLabel(o.model):'')};
 const dr=drawer('Set several agents',`<label>Agents</label><div class="bulk-agents">${names.map(n=>`<label class="chk-row">${toggle(false,ident(n).name,'data-bulk="'+esc(n)+'"')}${agentAvatar(n,22,{title:false})}<span>${esc(ident(n).name)}</span><small class="hint">${esc(modelLabel(route[n]?.model||''))}</small></label>`).join('')}</div>
  <label for="bulkTo">Use</label><select id="bulkTo">${opts.map((o,i)=>`<option value="${i}">${esc(name(o))}</option>`).join('')}</select><p class="hint">Only accounts that are signed in. It takes effect on each agent's next message.</p>`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="bulkGo">Apply</button>`,{size:'sm'});
 dr.querySelector('#bulkGo').onclick=async e=>{const pick=[...dr.querySelectorAll('[data-bulk]')].filter(x=>x.checked).map(x=>x.dataset.bulk);if(!pick.length)return toast('Tick at least one agent','err');
  const o=opts[+dr.querySelector('#bulkTo').value];e.currentTarget.disabled=true;let ok=0;const bad=[];
  for(const n of pick){try{await UI('/ui/accounts/use',{method:'POST',body:{profile:n,key:o.key,model:o.model||''}});ok++}catch(er){bad.push(ident(n).name+': '+(er.message||er))}}
  closeLayers();toast(ok+' agent'+(ok===1?'':'s')+' now use'+(ok===1?'s':'')+' '+name(o)+(bad.length?'. Not changed: '+bad.join('; '):''),bad.length?'err':'');reload()}};
async function savePri(list){try{await UI('/ui/accounts/priority',{method:'PUT',body:{priority:list}});reload()}catch(e){fail(e)}}
ACT['pri-move']=a=>{const l=[...Pages._pri],i=+a.dataset.i,j=i+ +a.dataset.dir;[l[i],l[j]]=[l[j],l[i]];savePri(l)};
ACT['pri-del']=a=>{const l=[...Pages._pri];l.splice(+a.dataset.i,1);savePri(l)};
Pages.priAddMenu=el=>{const pri=Pages._pri,has=(k,m)=>pri.some(e=>e.key===k&&e.model===m);const items=[];
 for(const s of Pages._acctSrc.filter(x=>!x.isTeam)){if(!pri.some(e=>e.key===s.key)){items.push({label:s.name,icon:s.key.startsWith('claude:')?'user':'cpu',run:()=>savePri([...pri,{key:s.key,model:''}])});continue}
  for(const m of (s.models||[]).filter(m=>!has(s.key,m)))items.push({label:s.name+' · '+modelLabel(m),sub:'Again, with this model',icon:s.key.startsWith('claude:')?'user':'cpu',run:()=>savePri([...pri,{key:s.key,model:m}])})}
 menu(el,items.length?items:[{header:'Every account and model is in the list'}])};

/* ---------- the ⋯ menu, the same on every account card: Reconnect, Rename, Choose agents…, its place in the priority
   list, and Remove. The same words for every kind of account (25 Oct). What does not apply is shown greyed with why. ---------- */
Pages.acctMenu=el=>{const s=(Pages._acctSrc||[]).find(x=>x.key===el.dataset.key);if(!s)return;const pri=Pages._pri||[],i=pri.findIndex(e=>e.key===s.key);
 const move=dir=>{const l=[...pri];[l[i],l[i+dir]]=[l[i+dir],l[i]];savePri(l)};
 const out=!(s.kind==='claude'&&s.id==='main');
 menu(el,[{label:'Reconnect',sub:s.kind==='key'?'Paste a new key':'Sign in again as this account',icon:'plug',run:()=>Pages.reconnect(s.key,s.name)},
  {label:'Rename',icon:'edit',run:()=>acctRename(s)},
  {label:'Choose agents…',sub:!s.ok?'Reconnect it first':plural((Object.values(Pages._acct?.route||{})).filter(r=>r.entry===s.key).length,'agent')+' on it',icon:'user',run:()=>acctAgents(s)},'-',
  ...(i<0?[{label:'Add to priority',icon:'plus',run:()=>savePri([...pri,{key:s.key,model:''}])}]:[{label:'Move up in priority',icon:'chevU',disabled:i===0,run:()=>move(-1)},{label:'Move down in priority',icon:'chevD',disabled:i>=pri.length-1,run:()=>move(1)}]),'-',
  out?{label:'Remove',icon:'trash',bad:true,run:()=>acctRemove(s)}:{label:'Remove',sub:'The main account stays',icon:'trash',disabled:true}])};
// Rename: one route for every account; an empty name goes back to the provider's own
async function acctRename(s){const v=await promptBox('Rename '+s.name,'Name',s.name,'Rename');if(v==null||v.trim()===s.name)return;
 try{await put(UI,'/ui/accounts/label',{key:s.key,label:v});toast(s.name+' renamed to '+(v.trim()||s.sub));reload()}catch(e){fail(e)}}
// Remove: always asked by the account's name, whatever kind it is
async function acctRemove(s){const slug=s.key.slice(2),ask=t=>confirmBox('Remove '+s.name+'?',t,'Remove');
 if(s.kind==='claude'){if(!await ask('It is signed out and removed from the box. Agents must use another account first.'))return;try{await UI('/ui/accounts/'+encodeURIComponent(s.id),{method:'DELETE'});toast(s.name+' removed');reload()}catch(e){fail(e)}return}
 if(s.gone){if(!await ask('Its card and its note go. Connect it again any time to bring it back.'))return;try{await post(UI,'/ui/accounts/forget',{key:s.key});toast(s.name+' removed');reload()}catch(e){fail(e)}return}
 if(s.kind==='google')return ACT['agy-out']({dataset:{name:s.name}});
 if(s.kind==='sub')return ACT['oauth-out']({dataset:{id:slug,name:s.name}});
 if(!await ask('Its key is deleted from the AI box. Agents that use it can’t answer with it until you connect it again.'))return;
 try{await del(UI,'/ui/connect/key',{provider:slug});await post(UI,'/ui/accounts/forget',{key:s.key}).catch(()=>{});toast(s.name+' removed');Chat.loadModels().catch(()=>{});reload()}catch(e){fail(e)}}
// Choose agents: every agent with a switch, on when it is on this account now. Turning one off moves it to the next account in
// the priority list (or another signed-in one); nothing changes until Apply.
function acctAgents(s){const d=Pages._acct||{},src=Pages._acctSrc||[],route=d.route||{},ag=Object.keys(route),off=!s.ok;
 const name=k=>src.find(x=>x.key===k)?.name||'another account';
 const spare=src.filter(x=>x.key!==s.key&&x.status==='ok'&&!x.isTeam),next=(d.priority||[]).map(e=>spare.find(x=>x.key===e.key)).find(Boolean)||spare[0];
 const dr=drawer('Agents on '+s.name,`${off?`<p class="hint" style="margin:0 0 12px">${esc(s.name)} needs reconnecting (${esc(ACCT_WORD[s.status]||'')}), so no agent can be moved onto it. Reconnect it first.</p>`:`<p class="hint" style="margin:0 0 12px">Takes effect on each agent's next message.${next?' Turning one off moves it to '+esc(next.name)+'.':''}</p>`}
  <div class="ag-pick">${ag.map(n=>{const on=route[n].entry===s.key;return `<div class="ag-row">${agentAvatar(n,30,{title:false})}<span class="t"><b>${esc(ident(n).name)}</b><small>${on?'On this account':'On '+esc(name(route[n].entry))}</small></span>${toggle(on,'Use '+s.name+' for '+ident(n).name,`data-ag="${esc(n)}" ${off||on&&!next?'disabled':''}`)}</div>`}).join('')||'<p class="hint">No agents yet.</p>'}</div>`,
  off?`<button class="ghost" data-act="close">Close</button><button class="primary" id="agRe">${icon('plug',15)}Reconnect</button>`:`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="agGo" disabled>Apply</button>`,{size:'sm'});
 if(off){dr.querySelector('#agRe').onclick=()=>{closeLayers();Pages.reconnect(s.key,s.name)};return}
 const go_=dr.querySelector('#agGo'),sw=[...dr.querySelectorAll('[data-ag]')],changed=()=>sw.filter(x=>x.checked!==(route[x.dataset.ag].entry===s.key));
 dr.addEventListener('change',()=>{go_.disabled=!changed().length});
 go_.onclick=async()=>{go_.disabled=true;const model=k=>(d.priority||[]).find(e=>e.key===k)?.model||'';let n=0;
  for(const x of changed()){const k=x.checked?s.key:next.key;try{await UI('/ui/accounts/use',{method:'POST',body:{profile:x.dataset.ag,key:k,model:model(k)}});n++}catch(e){fail(e)}}
  closeLayers();if(n)toast(plural(n,'agent')+' moved'+(sw.some(x=>x.checked)?'':' off '+s.name));reload()}}

/* ---------- Google AI Pro / Ultra through Antigravity (Google's official agy tool): connected through the Connect dialog
   (connect.js) like every account; its card is the account card. Remove moves its agents off it first. ---------- */
ACT['agy-out']=async a=>{const n=a?.dataset?.name||'Google AI Pro';if(!await confirmBox('Remove '+n+'?','Agents that use one of its models switch to their next account in the priority list.','Remove'))return;try{const r=await post(UI,'/ui/antigravity/logout');Pages._acctFresh=true;
 // who moved where, and anyone it could not move (they stay on Google AI Pro and their next message fails)
 const mv=Object.entries(r?.moved||{}),stuck=r?.stuck||[];toast(n+' removed'+(mv.length?'. Moved '+mv.map(([a])=>ident(a).name).join(', '):''));
 if(stuck.length)fail(new Error('Could not move '+stuck.map(a=>ident(a).name).join(', ')+'. Pick another model for '+(stuck.length>1?'them':'it')+' under Which agent uses what.'));reload()}catch(e){fail(e)}};

