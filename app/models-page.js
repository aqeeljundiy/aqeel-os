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
  const actions=()=>{setActions(tab==='Accounts'?`<button data-act="acct-refresh">${icon('refresh',16)}Refresh</button><button class="primary" data-menu="acct-new">${icon('plus',16)}Add account</button>`:'');
   if(tab==='Agents’ models')viewAgents().then(viewPick);else viewPick([])};
  actions();
  if(tab==='Accounts'){
   const tmp=document.createElement('div');tmp.hidden=true;document.body.append(tmp);box.hidden=true;document.body.append(box);
   await Promise.all([oldAccounts(p,box),oldModels(p,tmp)]);if(stale()){tmp.remove();box.remove();return}box.hidden=false;
   // the per-agent parts live on Agents' models now
   for(const x of panelsTitled(box,/^(Priority|Switch automatically|Which agent uses what)/))x.remove();box.querySelector('.two:empty')?.remove();
   box.querySelectorAll('.two').forEach(t=>{if(!t.querySelector('.panel'))t.remove()});
   const yours=box.querySelector('h2.ach-cat');if(yours){yours.replaceChildren('Your accounts');yours.style.marginTop='0'}
   // Team of models is not an account: it has its own tab
   box.querySelectorAll('.acct-grid .acct').forEach(c=>{if(/^Team of models/.test(c.querySelector('h3')?.textContent||''))c.remove()});
   const more=box.querySelector('.acct-more');if(more){more.removeAttribute('href');more.setAttribute('role','button');more.dataset.menu='acct-new';more.querySelector('span').textContent='Claude, ChatGPT, Google AI Pro, or a provider with an API key.';more.querySelector('b').textContent='Add account'}
   // the subscriptions you are signed in to (and signing out of them) from the old Models page
   const si=panelsTitled(tmp,/^Sign-ins/)[0];tmp.remove();
   if(si){si.style.marginTop='16px';si.querySelector('h2').textContent='Subscriptions you are signed in to';box.append(si)}}
  else if(tab==='Agents’ models'){
   const a=document.createElement('div'),b=document.createElement('div');b.style.marginTop='16px';box.append(a,b);box.hidden=true;document.body.append(box);
   await Promise.all([oldModels(p,a),oldAccounts(p,b)]);if(stale()){box.remove();return}box.hidden=false;for(const x of panelsTitled(a,/^(Sign-ins|Images|Team of models)/))x.remove();
   const dm=panelsTitled(a,/^Default model/)[0];if(dm){dm.querySelector('h2').textContent='Model for '+ident(agentProfile()||'default').name;
    const sub=dm.querySelector('.sub');if(sub)sub.textContent=sub.textContent.replace('Used for new chats','Used for its new chats')}
   const tw=a.querySelector('.two');if(tw&&tw.children.length===1)tw.classList.remove('two');
   b.querySelector('h2.ach-cat')?.remove();b.querySelector('.acct-grid')?.remove();b.querySelectorAll('.gem-card').forEach(x=>x.remove());
   panelsTitled(b,/^Which agent uses what/)[0]?.querySelector('h2')?.replaceChildren('Which account each agent uses')}
  else{const want=tab==='Pictures'?/^Images/:/^Team of models/;box.hidden=true;document.body.append(box);await oldModels(p,box);if(stale()){box.remove();return}box.hidden=false;
   for(const x of [...box.querySelectorAll('.panel')])if(!want.test((x.querySelector('h2')?.textContent||'').trim()))x.remove();
   box.querySelectorAll('.two').forEach(t=>{if(!t.querySelector('.panel'))t.remove();else t.classList.remove('two')});
   const pic=panelsTitled(box,/^Images/)[0];if(pic)pic.querySelector('h2').textContent='Who makes pictures';
   if(!box.querySelector('.panel'))box.innerHTML=emptyBox(tab==='Pictures'?'Pictures':'Team of models','Only admins can change this.','')}
  live.replaceChildren(box);pruneModelTab(box,tab);actions()}}
// one Add account button: what kind of account
Pages.acctNewMenu=async el=>{let o={providers:[]};try{o=await H('/providers/oauth?profile=default')}catch{}
 const subs=(o.providers||[]).filter(x=>!/nous|anthropic|claude/i.test(x.id+' '+x.name)&&!x.status?.logged_in&&x.flow!=='external');
 menu(el,[{header:'Add an account'},{label:'Claude',sub:'Sign in with your Claude plan',icon:'user',run:()=>ACT['acct-add']()},
  ...subs.map(x=>{const n=/codex|openai/i.test(x.id)?'ChatGPT':String(x.name).replace(/\s*\([^)]*\)/g,'').replace(/\s*OAuth\b/gi,'').trim();return {label:n,sub:'Sign in with your '+n+' plan',icon:'user',run:()=>ACT['oauth-in']({dataset:{id:x.id,name:n}})}}),
  {label:'Google AI Pro',sub:'Gemini and Claude on your Google plan',icon:'user',run:()=>{S.tab.models='Accounts';go('/models/models');setTimeout(()=>$('[data-act="agy-start"]')?.click()||toast('Google AI Pro is already connected'),900)}},
  '-',{label:'Another provider',sub:'OpenRouter, xAI and more, with an API key',icon:'key',run:()=>{store.set('keysOpen:LLM providers',true);go('/system/keys')}}],{matchWidth:true})};
// panels that some pages add a moment later (Team of models, Google AI Pro) land on their own tab only
const MODEL_TAB_DROP={'Accounts':/^(Priority|Switch automatically|Which agent uses what|Default model|Model for|Helper models|Images|Who makes pictures|Team of models)/,
 'Agents’ models':/^(Sign-ins|Subscriptions you|Images|Who makes pictures|Team of models|Google AI Pro|Gemini)/,'Pictures':/^(?!Images|Who makes pictures)/,'Team of models':/^(?!Team of models)/};
function pruneModelTab(box,tab){const re=MODEL_TAB_DROP[tab];if(!re)return;const go=()=>{for(const p of box.querySelectorAll('.panel')){const t=(p.querySelector('h2')?.textContent||'').trim();if(t&&re.test(t))p.remove()}};go();
 const mo=new MutationObserver(go);mo.observe(box,{childList:true,subtree:true});setTimeout(()=>mo.disconnect(),15000)}
