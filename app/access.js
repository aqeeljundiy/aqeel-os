// Access on every connection page: for the agent you are showing, what it owns and what other agents share with it,
// who else uses each connection, and "Who can use" (one switch per agent, the owner always on). Admins only.
const Access={
 async load(kind){try{return await UI('/ui/access?kind='+kind)}catch{return null}},
 av(a,sz=22){const i=ident(a.id||a);const n=a.name||i.name||a;return `<span class="acc-av" style="width:${sz}px;height:${sz}px;--h:${[...String(a.id||a)].reduce((s,c)=>s+c.charCodeAt(0),0)%360}" title="${esc(n)}">${i.avatar?`<img src="${esc(i.avatar)}" alt="">`:esc(String(n)[0].toUpperCase())}</span>`},
 who(it){return `<span class="acc-who" aria-label="Used by ${esc(it.users.map(u=>u.name).join(', '))}">${it.users.slice(0,5).map(u=>this.av(u)).join('')}${it.users.length>5?`<span class="acc-more">+${it.users.length-5}</span>`:''}</span>`},
 from(it){return it.own?`<span class="acc-from">Owned by ${esc(it.ownerName)} · ${esc(it.ownNote)}</span>`:`<span class="acc-from">${this.av({id:it.owner,name:it.ownerName},16)}Owned by ${esc(it.ownerName)}</span>`},
 btn(it){return `<button class="ghost small acc-btn" data-act="acc-open" data-kind="${it.kind}" data-id="${esc(it.id)}" title="Owned by ${esc(it.ownerName)}. Who can use ${esc(it.label)}" aria-label="Owned by ${esc(it.ownerName)}. Who can use ${esc(it.label)}: ${esc(it.users.map(u=>u.name).join(', '))}"><span class="acc-own" title="Owner: ${esc(ident(it.owner).name||it.ownerName)}">${this.av({id:it.owner,name:ident(it.owner).name||it.ownerName})}<i>${icon('crown',9)}</i><b>${esc(ident(it.owner).name||it.ownerName)}</b></span>${this.who({...it,users:it.users.filter(u=>u.id!==it.owner)})}<span>${it.users.length>1?'+'+(it.users.length-1):'Only owner'}</span></button>`},
 // put the rows of a list into "Owned by" and "Shared with" groups, and add who uses each
 group(el,kind,data,rowsOf,idOf,where){if(!data)return;const ag=viewing();const me=ident(ag).name;const by=new Map(data.items.map(x=>[x.id,x]));
  const rows=rowsOf(el).filter(r=>by.has(idOf(r)));if(!rows.length)return;
  const own=[],shared=[];for(const r of rows){const it=by.get(idOf(r));if(r.dataset.acc)continue;r.dataset.acc='1';
   const act=r.querySelector('.act');act?.insertAdjacentHTML('afterbegin',this.btn(it));r.querySelectorAll('.share-box,.chip.access').forEach(x=>x.remove());
   r.querySelector('[data-act="mcp-share"]')?.remove();
   if(it.owner!==ag){r.querySelector('.txt')?.insertAdjacentHTML('beforeend',this.from(it));
    const mine=it.users.find(u=>u.id===ag);if(mine&&!mine.signed&&it.ownerSigned)act?.insertAdjacentHTML('afterbegin',`<button class="small acc-use" data-act="acc-use" data-kind="${kind}" data-id="${esc(it.id)}">Use ${esc(it.ownerName)}’s sign-in</button>`);
    shared.push(r)}else own.push(r)}
  const host=where(el,rows[0]);if(!host)return;
  const mk=(title,list)=>{if(!list.length)return null;const g=document.createElement('div');g.className='acc-group';g.innerHTML=`<div class="acc-grp">${title}</div><div class="card list"></div>`;list.forEach(r=>g.lastChild.append(r));return g};
  const a=mk('Owned by '+esc(me),own),b=mk('Shared with '+esc(me),shared);host.replaceWith(...[a,b].filter(Boolean))},
 async open(kind,id){const data=await this.load(kind);const it=data?.items.find(x=>x.id===id);if(!it)return toast('That connection is gone. Reload the page.','err');
  const what={mcp:'with the same sign-in',google:'with the same Google sign-in',plugin:'turned on',key:'with the same value (still hidden)'}[kind];
  const d=drawer('Who can use '+it.label,`<p class="hint" style="margin:0 0 14px">${it.bot?'A chat bot answers as one agent only, so it can’t be shared.':`Owned by ${esc(it.ownerName)}. Turning another agent on gives it ${esc(it.label)} ${what}; turning it off takes it away. ${kind==='google'?'It works straight away.':'The agents restart by themselves once nobody is mid-reply.'}`}</p>
   <div class="share-agents">${data.agents.map((a,i)=>{const u=it.users.find(x=>x.id===a.id),owner=a.id===it.owner;return `<div class="share-row${owner?' has':''}" ${st(i)}>${this.av(a,34)}<span class="txt"><b>${esc(a.name)}</b><span>${owner?'Owner':u?(u.signed?'Uses it':'Set up, not signed in'):'Not yet'}</span></span>${owner?'<span class="chip blue">Owner</span>':u&&!it.bot?`<button class="ghost small" data-own="${esc(a.id)}">Make owner</button>`:''}${toggle(!!u,a.name,'data-ag="'+esc(a.id)+'"'+(owner||it.bot?' disabled':''))}</div>`}).join('')}</div>`,`<button class="primary" data-act="close">Done</button>`);
  let changed=false;const mo=new MutationObserver(()=>{if(!d.isConnected){mo.disconnect();if(changed)reload()}});mo.observe(document.body,{childList:true,subtree:true});
  d.querySelectorAll('.share-agents input[data-ag]').forEach(c=>c.onchange=async()=>{c.disabled=true;const name=data.agents.find(a=>a.id===c.dataset.ag)?.name;{const sp=c.closest('.share-row')?.querySelector('.txt span');if(sp)sp.innerHTML='<span class="spinner tiny"></span>'+(c.checked?'Sharing…':'Taking it away…')}
   try{await post(UI,'/ui/access',{kind,id,agent:c.dataset.ag,on:c.checked});changed=true;const s=c.closest('.share-row').querySelector('.txt span');s.textContent=c.checked?'Uses it':'Not yet';
    toast(c.checked?name+' can use '+it.label+(kind==='google'?'':' · ready in about a minute'):it.label+' taken from '+name)}catch(e){c.checked=!c.checked;fail(e)}finally{c.disabled=false}});
  d.querySelectorAll('[data-own]').forEach(b=>b.onclick=async()=>{try{await post(UI,'/ui/access/owner',{kind,id,agent:b.dataset.own});closeLayers();toast(data.agents.find(a=>a.id===b.dataset.own)?.name+' now owns '+it.label);reload()}catch(e){fail(e)}})}};
