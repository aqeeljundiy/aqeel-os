/* ---------- Notifications in the corner: one system for everything (a schedule finished or failed, a channel
   dropped, a setup finished…). They slide in, count as read after a few seconds in view, leave by themselves
   after a few minutes (hovering keeps them), and stack neatly: past three, the older ones fold into "+N more". ---------- */
const Notices={max:3,box(){let b=document.querySelector('.cron-pops');if(!b){b=document.createElement('div');b.className='cron-pops';b.setAttribute('aria-live','polite');document.body.append(b)}return b},
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
  const read=()=>setTimeout(()=>{if(document.hidden)return document.addEventListener('visibilitychange',read,{once:true});n.classList.remove('unread')},5000);read();
  this.fold();try{if(document.hidden&&'Notification' in window&&Notification.permission==='granted')new Notification(o.title||'aqeelOS',{body:String(o.text||'').slice(0,120)})}catch{}
  return n},
 fold(){const b=document.querySelector('.cron-pops');if(!b)return;const all=[...b.querySelectorAll('.cron-pop:not(.out)')];const open=b.classList.contains('all');
  all.forEach((n,i)=>n.classList.toggle('folded',!open&&i<all.length-this.max));let m=b.querySelector('.np-more');const hidden=open?0:Math.max(0,all.length-this.max);
  if(hidden){if(!m){m=document.createElement('button');m.className='np-more';m.onclick=()=>{b.classList.add('all');this.fold()};b.prepend(m)}m.textContent='+'+hidden+' more'}else{m?.remove();if(all.length<=this.max)b.classList.remove('all')}}};
