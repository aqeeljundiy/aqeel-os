/* ===================== Automations › Schedules, explained =====================
   Folders (from the [Bracket] in a title, picked by the helper model, or set by you), an agent filter, a plain
   description of each schedule, who it reaches by name, its model, and what its runs cost this month.
   Clicking a schedule opens its details: what it does step by step, the runbook it follows, its last result
   and its recent runs. Agents file what they make themselves (organize_schedule). */
const SCHED={agent:store.get('schedAgent',''),sort:store.get('schedSort','custom'),q:'',info:null};
const stripBracket=n=>String(n||'').replace(/^\s*\[[^\]]*\]\s*/,'');
const bracketOf=n=>(/^\s*\[([^\]]{1,40})\]/.exec(n||'')||[])[1]?.trim()||'';
const usd=c=>money(c);   // dollars, or rupiah when the person picked that (core.js)
const toks=n=>!n?'0':n<1000?String(n):n<1e6?(n/1e3).toFixed(n<1e4?1:0)+'k':(n/1e6).toFixed(1)+'M';
const secsText=s=>s==null?'':s<60?s+' s':s<3600?Math.round(s/60)+' min':(s/3600).toFixed(1)+' h';
function whenText(j){const sc=j.schedule||{};const disp=String(sc.display||j.schedule_display||'');const zone=SCHED.tz?' ('+SCHED.tz.split('/').pop().replace(/_/g,' ')+' time)':'';
 const iv=/^every\s+(\d+)\s*([smhd])$/i.exec(disp);if(iv){const n=+iv[1],u={s:'second',m:'minute',h:'hour',d:'day'}[iv[2].toLowerCase()];return 'Every '+(n===1?u:n+' '+u+'s')}
 const once=/^once at (\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)/i.exec(disp);if(once){const d=new Date(once[1]+'T12:00:00');return 'Once, '+d.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})+' at '+once[2]+zone}
 const t=cronText(sc.expr||disp);return (t?t.charAt(0).toUpperCase()+t.slice(1):disp)+(sc.expr&&/\d\d:\d\d/.test(t)?zone:'')}
function deliverName(j,names){const d=String(j.deliver||'local');if(d==='local')return 'this app';if(d==='origin')return 'the chat it was made in';
 const [pf,...rest]=d.split(':');const id=rest.join(':');const app=({whatsapp:'WhatsApp',telegram:'Telegram',slack:'Slack',discord:'Discord',email:'Email',signal:'Signal'})[pf]||pretty(pf);
 if(!id)return app;const who=(names||{})[d]||(names||{})[pf+':'+id.split('@')[0]];return who?who+' on '+app:app}
function schedMeta(j){const i=SCHED.info||{};const k=(j.profile||'default')+'|'+j.id;return {m:(i.meta||{})[k]||{},r:(i.runs||{})[k]||{runs:[],tokens:0,cost:0}}}
const folderOf=j=>schedMeta(j).m.folder||bracketOf(j.name)||'General';
// a description the helper model could not write (it tries again later): the start of the prompt stands in
const promptLine=t=>{const s=String(t||'').replace(/\s+/g,' ').trim();return s.length>160?s.slice(0,157).replace(/\s\S*$/,'')+'…':s};

