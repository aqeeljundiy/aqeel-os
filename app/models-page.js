/* ---------- Models › Models and accounts: one page, four tabs (agreed layout, 18 Oct). It is put together from the
   panels the old Models and Accounts pages already draw, so every control works exactly as before:
   Accounts       every account that does the thinking, with one Add account button (Claude, ChatGPT, Google AI Pro,
                  or a provider with an API key), and the subscriptions you are signed in to
   Agents' models the model the agent shown uses (with the Showing picker), helper models, the priority list,
                  switching automatically and which account each agent uses
   Pictures       who makes pictures
   Team of models several models answering together
   The old addresses (#/models/accounts, #/models/models) open this page. ---------- */
const MODEL_TABS=['Accounts','Agents’ models','Pictures','Team of models'];
const panelsTitled=(root,re)=>[...root.querySelectorAll('.panel')].filter(p=>re.test((p.querySelector('h2')?.textContent||'').trim()));
{const oldModels=PAGES.models,oldAccounts=PAGES.accounts;
 PAGES.models=async(p,el,r)=>{
  // an old link straight to the accounts list opens the Accounts tab
  if(!S.tab.models)S.tab.models='Accounts';const tab=MODEL_TABS.includes(S.tab.models)?S.tab.models:'Accounts';
  // a newer draw (another tab clicked meanwhile) wins: an older one stops at its next step
  const tok=S._mtok=(S._mtok||0)+1,stale=()=>tok!==S._mtok;
  el.innerHTML=`${tabs('models',MODEL_TABS,tab)}<div id="mtab"><div class="skel" style="height:160px;border-radius:18px"></div></div>`;placePills();const live=el.querySelector('#mtab');const box=document.createElement('div');
  const actions=()=>{setActions(tab==='Accounts'?`<button data-act="acct-refresh">${icon('refresh',16)}Refresh</button><button class="primary" data-menu="acct-new">${icon('plus',16)}Add account</button>`:tab==='Agents’ models'?`<button data-act="acct-refresh" title="Ask every provider for its model list again">${icon('refresh',16)}Refresh models</button>`:'');
   if(tab==='Agents’ models')viewAgents().then(viewPick);else viewPick([])};
  actions();
  if(tab==='Accounts'){
   const tmp=document.createElement('div');tmp.hidden=true;document.body.append(tmp);box.hidden=true;document.body.append(box);
   await Promise.all([oldAccounts(p,box),oldModels(p,tmp)]);if(stale()){tmp.remove();box.remove();return}box.hidden=false;
   // the per-agent parts live on Agents' models now
   // the priority order and automatic switching are about accounts, so they stay here (owner, 19 Oct)
   for(const x of panelsTitled(box,/^(Which agent uses what)/))x.remove();box.querySelector('.two:empty')?.remove();
   box.querySelectorAll('.two').forEach(t=>{if(!t.querySelector('.panel'))t.remove()});
   const yours=box.querySelector('h2.ach-cat');if(yours){yours.replaceChildren('Your accounts');yours.style.marginTop='0'}
   // Team of models is not an account: it has its own tab
   box.querySelectorAll('.acct-grid .acct').forEach(c=>{if(/^Team of models/.test(c.querySelector('h3')?.textContent||''))c.remove()});
   const more=box.querySelector('.acct-more');if(more){more.removeAttribute('href');more.setAttribute('role','button');more.tabIndex=0;more.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();more.click()}};more.dataset.menu='acct-new';more.querySelector('span').textContent='ChatGPT, Claude, Google AI Pro, or a provider with an API key.';more.querySelector('b').textContent='Add account'}
   // the subscriptions you are signed in to (and signing out of them) from the old Models page
   const si=panelsTitled(tmp,/^Sign-ins/)[0];tmp.remove();
   if(si){si.style.marginTop='16px';si.querySelector('h2').textContent='Subscriptions you are signed in to';box.append(si)}}
  else if(tab==='Agents’ models'){
   const a=document.createElement('div'),b=document.createElement('div');b.style.marginTop='16px';box.append(a,b);box.hidden=true;document.body.append(box);
   await Promise.all([oldModels(p,a),oldAccounts(p,b)]);if(stale()){box.remove();return}box.hidden=false;for(const x of panelsTitled(a,/^(Sign-ins|Images|Team of models)/))x.remove();
   const dm=panelsTitled(a,/^Default model/)[0];if(dm){dm.querySelector('h2').textContent='Model for '+ident(agentProfile()||'default').name;
    const sub=dm.querySelector('.sub');if(sub)sub.textContent=sub.textContent.replace('Used for new chats','Used for its new chats')}
   const tw=a.querySelector('.two');if(tw&&tw.children.length===1)tw.classList.remove('two');
   b.querySelector('h2.ach-cat')?.remove();b.querySelector('.acct-grid')?.remove();for(const x of panelsTitled(b,/^(Priority|Switch automatically)/))x.remove();b.querySelectorAll('.gem-card,.acct-out').forEach(x=>x.remove());
   panelsTitled(b,/^Which agent uses what/)[0]?.querySelector('h2')?.replaceChildren('Which account each agent uses')}
  else{const want=tab==='Pictures'?/^Images/:/^Team of models/;box.hidden=true;document.body.append(box);await oldModels(p,box);if(stale()){box.remove();return}box.hidden=false;
   for(const x of [...box.querySelectorAll('.panel')])if(!want.test((x.querySelector('h2')?.textContent||'').trim()))x.remove();
   box.querySelectorAll('.two').forEach(t=>{if(!t.querySelector('.panel'))t.remove();else t.classList.remove('two')});
   const pic=panelsTitled(box,/^Images/)[0];if(pic)pic.querySelector('h2').textContent='Who makes pictures';
   if(!box.querySelector('.panel'))box.innerHTML=emptyBox(tab==='Pictures'?'Pictures':'Team of models','Only admins can change this.','')}
  live.replaceChildren(box);pruneModelTab(box,tab);actions()}}
