/* ===================== Automations › Schedules, explained =====================
   Folders (from the [Bracket] in a title, picked by the helper model, or set by you), an agent filter, a plain
   description of each schedule, who it reaches by name, its model, and what its runs cost this month.
   Clicking a schedule opens its details: what it does step by step, the runbook it follows, its last result
   and its recent runs. Agents file what they make themselves (organize_schedule). */
const SCHED={agent:store.get('schedAgent',''),q:'',info:null};
const stripBracket=n=>String(n||'').replace(/^\s*\[[^\]]*\]\s*/,'');
const bracketOf=n=>(/^\s*\[([^\]]{1,40})\]/.exec(n||'')||[])[1]?.trim()||'';
const usd=c=>c==null?'':c<0.01?'<$0.01':'$'+(c<10?c.toFixed(2):Math.round(c));
const toks=n=>!n?'0':n<1000?String(n):n<1e6?(n/1e3).toFixed(n<1e4?1:0)+'k':(n/1e6).toFixed(1)+'M';
const secsText=s=>s==null?'':s<60?s+' s':s<3600?Math.round(s/60)+' min':(s/3600).toFixed(1)+' h';
function deliverName(j,names){const d=String(j.deliver||'local');if(d==='local')return 'this app';if(d==='origin')return 'where it was made';
 const [pf,...rest]=d.split(':');const id=rest.join(':');const app=({whatsapp:'WhatsApp',telegram:'Telegram',slack:'Slack',discord:'Discord',email:'Email',signal:'Signal'})[pf]||pretty(pf);
 if(!id)return app;const who=(names||{})[d]||(names||{})[pf+':'+id.split('@')[0]];return who?who+' on '+app:app}
function schedMeta(j){const i=SCHED.info||{};const k=(j.profile||'default')+'|'+j.id;return {m:(i.meta||{})[k]||{},r:(i.runs||{})[k]||{runs:[],tokens:0,cost:0}}}
const folderOf=j=>schedMeta(j).m.folder||bracketOf(j.name)||'General';