PAGES.schedules=async(p,el)=>{
 setActions(`<button class="primary" data-act="cron-new">${icon('plus',16)}New schedule</button>`);
 // a newer render (the next search keystroke) wins: an older answer arriving late is dropped
 const gen=SCHED.gen=(SCHED.gen||0)+1;
 // the timezone only adds "(Jakarta time)", and the engine's config takes seconds: the last one known is used, and
 // the page is drawn again if it changed
 if(SCHED.tz===undefined){SCHED.tz=store.get('schedTz','');H('/config?profile=default').then(c=>{const tz=c.timezone||'';if(tz===SCHED.tz)return;SCHED.tz=tz;store.set('schedTz',tz);if(route().page?.id==='schedules'&&el.isConnected)PAGES.schedules(p,el).catch(()=>{})}).catch(()=>{})}
 const [jobs,info]=await Promise.all([H('/cron/jobs?profile=all'),UI('/ui/schedules/info').catch(()=>null)]);
 if(gen!==SCHED.gen)return;
 Pages.cronJobs=jobs;SCHED.info=info||SCHED.info||{meta:{},runs:{},names:{},folds:{}};
 if(!jobs.length&&!(SCHED.info.folders||[]).length){el.innerHTML=emptyBox('No schedules yet','Have aqeelOS do something on a timetable, like a morning report on Telegram.',`<button class="primary" data-act="cron-new">${icon('plus',16)}New schedule</button>`);return}
 const agents=[...new Set(jobs.map(j=>j.profile||'default'))];if(SCHED.agent&&!agents.includes(SCHED.agent))SCHED.agent='';
 const q=SCHED.q.toLowerCase();
 const shown=jobs.filter(j=>(!SCHED.agent||(j.profile||'default')===SCHED.agent)&&(!q||[j.name,j.prompt,schedMeta(j).m.summary,folderOf(j)].join(' ').toLowerCase().includes(q)));
 const I=SCHED.info,admin=S.me?.admin!==false;
 const groups={};for(const j of shown)(groups[folderOf(j)]??=[]).push(j);
 // folders made on purpose show while still empty, unless you are searching or looking at one agent
 // (admins only: the folders are the admins' own filing, and a member would see folders of schedules they can't see)
 if(!q&&!SCHED.agent&&admin)for(const f of I.folders||[])groups[f]??=[];
 const month=l=>l.reduce((s,j)=>s+(schedMeta(j).r.cost||0),0);
 const sort=SCHED.sort||'custom',pos=f=>{const i=(I.order||[]).indexOf(f);return i<0?1e6:i};
 const order=Object.keys(groups).sort((a,b)=>sort==='az'?a.localeCompare(b):sort==='cost'?month(groups[b])-month(groups[a])||a.localeCompare(b):sort==='size'?groups[b].length-groups[a].length||a.localeCompare(b)
  :pos(a)-pos(b)||(a==='General')-(b==='General')||a.localeCompare(b));
 SCHED.shownOrder=order;
 const folds=I.folds||{},colors=I.colors||{};let n=0;
 const row=j=>{const on=j.enabled&&j.state!=='paused';const {m,r}=schedMeta(j);const last=r.runs[0];
  const model=j.model?`<span class="chip sm-chip" title="Runs on this model instead of the agent’s">${icon('cpu',11)}${esc(modelLabel(j.model))}</span>`:'';
  const cost=r.runs.length?`<span title="${esc(r.sub?'Covered by your subscription. This is what it would cost on the pay-per-use API.':'Estimated from the model’s price')}">≈ ${usd(r.cost)} this month · ${plural(r.n||r.runs.length,'run')}</span>`:'';
  const bad=j.last_status&&j.last_status!=='ok'||j.last_delivery_error;
  return `<div class="row sj-row" ${st(n++)} ${admin?`draggable="true"`:""} data-act="cron-open" data-id="${esc(j.id)}" data-profile="${esc(j.profile||'default')}" tabindex="0"><div class="main-c"><span class="ic ${on?'blue':''} ${bad?'warn':''}">${icon(bad?'alert':'clock',18)}</span><div class="txt"><b>${esc(stripBracket(j.name)||j.prompt?.slice(0,60)||j.id)}</b>
   ${m.summary?`<span class="sched-desc">${esc(m.summary)}</span>`:m.tries?`<span class="sched-desc">${esc(promptLine(j.prompt))}</span>`:`<span class="sched-desc pending"><i class="skel" style="display:inline-block;width:min(320px,60%);height:10px;border-radius:5px;vertical-align:middle"></i></span>`}
   <span class="sched-meta" title="${esc(j.schedule?.expr||j.schedule_display||'')}">${esc(whenText(j))} · to ${esc(deliverName(j,SCHED.info.names))} · ${on?'next '+when(j.next_run_at):'paused'}${j.last_run_at?' · last '+when(j.last_run_at)+(bad?'':' ✓'):''}${last?.secs?' · took '+secsText(last.secs):''}</span>
   ${model||cost?`<span class="sched-meta">${model}${cost}</span>`:''}
   ${bad?`<span class="err-line" style="white-space:normal">${esc(j.last_delivery_error||j.last_error||'Last run: '+j.last_status)}</span>`:''}</div></div>
   <div class="act">${toggle(on,'Active','data-act="cron-toggle" data-id="'+esc(j.id)+'" data-profile="'+esc(j.profile||'default')+'"')}<button class="ghost icon" data-menu="cron" data-id="${esc(j.id)}" data-profile="${esc(j.profile||'default')}" aria-label="More">${icon('more',18)}</button></div></div>`};
 const SORTS={custom:'Your order',az:'A to Z',size:'Most schedules',cost:'Costs most'};
 el.innerHTML=`<div class="toolbar sched-bar"><div class="search">${icon('search',16)}<input id="schedQ" placeholder="Search schedules" value="${esc(SCHED.q)}"></div>
  ${agents.length>1?`<button type="button" class="sel-btn inline sched-agent-btn" data-act="sched-agent-pick" aria-haspopup="menu"><span class="sv">${SCHED.agent?esc(ident(SCHED.agent).name):'All agents'}</span>${icon('chevD',15)}</button>`:''}
  <button type="button" class="sel-btn inline" data-act="sched-sort" aria-haspopup="menu" title="How folders are ordered"><span class="sv">${icon('list',14)} ${esc(SORTS[sort])}</span>${icon('chevD',15)}</button>
  ${admin?`<button class="ghost" data-act="sched-folder-new">${icon('plus',16)}New folder</button>`:''}</div>
  ${order.length?order.map(f=>{const l=groups[f],shut=folds[f]!==false&&!q;return `<section class="sched-folder ${shut?'shut':''} ${colors[f]?'c-'+colors[f]:''}" data-folder="${esc(f)}"><button class="sf-head" data-act="sched-fold" data-f="${esc(f)}" aria-expanded="${!shut}" ${admin?'draggable="true" title="Drag to reorder"':''}>${icon('chevD',16)}<span class="sf-ic">${icon('folder',16)}</span><b>${esc(f)}</b><span class="n">${l.length}</span>${month(l)?`<span class="sf-cost">≈ ${usd(month(l))} this month</span>`:''}${admin?`<span class="sf-more" data-act="sched-folder-menu" data-f="${esc(f)}" role="button" tabindex="0" aria-label="Folder options">${icon('more',16)}</span>`:''}</button><div class="sf-body"><div class="card list">${l.length?l.map(row).join(''):`<div class="sf-empty">Nothing here yet. Drag a schedule onto this folder, or use ⋯ › Move to folder.</div>`}</div></div></section>`}).join(''):emptyBox('Nothing matches','Try another word or agent.')}`;
 if(admin)schedDrag(el);
 let t;$('#schedQ').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{SCHED.q=e.target.value;PAGES.schedules(p,el).then(()=>{const i=$('#schedQ');if(!i)return;i.focus();i.setSelectionRange(i.value.length,i.value.length)})},200)};
 // descriptions still being written: look again in a little while
 clearTimeout(SCHED.t);clearTimeout(SCHED.pt);
 // the server had only just started and sent no runs yet (no costs or "took"): they follow in a few seconds
 if(!info?.partial)SCHED.ptries=0;else if((SCHED.ptries=(SCHED.ptries||0)+1)<=5)SCHED.pt=setTimeout(()=>{if(route().page?.id==='schedules'&&el.isConnected&&!$('.drawer')&&document.activeElement?.id!=='schedQ')PAGES.schedules(p,el).catch(()=>{})},3000);if(jobs.some(j=>!schedMeta(j).m.summary&&!schedMeta(j).m.tries)&&(SCHED.tries=(SCHED.tries||0)+1)<=4)SCHED.t=setTimeout(()=>{if(route().page?.id==='schedules'&&!document.hidden&&!$('.drawer')&&document.activeElement?.id!=='schedQ')PAGES.schedules(p,el).catch(()=>{})},45000);
};
ACT['sched-agent-pick']=a=>{const ag=[...new Set((Pages.cronJobs||[]).map(j=>j.profile||'default'))];
 menu(a,[{label:'All agents',icon:'layers',on:!SCHED.agent,run:()=>{SCHED.agent='';store.set('schedAgent','');reload()}},'-',...ag.map(n=>({label:ident(n).name,icon:'user',on:SCHED.agent===n,sub:plural((Pages.cronJobs||[]).filter(j=>(j.profile||'default')===n).length,'schedule'),run:()=>{SCHED.agent=n;store.set('schedAgent',n);reload()}}))],{search:ag.length>6,matchWidth:true})};
