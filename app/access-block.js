// The one "who can use this" block, shaped like a document's Share dialog (10 Nov 2026): a search box to add someone,
// then "Who has access" as a list (the owner first, everyone else with one menu on the right: their level, Make owner,
// Remove access), and where it applies "General access" (only those added, or every agent). It stays short with 100
// agents: only the ones with access are listed, and the rest are found by typing.
//  - mount(): changes wait for Save (skills), with what will happen said in words first
//  - live(): each change saves at once (a connection's agents, an n8n space, the people an agent is shared with)
const AccessBlock={
 and:x=>x.length<3?x.join(' and '):x.slice(0,-1).join(', ')+' and '+x.at(-1),
 // one row: avatar, name (and a note), and on the right the owner label or the menu
 row(x,{owner=false,levels=null,canOwner=false,locked=false}={},i=0){
  const lv=levels||{use:'Can use'},cur=x.level&&lv[x.level]?x.level:Object.keys(lv)[0];
  const right=owner?'<span class="ab-role">Owner</span>':locked?`<span class="ab-role">${esc(lv[cur])}</span>`
   :`<select class="ab-menu" data-id="${esc(x.id)}" aria-label="Access for ${esc(x.name)}">${Object.entries(lv).map(([k,v])=>`<option value="${k}" ${k===cur?'selected':''}>${esc(v)}</option>`).join('')}${canOwner?'<option value="@owner">Make owner</option>':''}<option value="@remove">Remove access</option></select>`;
  return `<div class="ab-item" data-id="${esc(x.id)}" ${st(i)}>${x.ava||agentAvatar(x.id,32,{title:false})}<span class="ab-who"><b>${esc(x.name)}</b>${x.note?`<small>${esc(x.note)}</small>`:''}</span>${right}</div>`},
 // the search box that adds: type to narrow, Enter or a click adds
 search(root,list,onPick,placeholder){const box=root.querySelector('.ab-find');if(!box)return;const inp=box.querySelector('input'),opts=box.querySelector('.ab-opts');
  const draw=()=>{const q=inp.value.trim().toLowerCase(),l=list().filter(a=>!q||(a.name+' '+(a.sub||'')).toLowerCase().includes(q)).slice(0,8);
   opts.hidden=document.activeElement!==inp||!list().length;opts.innerHTML=l.length?l.map((a,i)=>`<button type="button" role="option" data-id="${esc(a.id)}">${a.ava||agentAvatar(a.id,24,{title:false})}<span>${esc(a.name)}${a.sub?`<small>${esc(a.sub)}</small>`:''}</span></button>`).join(''):'<p class="hint">Nobody matches.</p>'};
  inp.placeholder=placeholder;inp.setAttribute('aria-label',placeholder);if(!list().length){inp.disabled=true;inp.placeholder='Everyone has access already'}
  inp.onfocus=inp.oninput=draw;inp.onblur=()=>setTimeout(()=>{opts.hidden=true},150);
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();opts.querySelector('[data-id]')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))}if(e.key==='Escape'){e.stopPropagation();inp.blur()}};
  opts.onmousedown=e=>{const b=e.target.closest('[data-id]');if(!b)return;e.preventDefault();inp.value='';opts.hidden=true;onPick(b.dataset.id)}},
 shell:general=>`<div class="ab-find"><input type="search" autocomplete="off"><div class="ab-opts" role="listbox" hidden></div></div>
  <div class="ab-lbl">Who has access</div><div class="ab-list"></div>${general?`<div class="ab-lbl">General access</div><div class="ab-general"></div>`:''}<p class="ab-eff" aria-live="polite"></p>`,
 // skills: o {owner, ownerNote, agents:[{id,name}], picked:[ids], every:bool, preview:async(list|null)=>{gain,lose}}
 mount(root,o){const nameOf=id=>o.agents.find(a=>a.id===id)?.name||ident(id).name||id;let every=!!o.every,picked=[...new Set((o.picked||[]).filter(id=>id!==o.owner))];
  root.classList.add('ab');root.innerHTML=this.shell(true);const eff=root.querySelector('.ab-eff');let seq=0,tm=0;
  const value=()=>every?null:[...picked];const left=()=>o.agents.filter(a=>a.id!==o.owner&&!picked.includes(a.id));
  const paint=()=>{root.querySelector('.ab-list').innerHTML=(o.owner?this.row({id:o.owner,name:nameOf(o.owner),note:o.ownerNote},{owner:true}):'')+picked.map((id,i)=>this.row({id,name:nameOf(id)},{},i+1)).join('')
    +(every?`<p class="ab-all">${icon('user',14)}Every other agent can use it too.</p>`:'');
   root.querySelector('.ab-general').innerHTML=`<select class="ab-gen" aria-label="General access"><option value="some" ${every?'':'selected'}>Only the agents above</option><option value="all" ${every?'selected':''}>Every agent, including new ones</option></select>`;
   root.querySelectorAll('.ab-menu').forEach(s=>s.onchange=()=>{if(s.value==='@remove'){picked=picked.filter(x=>x!==s.dataset.id);paint()}else s.value='use'});
   root.querySelector('.ab-gen').onchange=e=>{every=e.target.value==='all';paint()};clearTimeout(tm);tm=setTimeout(effect,180)};
  const effect=async()=>{if(!o.preview)return;const n=++seq;eff.classList.add('busy');try{const r=await o.preview(value());if(n!==seq)return;
    const say=[r.gain?.length?this.and(r.gain.map(nameOf))+(r.gain.length>1?' get ':' gets ')+'it now.':'',r.lose?.length?this.and(r.lose.map(nameOf))+(r.lose.length>1?' lose':' loses')+' it (kept in a backup, not deleted).':''].filter(Boolean).join(' ');
    eff.textContent=say||'Nothing changes.';eff.classList.toggle('warn',!!r.lose?.length)}catch(e){if(n===seq){eff.textContent=e.message;eff.classList.add('warn')}}finally{if(n===seq)eff.classList.remove('busy')}};
  this.search(root,left,id=>{picked.push(id);paint()},'Add agents');paint();return {value}},
 // o: {owner:{id,name,ava}, ownerNote, items:[{id,name,ava,level,note}], levels:{key:label}|null, choices:[{id,name,ava,sub}],
 //     search, hint, onAdd(id), onLevel(id,level), onRemove(id), onOwner(id)|null, locked (nothing can change)}
 live(root,o){root.classList.add('ab');const busy=on=>root.classList.toggle('ab-busy',on);
  const run=async fn=>{busy(true);try{await fn()}catch(e){fail(e)}finally{if(root.isConnected)busy(false)}};
  const others=(o.items||[]).filter(x=>x.id!==o.owner?.id);
  root.innerHTML=o.locked?'<div class="ab-lbl">Who has access</div><div class="ab-list"></div>'+(o.hint?'<p class="ab-eff">'+esc(o.hint)+'</p>':''):this.shell(false);
  root.querySelector('.ab-list').innerHTML=(o.owner?this.row(o.owner,{owner:true}):'')+others.map((x,i)=>this.row(x,{levels:o.levels,canOwner:!!o.onOwner,locked:o.locked},i+1)).join('')||'<p class="hint">Nobody yet.</p>';
  if(o.hint&&!o.locked)root.querySelector('.ab-eff').textContent=o.hint;
  root.querySelectorAll('.ab-menu').forEach(s=>{const was=s.value;s.onchange=()=>{const v=s.value,id=s.dataset.id;s.value=was;
   run(()=>v==='@remove'?o.onRemove(id):v==='@owner'?o.onOwner(id):o.onLevel?.(id,v))}});
  if(!o.locked)this.search(root,()=>o.choices||[],id=>run(()=>o.onAdd(id)),o.search||'Add agents')}};
