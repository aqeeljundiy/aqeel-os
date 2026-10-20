/* ---------- Notifications in the corner: one system for everything (a schedule finished or failed, a channel
   dropped, a setup finished…). They slide in, count as read after a few seconds in view, leave by themselves
   after a few minutes (hovering keeps them), and stack neatly: only the newest shows, the older ones fold into "+N more". ---------- */
const Notices={max:1,box(){let b=document.querySelector('.cron-pops');if(!b){b=document.createElement('div');b.className='cron-pops';b.setAttribute('aria-live','polite');document.body.append(b)}return b},
 // o: {icon, kind:'blue'|'warn'|'ok', title, text, actions:[{label, go | act+data | run, primary}], key, life (ms), onClose}
 show(o){const b=this.box();if(o.key&&b.querySelector('.cron-pop[data-k="'+CSS.escape(o.key)+'"]'))return null;
  const n=document.createElement('div');n.className='cron-pop unread';if(o.key)n.dataset.k=o.key;n.setAttribute('role','status');
  n.innerHTML=`<span class="ic ${o.kind||'blue'}">${icon(o.icon||'clock',16)}</span><div class="txt"><b>${esc(o.title||'')}</b>${o.text?`<span>${esc(String(o.text).slice(0,180))}</span>`:''}</div>${(o.actions||[]).map((a,i)=>`<button class="ghost np-act" data-i="${i}" ${a.go?`data-go="${esc(a.go)}"`:''}>${esc(a.label)}</button>`).join('')}<button class="ghost icon np-x" aria-label="Close">${icon('x',14)}</button>`;
  let left=o.life||180000,start=Date.now(),t=null;const pause=()=>{clearTimeout(t);left-=Date.now()-start},resume=()=>{start=Date.now();clearTimeout(t);t=setTimeout(()=>bye(),Math.max(1500,left))};
  const bye=()=>{clearTimeout(t);if(!n.isConnected)return;n.classList.add('out');setTimeout(()=>{n.remove();this.fold()},280);o.onClose?.()};
  n.querySelector('.np-x').onclick=bye;n.querySelectorAll('.np-act').forEach(x=>x.addEventListener('click',()=>{const a=o.actions[+x.dataset.i];try{a.run?.()}finally{bye()}}));
  n.onmouseenter=pause;n.onmouseleave=resume;n.onfocusin=pause;n.onfocusout=resume;
  b.append(n);resume();
  // read once it has been on screen for a few seconds while you are here
  const read=()=>setTimeout(()=>{if(document.hidden)return document.addEventListener('visibilitychange',read,{once:true});if(!n.isConnected||n.classList.contains('folded'))return;n.classList.remove('unread');o.onRead?.()},5000);read();
  this.fold();try{if(document.hidden&&'Notification' in window&&Notification.permission==='granted')new Notification(o.title||'aqeelOS',{body:String(o.text||'').slice(0,120)})}catch{}
  return n},
 fold(){const b=document.querySelector('.cron-pops');if(!b)return;const all=[...b.querySelectorAll('.cron-pop:not(.out)')];const open=b.classList.contains('all');
  all.forEach((n,i)=>n.classList.toggle('folded',!open&&i<all.length-this.max));let m=b.querySelector('.np-more');const hidden=open?0:Math.max(0,all.length-this.max);
  if(hidden){if(!m){m=document.createElement('button');m.className='np-more';m.onclick=()=>{b.classList.add('all');this.fold()};b.prepend(m)}m.textContent='+'+hidden+' more'}else{m?.remove();if(all.length<=this.max)b.classList.remove('all')}}};

/* ---------- The bell: every notification is kept (newest first, 150 at most) and synced to your account, so
   nothing is lost when a pop-up leaves. The panel on the right lists them, read or unread, each with its action. ---------- */
