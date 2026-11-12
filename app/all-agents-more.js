// "All agents" on every page with the Showing picker (20 Oct 2026), not only on apps, plugins and keys: Skills (with its
// tool groups), Files, Memory, Logs and Settings show every agent's at once, each saying whose it is. Skills and tool
// groups switch on and off per agent right here; the rest opens on the agent to change it.
for(const id of ['skills','files','memory','logs','settings'])ALL_PAGES.add(id);
const allAv=(a,on=true)=>`<span class="aam-ag${on?' on':''}" title="${esc(ident(a).name)}">${Access.av({id:a,name:ident(a).name},18)}<span>${esc(ident(a).name)}</span></span>`;
// per agent: a chip that turns the thing on or off for that agent
const allChip=(act,a,name,on)=>`<button class="aam-ag${on?' on':''}" data-act="${act}" data-agent="${esc(a)}" data-name="${esc(name)}" aria-pressed="${on}" title="${esc(ident(a).name)}: ${on?'on, click to turn off':'off, click to turn on'}">${Access.av({id:a,name:ident(a).name},18)}<span>${esc(ident(a).name)}</span></button>`;
const perAgent=async(fn,ok=()=>true)=>{const list=(await viewAgents()).filter(ok);return Promise.all(list.map(async a=>({a,d:await fn(a).catch(()=>null)})))};
// whose skills this person may manage (mayEdit); tool groups: listed on agents they may edit, switched where their role
// may turn tools on (terminal, files and code only for those allowed unsafe tools), as the server decides
const skillsOn=a=>mayEdit(a,'skills');   // TS_UNSAFE (pages.js) mirrors users.mjs UNSAFE_TOOLSETS
// send(agent,on) makes the change; when(answer) says when it applies, for the toast
async function allChipFlip(b,send,label,when){const on=b.getAttribute('aria-pressed')!=='true',a=b.dataset.agent;b.disabled=true;
 try{const r=await send(a,on);S._skPer=null;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));toast(label+(on?' on for ':' off for ')+ident(a).name+' · '+when(r,on))}catch(e){fail(e)}finally{b.disabled=false}}
ACT['all-sk']=b=>allChipFlip(b,(a,on)=>put(H,prof('/skills/toggle',a),{name:b.dataset.name,enabled:on}),b.dataset.name,()=>'applies to new chats');
// a plugin: turning it on copies it from an agent that has it (Who can use does the same); off switches it off there
ACT['all-pl']=b=>allChipFlip(b,(a,on)=>on?post(UI,'/ui/access',{kind:'plugin',id:b.dataset.name,agent:a,on:true}):post(UI,'/ui/plugins/toggle',{agent:a,name:b.dataset.name,enabled:false}),b.dataset.name,(r,on)=>on||r?.restart_required?'applies after the agents restart':'works at once');