// one Add account button: what kind of account
Pages.acctNewMenu=async el=>{let o={providers:[]};try{o=await H('/providers/oauth')}catch{}
 const subs=(o.providers||[]).filter(x=>!/nous|anthropic|claude/i.test(x.id+' '+x.name)&&!x.status?.logged_in&&x.flow!=='external');
 const items=[{label:'Claude',sub:'Sign in with your Claude plan',icon:'user',run:()=>ACT['acct-add']()},...subs.map(x=>{const n=/codex|openai/i.test(x.id)?'ChatGPT':String(x.name).replace(/\s*\([^)]*\)/g,'').replace(/\s*OAuth\b/gi,'').trim();return {label:n,sub:'Sign in with your '+n+' plan',icon:'user',run:()=>ACT['oauth-in']({dataset:{id:x.id,name:n}})}}),
  {label:'Google AI Pro',sub:'Gemini and Claude on your Google plan',icon:'user',run:()=>{S.tab.models='Accounts';go('/models/models');
   // wait for the Google card to appear (the accounts request can be slow), then start its sign-in
   const t0=Date.now(),tryIt=()=>{const b=$('[data-act="agy-start"]');if(b)return b.click();if($('[data-act="agy-out"]'))return toast('Google AI Pro is already connected');if(Date.now()-t0<8000)setTimeout(tryIt,250)};setTimeout(tryIt,300)}}].sort((x,y)=>x.label.localeCompare(y.label));
 menu(el,[{header:'Add an account'},...items,
  '-',{label:'Another provider',sub:'OpenRouter, xAI and more, with an API key',icon:'key',run:()=>{store.set('keysOpen:LLM providers',true);go('/system/keys')}}],{matchWidth:true})};
// panels that some pages add a moment later (Team of models, Google AI Pro) land on their own tab only
const MODEL_TAB_DROP={'Accounts':/^(Which agent uses what|Default model|Model for|Helper models|Images|Who makes pictures|Team of models)/,
 'Agents’ models':/^(Priority|Switch automatically|Sign-ins|Subscriptions you|Images|Who makes pictures|Team of models|Google AI Pro|Gemini|Old Code sign-ins)/,'Pictures':/^(?!Images|Who makes pictures)/,'Team of models':/^(?!Team of models)/};
