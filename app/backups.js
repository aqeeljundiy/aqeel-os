// Backups (System › Health): the one home for backups (1 Nov 2026, was also a "Back up" and a "Restore…" under Maintenance).
// Back up now sends the nightly encrypted copy to Google Drive; Restore… brings the agents back from one of those (the only
// restore: the engine's own import of a file made no safety copy and replaced more, so it went, 1 Nov 2026 review); the
// restore test and the backup key are rows of the same card.
// While a backup, a test or a restore runs, only this card refreshes (every 8 s), never the whole page (1 Nov 2026, review).
const Backups={async card(el,gone){if(S.me?.admin===false)return;let d;try{d=await UI('/ui/backups')}catch{return}if(gone?.()||!el.isConnected)return;   // a newer drawing of the page adds its own card
  let box=el.querySelector('.backups-card');const fresh=!box;if(fresh){box=document.createElement('div');box.className='panel card backups-card'}const last=d.last,t=d.test,rs=d.restore,busy=d.running||d.restoring||d.testing;
  const when=x=>x?new Date(x).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const gbmb=n=>n>=1e9?(n/1e9).toFixed(1)+' GB':Math.round(n/1e6)+' MB',row=(k,v)=>'<div class="bk-row"><span class="bk-k">'+k+'</span><span>'+v+'</span></div>';
  box.innerHTML='<div class="bk-head"><div><h2>Backups</h2><p class="sub">Every night at 03:00 to '+esc(d.where)+(d.account?' ('+esc(d.account)+')':'')+', encrypted. The newest '+d.keep+' are kept.</p></div><div class="bk-acts"><button class="ghost small" data-act="op-restore"'+(busy?' disabled':'')+'>Restore…</button><button class="primary small" data-act="backup-run"'+(busy?' disabled':'')+'>Back up now</button></div></div>'
   +(d.keyError?'<p class="err-line" style="margin:10px 0 0">'+esc(d.keyError)+'</p>':'')+'<div class="bk-rows">'
   +row('Last backup',d.running?'<span class="spinner tiny"></span> Backing up now…':last?(last.ok?'<b>'+esc(when(last.at))+'</b> · '+gbmb(last.size)+' · took '+(last.secs>=120?Math.round(last.secs/60)+' min':last.secs+' s'):'<span class="err-line">'+esc(when(last.at))+': '+esc(last.error)+'</span>'):'None yet')
   +(d.restoring?row('Restore','<span class="spinner tiny"></span> Restoring the agents from '+esc(rs?.name||'a backup')+'…'):rs?row('Last restore',(rs.ok?'<b>'+esc(when(rs.at))+'</b> · from '+esc(rs.name)+' · took '+(rs.secs>=120?Math.round(rs.secs/60)+' min':rs.secs+' s'):'<span class="err-line">'+esc(when(rs.at))+': '+esc(rs.error)+'</span>')+(rs.safety?'<small class="bk-sub">What the agents had before is kept in '+esc(rs.safety.split('/').pop())+' on the box.</small>':'')):'')
   +row('Restore test',d.testing?'<span class="spinner tiny"></span> Testing a restore…':(t?(t.ok?'<b>'+esc(when(t.at))+'</b> · '+esc(t.detail):'<span class="err-line">'+esc(when(t.at))+': '+esc(t.error)+'</span>'):'Not tried yet')+(busy?'':' <button class="link-btn" data-act="backup-test">Test now</button>'))
   +row('Backup key','Opens every backup. Keep a copy outside the AI box. <button class="link-btn" data-act="backup-key">Show key</button>')+'</div>';
  if(fresh)el.prepend(box);
  // the agents' Restart, Start and Stop are hidden while a restore runs (the server refuses them then anyway)
  document.querySelectorAll('[data-act="gw-restart"],[data-act="gw-start"],[data-act="gw-stop"]').forEach(b=>b.hidden=!!d.restoring);
  // a restore that just ended: the page draws again, now with the agents running
  const ended=el._restoring&&!d.restoring;el._restoring=!!d.restoring;clearTimeout(el._bkT);
  if(ended){if(route().page?.id==='health')reload();return d}
  if(busy)el._bkT=setTimeout(()=>{if(el.isConnected&&!gone?.()&&route().page?.id==='health')this.card(el,gone)},8000);return d}};
