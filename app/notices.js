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

/* ---------- The bell (7 Nov 2026, owner approved: 213 items in a week, nearly all noise). It shows two things only:
   "Needs you", the Bottlenecks person items with the button that does the thing (one list in two places), and "You
   started it", a run, deploy or export the person asked for that finished. Everything else is Activity (System ›
   Activity): a quiet log with no badge and no ping, one row per problem. Bell items expire after 7 days; acting on one
   (opening it, or its button) clears it. The list is on the server (news.mjs), the same on every device. ---------- */
// schedules this person ran with Run now (2 hours): their "finished" is something they started, so it reaches the bell
const RanNow={norm:n=>String(n||'').replace(/^\s*\[[^\]]*\]\s*/,'').trim().toLowerCase(),
 mark(n){const l=store.get('ranNow',{}),now=Date.now();for(const k in l)if(now-l[k]>2*3600e3)delete l[k];l[this.norm(n)]=now;store.set('ranNow',l)},
 hit(n){const t=store.get('ranNow',{})[this.norm(n)];return !!t&&Date.now()-t<2*3600e3}};
const Inbox={items:[],needs:[],ids:{},loaded:false,
 // to-dos that live in Bottlenecks (their pop-ups come from people.js and mcp-share.js), and the usage-stats question (boot.js)
 todo:o=>!!o.todo||/^(cronFail:|chAlert:|signin\||metrics-ask)/.test(o.key||''),
 all(){return this.items},
 // the last known count stays until a full answer replaces it (OPS-14, P&P 11 Nov 2026): an item this tab added that the
 // server does not list yet was dropped by each minute's load, and a busy server's "needs" that failed came back empty,
 // so the badge went to 0 and popped in and rang again on the next load
 async load(){if(!S.signedIn||document.hidden)return;await this.migrate();try{const d=await UI('/ui/news'),l=Array.isArray(d.items)?d.items:[];
  this.items=[...this.items.filter(x=>String(x.id).startsWith('l')&&!(x.key&&l.some(y=>y.key===x.key))),...l];if(Array.isArray(d.needs))this.needs=d.needs}catch{return}this.loaded=true;this.paintBell();if($('.drawer.inbox'))this.paintList()},
 // the list this browser kept before it moved to the server (1 Nov 2026): the last week's news goes up once (as Activity)
 async migrate(){const old=store.get('inbox',null);if(!Array.isArray(old))return;store.set('inbox',null);
  const items=old.filter(x=>Date.now()-x.t<7*864e5&&!this.todo({key:x.id})).slice(0,30).map(x=>({key:'old:'+x.id,icon:x.icon,kind:x.kind,title:x.title,text:x.text,go:x.go,label:x.label,read:!!x.read}));
  if(items.length)await post(UI,'/ui/news/import',{items}).catch(()=>{})},
 // o.started: the person asked for it (only those reach the bell); o.group: one Activity row per problem
 add(o){if(this.todo(o)){if(typeof Bottlenecks!=='undefined')setTimeout(()=>Bottlenecks.check(),500);return null}
  const key=o.key?o.key+(o.repeat===false?'':'@'+Math.floor(Date.now()/3600e3)):'',lid='l'+Date.now()+Math.random().toString(36).slice(2,6);
  const it={id:lid,key,t:Date.now(),icon:o.icon||'clock',kind:o.kind||'blue',title:o.title||'',text:noThink(o.text).slice(0,200),go:(o.actions||[]).find(a=>a.go)?.go||o.go||'',label:(o.actions||[])[0]?.label||'Open',read:false};
  const started=o.started===true;if(started){if(key&&this.items.some(x=>x.key===key))return null;this.items.unshift(it);this.paintBell();if($('.drawer.inbox'))this.paintList()}
  // the server's id replaces this one once it is saved (or the one it already had for the same thing)
  this.ids[lid]=post(UI,'/ui/news',{key,icon:it.icon,kind:it.kind,title:it.title,text:it.text,go:it.go,label:it.label,started,group:o.group||''}).then(r=>{const sid=r.item?.id;if(sid){const x=this.items.find(y=>y.id===lid);if(x){if(this.items.some(y=>y.id===sid))this.items=this.items.filter(y=>y!==x);else x.id=sid}}return sid||lid}).catch(()=>lid);
  return lid},
 async sid(id){return this.ids[id]?await this.ids[id]:id},
 async read(id){if(!id)return;const x=this.items.find(y=>y.id===id);if(x&&!x.read){x.read=true;this.paintBell()}const s=await this.sid(id);if(s&&!s.startsWith('l'))post(UI,'/ui/news/read',{ids:[s]}).catch(()=>{})},
 // the badge: what needs you, plus what you started that finished and you have not seen
 unread(){return this.needs.length+this.items.filter(x=>!x.read).length},
 // what the bell shows: before the first answer of this page load, the count this browser last saw (a bell drawn at 0 and then
 // given its count popped in and rang on every reload and first page); from then on the real one
 shown(){if(this.loaded||this.items.length||this.needs.length)return this.unread();const k=store.get('bellN',0);return Number.isInteger(k)&&k>0?k:0},
 // the badge pops in and the bell rings only when the count goes from none to some (bell-new), never because the bell
 // was drawn again
 paintBell(){const n=this.shown();if(this.loaded&&this._bn!==n){this._bn=n;store.set('bellN',n)}$$('[data-act="inbox"]').forEach(b=>{if(b.dataset.n===String(n))return;const was=+b.dataset.n||0;b.dataset.n=String(n);b.classList.toggle('has',n>0);
  if(n>0&&!was){b.classList.add('bell-new');clearTimeout(b._newT);b._newT=setTimeout(()=>b.classList.remove('bell-new'),1300)}else if(!n)b.classList.remove('bell-new');const c=b.querySelector('.bell-n');if(c)c.textContent=n>99?'99+':String(n);b.setAttribute('aria-label',n?n+' notifications':'Notifications')})},
 async clear(x,node){if(node){node.classList.add('out');await new Promise(r=>setTimeout(r,200))}this.items=this.items.filter(y=>y!==x);this.paintBell();this.paintList();this.sid(x.id).then(s=>post(UI,'/ui/news/hide',{id:s})).catch(()=>{})},
 open(){const d=sideDrawer('Notifications','<div id="inboxList"></div>','<a class="ib-activity" href="#/system/activity" data-ib-activity>'+icon('activity',15)+'Activity: everything that happened by itself</a>');d.classList.add('inbox');
  d.addEventListener('click',async e=>{if(e.target.closest('[data-ib-activity]')){e.preventDefault();closeLayers();go('/system/activity');return}
   const it=e.target.closest('[data-inbox]');if(!it||e.target.closest('.bn-acts'))return;const x=this.items.find(y=>y.id===it.dataset.inbox);if(!x)return;
   // acting on it clears it: opening what it points to, or the ×
   if(e.target.closest('[data-ib-x]'))return this.clear(x,it);if(x.go){this.clear(x);closeLayers();go(x.go)}});
  this.paintList();this.load()},
 paintList(){const el=$('#inboxList');if(!el)return;const l=this.items,n=this.needs;
  if(!l.length&&!n.length){el.innerHTML='<div class="inbox-empty">'+icon('check',22)+'<b>Nothing needs you</b><span>What needs you and what you started shows here. Everything else is in Activity.</span></div>';return}
  const when=t=>{const d=new Date(t),now=new Date();return (d.toDateString()===now.toDateString()?'':d.toLocaleDateString([],{day:'numeric',month:'short'})+' ')+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})};
  let h='',k=0;
  if(n.length)h+='<div class="group-label">Needs you</div>'+n.map((x,i)=>`<div class="ib-item need" data-need="${i}" ${st(Math.min(k++,10))}><span class="ic warn">${icon(Bottlenecks.icon[x.kind]||'alert',15)}</span><div class="txt"><b>${esc(x.title)}</b>${x.ask?`<span>${esc(x.ask)}</span>`:''}<div class="bn-acts" data-i="${i}"></div></div></div>`).join('');
  if(l.length)h+='<div class="group-label">You started it</div>'+l.map(x=>`<div class="ib-item rm ${x.read?'':'unread'}" data-inbox="${esc(x.id)}" ${st(Math.min(k++,10))}><span class="ic ${esc(x.kind)}">${icon(x.icon,15)}</span><div class="txt"><b>${x.go?`<button type="button" class="row-main">${esc(x.title)}</button>`:esc(x.title)}</b>${x.text?`<span>${esc(x.text)}</span>`:''}<small>${esc(when(x.t))}${x.go?' · '+esc(x.label):''}</small></div><button class="ghost icon ib-x" data-ib-x aria-label="Clear">${icon('x',13)}</button></div>`).join('');
  el.innerHTML=h;
  // the same buttons as Bottlenecks; after one, both lists are drawn again
  el.querySelectorAll('.bn-acts').forEach(box=>Bottlenecks.paint(box,Bottlenecks.actions(n[+box.dataset.i]),()=>Promise.all([this.load(),Bottlenecks.check()])))}};
Poll.add(()=>Inbox.load(),60000,1500);
// a pop-up that is news also lands in the bell's list, and reading it in either place counts; a to-do's pop-up does not
// 7 Nov 2026 (owner: "annoying"): nothing pops up in the corner any more. News goes to the bell's list, to-dos to
// Bottlenecks, as before; only the one-time usage-stats question (it needs an answer) still asks in the corner
{const show=Notices.show.bind(Notices);Notices.show=o=>{const id=Inbox.add(o);if(!/^metrics-ask/.test(o.key||''))return null;const n=show({...o,onRead:()=>Inbox.read(id),onClose:()=>{o.onClose?.()}});return n}}

// Undo instead of "are you sure?": things that can be put back happen at once, with Undo in the message for 8 seconds
function toastUndo(msg,undo){const t=document.createElement('div');t.className='toast undo';t.innerHTML=icon('check',15)+'<span>'+esc(msg)+'</span><button class="ghost small">Undo</button>';$('#toasts').append(t);
 let done=false;const bye=()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)};const tm=setTimeout(bye,8000);
 t.querySelector('button').onclick=async()=>{if(done)return;done=true;clearTimeout(tm);bye();try{await undo();toast('Undone')}catch(e){fail(e)}}}
