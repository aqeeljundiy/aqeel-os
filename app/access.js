// Access on every connection page: for the agent you are showing, what it owns and what other agents share with it,
// who else uses each connection, and "Who can use" (one switch per agent, the owner always on). Admins change it;
// members see the same Belongs to and Used by, read-only.
const Access={
 async load(kind){try{return await UI('/ui/access?kind='+kind)}catch{return null}},
 av(a,sz=22){const id=a.id||a;return agentAvatar(id,sz,{cls:'acc-av',name:a.name||ident(id).name})},   // the one agent avatar; acc-av only adds the stacked ring
 who(it){return `<span class="acc-who" aria-label="Used by ${esc(it.users.map(u=>u.name).join(', '))}">${it.users.slice(0,5).map(u=>this.av(u)).join('')}${it.users.length>5?`<span class="acc-more">+${it.users.length-5}</span>`:''}</span>`},
 from(it){return it.own?`<span class="acc-from">Belongs to ${esc(it.ownerName)} · ${esc(it.ownNote)}</span>`:`<span class="acc-from">${this.av({id:it.owner,name:it.ownerName},16)}Belongs to ${esc(it.ownerName)}</span>`},
 // "Belongs to": one control on every row of every page. A picker for admins where ownership can move, else the name;
 // a connection with no owner agent (n8n: every agent has its own user) names who owns the service, with why
 owner(it,agents=[],edit=false){const l='<span class="ab-lbl">Belongs to</span>',n=it.ownerName||ident(it.owner).name;
  return `<span class="acc-ownbox">${it.own?`${l}<b class="acc-owner-name" title="${esc(it.ownNote)}">${esc(n)}</b>${it.ownNote?`<small class="acc-own-note">${esc(it.ownNote)}</small>`:''}`:edit&&!it.bot&&agents.length>1?`${l}<select class="acc-owner" style="width:auto" data-kind="${it.kind}" data-id="${esc(it.id)}" data-was="${esc(it.owner)}" aria-label="Owner of ${esc(it.label)}">${agents.map(a=>`<option value="${esc(a.id)}" ${a.id===it.owner?'selected':''}>${esc(a.name)}</option>`).join('')}</select>`:`${l}<b class="acc-owner-name">${esc(n)}</b>`}</span>`},
 // a new owner: it gets the connection first if it did not have it yet
 bindOwners(el){el.querySelectorAll('select.acc-owner:not([data-bound])').forEach(s=>{s.dataset.bound='1';s.onchange=async()=>{const to=s.value,was=s.dataset.was,kind=s.dataset.kind,id=s.dataset.id;s.disabled=true;
  const d=await this.load(kind);const it=d?.items.find(x=>x.id===id);if(it&&!await this.moveOk(it,to)){s.value=was;s.disabled=false;return}
  try{if(it&&!it.users.some(u=>u.id===to))await post(UI,'/ui/access',{kind,id,agent:to,on:true});await post(UI,'/ui/access/owner',{kind,id,agent:to});s.dataset.was=to;toast(ident(to).name+' now owns '+(it?.label||id));reload()}catch(e){s.value=was;fail(e);reload()}finally{s.disabled=false}}})},   // a grant that went through before the owner change failed shows after the reload
 // "Used by": the one component for who uses a thing. attrs: what pressing it opens (Who can use by default).
 // copies (skills: each agent keeps its own copy): the first agent leads without the owner's crown. The count is always
 // the others ("+2"), or "Only <name>" when nobody else has it.
 btn(it,attrs){const lead=it.owner||it.users[0]?.id,ln=ident(lead).name||it.ownerName||lead,names=it.users.map(u=>u.name).join(', '),tip=it.copies?'Used by '+names+'. Share with other agents':'Belongs to '+ln+'. Who can use '+it.label;
  return `<button class="ghost small acc-btn" ${attrs||`data-act="acc-open" data-kind="${it.kind}" data-id="${esc(it.id)}"`} title="${esc(tip)}" aria-label="${esc(tip)}: ${esc(names)}">${it.copies?`<span class="acc-own">${this.av({id:lead,name:ln})}<b>${esc(ln)}</b></span>`:`<span class="acc-own" title="Owner: ${esc(ln)}">${this.av({id:lead,name:ln})}<i>${icon('crown',9)}</i><b>${esc(ln)}</b></span>`}${this.who({...it,users:it.users.filter(u=>u.id!==lead)})}<span>${it.users.length>1?'+'+(it.users.length-1):'Only '+esc(ln)}</span></button>`},
 // put the rows of a list into "Belongs to" and "Shared with" groups, and add who uses each
 group(el,kind,data,rowsOf,idOf,where){if(!data)return;const ag=viewing();const me=ident(ag).name;const by=new Map(data.items.map(x=>[x.id,x]));
  const rows=rowsOf(el).filter(r=>by.has(idOf(r)));if(!rows.length)return;
  const own=[],shared=[];for(const r of rows){const it=by.get(idOf(r));if(r.dataset.acc)continue;r.dataset.acc='1';
   const act=r.querySelector('.act');act?.insertAdjacentHTML('afterbegin',this.owner(it,data.agents,data.canEdit)+(data.canEdit?this.btn(it):this.who(it)));r.querySelectorAll('.share-box,.chip.access').forEach(x=>x.remove());
   r.querySelector('[data-act="mcp-share"]')?.remove();
   if(it.owner!==ag){r.querySelector('.txt')?.insertAdjacentHTML('beforeend',this.from(it));
    const mine=it.users.find(u=>u.id===ag);if(data.canEdit&&mine&&!mine.signed&&it.ownerSigned)act?.insertAdjacentHTML('afterbegin',`<button class="small acc-use" data-act="acc-use" data-kind="${kind}" data-id="${esc(it.id)}" data-label="${esc(it.label)}">Use ${esc(it.ownerName)}’s sign-in</button>`);
    shared.push(r)}else own.push(r)}
  const host=where(el,rows[0]);if(!host)return;
  const mk=(title,list)=>{if(!list.length)return null;const g=document.createElement('div');g.className='acc-group';g.innerHTML=`<div class="acc-grp">${title}</div><div class="card list"></div>`;list.forEach(r=>g.lastChild.append(r));return g};
  const a=mk('Belongs to '+esc(me),own),b=mk('Shared with '+esc(me),shared);host.replaceWith(...[a,b].filter(Boolean));this.bindOwners(el)},
 // the owner and Used by decoration did not load: one line with Try again above the list, instead of rows quietly without them
 failed(el,what){if(!el.isConnected||el.querySelector('.acc-fail'))return;const t=el.querySelector('.tabs,[role=tablist]');const h=errLine(what,'','acc-fail');t?t.insertAdjacentHTML('afterend',h):el.insertAdjacentHTML('afterbegin',h)},
 async open(kind,id){const data=await this.load(kind);const it=data?.items.find(x=>x.id===id);if(!it)return toast('That connection is gone. Reload the page.','err');
  const what={mcp:'with the same sign-in',google:'with the same Google sign-in',plugin:'turned on',key:'with the same value (still hidden)'}[kind];
  const d=drawer('Who can use '+it.label,`<p class="hint" style="margin:0 0 14px">${it.bot?'A chat bot answers as one agent only, so it can’t be shared.':`Adding an agent gives it ${esc(it.label)} ${what}; removing it takes it away. ${kind==='google'?'It works straight away.':'The agents restart by themselves once nobody is mid-reply.'} To hand it over, choose Make owner next to an agent.`}</p><div class="ab-host"></div>`,`<button class="primary" data-act="close">Done</button>`);
  let changed=false;const mo=new MutationObserver(()=>{if(!d.isConnected){mo.disconnect();if(changed)reload()}});mo.observe(document.body,{childList:true,subtree:true});
  const nm=a=>data.agents.find(x=>x.id===a)?.name||ident(a).name;
  const draw=async fresh=>{if(fresh){const dd=await this.load(kind);const cur=dd?.items.find(x=>x.id===id);if(cur)Object.assign(it,cur)}const host=d.querySelector('.ab-host');if(!host)return;
   AccessBlock.live(host,{owner:{id:it.owner,name:nm(it.owner)},ownerNote:'Owner',locked:!!it.bot,
    items:it.users.map(u=>({id:u.id,name:u.name||nm(u.id),note:u.signed?'':'needs sign-in'})),
    choices:data.agents.filter(a=>a.id!==it.owner&&!it.users.some(u=>u.id===a.id)).map(a=>({id:a.id,name:a.name})),
    onAdd:async a=>{await post(UI,'/ui/access',{kind,id,agent:a,on:true});changed=true;toast(it.label+' on for '+nm(a)+(kind==='google'?' · works at once':' · ready in about a minute'));await draw(true)},
    // taking a sign-in away removes that agent's copy: asked first, like every other Remove
    onRemove:async a=>{const u=it.users.find(x=>x.id===a);if(u?.signed&&(kind==='mcp'||kind==='google')&&!await confirmBox('Take '+it.label+' from '+nm(a)+'?','Its sign-in on '+nm(a)+' is removed. '+nm(a)+' can’t use '+it.label+' until it is added here again.','Take it away'))return;
     await post(UI,'/ui/access',{kind,id,agent:a,on:false});changed=true;toast(it.label+' removed from '+nm(a));await draw(true)},
    onOwner:async a=>{if(!await this.moveOk(it,a))return;await post(UI,'/ui/access/owner',{kind,id,agent:a});closeLayers();toast(nm(a)+' now owns '+it.label);reload()}})};
  draw()},
 // a new owner, asked the same way everywhere (the Channels wording): its sign-in goes along, and it gets the thing first if it has none
 moveOk(it,to){const n=ident(to).name,has=it.users.some(u=>u.id===to);return confirmBox('Move this to '+n+'?',has?'Its sign-in goes along: '+n+' owns '+it.label+' from now on and decides who else can use it.':n+' gets '+it.label+' first, with the same sign-in, then owns it from now on.','Move',false)},
 // removing a connection from one agent: the owner's copy goes only once nobody else uses it (hand it over first);
 // another agent's copy is taken away the way the Who can use switch does it (its sign-in files too). false: not shared
 async removeShared(kind,match,agent){const d=await this.load(kind);const it=d?.items.find(x=>(typeof match==='function'?match(x):x.id===match)&&x.users.some(u=>u.id===agent));if(!it||it.own||it.users.length<2)return false;
  if(agent===it.owner)throw new Error(ident(agent).name+' owns '+it.label+' and '+it.users.filter(u=>u.id!==agent).map(u=>u.name).join(', ')+' also '+(it.users.length>2?'use':'uses')+' it. Make another agent the owner first (Who can use), or turn it off for them.');
  if(S.me?.admin===false)return false;await post(UI,'/ui/access',{kind,id:it.id,agent,on:false});return true}};   // a member removes its own copy directly
