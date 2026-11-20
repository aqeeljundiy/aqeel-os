/* ---------- System › Usage: every AI call, every provider (owner, 20 Nov 2026). From the engine's usage ledger (ledger.mjs):
   one view at a time (agent, person, model, provider and account, schedule), each sorted by tokens. An agent's row opens
   what its tokens are spent on: the parts of its requests (instructions, tool list, chat history, tool results, newest
   message), its schedules and chats, and the models and accounts it ran on. Google AI plan calls are estimated
   (its tool reports no token counts) and say so. Admins only; a member's own use stays on the page as before. ---------- */
const ULedger={view:'agent',open:null};
const ulNum=n=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n||0);
const UL_PARTS=[['sys','Instructions','The agent’s rules, memory and context, sent with every call'],['tools','Tool list','The description of every tool it may use'],
 ['hist','Chat history','Earlier messages in the same chat or run'],['toolres','Tool results','What its tools returned (pages, files, command output)'],['last','Newest message','The message it is answering']];
const UL_VIEWS=[['agent','Agent'],['person','Person'],['model','Model'],['provider','Provider and account'],['schedule','Schedule']];
function ulAnatomy(an){const t=UL_PARTS.reduce((s,[k])=>s+(an[k]||0),0)||1;
 return `<div class="ul-an" role="img" aria-label="What the tokens were spent on">${UL_PARTS.map(([k],i)=>`<i class="ul-p${i}" style="width:${(an[k]||0)/t*100}%"></i>`).join('')}</div>
 <div class="ul-legend">${UL_PARTS.map(([k,l,why],i)=>`<span title="${esc(why)}"><i class="ul-p${i}"></i>${esc(l)} <b>${Math.round((an[k]||0)/t*100)}%</b> <small>${ulNum(an[k]||0)}</small></span>`).join('')}</div>`}
function ulRows(d,view){const rows=d[view]||[],tot=d.total.tokens||1,sub=r=>view==='model'?r.provider:view==='provider'?(r.account?'':'one account'):view==='schedule'?r.agentName+' · '+(r.kind==='schedule'?'scheduled':r.kind==='aux'?'background':'chats'):'';
 if(!rows.length)return '<p class="hint">No AI calls recorded in this period yet. The record starts with the engine update of 20 Nov 2026.</p>';
 return `<div class="ul-tbl" role="table"><div class="ul-h" role="row"><span>${esc(UL_VIEWS.find(v=>v[0]===view)[1])}</span><span>Calls</span><span>Read</span><span>Cached</span><span>Written</span><span>Share</span></div>
 ${rows.map(r=>`<div class="ul-r${view==='agent'?' click':''}${ULedger.open===r.key&&view==='agent'?' open':''}" role="row" ${view==='agent'?`data-act="ul-open" data-key="${esc(r.key)}" tabindex="0"`:''}>
  <span class="ul-n"><b>${esc(r.name)}</b>${sub(r)?`<small>${esc(sub(r))}</small>`:''}${r.est?`<small class="ul-est" title="Estimated from request and answer sizes">${r.est===r.calls?'estimated':r.est+' estimated'}</small>`:''}</span>
  <span>${r.calls.toLocaleString()}</span><span>${ulNum(r.read)}</span><span>${ulNum(r.cached)}</span><span>${ulNum(r.written)}</span>
  <span class="ul-share"><i style="width:${Math.max(1,r.tokens/tot*100)}%"></i><b>${Math.round(r.tokens/tot*100)}%</b></span></div>
  ${view==='agent'&&ULedger.open===r.key?'<div class="ul-drill" data-for="'+esc(r.key)+'"><div class="skel" style="height:120px"></div></div>':''}`).join('')}</div>`}
