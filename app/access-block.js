// The one "who can use this" block (10 Nov 2026), the same on every sharing screen: who owns it (locked), then the
// agents or people who can use it as chips, with an Add search instead of a wall of checkboxes or switches.
//  - mount(): pick, then Save (skills: Every agent or Only some agents, and before saving, in words, what will happen)
//  - live(): each change saves at once (a connection's agents, the people an agent is shared with)
const AccessBlock={
 and:x=>x.length<3?x.join(' and '):x.slice(0,-1).join(', ')+' and '+x.at(-1),
 // a: {id,name,ava?}; ava is any avatar html (people), else the agent's own
 chip(a,{locked=false,note='',level='',levels=null,ask=false}={}){
  const lv=levels&&!locked?`<select class="ab-lv" data-lv="${esc(a.id)}" aria-label="What ${esc(a.name)} may do">${Object.entries(levels).map(([k,v])=>`<option value="${k}" ${k===level?'selected':''}>${esc(v)}</option>`).join('')}</select>`:'';
  return `<span class="ab-chip${locked?' locked':''}${ask?' ask':''}" data-id="${esc(a.id)}"${ask?` role="button" tabindex="0" title="Options for ${esc(a.name)}"`:''}>${a.ava||agentAvatar(a.id,20,{title:false})}<b>${esc(a.name)}</b>${note?`<small>${esc(note)}</small>`:''}${lv}${locked?`<i aria-hidden="true">${icon('lock',12)}</i>`:`<button type="button" class="ab-x" data-rm="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">${icon('x',12)}</button>`}</span>`},
 // o: {owner, ownerNote, agents:[{id,name}], picked:[ids], every:bool, preview:async(list|null)=>{gain,lose}}
 mount(root,o){const nameOf=id=>o.agents.find(a=>a.id===id)?.name||ident(id).name||id;let every=!!o.every,picked=[...new Set((o.picked||[]).filter(id=>id!==o.owner))];
  root.classList.add('ab');
  root.innerHTML=`<div class="ab-row"><span class="ab-lbl">Who can use it</span><div class="ab-seg" role="radiogroup" aria-label="Who can use it"><button type="button" role="radio" data-m="all">Every agent</button><button type="button" role="radio" data-m="some">Only some agents</button></div></div>
   <div class="ab-some"><div class="ab-chips"></div></div><p class="ab-eff" aria-live="polite"></p>`;
  const chips=root.querySelector('.ab-chips'),eff=root.querySelector('.ab-eff'),some=root.querySelector('.ab-some');let seq=0,tm=0;
  const left=()=>o.agents.filter(a=>a.id!==o.owner&&!picked.includes(a.id));
  const value=()=>every?null:[...picked];
  const paint=()=>{root.querySelectorAll('.ab-seg [data-m]').forEach(b=>{const on=(b.dataset.m==='all')===every;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});some.classList.toggle('open',!every);
   chips.innerHTML=(o.owner?this.chip({id:o.owner,name:nameOf(o.owner)},{locked:true,note:o.ownerNote||''}):'')+picked.map(id=>this.chip({id,name:nameOf(id)})).join('')+(left().length?`<button type="button" class="ab-add">${icon('plus',14)}Add agent</button>`:'');
   clearTimeout(tm);tm=setTimeout(effect,180)};
  const effect=async()=>{if(!o.preview)return;const n=++seq;eff.classList.add('busy');try{const r=await o.preview(value());if(n!==seq)return;
    const say=[r.gain?.length?this.and(r.gain.map(nameOf))+(r.gain.length>1?' get ':' gets ')+'it now.':'',r.lose?.length?this.and(r.lose.map(nameOf))+(r.lose.length>1?' lose':' loses')+' it (kept in a backup, not deleted).':''].filter(Boolean).join(' ');
    eff.textContent=say||'Nothing changes.';eff.classList.toggle('warn',!!r.lose?.length)}catch(e){if(n===seq){eff.textContent=e.message;eff.classList.add('warn')}}finally{if(n===seq)eff.classList.remove('busy')}};
  root.querySelectorAll('.ab-seg [data-m]').forEach(b=>b.onclick=()=>{every=b.dataset.m==='all';paint()});
  chips.onclick=e=>{const rm=e.target.closest('[data-rm]');if(rm){picked=picked.filter(x=>x!==rm.dataset.rm);paint();return}
   const add=e.target.closest('.ab-add');if(add)this.pick(add,left(),id=>{picked.push(id);paint()})};
  paint();return {value}},
 // o: {owner:{id,name,ava}, ownerNote, items:[{id,name,ava,level,note}], levels:{key:label}|null, choices:[{id,name,ava,sub}],
 //     addLabel, search, hint, onAdd(id), onLevel(id,level), onRemove(id), onOwner(id)|null, locked (nothing can change)}
 live(root,o){root.classList.add('ab');const busy=on=>root.classList.toggle('ab-busy',on);
  const run=async fn=>{busy(true);try{await fn()}catch(e){fail(e)}finally{if(root.isConnected)busy(false)}};
  const others=(o.items||[]).filter(x=>x.id!==o.owner?.id);
  root.innerHTML='<div class="ab-chips">'+(o.owner?this.chip(o.owner,{locked:true,note:o.ownerNote||'Owner'}):'')
   +others.map(x=>o.locked?this.chip(x,{locked:true,note:x.note||o.levels?.[x.level]||''}):this.chip(x,{note:x.note||'',level:x.level,levels:o.levels,ask:!!o.onOwner})).join('')
   +(!o.locked&&(o.choices||[]).length?'<button type="button" class="ab-add">'+icon('plus',14)+esc(o.addLabel||'Add agent')+'</button>':'')
   +'</div>'+(o.hint?'<p class="ab-eff">'+esc(o.hint)+'</p>':'');
  root.querySelectorAll('.ab-lv').forEach(s=>s.onchange=()=>run(()=>o.onLevel(s.dataset.lv,s.value)));
  root.querySelectorAll('[data-rm]').forEach(b=>b.onclick=e=>{e.stopPropagation();run(()=>o.onRemove(b.dataset.rm))});
  if(o.onOwner)root.querySelectorAll('.ab-chip.ask').forEach(c=>{const open=e=>{if(e.target.closest('.ab-x,.ab-lv'))return;const it=others.find(x=>x.id===c.dataset.id);
   menu(c,[{header:it?.name||''},{label:'Make owner',icon:'crown',run:()=>run(()=>o.onOwner(c.dataset.id))}])};c.onclick=open;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(e)}}});
  root.querySelector('.ab-add')?.addEventListener('click',e=>this.pick(e.currentTarget,o.choices,id=>run(()=>o.onAdd(id)),o.search||'Search agents'))},
 // the Add search: type to narrow, Enter or a click adds
 pick(anchor,list,onPick,placeholder='Search agents'){$$('.ab-pop').forEach(x=>x.remove());const p=document.createElement('div');p.className='ab-pop';p.setAttribute('role','dialog');
  p.innerHTML=`<input type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"><div class="ab-opts" role="listbox"></div>`;(anchor.closest('.drawer-body')||anchor.closest('.ab')||document.body).append(p);
  const r=anchor.getBoundingClientRect(),host=p.offsetParent?.getBoundingClientRect()||{left:0,top:0},sc=p.offsetParent;p.style.left=Math.max(8,r.left-host.left)+'px';p.style.top=(r.bottom-host.top+(sc?.scrollTop||0)+6)+'px';
  const inp=p.querySelector('input'),opts=p.querySelector('.ab-opts');
  const draw=()=>{const q=inp.value.trim().toLowerCase(),l=list.filter(a=>!q||(a.name+' '+(a.sub||'')).toLowerCase().includes(q));
   opts.innerHTML=l.length?l.map((a,i)=>`<button type="button" role="option" data-id="${esc(a.id)}" ${st(i)}>${a.ava||agentAvatar(a.id,22,{title:false})}<span>${esc(a.name)}${a.sub?`<small>${esc(a.sub)}</small>`:''}</span></button>`).join(''):'<p class="hint">Nobody matches.</p>'};
  const done=()=>{p.remove();document.removeEventListener('pointerdown',out,true)};const out=e=>{if(!p.contains(e.target)&&e.target!==anchor)done()};
  opts.onclick=e=>{const b=e.target.closest('[data-id]');if(b){done();onPick(b.dataset.id)}};
  inp.oninput=draw;inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();opts.querySelector('[data-id]')?.click()}if(e.key==='Escape'){e.stopPropagation();done();anchor.focus()}};
  draw();setTimeout(()=>document.addEventListener('pointerdown',out,true));inp.focus()}};