ACT['acc-open']=a=>Access.open(a.dataset.kind,a.dataset.id);
ACT['acc-use']=async a=>{a.disabled=true;const was=a.innerHTML;a.innerHTML='<span class="spinner tiny"></span>Sharing…';try{await post(UI,'/ui/access',{kind:a.dataset.kind,id:a.dataset.id,agent:viewing(),on:true});toast((a.dataset.label||'It')+' on for '+ident(viewing()).name+' · ready in about a minute');reload()}catch(e){a.disabled=false;a.innerHTML=was;fail(e)}};

// Connected apps, its Google accounts panel, Plugins and Keys: each gets the same groups
// members get the same decoration, read-only: Belongs to as a name and who uses it (no switches, nothing that would be refused)
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if((S.tab.mcp||'Your servers')!=='Your servers')return;
 const [m,g]=await Promise.all([Access.load('mcp'),Access.load('google')]);if(gone())return;if(!m&&(Pages._mcp||[]).length||!g&&(Pages._gacc||[]).length)Access.failed(el,'who owns and uses each connection');
 Access.group(el,'mcp',m,e=>[...e.querySelectorAll('.row[data-mcp]')],r=>r.dataset.mcp,(e,r)=>r.closest('.card.list'));
 if(g){const ag=viewing();for(const r of el.querySelectorAll('.gacc-row')){const i=[...el.querySelectorAll('.gacc-row')].indexOf(r);const x=(Pages._gacc||[])[i];const it=x&&g.items.find(y=>y.id===x.email);if(!it||r.dataset.acc)continue;r.dataset.acc='1';
  r.querySelector('.act')?.insertAdjacentHTML('afterbegin',Access.owner(it,g.agents,g.canEdit)+(g.canEdit?Access.btn(it):Access.who(it)));if(it.owner!==ag)r.querySelector('.txt')?.insertAdjacentHTML('beforeend',Access.from(it))}Access.bindOwners(el)}}}
{const base=PAGES.plugins;PAGES.plugins=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if((S.tab.plugins||'Installed')!=='Installed')return;
 // plugins stay in their groups (model providers, browser…); each row gets who uses it, and the page may redraw itself
 const d=await Access.load('plugin');if(gone())return;if(!d)return Access.failed(el,'who owns and uses each plugin');const ag=viewing();
 const deco=()=>{for(const r of el.querySelectorAll('.row[data-pl]:not([data-acc])')){const it=d.items.find(x=>x.id===r.dataset.pl);r.dataset.acc='1';if(!it)continue;
  r.querySelectorAll('.share-box,.chip.access').forEach(x=>x.remove());r.querySelector('.act')?.insertAdjacentHTML('afterbegin',Access.owner(it,d.agents,d.canEdit)+(d.canEdit?Access.btn(it):Access.who(it)));if(it.owner!==ag)r.querySelector('.txt')?.insertAdjacentHTML('beforeend',Access.from(it))}Access.bindOwners(el)};
 deco();const mo=new MutationObserver(()=>{if(!el.isConnected||route().page?.id!=='plugins')return mo.disconnect();deco()});mo.observe(el,{childList:true,subtree:true})}}
{const base=PAGES.keys;PAGES.keys=async(p,el)=>{const gone=pageTok(el);await base(p,el);if(gone())return;if(S.me?.admin===false)return;const d=await Access.load('key');if(gone())return;if(!d)return Access.failed(el,'who owns and uses each key');const ag=viewing();
 for(const b of el.querySelectorAll('[data-act="key-edit"]')){const k=b.dataset.k;const it=d.items.find(x=>x.label===k&&x.users.some(u=>u.id===ag));if(!it)continue;const row=b.closest('.field')||b.parentElement;if(row.dataset.acc)continue;row.dataset.acc='1';
  b.parentElement.insertAdjacentHTML('afterbegin',Access.owner(it,d.agents,d.canEdit)+(it.bot?Access.who(it):Access.btn(it)));if(it.owner!==ag)row.querySelector('label')?.insertAdjacentHTML('beforeend','<small>'+Access.from(it)+'</small>')}Access.bindOwners(el)}}

// apps and plugins are shared through Access (owner and switches); the older copy-to badges stay for skills and schedules
{const d0=decorateRows;decorateRows=async(el,kind,rows)=>{if((kind==='mcp'||kind==='plugin')&&S.me?.admin!==false)return;return d0(el,kind,rows)}}