const Inbox={key:'hui-inbox',
 all(){return store.get('inbox',[])},save(l){store.set('inbox',l.slice(0,60));this.paintBell()},
 add(o){const l=this.all();const it={id:(o.key?o.key+(o.repeat===false?'':'@'+Math.floor(Date.now()/3600e3)):'')||('n'+Date.now()+Math.random().toString(36).slice(2,6)),t:Date.now(),icon:o.icon||'clock',kind:o.kind||'blue',title:o.title||'',text:String(o.text||'').slice(0,200),go:(o.actions||[]).find(a=>a.go)?.go||o.go||'',label:(o.actions||[])[0]?.label||'Open',read:false};
  if(l.some(x=>x.id===it.id))return it.id;l.unshift(it);this.save(l);if($('.drawer.inbox'))this.paintList();return it.id},
 read(id){const l=this.all();const x=l.find(y=>y.id===id);if(x&&!x.read){x.read=true;this.save(l)}},
 unread(){return this.all().filter(x=>!x.read).length},
 paintBell(){const n=this.unread();$$('[data-act="inbox"]').forEach(b=>{if(b.dataset.n===String(n))return;b.dataset.n=String(n);b.classList.toggle('has',n>0);const c=b.querySelector('.bell-n');if(c)c.textContent=n>99?'99+':String(n);b.setAttribute('aria-label',n?n+' unread notifications':'Notifications')})},
 open(){const d=sideDrawer('Notifications','<div class="inbox-bar"><button class="ghost small" data-ib="read">'+icon('check',14)+'Mark all read</button><button class="ghost small" data-ib="clear">'+icon('trash',14)+'Clear read</button></div><div id="inboxList"></div>','');d.classList.add('inbox');
  d.addEventListener('click',e=>{const b=e.target.closest('[data-ib]');if(b){const l=this.all();if(b.dataset.ib==='read')l.forEach(x=>x.read=true);this.save(b.dataset.ib==='clear'?l.filter(x=>!x.read):l);this.paintList();return}
   const it=e.target.closest('[data-inbox]');if(!it)return;const x=this.all().find(y=>y.id===it.dataset.inbox);if(!x)return;this.read(x.id);if(e.target.closest('[data-ib-x]')){this.save(this.all().filter(y=>y.id!==x.id));this.paintList();return}
   if(x.go){closeLayers();go(x.go)}else this.paintList()});
  this.paintList()},
 paintList(){const el=$('#inboxList');if(!el)return;const l=this.all();
  if(!l.length){el.innerHTML='<div class="inbox-empty">'+icon('check',22)+'<b>All caught up</b><span>Schedules, channels and agents tell you here when something happens.</span></div>';return}
  const day=t=>{const d=new Date(t),n=new Date();const y=new Date(n-864e5);return d.toDateString()===n.toDateString()?'Today':d.toDateString()===y.toDateString()?'Yesterday':d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'short'})};
  let last='';el.innerHTML=l.map((x,i)=>{const h=day(x.t);const head=h!==last?'<div class="group-label">'+esc(h)+'</div>':'';last=h;
   return head+`<div class="ib-item ${x.read?'':'unread'}" data-inbox="${esc(x.id)}" ${st(Math.min(i,10))} tabindex="0"><span class="ic ${esc(x.kind)}">${icon(x.icon,15)}</span><div class="txt"><b>${esc(x.title)}</b>${x.text?`<span>${esc(x.text)}</span>`:''}<small>${esc(new Date(x.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}${x.go?' · '+esc(x.label):''}</small></div><button class="ghost icon ib-x" data-ib-x aria-label="Remove">${icon('x',13)}</button></div>`}).join('')}};
// every pop-up also lands in the inbox, and reading it in either place counts
{const show=Notices.show.bind(Notices);Notices.show=o=>{const id=Inbox.add(o);const n=show({...o,onRead:()=>Inbox.read(id),onClose:()=>{o.onClose?.()}});return n}}

// Undo instead of "are you sure?": things that can be put back happen at once, with Undo in the message for 8 seconds
function toastUndo(msg,undo){const t=document.createElement('div');t.className='toast undo';t.innerHTML=icon('check',15)+'<span>'+esc(msg)+'</span><button class="ghost small">Undo</button>';$('#toasts').append(t);
 let done=false;const bye=()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)};const tm=setTimeout(bye,8000);
 t.querySelector('button').onclick=async()=>{if(done)return;done=true;clearTimeout(tm);bye();try{await undo();toast('Undone')}catch(e){fail(e)}}}
