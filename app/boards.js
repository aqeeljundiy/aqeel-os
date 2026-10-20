// Native pages for two Hermes plugins: the Kanban board (agents pick up "ready" tasks) and Achievements.
const KB=(p,o)=>H('/plugins/kanban'+p,o);
const KCOLS=[['triage','Triage','New ideas to sort out'],['todo','To do','Planned, not ready yet'],['scheduled','Scheduled','Waiting for their time'],['ready','Ready','An agent picks these up'],['running','Running','An agent is working on it'],['blocked','Blocked','Needs something first'],['review','Review','Check the result'],['done','Done','Finished']];
const kAge=t=>{const s=t.created_age_seconds??(t.created_at?Date.now()/1000-t.created_at:null);return s==null?'':s<3600?Math.max(1,Math.round(s/60))+' min':s<86400?Math.round(s/3600)+' h':Math.round(s/86400)+' d'};

PAGES.kanban=async(p,el)=>{
 setActions(`<button data-act="kb-refresh">${icon('refresh',16)}Refresh</button><button class="primary" data-act="kb-new">${icon('plus',16)}New task</button>`);
 const b=await KB('/board');Pages._kb=b;const byCol=Object.fromEntries((b.columns||[]).map(c=>[c.name,c.tasks||[]]));
 const total=Object.values(byCol).reduce((n,l)=>n+l.length,0);
 const card=t=>`<div class="kcard" draggable="true" data-act="kb-open" data-id="${esc(t.id)}" tabindex="0"><b>${esc(t.title||'Untitled')}</b>${t.body?`<p>${esc(String(t.body).slice(0,140))}</p>`:''}<div class="kmeta">${t.assignee?`<span class="chip">${esc(ident(t.assignee).name)}</span>`:'<span class="chip">Unassigned</span>'}${t.priority?`<span class="chip ${t.priority>=2?'bad':t.priority>=1?'warn':''}">P${t.priority}</span>`:''}<span class="kage">${kAge(t)}</span></div></div>`;
 // the 10-second refresh redraws the board: keep where the person had scrolled
 const k0=el.querySelector('.kboard'),sx=k0?.scrollLeft||0,cs=Object.fromEntries([...el.querySelectorAll('.kcol')].map(c=>[c.dataset.col,c.querySelector('.klist')?.scrollTop||0]));
 el.innerHTML=`${total?'':`<div class="empty-hero" style="margin-bottom:16px"><b style="display:block;font-size:17px;margin-bottom:6px">Hand work to your agents</b><span style="color:var(--ink-2)">Add a task, give it to an agent and move it to Ready. The agent picks it up, works on it, and moves it along.</span></div>`}
 <div class="kboard">${KCOLS.filter(([id])=>id in byCol&&(['todo','ready','running','done'].includes(id)||byCol[id].length)).map(([id,label,hint])=>`<section class="kcol" data-col="${id}"><header><b>${label}</b><span class="n">${byCol[id].length}</span></header><p class="khint">${hint}</p><div class="klist">${byCol[id].map(card).join('')}</div></section>`).join('')}</div>`;
 // drag a card to another column to change its status
 el.querySelectorAll('.kcard').forEach(c=>c.ondragstart=e=>{e.dataTransfer.setData('text/kb',c.dataset.id);c.classList.add('dragging')});
 el.querySelectorAll('.kcard').forEach(c=>c.ondragend=()=>c.classList.remove('dragging'));
 el.querySelectorAll('.kcol').forEach(col=>{col.ondragover=e=>{if(e.dataTransfer.types.includes('text/kb')){e.preventDefault();col.classList.add('over')}};col.ondragleave=()=>col.classList.remove('over');
  col.ondrop=async e=>{e.preventDefault();col.classList.remove('over');const id=e.dataTransfer.getData('text/kb');if(!id)return;try{const r=await KB('/tasks/'+encodeURIComponent(id),{method:'PATCH',body:{status:col.dataset.col}});if(r?.warning)toast(r.warning);reload()}catch(er){fail(er)}}});
 const fit=()=>{const k=el.querySelector('.kboard');if(!k)return;k.style.height=Math.max(320,innerHeight-k.getBoundingClientRect().top-18)+'px'};fit();window.removeEventListener('resize',Pages._kbFit||fit);Pages._kbFit=fit;window.addEventListener('resize',fit);
 {const k=el.querySelector('.kboard');if(k)k.scrollLeft=sx;el.querySelectorAll('.kcol').forEach(c=>{const l=c.querySelector('.klist');if(l&&cs[c.dataset.col])l.scrollTop=cs[c.dataset.col]})}
 // while a task is open or the tab is hidden, wait and try again instead of stopping
 const tick=()=>{if(route().page?.id!=='kanban')return;if(document.hidden||$('.drawer')){Pages._kbT=setTimeout(tick,10000);return}PAGES.kanban(p,el).catch(()=>{})};
 clearTimeout(Pages._kbT);Pages._kbT=setTimeout(tick,10000);
};
ACT['kb-refresh']=()=>reload();
ACT['kb-new']=()=>{const ag=Pages._kb?.assignees||['default'];
 const d=drawer('New task',`<label>Title</label><input id="ktT" placeholder="Write the weekly newsletter"><label>Details</label><textarea id="ktB" rows="5" placeholder="What done looks like, links, anything the agent needs."></textarea>
  <label>Agent</label><select id="ktA"><option value="">Nobody yet</option>${ag.map(n=>`<option value="${esc(n)}">${esc(ident(n).name)}</option>`).join('')}</select>
  <label>Priority</label><select id="ktP"><option value="0">Normal</option><option value="1">High</option><option value="2">Urgent</option></select>
  <label>Put it in</label><select id="ktS"><option value="todo">To do</option><option value="triage">Triage</option><option value="ready">Ready (the agent starts right away)</option></select>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="ktGo">Add task</button>`);
 d.querySelector('#ktGo').onclick=async()=>{const title=$('#ktT').value.trim();if(!title)return toast('Give the task a title','err');const status=$('#ktS').value;
  try{const r=await post(KB,'/tasks',{title,body:$('#ktB').value.trim()||undefined,assignee:$('#ktA').value||undefined,priority:+$('#ktP').value,triage:status==='triage'});const id=r?.task?.id;
   if(id&&status!=='triage'&&r.task.status!==status)await KB('/tasks/'+encodeURIComponent(id),{method:'PATCH',body:{status:'ready'}});closeLayers();toast(r?.warning||'Task added');reload()}catch(e){fail(e)}}};