ACT['sched-fold']=(a,e)=>{if(e.target.closest('[data-act="sched-folder-menu"]'))return;const f=a.dataset.f;const sec=a.closest('.sched-folder');const shut=!sec.classList.contains('shut');sec.classList.toggle('shut',shut);a.setAttribute('aria-expanded',!shut);
 (SCHED.info.folds??={})[f]=shut;post(UI,'/ui/schedules/folder',{from:f,fold:shut}).catch(()=>{})};
/* folders: make, rename, colour, reorder (menu or drag), delete; schedules move by drag or from their ⋯ menu.
   Deleting a folder never deletes a schedule: they go back to General. */
const FOLDER_COLORS=[['','No colour'],['blue','Blue'],['green','Green'],['teal','Teal'],['purple','Purple'],['amber','Amber'],['coral','Coral'],['grey','Grey']];
const inFolder=f=>(Pages.cronJobs||[]).filter(j=>folderOf(j)===f).map(j=>[j.profile||'default',j.id]);
const folderPost=b=>post(UI,'/ui/schedules/folder',b);
// the whole order: what is shown, then folders hidden by a search or agent filter where they were
function saveOrder(l){const all=[...l,...(SCHED.info.order||[]).filter(x=>!l.includes(x))];SCHED.info.order=all;if(SCHED.sort!=='custom'){SCHED.sort='custom';store.set('schedSort','custom')}return folderPost({order:all})}
async function newFolder(){const v=await promptBox('New folder','Folder name','', 'Create');if(!v?.trim())return null;try{const r=await folderPost({create:v.trim()});toast('Folder “'+r.name+'” made');return r.name}catch(e){fail(e);return null}}
ACT['sched-folder-new']=async()=>{if(await newFolder())reload()};
ACT['sched-sort']=a=>{const S2={custom:'Your order (drag folders to arrange)',az:'A to Z',size:'Most schedules first',cost:'Costs most first'};
 menu(a,Object.entries(S2).map(([k,l])=>({label:l,on:(SCHED.sort||'custom')===k,run:()=>{SCHED.sort=k;store.set('schedSort',k);reload()}})),{matchWidth:true})};
ACT['sched-folder-menu']=(a,e)=>{e?.stopPropagation();const f=a.dataset.f;const l=SCHED.shownOrder||[],i=l.indexOf(f);
 const move=d=>{const x=[...l];x.splice(i,1);x.splice(i+d,0,f);saveOrder(x).then(()=>reload()).catch(fail)};
 menu(a,[{label:'Rename folder',icon:'edit',run:async()=>{const v=await promptBox('Rename folder','Folder name',f,'Rename');if(!v||v.trim()===f)return;try{await folderPost({from:f,to:v.trim(),jobs:inFolder(f)});toast('Folder renamed');reload()}catch(er){fail(er)}}},
  {label:'Colour…',icon:'sparkle',run:()=>folderColour(a,f)},
  {label:'Move up',icon:'chevU',disabled:i<=0,run:()=>move(-1)},{label:'Move down',icon:'chevD',disabled:i<0||i>=l.length-1,run:()=>move(1)},
  ...(f==='General'?[]:['-',{label:'Delete folder',icon:'trash',bad:true,run:async()=>{const n=inFolder(f).length;if(!await confirmBox('Delete “'+f+'”?',n?plural(n,'schedule')+' in it move to General. No schedule is deleted.':'The folder is empty.','Delete folder'))return;
   try{await folderPost({delete:f,from:f,jobs:inFolder(f)});toast('Folder deleted');reload()}catch(er){fail(er)}}}])])};