// Tool groups on all agents (12 Nov 2026, owner: "what if we have 30+ agents"). It was a grid with one column per agent,
// which stops being readable past five. The page has two jobs, so it has two views of the same switches:
//   By tool group: one row per group (what it does, its warning, "On for 9 of 11 agents" and a short stack of faces) with
//                  one Change button that opens a side panel listing every agent with search, all on / all off and a switch each;
//   By agent:      one row per agent ("14 of 29 tool groups on", the powerful ones named) whose Change lists its groups.
// Switches only mark a change; the bar at the bottom says how many wait, and Apply sends them all and restarts the agents
// once (one restart per switch would cut every chat each time). Lists draw 60 rows at a time, so 50 agents and 40 groups stay light.
const TSP=new Map();   // "agent|group" → on/off waiting for Apply
const TS={
 groups:()=>Object.values(Pages._tsAll||{}).sort((x,y)=>tsName(x).localeCompare(tsName(y))),ags:()=>Pages._tsAgs||[],locks:()=>Pages._tsLk2||{},
 // is it on, counting what waits for Apply
 on(t,a){const k=a+'|'+t.name;return TSP.has(k)?TSP.get(k):t.on.includes(a)},
 // may this switch be changed here: ok, or why not (na: the agent has no such group, lock: locked to safe tools, ro: not this person's to change)
 can(t,a){const unsafe=TS_UNSAFE.includes(t.name);if(!t.all.includes(a))return 'na';if(unsafe&&this.locks()[a])return 'lock';return mayEdit(a,unsafe?'unsafe':'tools')?'ok':'ro'},
 why(t,a){const c=this.can(t,a),nm=ident(a).name;return c==='na'?nm+' doesn’t have this group':c==='lock'?this.locks()[a]:c==='ro'?(TS_UNSAFE.includes(t.name)?'Only people allowed terminal, files and code can change this.':'Your role can’t change '+nm+'’s tools.'):''},
 dirtyG(t){return this.ags().some(a=>TSP.has(a+'|'+t.name))},dirtyA(a){return this.groups().some(t=>TSP.has(a+'|'+t.name))},
 faces(list,max=6){return list.length?`<span class="acc-who" aria-hidden="true">${list.slice(0,max).map(a=>Access.av({id:a,name:ident(a).name},24)).join('')}${list.length>max?`<span class="acc-more">+${list.length-max}</span>`:''}</span>`:''},
 // one row per tool group: what it does and its warning lead; who has it on is one quiet line and a few faces
 rowG(t,i){const have=this.ags().filter(a=>t.all.includes(a)),on=have.filter(a=>this.on(t,a)),d=this.dirtyG(t);
  return `<div class="row ts-row tsr${d?' dirty':''}" ${st(i)} data-ts="${esc(t.name)}"><div class="main-c">${tsHead({...t,enabled:on.length>0})}</div><div class="tsr-who" title="${esc(on.length?'On for '+on.map(a=>ident(a).name).join(', '):'Off for every agent')}"><span class="tsr-n">${on.length?`On for <b>${on.length}</b> of ${plural(have.length,'agent')}`:`Off for all ${plural(have.length,'agent')}`}${d?'<i class="tsr-dot" title="Changed, waiting for Apply"></i>':''}</span>${this.faces(on)}</div><div class="act"><button class="small" data-act="tsg-open" data-kind="group" data-id="${esc(t.name)}" aria-haspopup="dialog" aria-label="Change which agents have ${esc(tsName(t))}">Change</button></div></div>`},
 // one row per agent: how many of its groups are on, and the powerful ones by name so the warning is never hidden
 rowA(a,i){const mine=this.groups().filter(t=>t.all.includes(a)),on=mine.filter(t=>this.on(t,a)),risky=on.filter(t=>tsInfo(t).risk),d=this.dirtyA(a),nm=ident(a).name;
  return `<div class="row ts-row tsr${d?' dirty':''}" ${st(i)} data-ag="${esc(a)}"><div class="main-c">${agentAvatar(a,38,{title:false})}<div class="txt"><b>${esc(nm)}</b><span class="ts-say">${on.length} of ${plural(mine.length,'tool group')} on${d?'<i class="tsr-dot" title="Changed, waiting for Apply"></i>':''}</span>${risky.length?`<span class="ts-risk">${icon('alert',13)}Powerful ones on: ${esc(risky.map(tsName).join(', '))}</span>`:''}</div></div><div class="act"><button class="small" data-act="tsg-open" data-kind="agent" data-id="${esc(a)}" aria-haspopup="dialog" aria-label="Change ${esc(nm)}’s tool groups">Change</button></div></div>`},
 view:()=>S.tab.tsView==='By agent'?'agent':'group',
 // the heading and the search box say which of the two views this is
 head(){const ag=this.view()==='agent',n=ag?this.ags().length:this.groups().length,h=$('#tsH'),i=$('#tsQ');if(h)h.innerHTML=(ag?'Agents, and the tool groups each has on':'Tool groups, and which agents have each on')+' <small class="hint">'+n+'</small>';if(i){i.placeholder=ag?'Search '+n+' agents':'Search '+n+' tool groups';i.setAttribute('aria-label',i.placeholder)}},
 // the list under the search: only what matches, 60 rows at a time
 paint(first=false){const box=$('#tsList');if(!box)return;const q=(S.tsQ||'').toLowerCase().trim(),v=this.view();
  const all=v==='agent'?this.ags().filter(a=>!q||ident(a).name.toLowerCase().includes(q)):this.groups().filter(t=>!q||[t.name,tsName(t),tsInfo(t).say].join(' ').toLowerCase().includes(q));
  const key=v+'|'+q;if(first||this._for!==key){this.shown=60;this._for=key}const vis=all.slice(0,this.shown);
  const html=all.length?`<div class="card list tsr-list">${vis.map((x,i)=>v==='agent'?this.rowA(x,first?i:0):this.rowG(x,first?i:0)).join('')}${all.length>vis.length?`<button class="ghost cn-more" data-act="tsg-more">Show ${Math.min(60,all.length-vis.length)} more of ${all.length-vis.length}</button>`:''}</div>`:emptyBox(v==='agent'?'No agent matches':'No tool group matches','Try another word.');
  // rows that open their tools stay open when the list is drawn again
  const open=[...box.querySelectorAll('.ts-x.open')].map(x=>x.closest('[data-ts]')?.dataset.ts);
  if(first)box.innerHTML=html;else{morph(box,html);box.querySelectorAll('.tsr').forEach(r=>r.style.animation='none')}
  for(const n of open){const x=box.querySelector(`[data-ts="${CSS.escape(n||'')}"] .ts-x`);if(x){x.classList.add('open');x.querySelector('.ts-xb')?.setAttribute('aria-expanded','true')}}},
 // ---- the side panel: every agent for one group, or every group for one agent
 open(kind,id){const t=kind==='group'?Pages._tsAll?.[id]:null;if(kind==='group'&&!t)return;this.cur={kind,id,q:'',shown:60};
  const title=kind==='group'?tsName(t):ident(id).name,f=t?tsInfo(t):null;
  const d=drawer(title,`<div class="tsd">${t?`<p class="tsd-say">${esc(f.say)}</p>${f.risk?`<p class="ts-risk tsd-risk">${icon('alert',13)}${esc(f.risk)}</p>`:''}`:`<p class="tsd-say">Which tool groups ${esc(title)} can use.</p>`}
   <div class="tsd-bar"><div class="search">${icon('search',16)}<input id="tsdQ" type="search" placeholder="${kind==='group'?'Search agents':'Search tool groups'}" aria-label="${kind==='group'?'Search agents':'Search tool groups'}"></div><span class="tsd-n" aria-live="polite"></span></div>
   <div class="tsd-all"><button type="button" class="link" data-act="tsd-all" data-on="1">Turn all on</button><button type="button" class="link" data-act="tsd-all" data-on="0">Turn all off</button></div>
   <div class="card list tsd-list" id="tsdList"></div></div>`,`<span class="hint tsd-foot"></span><button class="primary" data-act="close">Done</button>`,{side:true});
  d.classList.add('tsd-drawer');this.d=d;this.paintD(true);
  const q=d.querySelector('#tsdQ');q.oninput=()=>{this.cur.q=q.value;this.cur.shown=60;this.paintD()};},
 // the rows of the panel: [agent, group] pairs, filtered by its search
 pairs(){const c=this.cur;if(!c)return [];const q=(c.q||'').toLowerCase().trim();
  return c.kind==='group'?this.ags().filter(a=>!q||ident(a).name.toLowerCase().includes(q)).map(a=>[a,Pages._tsAll[c.id]]):this.groups().filter(t=>t.all.includes(c.id)&&(!q||[t.name,tsName(t),tsInfo(t).say].join(' ').toLowerCase().includes(q))).map(t=>[c.id,t])},
 line([a,t]){const c=this.cur,can=this.can(t,a),on=this.on(t,a),k=a+'|'+t.name,nm=ident(a).name,f=tsInfo(t),why=this.why(t,a);
  const left=c.kind==='group'?`${agentAvatar(a,30,{title:false})}<span class="cn-lt"><b>${esc(nm)}</b>${why?`<small>${esc(why)}</small>`:''}</span>`:`<span class="ic">${icon(f.ic,15)}</span><span class="cn-lt"><b>${esc(tsName(t))}</b><small>${esc(why||f.say)}</small>${f.risk&&!why?`<small class="ts-risk">${icon('alert',12)}${esc(f.risk)}</small>`:''}</span>`;
  const right=can==='na'?'<span class="tsd-na">Not available</span>':can==='lock'?tsLock(why):can==='ro'?`<span class="tsg-ro" title="${esc(why)}">${toggle(on,tsName(t)+' for '+nm,'disabled')}</span>`:toggle(on,tsName(t)+' for '+nm,`data-act="tsg" data-agent="${esc(a)}" data-name="${esc(t.name)}"`);
  return `<div class="cn-line tsd-line${TSP.has(k)?' dirty':''}${can==='na'?' dim':''}" data-key="${esc(k)}">${left}${right}</div>`},
 paintD(first=false){const d=this.d,c=this.cur;if(!d?.isConnected||!c)return;const all=this.pairs(),vis=all.slice(0,c.shown),box=d.querySelector('#tsdList');
  const html=all.length?vis.map(p=>this.line(p)).join('')+(all.length>vis.length?`<button class="ghost cn-more" data-act="tsd-more">Show ${Math.min(60,all.length-vis.length)} more of ${all.length-vis.length}</button>`:''):`<div class="state-box">Nothing matches “${esc(c.q)}”.</div>`;
  if(first)box.innerHTML=html;else morph(box,html);this.sumD()},
 // the count at the top of the panel and what waits at its foot
 sumD(){const d=this.d,c=this.cur;if(!d?.isConnected||!c)return;const every=c.kind==='group'?this.ags().map(a=>[a,Pages._tsAll[c.id]]):this.groups().filter(t=>t.all.includes(c.id)).map(t=>[c.id,t]);
  const have=every.filter(([a,t])=>this.can(t,a)!=='na'),on=have.filter(([a,t])=>this.on(t,a)).length;
  d.querySelector('.tsd-n').innerHTML=c.kind==='group'?`On for <b>${on}</b> of ${plural(have.length,'agent')}`:`<b>${on}</b> of ${plural(have.length,'tool group')} on`;
  const n=TSP.size;d.querySelector('.tsd-foot').textContent=n?plural(n,'change')+' waiting. Press Apply on the page when you are done.':'Nothing changes until you press Apply on the page.';
  const ok=have.filter(([a,t])=>this.can(t,a)==='ok');d.querySelector('.tsd-all').hidden=ok.length<2},
 // one switch, wherever it is: marked as waiting unless it is back where it was
 set(a,name,on){const t=Pages._tsAll?.[name];if(!t||this.can(t,a)!=='ok')return;const k=a+'|'+name;if(on===t.on.includes(a))TSP.delete(k);else TSP.set(k,on)},
 sync(){this.paint();this.sumD();tsBar()}};