function pruneModelTab(box,tab){const re=MODEL_TAB_DROP[tab];if(!re)return;const go=()=>{for(const p of box.querySelectorAll('.panel')){const t=(p.querySelector('h2')?.textContent||'').trim();if(t&&re.test(t))p.remove()}};go();
 const mo=new MutationObserver(go);mo.observe(box,{childList:true,subtree:true});setTimeout(()=>mo.disconnect(),15000)}
/* ---------- System › Usage › By model: each model with its rank, provider, what it is set as, how its tokens split,
   how busy it was, what it can do, and a Use as menu (the engine's per-model statistics) ---------- */
{const base=PAGES.usage;PAGES.usage=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;
 const days={'7 days':7,'30 days':30,'90 days':90}[S.tab.usage||'7 days'];const list=await viewAgents().catch(()=>[]);
 const who=S.usageAgent&&(S.usageAgent==='*'||list.includes(S.usageAgent))?S.usageAgent:list.length>1?'*':(S.profile||'default');
 const panel=[...el.querySelectorAll('.panel')].find(x=>x.querySelector('h2')?.textContent.trim()==='By model');if(!panel)return;
 const me=who==='*'?(S.profile||'default'):who,agents=who==='*'?(list.length?list:['default']):[who],pq='?profile='+encodeURIComponent(me);
 const [res,info,aux]=await Promise.all([Promise.all(agents.map(a=>H('/analytics/models?days='+days+'&profile='+encodeURIComponent(a)).catch(()=>null))),H('/model/info'+pq).catch(()=>({})),H('/model/auxiliary'+pq).catch(()=>({tasks:[]}))]);
 if(!panel.isConnected||!res.some(Boolean))return;
 // several agents: the same model added together
 const by=new Map();for(const r of res)for(const m of r?.models||[]){const k=m.model+'|'+m.provider,t=by.get(k);if(!t){by.set(k,{...m});continue}
  for(const f of ['input_tokens','output_tokens','cache_read_tokens','reasoning_tokens','estimated_cost','actual_cost','sessions','api_calls','tool_calls'])t[f]=(t[f]||0)+(m[f]||0);t.last_used_at=Math.max(t.last_used_at||0,m.last_used_at||0)}
 const tot=m=>(m.input_tokens||0)+(m.output_tokens||0)+(m.cache_read_tokens||0)+(m.reasoning_tokens||0);
 const ms=[...by.values()].sort((a,b)=>tot(b)-tot(a));if(!ms.length)return;
 const stat=[...el.querySelectorAll('.stat')].find(x=>x.querySelector('.th')?.textContent==='Sessions');if(stat){const s=stat.querySelector('small');if(s)s.textContent+=' · '+plural(ms.length,'model')+' used'}
 const tasks=aux.tasks||[];Pages._umAux=tasks;Pages._umWho=me;
 const SEG=[['input_tokens','Input','var(--blue)'],['output_tokens','Output','var(--sky-1)'],['cache_read_tokens','Read from cache','var(--fc-teal)'],['reasoning_tokens','Thinking','var(--fc-amber)']];
 const row=(m,i)=>{const isMain=m.model===info.model&&(!info.provider||!m.provider||m.provider===info.provider);const helper=tasks.find(t=>t.provider&&t.provider!=='auto'&&t.model===m.model);
  const avg=m.sessions?Math.round(tot(m)/m.sessions):m.avg_tokens_per_session||0,c=m.capabilities||{};
  const can=[...capWords(c),c.model_family?'Family: '+c.model_family:'',c.context_window?'reads up to '+num(c.context_window)+' tokens':'',c.max_output_tokens?'answers up to '+num(c.max_output_tokens):''].filter(Boolean);
  return `<div class="um-row" ${st(i)}><div class="um-top"><span class="um-n">${i+1}</span><div class="txt"><b>${esc(modelLabel(m.model))}</b><span>${esc(provLabel({slug:m.provider||'',name:m.provider||''}))} · ${esc(m.model)}</span></div>
   <span class="um-tags">${isMain?`<span class="chip" title="The main model of ${esc(ident(me).name)}">Default</span>`:''}${helper?`<span class="chip" title="Set by hand for this helper job">Helper · ${esc(auxLabel(helper,tasks))}</span>`:''}</span>
   <button class="ghost icon" data-act="um-use" data-m="${esc(m.model)}" data-p="${esc(m.provider||'')}" aria-label="Use ${esc(modelLabel(m.model))} as…" title="Use as…">${icon('more',18)}</button></div>
   <div class="um-bar" role="img" aria-label="${esc(SEG.filter(([k])=>m[k]).map(([k,l])=>l+' '+num(m[k])).join(', '))}">${SEG.map(([k,l,col])=>m[k]?`<i style="flex:${m[k]};background:${col}" title="${l}: ${num(m[k])}"></i>`:'').join('')}</div>
   <div class="legend um-leg">${SEG.filter(([k])=>m[k]).map(([k,l,col])=>`<span><i style="background:${col}"></i>${l} ${num(m[k])}</span>`).join('')}</div>
   <p class="um-facts">${esc([plural(m.sessions||0,'session'),num(avg)+' tokens a session',plural(m.api_calls||0,'model call'),plural(m.tool_calls||0,'tool call'),m.last_used_at?'last used '+ago(m.last_used_at):'',money(m.estimated_cost||0,{cents:true})].filter(Boolean).join(' · '))}</p>
   ${can.length?`<p class="um-can">${esc(can.join(' · '))}</p>`:''}</div>`};
 const tbl=panel.querySelector('.tbl');const box=document.createElement('div');box.className='um-list';box.innerHTML=ms.map(row).join('');(tbl||panel.lastElementChild).replaceWith(box)}}
