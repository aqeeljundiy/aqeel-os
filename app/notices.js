/* ---------- Notifications in the corner: one system for everything (a schedule finished or failed, a channel
   dropped, a setup finished…). They slide in, count as read after a few seconds in view, leave by themselves
   after a few minutes (hovering keeps them), and stack neatly: only the newest shows, the older ones fold into "+N more". ---------- */
const Notices={max:1,box(){let b=document.querySelector('.cron-pops');if(!b){b=document.createElement('div');b.className='cron-pops';b.setAttribute('aria-live','polite');document.body.append(b)}return b},
 // o: {icon, kind:'blue'|'warn'|'ok', title, text, actions:[{label, go | act+data | run, primary}], key, life (ms), onClose}
 show(o){const b=this.box();if(o.key&&b.querySelector('.cron-pop[data-k="'+CSS.escape(o.key)+'"]'))return null;
  const n=document.createElement('div');n.className='cron-pop unread';if(o.key)n.dataset.k=o.key;n.setAttribute('role','status');
  n.innerHTML=`<span class="ic ${o.kind||'blue'}">${icon(o.icon||'clock',16)}</span><div class="txt"><b>${esc(o.title||'')}</b>${o.text?`<span>${esc(noThink(o.text).slice(0,180))}</span>`:''}</div>${(o.actions||[]).map((a,i)=>`<button class="ghost np-act" data-i="${i}" ${a.go?`data-go="${esc(a.go)}"`:''}>${esc(a.label)}</button>`).join('')}<button class="ghost icon np-x" aria-label="Close">${icon('x',14)}</button>`;
  let left=o.life||180000,start=Date.now(),t=null;const pause=()=>{clearTimeout(t);left-=Date.now()-start},resume=()=>{start=Date.now();clearTimeout(t);t=setTimeout(()=>bye(),Math.max(1500,left))};
  const bye=()=>{clearTimeout(t);if(!n.isConnected)return;n.classList.add('out');setTimeout(()=>{n.remove();this.fold()},280);o.onClose?.()};
  n.querySelector('.np-x').onclick=bye;n.querySelectorAll('.np-act').forEach(x=>x.addEventListener('click',()=>{const a=o.actions[+x.dataset.i];try{a.run?.()}finally{bye()}}));
  n.onmouseenter=pause;n.onmouseleave=resume;n.onfocusin=pause;n.onfocusout=resume;
  b.append(n);resume();
  // read once it has been on screen for a few seconds while you are here
  const read=()=>setTimeout(()=>{if(document.hidden)return document.addEventListener('visibilitychange',read,{once:true});if(!n.isConnected||n.classList.contains('folded'))return;n.classList.remove('unread');o.onRead?.()},5000);read();
  this.fold();try{if(document.hidden&&'Notification' in window&&Notification.permission==='granted')new Notification(o.title||'aqeelOS',{body:noThink(o.text).slice(0,120)})}catch{}
  return n},
 fold(){const b=document.querySelector('.cron-pops');if(!b)return;const all=[...b.querySelectorAll('.cron-pop:not(.out)')];const open=b.classList.contains('all');
  all.forEach((n,i)=>n.classList.toggle('folded',!open&&i<all.length-this.max));let m=b.querySelector('.np-more');const hidden=open?0:Math.max(0,all.length-this.max);
  if(hidden){if(!m){m=document.createElement('button');m.className='np-more';m.onclick=()=>{b.classList.add('all');this.fold()};b.prepend(m)}m.textContent='+'+hidden+' more'}else{m?.remove();if(all.length<=this.max)b.classList.remove('all')}}};

/* ---------- The bell (1 Nov 2026): history and news, what happened or got done and needs nobody (a schedule finished,
   a tool server works again, the agents restarted for a moment). What needs someone is in Bottlenecks only: a failed
   schedule, a channel that logged out or a sign-in that is due still pops up, but its place is Bottlenecks, not this
   list. The list is on the server (news.mjs), so it is the same on every device; read and cleared are per person. ---------- */
