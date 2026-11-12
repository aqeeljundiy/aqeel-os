/* Channels › Kirimdev › "Approvals, prices and held chats" (13 Nov 2026). Three things a person used to need a command or a JSON edit for,
   one row per Kirimdev line, all admin-only (the page itself is):
     - who may approve drafts: picked from the team's people (System › Teams); their Telegram ids are what is stored;
     - the price list: products, shipping, promo codes and the card fee, with a hint for products the team's own list file has and the
       saved list does not (only when that file is there);
     - a chat held for the team after a handoff: Release gives it back to the agent.
   It adds one panel to the page kirimdev-page.js draws (it wraps Kirim.paint) and uses that page's own pieces: stackPop, confirmBox,
   toast, UI, morph, the same rows and buttons. No native dropdowns: choices are toggle rows. Server: kirimdev-settings.mjs. */
const KS={
 cache:{},
 load:async a=>(KS.cache[a]=await UI('/ui/kirimdev/settings?agent='+encodeURIComponent(a))),
 who:(l)=>esc(l.persona||l.agent),
 approvers(s){if(!s)return '<span>Loading…</span>';const n=s.approvers.picked.length+s.approvers.others.length;
  if(!n)return '<span>Nobody yet, so a draft can only be approved on this page.</span>';
  return '<span>'+esc([...s.approvers.picked,...s.approvers.others.map(o=>o.who+' (…'+o.telegramId.slice(-4)+')')].join(', '))+'</span>'},
 prices(s){if(!s)return '<span>Loading…</span>';const p=s.prices;
  if(!p.exists)return '<span>No price list yet. Without one the line can take payments in Test only.</span>'+(p.leftOut?.missing?.length?KS.hint(p):'');
  const bits=[p.products.length+' product'+(p.products.length===1?'':'s'),p.shipping.length?p.shipping.length+' shipping choice'+(p.shipping.length===1?'':'s'):'no shipping line',
   p.discounts.length?p.discounts.length+' promo code'+(p.discounts.length===1?'':'s')+' ('+p.discounts.map(d=>d.code).join(', ')+')':'no promo codes',p.cardFee!==''?'card fee '+p.cardFee+'%':'no card fee'];
  return '<span>'+esc(bits.join(' · '))+'</span>'+(p.updated?'<span class="km-at">Saved '+esc(p.updated)+(p.source?' from '+esc(p.source):'')+'</span>':'')+KS.hint(p)},
 hint(p){const m=p.leftOut?.missing||[];if(!m.length)return '';return `<span class="kms-hint">${esc(m.length)} product${m.length===1?'':'s'} in ${esc(p.leftOut.file)} ${m.length===1?'is':'are'} not in the list yet: ${esc(m.slice(0,4).map(x=>x.name).join(', '))}${m.length>4?' and '+(m.length-4)+' more':''}.</span>`},
 holds(l){const h=l.holds||[];if(!h.length)return '<span>No chat is held for the team now.</span>';
  return h.map(x=>`<div class="kms-hold"><span>Chat with ${esc(x.who)}: held for the team since ${esc(Kirim.when(x.since))}${x.wrote?', the customer wrote '+x.wrote+' time'+(x.wrote===1?'':'s')+' since':''}. It ends by itself ${esc(Kirim.when(x.until))}.</span>
   <button class="ghost" data-act="kms-release" data-agent="${esc(l.agent)}" data-ref="${esc(x.ref||'')}"${x.ref?'':' disabled'}>Release chat</button></div>`).join('')},
 row(l,i){const s=KS.cache[l.agent];
  return `<div class="km-line kms-line" data-kms="${esc(l.agent)}" ${st(i)}><div class="km-id">${agentAvatar(l.agent,36)}<div class="txt"><b>${KS.who(l)} · ${esc(l.business||'')}</b>
   <div class="kms-block"><i>Who may approve drafts</i>${KS.approvers(s)}<button class="ghost" data-act="kms-approvers" data-agent="${esc(l.agent)}">${icon('user',15)}Choose people</button></div>
   <div class="kms-block"><i>Price list</i>${KS.prices(s)}<button class="ghost" data-act="kms-prices" data-agent="${esc(l.agent)}">${icon('edit',15)}Edit price list</button></div>
   <div class="kms-block"><i>Held chats</i>${KS.holds(l)}</div></div></div></div>`},
 html(d){const L=d.lines||[];if(!L.length)return '<h2>Approvals, prices and held chats</h2><p class="sub">Connect a number first; its approvers, price list and held chats show here.</p>';
  return '<h2>Approvals, prices and held chats</h2><p class="sub">Per line: who may approve a draft from Telegram, the prices the agent quotes and charges, and chats that wait for the team.</p>'+L.map((l,i)=>KS.row(l,i)).join('')},
 draw(panel,d){const html=KS.html(d);if(panel._html===html)return;const first=panel._html==null;panel._html=html;if(first)panel.innerHTML=html;else morph(panel,html)},
 async mount(el,d){const root=el.querySelector('.km');if(!root)return;let panel=root.querySelector('.km-set');
  if(!panel){panel=document.createElement('div');panel.className='panel card km-p km-set';root.append(panel)}
  KS.draw(panel,d);
  const L=d.lines||[];await Promise.all(L.map(l=>KS.load(l.agent).catch(()=>null)));if(!panel.isConnected)return;KS.draw(panel,d)},
 // ---- the price list dialog: rows of inputs, add and remove, one save
 money:v=>String(v??''),
 prow(kind,r={}){const f=(k,ph,v,cls='')=>`<input class="kms-in ${cls}" data-k="${k}" value="${esc(v??'')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"${/price|amount|min|percent/.test(k)?' inputmode="decimal"':''}>`;
  const x=`<button type="button" class="ghost icon" data-kms-del aria-label="Remove this row">${icon('trash',16)}</button>`;
  if(kind==='products')return `<div class="kms-r" data-kind="products" data-id="${esc(r.id||'')}">${f('name','Product',r.name,'w')}${f('price','Price',r.price)}${x}</div>`;
  if(kind==='shipping')return `<div class="kms-r" data-kind="shipping" data-id="${esc(r.id||'')}" data-default="${r.default?1:''}">${f('name','Shipping choice',r.name,'w')}${f('price','Price (0 = free)',r.price)}${x}</div>`;
  return `<div class="kms-r" data-kind="discounts" data-on="${esc(r.on||'')}">${f('code','CODE',r.code,'c')}${f('percent','Percent',r.percent)}${f('amount','or amount',r.amount)}${f('until','Until (2026-12-31)',r.until)}${x}</div>`},
 async prices_dialog(agent){const l=(Kirim.d?.lines||[]).find(x=>x.agent===agent);if(!l)return;let s=KS.cache[agent];try{s=await KS.load(agent)}catch(e){toast(e.message||'Could not load it','err');return}
  const p=s.prices,miss=p.leftOut?.missing||[];
  const sec=(title,kind,rows,add,note='')=>`<h3 class="kms-h">${esc(title)}</h3>${note?`<p class="hint">${esc(note)}</p>`:''}<div class="kms-rows" data-rows="${kind}">${rows.map(r=>KS.prow(kind,r)).join('')}</div><button type="button" class="ghost" data-kms-add="${kind}">${icon('plus',15)}${esc(add)}</button>`;
  const {d,close}=stackPop('Price list for '+(l.persona||agent),
   `<p class="hint" style="margin:0 0 10px">The agent quotes and charges these prices and nothing else. A price is a whole number, no dots. A save counts at the next payment.</p>
    <label for="kms-cur">Currency sign</label><input id="kms-cur" class="kms-in" value="${esc(p.currency||'Rp')}" maxlength="6" autocomplete="off" style="max-width:110px">
    ${sec('Products','products',p.products,'Add a product')}
    ${miss.length?`<div class="kms-miss"><p class="hint">In ${esc(p.leftOut.file)} but not in the list yet:</p>${miss.map((m,i)=>`<div class="kms-m"><span>${esc(m.text)}</span><button type="button" class="ghost" data-kms-take="${i}">Add</button></div>`).join('')}</div>`:''}
    ${sec('Shipping','shipping',p.shipping,'Add a shipping choice','Leave it empty when the price has no shipping line.')}
    ${sec('Promo codes','discounts',p.discounts,'Add a promo code','Give a percent or an amount. Until is the last day it works (optional).')}
    <h3 class="kms-h">Card fee</h3><p class="hint">Added on top when the customer pays by card. Leave empty for none.</p><label for="kms-fee">Percent</label><input id="kms-fee" class="kms-in" value="${esc(p.cardFee)}" inputmode="decimal" autocomplete="off" style="max-width:110px">
    <p class="km-err" role="alert"></p>`,
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="kms-ok">Save price list</button>`);
  d.classList.remove('sm');d.classList.add('kms-wide');
  const err=d.querySelector('.km-err'),ok=d.querySelector('#kms-ok');
  d.addEventListener('click',e=>{const del=e.target.closest('[data-kms-del]'),add=e.target.closest('[data-kms-add]'),take=e.target.closest('[data-kms-take]');
   if(del){const r=del.closest('.kms-r');r.classList.add('kms-gone');setTimeout(()=>r.remove(),180)}
   if(add){const box=d.querySelector(`[data-rows="${add.dataset.kmsAdd}"]`);box.insertAdjacentHTML('beforeend',KS.prow(add.dataset.kmsAdd));const r=box.lastElementChild;r.classList.add('kms-new');r.querySelector('input')?.focus()}
   if(take){const m=miss[+take.dataset.kmsTake];if(!m)return;const box=d.querySelector('[data-rows="products"]');box.insertAdjacentHTML('beforeend',KS.prow('products',{id:m.id,name:m.name,price:m.price}));box.lastElementChild.classList.add('kms-new');take.closest('.kms-m').remove()}});
  const rowsOf=kind=>[...d.querySelectorAll(`[data-rows="${kind}"] .kms-r`)].map(r=>{const o={id:r.dataset.id||'',default:!!r.dataset.default,on:r.dataset.on||''};r.querySelectorAll('.kms-in').forEach(i=>o[i.dataset.k]=i.value.trim());return o}).filter(o=>Object.entries(o).some(([k,v])=>!['id','default','on'].includes(k)&&v));
  ok.onclick=async()=>{err.textContent='';ok.disabled=true;ok.textContent='Saving…';
   try{const r=await UI('/ui/kirimdev/prices',{method:'PUT',body:{agent,currency:d.querySelector('#kms-cur').value.trim(),products:rowsOf('products'),shipping:rowsOf('shipping'),discounts:rowsOf('discounts'),cardFee:d.querySelector('#kms-fee').value.trim()}});
    (KS.cache[agent]||={}).prices=r.prices;close();toast('Saved. The agent uses these prices from the next payment.');Kirim.refresh()}
   catch(e){err.textContent=e.message||'Could not save it';ok.disabled=false;ok.textContent='Save price list'}};
  setTimeout(()=>d.querySelector('.kms-in')?.focus(),40)},
 async approvers_dialog(agent){const l=(Kirim.d?.lines||[]).find(x=>x.agent===agent);if(!l)return;let s;try{s=await KS.load(agent)}catch(e){toast(e.message||'Could not load it','err');return}
  const on=new Set(s.approvers.picked),tog=(attr,v,title,sub,checked)=>`<button type="button" class="kms-person${checked?' on':''}" ${attr}="${esc(v)}" aria-pressed="${checked}"><span class="kms-box">${icon('check',14)}</span><span class="txt"><b>${esc(title)}</b><span>${esc(sub)}</span></span></button>`;
  const people=s.people.map(p=>tog('data-name',p.name,p.name,p.team,on.has(p.name))).join(''),others=s.approvers.others.map(o=>tog('data-other',o.telegramId,o.who,'Telegram id …'+o.telegramId.slice(-4)+', not a person on your teams',true)).join('');
  const {d,close}=stackPop('Who may approve drafts for '+(l.persona||agent),
   `<p class="hint" style="margin:0 0 10px">A draft is approved by replying to it in the team's Telegram topic. Only the people ticked here count; the check is by their Telegram user id, which is kept with their name on System › Teams.</p>
    ${people||'<p class="hint">Nobody on your teams has a Telegram id yet. Add the people on System › Teams (with their Telegram id), then come back.</p>'}
    ${others?`<p class="hint" style="margin-top:12px">Also on this line's list (untick to remove):</p>${others}`:''}<p class="km-err" role="alert"></p>`,
   `<button class="ghost" data-x>Cancel</button><button class="primary" id="kms-ok">Save</button>`);
  d.addEventListener('click',e=>{const b=e.target.closest('.kms-person');if(!b)return;const v=b.classList.toggle('on');b.setAttribute('aria-pressed',v)});
  const err=d.querySelector('.km-err'),ok=d.querySelector('#kms-ok');
  ok.onclick=async()=>{err.textContent='';ok.disabled=true;ok.textContent='Saving…';
   const chosen=[...d.querySelectorAll('.kms-person.on[data-name]')].map(b=>b.dataset.name),drop=[...d.querySelectorAll('.kms-person:not(.on)[data-other]')].map(b=>b.dataset.other);
   try{const r=await UI('/ui/kirimdev/approvers',{method:'PUT',body:{agent,people:chosen,dropOthers:drop}});(KS.cache[agent]||={}).approvers=r.approvers;close();toast(chosen.length||r.approvers.others.length?'Saved. Only these people can approve from Telegram.':'Saved. Nobody can approve from Telegram now.');Kirim.refresh()}
   catch(e){err.textContent=e.message||'Could not save it';ok.disabled=false;ok.textContent='Save'}}}};
{const base=Kirim.paint;Kirim.paint=function(el,d,teams){base.call(this,el,d,teams);KS.mount(el,d).catch(()=>{})}}
ACT['kms-approvers']=b=>KS.approvers_dialog(b.dataset.agent);
ACT['kms-prices']=b=>KS.prices_dialog(b.dataset.agent);
ACT['kms-release']=async b=>{if(!b.dataset.ref)return;
 if(!await confirmBox('Give this chat back to the agent?','The agent answers this customer again from their next message. Do it when the team has finished with this chat.','Release chat',false))return;
 b.disabled=true;try{const r=await UI('/ui/kirimdev/release',{method:'POST',body:{agent:b.dataset.agent,ref:b.dataset.ref}});toast(r.released?'Released. The agent answers this chat again.':'It was already released.');Kirim.refresh()}catch(e){b.disabled=false;toast(e.message||'Could not release it','err')}};