ACT['kb-open']=async a=>{let t;try{t=await KB('/tasks/'+encodeURIComponent(a.dataset.id))}catch(e){return fail(e)}const task=t.task||t;const ag=Pages._kb?.assignees||[];
 const comments=t.comments||task.comments||[];const runs=t.runs||[];
 const d=drawer(task.title||'Task',`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><span class="chip blue">${esc((KCOLS.find(c=>c[0]===task.status)||[0,task.status])[1])}</span>${task.assignee?`<span class="chip">${esc(ident(task.assignee).name)}</span>`:''}${task.created_at?`<span class="chip">${esc(new Date(task.created_at*1000).toLocaleString())}</span>`:''}</div>
  <label>Title</label><input id="kdT" value="${esc(task.title||'')}"><label>Details</label><textarea id="kdB" rows="6">${esc(task.body||'')}</textarea>
  <div class="sched-row"><div><label>Status</label><select id="kdS">${KCOLS.map(([v,l])=>`<option value="${v}" ${v===task.status?'selected':''}>${l}</option>`).join('')}</select></div><div><label>Agent</label><select id="kdA"><option value="">Nobody</option>${ag.map(n=>`<option value="${esc(n)}" ${n===task.assignee?'selected':''}>${esc(ident(n).name)}</option>`).join('')}</select></div></div>
  ${task.result?`<label>Result</label><div class="log" style="white-space:pre-wrap;max-height:220px">${esc(task.result)}</div>`:''}${task.block_reason?`<p class="err-line">Blocked: ${esc(task.block_reason)}</p>`:''}
  ${runs.length?`<label>Runs</label>${runs.slice(0,5).map(r=>`<p class="hint" style="margin:2px 0">${esc(r.status||'')} · ${esc(ident(r.assignee||task.assignee||'default').name)}${r.started_at?' · '+esc(new Date(r.started_at*1000).toLocaleString()):''}</p>`).join('')}`:''}
  <label>Comments</label>${comments.map(c=>`<div class="kcomment"><b>${esc(c.author||'')}</b><span>${esc(c.body||'')}</span></div>`).join('')||'<p class="hint">No comments yet.</p>'}
  <div style="display:flex;gap:8px;margin-top:8px"><input id="kdC" placeholder="Add a comment for the agent"><button data-act="kb-comment" data-id="${esc(task.id)}">Add</button></div>
  <button class="ghost" style="margin-top:22px;color:var(--bad)" data-act="kb-del" data-id="${esc(task.id)}">${icon('trash',15)}Delete task</button>`,`<button class="ghost" data-act="close">Close</button><button class="primary" id="kdGo">Save</button>`);
 d.querySelector('#kdGo').onclick=async()=>{const body={};const T=$('#kdT').value.trim(),B=$('#kdB').value,S2=$('#kdS').value,A=$('#kdA').value;if(T!==task.title)body.title=T;if(B!==(task.body||''))body.body=B;if(S2!==task.status)body.status=S2;if(A!==(task.assignee||''))body.assignee=A||'';
  if(!Object.keys(body).length)return closeLayers();try{const r=await KB('/tasks/'+encodeURIComponent(task.id),{method:'PATCH',body});closeLayers();toast(r?.warning||'Task saved');reload()}catch(e){fail(e)}}};
