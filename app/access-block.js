// The one "who can use this" block (10 Nov 2026), the same on every sharing screen: who it belongs to (locked), Every
// agent or Only some agents, the agents as chips with an Add agent search instead of a wall of checkboxes, and before
// saving, in words, what will happen. Skills use it first; connections, plugins, n8n and people follow.
const AccessBlock={
 and:x=>x.length<3?x.join(' and '):x.slice(0,-1).join(', ')+' and '+x.at(-1),
 chip(a,{locked=false,note=''}={}){return `<span class="ab-chip${locked?' locked':''}" data-id="${esc(a.id)}">${agentAvatar(a.id,20,{title:false})}<b>${esc(a.name)}</b>${note?`<small>${esc(note)}</small>`:''}${locked?`<i aria-hidden="true">${icon('lock',12)}</i>`:`<button type="button" class="ab-x" data-rm="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">${icon('x',12)}</button>`}</span>`},
 // opts: {owner, ownerNote, agents:[{id,name}], picked:[ids], every:bool, noun, preview:async(list|null)=>{gain,lose}}
 mount(root,o){const nameOf=id=>o.agents.find(a=>a.id===id)?.name||ident(id).name||id;let every=!!o.every,picked=[...new Set((o.picked||[]).filter(id=>id!==o.owner))];
  root.classList.add('ab');
  root.innerHTML=`
   <div class="ab-row"><span class="ab-lbl">Who can use it</span><div class="ab-seg" role="radiogroup" aria-label="Who can use it"><button type="button" role="radio" data-m="all">Every agent</button><button type="button" role="radio" data-m="some">Only some agents</button></div></div>
   <div class="ab-some"><div class="ab-chips"></div></div><p class="ab-eff" aria-live="polite"></p>`;
  const chips=root.querySelector('.ab-chips'),eff=root.querySelector('.ab-eff'),some=root.querySelector('.ab-some');let seq=0,tm=0;
  const left=()=>o.agents.filter(a=>a.id!==o.owner&&!picked.includes(a.id));
  const paint=()=>{root.querySelectorAll('.ab-seg [data-m]').forEach(b=>{const on=(b.dataset.m==='all')===every;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))});some.classList.toggle('open',!every);
   chips.innerHTML=(o.owner?this.chip({id:o.owner,name:nameOf(o.owner)},{locked:true,note:o.ownerNote||''}):'')+picked.map(id=>this.chip({id,name:nameOf(id)})).join('')+(left().length?`<button type="button" class="ab-add">${icon('plus',14)}Add agent</button>`:'');
   clearTimeout(tm);tm=setTimeout(effect,180)};
  const effect=async()=>{if(!o.preview)return;const n=++seq;eff.classList.add('busy');try{const r=await o.preview(this.value());if(n!==seq)return;
    const say=[r.gain?.length?this.and(r.gain.map(nameOf))+(r.gain.length>1?' get ':' gets ')+'it now.':'',r.lose?.length?this.and(r.lose.map(nameOf))+(r.lose.length>1?' lose':' loses')+' it (kept in a backup, not deleted).':''].filter(Boolean).join(' ');
    eff.textContent=say||'Nothing changes.';eff.classList.toggle('warn',!!r.lose?.length)}catch(e){if(n===seq){eff.textContent=e.message;eff.classList.add('warn')}}finally{if(n===seq)eff.classList.remove('busy')}};
  root.querySelectorAll('.ab-seg [data-m]').forEach(b=>b.onclick=()=>{every=b.dataset.m==='all';paint()});
  chips.onclick=e=>{const rm=e.target.closest('[data-rm]');if(rm){picked=picked.filter(x=>x!==rm.dataset.rm);paint();return}
   const add=e.target.closest('.ab-add');if(add)this.pick(add,left(),id=>{picked.push(id);paint()})};
  this.value=()=>every?null:[...picked];paint();return {value:()=>every?null:[...picked]}},
 // the Add agent search: type to narrow, Enter or a click adds
 pick(anchor,list,onPick){$$('.ab-pop').forEach(x=>x.remove());const p=document.createElement('div');p.className='ab-pop';p.setAttribute('role','dialog');
  p.innerHTML=`<input type="search" placeholder="Search agents" aria-label="Search agents"><div class="ab-opts" role="listbox"></div>`;anchor.closest('.drawer,.ab')?.append(p);
  const r=anchor.getBoundingClientRect(),host=p.offsetParent?.getBoundingClientRect()||{left:0,top:0};p.style.left=Math.max(8,r.left-host.left)+'px';p.style.top=(r.bottom-host.top+6)+'px';
  const inp=p.querySelector('input'),opts=p.querySelector('.ab-opts');
  const draw=()=>{const q=inp.value.trim().toLowerCase(),l=list.filter(a=>!q||a.name.toLowerCase().includes(q));opts.innerHTML=l.length?l.map((a,i)=>`<button type="button" role="option" data-id="${esc(a.id)}" ${st(i)}>${agentAvatar(a.id,22,{title:false})}<span>${esc(a.name)}</span></button>`).join(''):'<p class="hint">No agent matches.</p>'};
  const done=()=>{p.remove();document.removeEventListener('pointerdown',out,true)};const out=e=>{if(!p.contains(e.target)&&e.target!==anchor)done()};
  opts.onclick=e=>{const b=e.target.closest('[data-id]');if(b){done();onPick(b.dataset.id)}};
  inp.oninput=draw;inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();opts.querySelector('[data-id]')?.click()}if(e.key==='Escape'){e.stopPropagation();done();anchor.focus()}};
  draw();setTimeout(()=>document.addEventListener('pointerdown',out,true));inp.focus()}};