PAGES.schedules=async(p,el)=>{
 setActions(`<button class="primary" data-act="cron-new">${icon('plus',16)}New schedule</button>`);
 const [jobs,info]=await Promise.all([H('/cron/jobs?profile=all'),UI('/ui/schedules/info').catch(()=>null)]);
 Pages.cronJobs=jobs;SCHED.info=info||SCHED.info||{meta:{},runs:{},names:{},folds:{}};
 if(!jobs.length){el.innerHTML=emptyBox('No schedules yet','Have aqeelOS do something on a timetable, like a morning report on Telegram.',`<button class="primary" data-act="cron-new">${icon('plus',16)}New schedule</button>`);return}
 const agents=[...new Set(jobs.map(j=>j.profile||'default'))];if(SCHED.agent&&!agents.includes(SCHED.agent))SCHED.agent='';
 const q=SCHED.q.toLowerCase();
 const shown=jobs.filter(j=>(!SCHED.agent||(j.profile||'default')===SCHED.agent)&&(!q||[j.name,j.prompt,schedMeta(j).m.summary,folderOf(j)].join(' ').toLowerCase().includes(q)));
 const groups={};for(const j of shown)(groups[folderOf(j)]??=[]).push(j);
 const order=Object.keys(groups).sort((a,b)=>(a==='General')-(b==='General')||a.localeCompare(b));
 const folds=SCHED.info.folds||{};let n=0;
 const row=j=>{const on=j.enabled&&j.state!=='paused';const {m,r}=schedMeta(j);const last=r.runs[0];
  const model=j.model?`<span class="chip sm-chip" title="Runs on this model instead of the agent’s">${icon('cpu',11)}${esc(modelLabel(j.model))}</span>`:'';
  const cost=r.runs.length?`<span title="${esc(r.sub?'Covered by your subscription. This is what it would cost on the pay-per-use API.':'Estimated from the model’s price')}">≈ ${usd(r.cost)} this month · ${plural(r.runs.length,'run')}</span>`:'';
  const bad=j.last_status&&j.last_status!=='ok'||j.last_delivery_error;
  return `<div class="row sj-row" ${st(n++)} data-act="cron-open" data-id="${esc(j.id)}" data-profile="${esc(j.profile||'default')}" tabindex="0"><div class="main-c"><span class="ic ${on?'blue':''} ${bad?'warn':''}">${icon(bad?'alert':'clock',18)}</span><div class="txt"><b>${esc(stripBracket(j.name)||j.prompt?.slice(0,60)||j.id)}</b>
   ${m.summary?`<span class="sched-desc">${esc(m.summary)}</span>`:`<span class="sched-desc pending"><i class="skel" style="display:inline-block;width:min(320px,60%);height:10px;border-radius:5px;vertical-align:middle"></i></span>`}
   <span class="sched-meta" title="${esc(j.schedule?.expr||j.schedule_display||'')}">${esc(cronText(j.schedule?.expr||j.schedule_display||j.schedule?.display||''))} · to ${esc(deliverName(j,SCHED.info.names))} · ${on?'next '+when(j.next_run_at):'paused'}${j.last_run_at?' · last '+when(j.last_run_at):''}${last?.secs?' · took '+secsText(last.secs):''}</span>
   ${model||cost?`<span class="sched-meta">${model}${cost}</span>`:''}
   ${bad?`<span class="err-line" style="white-space:normal">${esc(j.last_delivery_error||j.last_error||'Last run: '+j.last_status)}</span>`:''}</div></div>
   <div class="act">${toggle(on,'Active','data-act="cron-toggle" data-id="'+esc(j.id)+'" data-profile="'+esc(j.profile||'default')+'"')}<button class="ghost icon" data-menu="cron" data-id="${esc(j.id)}" data-profile="${esc(j.profile||'default')}" aria-label="More">${icon('more',18)}</button></div></div>`};
 const month=l=>l.reduce((s,j)=>s+(schedMeta(j).r.cost||0),0);
 el.innerHTML=`<div class="toolbar sched-bar"><div class="search">${icon('search',16)}<input id="schedQ" placeholder="Search schedules" value="${esc(SCHED.q)}"></div>
  ${agents.length>1?`<div class="seg-chips">${['',...agents].map(a=>`<button class="${SCHED.agent===a?'on':''}" data-act="sched-agent" data-a="${esc(a)}">${a?esc(ident(a).name):'All agents'}</button>`).join('')}</div>`:''}</div>
  ${order.length?order.map(f=>{const l=groups[f],shut=!!folds[f]&&!q;return `<section class="sched-folder ${shut?'shut':''}" data-folder="${esc(f)}"><button class="sf-head" data-act="sched-fold" data-f="${esc(f)}" aria-expanded="${!shut}">${icon('chevD',16)}${icon('folder',16)}<b>${esc(f)}</b><span class="n">${l.length}</span>${month(l)?`<span class="sf-cost">≈ ${usd(month(l))} this month</span>`:''}<span class="sf-more" data-act="sched-folder-menu" data-f="${esc(f)}" role="button" aria-label="Folder options">${icon('more',16)}</span></button><div class="sf-body"><div class="card list">${l.map(row).join('')}</div></div></section>`}).join(''):emptyBox('Nothing matches','Try another word or agent.')}`;
 let t;$('#schedQ').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{SCHED.q=e.target.value;PAGES.schedules(p,el).then(()=>{const i=$('#schedQ');i.focus();i.setSelectionRange(i.value.length,i.value.length)})},200)};
 // descriptions still being written: look again in a little while
 clearTimeout(SCHED.t);if(jobs.some(j=>!schedMeta(j).m.summary))SCHED.t=setTimeout(()=>{if(route().page?.id==='schedules'&&!document.hidden&&!$('.drawer'))PAGES.schedules(p,el).catch(()=>{})},45000);
};
ACT['sched-agent']=a=>{SCHED.agent=a.dataset.a;store.set('schedAgent',SCHED.agent);reload()};
ACT['sched-fold']=(a,e)=>{if(e.target.closest('[data-act="sched-folder-menu"]'))return;const f=a.dataset.f;const sec=a.closest('.sched-folder');const shut=!sec.classList.contains('shut');sec.classList.toggle('shut',shut);a.setAttribute('aria-expanded',!shut);
 (SCHED.info.folds??={})[f]=shut;post(UI,'/ui/schedules/folder',{from:f,fold:shut}).catch(()=>{})};