const Inbox={items:[],ids:{},
 // to-dos that live in Bottlenecks (their pop-ups come from people.js and mcp-share.js), and the usage-stats question (boot.js)
 todo:o=>!!o.todo||/^(cronFail:|chAlert:|signin\||metrics-ask)/.test(o.key||''),
 all(){return this.items},
 async load(){if(!S.signedIn||document.hidden)return;await this.migrate();try{const d=await UI('/ui/news');this.items=d.items||[]}catch{return}this.paintBell();if($('.drawer.inbox'))this.paintList()},
 // the list this browser kept before it moved to the server (1 Nov 2026): the last week's news goes up once, read ones stay read
 async migrate(){const old=store.get('inbox',null);if(!Array.isArray(old))return;store.set('inbox',null);
  const items=old.filter(x=>Date.now()-x.t<7*864e5&&!this.todo({key:x.id})).slice(0,30).map(x=>({key:'old:'+x.id,icon:x.icon,kind:x.kind,title:x.title,text:x.text,go:x.go,label:x.label,read:!!x.read}));
  if(items.length)await post(UI,'/ui/news/import',{items}).catch(()=>{})},
 add(o){if(this.todo(o)){if(typeof Bottlenecks!=='undefined')setTimeout(()=>Bottlenecks.check(),500);return null}
  const key=o.key?o.key+(o.repeat===false?'':'@'+Math.floor(Date.now()/3600e3)):'',lid='l'+Date.now()+Math.random().toString(36).slice(2,6);
  const it={id:lid,key,t:Date.now(),icon:o.icon||'clock',kind:o.kind||'blue',title:o.title||'',text:noThink(o.text).slice(0,200),go:(o.actions||[]).find(a=>a.go)?.go||o.go||'',label:(o.actions||[])[0]?.label||'Open',read:false};
  if(key&&this.items.some(x=>x.key===key))return null;this.items.unshift(it);this.paintBell();if($('.drawer.inbox'))this.paintList();
  // the server's id replaces this one once it is saved (or the one it already had for the same thing)
  this.ids[lid]=post(UI,'/ui/news',{key,icon:it.icon,kind:it.kind,title:it.title,text:it.text,go:it.go,label:it.label}).then(r=>{const sid=r.item?.id;if(sid){const x=this.items.find(y=>y.id===lid);if(x){if(this.items.some(y=>y.id===sid))this.items=this.items.filter(y=>y!==x);else x.id=sid}}return sid||lid}).catch(()=>lid);
  return lid},
 async sid(id){return this.ids[id]?await this.ids[id]:id},
 async read(id){if(!id)return;const x=this.items.find(y=>y.id===id);if(x&&!x.read){x.read=true;this.paintBell()}const s=await this.sid(id);if(s&&!s.startsWith('l'))post(UI,'/ui/news/read',{ids:[s]}).catch(()=>{})},
 unread(){return this.items.filter(x=>!x.read).length},
 paintBell(){const n=this.unread();$$('[data-act="inbox"]').forEach(b=>{if(b.dataset.n===String(n))return;b.dataset.n=String(n);b.classList.toggle('has',n>0);const c=b.querySelector('.bell-n');if(c)c.textContent=n>99?'99+':String(n);b.setAttribute('aria-label',n?n+' unread notifications':'Notifications')})},
 open(){const d=sideDrawer('Notifications','<div class="inbox-bar"><button class="ghost small" data-ib="read">'+icon('check',14)+'Mark all read</button><button class="ghost small" data-ib="clear">'+icon('trash',14)+'Clear read</button></div><div id="inboxList"></div>','');d.classList.add('inbox');
  d.addEventListener('click',async e=>{const b=e.target.closest('[data-ib]');if(b){if(b.dataset.ib==='read'){this.items.forEach(x=>x.read=true);post(UI,'/ui/news/read',{all:true}).catch(fail);this.paintBell();this.paintList();return}
    const gone=$$('#inboxList .ib-item:not(.unread)');gone.forEach(n=>n.classList.add('out'));post(UI,'/ui/news/hide',{read:true}).catch(fail);setTimeout(()=>{this.items=this.items.filter(x=>!x.read);this.paintBell();this.paintList()},gone.length?220:0);return}
   const it=e.target.closest('[data-inbox]');if(!it)return;const x=this.items.find(y=>y.id===it.dataset.inbox);if(!x)return;this.read(x.id);
   if(e.target.closest('[data-ib-x]')){const n=it;n.classList.add('out');setTimeout(()=>{this.items=this.items.filter(y=>y!==x);this.paintList()},200);this.sid(x.id).then(s=>post(UI,'/ui/news/hide',{id:s})).catch(()=>{});return}
   if(x.go){closeLayers();go(x.go)}else this.paintList()});
  this.paintList();this.load()},
 paintList(){const el=$('#inboxList');if(!el)return;const l=this.items;
  if(!l.length){el.innerHTML='<div class="inbox-empty">'+icon('check',22)+'<b>Nothing new</b><span>What finished or got fixed shows here. What needs you is in Bottlenecks.</span></div>';return}
  const day=t=>{const d=new Date(t),n=new Date();const y=new Date(n-864e5);return d.toDateString()===n.toDateString()?'Today':d.toDateString()===y.toDateString()?'Yesterday':d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'short'})};
  let last='';el.innerHTML=l.map((x,i)=>{const h=day(x.t);const head=h!==last?'<div class="group-label">'+esc(h)+'</div>':'';last=h;
   return head+`<div class="ib-item ${x.read?'':'unread'}" data-inbox="${esc(x.id)}" ${st(Math.min(i,10))} tabindex="0"><span class="ic ${esc(x.kind)}">${icon(x.icon,15)}</span><div class="txt"><b>${esc(x.title)}</b>${x.text?`<span>${esc(x.text)}</span>`:''}<small>${esc(new Date(x.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}${x.go?' · '+esc(x.label):''}</small></div><button class="ghost icon ib-x" data-ib-x aria-label="Remove">${icon('x',13)}</button></div>`}).join('')}};
Poll.add(()=>Inbox.load(),60000,1500);
// a pop-up that is news also lands in the bell's list, and reading it in either place counts; a to-do's pop-up does not
{const show=Notices.show.bind(Notices);Notices.show=o=>{const id=Inbox.add(o);const n=show({...o,onRead:()=>Inbox.read(id),onClose:()=>{o.onClose?.()}});return n}}

// Undo instead of "are you sure?": things that can be put back happen at once, with Undo in the message for 8 seconds
function toastUndo(msg,undo){const t=document.createElement('div');t.className='toast undo';t.innerHTML=icon('check',15)+'<span>'+esc(msg)+'</span><button class="ghost small">Undo</button>';$('#toasts').append(t);
 let done=false;const bye=()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)};const tm=setTimeout(bye,8000);
 t.querySelector('button').onclick=async()=>{if(done)return;done=true;clearTimeout(tm);bye();try{await undo();toast('Undone')}catch(e){fail(e)}}}
