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

// Tool groups on all agents: one grid, groups down the side and agents across, a switch in each cell. Switches only
// mark a change; Apply sends them all and restarts the agents once (one restart per switch would cut every chat each time)
const TSP=new Map();   // "agent|group" → on/off waiting for Apply
const tsCell=(t,a,locks)=>{const nm=ident(a).name,unsafe=TS_UNSAFE.includes(t.name),on=t.on.includes(a),lbl=tsName(t)+' for '+nm;
 if(!t.all.includes(a))return `<td class="tsg-c"><i class="tsg-na" title="${esc(nm)} doesn’t have this group" aria-label="${esc(nm)}: not available"></i></td>`;
 if(unsafe&&locks[a])return `<td class="tsg-c">${tsLock(locks[a])}</td>`;
 if(!mayEdit(a,unsafe?'unsafe':'tools'))return `<td class="tsg-c"><span class="tsg-ro" title="${esc(unsafe?'Only people allowed terminal, files and code can change this.':'Your role can’t change '+nm+'’s tools.')}">${toggle(on,lbl,'disabled')}</span></td>`;
 return `<td class="tsg-c">${toggle(on,lbl,`data-act="tsg" data-agent="${esc(a)}" data-name="${esc(t.name)}" data-was="${on?1:0}"`)}</td>`};
const tsGrid=(list,ags,locks)=>`<div class="card tsg-wrap"><table class="tsg"><thead><tr><th class="tsg-g" scope="col">Tool group</th>${ags.map(a=>`<th scope="col" class="tsg-a"><span title="${esc(ident(a).name)}">${Access.av({id:a,name:ident(a).name},26)}<b>${esc(ident(a).name)}</b></span></th>`).join('')}</tr></thead>
 <tbody>${list.map((t,i)=>`<tr ${st(i)} data-ts="${esc(t.name)}"><th scope="row" class="tsg-g"><div class="tsg-head">${tsHead({...t,enabled:t.on.length>0})}</div></th>${ags.map(a=>tsCell(t,a,locks)).join('')}</tr>`).join('')}</tbody></table></div>`;
// the bar under the grid: how many changes wait, which ones, Undo and Apply
function tsBar(){const b=$('#tsgBar');if(!b)return;const n=TSP.size;b.classList.toggle('show',n>0);b.setAttribute('aria-hidden',String(!n));if(!n)return;
 const say=[...TSP].map(([k,on])=>{const [a,g]=k.split('|');const t=(Pages._tsAll||{})[g];return (t?tsName(t):pretty(g))+(on?' on for ':' off for ')+ident(a).name});
 b.querySelector('.tsg-sum').innerHTML=`<b>${plural(n,'change')}</b><small>${esc(say.slice(0,2).join(', ')+(say.length>2?' and '+(say.length-2)+' more':''))}</small>`}
ACT['tsg']=c=>{const k=c.dataset.agent+'|'+c.dataset.name;if(c.checked===(c.dataset.was==='1'))TSP.delete(k);else TSP.set(k,c.checked);c.closest('td')?.classList.toggle('dirty',TSP.has(k));tsBar()};
ACT['tsg-undo']=()=>{for(const c of $$('.tsg input[data-act="tsg"]')){c.checked=c.dataset.was==='1';c.closest('td')?.classList.remove('dirty')}TSP.clear();tsBar()};
// one change at a time (each writes that agent's settings), then one restart for all of them; what failed stays marked
// held by its own flag for the whole run (the press spinner lets go after the first save, so is-busy alone let a second click in)
ACT['tsg-apply']=async b=>{if(!TSP.size||b._applying)return;b._applying=true;b.disabled=true;try{const list=[...TSP].map(([k,on])=>{const [a,n]=k.split('|');return {k,a,n,on}});b.classList.add('is-busy');b.setAttribute('aria-busy','true');let ok=0;const bad=[];
 for(const x of list){try{await put(H,prof('/tools/toolsets/'+encodeURIComponent(x.n),x.a),{enabled:x.on});ok++;TSP.delete(x.k);const c=$(`.tsg input[data-act="tsg"][data-agent="${CSS.escape(x.a)}"][data-name="${CSS.escape(x.n)}"]`);if(c){c.dataset.was=x.on?'1':'0';c.closest('td')?.classList.remove('dirty')}}catch(e){bad.push(ident(x.a).name+': '+(e.message||'failed'))}}
 b.classList.remove('is-busy');b.removeAttribute('aria-busy');tsBar();
 if(bad.length)toast((ok?plural(ok,'change')+' saved. ':'')+'Not saved: '+bad.join('; '),'err');
 if(!ok)return;if(!bad.length)toast(plural(ok,'change')+' saved'+(S.me?.admin!==false?'':' · applies to new chats'));if(S.me?.admin!==false)await restartGateway()}finally{b._applying=false;b.disabled=false}};