ACT['sched-folder-menu']=(a,e)=>{e?.stopPropagation();const f=a.dataset.f;menu(a,[{label:'Rename folder',icon:'edit',run:async()=>{const v=await promptBox('Rename folder','Folder name',f,'Rename');if(!v||v.trim()===f)return;try{await post(UI,'/ui/schedules/folder',{from:f,to:v.trim()});toast('Folder renamed');reload()}catch(er){fail(er)}}}])};
ACT['cron-open']=(a,e)=>{if(e.target.closest('.switch,[data-menu],button,label,input'))return;const j=(Pages.cronJobs||[]).find(x=>x.id===a.dataset.id&&(x.profile||'default')===a.dataset.profile);if(j)cronDetail(j)};
async function moveSchedule(j){const have=[...new Set((Pages.cronJobs||[]).map(folderOf))];const v=await promptBox('Move to folder','Folder (an existing one or a new name). Folders: '+have.join(', '),folderOf(j),'Move');if(!v)return;
 try{await put(UI,'/ui/schedules/meta',{profile:j.profile||'default',id:j.id,folder:v.trim()});toast('Moved to '+v.trim());reload()}catch(e){fail(e)}}
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
  <div class="sd-facts"><div><small>When</small><b>${esc(cronText(j.schedule?.expr||j.schedule_display||''))}</b></div><div><small>Sends to</small><b>${esc(deliverName(j,SCHED.info.names))}</b></div><div><small>Next run</small><b>${on?esc(when(j.next_run_at)):'Paused'}</b></div><div><small>This month</small><b>${r.runs.length?'≈ '+usd(r.cost)+' · '+toks(r.tokens)+' tokens':'No runs yet'}</b></div></div>
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
 const now=new Date(),mStart=new Date(now.getFullYear(),now.getMonth(),1),lStart=new Date(now.getFullYear(),now.getMonth()-1,1);const day=d=>d.toISOString().slice(0,10);
 const per=await Promise.all(agents.map(a=>call('/hapi','/analytics/usage?days=62&profile='+encodeURIComponent(a)).then(u=>({a,u})).catch(()=>({a,u:{daily:[]}}))));
 const sum=(l,from,to)=>l.filter(d=>d.day>=from&&(!to||d.day<to)).reduce((s,d)=>s+(d.estimated_cost||0)+(d.actual_cost||0),0);
 const rows=per.map(({a,u})=>{const d=u.daily||[];return {a,month:sum(d,day(mStart)),last:sum(d,day(lStart),day(mStart)),wk:sum(d,day(new Date(Date.now()-7*864e5))),prev:sum(d,day(new Date(Date.now()-35*864e5)),day(new Date(Date.now()-7*864e5)))/4}}).sort((x,y)=>y.month-x.month);
 const total=rows.reduce((s,r)=>s+r.month,0),lastT=rows.reduce((s,r)=>s+r.last,0);const dayOf=now.getDate(),days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
 let info=SCHED.info;if(!info?.runs)try{info=SCHED.info=await UI('/ui/schedules/info')}catch{info={runs:{}}}
 const jobs=Pages.cronJobs||await H('/cron/jobs?profile=all').catch(()=>[]);const top=Object.entries(info.runs||{}).map(([k,r])=>{const [pr,id]=k.split('|');const j=jobs.find(x=>x.id===id&&(x.profile||'default')===pr);return {k,j,r}}).filter(x=>x.r.cost>0).sort((a,b)=>b.r.cost-a.r.cost).slice(0,5);
 const spikes=rows.filter(r=>r.prev>0.5&&r.wk>r.prev*1.8);
 panel.innerHTML=`<h2>Spending overview</h2><p class="sub">Estimated at pay-per-use prices. What a subscription covers is included, so you can see what each part would cost.</p>
  <div class="sd-facts"><div><small>This month so far</small><b>≈ ${usd(total)}</b></div><div><small>On pace for</small><b>≈ ${usd(total/dayOf*days)}</b></div><div><small>Last month</small><b>≈ ${usd(lastT)}</b></div></div>
  ${spikes.map(r=>`<div class="tz-note warn">${icon('alert',15)}<span><b>${esc(ident(r.a).name)}</b> cost ≈ ${usd(r.wk)} in the last 7 days, about ${Math.round(r.wk/r.prev)}× a usual week.</span></div>`).join('')}
  <h3 class="sd-h">By agent, this month</h3><div class="spend-bars">${rows.map(r=>`<div class="sb-row"><span class="sb-n">${esc(ident(r.a).name)}</span><span class="sb-bar"><i style="width:${total?Math.max(2,r.month/total*100):0}%"></i></span><span class="sb-v">≈ ${usd(r.month)}</span></div>`).join('')}</div>
  ${top.length?`<h3 class="sd-h">Costliest schedules, last 31 days</h3><div class="sd-runs">${top.map(x=>`<div class="sd-run" style="grid-template-columns:2fr 1fr 1fr" ${x.j?`data-act="spend-open" data-id="${esc(x.j.id)}" data-profile="${esc(x.j.profile||'default')}"`:''}><span>${esc(stripBracket(x.j?.name||x.k))}</span><span>${plural(x.r.runs.length,'run')}</span><span>≈ ${usd(x.r.cost)}</span></div>`).join('')}</div>`:''}`}}
ACT['spend-open']=a=>{const j=(Pages.cronJobs||[]).find(x=>x.id===a.dataset.id&&(x.profile||'default')===a.dataset.profile);if(j)cronDetail(j);else go('/automations/schedules')};