function folderColour(a,f){const cur=(SCHED.info.colors||{})[f]||'';menu(a,FOLDER_COLORS.map(([c,l])=>({label:l,icon:'folder',on:c===cur,run:()=>folderPost({from:f,color:c}).then(()=>reload()).catch(fail)})));
 $$('.menu button.item').forEach((b,ix)=>{const c=FOLDER_COLORS[ix]?.[0];if(c)b.querySelector('svg')?.setAttribute('style','color:var(--fc-'+c+')')})}
// drag a schedule onto a folder to file it; drag a folder's title bar to put it somewhere else in the list
function schedDrag(el){let drag=null;
 el.querySelectorAll('.sj-row[draggable]').forEach(r=>r.ondragstart=e=>{drag={kind:'job',profile:r.dataset.profile,id:r.dataset.id};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',r.dataset.id);r.classList.add('dragging');e.stopPropagation()});
 el.querySelectorAll('.sf-head[draggable]').forEach(h=>h.ondragstart=e=>{drag={kind:'folder',f:h.dataset.f};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',h.dataset.f);h.closest('.sched-folder').classList.add('dragging')});
 el.ondragend=()=>{drag=null;el.querySelectorAll('.dragging,.drop-on,.drop-before,.drop-after').forEach(x=>x.classList.remove('dragging','drop-on','drop-before','drop-after'))};
 el.querySelectorAll('.sched-folder').forEach(sec=>{const f=sec.dataset.folder;
  sec.ondragover=e=>{if(!drag)return;if(drag.kind==='job'){const j=(Pages.cronJobs||[]).find(x=>x.id===drag.id&&(x.profile||'default')===drag.profile);if(j&&folderOf(j)===f)return}if(drag.kind==='folder'&&drag.f===f)return;
   e.preventDefault();e.dataTransfer.dropEffect='move';if(drag.kind==='job')sec.classList.add('drop-on');else{const r=sec.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;sec.classList.toggle('drop-after',after);sec.classList.toggle('drop-before',!after)}};
  sec.ondragleave=e=>{if(!sec.contains(e.relatedTarget))sec.classList.remove('drop-on','drop-before','drop-after')};
  sec.ondrop=async e=>{e.preventDefault();const d=drag;const after=sec.classList.contains('drop-after');el.ondragend();if(!d)return;
   if(d.kind==='job'){const j=(Pages.cronJobs||[]).find(x=>x.id===d.id&&(x.profile||'default')===d.profile);if(j)fileSchedule(j,f)}
   else{const l=(SCHED.shownOrder||[]).filter(x=>x!==d.f);l.splice(l.indexOf(f)+(after?1:0),0,d.f);try{await saveOrder(l);reload()}catch(er){fail(er)}}}})}
async function fileSchedule(j,f){const was=folderOf(j);if(was===f)return;try{await put(UI,'/ui/schedules/meta',{profile:j.profile||'default',id:j.id,folder:f});
 toastUndo('Moved to '+f,()=>put(UI,'/ui/schedules/meta',{profile:j.profile||'default',id:j.id,folder:was}).then(()=>reload()));reload()}catch(e){fail(e)}}
ACT['cron-open']=(a,e)=>{if(e.target.closest('.switch,[data-menu],button,label,input'))return;const j=(Pages.cronJobs||[]).find(x=>x.id===a.dataset.id&&(x.profile||'default')===a.dataset.profile);if(j)cronDetail(j)};
// choose the folder from a list (or make a new one) instead of typing its name
function moveSchedule(j){const cur=folderOf(j);const have=[...new Set([...(SCHED.shownOrder||[]),...(Pages.cronJobs||[]).map(folderOf),...(SCHED.info.folders||[]),'General'])];const colors=SCHED.info.colors||{};
 const d=drawer('Move to folder',`<p class="hint" style="margin:0 0 10px">${esc(stripBracket(j.name)||'This schedule')} is in <b>${esc(cur)}</b>.</p><div class="mv-list">${have.map(f=>`<button class="mv-f ${f===cur?'on':''} ${colors[f]?'c-'+colors[f]:''}" data-f="${esc(f)}" ${f===cur?'disabled':''}><span class="sf-ic">${icon('folder',16)}</span>${esc(f)}${f===cur?'<small>here now</small>':''}</button>`).join('')}</div>`,
  `<button class="ghost" data-act="close">Cancel</button><button id="mvNew">${icon('plus',16)}New folder</button>`,{size:'sm'});
 d.querySelectorAll('.mv-f').forEach(b=>b.onclick=()=>{closeLayers();fileSchedule(j,b.dataset.f)});
 d.querySelector('#mvNew').onclick=async()=>{const n=await newFolder();if(n){closeLayers();fileSchedule(j,n)}}}
async function describeSchedule2(j){const {m}=schedMeta(j);const v=await promptBox('Description','What it does and why, in one sentence',m.summary||'','Save');if(v==null)return;
 try{await put(UI,'/ui/schedules/meta',{profile:j.profile||'default',id:j.id,summary:v.trim()});toast('Saved');reload()}catch(e){fail(e)}}
// the ⋯ menu gains Move, Describe and Details
{const base=Pages.cronMenu;Pages.cronMenu=el=>{const j=(Pages.cronJobs||[]).find(x=>x.id===el.dataset.id&&(x.profile||'default')===(el.dataset.profile||'default'));const real=window.menu;
 window.menu=(a,items,...rest)=>{window.menu=real;return real(a,[{label:'Details',icon:'eye',run:()=>j&&cronDetail(j)},...items.slice(0,2),{label:'Move to folder…',icon:'folder',run:()=>j&&moveSchedule(j)},{label:'Edit description',icon:'edit',run:()=>j&&describeSchedule2(j)},...items.slice(2)],...rest)};
 try{base(el)}catch(e){window.menu=real;throw e}}}

// one schedule, explained
async function cronDetail(j){const {m,r}=schedMeta(j);const prof=j.profile||'default';const on=j.enabled&&j.state!=='paused';
 const d=drawer(stripBracket(j.name)||'Schedule',`<div class="sd" data-big>
  <div class="sd-top"><span class="chip">${icon('folder',12)}${esc(folderOf(j))}</span><span class="chip">${icon('user',12)}${esc(ident(prof).name)}</span>${j.model?`<span class="chip">${icon('cpu',12)}${esc(modelLabel(j.model))}</span>`:''}<span class="chip ${on?'ok':''}">${on?'Active':'Paused'}</span></div>
  ${m.summary?`<p class="sd-sum">${esc(m.summary)}</p>`:'<p class="sd-sum muted">A description is being written…</p>'}
  ${m.suggest?`<div class="tz-note">${icon('sparkle',15)}<span>A clearer title: <b>${esc(m.suggest)}</b></span><button type="button" data-sd="title">Use it</button></div>`:''}
  <div class="sd-facts"><div><small>When</small><b>${esc(whenText(j))}</b></div><div><small>Sends to</small><b>${esc(deliverName(j,SCHED.info.names))}</b></div><div><small>Next run</small><b>${on?esc(when(j.next_run_at)):'Paused'}</b></div><div><small>This month</small><b>${r.runs.length?'≈ '+usd(r.cost)+' · '+toks(r.tokens)+' tokens':'No runs yet'}</b></div></div>
  ${(m.steps||[]).length?`<h3 class="sd-h">What it does</h3><ol class="sd-steps">${m.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}
  <div id="sdMore"><div class="skel" style="height:90px;margin-top:16px"></div></div>
  <details class="sd-raw"><summary>The exact instructions it gets</summary><pre>${esc(j.prompt||'')}</pre></details></div>`,
  `<button class="ghost" data-sd="move">${icon('folder',15)}Move</button><button class="ghost" data-sd="run">${icon('play',15)}Run now</button><button class="primary" data-sd="edit">${icon('edit',15)}Edit</button>`,{size:'lg'});
 d.addEventListener('click',async e=>{const b=e.target.closest('[data-sd]');if(!b)return;const k=b.dataset.sd;
  if(k==='edit'){closeLayers();setTimeout(()=>cronDrawer(j),220)}
  if(k==='move'){closeLayers();setTimeout(()=>moveSchedule(j),220)}
  if(k==='run'){try{await post(H,`/cron/jobs/${encodeURIComponent(j.id)}/trigger?profile=${encodeURIComponent(prof)}`);toast('Running now · the result arrives where it delivers')}catch(er){fail(er)}}
  if(k==='title'){const br=bracketOf(j.name);const name=(br?'['+br+'] ':'')+m.suggest;try{await put(H,`/cron/jobs/${encodeURIComponent(j.id)}?profile=${encodeURIComponent(prof)}`,{updates:{name}});await put(UI,'/ui/schedules/meta',{profile:prof,id:j.id,dismissSuggest:true});closeLayers();toast('Renamed');reload()}catch(er){fail(er)}}});
 let x={};try{x=await UI('/ui/schedules/detail?profile='+encodeURIComponent(prof)+'&id='+encodeURIComponent(j.id))}catch{}
 const box=d.querySelector('#sdMore');if(!box)return;
 box.innerHTML=`${x.last?.text?`<h3 class="sd-h">Last result <small>${esc(ago(x.last.at))}</small></h3><div class="sd-last md">${md(x.last.text)}</div><button class="ghost small" data-go="/chat/${esc(x.last.session)}">${icon('chat',14)}Open that run</button>`:''}
  ${(x.books||[]).map(b=>`<details class="sd-book"><summary>${icon('file',15)}The runbook it follows: <b>${esc(b.name)}</b></summary><div class="md">${md(b.text)}</div></details>`).join('')}
  ${r.runs.length?`<h3 class="sd-h">Recent runs</h3><div class="sd-runs">${r.runs.map(u=>`<div class="sd-run" data-go="/chat/${esc(u.id)}"><span>${esc(new Date(u.t*1000).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</span><span>${u.active?'running…':esc(secsText(u.secs))}</span><span>${toks(u.tokens)} tokens</span><span title="${u.sub?'Covered by your subscription; pay-per-use price shown':''}">≈ ${usd(u.cost)}${u.sub?' *':''}</span><span class="m">${esc(modelLabel(String(u.model||'').replace(/\[.*\]$/,'')))}</span></div>`).join('')}</div>${r.sub?'<p class="hint">* Covered by your subscription. The amount is what the same run would cost on the pay-per-use API.</p>':''}`:''}`}

/* ---------- Models › Usage: where the money goes. This month by agent and by schedule, against last month, with a
   warning when the last week costs much more than usual. Subscription use is shown at pay-per-use prices. ---------- */
{const base=PAGES.usage;PAGES.usage=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;
 const panel=document.createElement('div');panel.className='panel card spend';panel.innerHTML='<h2>Spending overview</h2><p class="sub">Estimated at pay-per-use prices. What a subscription covers is included, so you can see what each part would cost.</p><div class="skel" style="height:120px"></div>';
 el.prepend(panel);
 let agents=[];try{const pr=await H('/profiles');agents=(Array.isArray(pr)?pr:pr.profiles||[]).map(x=>x.name)}catch{}if(!agents.length)agents=['default'];
 const now=new Date(),mStart=new Date(now.getFullYear(),now.getMonth(),1),lStart=new Date(now.getFullYear(),now.getMonth()-1,1);const day=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const per=await Promise.all(agents.map(a=>call('/hapi','/analytics/usage?days=62&profile='+encodeURIComponent(a)).then(u=>({a,u})).catch(()=>({a,u:{daily:[]}}))));
 const sum=(l,from,to)=>l.filter(d=>d.day>=from&&(!to||d.day<to)).reduce((s,d)=>s+(d.estimated_cost||d.actual_cost||0),0);
 const rows=per.map(({a,u})=>{const d=u.daily||[];return {a,month:sum(d,day(mStart)),last:sum(d,day(lStart),day(mStart)),wk:sum(d,day(new Date(Date.now()-7*864e5))),prev:sum(d,day(new Date(Date.now()-35*864e5)),day(new Date(Date.now()-7*864e5)))/4}}).sort((x,y)=>y.month-x.month);
 const total=rows.reduce((s,r)=>s+r.month,0),lastT=rows.reduce((s,r)=>s+r.last,0);const dayOf=now.getDate(),days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
 let info=SCHED.info;if(!info?.runs||info.partial)try{info=SCHED.info=await UI('/ui/schedules/info')}catch{info={runs:{}}}
 const jobs=Pages.cronJobs||await H('/cron/jobs?profile=all').catch(()=>[]);const top=Object.entries(info.runs||{}).map(([k,r])=>{const [pr,id]=k.split('|');const j=jobs.find(x=>x.id===id&&(x.profile||'default')===pr);return {k,j,r}}).filter(x=>x.r.cost>0).sort((a,b)=>b.r.cost-a.r.cost).slice(0,5);
 const spikes=rows.filter(r=>r.prev>0.5&&r.wk>r.prev*1.8);
 panel.innerHTML=`<h2>Spending overview</h2><p class="sub">Estimated at pay-per-use prices. What a subscription covers is included, so you can see what each part would cost.</p>
  <div class="sd-facts"><div><small>This month so far</small><b>≈ ${usd(total)}</b></div><div><small>On pace for</small><b>≈ ${usd(total/dayOf*days)}</b></div><div><small>Last month</small><b>${lastT<0.01?'No use yet':'≈ '+usd(lastT)}</b></div></div>
  ${spikes.map(r=>`<div class="tz-note warn">${icon('alert',15)}<span><b>${esc(ident(r.a).name)}</b> cost ≈ ${usd(r.wk)} in the last 7 days, about ${Math.round(r.wk/r.prev)}× a usual week.</span></div>`).join('')}
  
  ${top.length?`<h3 class="sd-h">Costliest schedules this month</h3><div class="sd-runs">${top.map(x=>`<div class="sd-run" style="grid-template-columns:2fr 1fr 1fr" ${x.j?`data-act="spend-open" data-id="${esc(x.j.id)}" data-profile="${esc(x.j.profile||'default')}"`:''}><span>${esc(stripBracket(x.j?.name||x.k))}</span><span>${plural(x.r.runs.length,'run')}</span><span>≈ ${usd(x.r.cost)}</span></div>`).join('')}</div>`:''}`}}
ACT['spend-open']=a=>{const j=(Pages.cronJobs||[]).find(x=>x.id===a.dataset.id&&(x.profile||'default')===a.dataset.profile);if(j)cronDetail(j);else go('/automations/schedules')};

/* ---------- Pages that belong to one agent (skills, apps, plugins, files, memory, webhooks, who can message, models,
   keys, logs, settings) carry a "Showing" picker in the header: look at any agent you may use without leaving the
   page or changing who you chat with. It sits in the header so the page never jumps when it loads.
   Skills are grouped into folders by what they are for, each folding open and shut (remembered per person). ---------- */
async function viewAgents(){if(S._viewList&&Date.now()-S._viewT<30000)return S._viewList;let l=[],ok=false;try{const pr=await H('/profiles?profile=default');l=(Array.isArray(pr)?pr:pr.profiles||[]).map(x=>x.name);ok=true}catch{}
 if(S.me&&S.me.admin===false)l=l.filter(a=>S.me.agents?.[a]);l=l.filter(a=>!a.includes('--'));if(!ok&&S._viewList)return S._viewList;if(ok){S._viewList=l;S._viewT=Date.now()}return l}
function viewing(){return agentProfile()||'default'}
function viewPick(list){const box=$('.page-head .head-actions');if(!box)return;let b=box.querySelector('.view-pick');if(list.length<2){b?.remove();return}
 const i=ident(viewing()),mine=viewing()===(S.profile||'default');
 if(!b){b=document.createElement('button');b.type='button';b.className='view-pick';b.dataset.act='view-pick';b.setAttribute('aria-haspopup','menu');box.prepend(b)}
 b.title=mine?'You are chatting with this agent. Pick another to look at theirs.':'Looking at '+i.name+'’s. You still chat with '+ident().name+'.';b.classList.toggle('other',!mine);
 b.innerHTML=`<span class="vp-ava">${i.avatar?`<img src="${esc(i.avatar)}" alt="">`:esc(i.name[0]||'?')}</span><span class="vp-t"><small>Showing</small><b>${esc(i.name)}</b></span>${icon('chevD',15)}`}
for(const id of ['skills','mcp','plugins','webhooks','pairing','files','memory','models','keys','logs','settings']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el)=>{
 // the agent being looked at decides whose data loads (cleared again on other pages, see agentProfile)
 viewPick(await viewAgents());return base(p,el)}}
ACT['view-pick']=async a=>{const list=await viewAgents(),me=S.profile||'default';
 menu(a,[{header:'Show whose'},...list.map(n=>({label:ident(n).name,icon:'user',on:n===viewing(),sub:n===me?'You chat with this one':'',run:()=>{if(n===viewing())return;S.viewAgent=n===me?null:n;Pages._toolCache=null;Pages._dirty=null;reload()}}))],{search:list.length>6,matchWidth:true})};
// skills in folders by category
{const base=PAGES.skills;PAGES.skills=async(p,el)=>{await base(p,el);if((S.tab.skills||'Installed')!=='Installed'||S.skillQ||(S.skillCat&&S.skillCat!=='All'))return;
 const card=el.querySelector('.card.list');const rows=[...card?.querySelectorAll('.row[data-act="sk-open"]')||[]];if(rows.length<8)return;
 const cat=n=>(Pages._skills||[]).find(s=>s.name===n)?.category||'other';const groups={};for(const r of rows)(groups[cat(r.dataset.name)]??=[]).push(r);
 const shut=store.get('skFold',{});const box=document.createElement('div');
 for(const g of Object.keys(groups).sort((a,b)=>(a==='other')-(b==='other')||a.localeCompare(b))){const l=groups[g];const on=l.filter(r=>r.querySelector('input:checked')).length;
  const sec=document.createElement('section');sec.className='sched-folder'+(shut[g]!==false?' shut':'');sec.innerHTML=`<button class="sf-head" data-act="sk-fold" data-f="${esc(g)}" aria-expanded="${shut[g]===false}">${icon('chevD',16)}${icon('folder',16)}<b>${esc(pretty(g))}</b><span class="n">${l.length}</span><span class="sf-cost">${on} on</span></button><div class="sf-body"><div class="card list"></div></div>`;
  l.forEach(r=>sec.querySelector('.card.list').append(r));box.append(sec)}
 card.replaceWith(box)}}
ACT['sk-fold']=a=>{const sec=a.closest('.sched-folder');const s=!sec.classList.contains('shut');sec.classList.toggle('shut',s);a.setAttribute('aria-expanded',!s);const f=store.get('skFold',{});f[a.dataset.f]=s;store.set('skFold',f)};

/* ---------- Google accounts: one agent can use several (work, personal, a client's). They sit on Connected apps with
   the name you gave each one and a note on what it is for; the agent is told both, so "send it from my Elkiya account"
   picks the right one. Connect another asks the agent, which sends a one-click Google sign-in link. ---------- */
const gaccWhat=sc=>[...new Set(sc.map(s=>/gmail/.test(s)?'Gmail':/drive/.test(s)?'Drive':/calendar/.test(s)?'Calendar':/spreadsheets/.test(s)?'Sheets':/documents/.test(s)?'Docs':/presentations/.test(s)?'Slides':/contacts/.test(s)?'Contacts':'').filter(Boolean))].join(', ');
const gaccTitle=x=>x.label||(x.name?pretty(x.name):'Main Google account');
{const base=PAGES.mcp;PAGES.mcp=async(p,el)=>{await base(p,el);if((S.tab.mcp||'Your servers')!=='Your servers')return;const ag=viewing();
 let d;try{d=await UI('/ui/google-accounts?agent='+encodeURIComponent(ag))}catch{return}const l=d.accounts||[];Pages._gacc=l;
 const edit=S.me?.admin!==false||S.me?.agents?.[ag]==='edit';
 const panel=document.createElement('div');panel.className='panel card gacc-panel';panel.style.marginBottom='16px';
 panel.innerHTML=`<h2 class="h-row">Google accounts<span class="chip">${l.length}</span></h2><p class="sub">${l.length?`${esc(ident(ag).name)} can use ${l.length===1?'this account':'these accounts'} for Gmail, Drive, Sheets, Docs and Calendar. Give each a name and say what it is for, and ${esc(ident(ag).name)} picks the right one when you ask (“send it from my Elkiya account”).`:`${esc(ident(ag).name)} has no Google account yet. Connect one to let it read and send Gmail, and work in Drive, Sheets, Docs and Calendar.`}</p>
  ${l.map((x,i)=>`<div class="row gacc-row" ${st(i)}><div class="main-c">${logoImg('google.com','G')}<div class="txt"><b>${esc(gaccTitle(x))}${x.renews?'':` <span class="chip warn">Needs signing in again</span>`}</b>
   <span>${esc([x.email,gaccWhat(x.scopes)||plural(x.scopes.length,'permission')].filter(Boolean).join(' · '))}</span>${x.note?`<span class="gacc-note">${icon('edit',12)}${esc(x.note)}</span>`:edit?`<span class="gacc-note empty">No note yet. Say what this account is for.</span>`:''}</div></div>
   <div class="act">${edit?`<button class="ghost icon" data-act="gacc-edit" data-i="${i}" title="Name and note" aria-label="Name and note">${icon('edit',16)}</button>`:''}${S.me?.admin!==false?`<button class="ghost icon" data-act="gacc-del" data-n="${esc(x.name)}" data-e="${esc(x.email||gaccTitle(x))}" aria-label="Remove" title="Remove" style="color:var(--bad)">${icon('trash',15)}</button>`:''}</div></div>`).join('')}
  <button data-act="gacc-add" style="margin-top:10px">${icon('plus',15)}Connect ${l.length?'another':'a'} Google account</button>`;
 const t=el.querySelector('.tabs,[role=tablist]');t?t.after(panel):el.prepend(panel)}}
ACT['gacc-edit']=a=>{const x=(Pages._gacc||[])[+a.dataset.i];if(!x)return;const ag=viewing();
 const d=drawer('Name and note',`<label>Name</label><input id="gaName" maxlength="60" placeholder="${esc(x.name?pretty(x.name):'Main Google account')}" value="${esc(x.label)}">
  <p class="hint">What you call it, for example “Elkiya work” or “Personal”.${x.email?' It is '+esc(x.email)+'.':''}</p>
  <label>What it is for</label><textarea id="gaNote" rows="3" maxlength="400" placeholder="For example: client emails and invoices for Elkiya. Use it for anything about Dagadu.">${esc(x.note)}</textarea>
  <p class="hint">${esc(ident(ag).name)} reads this to choose the right account. Nothing has to sign in again.</p>`,
  `<button class="ghost" data-act="close">Cancel</button><button class="primary" id="gaSave">Save</button>`,{size:'sm'});
 d.querySelector('#gaSave').onclick=async()=>{try{await put(UI,'/ui/google-accounts?agent='+encodeURIComponent(ag),{name:x.name,label:$('#gaName').value,note:$('#gaNote').value});closeLayers();toast('Saved. '+ident(ag).name+' goes by it from the next message.');reload()}catch(e){fail(e)}}};
ACT['gacc-add']=()=>{if(viewing()!==(S.profile||'default'))switchAgent(viewing());go('/chat');setTimeout(()=>{const ta=$('#msg');if(ta){ta.value='Connect another Google account for me (Gmail, Drive, Sheets, Docs, Calendar). Give it a short name, send me the sign-in link, and tell me when it is connected.';ta.focus()}},400)};
ACT['gacc-del']=async a=>{if(!await confirmBox('Remove '+a.dataset.e+'?',esc(ident(viewing()).name)+' can no longer use this Google account until it is connected again.','Remove'))return;
 try{await del(UI,'/ui/google-accounts?agent='+encodeURIComponent(viewing())+'&name='+encodeURIComponent(a.dataset.n));toast('Removed');reload()}catch(e){fail(e)}};

/* ---------- System › Host: who can reach the AI box over SSH (a teammate's laptop, Codex or Cursor on a PC…) ---------- */
{const base=PAGES.host;PAGES.host=async(p,el)=>{await base(p,el);if(S.me?.admin===false)return;let d;try{d=await UI('/ui/ssh-keys')}catch{return}
 const panel=document.createElement('div');panel.className='panel card';panel.style.marginTop='16px';
 const paint=()=>{panel.innerHTML=`<h2>Access to the AI box</h2><p class="sub">Each laptop or AI tool (Codex, Cursor, Claude Code on another PC) gets its own key, so you can remove one without touching the others. Only the public key is ever pasted here.</p>
  ${d.keys.map((k,i)=>`<div class="row" ${st(i)} style="padding:10px 0;border-top:1px solid var(--border)"><div class="main-c"><span class="ic blue">${icon('key',16)}</span><div class="txt"><b>${esc(k.name.replace(/-/g,' '))}</b><span style="font-family:var(--mono);font-size:11.5px">${esc(k.type)} · ${esc(k.fp)}${k.protected?' · used by aqeelOS’s builder':''}</span></div></div><div class="act">${k.protected?'':`<button class="ghost" data-act="ssh-del" data-fp="${esc(k.fp)}" data-n="${esc(k.name)}" style="color:var(--bad)">${icon('trash',15)}Remove</button>`}</div></div>`).join('')}
  <button data-act="ssh-add" style="margin-top:10px">${icon('plus',15)}Give a device access</button>
  <details class="sd-raw" style="margin-top:14px"><summary>How to connect from a new device</summary><div class="md" style="margin-top:8px">${md('1. On that device, make a key: `ssh-keygen -t ed25519 -C "my-laptop"` (press Enter at each question).\n2. Show the public key: `cat ~/.ssh/id_ed25519.pub` (on Windows: `type %USERPROFILE%\\.ssh\\id_ed25519.pub`) and paste it here with **Give a device access**.\n3. Connect: `ssh -p '+d.port+' '+d.user+'@'+d.host+'`.\n\nAn AI tool on that device (Codex, Cursor, Claude Code) can then work on the box the same way. Remove the key here when the device is lost or the person leaves.')}</div></details>`};
 paint();el.append(panel);
 panel.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;e.stopPropagation();
  if(b.dataset.act==='ssh-add'){const dl=drawer('Give a device access',`<label>Name</label><input id="skN" placeholder="Aqeel’s MacBook"><label>Public key</label><textarea id="skK" rows="4" placeholder="ssh-ed25519 AAAA… my-laptop" style="font-family:var(--mono);font-size:12px"></textarea><p class="hint">One line starting with ssh-ed25519 or ssh-rsa. Never paste a private key (the file without .pub).</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="skGo">Give access</button>`);
   dl.querySelector('#skGo').onclick=async()=>{try{d={...d,...await post(UI,'/ui/ssh-keys',{name:$('#skN').value,key:$('#skK').value})};closeLayers();toast('Access given');paint()}catch(er){fail(er)}}}
  if(b.dataset.act==='ssh-del'){if(!await confirmBox('Remove '+b.dataset.n.replace(/-/g,' ')+'?','That device can no longer reach the AI box. Its AI tools lose access too.','Remove'))return;try{d={...d,...await del(UI,'/ui/ssh-keys',{fp:b.dataset.fp})};toast('Access removed');paint()}catch(er){fail(er)}}})}}