ACT['kb-comment']=async a=>{const v=$('#kdC').value.trim();if(!v)return;try{await post(KB,'/tasks/'+encodeURIComponent(a.dataset.id)+'/comments',{body:v,author:'Aqeel'});toast('Comment added');ACT['kb-open'](a)}catch(e){fail(e)}};
ACT['kb-del']=async a=>{if(!await confirmBox('Delete this task?','It is removed from the board.'))return;try{await del(KB,'/tasks/'+encodeURIComponent(a.dataset.id));toast('Task deleted');reload()}catch(e){fail(e)}};

/* ===================== Achievements ===================== */
const TIER_COLORS={Copper:'#b87333',Silver:'#9aa3ad',Gold:'#d4a017',Diamond:'#4fc3f7',Olympian:'#8e5cff'};
PAGES.achievements=async(p,el)=>{
 setActions(`<button data-act="ach-rescan">${icon('refresh',16)}Rescan history</button>`);
 const [a,recent,scan]=await Promise.all([H('/plugins/hermes-achievements/achievements'),H('/plugins/hermes-achievements/recent-unlocks').catch(()=>null),H('/plugins/hermes-achievements/scan-status').catch(()=>null)]);
 const deH=s=>String(s||'').replace(/Hermes/g,'aqeelOS');const list=(a.achievements||[]).map(x=>({...x,name:deH(x.name),description:deH(x.description),criteria:deH(x.criteria)}));const unlocked=list.filter(x=>x.unlocked);const cats=[...new Set(list.map(x=>x.category||'Other'))];
 const rec=(recent?.unlocks||recent?.recent||(Array.isArray(recent)?recent:[])).slice(0,6);
 const badge=(x,i)=>{const col=TIER_COLORS[x.tier]||'var(--muted)';return `<div class="card ach ${x.unlocked?'on':''}" ${st(i)} title="${esc(x.criteria||'')}"><div class="ach-top"><span class="ach-ic ${x.unlocked?'won':''}" style="--tc:${col}">${badgeIcon(x.icon,20)}${x.unlocked?'':`<i class="ach-lock">${icon('lock',10)}</i>`}</span><div style="min-width:0"><b>${esc(x.name)}</b><span>${esc(x.description||'')}</span></div></div>
  <div class="ach-bar"><i style="width:${Math.min(100,Math.round(x.progress_pct||0))}%;background:${x.unlocked?col:'linear-gradient(90deg,var(--blue-2),var(--blue))'}"></i></div>
  <div class="ach-foot">${x.tier?`<span class="chip" style="color:${col}"><i class="dot"></i>${esc(x.tier)}</span>`:'<span class="chip">Locked</span>'}<small>${x.next_tier?`${num(x.progress||0)} / ${num(x.next_threshold)} to ${esc(x.next_tier)}`:x.unlocked?'Top tier reached':Math.round(x.progress_pct||0)+'% there'}</small></div></div>`};
 el.innerHTML=`<div class="stats">${[['Unlocked',`${unlocked.length} / ${list.length}`,'badges earned'],['Top tier',(unlocked.map(x=>x.tier).filter(Boolean).sort((p2,q)=>Object.keys(TIER_COLORS).indexOf(q)-Object.keys(TIER_COLORS).indexOf(p2))[0])||'—','your best so far'],['Categories',String(cats.length),cats.slice(0,3).join(', ')],['History scan',scan?.state==='running'?'Scanning…':scan?.snapshot_generated_at?ago(scan.snapshot_generated_at):'—','of your past sessions']].map(([t,v,s],i)=>`<div class="card stat" ${st(i)}><span class="th">${t}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('')}</div>
  ${rec.length?`<div class="panel card"><h2>Recently unlocked</h2>${rec.map(r=>`<p class="hint" style="margin:4px 0">${esc(r.name||r.achievement_id||'')} ${r.tier?'· '+esc(r.tier):''} ${r.unlocked_at?'· '+ago(r.unlocked_at):''}</p>`).join('')}</div>`:''}
  ${cats.map(c=>`<h2 class="ach-cat">${esc(c)}</h2><div class="ach-grid">${list.filter(x=>(x.category||'Other')===c).sort((x,y)=>(y.unlocked-x.unlocked)||((y.progress_pct||0)-(x.progress_pct||0))).map(badge).join('')}</div>`).join('')}`;
 // while a scan runs, look again every 5 s until it is done
 clearTimeout(Pages._achT);if(scan?.state==='running')Pages._achT=setTimeout(()=>{if(route().page?.id==='achievements')PAGES.achievements(p,el).catch(()=>{})},5000);
};
ACT['ach-rescan']=async()=>{try{await post(H,'/plugins/hermes-achievements/rescan');toast('Scanning your history…');setTimeout(reload,4000)}catch(e){fail(e)}};