ACT['um-use']=a=>{const m=a.dataset.m,pv=a.dataset.p,who=Pages._umWho||'default',q='?profile='+encodeURIComponent(who),tasks=Pages._umAux||[],nm=ident(who).name;
 const set=async(body,msg)=>{try{const r=await setModelChecked({provider:pv,model:m,...body},q);if(!r)return;toast(msg);if(body.scope==='main'&&who===(S.profile||'default'))Chat.loadModels().then(()=>paintSide()).catch(()=>{})}catch(e){fail(e)}};
 menu(a,[{header:'Use '+modelLabel(m)+' for '+nm},{label:'As the main model',icon:'cpu',sub:'New chats, schedules and channels',run:()=>set({scope:'main'},nm+' now uses '+modelLabel(m))},'-',{header:'As a helper model'},
  {label:'For every helper job',icon:'layers',run:()=>set({scope:'auxiliary',task:''},'Every helper job now uses '+modelLabel(m))},...tasks.map(t=>({label:auxLabel(t,tasks),sub:t.hint||AUX_META[t.task]?.[1]||'',run:()=>set({scope:'auxiliary',task:t.task},auxLabel(t,tasks)+' now uses '+modelLabel(m))}))],{search:tasks.length>8,matchWidth:false})};

/* ---------- The agent picked in "Showing" stays in the address (?showing=<agent>), so a link or a reload opens the
   same agent's page; and a slim note under the title says whose settings a change lands on ---------- */
{const v=new URLSearchParams(location.search).get('showing');if(v){S.viewAgent=v;S.viewAll=false}}
const showingUrl=v=>{const u=new URL(location.href);if(v)u.searchParams.set('showing',v);else u.searchParams.delete('showing');if(u.href!==location.href)history.replaceState(history.state,'',u.pathname+u.search+u.hash)};
function scopeNote(v){let n=$('.scope-note');if(!v){if(n)leave(n,180);return}const head=$('.page-head');if(!head)return;
 if(!n||n.classList.contains('closing')){n?.remove();n=document.createElement('p');n.className='scope-note';head.after(n)}
 n.textContent='Changes here apply to '+ident(v).name+'. Chats still go to '+ident(S.profile||'default').name+'.'}
{const base=viewPick;viewPick=list=>{base(list);const all=typeof showingAll==='function'&&showingAll();const me=S.profile||'default';
 if(list.length<2)return scopeNote('');const v=!all&&S.viewAgent&&S.viewAgent!==me&&list.includes(S.viewAgent)?S.viewAgent:'';showingUrl(v);scopeNote(v)}}
addEventListener('hashchange',()=>{if(!VIEW_RE.test(location.hash)){showingUrl('');$('.scope-note')?.remove()}});