Object.assign(ALLVIEW,{
 async skills(p,el){const gone=pageTok(el),tab=S.tab.skills||'Installed';const own=()=>setActions(`<button data-act="sk-update">${icon('refresh',16)}Update all</button><button data-act="sk-learn">${icon('wand',16)}Learn a skill</button><button class="primary" data-act="sk-new">${icon('plus',16)}New skill</button>`);own();
  // New skill, Learn a skill and Update all work on the agent you chat with: every tab says so, like Find more skills
  const forMe=`<p class="hint" style="margin:0 0 12px">New skill, Learn a skill, Update all and installs go to ${esc(ident().name)}, the agent you chat with. Pick an agent under Showing for another.</p>`;
  if(tab==='Find more skills'){await PAGES._skillsOne(p,el);if(gone())return;own();el.insertAdjacentHTML('afterbegin',forMe);return}
  // the tabs and a placeholder at once: every agent is asked, and one slow answer must not leave the page blank
  if(tab!=='Find more skills'&&!el.querySelector('[data-tabs]'))el.innerHTML=tabs('skills',['Installed','Tool groups','Find more skills'])+skeletonRows(6);
  if(tab==='Tool groups'){const per=await perAgent(a=>H(prof('/tools/toolsets',a)),a=>mayEdit(a));if(gone())return;const m=new Map();
   for(const {a,d} of per)for(const t of d||[]){const x=m.get(t.name)||{...t,on:[],all:[]};x.all.push(a);if(t.enabled)x.on.push(a);m.set(t.name,x)}
   const ags=per.filter(x=>x.d).map(x=>x.a),locks=await tsLocks(ags);if(gone())return;const tall=[...m.values()].sort((x,y)=>tsName(x).localeCompare(tsName(y))),bad=per.filter(x=>!x.d).map(x=>ident(x.a).name);
   TSP.clear();Pages._tsAll=Object.fromEntries(tall.map(t=>[t.name,t]));const admin=S.me?.admin!==false;
   el.innerHTML=`${tabs('skills',['Installed','Tool groups','Find more skills'])}<div class="toolbar"><div class="search${S.tsQ?' has-q':''}">${icon('search',16)}<input id="tsQ" placeholder="Search ${tall.length} tool groups" value="${esc(S.tsQ||'')}"><button class="ghost icon s-clear" data-act="ts-clear" aria-label="Clear search" title="Clear search">${icon('x',14)}</button></div></div>${bad.length?`<p class="err-line" style="margin:0 0 12px">Couldn’t load ${esc(bad.join(', '))}. <button data-act="reload">Try again</button></p>`:''}${forMe}
    <div class="all-view"><h2 class="ach-cat" style="margin-top:0">Tool groups, and which agents have each on <small class="hint">${tall.length}</small></h2><p class="hint tsg-note">Switch as many as you like, then press Apply${admin?': the agents restart once for all of them':''}.</p>${tall.length?tsGrid(tall,ags,locks):emptyBox('No tool groups','None of these agents answered with its tool groups.')}</div>
    <div class="tsg-bar" id="tsgBar" role="region" aria-label="Changes waiting" aria-hidden="true"><span class="tsg-sum"></span><button class="ghost" data-act="tsg-undo">Undo</button><button class="primary" data-act="tsg-apply">${admin?'Apply (restarts agents once)':'Apply'}</button></div>`;
   // searching filters what is on screen; nothing is asked of the agents again
   const filt=v=>el.querySelectorAll('.tsg tbody tr').forEach(r=>{r.hidden=!!v&&!r.querySelector('.tsg-g').textContent.toLowerCase().includes(v)});filt((S.tsQ||'').toLowerCase());
   $('#tsQ').oninput=e=>{const v=e.target.value.toLowerCase();e.target.closest('.search')?.classList.toggle('has-q',!!v);S.tsQ=e.target.value;filt(v)};return}
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
  const n=t=>String(t||'').split(/\n\s*§\s*\n|^\s*§\s*$/m).map(x=>x.trim()).filter(Boolean).length;
  el.innerHTML=`<div class="all-view">${per.map(({a,mem,user},i)=>`<div class="panel card" ${st(i)}><h2 class="h-row"><span class="aam-h">${Access.av({id:a,name:ident(a).name},24)}${esc(ident(a).name)}</span><span class="aam-hact">${Access.owner({owner:a})}${allOpen(a,'Open')}</span></h2><p class="sub">${mem?.err||user?.err?'Couldn’t load some of its notes. <button class="link" data-act="reload">Try again</button>':n(mem)+' notes about its work · '+n(user)+' about you'+memSize('MEMORY.md',mem)+memSize('USER.md',user)}</p>
   <details class="aam-more"><summary>What it has learned</summary>${memCards(mem)}</details><details class="aam-more"><summary>What it knows about you</summary>${memCards(user)}</details></div>`).join('')}</div>`;
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
  el.innerHTML=`<div class="all-view"><div class="toolbar">${tabs('logfile',Object.keys(map),Object.keys(map).find(k=>map[k]===o.file))}</div><p class="hint" style="margin:0 0 12px">The latest lines from every agent, oldest first. Pick one agent under Showing for filters and live updates.</p>${bad.length?`<p class="err-line" style="margin:0 0 12px">${esc(bad.join(', '))}: the log couldn’t be loaded, so ${bad.length>1?'their':'its'} lines are missing. <button data-act="reload">Try again</button></p>`:''}<div class="log" id="logBox">${lines.map(({a,l})=>logLine(l,'<b class="aam-who">'+esc(ident(a).name)+'</b> ')).join('\n')||(bad.length===per.length&&per.length?'No log could be loaded.':'Nothing logged yet.')}</div></div>`;
  const box=$('#logBox');if(box)box.scrollTop=box.scrollHeight;placePills?.();
  el.querySelector('[data-tabs=logfile]')?.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b&&map[b.dataset.tab]!==o.file){o.file=map[b.dataset.tab];(pageRun(el),ALLVIEW.logs(p,el)).catch(er=>showError(el,er))}})},
 async settings(p,el){setActions(`<button data-act="cfg-raw">Raw YAML</button><button data-act="cfg-import">${icon('upload',16)}Import</button><button data-act="cfg-export">${icon('download',16)}Export</button>`);const gone=pageTok(el),per=await perAgent(a=>H(prof('/config',a)));if(gone())return;
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
 box.innerHTML=`<h2>Agent settings</h2><p class="sub">${all?'For '+esc(ident(who).name)+(who===(S.profile||'default')?', the agent you chat with':'')+'. Pick an agent under Showing for another’s. ':''}Kept in its .env file on the AI box, next to its keys. Each change saves at once; channels pick it up after Restart agents.</p>${(q&&!all?rows:set).map(ROW).join('')}${(!q||all)&&more.length?`<details class="kf-more"><summary>${set.length?'Show '+more.length+' more you can set':'Show the '+more.length+' settings you can set'}</summary>${more.map(ROW).join('')}</details>`:''}`;
 el.append(box);if(S.cfgAgentEnv){S.cfgAgentEnv=false;box.scrollIntoView({behavior:'smooth',block:'start'})}}}