// the bar under the list: how many changes wait, which ones, Discard and Apply
function tsBar(){const b=$('#tsgBar');if(!b)return;const n=TSP.size;b.classList.toggle('show',n>0);b.setAttribute('aria-hidden',String(!n));if(!n)return;
 const say=[...TSP].map(([k,on])=>{const [a,g]=k.split('|');const t=(Pages._tsAll||{})[g];return (t?tsName(t):pretty(g))+(on?' on for ':' off for ')+ident(a).name});
 b.querySelector('.tsg-sum').innerHTML=`<b>${plural(n,'change')}</b><small>${esc(say.slice(0,2).join(', ')+(say.length>2?' and '+(say.length-2)+' more':''))}</small>`}
ACT['tsg-open']=b=>TS.open(b.dataset.kind,b.dataset.id);
ACT['tsg-more']=()=>{TS.shown=(TS.shown||60)+60;TS.paint()};
ACT['tsd-more']=()=>{if(TS.cur){TS.cur.shown+=60;TS.paintD()}};
ACT['tsg']=c=>{TS.set(c.dataset.agent,c.dataset.name,c.checked);c.closest('.tsd-line')?.classList.toggle('dirty',TSP.has(c.dataset.agent+'|'+c.dataset.name));TS.sync()};
// all on / all off: every switch this person may change among the rows the panel's search shows
ACT['tsd-all']=b=>{const on=b.dataset.on==='1';for(const [a,t] of TS.pairs())TS.set(a,t.name,on);TS.paintD();TS.sync()};
ACT['tsg-undo']=()=>{TSP.clear();TS.paintD();TS.sync()};
// one change at a time (each writes that agent's settings), then one restart for all of them; what failed stays marked
// held by its own flag for the whole run (the press spinner lets go after the first save, so is-busy alone let a second click in)
ACT['tsg-apply']=async b=>{if(!TSP.size||b._applying)return;b._applying=true;b.disabled=true;try{const list=[...TSP].map(([k,on])=>{const [a,n]=k.split('|');return {k,a,n,on}});b.classList.add('is-busy');b.setAttribute('aria-busy','true');let ok=0;const bad=[];
 for(const x of list){try{await put(H,prof('/tools/toolsets/'+encodeURIComponent(x.n),x.a),{enabled:x.on});ok++;TSP.delete(x.k);const t=Pages._tsAll?.[x.n];if(t){t.on=t.on.filter(a=>a!==x.a);if(x.on)t.on.push(x.a)}}catch(e){bad.push(ident(x.a).name+': '+(e.message||'failed'))}}
 b.classList.remove('is-busy');b.removeAttribute('aria-busy');TS.paintD();TS.sync();
 if(bad.length)toast((ok?plural(ok,'change')+' saved. ':'')+'Not saved: '+bad.join('; '),'err');
 if(!ok)return;if(!bad.length)toast(plural(ok,'change')+' saved'+(S.me?.admin!==false?'':' · applies to new chats'));if(S.me?.admin!==false)await restartGateway()}finally{b._applying=false;b.disabled=false}};