async function ulDrill(panel,days,key){const box=panel.querySelector('.ul-drill');if(!box)return;let d;try{d=await UI('/ui/usage/ledger?days='+days+'&agent='+encodeURIComponent(key))}catch(e){box.innerHTML=alertBox(esc(e.message));return}
 const a=d.agent?.[0]||d.total,top=(l,n=6)=>l.slice(0,n).map(r=>`<li><span>${esc(r.name)}</span><small>${esc(r.provider&&r.name!==r.provider?r.provider:'')}</small><b>${ulNum(r.tokens)}</b></li>`).join('');
 box.innerHTML=`<h3>What ${esc(a.name||'it')} spends tokens on</h3>${ulAnatomy(d.total.an)}
  <div class="ul-cols"><div><h4>Schedules and chats</h4><ul class="ul-list">${top(d.schedule)}</ul></div><div><h4>Models</h4><ul class="ul-list">${top(d.model,4)}</ul><h4>Accounts</h4><ul class="ul-list">${top(d.provider,4)}</ul></div></div>
  <div class="ul-budget">${(()=>{const b=(d.budgets||[]).find(x=>x.agent===key);return b?`<span>Daily budget <b>${ulNum(b.budget)}</b> tokens · today ${ulNum(b.used)} (${b.pct}%)</span>`:'<span>No daily budget. Health warns at 80% of one; nothing is ever stopped.</span>'})()}
   <button class="ghost small" data-act="ul-budget" data-agent="${esc(key)}" data-cur="${esc(String((d.budgets||[]).find(x=>x.agent===key)?.budget||''))}">${icon('gauge',14)}${(d.budgets||[]).some(x=>x.agent===key)?'Change budget':'Set a daily budget'}</button></div>
  <p class="hint">${d.total.calls.toLocaleString()} AI calls, ${ulNum(Math.round(d.total.tokens/Math.max(1,d.total.calls)))} tokens each on average. Most of a call is usually reading: a smaller instruction set, fewer tools or shorter tool results lower every call.</p>`}
{const base=PAGES.usage;PAGES.usage=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone()||S.me?.admin===false)return;
 const days={'7 days':7,'30 days':30,'90 days':90}[S.tab.usage||'7 days'];
 const panel=document.createElement('div');panel.className='panel card ul';panel.innerHTML='<h2>Every AI call, every provider</h2><div class="skel" style="height:240px"></div>';el.prepend(panel);
 let d;try{d=await UI('/ui/usage/ledger?days='+days)}catch(e){if(!gone())panel.innerHTML='<h2>Every AI call, every provider</h2>'+alertBox(esc(e.message||'Could not read the usage record.'));return}if(gone())return;
 const draw=()=>{const t=d.total,est=t.calls?Math.round(t.est/t.calls*100):0;
  panel.innerHTML=`<div class="ul-top"><div><h2>Every AI call, every provider</h2><p class="sub">${ulNum(t.tokens)} tokens in ${t.calls.toLocaleString()} calls over ${days} days${est?` · ${est}% estimated (Google AI plan)`:''}. Read is what the AI had to read, cached is the part the provider remembered (cheaper), written is its answers.</p></div>
   <div class="seg-mini ul-views" role="tablist">${UL_VIEWS.map(([k,l])=>`<button role="tab" aria-selected="${ULedger.view===k}" class="${ULedger.view===k?'on':''}" data-act="ul-view" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
   ${t.calls?ulAnatomy(t.an):''}${ulRows(d,ULedger.view)}`;
  if(ULedger.open&&ULedger.view==='agent')ulDrill(panel,days,ULedger.open)};
 panel._ulDraw=draw;draw()}}
ACT['ul-view']=a=>{ULedger.view=a.dataset.v;ULedger.open=null;a.closest('.ul')?._ulDraw?.()};
ACT['ul-open']=a=>{ULedger.open=ULedger.open===a.dataset.key?null:a.dataset.key;a.closest('.ul')?._ulDraw?.()};

ACT['ul-budget']=async a=>{const cur=a.dataset.cur||'',v=await promptBox('Daily token budget for '+ident(a.dataset.agent).name,'Tokens a day (empty takes the budget away). Health warns at 80%; nothing is stopped.',cur,'Save');if(v==null)return;
 const n=Math.round(+String(v).replace(/[^0-9.]/g,'')*(/m/i.test(v)?1e6:/k/i.test(v)?1e3:1))||0;
 try{await put(UI,'/ui/usage/budget',{agent:a.dataset.agent,tokens:n});toast(n?'Budget saved':'Budget taken away');const p=a.closest('.ul');p?._ulDraw?.()}catch(e){fail(e)}};