ACT['acc-open']=a=>Access.open(a.dataset.kind,a.dataset.id);
ACT['acc-use']=async a=>{a.disabled=true;const was=a.innerHTML;a.innerHTML='<span class="spinner tiny"></span>Sharing…';try{await post(UI,'/ui/access',{kind:a.dataset.kind,id:a.dataset.id,agent:viewing(),on:true});toast('Done · ready in about a minute');reload()}catch(e){a.disabled=false;a.innerHTML=was;fail(e)}};

// Connected apps, its Google accounts panel, Plugins and Keys: each gets the same groups
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{await base(p,el);if(S.me?.admin===false||(S.tab.mcp||'Your servers')!=='Your servers')return;
 const [m,g]=await Promise.all([Access.load('mcp'),Access.load('google')]);
 Access.group(el,'mcp',m,e=>[...e.querySelectorAll('.row[data-mcp]')],r=>r.dataset.mcp,(e,r)=>r.closest('.card.list'));
 if(g){const ag=viewing();for(const r of el.querySelectorAll('.gacc-row')){const i=[...el.querySelectorAll('.gacc-row')].indexOf(r);const x=(Pages._gacc||[])[i];const it=x&&g.items.find(y=>y.id===x.email);if(!it||r.dataset.acc)continue;r.dataset.acc='1';
  r.querySelector('.act')?.insertAdjacentHTML('afterbegin',Access.btn(it));if(it.owner!==ag)r.querySelector('.txt')?.insertAdjacentHTML('beforeend',Access.from(it))}}}}
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{await base(p,el);if(S.me?.admin===false||(S.tab.plugins||'Installed')!=='Installed')return;
 // plugins stay in their groups (model providers, browser…); each row gets who uses it, and the page may redraw itself
 const d=await Access.load('plugin');if(!d)return;const ag=viewing();
 const deco=()=>{for(const r of el.querySelectorAll('.row[data-pl]:not([data-acc])')){const it=d.items.find(x=>x.id===r.dataset.pl);r.dataset.acc='1';if(!it)continue;
  r.querySelectorAll('.share-box,.chip.access').forEach(x=>x.remove());r.querySelector('.act')?.insertAdjacentHTML('afterbegin',Access.btn(it));if(it.owner!==ag)r.querySelector('.txt')?.insertAdjacentHTML('beforeend',Access.from(it))}};
 deco();const mo=new MutationObserver(()=>{if(!el.isConnected||route().page?.id!=='plugins')return mo.disconnect();deco()});mo.observe(el,{childList:true,subtree:true})}}
{const base=PAGES.keys;PAGES.keys=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;const d=await Access.load('key');if(!d)return;const ag=viewing();
 for(const b of el.querySelectorAll('[data-act="key-edit"]')){const k=b.dataset.k;const it=d.items.find(x=>x.label===k&&x.users.some(u=>u.id===ag));if(!it)continue;const row=b.closest('.field')||b.parentElement;if(row.dataset.acc)continue;row.dataset.acc='1';
  b.parentElement.insertAdjacentHTML('afterbegin',it.bot?Access.who(it):Access.btn(it));if(it.owner!==ag)row.querySelector('label')?.insertAdjacentHTML('beforeend','<small>'+Access.from(it)+'</small>')}}}

// apps and plugins are shared through Access (owner and switches); the older copy-to badges stay for skills and schedules
{const d0=decorateRows;decorateRows=async(el,kind,rows)=>{if((kind==='mcp'||kind==='plugin')&&S.me?.admin!==false)return;return d0(el,kind,rows)}}