// every agent is asked for its groups, eight at a time (50 agents at once stalled the engine's one worker)
const tsAsk=async()=>{const list=(await viewAgents()).filter(a=>mayEdit(a)),out=new Array(list.length);let n=0;
 await Promise.all(Array.from({length:Math.min(8,list.length)},async()=>{while(n<list.length){const i=n++,a=list[i];out[i]={a,d:await H(prof('/tools/toolsets',a)).catch(()=>null)}}}));return out};
Object.assign(ALLVIEW,{
 async skills(p,el){const gone=pageTok(el),tab=S.tab.skills||'Installed';const own=()=>setActions(`<button data-act="sk-update">${icon('refresh',16)}Update all</button><button data-act="sk-learn">${icon('wand',16)}Learn a skill</button><button class="primary" data-act="sk-new">${icon('plus',16)}New skill</button>`);own();
  // New skill, Learn a skill and Update all work on the agent you chat with: every tab says so, like Find more skills
  const forMe=`<p class="hint" style="margin:0 0 12px">New skill, Learn a skill, Update all and installs go to ${esc(ident().name)}, the agent you chat with. Pick an agent under Showing for another.</p>`;
  if(tab==='Find more skills'){await PAGES._skillsOne(p,el);if(gone())return;own();el.insertAdjacentHTML('afterbegin',forMe);return}
  // the tabs and a placeholder at once: every agent is asked, and one slow answer must not leave the page blank
  if(tab!=='Find more skills'&&!el.querySelector('[data-tabs]'))el.innerHTML=tabs('skills',['Installed','Tool groups','Find more skills'])+skeletonRows(6);
  if(tab==='Tool groups'){const per=await tsAsk();if(gone())return;const m=new Map();
   for(const {a,d} of per)for(const t of d||[]){const x=m.get(t.name)||{...t,on:[],all:[]};x.all.push(a);if(t.enabled)x.on.push(a);m.set(t.name,x)}
   const ags=per.filter(x=>x.d).map(x=>x.a),locks=await tsLocks(ags);if(gone())return;const tall=[...m.values()],bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
   TSP.clear();Pages._tsAll=Object.fromEntries(tall.map(t=>[t.name,t]));Pages._tsAgs=ags;Pages._tsLk2=locks;const admin=S.me?.admin!==false;
   if(!['By tool group','By agent'].includes(S.tab.tsView))S.tab.tsView='By tool group';const byAg=S.tab.tsView==='By agent';
   el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar tsr-bar"><div class="search${S.tsQ?' has-q':''}">${icon('search',16)}<input id="tsQ" type="search" placeholder="${byAg?'Search '+ags.length+' agents':'Search '+tall.length+' tool groups'}" value="${esc(S.tsQ||'')}" aria-label="${byAg?'Search agents':'Search tool groups'}"><button class="ghost icon s-clear" data-act="ts-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div>${tabs('tsView',['By tool group','By agent'])}</div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}
    <div class="all-view"><h2 class="ach-cat" id="tsH" style="margin-top:0"></h2><p class="hint tsg-note">Press Change on a row, switch as many as you like, then press Apply${admin?': the agents restart once for all of them':''}.</p>${tall.length?'<div id="tsList"></div>':emptyBox('No tool groups','None of these agents answered with its tool groups.')}</div>
    <div class="tsg-bar" id="tsgBar" role="region" aria-label="Changes waiting" aria-hidden="true"><span class="tsg-sum"></span><button class="ghost" data-act="tsg-undo">Discard</button><button class="primary" data-act="tsg-apply">${admin?'Apply (restarts agents once)':'Apply'}</button></div>`;placePills();
   TS.head();TS.paint(true);
   // By tool group | By agent: the same switches drawn the other way; nothing is asked again and what waits for Apply is kept
   el.querySelector('[data-tabs="tsView"]').addEventListener('click',e=>{if(!e.target.closest('[data-tab]'))return;setTimeout(()=>{S.tsQ='';const i=$('#tsQ');if(i){i.value='';i.closest('.search')?.classList.remove('has-q')}TS.head();TS.paint(true)},0)});
   // searching and switching the view change what is on screen; nothing is asked of the agents again, and changes that wait are kept
   let tm;$('#tsQ').oninput=e=>{e.target.closest('.search')?.classList.toggle('has-q',!!e.target.value);S.tsQ=e.target.value;clearTimeout(tm);tm=setTimeout(()=>TS.paint(),120)};return}
  // typing in the search box reuses the last answers (up to 30 s old) instead of asking every agent again; not kept when one failed
  let per=S._skReuse&&S._skPer&&Date.now()-S._skPer.t<30000?S._skPer.d:null;S._skReuse=false;if(!per){per=await perAgent(a=>H(prof('/skills',a)),skillsOn);S._skPer=per.some(x=>!x.d)?null:{t:Date.now(),d:per}}if(gone())return;
  const m=new Map(),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  for(const {a,d} of per)for(const s of d||[]){const x=m.get(s.name)||{...s,on:[],all:[]};x.all.push(a);if(s.enabled)x.on.push(a);m.set(s.name,x)}
  const catOf=s=>s.category||'other',cat=S.skillCat||'All';
  const q=(S.skillQ||'').toLowerCase(),all=[...m.values()].sort((x,y)=>x.name.localeCompare(y.name)),cats=[...new Set(all.map(catOf))].sort(),list=all.filter(s=>q?(s.name+' '+(s.description||'')+' '+catOf(s)+' '+pretty(catOf(s))).toLowerCase().includes(q):cat==='All'||catOf(s)===cat);
  const rows=list.map((s,i)=>allRow(i,`<span class="ic" title="${esc(pretty(s.category||'other'))}">${icon(skIcon(s.category),17)}</span>`,esc(s.name),esc(s.description||'')+(s.category?' · '+esc(pretty(s.category)):''),null,`<span class="aam-ags" data-name="${esc(s.name)}">${Access.who({users:s.on.map(a=>({id:a,name:ident(a).name}))})}</span>`));
  el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar"><div class="search${S.skillQ?' has-q':''}">${icon('search',16)}<input id="skQ" placeholder="Search ${all.length} skills on all agents" value="${esc(S.skillQ||'')}"><button class="ghost icon s-clear" data-act="sk-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div><select id="skCat" style="width:auto" aria-label="Category"><option value="All">All (${all.length})</option>${cats.map(c=>`<option ${c===cat?'selected':''} value="${esc(c)}">${esc(pretty(c))} (${all.filter(s=>catOf(s)===c).length})</option>`).join('')}</select><span class="chip">${plural(per.length-bad.length,'agent')}</span></div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}${forMe}<div class="all-view">${allSection('Skills, and which agents have each on',rows,q||cat!=='All'?'No skill matches.':'No skills yet.')}</div>`;
  $('#skCat').onchange=e=>{S.skillCat=e.target.value;S._skReuse=true;(pageRun(el),PAGES.skills(p,el))};
  let t;$('#skQ').oninput=e=>{e.target.closest('.search')?.classList.toggle('has-q',!!e.target.value);clearTimeout(t);t=setTimeout(()=>{if(!el.isConnected||route().page?.id!=='skills')return;S.skillQ=e.target.value;S._skReuse=true;(pageRun(el),PAGES.skills(p,el)).then(()=>{const i=$('#skQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}})},200)}},
 async memory(p,el){setActions('');const gone=pageTok(el);const list=(await viewAgents()).filter(a=>S.me?.admin!==false||S.me?.agents?.[a]==='owner');if(gone())return;   // memory is for an agent's owners (users.mjs)
  if(!list.length){el.innerHTML=emptyBox('No memory to show','Only an agent’s owners see what it remembers. Pick an agent you own under Showing.');return}
  const home=a=>(S.me?.hermes_home||'~/.hermes')+(a==='default'?'':'/profiles/'+a)+'/memories/';
  const read=memRead;
  const per=await Promise.all(list.map(async a=>({a,mem:await read(home(a)+'MEMORY.md'),user:await read(home(a)+'USER.md')})));
  if(gone())return;
  // each card is the agent's own memory, so no "Belongs to" next to its own name
  el.innerHTML=`<div class="all-view">${per.map(({a,mem,user},i)=>`<div class="panel card" ${st(i)}><h2 class="h-row"><span class="aam-h">${Access.av({id:a,name:ident(a).name},24)}${esc(ident(a).name)}</span><span class="aam-hact">${allOpen(a,'Open')}</span></h2><p class="sub">${mem?.err||user?.err?'Couldn’t load some of its notes. <button class="link" data-act="reload">Try again</button>':memCount(mem,'about its work','Nothing learned yet')+' · '+memCount(user,'about you','Nothing about you yet')}</p>
   <details class="aam-more"><summary>What it has learned</summary>${memCards(mem,'Nothing learned yet')}</details><details class="aam-more"><summary>What it knows about you</summary>${memCards(user,'Nothing about you yet')}</details></div>`).join('')}</div>`;
  // the memory service and context engine of the agent you chat with (an owner's setting, so only for them)
  const me=agentProfile()||'default';const [m,hub]=await Promise.all([H('/memory').catch(()=>null),memHub()]);if(!m||gone())return;   // drawn again meanwhile: that drawing adds its own panelPages._memInfo=m.providers||[];
  const box=document.createElement('div');box.className='aam-mem';box.innerHTML=memProvPanel(m,hub,ident(me).name)+`<p class="hint" style="margin:8px 0 0">For ${esc(ident(me).name)}, the agent you chat with. Pick an agent under Showing for another.</p>`;el.querySelector('.all-view')?.append(box);bindMemProv(box)},
 async files(p,el){setActions(`<button data-act="f-mkdir">${icon('folder',16)}New folder</button><button class="primary" data-act="f-upload">${icon('upload',16)}Upload</button>`);const gone=pageTok(el),list=await viewAgents();if(gone())return;
  // a folder that does not exist yet is "Not made yet"; one that could not be read says so, with Try again
  const per=await Promise.all(list.map(async a=>{const path=(S.me?.workspaces||'~/workspaces')+'/'+a;return {a,path,d:await H('/files'+qp({path})).catch(e=>e?.status===404||/not found|no such|does not exist/i.test(e?.message||'')?null:{err:e})}}));if(gone())return;
  const bad=per.filter(x=>x.d?.err).map(x=>ident(x.a).name);
  const rows=per.map(({a,path,d},i)=>{const items=(d?.entries||[]).filter(f=>!f.name.startsWith('.'));
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}’s folder</b><span>${d?.err?'Couldn’t read it':d?items.length+' item'+(items.length===1?'':'s')+(items.length?' · '+items.slice(0,4).map(f=>esc(f.name)).join(', ')+(items.length>4?'…':''):''):'Not made yet'}</span><span class="acc-from" style="font-family:var(--mono)">${esc(path.replace(S.me?.home||'\u0000','~'))}</span></div></div><div class="act">${Access.owner({owner:a})}${allOpen(a)}</div></div>`});
  el.innerHTML=`${bad.length?errLine(bad.join(', ')+(bad.length>1?'’s folders':'’s folder')):''}<div class="all-view">${allSection('Each agent’s own folder',rows,'No agents yet.')}</div><p class="hint" style="margin:14px 0 0">New folder and Upload work in ${esc(String(S.filePath||FILE_HOME).replace(S.me?.home||'\u0000','~'))}. Open an agent’s folder to work in it.</p>`},
 async logs(p,el){setActions(`<button data-act="reload" title="Load the latest lines now">${icon('refresh',16)}Refresh</button>`);const o=S.logs||(S.logs={file:'agent',level:'ALL',component:'all',lines:200,live:true});const map={Agent:'agent',Channels:'gateway',Errors:'errors'};
  const gone=pageTok(el),per=await perAgent(a=>H(prof('/logs'+qp({file:o.file,lines:80}),a)));if(gone())return;
  const lines=per.flatMap(({a,d})=>(d?.lines||[]).map(l=>({a,l:l.replace(/\n$/,'')}))).sort((x,y)=>x.l.slice(0,23)<y.l.slice(0,23)?-1:1).slice(-400),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  el.innerHTML=`<div class="all-view"><div class="toolbar">${tabs('logfile',Object.keys(map),Object.keys(map).find(k=>map[k]===o.file))}</div><p class="hint" style="margin:0 0 12px">The latest lines from every agent, oldest first. Pick one agent under Showing for filters and live updates.</p>${bad.length?`<p class="err-line" style="margin:0 0 12px">${esc(bad.join(', '))}: the log couldn’t be loaded, so ${bad.length>1?'their':'its'} lines are missing. <button data-act="reload">Try again</button></p>`:''}<div class="log" id="logBox" tabindex="0" role="log" aria-label="Log lines">${lines.map(({a,l})=>logLine(l,'<b class="aam-who">'+esc(ident(a).name)+'</b> ')).join('\n')||(bad.length===per.length&&per.length?'No log could be loaded.':'Nothing logged yet.')}</div></div>`;
  const box=$('#logBox');if(box)box.scrollTop=box.scrollHeight;placePills?.();
  el.querySelector('[data-tabs=logfile]')?.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b&&map[b.dataset.tab]!==o.file){o.file=map[b.dataset.tab];(pageRun(el),ALLVIEW.logs(p,el)).catch(er=>showError(el,er))}})},
 async settings(p,el){setActions(`<button class="ghost icon" data-act="cfg-more" aria-label="More" title="More" aria-haspopup="menu">${icon('more',18)}</button>`);const gone=pageTok(el),per=await perAgent(a=>H(prof('/config',a)));if(gone())return;
  const g=(c,k)=>k.split('.').reduce((o,x)=>o==null?undefined:o[x],c);
  const rows=per.map(({a,d},i)=>{const own=g(d,'terminal.backend')==='ssh';const bits=[modelLabel(g(d,'model.default')||g(d,'model')||''),own?'Own Linux user':'Main box user',g(d,'approvals.mode')?'Approvals: '+pretty(g(d,'approvals.mode')):'',g(d,'timezone')||''].filter(Boolean);
   return `<div class="row" ${st(i)}><div class="main-c">${Access.av({id:a,name:ident(a).name},34)}<div class="txt"><b>${esc(ident(a).name)}</b><span>${d?bits.map(esc).join(' · '):'Its settings couldn’t be read'}</span></div></div><div class="act">${allOpen(a,"Change")}</div></div>`});
  const bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
  el.innerHTML=`${bad.length?errLine(bad.join(', ')+'’s settings'):''}<div class="all-view">${allSection('Each agent’s settings',rows,'No agents yet.')}</div>`}});

PAGES._skillsOne=PAGES.skills;
for(const id of ['skills','files','memory','logs','settings']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);const gone=pageTok(el);viewPick(await viewAgents());if(!gone())return ALLVIEW[id](p,el)}}
// Plugins draws its own page (people.js), which left out the Showing picker; every page with one keeps it
for(const id of ['plugins','skills','files','memory','logs','settings','mcp','keys','webhooks']){const base=PAGES[id];if(!base)continue;PAGES[id]=async(p,el,r)=>{const gone=pageTok(el);if(!showingAll())viewPick(await viewAgents());if(!gone())return base(p,el,r)}}
// Connected apps and Plugins under "All agents" keep their own tabs and add button (21 Oct 2026): the Catalog and Browse
// tabs and "Add server" were gone while every agent was shown. The list tab stays the all-agents view; the other tab,
// and adding, work on the agent you chat with (the hint says so).
for(const [id,first,tabsOf,act] of [['mcp','Your servers',['Your servers','Catalog'],`<button class="primary" data-act="mcp-add">${icon('plus',16)}Add server</button>`],['plugins','Installed',['Installed','Browse'],`<button data-act="pl-rescan">${icon('refresh',16)}Rescan</button>`]]){
 const base=PAGES[id];PAGES[id]=async(p,el,r)=>{if(!showingAll())return base(p,el,r);const tab=S.tab[id]||first,gone=pageTok(el);
  // the other tab: drawn as for the agent you chat with, the picker still saying All agents
  if(tab!==first){S.viewAll=false;try{await base(p,el,r)}finally{S.viewAll=true}if(gone())return;viewPick(await viewAgents());if(gone())return;el.querySelector('[data-tabs="'+id+'"]')?.insertAdjacentHTML('afterend',`<p class="hint" style="margin:0 0 12px">Installs go to ${esc(ident().name)}. Pick an agent under Showing to install on another.</p>`);return}
  await base(p,el,r);if(gone())return;setActions(act);if(!el.querySelector('[data-tabs="'+id+'"]')){el.insertAdjacentHTML('afterbegin',tabs(id,tabsOf));placePills?.()}
  if(id==='mcp')el.insertAdjacentHTML('beforeend',`<p class="hint" style="margin:14px 0 0">Add server and Catalog add to ${esc(ident().name)}. Pick an agent under Showing to add to another.</p>`)}}

// Settings › Agent settings: the settings kept in an agent's .env file, and the gateway-wide ones (GATEWAY_*: who may message
// every channel). They were groups on Keys, which holds secrets only now (1 Nov 2026). The same rows as Keys (change,
// show, remove). It sits here, after the All agents view above, so it shows there too: for the agent picked, or else the
// agent you chat with, and says which.
{const settings=PAGES.settings;PAGES.settings=async(p,el,r)=>{const gone=pageTok(el);await settings(p,el,r);if(gone()||S.me?.admin===false)return;
 const who=viewing(),env=await H(prof('/env',who)).catch(()=>null);if(gone()||!env||!el.isConnected)return;const q=(S.cfgQ||'').toLowerCase(),all=showingAll();
 const rows=Object.entries(env).filter(([k,v])=>(v.category==='setting'&&!/^HERMES_/.test(k)||/^GATEWAY_/.test(k)&&!v.is_password)&&(v.is_set||!v.advanced||/^GATEWAY_/.test(k))&&(all||!q||(k+' '+(v.description||'')).toLowerCase().includes(q))).sort((x,y)=>(y[1].is_set?1:0)-(x[1].is_set?1:0));if(!rows.length)return;
 const set=rows.filter(r=>r[1].is_set),more=rows.filter(r=>!r[1].is_set);
 // who may message every channel is changed in one place, Channels › Who can message: shown here, not edited
 const ROW=([k,v])=>k!=='GATEWAY_ALLOWED_USERS'?KROW([k,v]):fieldRow(esc(v.description||'People who may message every channel'),`<span style="font-size:11.5px">${esc(k)}</span>`,`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${v.is_set?`<span class="chip ok" style="font-family:var(--mono)">${esc(v.redacted_value||'set')}</span>`:'<span class="chip">Nobody</span>'}<a href="#/channels/channels" data-act="ch-who">Change on Who can message</a></div>`);
 const box=document.createElement('div');box.className='panel card cfg-env';box.style.marginTop='16px';
 box.innerHTML=`<h2>Agent settings</h2><p class="sub">${all?'For '+esc(ident(who).name)+(who===(S.profile||'default')?', the agent you chat with':'')+'. Pick an agent under Showing for another’s. ':''}Kept privately on the AI box, next to its keys. Each change saves at once; channels pick it up after Restart agents.</p>${(q&&!all?rows:set).map(ROW).join('')}${(!q||all)&&more.length?`<details class="kf-more"><summary>${set.length?'Show '+more.length+' more you can set':'Show the '+more.length+' settings you can set'}</summary>${more.map(ROW).join('')}</details>`:''}`;
 el.append(box);if(S.cfgAgentEnv){S.cfgAgentEnv=false;box.scrollIntoView({behavior:'smooth',block:'start'})}}}