ACT['backup-run']=async a=>{if(a)a.disabled=true;try{await post(UI,'/ui/backups/run',{});toast('Backing up to Google Drive · takes a few minutes');setTimeout(reload,1500)}catch(e){if(a)a.disabled=false;fail(e)}};
ACT['backup-test']=async a=>{if(a){a.disabled=true;a.textContent='Testing…'}toast('Testing a restore · takes a few minutes');try{await post(UI,'/ui/backups/test',{});toast('Restore test passed')}catch(e){fail(e)}reload()};
ACT['backup-key']=async()=>{try{const {key}=await UI('/ui/backups/key');drawer('Backup key','<p class="hint" style="margin:0 0 12px">Backups can only be opened with this key. Keep a copy somewhere safe outside the AI box (your password manager): if the box is ever lost, you need it to restore.</p><div class="secret-card"><div class="sc-row"><input readonly value="'+esc(key)+'"><button class="ghost small" data-act="copy-text" data-text="'+esc(key)+'">Copy</button></div></div>','<button class="ghost" data-act="close">Close</button>')}catch(e){fail(e)}};

/* ---------- Restore…: the Drive backups, newest on top. What it does is said plainly (backup.mjs restoreRules): every file
   the backup holds goes back to how it was, nothing is deleted, and today's agents are packed first. ---------- */
ACT['op-restore']=()=>{
 const d=drawer('Restore from a backup',`<div class="approval" style="margin-top:0"><h4>${icon('alert',16)}What a restore does</h4><ul class="rs-what"><li>The agents’ settings, skills, memories, chats and sign-ins go back to how they were in that backup.</li><li>Nothing is deleted: agents and files made after that backup stay, and anything deleted since comes back.</li><li>aqeelOS’s own data and people’s files are not touched.</li><li>Today’s agents are saved on the box first, and the agents stop for a few minutes.</li></ul></div>
  <h3 class="rs-h">In Google Drive</h3><div class="rs-list" id="rsDrive"><div class="skel" style="height:48px;border-radius:12px"></div><div class="skel" style="height:48px;border-radius:12px"></div></div>`,`<button class="ghost" data-act="close">Close</button>`,{size:'md'});
 const sure=n=>confirmBox('Restore from '+n+'?','The agents’ settings, skills, memories, chats and sign-ins go back to how they were in this backup. Today’s are saved on the box first.','Restore');
 const size=n=>n>=1e9?(n/1e9).toFixed(1)+' GB':Math.round(n/1e6)+' MB',list=d.querySelector('#rsDrive');
 UI('/ui/backups/list').then(r=>{if(!list.isConnected)return;const l=r.items||[];
  list.innerHTML=l.length?l.map((f,i)=>`<div class="rs-item" ${st(Math.min(i,8))}><div class="txt"><b>${esc(new Date(f.at).toLocaleString([],{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</b><span>${esc(f.name)} · ${size(f.size)}</span></div><button class="ghost small" data-rs="${esc(f.id)}" data-n="${esc(f.name)}">Restore</button></div>`).join(''):'<p class="hint" style="margin:0">No backup in Google Drive yet. Back up now makes the first one.</p>'},
  e=>{if(list.isConnected)list.innerHTML='<p class="err-line" style="margin:0">Couldn’t list the Drive backups. '+esc(String(e.message||e))+'</p>'});
 list.addEventListener('click',async e=>{const b=e.target.closest('[data-rs]');if(!b||!await sure(b.dataset.n))return;b.disabled=true;
  try{await post(UI,'/ui/backups/restore',{id:b.dataset.rs});closeLayers();toast('Restoring from '+b.dataset.n+' · takes a few minutes');setTimeout(reload,1500)}catch(er){b.disabled=false;fail(er)}})};
// the card goes on System › Health (health-page.js replaced the old status page before this file loads), under the engine updates
// When the rest of the page can't load (a restore stops the engine), the card still shows, under a note saying why
{const base=PAGES.health;PAGES.health=async(p,el,r)=>{const gone=pageTok(el);let err=null;try{await base(p,el,r)}catch(e){if(e?.stale)throw e;err=e}if(gone())return;
 if(err){if(S.me?.admin===false)throw err;let d;try{d=await UI('/ui/backups')}catch{throw err}if(gone())return;setActions('');
  el.innerHTML=(d.restoring?`<div class="card status-alert restore-note" role="status">${icon('refresh',16)}<div><b>Restoring the agents from ${esc(d.restore?.name||'a backup')}</b><span>The agents and the engine are stopped until it finishes, usually a few minutes. This page comes back by itself.</span></div></div>`:alertBox(esc(err.message||String(err))))+'<div class="backups-slot"></div>';
  await Backups.card(el.querySelector('.backups-slot'),gone);return}
 const box=document.createElement('div');box.className='backups-slot';const at=el.querySelector('#updBox');at?at.after(box):el.append(box);await Backups.card(box,gone)}}
